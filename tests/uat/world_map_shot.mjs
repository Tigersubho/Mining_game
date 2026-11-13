// A picture of the whole site map (roads, bridges, water): node tests/uat/world_map_shot.mjs <out.png>   (needs: npx next build)
import { startServer, launch, openGame, waitReady } from './lib.mjs';
const OUT = process.argv[2];
const server = await startServer(3115), browser = await launch(), errors = [];
const page = await openGame(browser, server.url, { viewport: { width: 1000, height: 1000 }, mobile: false, errors });
await waitReady(page); await page.click('.start .btn.primary'); await page.waitForSelector('.hud');
await page.evaluate(() => window.__game.store.set({ mapOpen: true }));
await new Promise((r) => setTimeout(r, 1200));
const box = await page.evaluate(() => { const r = document.querySelector('.map.big .map-body').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
await page.screenshot({ path: OUT, clip: box });
console.log('page errors:', errors.length);
await browser.close(); server.stop();
