import * as THREE from 'three';
import {
  DEG, LAND_Y, WATER_Y, BED_Y, POOL_R, ISLAND_R, RIVER_HALF, WORLD_R,
  LAKE, RIDGE, GROTTO, BRANCHES, SECTOR_ANGLES, PIT, PADS,
} from '../config.js';
import { clamp, lerp, smoothstep } from '../math.js';
import { noise2, fbm } from '../noise.js';

// ------------------------------------------------------------------ river
const BR = BRANCHES.map((a, i) => ({
  ux: Math.cos(a * DEG), uz: Math.sin(a * DEG),
  nx: -Math.sin(a * DEG), nz: Math.cos(a * DEG),
  phase: i * 2.1,
}));

export const meander = (along, i) => 10 * Math.sin(along * 0.022 + BR[i].phase) * smoothstep(30, 90, along);

/** point on the centre line of river branch i, `along` metres from the origin */
export function branchPoint(i, along, lateral = 0) {
  const b = BR[i];
  const m = meander(along, i) + lateral;
  return [b.ux * along + b.nx * m, b.uz * along + b.nz * m];
}
export const branchNormal = (i) => [BR[i].nx, BR[i].nz];
export const branchDir = (i) => [BR[i].ux, BR[i].uz];

/** signed distance (m) to the water edge. negative = inside the water */
export function riverS(x, z) {
  let s = Math.hypot(x, z) - POOL_R;
  for (let i = 0; i < 3; i++) {
    const b = BR[i];
    const along = x * b.ux + z * b.uz;
    if (along > 0) {
      const perp = x * b.nx + z * b.nz - meander(along, i);
      const sb = Math.abs(perp) - RIVER_HALF;
      if (sb < s) s = sb;
    }
  }
  s = Math.min(s, lakeS(x, z));
  return s + (noise2(x * 0.06 + 3.3, z * 0.06 - 1.7) - 0.5) * 4;
}

/** signed distance to the great lake's nominal shore (negative = inside) */
export const lakeS = (x, z) => Math.hypot(x - LAKE.x, z - LAKE.z) - LAKE.R;

// ---------------------------------------------------------------- regions
const _w = { city: 0, jungle: 0, construction: 0 };
function sector(th, c) {
  let d = Math.abs(th - c) % 360;
  if (d > 180) d = 360 - d;
  const t = clamp((80 - d) / 40, 0, 1);
  return t * t * (3 - 2 * t);
}
/** shared output object - read immediately! */
export function regionWeights(x, z, out = _w) {
  const th = Math.atan2(z, x) / DEG;
  out.city = sector(th, SECTOR_ANGLES.city);
  out.jungle = sector(th, SECTOR_ANGLES.jungle);
  out.construction = sector(th, SECTOR_ANGLES.construction);
  return out;
}

// -------------------------------------------------------------------- pit
export function pitDelta(x, z) {
  const dx = x - PIT.x, dz = z - PIT.z;
  const d = Math.hypot(dx, dz);
  if (d > PIT.R + 16) return 0;

  const t = clamp((1 - d / PIT.R) / (1 - PIT.floorFrac) , 0, 1);
  const q = t * 4;
  const base = Math.floor(q);
  const sm = base >= 4 ? 0 : smoothstep(0.55, 1.0, q - base);
  const depth = (PIT.depth * (base + sm)) / 4;

  // spoil berm around the rim
  let berm = 0;
  if (d > PIT.R - 2) berm = 2.2 * Math.exp(-(((d - (PIT.R + 6)) / 5) ** 2));

  // haul ramp cut towards the hub
  const along = dx * PIT.vx + dz * PIT.vz;
  const perp = Math.abs(dx * PIT.nx + dz * PIT.nz);
  const m = (1 - smoothstep(4.5, 10, perp)) * smoothstep(-12, -2, along);
  const floorR = PIT.R * PIT.floorFrac;
  const rampDepth = PIT.depth * clamp((PIT.R + 2 - Math.max(along, 0)) / (PIT.R + 2 - floorR), 0, 1);

  const pitH = -depth + berm * (1 - m);
  const rampH = Math.max(pitH, -rampDepth);
  return lerp(pitH, rampH, m);
}

