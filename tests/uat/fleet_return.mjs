import { startServer, launch, openGame, waitReady } from './lib.mjs';
const server = await startServer(3109), browser = await launch(), errors = [];
const page = await openGame(browser, server.url, { viewport: { width: 800, height: 450 }, mobile: false, errors });
await waitReady(page);
await page.click('.start .btn.primary'); await page.waitForSelector('.hud');
const log = await page.evaluate(() => {
  const g = window.__game, F = g.fleet, v = F.byId('tour-edge-2'), out = [];
  g.player.teleport(-300, 5, 0); F.observer = { x: -300, z: 5 };
  const c = Math.cos(330 * Math.PI / 180), s = Math.sin(330 * Math.PI / 180);
  v.x = c * 110; v.z = s * 110; v.h = Math.PI; v.mode = 'driven'; v.speed = 0; F.release(v);
  out.push(`start ${v.x.toFixed(0)},${v.z.toFixed(0)} (construction side, across the river from the hub)`);
  let minY = 99, lastWay = -1;
  for (let i = 0; i < 200 * 20; i++) {
    g.simulate(1 / 20); minY = Math.min(minY, v.y);
    if (v.way.length !== lastWay || i % 200 === 0) { lastWay = v.way.length; out.push(`${(i / 20).toFixed(0)}s mode=${v.mode} pos=${v.x.toFixed(0)},${v.z.toFixed(0)} y=${v.y.toFixed(2)} waypoints=${v.way.length} reloc=${v.relocations}`); }
    if (v.mode === 'auto' && i > 200) { out.push(`REJOINED its route after ${(i / 20).toFixed(0)}s at ${v.x.toFixed(0)},${v.z.toFixed(0)}; relocations=${v.relocations}; lowest y on the way ${minY.toFixed(2)}`); break; }
  }
  return out;
});
console.log(log.join('\n'));
await browser.close(); server.stop();
