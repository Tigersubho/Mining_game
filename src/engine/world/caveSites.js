import { RIDGE, GROTTO } from '../config.js';
import { heightAt, registerHole } from './terrain.js';
import { makeCave, addCaveColliders } from './cave.js';
import { signMesh } from './textures.js';
import { mulberry32 } from '../noise.js';

/**
 * Mineral deposits along every tunnel (positions relative to the mouth). Tunnels get one deposit every step metres,
 * alternating sides and kept clear of the middle so the way stays open; stopes and chambers (wide segments) are filled in a grid.
 * Richer in gold the deeper it goes.
 */
export function oreAlong(segments, { step = 6.5, seed = 5, reach = 150 } = {}) {
  const rng = mulberry32(seed), out = [];
  const kind = (x) => { const d = Math.min(1, Math.max(0, x) / reach), r = rng(); return r < 0.06 + 0.26 * d ? 'gold' : r < 0.42 ? 'chalcopyrite' : r < 0.72 ? 'malachite' : 'hematite'; };
  for (const s of segments) {
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    if (len < 1) continue;
    const ux = (s.x1 - s.x0) / len, uz = (s.z1 - s.z0) / len, nx = -uz, nz = ux;
    const at = (t, l) => [s.x0 + ux * t + nx * l + (rng() - 0.5) * 0.8, s.z0 + uz * t + nz * l + (rng() - 0.5) * 0.8];
    if (s.w <= 6) {
      let side = rng() < 0.5 ? 1 : -1;
      for (let t = 4; t < len - 2; t += step) { const [x, z] = at(t, side * (s.w / 2 - 1.25)); out.push([x, z, kind(x)]); side = -side; }
    } else {
      const lim = s.w / 2 - 2.2;
      for (let t = -s.w / 2 + 2.5; t <= len + s.w / 2 - 2.5; t += 5) for (let l = -lim; l <= lim + 0.01; l += 5) { const [x, z] = at(t, l); out.push([x, z, kind(x)]); }
    }
  }
  return out;
}

/** distance from (x, z) to a tunnel segment's centre line (0 inside it along its axis) */
const axisDist = (s, x, z) => Math.hypot(Math.max(Math.min(s.x0, s.x1) - x, 0, x - Math.max(s.x0, s.x1)), Math.max(Math.min(s.z0, s.z1) - z, 0, z - Math.max(s.z0, s.z1)));

/**
 * Dress a cave so it reads as a cave in the dark: stalactites hang from the ceiling, stalagmites rise from the floor (never in the
 * walking lane of a corridor), and clusters of softly glowing crystals sit against the walls (they catch the eye at the edge of the headlamp beam).
 */
export function decorate(c, def, B, G) {
  const rng = mulberry32(def.decor === 'mine' ? 71 : 113), f = c.floorY, h = c.height, area = c.floors.reduce((s, q) => s + q.hx * q.hz, 0);
  const rockCol = def.decor === 'grotto' ? [0x5b6355, 0x4d5547, 0x667064] : [0x6d665d, 0x5e5851, 0x7a7266];
  const lane = (x, z) => c.segments.some((s) => s.w <= 6 && axisDist(s, x, z) < 1.7);
  const spot = () => { let u = rng() * area, q = c.floors[0]; for (const r of c.floors) { u -= r.hx * r.hz; q = r; if (u <= 0) break; } return [q.x + (rng() * 2 - 1) * q.hx, q.z + (rng() * 2 - 1) * q.hz]; };
  const place = (n, fn, tries = 40) => { let made = 0; for (let k = 0; k < n * tries && made < n; k++) { const [x, z] = spot(); if (c.open(x, z) && fn(x, z)) made++; } };
  const col = rockCol[1];
  place(Math.round(area / 22), (x, z) => { const len = 0.5 + rng() * 1.3; B.cyl(x, f + h - len / 2, z, 0.18 + rng() * 0.16, 0.02, len, rockCol[Math.floor(rng() * 3)], 5); return true; }); // stalactites
  place(Math.round(area / 40), (x, z) => { if (lane(x, z)) return false; const len = 0.4 + rng() * 1.1; B.cyl(x, f + len / 2, z, 0.02, 0.16 + rng() * 0.2, len, col, 5); return true; }); // stalagmites
}

