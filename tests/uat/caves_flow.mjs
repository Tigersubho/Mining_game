// Ore is hidden, caves are dark, deep ore needs the excavator, and everything shifts every 15 minutes.
//   node tests/uat/caves_flow.mjs <output dir for screenshots>      (needs a production build: npx next build)
import { startServer, launch, openGame, waitReady } from './lib.mjs';
const OUT = process.argv[2];
const server = await startServer(3112), browser = await launch(), errors = [];
const page = await openGame(browser, server.url, { viewport: { width: 1280, height: 720 }, mobile: false, errors });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await waitReady(page); await page.click('.start .btn.primary'); await page.waitForSelector('.hud');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const shot = async (n) => { await pause(500); await page.screenshot({ path: `${OUT}/${n}.png` }); };
const sim = (n, dt = 1 / 20) => ev((n, dt) => { const g = window.__game; for (let i = 0; i < n; i++) g.simulate(dt); }, n, dt);
const say = (...a) => console.log(...a);
/** a clean picture from a free camera (the game is paused for it, the HUD hidden) */
const freeShot = async (name, cam, look) => {
  await ev(() => window.__game.store.set({ phase: 'paused' }));
  await pause(400);
  await ev(({ cam, look }) => { document.querySelectorAll('.screen, .hud, .survey-modal').forEach((e) => { e.style.display = 'none'; }); const c = window.__game.camera; c.position.set(...cam); c.lookAt(...look); c.updateMatrixWorld(); }, { cam, look });
  await pause(800); await page.screenshot({ path: `${OUT}/${name}.png` });
  await ev(() => window.__game.store.set({ phase: 'playing' }));
  await pause(300);
};

// ---------- 1. every outcrop is a plain rock: no mineral colours, no glow, anywhere
say('1 outcrops:', JSON.stringify(await ev(() => {
  const nodes = window.__game.world.ore.nodes; let coloured = 0, emissive = 0, total = 0;
  for (const n of nodes) n.g.children.forEach((m) => { total++; if (m.material.color.getHex() !== 0x6f6a63) coloured++; if (m.material.emissive.getHex() !== 0) emissive++; });
  return { outcrops: nodes.length, meshes: total, coloured, glowing: emissive, inCaves: nodes.filter((n) => window.__game.world.caves.some((c) => c.open(n.x, n.z) && Math.abs(n.y - c.floorY) < 2)).length };
})));

