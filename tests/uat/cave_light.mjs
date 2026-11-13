// Pictures of the caves with the lamp off and on: node tests/uat/cave_light.mjs <output dir>   (needs: npx next build)
import { startServer, launch, openGame, waitReady } from './lib.mjs';
const OUT = process.argv[2];
const server = await startServer(3114), browser = await launch(), errors = [];
const page = await openGame(browser, server.url, { viewport: { width: 1280, height: 720 }, mobile: false, errors });
await waitReady(page); await page.click('.start .btn.primary'); await page.waitForSelector('.hud');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const sim = (n, dt = 1 / 30) => ev((n, dt) => { const g = window.__game; for (let i = 0; i < n; i++) g.simulate(dt); }, n, dt);
const shot = async (name) => { await pause(500); await ev(() => document.querySelectorAll('.hud').forEach((e) => { e.style.opacity = '0.0'; })); await page.screenshot({ path: `${OUT}/${name}.png` }); await ev(() => document.querySelectorAll('.hud').forEach((e) => { e.style.opacity = '1'; })); };
const into = (i, dx, scuba) => ev(({ i, dx, scuba }) => {
  const g = window.__game, c = g.world.caves[i], M = c.segments[0], P = g.player;
  if (scuba && !P.scuba) P.toggleScuba(); if (!scuba && P.scuba) P.toggleScuba();
  P.teleport(M.x0 + dx, M.z0, Math.PI / 2, c.floorY + 2); P.facing = Math.PI / 2; P.camYaw = Math.PI / 2 + Math.PI; P.camPitch = 0.1;
  for (let k = 0; k < 90; k++) g.simulate(1 / 30);
}, { i, dx, scuba });
const setLamp = (on) => ev((on) => { const P = window.__game.player; if (P.lamp.on !== on) P.toggleHeadlamp(); for (let k = 0; k < 40; k++) window.__game.simulate(1 / 30); }, on);
await into(0, 30, false); await setLamp(false); await shot('mine-lamp-off');
await setLamp(true); await shot('mine-lamp-on');
await into(1, 30, true); await setLamp(false); await shot('grotto-lamp-off');
await setLamp(true); await shot('grotto-lamp-on');
console.log('page errors:', errors.length);
await browser.close(); server.stop();