const ROCK = [0x4d4944, 0x57524b, 0x44403b];
const ALGAE = [0x39463a, 0x435240, 0x2f3b2d];

/**
 * A cave site = a tunnel network entered from a hillside portal (always heading +X).
 * One factory serves the dry Ridge Mine and the flooded lake grotto.
 *   def: { name, mouth:{x,z,y}, reach, decor:'mine'|'grotto', batch, segments(seg), ore:[[dx,dz,type]] }
 */
function makeSite(def) {
  let cave = null, registered = false;
  const site = {
    def,
    cave() {
      if (cave) return cave;
      const { x: mx, z: mz, y } = def.mouth;
      const seg = (x0, z0, x1, z1, w) => ({ x0: mx + x0, z0: mz + z0, x1: mx + x1, z1: mz + z1, w });
      cave = makeCave({ cell: 3, floorY: y, height: 3.8, entry: { x: mx - 9, z: mz, w: 6 }, segments: def.segments(seg) });
      return cave;
    },
    /** world rectangle whose terrain collision is a triangle mesh with holes */
    zone() { const { x, z } = def.mouth; return { x0: x - 30, z0: z - 88, x1: x + 180, z1: z + 88 }; },
    /** cut the terrain visuals / collision where the portal meets the hillside */
    registerHoles() {
      if (registered) return;
      registered = true;
      const c = site.cave();
      registerHole((x, z) => (c.near(x, z, 1.2) && heightAt(x, z) < c.floorY + c.height + 2.5 ? c.floorY : null));
    },
    build(ctx) {
      const c = site.cave(), { col, scene } = ctx, B = ctx.b[def.batch], G = ctx.glow;
      const { x: mx, z: mz } = def.mouth, f = c.floorY, h = c.height, rock = def.decor === 'grotto' ? ALGAE : ROCK;
      addCaveColliders(col, c);

      for (const r of c.floors) {
        B.box(r.x, f - 0.5, r.z, r.hx * 2, 1, r.hz * 2, def.decor === 'grotto' ? 0x4a4f40 : 0x57524a);
        B.box(r.x, f + h + 0.5, r.z, r.hx * 2, 1, r.hz * 2, 0x3a3733);
      }
      let n = 0;
      for (const w of c.walls) {
        B.box(w.x, f + h / 2, w.z, w.hx * 2, h + 1, w.hz * 2, rock[n++ % 3]);
        const along = w.hx > w.hz, len = (along ? w.hx : w.hz) * 2; // rough lumps on the inside face
        for (let t = 1; t < len; t += 2.6) {
          const px = along ? w.x - w.hx + t : w.x, pz = along ? w.z : w.z - w.hz + t;
          const nx = along ? 0 : (c.open(w.x + 1.6, w.z) ? 0.55 : -0.55), nz = along ? (c.open(w.x, w.z + 1.6) ? 0.55 : -0.55) : 0;
          B.sph(px + nx, f + 0.5 + ((t * 7.3) % (h - 1)), pz + nz, 0.45 + ((t * 3.1) % 0.5), rock[Math.floor(t) % 3], 1, 0.8, 1, 0);
        }
      }

      if (def.decor === 'mine') {
        for (let x = mx - 6; x < mx + 148; x += 6) { // timber supports + lamps along the main adit
          for (const s of [-1, 1]) B.box(x, f + h / 2, mz + s * 2.65, 0.32, h, 0.32, 0x6b4a2b);
          B.box(x, f + h - 0.2, mz, 0.36, 0.36, 6, 0x6b4a2b);
          if ((x - mx) % 12 === 0) G.box(x, f + h - 0.5, mz + 2.4, 0.5, 0.18, 0.5, 0xffe2a8);
        }
        for (let x = mx - 9; x < mx + 150; x += 1.6) B.box(x, f + 0.06, mz, 0.22, 0.12, 2.2, 0x4a3a28);
        for (const s of [-1, 1]) B.box(mx + 70.5, f + 0.15, mz + s * 0.7, 159, 0.1, 0.1, 0x9aa0a6);
        B.box(mx + 48, f + 0.8, mz, 2.2, 0.9, 1.4, 0x8a4a2a); B.box(mx + 48, f + 1.3, mz, 2.0, 0.2, 1.2, 0x2f8f6b); // ore cart
        for (const s of [-1, 1]) B.box(mx - 9, f + 2.4, mz + s * 3.6, 0.9, 5, 0.9, 0x8d8a82); // portal posts + lintel + sign
        B.box(mx - 9, f + 4.9, mz, 1.0, 0.9, 8.4, 0x8d8a82);
        const sign = signMesh([{ text: 'RIDGE MINE', size: 130 }, { text: 'HEADLAMP REQUIRED', size: 62, color: '#ffffff' }], 6, 1.9, { w: 1024, h: 324, bg: '#1a1d22' });
        sign.position.set(mx - 9.6, f + 4.9, mz); sign.rotation.y = -Math.PI / 2;
        scene.add(sign);
      } else {
        for (let x = mx + 6; x < mx + 80; x += 10) B.cyl(x, f + h / 2, mz + (x % 20 ? 1.6 : -1.6), 0.45, 0.6, h, 0x4a4f40, 7); // rock pillars
        for (let x = mx + 3; x < mx + 80; x += 15) G.sph(x, f + h - 0.6, mz + 2.2, 0.22, 0x9fe8ff, 1, 1, 1, 0); // glow-worm lamps
      }
      // the ore is no longer fixed: gameplay/mineralSpread.js re-rolls it every 15 minutes (so no oreSpots here); the cave is dressed instead
      decorate(c, def, B, G);
    },
  };
  return site;
}

