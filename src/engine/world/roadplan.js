import { heightAt, waterLevelAt, riverS } from './terrain.js';
import { PIT, SITES, DIVE, RIDGE, WORLD_R, DEG, consLoc, ISLAND_R, POOL_R } from '../config.js';

/**
 * Road routing over the real terrain. A 16 m grid of the world is built once (heights, slopes, no-go zones: water, rivers, the city,
 * the pit, the hub, the site pads, the dive base, the ridge cave, the construction compound), and A* finds the cheapest way between
 * two points: long gentle lines, no steep slopes, and a strong pull towards roads that already exist so new roads JOIN the old ones
 * instead of running beside them. Pure geometry (no Three.js).
 */
const CELL = 16, HALF = 768, N = Math.round((2 * HALF) / CELL) + 1;
const MAX_SLOPE = 0.34;

let G = null;
const idx = (i, j) => j * N + i;
const toCell = (v) => Math.round((v + HALF) / CELL);
const toWorld = (i) => i * CELL - HALF;

/** the wedge-shaped city (matches city.js inCity, grown by `pad` metres) */
export function cityWedge(x, z, pad = 0) {
  const r = Math.hypot(x, z);
  if (r < 31 - pad || r > 226 + pad) return false;
  return Math.abs(Math.atan2(x, z)) / DEG <= 38 + (pad / Math.max(r, 40)) / DEG;
}

function zones() {
  const [mx, mz] = SITES.mine, [cx, cz] = SITES.camp, [tx, tz] = SITES.temple;
  return {
    discs: [[0, 0, 62], [cx, cz, 34], [tx, tz, 40], [mx, mz, 34], [PIT.x, PIT.z, PIT.R + 16], [DIVE.x, DIVE.z, 40], [RIDGE.mouth.x, RIDGE.mouth.z, 38]],
    // the Ridge Mine's hillside (the cave runs east from its portal) and the construction compound (f along the sector axis, l across it)
    rects: [[RIDGE.mouth.x - 34, RIDGE.mouth.z - 92, RIDGE.mouth.x + 184, RIDGE.mouth.z + 92]],
    compound: { f0: 34, f1: 168, l: 98 },
  };
}

function build() {
  const Z = zones(), h = new Float32Array(N * N), blocked = new Uint8Array(N * N), slope = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[idx(i, j)] = heightAt(toWorld(i), toWorld(j));
  const [ax, az] = [Math.cos(330 * DEG), Math.sin(330 * DEG)], [lx, lz] = [-az, ax];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = toWorld(i), z = toWorld(j), k = idx(i, j), hh = h[k];
      const dx = i > 0 && i < N - 1 ? Math.abs(h[k + 1] - h[k - 1]) / (2 * CELL) : 0, dz = j > 0 && j < N - 1 ? Math.abs(h[k + N] - h[k - N]) / (2 * CELL) : 0;
      slope[k] = Math.hypot(dx, dz);
      let b = Math.hypot(x, z) > WORLD_R - 44 || hh < waterLevelAt(x, z) + 0.7 || riverS(x, z) < 6 || slope[k] > MAX_SLOPE || cityWedge(x, z, 14);
      if (!b) for (const [cx, cz, r] of Z.discs) if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) { b = true; break; }
      if (!b) for (const [x0, z0, x1, z1] of Z.rects) if (x > x0 && x < x1 && z > z0 && z < z1) { b = true; break; }
      if (!b) { const f = x * ax + z * az, l = x * lx + z * lz; if (f > Z.compound.f0 && f < Z.compound.f1 && Math.abs(l) < Z.compound.l) b = true; }
      blocked[k] = b ? 1 : 0;
    }
  }
  return { h, blocked, slope, pull: new Float32Array(N * N).fill(1) };
}

const grid = () => (G ??= build());

/** tell the planner where roads already are (cells within ~9 m become cheap, so new roads merge into them) */
export function setExistingRoads(samples) {
  const g = grid(); g.pull.fill(1);
  for (const s of samples) for (let i = 0; i < s.length; i += 2) {
    const ci = toCell(s[i]), cj = toCell(s[i + 1]);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const ii = ci + a, jj = cj + b; if (ii >= 0 && jj >= 0 && ii < N && jj < N) g.pull[idx(ii, jj)] = 0.3; }
  }
}

class Heap {
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * The cheapest dry, gentle way from (ax, az) to (bx, bz): an array of [x, z] (first = a, last = b), or null when the two are not connected
 * by land. Cells within `free` metres of either end are passable (the ends may sit at pads, bridge heads or road ends).
 */
export function planRoad(ax, az, bx, bz, opt = {}) {
  // try the normal clearances first, then keep further from water; a path is accepted only if the REAL terrain along it (every 4 m) is dry and not too steep
  for (const margin of [0.5, 1.3, 2.2]) {
    const p = search(ax, az, bx, bz, { ...opt, margin });
    if (p && valid(p, opt.slope ?? MAX_SLOPE)) return p;
  }
  return null;
}

function valid(path, slope) {
  const hs = [];                                   // heights along the whole path every ~4 m (and whether each point is wet)
  for (let k = 1; k < path.length; k++) {
    const [x0, z0] = path[k - 1], [x1, z1] = path[k], d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(d / 4));
    for (let t = k === 1 ? 0 : 1; t <= n; t++) {
      const x = x0 + ((x1 - x0) * t) / n, z = z0 + ((z1 - z0) * t) / n, h = heightAt(x, z);
      if (h < waterLevelAt(x, z) + 0.35 || riverS(x, z) < 3) return false;
      hs.push([h, d / n]);
    }
  }
  for (let i = 0; i + 3 < hs.length; i++) { // gradient over a 12 m baseline (4 m steps would read the terrain's fine noise as cliffs)
    const run = hs[i + 1][1] + hs[i + 2][1] + hs[i + 3][1];
    if (Math.abs(hs[i + 3][0] - hs[i][0]) / run > slope * 1.4) return false;
  }
  return true;
}

