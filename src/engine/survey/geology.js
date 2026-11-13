import { fbm, noise2, mulberry32 } from '../noise.js';
import { heightAt, waterLevelAt, regionWeights, branchPoint, PIT_WATER_Y } from '../world/terrain.js';
import { SITES_LIST } from '../world/caveSites.js';
import { NETWORK } from '../world/layout.js';
import { PIT, LAKE, WATER_Y, polar } from '../config.js';

/**
 * The hidden subsurface. A deterministic set of buried bodies (real DEPOSITS and barren DECOYS) sits in a layered
 * background (soil / weathered regolith / bedrock, a water table, lithology that changes across the map).
 * Every sensor reads a different physical property of that one model:
 *   magnetic susceptibility -> MAG, permittivity contrasts -> GPR, K/U/Th in the top 0.5 m -> GAMMA,
 *   conductivity -> EMI, resistivity -> RES, chargeability -> IP, elastic velocity -> SEISMIC.
 * So instruments agree where physics says they should, and disagree everywhere else. An anomaly is NOT a mineral:
 * decoys (dykes, clay, black shale, granite, faults, voids) light up some instruments with nothing worth digging.
 *
 * props per body (amplitudes at grade 1):  mag nT | em mS/m | ip mV/V | res log10 factor | K % | U ppm | Th ppm | vel m/s | gpr refl.
 */