export const ridge = makeSite({
  name: 'Ridge Mine', mouth: RIDGE.mouth, reach: 150, decor: 'mine', batch: 'ridge',
  segments: (seg) => [
    seg(-9, 0, 150, 0, 6), // main adit
    seg(66, 0, 66, -45, 6), seg(57, -54, 75, -54, 15), // gallery A + stope A
    seg(96, 0, 96, 45, 6), seg(84, 54, 108, 54, 15), // gallery B + stope B
    seg(141, 0, 159, 0, 30), // deep chamber
    seg(150, 0, 150, -60, 6), // gallery C (gold seam)
  ],
  ore: [[44, -2, 'malachite'], [118, 2, 'hematite'], [66, -40, 'chalcopyrite'], [60, -54, 'chalcopyrite'], [72, -56, 'malachite'], [96, 40, 'hematite'], [88, 54, 'chalcopyrite'],
    [104, 56, 'malachite'], [144, -10, 'hematite'], [156, 10, 'chalcopyrite'], [148, -56, 'gold'], [152, -50, 'gold'], [147, 8, 'gold']],
});

export const grotto = makeSite({
  name: 'Sunken Grotto', mouth: GROTTO.mouth, reach: 112, decor: 'grotto', batch: 'grotto',
  segments: (seg) => [
    seg(-9, 0, 112, 0, 6), // flooded main passage
    seg(57, 0, 57, -42, 6), seg(48, -50, 66, -50, 15), // side gallery + chamber
    seg(90, 0, 90, 42, 6), seg(81, 50, 99, 50, 15),
    seg(105, 0, 123, 0, 21), // deep chamber
  ],
  ore: [[40, 2, 'malachite'], [60, -46, 'gold'], [54, -52, 'chalcopyrite'], [90, 46, 'hematite'], [86, 54, 'gold'], [112, -4, 'gold'], [116, 6, 'chalcopyrite']],
});

export const SITES_LIST = [ridge, grotto];
