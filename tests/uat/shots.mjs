// Visual inspection tool:  node tests/uat/shots.mjs shots.json   ->  tests/uat/out/shot-<name>.png
// shots.json: [{ "name": "lake", "x": -400, "z": 100, "yaw": 0.5, "pitch": 0.3, "dist": 10, "fromY": 100, "wait": 1500 }]
import fs from 'node:fs';
import { startServer, launch, openGame, waitReady, installHelpers, enter } from './lib.mjs';

const shots = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
fs.mkdirSync('tests/uat/out', { recursive: true });
const server = await startServer(3102);
const browser = await launch();
const errors = [];
const page = await openGame(browser, server.url, { errors });
const t0 = Date.now();
await waitReady(page);
console.log(`boot ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await installHelpers(page);
await enter(page);
// let the (slow, software) renderer yield so background GLB downloads can finish
await page.evaluate(() => window.__game.setRendering(false));
await page.waitForFunction(() => window.__game.scene.children.some((c) => c.userData.glb?.includes('tanker')) && !!window.__game.fleet.byId('gmc').mesh.children[0]?.userData?.glb && !!window.__game.fleet.byId('taxi-1').mesh.children[0]?.userData?.glb && !!window.__game.fleet.byId('jeep-1').mesh.children[0]?.userData?.glb && !!window.__game.fleet.byId('jcb').mesh.children[0]?.userData?.glb && !!window.__game.fleet.byId('pickup-1').mesh.children[0]?.userData?.glb && window.__game.world.sub.mesh.userData.prop.children.length > 0, { timeout: 150000 }).catch(() => console.log('models not all loaded'));
await page.evaluate(() => window.__game.setRendering(true));
for (const s of shots) {
  await page.evaluate((s) => {
    const g = window.__game;
    g.go(s.x, s.z, Math.sin(s.yaw ?? 0), Math.cos(s.yaw ?? 0), s.fromY);
    if (s.setup) new Function('g', s.setup)(g);
    g.player.camPitch = s.pitch ?? 0.3; g.player.camDist = s.dist ?? 9; g.player.camNow = g.player.camDist;
    for (let i = 0; i < (s.settle ?? 30); i++) g.simulate(1 / 60);
  }, s);
  await new Promise((r) => setTimeout(r, s.wait ?? 1500));
  await page.screenshot({ path: `tests/uat/out/shot-${s.name}.png` });
  console.log('shot', s.name);
}
console.log('DBG', JSON.stringify(await page.evaluate(() => [window.__n, window.__dbg])));
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close(); server.stop();

