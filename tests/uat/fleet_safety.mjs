import { startServer, launch, openGame, waitReady } from './lib.mjs';
const out = process.argv[2];
const server = await startServer(3102), browser = await launch(), errors = [];
const page = await openGame(browser, server.url, { viewport: { width: 1280, height: 720 }, mobile: false, errors });
await waitReady(page);
console.log('boot error:', await page.evaluate(() => window.__game.store.get().error));
await page.click('.start .btn.primary'); await page.waitForSelector('.hud');
const r = await page.evaluate(() => {
  const g = window.__game, F = g.fleet, res = { minY: {}, onDeck: {}, maxY: {}, samples: 0 };
  for (const v of F.road) { res.minY[v.id] = 1e9; res.maxY[v.id] = -1e9; }
  const T = 900; // simulated seconds
  for (let i = 0; i < T * 20; i++) {
    g.simulate(1 / 20);
    if (i % 10 === 0) { res.samples++; for (const v of F.road) { res.minY[v.id] = Math.min(res.minY[v.id], v.y); res.maxY[v.id] = Math.max(res.maxY[v.id], v.y); } }
  }
  res.reloc = Object.fromEntries(F.road.map((v) => [v.id, v.relocations]));
  res.modes = Object.fromEntries(F.road.map((v) => [v.id, v.mode]));
  res.pos = F.road.map((v) => `${v.id}:${v.x.toFixed(0)},${v.z.toFixed(0)}`);
  return res;
});
console.log('samples', r.samples);
console.log('minY', JSON.stringify(Object.fromEntries(Object.entries(r.minY).map(([k, v]) => [k, +v.toFixed(2)]))));
console.log('maxY', JSON.stringify(Object.fromEntries(Object.entries(r.maxY).map(([k, v]) => [k, +v.toFixed(2)]))));
console.log('relocations', JSON.stringify(r.reloc), 'modes', JSON.stringify(r.modes));

// ---- the player abandons a car in a bad place: drive one to the river bank, leave it, watch it come home via a bridge
const t = await page.evaluate(() => {
  const g = window.__game, F = g.fleet, P = g.player;
  const v = F.byId('tour-edge-2');
  // put the car on the OTHER side of the Y-river from its route, on dry ground, then hand it back to the AI
  v.x = 150; v.z = -40; v.h = 0; v.mode = 'driven'; F.release(v);
  const log = [];
  for (let i = 0; i < 160 * 20; i++) {
    g.simulate(1 / 20);
    if (i % 100 === 0) log.push(`${(i / 20).toFixed(0)}s ${v.mode} ${v.x.toFixed(0)},${v.z.toFixed(0)} y${v.y.toFixed(1)} way${v.way.length} reloc${v.relocations}`);
    if (v.mode === 'auto' && i > 200) { log.push(`back on route after ${(i / 20).toFixed(0)}s at ${v.x.toFixed(0)},${v.z.toFixed(0)} reloc${v.relocations}`); break; }
  }
  return log;
});
console.log(t.join('\n'));
// a car dropped in the river is put back on dry road
const w = await page.evaluate(() => {
  const g = window.__game, F = g.fleet, v = F.byId('taxi-1');
  v.mode = 'driven'; v.x = 200 * Math.cos(30 * Math.PI / 180); v.z = 200 * Math.sin(30 * Math.PI / 180); // on the 30deg river branch
  F.release(v); const y0 = v.y; g.simulate(1 / 20); g.simulate(1 / 20);
  return { mode: v.mode, pos: [v.x, v.z].map((a) => +a.toFixed(0)), reloc: v.relocations };
});
console.log('car dropped in the river ->', JSON.stringify(w));
// hub screenshot from above
await page.evaluate(() => { const g = window.__game; g.player.teleport(0, 0, 0); g.simulate(1 / 60); const c = g.camera; c.position.set(30, 38, 52); c.lookAt(0, 0, 0); });
await new Promise((r) => setTimeout(r, 600));
await page.evaluate(() => { const c = window.__game.camera; c.position.set(30, 38, 52); c.lookAt(0, 0, 0); });
await page.screenshot({ path: out });
console.log('page errors:', errors.length, errors.slice(0, 5));
await browser.close(); server.stop();