function search(ax0, az0, bx0, bz0, { free = 40, slope = MAX_SLOPE, margin = 0.5 } = {}) {
  const g = grid();
  // the ends must be on usable ground: a point in a pond, on a cliff or inside the city is moved to the nearest cell that is not
  const usable = (i, j) => { if (i < 0 || j < 0 || i >= N || j >= N) return false; const k = idx(i, j), x = toWorld(i), z = toWorld(j); return g.h[k] >= waterLevelAt(x, z) + 0.7 && riverS(x, z) >= 6 && !g.blocked[k] && g.slope[k] <= slope; };
  const snap = (x, z) => {
    const i0 = toCell(x), j0 = toCell(z);
    if (usable(i0, j0)) return [x, z];
    for (let r = 1; r <= 12; r++) { let best = null; for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) { if (Math.max(Math.abs(a), Math.abs(b)) !== r || !usable(i0 + a, j0 + b)) continue; const d = a * a + b * b; if (!best || d < best[0]) best = [d, i0 + a, j0 + b]; } if (best) return [toWorld(best[1]), toWorld(best[2])]; }
    return [x, z]; // (nothing usable nearby: keep it; the cells around it are passable anyway)
  };
  const exact = (x, z) => heightAt(x, z) >= waterLevelAt(x, z) + 0.5 && riverS(x, z) >= 5; // dry ground (bridge heads, road ends): kept exactly (tested at the point itself, not its grid cell)
  const [ax, az] = exact(ax0, az0) ? [ax0, az0] : snap(ax0, az0), [bx, bz] = exact(bx0, bz0) ? [bx0, bz0] : snap(bx0, bz0);
  const si = toCell(ax), sj = toCell(az), ti = toCell(bx), tj = toCell(bz);
  const open = (i, j) => {
    if (i < 0 || j < 0 || i >= N || j >= N) return false;
    const k = idx(i, j), x = toWorld(i), z = toWorld(j);
    if (g.h[k] < waterLevelAt(x, z) + margin || riverS(x, z) < 4) return false; // water is never passable
    if (g.slope[k] > slope + 0.05) return false;
    return !g.blocked[k] || Math.hypot(x - ax, z - az) < free || Math.hypot(x - bx, z - bz) < free;
  };
  const sk = idx(si, sj), tk = idx(ti, tj), dist = new Float32Array(N * N).fill(Infinity), prev = new Int32Array(N * N).fill(-1), done = new Uint8Array(N * N);
  const H = new Heap(), hx = (k) => Math.hypot(((k % N) - ti) * CELL, (((k / N) | 0) - tj) * CELL) * 0.3;
  dist[sk] = 0; H.push(hx(sk), sk);
  while (H.size) {
    const [, k] = H.pop();
    if (done[k]) continue; done[k] = 1;
    if (k === tk) break;
    const ci = k % N, cj = (k / N) | 0;
    for (const [di, dj] of NB) {
      const ni = ci + di, nj = cj + dj;
      if (!open(ni, nj)) continue;
      const nk = idx(ni, nj); if (done[nk]) continue;
      const step = Math.hypot(di, dj) * CELL, s = Math.max(g.slope[nk], g.slope[k]);
      const c = dist[k] + step * (1 + 16 * s * s) * g.pull[nk] * (g.blocked[nk] ? 3 : 1);
      if (c < dist[nk]) { dist[nk] = c; prev[nk] = k; H.push(c + hx(nk), nk); }
    }
  }
  if (!done[tk]) return null;
  const cells = []; for (let k = tk; k !== -1; k = prev[k]) cells.push([toWorld(k % N), toWorld((k / N) | 0)]);
  cells.reverse();
  // string-pull: drop every point the straight line can skip over open ground (keeps roads long and straight, not grid-stepped)
  const clear = (p, q) => {
    const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 6);
    let prevH = heightAt(p[0], p[1]);
    for (let t = 1; t < n; t++) {
      const hx = p[0] + ((q[0] - p[0]) * t) / n, hz = p[1] + ((q[1] - p[1]) * t) / n, hh = heightAt(hx, hz);
      if (Math.abs(hh - prevH) / (Math.hypot(q[0] - p[0], q[1] - p[1]) / n) > slope * 1.1) return false; // the road itself must not climb faster than the limit
      prevH = hh;
      const x = p[0] + ((q[0] - p[0]) * t) / n, z = p[1] + ((q[1] - p[1]) * t) / n, i = toCell(x), j = toCell(z);
      if (!open(i, j) || (g.blocked[idx(i, j)] && !(Math.hypot(x - ax, z - az) < free || Math.hypot(x - bx, z - bz) < free))) return false;
      if (g.slope[idx(i, j)] > slope) return false;
      if (riverS(x, z) < 6 || heightAt(x, z) < waterLevelAt(x, z) + 0.6) return false;
    }
    return true;
  };
  const out = [[ax, az]]; let cur = [ax, az], at = 1;
  while (at < cells.length) {
    let far = at; for (let k = at; k < cells.length; k++) if (clear(cur, cells[k])) far = k;
    cur = cells[far]; out.push(cur); at = far + 1;
  }
  out.push([bx, bz]);
  return out;
}

export const GRID_INFO = { CELL, N, HALF };
void ISLAND_R; void POOL_R; void consLoc;
export { grid as _grid };