// ---------- 2. a DEEP deposit on open ground: sensors find it, the pickaxe cannot reach it, the excavator opens it
const T = await ev(() => {
  const g = window.__game, S = g.survey, col = g.world.physics.col, P = g.player;
  const clear = (f) => { P.teleport(f.x, f.z, 0); const y = P.pos.y; if (y < 0.8) return false; for (let k = 0; k < 16; k++) if (col.cast(f.x, y + 2.6, f.z, Math.cos(k * Math.PI / 8), 0, Math.sin(k * Math.PI / 8), 11) !== null) return false; return true; };
  const f = S.geo.deposits.filter((d) => d.layer === 'surface' && d.depth > 2.2 && ['copper', 'nickel', 'cobalt', 'graphite'].includes(d.type) && Math.hypot(d.x, d.z) < 520).find(clear) ?? S.geo.features[0];
  return { x: f.x, z: f.z, depth: +f.depth.toFixed(2), type: f.type };
});
say('2 hidden deep target (the player is never told this):', JSON.stringify(T));
const saved = await ev(({ x, z }) => {
  const g = window.__game, P = g.player, S = g.survey; S.deploy('ip', 'hand'); let dir = 1;
  for (let lx = -24; lx <= 24; lx += 6, dir = -dir) for (let k = 0; k <= 96; k++) { P.teleport(x + lx, z + (dir > 0 ? -24 + k * 0.5 : 24 - k * 0.5), 0); g.simulate(0.1); }
  const a = S.anomalies.filter((q) => Math.hypot(q.x - x, q.z - z) < 15).sort((p, q) => q.zscore - p.zscore)[0];
  if (!a) return null;
  const w = S.saveAnomaly(a.id); S.target = w.id; g.simulate(0.2);
  return { title: w.title, estDepth: +w.depth.toFixed(1), off: +Math.hypot(w.x - x, w.z - z).toFixed(1) };
}, T);
say('  surveyed with IP, saved:', JSON.stringify(saved));
const hand = await ev(() => {
  const g = window.__game, P = g.player, S = g.survey, w = S.waypoints[0], out = {};
  P.teleport(w.x - 3, w.z, Math.PI / 2); P.facing = Math.PI / 2; g.simulate(0.3);
  out.hintWithSensor = g.store.get().hint;
  P.setTool('pick', true);
  for (let s = 0; s < 6; s++) { P.char.swingT = -1; P.swing(); for (let i = 0; i < 16; i++) g.simulate(1 / 20); }
  out.finds = S.finds.length; out.onTarget = g.store.get().notices.map((n) => n.text).at(-1);
  // the same dig on ground with nothing under it must read exactly the same (a pickaxe must not work as a detector)
  let bx = w.x + 60, bz = w.z; for (let k = 0; k < 40 && S.geo.bodyAt(bx, bz, 'surface'); k++) bx += 9;
  P.teleport(bx - 1.3, bz, Math.PI / 2); P.facing = Math.PI / 2;
  for (let s = 0; s < 6; s++) { P.char.swingT = -1; P.swing(); for (let i = 0; i < 16; i++) g.simulate(1 / 20); }
  out.onBarren = g.store.get().notices.map((n) => n.text).at(-1); out.sameWords = out.onTarget === out.onBarren;
  P.teleport(w.x - 3, w.z, Math.PI / 2); P.facing = Math.PI / 2; g.simulate(0.3); out.hintAtTarget = g.store.get().hint;
  return out;
});
say('  pickaxe:', JSON.stringify(hand));
await ev(() => window.__game.input.press('callExc')); await sim(2);
say('  Y pressed:', JSON.stringify(await ev(() => { const s = window.__game.store.get(); return { excavator: s.survey.excavator, notice: s.notices.map((n) => n.text).find((t) => /Excavator/.test(t)) }; })));
const E = await ev(() => {
  const g = window.__game, S = g.survey; let n = 0; while (S.exc.state !== 'digging' && n++ < 4000) g.simulate(1 / 20);
  for (let i = 0; i < 20 * 6.4; i++) g.simulate(1 / 20); // into the second scoop: bucket down in the pit
  const e = S.exc, s = e.site, b = e.bucketWorld();
  return { state: e.state, x: e.x, y: e.y, z: e.z, h: e.h, site: [s.x, s.y, s.z], bucketAboveGround: +(b.y - s.y).toFixed(2), bucketFromSite: +Math.hypot(b.x - s.x, b.z - s.z).toFixed(2), hint: g.store.get().hint };
});
say('  digging:', JSON.stringify({ state: E.state, bucketAboveGround: E.bucketAboveGround, bucketFromSite: E.bucketFromSite, hint: E.hint }));
{ // side-on and three-quarter views of the machine at work
  const side = [Math.cos(E.h), -Math.sin(E.h)], fwd = [Math.sin(E.h), Math.cos(E.h)], mid = [E.x + fwd[0] * 3.2, E.y + 1.4, E.z + fwd[1] * 3.2];
  await freeShot('02-excavator-side', [mid[0] - side[0] * 13, E.y + 3.2, mid[2] - side[1] * 13], mid);
  await sim(20 * 2.2); // ... and with the load lifted, swinging to the heap
  await freeShot('03-excavator-swing', [E.x - fwd[0] * 6 - side[0] * 10, E.y + 5.5, E.z - fwd[1] * 6 - side[1] * 10], mid);
}
await ev(() => { const g = window.__game, S = g.survey; let n = 0; while (S.exc.state === 'digging' && n++ < 4000) g.simulate(1 / 20); });
say('  after the dig:', JSON.stringify(await ev(() => { const g = window.__game, S = g.survey; return { state: S.exc.state, finds: S.finds.map((f) => ({ type: f.type, amount: f.amount })), notice: g.store.get().notices.map((n) => n.text).find((t) => /CONFIRMED|No ore|Barren/.test(t)) }; })));
{ const s = E.site, fwd = [Math.sin(E.h), Math.cos(E.h)]; await freeShot('04-ore-exposed', [s[0] + fwd[0] * 5 + 2, s[1] + 3.2, s[2] + fwd[1] * 5 + 2], [s[0], s[1], s[2]]); }
say('  collected:', JSON.stringify(await ev(() => {
  const g = window.__game, P = g.player, S = g.survey, f = S.finds[0]; if (!f) return 'no find';
  P.teleport(f.x - 1.5, f.z, Math.PI / 2); P.facing = Math.PI / 2; P.setTool('pick', true); const before = g.store.get().ore;
  for (let s = 0; s < 8; s++) { P.char.swingT = -1; P.swing(); for (let i = 0; i < 16; i++) g.simulate(1 / 20); }
  return { before, after: g.store.get().ore, samples: g.store.get().samples };
})));