// ------------------------------------------------------------------ height
function rawHeight(x, z) {
  const r = Math.hypot(x, z);
  const w = regionWeights(x, z);
  const s = riverS(x, z);
  const far = smoothstep(14, 55, s) * smoothstep(30, 70, r);

  let h = LAND_Y;
  const outer = smoothstep(240, 330, r); // 0 inside the core village, 1 in the wilds
  if (w.jungle > 0.001) {
    const n = (fbm(x * 0.011 + 11, z * 0.011 - 7, 4) - 0.5) * 2;
    const hills = (n > 0 ? n * 11 : n * 1.5) * (1 + outer * 1.8);
    const ridges = Math.max(0, fbm(x * 0.035, z * 0.035, 3, 5) - 0.52) * 14;
    h += w.jungle * (hills + ridges) * far;
  }
  if (w.construction > 0.001) {
    h += w.construction * (fbm(x * 0.04, z * 0.04, 3, 3) - 0.5) * 1.4 * far;
  }
  if (outer > 0) { // wilderness: rolling plains out of the city, rugged highlands out of the construction sector
    h += outer * w.city * (fbm(x * 0.008 + 5, z * 0.008, 4, 7) - 0.5) * 22;
    h += outer * w.construction * Math.max(0, fbm(x * 0.012 - 9, z * 0.012 + 4, 4, 8) - 0.38) * 70;
  }
  h += RIDGE.height * Math.exp(-(((x - RIDGE.x) ** 2 + (z - RIDGE.z) ** 2) / (RIDGE.R * RIDGE.R))) * (0.9 + 0.2 * fbm(x * 0.03, z * 0.03, 3, 12));
  h += pitDelta(x, z);

  // mountain rim closing the world
  h += 60 * smoothstep(WORLD_R - 2, WORLD_R + 24, r);

  // river bed
  const k = (1 - smoothstep(-5, 8, s)) * (1 - smoothstep(WORLD_R - 12, WORLD_R + 6, r));
  h = lerp(h, BED_Y, k);
  // the great lake: a deep basin under the nominal shore
  const lu = clamp((-lakeS(x, z) - 2) / (0.8 * LAKE.R), 0, 1);
  if (lu > 0) h -= (h - (WATER_Y - LAKE.depth)) * lu * lu * (3 - 2 * lu);

  // hub island
  if (r < ISLAND_R + 6) {
    const ih = 2.0 + (BED_Y - 2.0) * smoothstep(ISLAND_R, ISLAND_R + 4, r);
    h = Math.max(h, ih);
  }

  // micro detail (not on the flat city / island)
  const detail = (fbm(x * 0.18, z * 0.18, 2, 9) - 0.5) * 0.35 * (1 - w.city) * smoothstep(ISLAND_R + 6, ISLAND_R + 16, r);
  return h + detail;
}

export function heightAt(x, z) {
  let h = rawHeight(x, z);
  for (const p of PADS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r + p.blend) {
      if (p.h === undefined) p.h = rawHeight(p.x, p.z);
      h = lerp(h, p.h, 1 - smoothstep(p.r, p.r + p.blend, d));
    }
  }
  return h;
}

/** the open pit is flooded to this level (below the rim, above its floor) */
export const PIT_WATER_Y = -6;
/** surface height of the water body at (x,z) */
export const waterLevelAt = (x, z) => (Math.hypot(x - PIT.x, z - PIT.z) < PIT.R + 2 ? PIT_WATER_Y : WATER_Y);

/** terrain cutouts (cave mouths). registerHole(fn(x,z) => floorY | null): the visual mesh AND the collision have a true hole there */
const HOLES = [];
export const registerHole = (fn) => HOLES.push(fn);
export function holeFloorAt(x, z) { for (const f of HOLES) { const y = f(x, z); if (y !== null) return y; } return null; }
export const cellHeld = (x, z) => holeFloorAt(x, z) !== null;

export function regionName(x, z) {
  const r = Math.hypot(x, z);
  if (r < POOL_R + 6) return 'Mining Haven Hub';
  if (lakeS(x, z) < 3) return 'Great Lake';
  if (Math.hypot(x - RIDGE.x, z - RIDGE.z) < RIDGE.R * 1.1) return 'Ridge Mine Highlands';
  const s = riverS(x, z);
  if (s < 2) return 'The River';
  if (Math.hypot(x - PIT.x, z - PIT.z) < PIT.R - 4) return 'Open-Pit Mine';
  const w = regionWeights(x, z);
  if (w.city >= w.jungle && w.city >= w.construction) return 'Central City';
  if (w.jungle >= w.construction) return 'Dense Jungle';
  return 'Construction Site';
}

