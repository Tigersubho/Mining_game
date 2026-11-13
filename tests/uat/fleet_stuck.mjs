import { startServer, launch, openGame, waitReady } from './lib.mjs';
const server = await startServer(3106), browser = await launch(), errors = [];
const page = await openGame(browser, server.url, { viewport: { width: 800, height: 450 }, mobile: false, errors });
await waitReady(page);
await page.click('.start .btn.primary'); await page.waitForSelector('.hud');
const log = await page.evaluate(() => {
  const g = window.__game, F = g.fleet, col = g.world.physics.col, v = F.byId('taxi-3'), out = [];
  g.player.teleport(-300, 5, 0); // far away: recovery must not happen in view
  F.observer = { x: -300, z: 5 };
  for (let i = 0; i < 40; i++) g.simulate(1 / 20);
  // a solid wall straight across the route, 12 m ahead of the taxi
  const p = v.follower.path.sample(v.follower.s + 12);
  const nx = Math.cos(p.h), nz = -Math.sin(p.h);
  for (const o of [-3.2, -1.6, 0, 1.6, 3.2]) g.world.physics.col.dyn.add('crate', p.x + nx * o, v.y + 1.2, p.z + nz * o, { ry: -p.h, s: 1.7, color: 0xb4553b });
  for (let k = 0; k < 40; k++) g.world.step(1 / 30); // let the crates settle
  out.push(`crates at ${p.x.toFixed(0)},${p.z.toFixed(0)}; taxi at ${v.x.toFixed(0)},${v.z.toFixed(0)}`);
  let lastPhase = null, lastRel = 0;
  for (let i = 0; i < 90 * 20; i++) {
    g.simulate(1 / 20);
    const key = `${v.rec.phase}|${v.rec.tries}`;
    if (key !== lastPhase || v.relocations !== lastRel) { out.push(`t=${(i / 20).toFixed(1)}s phase=${v.rec.phase} tries=${v.rec.tries} stuck=${v.rec.stuck.toFixed(1)} reloc=${v.relocations} pos=${v.x.toFixed(0)},${v.z.toFixed(0)} dist-to-wall=${Math.hypot(v.x - p.x, v.z - p.z).toFixed(1)}`); lastPhase = key; lastRel = v.relocations; }
  }
  out.push(`end: pos ${v.x.toFixed(0)},${v.z.toFixed(0)} mode ${v.mode} reloc ${v.relocations}`);
  return out;
});
console.log(log.join('\n'));
await browser.close(); server.stop();