const T = (o) => o;
export const DEPOSIT_TYPES = {
  copper: T({ props: { mag: 90, em: 22, ip: 34, res: -0.35, K: 0.9, U: 0.6, Th: 1.5, vel: -150, gpr: 0.45 }, depth: [1, 4.5], R: [9, 16], thick: [3, 8], elong: 1.4, host: 'porphyry intrusion with disseminated chalcopyrite' }),
  gold: T({ props: { mag: 25, em: 7, ip: 12, res: 0.4, K: 0.5, U: 0.3, Th: 0.4, vel: 220, gpr: 0.55 }, depth: [0.8, 4], R: [5, 9], thick: [2, 5], elong: 3.2, host: 'quartz vein system with pyrite' }),
  silver: T({ props: { mag: 18, em: 14, ip: 22, res: 0.15, K: 0.4, U: 0.2, Th: 0.3, vel: 120, gpr: 0.45 }, depth: [1, 4], R: [5, 9], thick: [2, 5], elong: 2.6, host: 'epithermal vein with argentite' }),
  iron: T({ props: { mag: 420, em: 6, ip: 4, res: -0.1, K: -0.2, U: 0, Th: 0.5, vel: 420, gpr: 0.4 }, depth: [0.8, 4], R: [9, 15], thick: [3, 7], elong: 1.8, host: 'banded iron formation (hematite-magnetite)' }),
  magnetite: T({ props: { mag: 1800, em: 18, ip: 8, res: -0.15, K: -0.2, U: 0, Th: 0.6, vel: 520, gpr: 0.5 }, depth: [1, 5], R: [7, 13], thick: [3, 7], elong: 1.3, host: 'massive magnetite skarn' }),
  bauxite: T({ props: { mag: 12, em: 4, ip: 3, res: 0.2, K: -0.4, U: 1.2, Th: 6, vel: -350, gpr: 0.7 }, depth: [0.3, 1.5], R: [12, 20], thick: [1.5, 4], elong: 1.6, host: 'lateritic duricrust over weathered basalt' }),
  nickel: T({ props: { mag: 520, em: 70, ip: 42, res: -0.75, K: -0.2, U: 0, Th: 0.2, vel: 300, gpr: 0.5 }, depth: [1.5, 5.5], R: [6, 11], thick: [2, 5], elong: 2, host: 'massive pentlandite-pyrrhotite sulphide in ultramafic rock' }),
  cobalt: T({ props: { mag: 220, em: 40, ip: 30, res: -0.5, K: 0, U: 0.1, Th: 0.3, vel: 200, gpr: 0.45 }, depth: [1.5, 5], R: [6, 10], thick: [2, 5], elong: 1.8, host: 'cobaltite-bearing sulphide lens' }),
  lithium: T({ props: { mag: -12, em: 0, ip: 2, res: 0.55, K: 1.6, U: 1.2, Th: 2.5, vel: 160, gpr: 0.5 }, depth: [0.5, 3], R: [6, 10], thick: [2, 5], elong: 3.5, host: 'spodumene pegmatite dyke' }),
  graphite: T({ props: { mag: 0, em: 95, ip: 55, res: -0.95, K: 0.2, U: 0.6, Th: 0.5, vel: -100, gpr: 0.4 }, depth: [1, 4.5], R: [7, 12], thick: [2, 5], elong: 2.6, host: 'flake graphite schist' }),
  tin: T({ props: { mag: 8, em: 2, ip: 6, res: 0.55, K: 1.1, U: 2.8, Th: 7, vel: 280, gpr: 0.45 }, depth: [0.6, 3.5], R: [6, 10], thick: [2, 5], elong: 2.2, host: 'greisen in granite cupola (cassiterite)' }),
  tungsten: T({ props: { mag: 35, em: 5, ip: 14, res: 0.45, K: 0.8, U: 2.2, Th: 5, vel: 300, gpr: 0.45 }, depth: [0.8, 4], R: [6, 10], thick: [2, 5], elong: 2.2, host: 'scheelite skarn at a granite contact' }),
  uranium: T({ props: { mag: 0, em: 6, ip: 6, res: -0.1, K: 0.3, U: 38, Th: 2, vel: -50, gpr: 0.35 }, depth: [0.3, 2], R: [6, 11], thick: [1.5, 4], elong: 1.8, host: 'uraninite in a sandstone roll front' }),
  thorium: T({ props: { mag: 25, em: 3, ip: 4, res: 0.25, K: 0.5, U: 4, Th: 48, vel: 120, gpr: 0.35 }, depth: [0.3, 2], R: [6, 11], thick: [1.5, 4], elong: 1.6, host: 'monazite placer sands' }),
  ree: T({ props: { mag: 140, em: 6, ip: 9, res: 0.3, K: 1.2, U: 11, Th: 30, vel: 140, gpr: 0.4 }, depth: [0.4, 3], R: [9, 15], thick: [3, 6], elong: 1.2, host: 'carbonatite with bastnaesite (REE)' }),
  cee: T({ props: { mag: 70, em: 14, ip: 11, res: 0.15, K: 0.9, U: 7, Th: 16, vel: 100, gpr: 0.4 }, depth: [0.6, 3.5], R: [7, 12], thick: [2, 5], elong: 1.8, host: 'alkaline intrusion with Nb-Ta-Zr oxides' }),
};
export const DECOY_TYPES = {
  dyke: T({ props: { mag: 380, em: 3, ip: 2, res: 0.2, K: -0.3, U: -0.2, Th: -0.5, vel: 350, gpr: 0.3 }, depth: [0.5, 4], R: [3, 5], thick: [6, 12], elong: 8, label: 'barren dolerite dyke' }),
  clay: T({ props: { mag: -5, em: 38, ip: 4, res: -0.7, K: 0.6, U: 0.5, Th: 2, vel: -400, gpr: -0.3 }, depth: [0.5, 3], R: [12, 22], thick: [2, 5], elong: 1.5, label: 'saline clay lens' }),
  shale: T({ props: { mag: 5, em: 42, ip: 30, res: -0.65, K: 0.4, U: 3, Th: 1, vel: -150, gpr: 0.3 }, depth: [1, 5], R: [8, 14], thick: [3, 6], elong: 3, label: 'barren pyritic black shale' }),
  granite: T({ props: { mag: 35, em: 0, ip: 1, res: 0.4, K: 2.4, U: 3, Th: 9, vel: 300, gpr: 0.3 }, depth: [0.4, 2.5], R: [14, 24], thick: [4, 8], elong: 1.3, label: 'barren potassic granite' }),
  fault: T({ props: { mag: -40, em: 16, ip: 3, res: -0.5, K: 0, U: 0.5, Th: 0, vel: -650, gpr: 0.6 }, depth: [0.5, 4], R: [3, 5], thick: [8, 14], elong: 10, label: 'water-filled fault zone' }),
  void: T({ props: { mag: -15, em: -4, ip: 0, res: 1.0, K: -0.3, U: -0.3, Th: -1, vel: -900, gpr: 1.0 }, depth: [0.8, 3], R: [2.5, 4.5], thick: [1.5, 3], elong: 1.3, label: 'air-filled karst cavity' }),
};