// ---------- 3. a SHALLOW surface deposit: the pickaxe is enough
say('3 shallow deposit by pickaxe:', JSON.stringify(await ev(() => {
  const g = window.__game, S = g.survey, P = g.player, f = S.geo.deposits.find((d) => d.layer === 'surface' && d.depth <= 1.3 && Math.hypot(d.x, d.z) < 260);
  P.teleport(f.x - 1.3, f.z, Math.PI / 2); P.facing = Math.PI / 2; P.setTool('pick', true); const n0 = S.finds.length;
  for (let s = 0; s < 10 && S.finds.length === n0; s++) { P.char.swingT = -1; P.swing(); for (let i = 0; i < 16; i++) g.simulate(1 / 20); }
  return { type: f.type, depth: +f.depth.toFixed(2), opened: S.finds.length > n0 };
})));

// ---------- 4. the dry cave: dark until the headlamp is on; sensors find the ore in the rock; dug by hand
const C = await ev(() => {
  const g = window.__game, S = g.survey, P = g.player, c = g.world.caves[0];
  const f = S.geo.features.filter((q) => q.layer === 'cave0' && q.kind === 'deposit' && q.props.ip > 8).sort((a, b) => a.x - b.x)[1];
  if (P.lamp.on) P.toggleHeadlamp();
  P.teleport(f.x - 20, f.z, Math.PI / 2, c.floorY + 2); P.facing = Math.PI / 2; P.camYaw = Math.PI / 2 + Math.PI; P.camPitch = 0.12;
  for (let i = 0; i < 80; i++) g.simulate(1 / 30);
  return { x: f.x, z: f.z, type: f.type, depth: +f.depth.toFixed(2), hint: g.store.get().hint, region: g.store.get().region, lamp: g.store.get().lamp };
});
say('4 cave, lamp off:', JSON.stringify({ hint: C.hint, region: C.region, lamp: C.lamp }));
await shot('05-cave-lamp-off');
await ev(() => window.__game.input.press('lights')); await sim(50, 1 / 30);
await shot('06-cave-lamp-on');
say('  cave survey:', JSON.stringify(await ev(({ x, z }) => {
  const g = window.__game, S = g.survey, P = g.player, c = g.world.caves[0];
  S.deploy('ip', 'hand');
  for (const dz of [-1.8, 0, 1.8]) for (let k = 0; k <= 80; k++) { const px = x - 20 + k * 0.5, pz = z + dz; if (!c.open(px, pz)) continue; P.teleport(px, pz, Math.PI / 2, c.floorY + 2); g.simulate(0.6); }
  const hit = S.anomalies.filter((a) => a.layer === 'cave0' && Math.hypot(a.x - x, a.z - z) < 8);
  return { layer: S.layer, lamp: P.lamp.on, readings: S.primary('ip').count, found: hit.map((a) => `${a.title} ${a.intensity}% ${Math.hypot(a.x - x, a.z - z).toFixed(1)} m off`), excavatorRefused: (S.callExcavator(), g.store.get().notices.map((n) => n.text).at(-1)) };
}, C)));
say('  dug by hand in the cave:', JSON.stringify(await ev(({ x, z }) => {
  const g = window.__game, S = g.survey, P = g.player, c = g.world.caves[0], n0 = S.finds.length;
  P.teleport(x - 1.4, z, Math.PI / 2, c.floorY + 2); P.facing = Math.PI / 2; P.camYaw = Math.PI / 2 + Math.PI; P.setTool('pick', true);
  for (let s = 0; s < 10 && S.finds.length === n0; s++) { P.char.swingT = -1; P.swing(); for (let i = 0; i < 16; i++) g.simulate(1 / 20); }
  return { opened: S.finds.length > n0, find: S.finds.at(-1)?.type, notice: g.store.get().notices.map((n) => n.text).at(-1) };
}, C)));
await shot('07-cave-ore-exposed');

