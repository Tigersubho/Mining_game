import { startServer, launch, openGame, waitReady } from './lib.mjs';
const OUT = process.argv[2];
const server = await startServer(3110), browser = await launch(), errors = [];
const page = await openGame(browser, server.url, { viewport: { width: 1360, height: 800 }, mobile: false, errors });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await waitReady(page);
await page.click('.start .btn.primary'); await page.waitForSelector('.hud');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const press = (code) => page.evaluate((c) => { const g = window.__game; g.input.keyDown(c); g.input.keyUp(c); }, code);
const step = (n, dt = 1 / 20) => page.evaluate((n, dt) => { const g = window.__game; for (let i = 0; i < n; i++) g.simulate(dt); }, n, dt);
const shot = async (name) => { await pause(350); await page.screenshot({ path: `${OUT}/${name}.png` }); };
const say = (...a) => console.log(...a);
const ev = (fn, ...a) => page.evaluate(fn, ...a);

// ------------------------------------------------------------ 1. equipment menu (U)
await press('KeyU'); await step(2);
say('menu open:', await ev(() => window.__game.store.get().surveyMenu), '| sensor cards:', await ev(() => document.querySelectorAll('.sm-item').length));
await shot('01-menu-mag');
for (const i of [0, 2, 3, 4, 5, 6, 1]) { await ev((i) => document.querySelectorAll('.sm-item')[i].click(), i); await pause(150); }
await ev(() => document.querySelectorAll('.sm-item')[5].click()); await shot('02-menu-ip');
await ev(() => document.querySelectorAll('.sm-item')[1].click()); await pause(150);
await ev(() => document.querySelector('.sm-actions .btn.primary').click()); await step(3);
say('deployed:', JSON.stringify(await ev(() => { const s = window.__game.survey, P = window.__game.player; return { sensor: s.sensor, mode: s.mode, tool: s.tool, equipped: P.equipped, charTool: P.char.tool, menuOpen: window.__game.store.get().surveyMenu, handModelAttached: !!P.char.sensor?.parent }; })));
await shot('03-hand-mag-equipped');

// ------------------------------------------------------------ 2. hand survey: zig-zag lines over the guaranteed copper deposit
const target = await ev(() => { const f = window.__game.survey.geo.features[0]; return { x: f.x, z: f.z, type: f.type, depth: f.depth, R: f.R }; });
say('hidden target (not shown to the player):', JSON.stringify(target));
const survey = (sensor, mode) => ev(({ x, z }, sensor, mode) => {
  const g = window.__game, P = g.player, S = g.survey;
  if (S.sensor !== sensor || S.mode !== mode) S.deploy(sensor, mode);
  let n = 0, dir = 1;
  for (let lx = -40; lx <= 40; lx += 8, dir = -dir) {
    for (let k = 0; k <= 160; k++) { const lz = dir > 0 ? -40 + k * 0.5 : 40 - k * 0.5; P.teleport(x + lx, z + lz, dir > 0 ? Math.PI : 0); g.simulate(0.1); n++; }
  }
  const st = g.store.get().survey;
  return { sensor, steps: n, readings: S.primary(sensor).count, anomalies: S.anomalies.filter((a) => a.sensor === sensor).length, coverage: +(st.coverage * 100).toFixed(0), status: st.status };
}, target, sensor, mode);
say('MAG zig-zag:', JSON.stringify(await survey('mag', 'hand')));
await press('KeyZ'); await step(2);
await ev(() => { /* the map follows the player; show the whole block */ });
await shot('04-map-mag');
// profile tab
await ev(() => [...document.querySelectorAll('.smap-bar .seg button')].find((b) => b.textContent === 'LINE PROFILE')?.click()); await shot('05-profile-mag');
await ev(() => [...document.querySelectorAll('.smap-bar .seg button')].find((b) => b.textContent === 'PLAN MAP')?.click());
await press('KeyZ'); await step(2);

