// The complete 2D coverage map: survey a few blocks with different sensors, then look at the WORLD COVERAGE tab.
//   node tests/uat/world_coverage.mjs <output dir>      (needs: npx next build)
import { startServer, launch, openGame, waitReady } from './lib.mjs';
const OUT = process.argv[2];
const server = await startServer(3117), browser = await launch(), errors = [];
const page = await openGame(browser, server.url, { viewport: { width: 1400, height: 900 }, mobile: false, errors });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await waitReady(page); await page.click('.start .btn.primary'); await page.waitForSelector('.hud');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const say = (...a) => console.log(...a);
const survey = (sensor, x, z, half, spacing) => ev(({ sensor, x, z, half, spacing }) => {
  const g = window.__game, P = g.player, S = g.survey; S.deploy(sensor, 'hand'); let dir = 1, n = 0;
  for (let lx = -half; lx <= half; lx += spacing, dir = -dir) for (let k = 0; k <= half * 4; k++) { P.teleport(x + lx, z + (dir > 0 ? -half + k * 0.5 : half - k * 0.5), 0); g.simulate(sensor === 'ip' || sensor === 'res' ? 0.5 : 0.12); n++; }
  return { sensor, readings: S.primary(sensor).count };
}, { sensor, x, z, half, spacing });
say(JSON.stringify(await survey('mag', 60, -70, 24, 8)));
say(JSON.stringify(await survey('mag', -90, -40, 24, 8)));
say(JSON.stringify(await survey('gamma', -90, -40, 24, 12)));
say(JSON.stringify(await survey('emi', 60, -70, 24, 12)));
say(JSON.stringify(await survey('ip', 120, 90, 16, 8)));
say('coverage (surface):', JSON.stringify(await ev(() => { const c = window.__game.survey.coverage('surface'); return { surveyableKm2: +(c.area / 1e6).toFixed(2), union: +c.union.pct.toFixed(3), mag: +c.sensors.mag.pct.toFixed(3), gamma: +c.sensors.gamma.pct.toFixed(3), emi: +c.sensors.emi.pct.toFixed(3), ip: +c.sensors.ip.pct.toFixed(3), gpr: +c.sensors.gpr.pct.toFixed(3) }; })));
// open the survey map and the WORLD COVERAGE tab
await ev(() => { window.__game.player.teleport(0, 10, 0); window.__game.store.set({ surveyMap: true }); });
await pause(600);
await ev(() => [...document.querySelectorAll('.smap-bar .seg button')].find((b) => b.textContent === 'WORLD COVERAGE')?.click());
await pause(1500);
await page.screenshot({ path: `${OUT}/coverage-world.png` });
// zoom in on the surveyed blocks (wheel over the canvas)
const box = await ev(() => { const r = document.querySelector('canvas[aria-label="World coverage map"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.move(box.x, box.y);
for (let i = 0; i < 7; i++) { await page.mouse.wheel({ deltaY: -200 }); await pause(120); }
await pause(900);
await page.screenshot({ path: `${OUT}/coverage-zoom.png` });
say('sidebar:', JSON.stringify(await ev(() => [...document.querySelectorAll('.cov-row')].map((r) => r.innerText.replace(/\n/g, ' ')))));
// the cave layer: survey inside the Ridge Mine, then show its plan
await ev(() => { window.__game.store.set({ surveyMap: false }); });
await ev(() => {
  const g = window.__game, S = g.survey, P = g.player, c = g.world.caves[0], M = c.segments[0];
  S.deploy('mag', 'hand');
  for (let k = 0; k <= 200; k++) { const x = M.x0 + 4 + k * 0.5; P.teleport(x, M.z0 + (k % 2 ? 1.2 : -1.2), Math.PI / 2, c.floorY + 2); g.simulate(0.12); }
  for (let k = 0; k <= 80; k++) { const x = M.x0 + 80 + k * 0.5; P.teleport(x, M.z0, Math.PI / 2, c.floorY + 2); g.simulate(0.12); }
  window.__game.store.set({ surveyMap: true });
});
await pause(600);
await ev(() => [...document.querySelectorAll('.smap-bar .seg button')].find((b) => b.textContent === 'WORLD COVERAGE')?.click());
await pause(500);
await ev(() => [...document.querySelectorAll('.smap-side .seg button')].find((b) => b.textContent === 'RIDGE MINE')?.click());
await pause(1500);
await page.screenshot({ path: `${OUT}/coverage-cave.png` });
say('cave coverage:', JSON.stringify(await ev(() => { const c = window.__game.survey.coverage('cave0'); return { areaM2: Math.round(c.area), mag: +c.sensors.mag.pct.toFixed(2), union: +c.union.pct.toFixed(2) }; })));
say('page errors:', errors.length, errors.slice(0, 3));
await browser.close(); server.stop();
