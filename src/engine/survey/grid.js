/**
 * Sparse survey grid for ONE sensor channel. 2 m cells in 64x64-cell tiles (128 m), allocated only where you have
 * surveyed. Every reading is splatted with a Gaussian footprint into running sums (sum w*v, sum w), so the map is an
 * incremental weighted-average interpolation of the actual readings: nothing is recomputed per frame, and cells
 * with too little support stay UNCLASSIFIED (NaN) instead of being guessed.
 */
export const CELL = 2;
export const TILE = 64;
export const TILE_M = CELL * TILE;
export const W_MIN = 0.16; // weight below which a cell is "no data"

class Tile {
  constructor(tx, tz) {
    this.tx = tx; this.tz = tz;
    this.vs = new Float32Array(TILE * TILE);
    this.ws = new Float32Array(TILE * TILE);
    this.n = new Uint16Array(TILE * TILE); // readings that hit this cell near its centre
    this.covered = 0;
    this.ver = 0; // bumps whenever a reading touches this tile (the coverage map redraws only tiles that changed)
  }
}

export class Channel {
  constructor(sensor, ch) {
    this.sensor = sensor; this.ch = ch;
    this.tiles = new Map();
    this.version = 0;
    this.count = 0;
    this.reservoir = []; // a random sample of readings for robust background statistics
    this.stats = { bg: 0, sd: 1, n: 0 };
    this.statsAt = 0;
    this.dirtyTiles = new Set();
  }

  key(tx, tz) { return tx * 65536 + tz; }
  tile(tx, tz, make = false) {
    const k = this.key(tx, tz);
    let t = this.tiles.get(k);
    if (!t && make) { t = new Tile(tx, tz); this.tiles.set(k, t); }
    return t;
  }

  /** add one reading `v` at (x, z) with footprint radius `rad` (m) and quality weight `q` */
  splat(x, z, v, rad, q = 1) {
    const sig = Math.max(CELL * 0.75, rad * 0.6), reach = Math.ceil((sig * 2.4) / CELL);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), inv = 1 / (2 * sig * sig);
    let lastT = null, lastK = NaN; // (NaN never equals a key: tile (0,-1) has key -1)
    const touched = new Set();
    for (let j = cz - reach; j <= cz + reach; j++) {
      for (let i = cx - reach; i <= cx + reach; i++) {
        const dx = (i + 0.5) * CELL - x, dz = (j + 0.5) * CELL - z, w = q * Math.exp(-(dx * dx + dz * dz) * inv);
        if (w < 0.02) continue;
        const tx = Math.floor(i / TILE), tz = Math.floor(j / TILE), k = this.key(tx, tz);
        const t = k === lastK ? lastT : (lastT = this.tile(tx, tz, true), lastK = k, lastT);
        const c = (j - tz * TILE) * TILE + (i - tx * TILE), before = t.ws[c];
        t.vs[c] += w * v; t.ws[c] += w;
        if (w > 0.5 && t.n[c] < 65535) t.n[c]++;
        if (before < W_MIN && t.ws[c] >= W_MIN) t.covered++;
        this.dirtyTiles.add(k); touched.add(k);
      }
    }
    for (const k of touched) this.tiles.get(k).ver++;
    this.count++;
    if (this.reservoir.length < 3000) this.reservoir.push(v);
    else { const r = Math.floor(Math.random() * this.count); if (r < 3000) this.reservoir[r] = v; }
    this.version++;
  }

  /** interpolated value of cell (i, j) or NaN when unclassified */
  cell(i, j) {
    const tx = Math.floor(i / TILE), tz = Math.floor(j / TILE), t = this.tiles.get(this.key(tx, tz));
    if (!t) return NaN;
    const c = (j - tz * TILE) * TILE + (i - tx * TILE);
    return t.ws[c] >= W_MIN ? t.vs[c] / t.ws[c] : NaN;
  }
  support(i, j) {
    const tx = Math.floor(i / TILE), tz = Math.floor(j / TILE), t = this.tiles.get(this.key(tx, tz));
    if (!t) return 0;
    const c = (j - tz * TILE) * TILE + (i - tx * TILE);
    return t.n[c];
  }
  /** bilinear (support-weighted) value at world (x, z); NaN when unclassified */
  at(x, z) {
    const fx = x / CELL - 0.5, fz = z / CELL - 0.5, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    let vs = 0, ws = 0;
    const acc = (ii, jj, b) => {
      const tx = Math.floor(ii / TILE), tz = Math.floor(jj / TILE), t = this.tiles.get(this.key(tx, tz));
      if (!t) return;
      const c = (jj - tz * TILE) * TILE + (ii - tx * TILE);
      if (t.ws[c] < W_MIN) return;
      vs += b * t.vs[c] / t.ws[c]; ws += b;
    };
    acc(i, j, (1 - u) * (1 - v)); acc(i + 1, j, u * (1 - v)); acc(i, j + 1, (1 - u) * v); acc(i + 1, j + 1, u * v);
    return ws > 0.2 ? vs / ws : NaN;
  }

  /** robust background (median) and spread (1.4826 x MAD), refreshed when the data has grown */
  refreshStats(noise) {
    const n = this.reservoir.length;
    if (!n || (n === this.stats.n && this.count - this.statsAt < 50)) return this.stats;
    const s = [...this.reservoir].sort((a, b) => a - b), med = s[n >> 1];
    const dev = s.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
    this.stats = { bg: med, sd: Math.max(noise * 2, 1.4826 * dev[n >> 1]), n, lo: s[Math.floor(n * 0.02)], hi: s[Math.floor(n * 0.98)] };
    this.statsAt = this.count;
    return this.stats;
  }

  /** fraction of tile (tx, tz) with data */
  coverage(tx, tz) { const t = this.tile(tx, tz); return t ? t.covered / (TILE * TILE) : 0; }
  measuredArea() { let c = 0; for (const t of this.tiles.values()) c += t.covered; return c * CELL * CELL; }
  takeDirty() { const d = [...this.dirtyTiles]; this.dirtyTiles.clear(); return d.map((k) => this.tiles.get(k)); }
}
