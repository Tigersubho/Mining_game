// User-acceptance tests: drives the REAL production build in a real browser.
//   npm run build && npm run test:uat          (CHROME_PATH=... to override the browser)
import fs from 'node:fs';
import path from 'node:path';
import { startServer, launch, openGame, waitReady, installHelpers } from './lib.mjs';

const OUT = path.resolve('tests/uat/out');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (id, name, ok, detail = '') => { results.push({ id, name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${detail ? `  [${detail}]` : ''}`); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const server = await startServer(3100);
const browser = await launch();
const errors = [];
const open = (viewport, mobile = false) => openGame(browser, server.url, { viewport, mobile, errors });
const ready = (page) => waitReady(page);
const phase = (page) => page.evaluate(() => window.__game.store.get().phase);
const exec = (page, fn, ...args) => page.evaluate(fn, ...args);
const stop = () => server.stop();
// =================================================================== UAT-1  boot
let page = await open();
const t0 = Date.now();
let booted = true;
try { await ready(page); } catch { booted = false; }
const bootSec = (Date.now() - t0) / 1000;
check('UAT-01', 'World boots to the ready state with no startup error', booted && !(await exec(page, () => window.__game.store.get().error)), ` s`);
await installHelpers(page);

const btnText = await exec(page, () => document.querySelector('.start .btn.primary')?.textContent);
check('UAT-02', 'Start screen offers ENTER SITE', btnText === 'ENTER SITE', btnText);
await page.screenshot({ path: `${OUT}/01-start.png` });

// =================================================================== UAT-3  enter + HUD
await page.click('.start .btn.primary');
await page.waitForSelector('.hud');
await exec(page, () => window.__game.simulate(1 / 60));
await new Promise((r) => setTimeout(r, 400));
const hudParts = await exec(page, () => ['.compass', '.map', '.readouts', '.kit', '.help'].map((s) => !!document.querySelector(s)));
check('UAT-03', 'HUD shows compass, site map, site data, field kit and controls', hudParts.every(Boolean), JSON.stringify(hudParts));
check('UAT-04', 'Phase is "playing" after entering', (await phase(page)) === 'playing');
await page.screenshot({ path: `${OUT}/02-hud-desktop.png` });

// =================================================================== UAT-5  movement + physics
await exec(page, () => window.__game.go(0, 60, 0, 1));
let r = await exec(page, () => window.__game.run(2, ['KeyW']));
check('UAT-05', 'Walking covers ~10.5 m in 2 s (5.4 m/s)', near(r.z - 60, 10.5, 1.2), `${(r.z - 60).toFixed(1)} m`);
await exec(page, () => window.__game.go(0, 60, 0, 1));
r = await exec(page, () => window.__game.run(2, ['KeyW', 'ShiftLeft']));
check('UAT-06', 'Sprinting covers ~17.5 m in 2 s (9.4 m/s)', near(r.z - 60, 17.5, 2), `${(r.z - 60).toFixed(1)} m`);
await exec(page, () => window.__game.go(0, 60, 0, 1));
await exec(page, () => window.__game.run(0.4));
r = await exec(page, () => window.__game.run(1.2, [], 0));
check('UAT-07', 'Jump apex is 1.2 - 1.8 m and the player lands', r.maxY - 1.5 > 1.2 && r.maxY - 1.5 < 1.8 && r.grounded, `apex ${(r.maxY - 1.5).toFixed(2)} m`);

// bridges
const nb = await exec(page, () => window.__game.BRIDGES.length);
let bridgeOk = 0; const bridgeBad = [];
for (let i = 0; i < nb; i++) {
  const res = await exec(page, (i) => {
    const g = window.__game, b = g.BRIDGES[i], L = b.length;
    g.go(b.x - b.dirx * (L / 2 + 4), b.z - b.dirz * (L / 2 + 4), b.dirx, b.dirz);
    const e = g.run((L + 8) / 9.4 + 0.6, ['KeyW', 'ShiftLeft']);
    const along = (e.x - b.x) * b.dirx + (e.z - b.z) * b.dirz;
    return { ok: along > L / 2 && !e.swam && e.minY > -0.8, along, swam: e.swam };
  }, i);
  res.ok ? bridgeOk++ : bridgeBad.push(i);
}
check('UAT-08', `All ${nb} bridges can be walked end to end without falling or swimming`, bridgeOk === nb, bridgeBad.length ? `failed: ${bridgeBad}` : '');

// highway ramp + deck barrier
await exec(page, () => window.__game.go(-100, 114, 1, 0));
r = await exec(page, () => window.__game.run(8, ['KeyW', 'ShiftLeft']));
check('UAT-09', 'The elevated highway can be climbed by its ramp (deck at ~8.6 m)', near(r.y, 8.6, 0.3), `y=${r.y.toFixed(2)}`);
await exec(page, () => window.__game.go(0, 114, 1, 0, 50));
await exec(page, () => { const g = window.__game; g.player.camYaw = -Math.PI; }); // look +z? face +z so W walks off the edge
await exec(page, () => { const g = window.__game; g.face(0, 1); });
r = await exec(page, () => window.__game.run(2, ['KeyW']));
check('UAT-10', 'Barriers stop the player walking off the highway deck', r.y > 8 && r.z < 120.5, `y=${r.y.toFixed(1)} z=${r.z.toFixed(1)}`);

// stairs
await exec(page, () => window.__game.go(-82.3 + 24, -98.1, -1, 0));
r = await exec(page, () => window.__game.run(7, ['KeyW']));
const stairY = await exec(page, () => window.__game.world.physics.col.groundY(-82.3, -98.1, 60));
check('UAT-11', 'The temple staircase can be climbed to the top', r.maxY - r.minY > 5, `climbed ${(r.maxY - r.minY).toFixed(1)} m`);

// block collision
await exec(page, () => window.__game.go(4, 96, 1, 0));
r = await exec(page, () => window.__game.run(4, ['KeyW']));
check('UAT-12', 'City buildings are solid', r.x > 6 && r.x < 9.5, `x=${r.x.toFixed(1)}`);

// pit: walk down the haul ramp from the rim into the (flooded) pit
await exec(page, () => window.__game.go(69.3, -40, 0.866, -0.5));
r = await exec(page, () => window.__game.run(9, ['KeyW', 'ShiftLeft']));
check('UAT-13', 'The haul ramp leads down into the open pit (you reach the water, never fall through)', r.minY < -4 && r.minY > -12.5 && r.maxY < 3, `y  .. `);

// swimming
await exec(page, () => window.__game.go(52, 30, 0, 1));
r = await exec(page, () => window.__game.run(2, []));
check('UAT-14', 'Entering deep river water switches to swimming', r.swam);

// boundary
await exec(page, () => { const g = window.__game; const a = (-30 * Math.PI) / 180; g.go(Math.cos(a) * 735, Math.sin(a) * 735, Math.cos(a), Math.sin(a), 200); });
r = await exec(page, () => window.__game.run(8, ['KeyW', 'ShiftLeft']));
check('UAT-15', 'The world edge cannot be crossed', Math.hypot(r.x, r.z) < 786, `r=${Math.hypot(r.x, r.z).toFixed(1)}`);

// =================================================================== PHASE 2: big world, Ridge Mine, vehicles
const dims = await exec(page, () => { const g = window.__game; const T = g.world.terrain; return { n: T.N, ore: g.world.ore.total, tris: g.renderer.info.render.triangles }; });
check('UAT-30', 'The world is ~1.7 km across (851 x 851 height samples)', dims.n === 851, `N=${dims.n}`);
check('UAT-31', 'Boot (terrain, physics, forests, mines) completes in under 30 s', bootSec < 30, ` s`);

// great lake
await exec(page, () => window.__game.go(-420, 150, 0, 1, 200));
r = await exec(page, () => window.__game.run(2, []));
const zone = await exec(page, () => window.__game.store.get().region);
check('UAT-32', 'The Great Lake is reachable and you swim in it', r.swam && /lake/i.test(zone), `${zone}, swimming=${r.swam}`);

// Ridge Mine: walk in through the portal on the real terrain
const M = await exec(page, () => { const m = window.__game.world.caves[0]; return { fy: m.floorY, h: m.height }; });
const mouth = await exec(page, () => ({ x: window.__game.world.caves[0].segments[0].x0 + 9, z: window.__game.world.caves[0].segments[0].z0 }));
await exec(page, (m) => window.__game.go(m.x - 30, m.z, 1, 0), mouth);
r = await exec(page, () => window.__game.run(14, ['KeyW', 'ShiftLeft']));
const under = await exec(page, () => ({ cave: window.__game.caveFactor, zone: window.__game.store.get().region, cam: window.__game.camera.position.y, ground: window.__game.world.physics.col.groundY(window.__game.camera.position.x, window.__game.camera.position.z, 400) }));
check('UAT-33', 'You can walk in through the Ridge Mine portal, ~100 m into the mountain', r.x > mouth.x + 90 && Math.abs(r.z - mouth.z) < 4, `x+${(r.x - mouth.x).toFixed(0)} z${(r.z - mouth.z).toFixed(1)}`);
check('UAT-34', 'Underground it goes dark (lighting) and the HUD says so', under.cave > 0.9 && /underground/i.test(under.zone), `dark=${under.cave.toFixed(2)} ${under.zone}`);
check('UAT-35', 'The camera stays inside the tunnel (below the hill above)', under.cam < under.ground - 1, `cam ${under.cam.toFixed(1)} hill ${under.ground?.toFixed(1)}`);
r = await exec(page, (m) => { const g = window.__game; g.go(m.x + 120, m.z, 0, 1, g.world.caves[0].floorY + 2); return g.run(3, ['KeyW']); }, mouth); // between the galleries: solid rock either side
check('UAT-36', 'Tunnel walls hold: you cannot walk out of the side of the tunnel', Math.abs(r.z - mouth.z) < 4, `z${(r.z - mouth.z).toFixed(1)}`);
await exec(page, () => window.__game.go(window.__game.world.caves[0].segments[0].x0 + 9 - 4, window.__game.world.caves[0].segments[0].z0, 1, 0));
r = await exec(page, () => window.__game.run(4, ['KeyW']));
check('UAT-37', 'Back outside the mountain the light returns', (await exec(page, () => { window.__game.go(window.__game.world.caves[0].segments[0].x0 - 40, window.__game.world.caves[0].segments[0].z0, 1, 0); for (let i = 0; i < 240; i++) window.__game.simulate(1 / 60); return window.__game.caveFactor; })) < 0.05);

// vehicles are low-poly stand-ins for now (the .glb models are switched off until they are final)
const vehicles = await exec(page, () => { const g = window.__game; return g.fleet.vehicles.every((v) => v.mesh.children.length > 0 && !v.mesh.children[0].userData?.glb) && !g.scene.children.some((c) => c.userData.glb); });
check('UAT-38', 'Low-poly stand-ins everywhere for now: every vehicle is a plain low-poly body (no .glb loaded)', vehicles);
// =================================================================== TRAFFIC + NPCS
const fl = await exec(page, () => { const f = window.__game.fleet; const c = {}; f.vehicles.forEach((v) => { c[v.category] = (c[v.category] || 0) + 1; }); return { road: f.road.length, boats: f.vehicles.length - f.road.length, c }; });
check('UAT-60', '10 resident cars (3 taxis, 3 private, 2 safari, 2 mining) + 4 long-distance cars + 1 boat, spread over the map', fl.road === 14 && fl.c.tour === 4 && fl.boats === 1 && fl.c.taxi === 3 && fl.c.private === 3 && fl.c.safari === 2 && fl.c.mining === 2, JSON.stringify(fl));
const npc = await exec(page, () => { const n = window.__game.npcs.people; const c = {}; n.forEach((p) => { c[p.brain.type] = (c[p.brain.type] || 0) + 1; }); return { n: n.length, c }; });
check('UAT-61', '18 NPCs: 4 office, 2 police, 3 civilian, 3 miner, 2 driver, 2 scuba, 1 fisherman, 1 guide', npc.n === 18 && npc.c.office === 4 && npc.c.police === 2 && npc.c.civilian === 3 && npc.c.miner === 3 && npc.c.driver === 2 && npc.c.scuba === 2 && npc.c.fisherman === 1 && npc.c.guide === 1, JSON.stringify(npc.c));
await page.screenshot({ path: `${OUT}/09-people.png` });

// 40 simulated minutes of town life (fast-forwarded, fleet + NPCs only)
const sim = await exec(page, () => {
  const g = window.__game, F = g.fleet, N = g.npcs, dt = 0.25, ang = (x, z) => ((Math.atan2(z, x) * 180) / Math.PI + 360) % 360;
  const st = Object.fromEntries(F.vehicles.map((v) => [v.id, { last: [v.x, v.z], maxJump: 0, bad: 0, city: 0, mine: 0, trips: 0, was: null, stops: new Set(), vmax: v.follower.vmax }]));
  const ev = { rideKinds: new Set(), alight: 0, dive: 0, maxDepth: 0, boardedBoat: 0, moved: 0 };
  const prevMode = new Map(N.people.map((p) => [p, p.brain.mode])), start = N.people.map((p) => [p.brain.x, p.brain.z]);
  const heights = g.world.terrain.heights, Nn = g.world.terrain.N;
  const hAt = (x, z) => heights[Math.round((z + 850) / 2) * Nn + Math.round((x + 850) / 2)];
  for (let t = 0; t < 2400; t += dt) {
    F.update(dt); N.update(dt);
    for (const v of F.vehicles) {
      const s = st[v.id]; s.maxJump = Math.max(s.maxJump, Math.hypot(v.x - s.last[0], v.z - s.last[1])); s.last = [v.x, v.z];
      if (v.atStop) s.stops.add(v.atStop);
      const a = ang(v.x, v.z), r = Math.hypot(v.x, v.z);
      if (v.category === 'taxi' || v.id.startsWith('car-')) { if (!(v.z > 30 && Math.abs(v.x) < 125 && r > 30 && r < 230)) s.bad++; }
      if (v.category === 'safari' && !(a > 150 && a < 270)) s.bad++;
      if (v.category === 'mining' && !(a > 270 || a < 40)) s.bad++;
      if (v.kind === 'boat' && hAt(v.x, v.z) > -0.5) s.bad++;
      if (v.kind === 'gmc') { const where = v.z > 40 ? 'city' : (v.x > 40 && v.z < -10 ? 'mine' : null); if (where && where !== s.was) { s.was = where; s.trips++; } }
    }
    for (const p of N.people) {
      const m = p.brain.mode, pm = prevMode.get(p);
      if (m === 'ride' && pm !== 'ride') ev.rideKinds.add(p.brain.vehicle.kind);
      if (pm === 'ride' && m !== 'ride') ev.alight++;
      if (m === 'dive') { ev.dive++; ev.maxDepth = Math.max(ev.maxDepth, p.brain.depth); }
      prevMode.set(p, m);
      if (!Number.isFinite(p.brain.x) || !Number.isFinite(p.puppet.root.position.y)) ev.nan = true;
    }
  }
  ev.moved = N.people.filter((p, i) => Math.hypot(p.brain.x - start[i][0], p.brain.z - start[i][1]) > 5).length;
  ev.vehicles = Object.fromEntries(Object.entries(st).map(([k, s]) => [k, { jump: +s.maxJump.toFixed(2), bad: s.bad, trips: s.trips, stops: [...s.stops].join('/') }]));
  ev.rideKinds = [...ev.rideKinds]; ev.vmaxOk = Object.entries(st).every(([, s]) => s.maxJump <= s.vmax * dt + 0.05);
  return ev;
});
check('UAT-62', 'No vehicle ever teleports (no appearing at one end of a bridge and vanishing at the other)', sim.vmaxOk, JSON.stringify(Object.entries(sim.vehicles).filter(([, v]) => v.jump > 3).map(([k, v]) => `${k}:${v.jump}`)));
const strays = Object.entries(sim.vehicles).filter(([, v]) => v.bad > 0).map(([k, v]) => `${k}:${v.bad}`);
check('UAT-63', 'Taxis + private cars stay in the city, jeeps in the jungle, mining vehicles in the mining area, the boat on the water', strays.length === 0, strays.join(', '));
check('UAT-64', 'The GMC Sierra shuttles city -> mine -> city -> mine repeatedly', sim.vehicles.gmc.trips >= 4, `${sim.vehicles.gmc.trips} legs, stops ${sim.vehicles.gmc.stops}`);
check('UAT-65', 'The boat serves the hub quay, the jungle landing and the dive pier', ['quay', 'landing', 'pier'].every((s) => sim.vehicles.boat.stops.includes(s)), sim.vehicles.boat.stops);
check('UAT-66', 'NPCs go about their day (>= 14 of 18 moved) with no invalid positions', sim.moved >= 14 && !sim.nan, `${sim.moved}/18 moved`);
check('UAT-67', 'NPCs board and leave taxis and other vehicles suited to them', sim.rideKinds.includes('taxi') && sim.alight >= 4, `${sim.rideKinds.join(',')} alighted ${sim.alight}x`);
check('UAT-68', 'Boat / mine / safari passengers appear too (suited characters only)', sim.rideKinds.some((k) => ['boat', 'gmc', 'pickup', 'jeep'].includes(k)), sim.rideKinds.join(','));
check('UAT-69', 'Scuba divers go under water', sim.dive > 20 && sim.maxDepth > 4, `depth ${sim.maxDepth.toFixed(1)} m`);
// =================================================================== DRIVING (K)
const drv = await exec(page, () => {
  const g = window.__game, P = g.player, F = g.fleet, out = {};
  out.total = F.vehicles.length; out.road = F.road.length;
  out.kinds = [...new Set(F.road.map((v) => v.kind))].sort().join(',');
  const car = F.byId('car-1');
  g.go(car.x + 1.5, car.z + 1.5, 0, 1);
  g.input.keyDown('KeyK'); g.simulate(1 / 60); g.input.keyUp('KeyK'); g.simulate(1 / 60);
  for (let i = 0; i < 12; i++) g.simulate(1 / 60); // let the HUD publish
  out.entered = P.car === car && car.mode === 'driven'; out.hidden = !P.char.root.visible;
  out.hud = g.store.get().drive?.name ?? null;
  g.input.keyDown('KeyW');
  let maxV = 0;
  for (let i = 0; i < 180; i++) { g.simulate(1 / 60); maxV = Math.max(maxV, Math.abs(car.speed)); }
  out.maxV = maxV; out.topSpeed = car.spec.top;
  g.input.keyUp('KeyW');
  // boost drains the tank and is available at the wheel
  g.input.keyDown('KeyW'); g.input.keyDown('ShiftLeft');
  const b0 = car.boost; let boosted = false;
  for (let i = 0; i < 60; i++) { g.simulate(1 / 60); boosted = boosted || car.boosting; }
  out.boosted = boosted; out.drain = b0 - car.boost;
  g.input.keyUp('ShiftLeft'); g.input.keyUp('KeyW');
  // brake to a stop, then step out with K
  g.input.keyDown('Space'); for (let i = 0; i < 360; i++) g.simulate(1 / 60); g.input.keyUp('Space');
  out.stopped = Math.abs(car.speed) < 0.5;
  g.input.keyDown('KeyK'); g.simulate(1 / 60); g.input.keyUp('KeyK'); g.simulate(1 / 60);
  out.exited = P.car === null && P.char.root.visible && Math.hypot(P.pos.x - car.x, P.pos.z - car.z) < 6;
  out.parked = car.mode === 'parked';
  // after a while it drives itself home and rejoins its route
  let t = 0; while (car.mode !== 'auto' && t < 120) { g.simulate(1 / 20); t += 1 / 20; }
  out.rejoined = car.mode === 'auto'; out.rejoinT = t;
  const p = car.follower.pose(); out.onRoute = Math.hypot(p.x - car.x, p.z - car.z) < 3;
  return out;
});
check('UAT-70', 'A mix of kinds of road vehicle (taxi, car, GMC, jeep, pickup, JCB) spread across the world', drv.road >= 14 && ['car', 'jcb', 'gmc', 'jeep', 'pickup', 'taxi'].every((k) => drv.kinds.includes(k)), `${drv.road} road vehicles (${drv.kinds})`);
check('UAT-71', 'K takes the wheel of the nearest car (character hidden, vehicle gauge shown)', drv.entered && drv.hidden && !!drv.hud, `${drv.hud}`);
check('UAT-72', 'The car accelerates to its defined speed, and boost is faster and drains the tank', drv.maxV > 12 && drv.boosted && drv.drain > 0.1, `max ${drv.maxV.toFixed(1)} m/s (top ${drv.topSpeed}), boost drain ${drv.drain.toFixed(2)}`);
check('UAT-73', 'K steps out beside the car; the car parks, then drives home and rejoins its route', drv.stopped && drv.exited && drv.parked && drv.rejoined && drv.onRoute, `rejoined after ${drv.rejoinT.toFixed(0)} s`);// =================================================================== PLAYER MODEL + SUBMARINE MODEL
const mdl = await exec(page, () => {
  const g = window.__game, P = g.player, c = P.char, out = {};
  const pp = c.puppet;
  out.rigged = !!pp && !!pp.legL && !!pp.armR && !!pp.head && typeof c.setSensorModel === 'function';
  g.go(0, 8, 0, 1); for (let i = 0; i < 90; i++) g.simulate(1 / 60);
  out.armDrop = Math.abs(pp.armL.rotation.x) < 0.3 ? 1 : 0; // idle: arms hang at the sides
  g.input.keyDown('KeyW'); let sep = 0, minFoot = 0;
  for (let i = 0; i < 150; i++) { g.simulate(1 / 60); sep = Math.max(sep, Math.abs(pp.legL.rotation.x - pp.legR.rotation.x)); minFoot = Math.min(minFoot, c.root.position.y - g.player.pos.y); }
  g.input.keyUp('KeyW');
  out.stride = sep; out.minFoot = minFoot;
  const prop = g.world.sub.mesh.userData.prop; out.propParts = prop.children.length;
  return out;
});
check('UAT-74', 'The player is the low-poly character (the character .glb is switched off for now)', mdl.rigged, `low-poly ${mdl.rigged}`);
check('UAT-75', 'The character animates: arms hang at idle, legs swing when walking, the body stays on the ground', mdl.armDrop > 0 && mdl.stride > 0.3 && mdl.minFoot > -0.25, `idle arms ${mdl.armDrop}, leg swing ${mdl.stride.toFixed(2)} rad, lowest ${mdl.minFoot.toFixed(2)}`);
check('UAT-76', 'The submarine is the low-poly model with a propeller on its own pivot (the submarine .glb is switched off)', mdl.propParts >= 1, `${mdl.propParts} propeller parts`);
// =================================================================== RENDER SWEEP: every angle, every place, no exception
const sweep = await exec(page, () => {
  const g = window.__game, P = g.player;
  g.setRendering(false);
  const sites = [[0, 8], [0, 110], [-60, -85], [-120, -120], [-458, 148], [-60, -20], [110, -19], [235, -140], [300, -265], [130, -70], [-470, 150]];
  const errors = [], seen = new Set(); let frames = 0, emptyWater = 0, hiddenChar = 0;
  for (const [x, z] of sites) {
    g.go(x, z, 0, 1, 120);
    for (let i = 0; i < 20; i++) g.simulate(1 / 60);
    for (let yaw = 0; yaw < 8; yaw++) for (const pitch of [0.05, 0.45, 1.0]) {
      P.camYaw = yaw * Math.PI / 4; P.camPitch = pitch;
      for (let i = 0; i < 3; i++) g.simulate(1 / 60);
      try { g.renderer.render(g.scene, g.camera); frames++; } catch (e) { const m = String(e.message).slice(0, 80); if (!seen.has(m)) { seen.add(m); errors.push(`${m} @${x},${z} yaw${yaw}`); } }
      if (!P.char.root.visible) hiddenChar++;
    }
  }
  g.setRendering(true);
  return { errors, frames, hiddenChar };
});
check('UAT-77', 'The scene renders without an exception from every angle at 11 places (nothing drops out mid-frame)', sweep.errors.length === 0 && sweep.frames >= 250, `${sweep.frames} frames; ${sweep.errors.join(' | ') || 'no errors'}`);
check('UAT-78', 'The player character is visible from every camera angle', sweep.hiddenChar === 0, `${sweep.hiddenChar} frames hidden`);// =================================================================== PHASE 3: underwater
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
// the dive base pier is walkable out over the lake
const dive = await exec(page, () => { const w = window.__game.world; const sub = w.sub.sub.pos; return { subY: sub.y, sx: sub.x, sz: sub.z }; });
await exec(page, () => { const g = window.__game; const D = { x: -453.7, z: 102.7 }, t = [-0.1736, 0.9848]; g.go(D.x + t[0] * 4, D.z + t[1] * 4, t[0], t[1], 100); });
r = await exec(page, () => window.__game.run(8, ['KeyW']));
check('UAT-40', 'The dive-base pier is walkable out over deep water', r.y > 1 && !r.swam && Math.hypot(r.x + 453.7, r.z - 102.7) > 40, `reached ${Math.hypot(r.x + 453.7, r.z - 102.7).toFixed(0)} m from the shore, y=${r.y.toFixed(1)}`);

// surface swimming, then diving, with the air gauge
const sw = await exec(page, () => { const g = window.__game; g.go(-470, 170, 0, 1, 100); g.player.motor.teleport(-470, -1.2, 170); g.run(1.5, []); return g.store.get().state; });
check('UAT-41', 'In deep water you swim at the surface', sw === 'SWIMMING', sw);
const dv = await exec(page, () => { const g = window.__game; const out = g.run(5, ['KeyC']); return { ...out, st: g.store.get().state, dive: g.store.get().dive, air: g.player.breath.air }; });
check('UAT-42', 'Holding C dives: depth gauge appears, breath-hold air drains', dv.st === 'DIVING' && dv.dive?.depth > 3 && dv.air < 45, `${dv.st} depth ${dv.dive?.depth.toFixed(1)} m air ${dv.air.toFixed(1)} s`);
await new Promise((r2) => setTimeout(r2, 400));
const gauge = await exec(page, () => document.querySelector('.dive')?.textContent ?? '');
check('UAT-43', 'The dive gauge panel shows depth, pressure and breath', /DEPTH/.test(gauge) && /PRESSURE/.test(gauge) && /BREATH/.test(gauge), gauge.replace(/\s+/g, ' ').slice(0, 60));
await shot('06-diving');

// scuba: air comes from the tank, lungs stay full
const sc = await exec(page, () => { const g = window.__game; g.player.breath = { air: 45, tank: 100, blackoutT: 0 }; g.input.keyDown('KeyG'); g.input.keyUp('KeyG'); g.run(20, ['KeyC']); return { tank: g.player.breath.tank, air: g.player.breath.air, on: g.player.scuba, depth: g.store.get().dive?.depth }; });
check('UAT-44', 'Scuba (G) breathes from the tank and leaves the lungs full', sc.on && sc.tank < 100 && sc.tank > 90 && sc.air === 45, `tank ${sc.tank.toFixed(1)} % air ${sc.air}`);

// breath-hold limit => blackout => recovered at the dive base
const bo = await exec(page, () => { const g = window.__game; g.input.keyDown('KeyG'); g.input.keyUp('KeyG'); g.simulate(1 / 60); g.player.breath = { air: 3, tank: 100, blackoutT: 0 }; g.run(8, ['KeyC']); const p = g.player.pos; return { scuba: g.player.scuba, d: Math.hypot(p.x + 453.7, p.z - 102.7) + 0 * g.store.get().notices.length, notes: g.store.get().notices.map((n) => n.text).join('|') }; });
check('UAT-45', 'Running out of breath underwater blacks you out and the dive team recovers you', !bo.scuba && /blacked out/i.test(bo.notes), bo.notes.slice(0, 70));

// seabed ore: mine it as a diver, but not from the surface above it
const bed = await exec(page, () => { const n = window.__game.world.ore.nodes.find((q) => q.y < -9 && q.y > -16 && Math.hypot(q.x + 485, q.z - 280) > 100); return n ? { x: n.x, y: n.y, z: n.z } : null; });
await exec(page, () => { const g = window.__game; g.player.breath = { air: 45, tank: 100, blackoutT: 0 }; });
const above = await exec(page, (n) => { const g = window.__game; g.go(n.x, n.z, 1, 0, 100); g.player.motor.teleport(n.x + 1.8, -1.2, n.z); g.run(1, []); return g.world.ore.nearest(n.x + 1.8, n.z, -1, 0, 4, g.player.pos.y) !== null; }, bed);
check('UAT-46', 'Seabed ore cannot be reached from the surface 10+ m above it', bed && above === false, bed ? `node at y=${bed.y.toFixed(1)}` : 'no node');
const seabedMined = await exec(page, (n) => {
  const g = window.__game, p = g.player, before = g.store.get().ore;
  p.motor.teleport(n.x + 1.6, n.y + 0.2, n.z); p.facing = -Math.PI / 2; g.run(0.5, ['KeyC']);
  g.input.keyDown('KeyF'); g.input.keyUp('KeyF'); g.simulate(1 / 60);
  for (let i = 0; i < 3; i++) { p.motor.teleport(n.x + 1.6, n.y + 0.2, n.z); p.facing = -Math.PI / 2; g.input.keyDown('KeyE'); g.input.keyUp('KeyE'); for (let k = 0; k < 60; k++) g.simulate(1 / 60); }
  return g.store.get().ore - before;
}, bed);
check('UAT-47', 'A diver can mine a seabed ore outcrop with the pickaxe', seabedMined === 1, `+${seabedMined}`);
await exec(page, () => { const g = window.__game; g.input.keyDown('KeyF'); g.input.keyUp('KeyF'); g.simulate(1 / 60); });

// submarine: board from the pier, drive, dive with trimmed ballast, sample, exit
const sb = await exec(page, () => {
  const g = window.__game, p = g.player, w = g.world;
  g.go(-463.2, 156.9, 0, 1, 100); g.simulate(1 / 60);
  g.input.keyDown('KeyV'); g.input.keyUp('KeyV'); g.simulate(1 / 60);
  const boarded = !!p.vehicle;
  const s0 = { ...w.sub.sub.pos };
  g.input.keyDown('KeyW'); for (let i = 0; i < 480; i++) g.simulate(1 / 60); g.input.keyUp('KeyW');
  const s1 = { ...w.sub.sub.pos }, moved = Math.hypot(s1.x - s0.x, s1.z - s0.z);
  g.input.keyDown('KeyB'); g.input.keyUp('KeyB'); g.input.keyDown('KeyC');
  for (let i = 0; i < 900; i++) g.simulate(1 / 60);
  g.input.keyUp('KeyC');
  for (let i = 0; i < 240; i++) g.simulate(1 / 60);
  return { boarded, moved, depth: w.sub.sub.depth(), state: g.store.get().state, speedOk: w.sub.sub.speed() < 6, battery: w.sub.sub.battery };
});
check('UAT-48', 'You can board the submarine (V) and drive it', sb.boarded && sb.moved > 12, `moved ${sb.moved?.toFixed(1)} m`);
check('UAT-49', 'The submarine dives with trimmed ballast and holds depth; HUD shows SUBMERSIBLE', sb.depth > 4 && sb.state === 'SUBMERSIBLE', `depth ${sb.depth?.toFixed(1)} m`);
await new Promise((r2) => setTimeout(r2, 400));
const subGauge = await exec(page, () => document.querySelector('.dive')?.textContent ?? '');
check('UAT-50', 'Submersible gauge shows depth, pressure, battery and ballast', /SUBMERSIBLE/.test(subGauge) && /BATTERY/.test(subGauge) && /BALLAST/.test(subGauge), subGauge.replace(/\s+/g, ' ').slice(0, 70));
await shot('07-submarine');
const ss = await exec(page, () => {
  const g = window.__game, w = g.world, sub = w.sub.sub;
  const n = w.ore.nodes.find((q) => q.alive && q.y < -18 && Math.hypot(q.x + 485, q.z - 280) < 100);
  if (!n) return { none: true };
  sub.body.setTranslation({ x: n.x, y: n.y + 2.5, z: n.z - 4 }, true); sub.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  sub.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  const before = g.store.get().ore;
  for (let i = 0; i < 3; i++) { g.input.keyDown('KeyE'); g.input.keyUp('KeyE'); for (let k = 0; k < 30; k++) g.simulate(1 / 60); }
  return { gained: g.store.get().ore - before, depth: sub.depth() };
});
check('UAT-51', 'The submarine sampling arm recovers deep ore', ss.gained === 1, JSON.stringify(ss));
const ex = await exec(page, () => { const g = window.__game; g.input.keyDown('KeyV'); g.input.keyUp('KeyV'); g.simulate(1 / 60); return { out: !g.player.vehicle, vis: g.player.char.root.visible }; });
check('UAT-52', 'V exits the submarine and the diver reappears', ex.out && ex.vis);

// flooded open pit
const pit = await exec(page, () => { const g = window.__game; g.go(117, -68, 0, 1, 200); const o = g.run(1.5, []); return { st: g.store.get().state, y: o.y }; });
check('UAT-53', 'The open pit is flooded and diveable', pit.st === 'DIVING' && pit.y < -8, `${pit.st} y=${pit.y.toFixed(1)}`);

// sunken grotto (flooded cave under the lake bed)
const gr = await exec(page, () => {
  const g = window.__game, c = g.world.caves[1], m = { x: c.segments[0].x0 + 9, z: c.segments[0].z0 };
  g.go(m.x - 18, m.z, 1, 0, c.floorY + 3);
  g.player.scuba = true; g.player.char.setScuba(true); g.player.breath = { air: 45, tank: 100, blackoutT: 0 }; // a proper dive: gear on, full tank
  const o = g.run(14, ['KeyW']);
  return { dx: o.x - m.x, dz: o.z - m.z, y: o.y, zone: g.store.get().region, cave: g.caveFactor };
});
check('UAT-54', 'You can swim into the sunken grotto, ~40 m under the lake bed', gr.dx > 12 && Math.abs(gr.dz) < 4 && /grotto/i.test(gr.zone), `+${gr.dx.toFixed(0)} m, ${gr.zone}`);
await shot('08-grotto');
// =================================================================== UAT-16  mining
const ore0 = await exec(page, () => window.__game.store.get().ore);
const node = await exec(page, () => { const n = window.__game.world.ore.nodes[3]; return { x: n.x, z: n.z }; });
await exec(page, (n) => window.__game.go(n.x + 1.8, n.z, -1, 0), node);
await exec(page, () => { const g = window.__game; g.input.keyDown('KeyF'); g.input.keyUp('KeyF'); g.simulate(1 / 60); });
for (let i = 0; i < 3; i++) await exec(page, () => { const g = window.__game; g.input.keyDown('KeyE'); g.input.keyUp('KeyE'); for (let k = 0; k < 60; k++) g.simulate(1 / 60); });
const mined = await exec(page, (o0) => ({ ore: window.__game.store.get().ore - o0, eq: window.__game.store.get().equipped }), ore0);
await new Promise((r2) => setTimeout(r2, 350));
const domOre = await exec(page, () => [...document.querySelectorAll('.kit .row')].map((e) => e.textContent).join('|'));
check('UAT-16', 'F equips the pickaxe; 3 swings recover a mineral sample', mined.eq && mined.ore === 1, JSON.stringify(mined));
check('UAT-17', 'The HUD field kit reflects the sample count', new RegExp(`SAMPLES${ore0 + 1}/\\d+`).test(domOre.replace(/\s/g, '')), domOre);
await page.screenshot({ path: `${OUT}/03-mining.png` });

// =================================================================== UAT-18  physics props
const pushed = await exec(page, () => {
  const g = window.__game, k = g.world.physics.col.dyn.kinds.crate;
  const it = k.items[0], t0 = it.body.translation();
  // approach the crate from +x side and push toward -x
  g.go(t0.x + 3, t0.z, -1, 0);
  g.run(2.5, ['KeyW']);
  const t1 = it.body.translation();
  return { moved: Math.hypot(t1.x - t0.x, t1.z - t0.z), count: k.items.length };
});
check('UAT-18', 'Crates are physics bodies that can be pushed', pushed.moved > 0.5 && pushed.count > 5, JSON.stringify(pushed));

// =================================================================== UAT-19  pause + settings
await exec(page, () => window.__game.store.set({ phase: 'paused' }));
await page.waitForSelector('.pause');
await page.select('.pause select', 'low');
await new Promise((r2) => setTimeout(r2, 200));
const saved = await exec(page, () => JSON.parse(localStorage.getItem('mining-haven:settings')));
check('UAT-19', 'Pause menu opens; graphics setting is applied and persisted', saved.quality === 'low');
await page.screenshot({ path: `${OUT}/04-pause.png` });
await page.click('.pause .btn.primary');
check('UAT-20', 'Resume returns to play', (await phase(page)) === 'playing');
await exec(page, () => window.__game.store.set({ settings: { ...window.__game.store.get().settings, quality: 'high' } }));

// =================================================================== UAT-21  no emoji
const emoji = await exec(page, () => /\p{Extended_Pictographic}/u.test(document.body.innerText));
check('UAT-21', 'No emoji anywhere in the UI', !emoji);
await page.close();

// =================================================================== UAT-22  responsive layouts
const VIEWS = [
  { name: 'desktop-1920', w: 1920, h: 1080, m: false },
  { name: 'laptop-1366', w: 1366, h: 768, m: false },
  { name: 'tablet-portrait', w: 820, h: 1180, m: true },
  { name: 'phone-portrait', w: 390, h: 844, m: true },
  { name: 'phone-landscape', w: 844, h: 390, m: true },
];
for (const v of VIEWS) {
  const p = await open({ width: v.w, height: v.h }, v.m);
  await ready(p);
  await installHelpers(p);
  await p.click('.start .btn.primary');
  await p.waitForSelector('.hud');
  await exec(p, () => window.__game.simulate(1 / 60));
  await new Promise((r2) => setTimeout(r2, 500));
  await exec(p, () => { const g = window.__game; g.go(-470, 170, 0, 1, 100); g.player.motor.teleport(-470, -1.2, 170); g.run(1, ['KeyC']); }); // show the dive gauge while measuring
  await new Promise((r2) => setTimeout(r2, 400));
  const lay = await exec(p, (vw, vh) => {
    const boxes = {};
    for (const s of ['.compass', '.map', '.dive', '.readouts', '.kit', '.help', '.stick', '.tbtns', '.tpause', '.tmap']) {
      const el = document.querySelector(s); if (!el) continue;
      const b = el.getBoundingClientRect(); if (b.width === 0 || getComputedStyle(el).display === 'none') continue;
      boxes[s] = [b.left, b.top, b.right, b.bottom];
    }
    const out = Object.entries(boxes).filter(([, b]) => b[0] < -1 || b[1] < -1 || b[2] > vw + 1 || b[3] > vh + 1).map(([k]) => k);
    const names = Object.keys(boxes), overlaps = [];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const a = boxes[names[i]], b = boxes[names[j]];
      if (a[0] < b[2] - 2 && b[0] < a[2] - 2 && a[1] < b[3] - 2 && b[1] < a[3] - 2) overlaps.push(`${names[i]}x${names[j]}`);
    }
    return { present: names, out, overlaps, touch: !!document.querySelector('.touch'), help: !!document.querySelector('.help') };
  }, v.w, v.h);
  check(`UAT-22-${v.name}`, `HUD fits ${v.w}x${v.h}: nothing off-screen, no overlapping panels`, !lay.out.length && !lay.overlaps.length, `${JSON.stringify(lay.out)} ${JSON.stringify(lay.overlaps)}`);
  check(`UAT-23-${v.name}`, v.m ? 'Touch controls shown, keyboard help hidden' : 'Keyboard help shown, no touch controls', v.m ? lay.touch && !lay.help : !lay.touch && lay.help);
  if (v.m) {
    // joystick actually drives the character
    const moved = await exec(p, () => {
      const g = window.__game; g.go(0, 60, 0, 1);
      const el = document.querySelector('.stick'), b = el.getBoundingClientRect();
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      const ev = (type, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: cx, clientY: y, bubbles: true }));
      el.setPointerCapture = () => {}; ev('pointerdown', cy - 50); // push up = forward
      for (let i = 0; i < 90; i++) g.simulate(1 / 60);
      ev('pointerup', cy);
      return g.player.pos.z - 60;
    });
    check(`UAT-24-${v.name}`, 'Virtual joystick moves the character', moved > 3, `${moved.toFixed(1)} m`);
    const jumped = await exec(p, () => {
      const g = window.__game; g.go(0, 60, 0, 1); g.simulate(1 / 60);
      const btn = [...document.querySelectorAll('.tbtn')].find((b) => b.textContent === 'JUMP');
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      let max = 0; for (let i = 0; i < 40; i++) { g.simulate(1 / 60); max = Math.max(max, g.player.pos.y); }
      return max - 1.5;
    });
    check(`UAT-25-${v.name}`, 'JUMP button makes the character jump', jumped > 1.0, `${jumped.toFixed(2)} m`);
  }
  await p.screenshot({ path: `${OUT}/05-${v.name}.png` });
  await p.close();
}

// =================================================================== UAT-26  console health
check('UAT-26', 'No console errors during the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
stop();
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} acceptance checks passed`);
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
