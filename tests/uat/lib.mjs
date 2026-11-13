// Shared helpers for UAT + visual tools: start the production server, launch Chrome, install in-page helpers.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

export const CHROME = process.env.CHROME_PATH || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));

export async function startServer(port = 3100) {
  const url = `http://localhost:${port}/`;
  const proc = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], { stdio: 'ignore' });
  process.on('exit', () => { try { proc.kill(); } catch { /* gone */ } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)); }
  return { url, stop: () => { try { proc.kill(); } catch { /* gone */ } } };
}

export const launch = () => puppeteer.launch({
  executablePath: CHROME, headless: 'new', protocolTimeout: 600000,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});

export async function openGame(browser, url, { viewport = { width: 1280, height: 720 }, mobile = false, errors = [] } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message} ${(e.stack ?? '').split('\n').slice(1, 4).join(' | ')}`));
  await page.goto(url, { waitUntil: 'load' });
  return page;
}

export const waitReady = (page, ms = 180000) => page.waitForFunction(() => window.__game?.store?.get().phase === 'ready', { timeout: ms });

/** helpers that run inside the page: g.go(x,z,dx,dz[,fromY]) teleport+face, g.run(sec, keys, jumpFrame) deterministic sim */
export async function installHelpers(page) {
  await page.evaluate(() => {
    const g = window.__game;
    g.face = (dx, dz) => { g.player.camYaw = Math.atan2(-dx, -dz); };
    g.go = (x, z, dx = 0, dz = 1, fromY) => { g.player.teleport(x, z, Math.atan2(dx, dz), fromY); g.face(dx, dz); g.simulate(1 / 60); };
    g.run = (sec, keys = [], jumpAtFrame = -1) => {
      let minY = 1e9, maxY = -1e9, swam = false;
      keys.forEach((k) => g.input.keyDown(k));
      for (let i = 0; i < sec * 60; i++) {
        if (i === jumpAtFrame) g.input.keyDown('Space');
        g.simulate(1 / 60);
        if (i === jumpAtFrame) g.input.keyUp('Space');
        const p = g.player.pos; minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); swam = swam || g.player.swimming;
      }
      keys.forEach((k) => g.input.keyUp(k));
      const p = g.player.pos;
      return { x: p.x, y: p.y, z: p.z, minY, maxY, swam, grounded: g.player.motor.grounded };
    };
  });
}

export async function enter(page) {
  await page.click('.start .btn.primary');
  await page.waitForSelector('.hud');
  await page.evaluate(() => window.__game.simulate(1 / 60));
}