// ------------------------------------------------------------------ colour
const C = (h) => new THREE.Color(h);
const cCity = C(0xa9acb0), cPlaza = C(0xcfc7b4), cPlazaDark = C(0x8f8574), cPlazaGold = C(0xc9a24b);
const cMeadow = C(0x7aa457), cMeadow2 = C(0x95b66a);
const cJ1 = C(0x2f6c2b), cJ2 = C(0x428f35), cJ3 = C(0x20502a), cJ4 = C(0x5f8a3a);
const cK1 = C(0xb99865), cK2 = C(0x9f7e53);
const cSnow = C(0xe8ecee), cSand = C(0xd2c08f), cBed = C(0x56655a), cRock = C(0x7d756b), cRockD = C(0x544e48);
const pitBands = [0xb98a5c, 0xa6764a, 0x93694a, 0x7c6150, 0x685a50].map(C);
const _t = new THREE.Color();

export function colorAt(x, z, h, out) {
  const r = Math.hypot(x, z);
  const w = regionWeights(x, z);
  const wc = w.city, wj = w.jungle, wk = w.construction;
  const s = riverS(x, z);

  // city
  // the city sector is paving only inside the city; the plains beyond it are meadow (where the farms are)
  const urban = wc * (1 - smoothstep(232, 296, r));
  out.copy(cCity).multiplyScalar(0.96 + noise2(x * 0.3, z * 0.3, 4) * 0.08).multiplyScalar(urban);
  if (wc > urban) { _t.copy(cMeadow).lerp(cMeadow2, clamp(fbm(x * 0.03 + 9, z * 0.03, 3, 14) * 1.7 - 0.35, 0, 1)); out.add(_t.multiplyScalar(wc - urban)); }
  // jungle
  const n1 = fbm(x * 0.04, z * 0.04, 3, 2);
  const n2 = fbm(x * 0.09 + 40, z * 0.09, 2, 8);
  _t.copy(cJ1).lerp(cJ2, clamp(n1 * 1.6 - 0.4, 0, 1)).lerp(cJ3, smoothstep(0.55, 0.8, n2) * 0.8).lerp(cJ4, smoothstep(0.62, 0.9, n1) * 0.5);
  out.add(_t.multiplyScalar(wj));
  // construction
  _t.copy(cK1).lerp(cK2, clamp(fbm(x * 0.05, z * 0.05, 3, 6) * 1.5 - 0.3, 0, 1)).multiplyScalar(wk);
  out.add(_t);

  // pit terraces
  const dp = -pitDelta(x, z);
  if (dp > 0.05) {
    const band = Math.min(4, Math.floor(dp / (PIT.depth / 4) + 0.2));
    out.lerp(pitBands[band], smoothstep(0.1, 1.2, dp));
  } else if (dp < -0.3) {
    out.lerp(cRockD, 0.45); // berm = dark spoil
  }

  // sandy banks + mud under water
  if (s < 10) {
    const sand = smoothstep(1.3, 0.2, h) * smoothstep(-8, -1, s) ;
    out.lerp(cSand, clamp(sand * 0.95, 0, 1) * (1 - wc * 0.0));
    if (h < WATER_Y) out.lerp(cBed, smoothstep(-0.2, -1.6, h) * 0.8);
  }

  // altitude: bare rock then snow on the high ground
  out.lerp(cRock, smoothstep(24, 44, h) * 0.85);
  if (h > 64) out.lerp(cSnow, smoothstep(64, 76, h) * 0.9);

  // hub plaza
  if (r < ISLAND_R + 1.5) {
    const ring = Math.abs(((r * 1.1) % 2.2) - 1.1) < 0.12 ? 1 : 0;
    _t.copy(cPlaza).lerp(cPlazaDark, ring * 0.7);
    if (r < 4) _t.lerp(cPlazaGold, 0.35);
    if (r > ISLAND_R - 0.6) _t.copy(cPlazaDark);
    out.lerp(_t, 1 - smoothstep(ISLAND_R - 0.5, ISLAND_R + 1.5, r));
  }

  // mountain ring
  if (r > WORLD_R - 12) {
    const rock = noise2(x * 0.15, z * 0.15, 3) * 0.5 + 0.5;
    _t.copy(cRock).lerp(cRockD, rock * 0.8);
    out.lerp(_t, smoothstep(WORLD_R - 12, WORLD_R + 6, r));
  }
  return out;
}


// the Ridge Mine apron height (after pads): tunnels are authored relative to it
RIDGE.mouth.y = heightAt(RIDGE.mouth.x, RIDGE.mouth.z);
GROTTO.mouth.y = heightAt(GROTTO.mouth.x, GROTTO.mouth.z);