// ------------------------------------------------------------ 3. other instruments over the same block
for (const s of ['ip', 'emi', 'gamma', 'res', 'gpr', 'seis']) say(`${s.toUpperCase()} zig-zag:`, JSON.stringify(await survey(s, 'hand')));
for (const s of ['ip', 'gamma', 'gpr', 'seis']) {
  await ev((s) => { const S = window.__game.survey; S.sensor = s; S.mode = 'hand'; }, s);
  await press('KeyZ'); await step(2);
  await ev((s) => { const b = [...document.querySelectorAll('.smap-bar .seg button')].find((b) => b.textContent === s.toUpperCase().replace('GAMMA', 'GRS').replace('RES', 'ERT').replace('SEIS', 'SEIS')); b?.click(); }, s);
  await shot(`06-map-${s}`);
  await ev(() => [...document.querySelectorAll('.smap-bar .seg button')].find((b) => b.textContent === 'LINE PROFILE')?.click()); await shot(`07-profile-${s}`);
  await ev(() => [...document.querySelectorAll('.smap-bar .seg button')].find((b) => b.textContent === 'PLAN MAP')?.click());
  await press('KeyZ'); await step(2);
}

// ------------------------------------------------------------ 4. interpretation + save + navigate + dig
const found = await ev(({ x, z }) => {
  const S = window.__game.survey;
  const near = S.anomalies.filter((a) => Math.hypot(a.x - x, a.z - z) < 20);
  return { total: S.anomalies.length, nearTarget: near.map((a) => `${a.sensor}/${a.ch} z${a.zscore.toFixed(1)} i${a.intensity}% off${Math.hypot(a.x - x, a.z - z).toFixed(1)}m depth~${a.depth.toFixed(1)}`) };
}, target);
say('anomalies:', JSON.stringify(found));
const saved = await ev(({ x, z }) => {
  const S = window.__game.survey, g = window.__game;
  const a = S.anomalies.filter((q) => q.sensor === 'ip' && Math.hypot(q.x - x, q.z - z) < 20).sort((p, q) => q.zscore - p.zscore)[0] ?? S.anomalies.filter((q) => Math.hypot(q.x - x, q.z - z) < 20)[0];
  if (!a) return null;
  const w = S.saveAnomaly(a.id); S.target = w.id; g.simulate(0.2);
  return { title: w.title, text: w.text, confidence: w.confidence, sensors: w.sensors, targets: w.targets, at: [+w.x.toFixed(1), +w.z.toFixed(1)] };
}, target);
say('saved waypoint:', JSON.stringify(saved));
// the normal map must show it
await ev(() => { window.__game.store.set({ mapOpen: true }); }); await step(2); await shot('08-normal-map-with-marker');
await ev(() => { window.__game.store.set({ mapOpen: false }); });
// walk to it, swap to the pickaxe, dig until it opens
const dig = await ev(() => {
  const g = window.__game, S = g.survey, P = g.player, w = S.waypoints[0], out = [];
  P.teleport(w.x - 3, w.z, Math.PI / 2); g.simulate(0.2);
  const hint = g.store.get().hint; out.push(`hint near target: "${hint}"`);
  P.swapTool(); out.push(`tool now ${S.tool}, equipped ${P.equipped}`);
  P.facing = Math.PI / 2;
  for (let swing = 0; swing < 14; swing++) {
    P.char.swingT = -1; P.swing(); for (let i = 0; i < 16; i++) g.simulate(1 / 20);
    if (S.finds.length) break;
  }
  const st = g.store.get();
  out.push(`digs ${S.excavations.length}, finds ${S.finds.length}: ${JSON.stringify(S.finds.map((f) => ({ type: f.type, amount: f.amount, host: f.host })))}`);
  out.push(`notices: ${st.notices.map((n) => n.text).join(' | ')}`);
  return out;
});
say(dig.join('\n'));
// collect the exposed ore
const coll = await ev(() => {
  const g = window.__game, P = g.player, S = g.survey, f = S.finds[0]; if (!f) return 'no find';
  P.teleport(f.x - 1.5, f.z, Math.PI / 2); P.facing = Math.PI / 2; const before = g.store.get().ore;
  for (let s = 0; s < 8; s++) { P.char.swingT = -1; P.swing(); for (let i = 0; i < 16; i++) g.simulate(1 / 20); }
  const st = g.store.get(); return { oreBefore: before, oreAfter: st.ore, samples: st.samples };
});
say('collected:', JSON.stringify(coll));
await shot('09-after-dig-hud');

