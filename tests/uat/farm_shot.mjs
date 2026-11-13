// Pictures of the farms and the new roads: node tests/uat/farm_shot.mjs <output dir>   (needs: npx next build)
import { startServer, launch, openGame, waitReady } from './lib.mjs';
const OUT = process.argv[2];
const server = await startServer(3116), browser = await launch(), errors = [];
const page = await openGame(browser, server.url, { viewport: { width: 1280, height: 720 }, mobile: false, errors });
await waitReady(page); await page.click('.start .btn.primary'); await page.waitForSelector('.hud');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const info = await ev(() => {
  const g = window.__game, F = g.farmers, fleet = g.fleet;
  return { farmers: F.people.length, perFarm: [...new Set(F.people.map((p) => p.farm))].length, tractors: fleet.vehicles.filter((v) => v.kind === 'tractor').map((v) => `${v.id}@${v.x.toFixed(0)},${v.z.toFixed(0)}`), idleCars: fleet.road.filter((v) => v.category !== 'farm').length };
});
console.log(JSON.stringify(info));
for (const idx of [1, 4]) {
  const place = await ev((idx) => {
    const g = window.__game, P = g.player, farms = [...new Set(g.farmers.people.map((p) => p.farm))];
    const w = g.farmers.people.find((p) => p.farm === farms[Math.min(idx, farms.length - 1)]), f = w.f;
    P.teleport(f.x0 + 20, f.z0 + 80, 0); for (let i = 0; i < 20 * 25; i++) g.simulate(1 / 20);
    return { farm: w.farm, x: f.x0, z: f.z0, farmer: [w.x, w.z], state: w.state };
  }, idx);
  console.log(JSON.stringify(place));
  await ev(() => window.__game.store.set({ phase: 'paused' })); await pause(400);
  for (const [name, off, up] of [['over', [30, 40], 38], ['field', [-14, 12], 5]]) {
    await ev(({ place, off, up }) => { document.querySelectorAll('.screen, .hud').forEach((e) => { e.style.display = 'none'; }); const c = window.__game.camera; c.position.set(place.x + 36 + off[0], 1.5 + up + 6, place.z + 40 + off[1]); c.lookAt(place.x + 36, 2, place.z + 36); c.updateMatrixWorld(); }, { place, off, up });
    await pause(900); await page.screenshot({ path: `${OUT}/farm${idx}-${name}.png` });
  }
  await ev(() => window.__game.store.set({ phase: 'playing' })); await pause(300);
}
console.log('page errors:', errors.length);
await browser.close(); server.stop();