const POOLS = {
  construction: ['copper', 'copper', 'iron', 'magnetite', 'nickel', 'cobalt', 'silver', 'gold'],
  jungle: ['bauxite', 'bauxite', 'ree', 'tin', 'tungsten', 'gold', 'thorium', 'cee'],
  city: ['lithium', 'graphite', 'uranium', 'cee', 'gold', 'copper', 'magnetite', 'silver'],
};
const DECOY_POOL = ['dyke', 'dyke', 'clay', 'shale', 'granite', 'fault', 'void'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const k15 = (r, w) => { const q = r / w, s = 1 + q * q; return 1 / (s * Math.sqrt(s)); };
const k2 = (r, w) => { const q = r / w, s = 1 + q * q; return 1 / (s * s); };
/** cheap reject: is (x, z) beyond `k` kernel widths `w` of body f (plus its own length)? */
const far = (f, x, z, w, k) => { const dx = x - f.x, dz = z - f.z, c = k * w + f.R * f.elong; return dx * dx + dz * dz > c * c; };
/** ore within this depth (m) of the surface can be dug out with a pickaxe; anything deeper needs an excavator */
export const HAND_DEPTH = 1.5;
/**
 * Where a body lives. Surface bodies are what the drone, the rover and a person on the ground measure; cave bodies sit in the
 * rock of one cave (a sensor carried inside it reads those, never the hill above); water bodies are in the lake, river and pit beds.
 */
export const LAYERS = ['surface', 'cave0', 'cave1', 'water'];
const HASH_CELL = 96, INFL = 170, NONE = [];
const hkey = (i, j) => (i + 512) * 1024 + (j + 512);

class Geology {
  constructor(seed = 7319) {
    this.wetCache = new Map();
    this.layer = 'surface'; // the layer sensors / digs currently refer to (set by the survey from where the player is)
    this.epoch = -1;
    this.reshuffle(0);
  }

  /** a whole new set of hidden deposits and decoys (the minerals shift every 15 minutes of play). Deterministic per epoch. */
  reshuffle(epoch) {
    this.epoch = epoch;
    this.rng = mulberry32(7319 + epoch * 104729);
    this.features = [];
    this.hashes = Object.fromEntries(LAYERS.map((l) => [l, new Map()]));
    this.generate();
  }

  // ------------------------------------------------------------- generation
  land(x, z) { return heightAt(x, z) - waterLevelAt(x, z) > 0.8 && Math.hypot(x - PIT.x, z - PIT.z) > PIT.R + 14 && Math.hypot(x, z) > 38; }
  clear(x, z, sep) { return this.features.every((f) => Math.hypot(f.x - x, f.z - z) > sep); }
  region(x, z) { const w = regionWeights(x, z); return w.jungle >= w.city && w.jungle >= w.construction ? 'jungle' : w.city >= w.construction ? 'city' : 'construction'; }

  add(kind, type, x, z, layer = 'surface') {
    const tbl = kind === 'deposit' ? DEPOSIT_TYPES[type] : DECOY_TYPES[type], r = this.rng, lerp = ([a, b]) => a + (b - a) * r();
    const inRock = layer !== 'surface'; // in a cave wall or a river / lake bed: close to the face and compact
    const f = {
      id: this.features.length + 1, kind, type, layer, x, z, depth: inRock ? 0.25 + 0.85 * r() : lerp(tbl.depth), thick: inRock ? 1.2 + 1.6 * r() : lerp(tbl.thick), R: inRock ? 3.4 + 2.6 * r() : lerp(tbl.R),
      grade: kind === 'deposit' ? 0.45 + 0.55 * r() : 0.7 + 0.3 * r(), strike: r() * Math.PI, elong: inRock ? Math.min(2, tbl.elong) * (0.8 + 0.4 * r()) : tbl.elong * (0.8 + 0.4 * r()), props: tbl.props,
      label: kind === 'deposit' ? tbl.host : tbl.label,
    };
    f.cs = Math.cos(f.strike); f.sn = Math.sin(f.strike);
    if (kind === 'deposit') { f.quantity = Math.round(clamp(f.R * f.thick * f.grade * 0.6, 6, 48)); f.remaining = f.quantity; }
    this.features.push(f);
    const c0x = Math.floor((x - INFL) / HASH_CELL), c1x = Math.floor((x + INFL) / HASH_CELL), c0z = Math.floor((z - INFL) / HASH_CELL), c1z = Math.floor((z + INFL) / HASH_CELL);
    const H = this.hashes[layer];
    for (let i = c0x; i <= c1x; i++) for (let j = c0z; j <= c1z; j++) { const k = hkey(i, j); if (!H.has(k)) H.set(k, []); H.get(k).push(f); }
    return f;
  }

  scatter(n, rMin, rMax, sep, kindFn) {
    let tries = 0, made = 0;
    while (made < n && tries++ < n * 60) {
      const a = this.rng() * Math.PI * 2, r = Math.sqrt(rMin * rMin + this.rng() * (rMax * rMax - rMin * rMin));
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!this.land(x, z) || !this.clear(x, z, sep)) continue;
      const [kind, type] = kindFn(x, z);
      this.add(kind, type, x, z); made++;
    }
  }

  generate() {
    // a few guaranteed targets near the hub, one per sector, so a first survey always finds something real
    const seedSite = (r, deg, kind, type) => {
      for (let k = 0; k < 40; k++) {
        const [x, z] = polar(r + k * 2.5, deg + (k % 2 ? 1 : -1) * k * 1.5);
        if (this.land(x, z) && this.clear(x, z, 30)) return this.add(kind, type, x, z);
      }
      return null;
    };
    seedSite(78, 345, 'deposit', 'copper');
    seedSite(100, 318, 'decoy', 'dyke');
    seedSite(74, 240, 'deposit', 'ree');
    seedSite(96, 200, 'deposit', 'bauxite');
    seedSite(72, 62, 'deposit', 'magnetite');
    seedSite(100, 118, 'decoy', 'clay');
    // every farm has ground worth surveying: two deposits somewhere under its fields, and a decoy
    const underFarm = ['copper', 'gold', 'tungsten', 'silver', 'tin', 'magnetite', 'nickel', 'lithium'];
    for (const f of NETWORK.farms) {
      for (let k = 0; k < 2; k++) this.add('deposit', underFarm[Math.floor(this.rng() * underFarm.length)], f.cx + (this.rng() - 0.5) * 70, f.cz - 6 + (this.rng() - 0.5) * 50, 'surface');
      this.add('decoy', ['dyke', 'clay', 'granite'][Math.floor(this.rng() * 3)], f.cx + (this.rng() - 0.5) * 60, f.cz + (this.rng() - 0.5) * 40, 'surface');
    }
    const pick = (x, z) => { const pool = POOLS[this.region(x, z)]; return ['deposit', pool[Math.floor(this.rng() * pool.length)]]; };
    this.scatter(46, 45, 340, 40, pick);
    this.scatter(34, 340, 720, 55, pick);
    this.scatter(26, 45, 380, 34, () => ['decoy', DECOY_POOL[Math.floor(this.rng() * DECOY_POOL.length)]]);
    this.scatter(16, 380, 720, 50, () => ['decoy', DECOY_POOL[Math.floor(this.rng() * DECOY_POOL.length)]]);
    this.placeInRock();
    this.deposits = this.features.filter((f) => f.kind === 'deposit');
  }

  /** deposits inside the two caves and in the lake / river / pit beds (a sensor carried there reads these; the surface ones are out of reach) */
  placeInRock() {
    const caves = SITES_LIST.map((s) => s.cave());
    const pools = [['copper', 'iron', 'magnetite', 'gold', 'silver', 'nickel', 'cobalt', 'graphite'], ['gold', 'copper', 'tin', 'tungsten', 'lithium', 'uranium']];
    const apart = (layer, x, z, d) => this.features.every((f) => f.layer !== layer || Math.hypot(f.x - x, f.z - z) > d);
    caves.forEach((c, i) => {
      const layer = `cave${i}`, area = c.floors.reduce((s, q) => s + q.hx * q.hz, 0), want = i === 0 ? 10 : 7, decoys = i === 0 ? 3 : 2;
      for (let n = 0, tries = 0; n < want + decoys && tries++ < 2000;) {
        let u = this.rng() * area, q = c.floors[0];
        for (const r of c.floors) { u -= r.hx * r.hz; q = r; if (u <= 0) break; }
        const x = q.x + (this.rng() * 2 - 1) * q.hx, z = q.z + (this.rng() * 2 - 1) * q.hz;
        if (!c.open(x, z) || c.depth(x, z) < 10 || !apart(layer, x, z, 12)) continue;
        if (n < want) this.add('deposit', pools[i][Math.floor(this.rng() * pools[i].length)], x, z, layer);
        else this.add('decoy', ['shale', 'fault', 'void'][Math.floor(this.rng() * 3)], x, z, layer);
        n++;
      }
    });
    const bed = (n, pick, type) => {
      for (let k = 0, made = 0; made < n && k < n * 80; k++) {
        const [x, z] = pick(); const h = heightAt(x, z);
        if (h > (type === 'pit' ? PIT_WATER_Y - 0.6 : WATER_Y - 1.5) || !apart('water', x, z, 16)) continue;
        this.add('deposit', ['gold', 'copper', 'tin', 'iron', 'magnetite', 'silver'][Math.floor(this.rng() * 6)], x, z, 'water'); made++;
      }
    };
    bed(8, () => { const a = this.rng() * 6.283, r = LAKE.R * 0.85 * Math.sqrt(this.rng()); return [LAKE.x + Math.cos(a) * r, LAKE.z + Math.sin(a) * r]; }, 'lake');
    bed(4, () => branchPoint(Math.floor(this.rng() * 3), 70 + this.rng() * 330, (this.rng() * 2 - 1) * 6), 'river');
    bed(3, () => { const a = this.rng() * 6.283, r = PIT.R * 0.42 * Math.sqrt(this.rng()); return [PIT.x + Math.cos(a) * r, PIT.z + Math.sin(a) * r]; }, 'pit');
  }

  near(x, z) { return this.hashes[this.layer].get(hkey(Math.floor(x / HASH_CELL), Math.floor(z / HASH_CELL))) ?? NONE; }
  /** elliptical distance from a body's axis (elongated along its strike) */
  reff(f, x, z) { const dx = x - f.x, dz = z - f.z, u = dx * f.cs + dz * f.sn, v = -dx * f.sn + dz * f.cs; return Math.hypot(u / f.elong, v); }

  // ------------------------------------------------------------- background
  lith(x, z) { return fbm(x / 260 + 3.1, z / 260 - 7.3, 4, 101); }
  lith2(x, z) { return fbm(x / 190 - 1.7, z / 190 + 4.2, 3, 202); }
  small(x, z) { return noise2(x / 9, z / 9, 303) - 0.5; }
  bedrock(x, z) { return 1.5 + 13 * Math.pow(fbm(x / 120 + 9, z / 120 - 2, 3, 404), 1.6); }
  /** 0 dry .. 1 waterlogged (cached on an 8 m grid: heightAt is not cheap) */
  wet(x, z) {
    const i = Math.round(x / 8), j = Math.round(z / 8), k = i * 4096 + j;
    let w = this.wetCache.get(k);
    if (w === undefined) { const X = i * 8, Z = j * 8; w = clamp(1 - (heightAt(X, Z) - waterLevelAt(X, Z) - 0.4) / 2.2, 0, 1); this.wetCache.set(k, w); }
    return w;
  }

  // ------------------------------------------------------------- surface measurements
  /**
   * What a sensor reads at (x, z) carried `h` metres above the ground (no instrument noise: survey.js adds that).
   * Gamma fills out.K / out.U / out.Th and returns the total count proxy.
   */
  measure(sensor, x, z, h = 1, out = null) {
    const lith = this.lith(x, z), sm = this.small(x, z), wet = this.wet(x, z), fs = this.near(x, z);
    switch (sensor) {
      case 'mag': {
        let v = -30 + 110 * lith + 28 * (fbm(x / 40, z / 40, 3, 505) - 0.5) + 0.02 * (x - z) + 5 * sm;
        for (const f of fs) {
          if (!f.props.mag) continue;
          const z0 = f.depth + f.thick * 0.5 + h + 0.3, w = Math.hypot(f.R * 0.75, z0);
          if (far(f, x, z, w, 7)) continue;
          const amp = f.props.mag * f.grade * Math.pow(Math.min(1, (f.R * 0.75 + 1.5) / w), 1.6);
          const r = this.reff(f, x, z), r2 = Math.hypot(x - f.x, z - (f.z - 0.9 * w)); // the dipole's negative lobe sits to the north (-Z)
          v += amp * (k15(r, w) - 0.28 * k15(r2, 1.25 * w));
        }
        return v;
      }
      case 'gamma': {
        const l2 = this.lith2(x, z), air = Math.exp(-h / 80) * (1 - 0.55 * wet);
        let K = 0.6 + 1.6 * l2 + 0.2 * sm, U = 1.0 + 1.8 * l2 + 0.4 * sm, Th = 4 + 8 * l2 + 1.2 * sm;
        for (const f of fs) {
          const p = f.props; if (!p.K && !p.U && !p.Th) continue;
          if (far(f, x, z, Math.hypot(2 * f.R, h), 4)) continue;
          const r = this.reff(f, x, z), s = f.grade * (k2(r, Math.hypot(f.R, h * 0.8)) * Math.exp(-f.depth / 0.45) + 0.25 * k2(r, Math.hypot(2 * f.R, h)) * Math.exp(-f.depth / 4));
          K += p.K * s; U += p.U * s; Th += p.Th * s;
        }
        K = Math.max(0.05, K * air); U = Math.max(0.1, U * air); Th = Math.max(0.3, Th * air);
        if (out) { out.K = K; out.U = U; out.Th = Th; }
        return K * 13 + U * 3.6 + Th * 1.4;
      }
      case 'emi': {
        let v = 4 + 14 * (1 - lith) + 30 * wet + 4 * sm;
        const D = h > 3 ? 14 : 5;
        for (const f of fs) { if (!f.props.em) continue; const z0 = f.depth + f.thick * 0.3, w = Math.hypot(f.R, z0 * 0.8, h * 0.9); if (far(f, x, z, w, 5)) continue; v += f.props.em * f.grade * Math.exp(-z0 / D) * Math.min(1, f.R / w * 1.2) * k2(this.reff(f, x, z), w); }
        return Math.max(0.3, v * (h > 3 ? Math.exp(-(h - 3) / 60) : 1));
      }
      case 'res': {
        let lg = Math.log10(220) + 0.9 * (lith - 0.5) - 0.9 * wet - 0.25 * (this.bedrock(x, z) / 15) + 0.15 * sm;
        for (const f of fs) { if (!f.props.res) continue; const z0 = f.depth + f.thick * 0.3, w = Math.hypot(f.R, z0 * 0.8); if (far(f, x, z, w, 5)) continue; lg += f.props.res * f.grade * Math.exp(-z0 / 15) * k2(this.reff(f, x, z), w); }
        return Math.pow(10, lg);
      }
      case 'ip': {
        let v = 2.2 + 2.5 * (1 - lith) * 0.6 + 0.75 * wet + 0.4 * sm;
        for (const f of fs) { if (!f.props.ip) continue; const z0 = f.depth + f.thick * 0.3, w = Math.hypot(f.R, z0 * 0.8); if (far(f, x, z, w, 5)) continue; v += f.props.ip * f.grade * Math.exp(-z0 / 12) * k2(this.reff(f, x, z), w); }
        return Math.max(0.2, v);
      }
      case 'gpr': {
        const ec = 4 + 14 * (1 - lith) + 30 * wet, pen = clamp(1.6 - ec / 30, 0.25, 1.4), bed = this.bedrock(x, z);
        let v = 0.12 + 0.55 * Math.exp(-bed / 3) * pen + 0.06 * sm;
        for (const f of fs) { if (!f.props.gpr) continue; const w = Math.hypot(f.R, h); if (far(f, x, z, w, 5)) continue; v += Math.abs(f.props.gpr) * f.grade * Math.exp(-f.depth / (pen * 3)) * k2(this.reff(f, x, z), w); }
        return Math.max(0, v * Math.exp(-Math.max(0, h - 1.5) / 6));
      }
      case 'seis': {
        let v = 2600 + 1800 * lith - 25 * this.bedrock(x, z) + 120 * sm;
        for (const f of fs) { if (!f.props.vel) continue; const z0 = f.depth + f.thick * 0.5, w = Math.hypot(f.R, z0 * 0.7); if (far(f, x, z, w, 5)) continue; v += f.props.vel * f.grade * Math.exp(-z0 / 25) * k2(this.reff(f, x, z), w); }
        return v;
      }
      default: return 0;
    }
  }

  // ------------------------------------------------------------- volume model (for sections and the 2.5D view)
  occ(f, x, z, d) {
    const t = (d - f.depth) / f.thick;
    if (t < -0.15 || t > 1.15) return 0;
    const R = f.R * (1 - 0.35 * clamp(t, 0, 1));
    return (1 - sstep(0.75 * R, 1.05 * R, this.reff(f, x, z))) * sstep(-0.12, 0.08, t) * (1 - sstep(0.9, 1.1, t));
  }
  /** a volumetric property at depth d (m) below (x, z), in the instrument's own terms */
  property(sensor, x, z, d, ctx = null) {
    const c = ctx ?? this.column(x, z), fs = c.fs;
    let v;
    switch (sensor) {
      case 'mag': v = d < c.bed ? 0.3 + 0.6 * c.lith : 1 + 6 * c.lith; break;
      case 'gpr': v = d < c.soil ? 6 : d < c.bed ? (d > c.wt ? 20 : 12) : 7; break;
      case 'gamma': v = 1 + 0.6 * (c.lith - 0.5); break;
      case 'ip': v = 2 + (d < c.bed ? 3 * (1 - c.lith) : 0.5); break;
      case 'seis': v = d < c.soil ? 350 : d < c.bed ? 700 + 900 * (d / c.bed) : c.vb; break;
      default: v = Math.log10(d < c.soil ? 80 : d < c.bed ? (d > c.wt ? 30 : 120) : 900 * Math.pow(10, c.lith - 0.5)); // res / emi in log10 ohm.m
    }
    for (const f of fs) {
      const o = this.occ(f, x, z, d); if (o <= 0) continue;
      const p = f.props, g = f.grade * o;
      switch (sensor) {
        case 'mag': v += (p.mag / 60) * g; break;
        case 'gpr': v += p.gpr * 10 * g; break;
        case 'gamma': v += (p.K / 1.5 + p.U / 3 + p.Th / 10) * g; break;
        case 'ip': v += p.ip * 1.4 * g; break;
        case 'seis': v += p.vel * 2 * g; break;
        default: v += p.res * 1.6 * g;
      }
    }
    if (sensor === 'res') return Math.pow(10, v);
    if (sensor === 'emi') return 1000 / Math.pow(10, v);
    return v;
  }
  /** per-column constants for property() */
  column(x, z) {
    const lith = this.lith(x, z), wet = this.wet(x, z);
    return { fs: this.near(x, z), lith, wet, bed: this.bedrock(x, z), soil: 0.35 + 0.7 * noise2(x / 20, z / 20, 606), wt: Math.max(0.4, 1 + 7 * (1 - wet) * noise2(x / 60, z / 60, 707)), vb: 2600 + 1800 * lith };
  }

  /** buried point scatterers (boulders, cavities, deposit-top blocks) that make GPR diffraction hyperbolas */
  scatterers(x, z, r) {
    const out = [], c = 12;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) {
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
        const h = (s) => noise2(i * 7.13 + s, j * 3.71 - s, 909 + s * 13) ; // deterministic per cell
        const n = h(0) > 0.55 ? 2 : h(0) > 0.3 ? 1 : 0;
        for (let k = 0; k < n; k++) out.push({ x: (i + h(k + 1)) * c, z: (j + h(k + 4)) * c, d: 0.4 + 3.2 * h(k + 7), a: 0.25 + 0.2 * h(k + 9) });
      }
    }
    for (const f of this.near(x, z)) {
      if (Math.abs(f.props.gpr) < 0.3) continue;
      const n = f.type === 'void' ? 1 : 4;
      for (let k = 0; k < n; k++) {
        const a = k * 1.7 + f.id, rr = n === 1 ? 0 : f.R * 0.45;
        out.push({ x: f.x + Math.cos(a) * rr, z: f.z + Math.sin(a) * rr, d: f.depth + (n === 1 ? f.thick * 0.5 : 0.1), a: Math.abs(f.props.gpr) * (n === 1 ? 2.2 : 0.9) });
      }
    }
    return out;
  }

  /**
   * One GPR trace (A-scan) at (x, z): `out[n]` reflection amplitude over 0..maxD metres. Horizontal interfaces
   * (soil base, water table, bedrock, body top / bottom) give flat bands; point scatterers give hyperbolas across
   * neighbouring traces; conductive ground eats the signal with depth.
   */
  gprTrace(x, z, n, maxD, out, scat) {
    const c = this.column(x, z), ec = 4 + 14 * (1 - c.lith) + 30 * c.wet, alpha = 0.12 + ec / 70;
    out.fill(0);
    const ricker = (d0, amp) => {
      const lam = 0.22;
      for (let i = Math.max(0, Math.floor(((d0 - 3 * lam) / maxD) * n)); i < Math.min(n, Math.ceil(((d0 + 3 * lam) / maxD) * n)); i++) {
        const t = (i / n) * maxD - d0, a = (Math.PI * t) / lam, a2 = a * a;
        out[i] += amp * (1 - 2 * a2 * 0.5) * Math.exp(-a2 * 0.5);
      }
    };
    ricker(0.06, 1.4); // the direct (air / ground) wave
    ricker(c.soil, 0.35);
    if (c.wt < c.bed) ricker(c.wt, 0.45);
    ricker(c.bed, 0.6);
    for (const f of c.fs) {
      if (!f.props.gpr) continue;
      const o = this.occ(f, x, z, f.depth + f.thick * 0.5);
      if (o > 0.05) { ricker(f.depth, f.props.gpr * f.grade * o * 1.1); ricker(f.depth + f.thick, -f.props.gpr * f.grade * o * 0.6); }
    }
    for (const s of scat) {
      const r = Math.hypot(s.x - x, s.z - z); if (r > 4.5) continue;
      const sl = Math.hypot(s.d, r);
      ricker(sl, s.a * (s.d / sl) * Math.exp(-r * 0.25));
    }
    for (let i = 0; i < n; i++) { const d = (i / n) * maxD; out[i] *= Math.exp(-alpha * d); }
    return c;
  }

  /** the body a dig at (x, z) reaches, if any (closest in normalised distance) */
  bodyAt(x, z, layer = this.layer) {
    const keep = this.layer; this.layer = layer;
    let best = null, bq = 0.9;
    for (const f of this.near(x, z)) { const q = this.reff(f, x, z) / f.R; if (q < bq) { bq = q; best = f; } }
    this.layer = keep;
    return best;
  }
}

let GEO = null;
/** the world's geology (built on first use, after the terrain exists) */
export function getGeology() { return (GEO ??= new Geology()); }