// ---------- 5. under water: the flooded grotto and the lake bed, scuba + headlamp
await ev(() => { const g = window.__game, c = g.world.caves[1], M = c.segments[0], P = g.player; if (!P.scuba) P.toggleScuba(); if (!P.lamp.on) P.toggleHeadlamp(); P.setTool('pick', false); P.teleport(M.x0 + 24, M.z0, Math.PI / 2, c.floorY + 2); P.camYaw = Math.PI / 2 + Math.PI; P.camPitch = 0.1; });
await sim(70, 1 / 30);
say('5 grotto:', JSON.stringify(await ev(() => { const s = window.__game.store.get(), P = window.__game.player; return { water: P.water, depth: +(s.dive?.depth ?? 0).toFixed(1), region: s.region, lamp: s.lamp.on, layer: window.__game.survey.layerNow() }; })));
await shot('08-grotto-lamp-on');
await ev(() => window.__game.input.press('lights')); await sim(50, 1 / 30);
say('  grotto, lamp off -> hint:', await ev(() => window.__game.store.get().hint));
await shot('09-grotto-lamp-off');
await ev(() => window.__game.input.press('lights')); await sim(10, 1 / 30);
say('  lake bed:', JSON.stringify(await ev(() => {
  const g = window.__game, S = g.survey, P = g.player, n0 = S.finds.length;
  const f = S.geo.features.filter((q) => q.layer === 'water' && q.props.ip > 8).sort((a, b) => Math.hypot(a.x + 485, a.z - 280) - Math.hypot(b.x + 485, b.z - 280))[0];
  const bed = (x, z) => g.world.physics.col.groundY(x, z, 5, P.motor.body) ?? -20;
  P.teleport(f.x - 8, f.z, Math.PI / 2, 5); for (let i = 0; i < 40; i++) g.simulate(1 / 20);
  const out = { type: f.type, bedDepth: +(-0.2 - bed(f.x, f.z)).toFixed(1), water: P.water, layer: S.layerNow() };
  S.deploy('ip', 'hand');
  for (const dz of [-4, -2, 0, 2, 4]) for (let k = 0; k <= 32; k++) { const x = f.x - 8 + k * 0.5, z = f.z + dz; P.motor.teleport(x, bed(x, z) + 0.05, z); g.simulate(0.5); }
  out.readings = S.primary('ip').count; out.diving = P.water;
  out.found = S.anomalies.filter((a) => a.layer === 'water' && Math.hypot(a.x - f.x, a.z - f.z) < 6).map((a) => `${a.title} ${a.intensity}%`);
  P.motor.teleport(f.x - 1.4, bed(f.x - 1.4, f.z) + 0.05, f.z); P.facing = Math.PI / 2; P.setTool('pick', true); for (let i = 0; i < 6; i++) g.simulate(1 / 20);
  for (let s = 0; s < 10 && S.finds.length === n0; s++) { P.char.swingT = -1; P.swing(); for (let i = 0; i < 16; i++) g.simulate(1 / 20); }
  out.opened = S.finds.length > n0; out.find = S.finds.at(-1)?.type;
  return out;
})));

// ---------- 6. the shift
say('6 after 15 minutes of play:', JSON.stringify(await ev(() => {
  const g = window.__game, S = g.survey; g.player.respawn();
  const before = S.geo.deposits.map((d) => `${Math.round(d.x)},${Math.round(d.z)}`), was = { anomalies: S.anomalies.length, saved: S.waypoints.length, pits: S.excavations.length };
  let warned = false; const t0 = g.spread.left;
  for (let i = 0; i < 20 * (t0 + 2); i++) { g.simulate(1 / 20); if (!warned && g.store.get().notices.some((n) => /one minute/.test(n.text))) warned = true; }
  const after = S.geo.deposits.map((d) => `${Math.round(d.x)},${Math.round(d.z)}`);
  return { epoch: g.spread.epoch, depositsInTheSamePlace: after.filter((k) => before.includes(k)).length, of: after.length, oneMinuteWarning: warned, was, now: { anomalies: S.anomalies.length, saved: S.waypoints.length, pits: S.excavations.length }, clock: Math.round(g.spread.left) };
})));
say('page errors:', errors.length, errors.slice(0, 4));
await browser.close(); server.stop();