// ------------------------------------------------------------ 5. rover
const rov = await ev(({ x, z }) => {
  const g = window.__game, P = g.player, S = g.survey;
  P.teleport(x - 50, z - 50, 0);
  S.deploy('mag', 'rover'); g.simulate(0.2);
  const d = Math.hypot(S.rover.x - P.pos.x, S.rover.z - P.pos.z), out = { deployedDist: +d.toFixed(1), mounted: S.rover.sensor };
  g.input.press('drive'); g.simulate(0.1);
  out.driving = P.car === S.rover; return out;
}, target);
say('rover:', JSON.stringify(rov));
await ev(() => { const g = window.__game; g.input.keyDown('KeyW'); for (let i = 0; i < 20 * 14; i++) g.simulate(1 / 20); g.input.keyUp('KeyW'); });
say('rover after driving:', JSON.stringify(await ev(() => { const g = window.__game, S = g.survey, st = g.store.get().survey; return { x: +S.rover.x.toFixed(0), z: +S.rover.z.toFixed(0), speed: +S.rover.speed.toFixed(1), terrain: S.rover.terrain.label, status: st.status, readingsMag: S.primary('mag').count, tracks: S.tracks.length }; })));
await shot('10-rover-driving');
await press('KeyK'); await step(2);

// ------------------------------------------------------------ 6. drone
const dr = await ev(({ x, z }) => {
  const g = window.__game, P = g.player, S = g.survey;
  P.teleport(x - 60, z - 60, 0);
  S.deploy('mag', 'drone'); g.simulate(0.2);
  const out = { droneDeployed: S.drone.deployed, mounted: S.drone.sensor, hint: g.store.get().hint };
  g.input.press('drive'); g.simulate(0.1); out.possessed = !!P.drone; out.state = S.drone.state; return out;
}, target);
say('drone launch:', JSON.stringify(dr));
await ev(() => { const g = window.__game, I = g.input; I.keyDown('Space'); for (let i = 0; i < 20 * 4; i++) g.simulate(1 / 20); I.keyUp('Space'); I.keyDown('KeyW'); for (let i = 0; i < 20 * 10; i++) g.simulate(1 / 20); I.keyUp('KeyW'); });
say('drone flying:', JSON.stringify(await ev(() => { const g = window.__game, S = g.survey, d = S.drone, st = g.store.get().survey; return { alt: +d.agl.toFixed(1), speed: +Math.hypot(d.vx, d.vz).toFixed(1), battery: +d.battery.toFixed(1), status: st.status, readings: S.primary('mag').count, droneActive: st.drone?.active }; })));
await shot('11-drone-views');
// fly a real line over the deposit so the scanner / 2.5D have an anomaly in view
await ev(({ x, z }) => { const g = window.__game, d = g.survey.drone; d.x = x; d.z = z - 30; d.yaw = Math.PI; for (let i = 0; i < 20 * 3; i++) g.simulate(1 / 20); }, target);
await shot('12-drone-over-target');
await press('KeyO'); await step(60);
say('drone off:', JSON.stringify(await ev(() => { const g = window.__game, S = g.survey, d = S.drone; return { control: g.player.drone === null ? 'character' : 'drone', droneState: d.state, dataKept: S.primary('mag').count, anomalies: S.anomalies.length, waypoints: S.waypoints.length }; })));
await shot('13-back-to-character');
say('page errors:', errors.length, errors.slice(0, 6));
await browser.close(); server.stop();
