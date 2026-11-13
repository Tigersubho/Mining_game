import { DEG } from '../config.js';

/**
 * Farms: where they go and how they are laid out (pure geometry). A farm is six fields (3 x 2) with a farmyard (house, barn, silo) on
 * its south side, all inside a closed gravel track; an access road joins the track to the nearest main road, and a tractor works the
 * rows in a serpentine and returns along the track side.
 */
export const FARM = { cols: 2, rows: 2, fieldW: 36, fieldD: 28, gap: 4, rowGap: 2.2, trackHX: 52, trackZ0: -42, trackZ1: 70 };
export const FARM_W = FARM.cols * FARM.fieldW + (FARM.cols - 1) * FARM.gap; // 122
export const FARM_D = FARM.rows * FARM.fieldD + (FARM.rows - 1) * FARM.gap; // 64

/** rounded rectangle polyline (closed: the first point is repeated at the end) */
function roundedRect(cx, cz, x0, z0, x1, z1, r = 8, n = 4) {
  const pts = [], corner = (ox, oz, a0) => { for (let k = 0; k <= n; k++) { const a = (a0 + (90 * k) / n) * DEG; pts.push([ox + Math.cos(a) * r, oz + Math.sin(a) * r]); } };
  corner(cx + x1 - r, cz + z1 - r, 0); corner(cx + x0 + r, cz + z1 - r, 90); corner(cx + x0 + r, cz + z0 + r, 180); corner(cx + x1 - r, cz + z0 + r, 270);
  pts.push(pts[0]);
  return pts;
}

/** everything about a farm centred on (cx, cz) (the middle of the fields' block; the yard is south, +z) */
export function layoutFarm(cx, cz) {
  const x0 = cx - FARM_W / 2, z0 = cz - FARM_D / 2 - 6, fields = [];
  for (let r = 0; r < FARM.rows; r++) for (let c = 0; c < FARM.cols; c++) fields.push({ x0: x0 + c * (FARM.fieldW + FARM.gap), z0: z0 + r * (FARM.fieldD + FARM.gap), w: FARM.fieldW, d: FARM.fieldD, crop: (r * 3 + c * 2 + (Math.abs(Math.round(cx / 50)) % 5)) % 5 });
  const track = roundedRect(cx, cz, -FARM.trackHX, FARM.trackZ0, FARM.trackHX, FARM.trackZ1);
  const yardZ = z0 + FARM_D + 18;
  // the tractor: a serpentine through both strips of fields (rows along x), then back along the east side of the block
  const pass = [], rowsPer = Math.floor((FARM.fieldD - 5) / 4.5) + 1, lo = x0 - 3, hi = x0 + FARM_W + 3;
  let east = true;
  for (let r = 0; r < FARM.rows; r++) for (let k = 0; k < rowsPer; k++) {
    const z = z0 + r * (FARM.fieldD + FARM.gap) + 3 + k * 4.5;
    pass.push(east ? [lo, z] : [hi, z], east ? [hi, z] : [lo, z]);
    east = !east;
  }
  const last = pass.at(-1), back = [[last[0] + (last[0] > cx ? 5 : -5), last[1]], [last[0] + (last[0] > cx ? 5 : -5), pass[0][1]]];
  return {
    cx, cz, fields, track, x0, z0,
    house: { x: cx - 30, z: yardZ + 2, ry: 0 }, barn: { x: cx + 6, z: yardZ + 4, ry: 0 }, silo: { x: cx + 33, z: yardZ - 2 },
    rows: pass.concat(back).map(([x, z]) => [x, z]),
    bounds: { x0: cx - FARM.trackHX - 6, x1: cx + FARM.trackHX + 6, z0: cz + FARM.trackZ0 - 6, z1: cz + FARM.trackZ1 + 6 },
  };
}

/**
 * Pick farm sites. `env` = { site(cx, cz) -> roughness or null, free(x, z) (not city / pit / site / compound), roadDist(x, z) }.
 * A site needs dry, gently sloping ground at its centre (the engine then LEVELS it with a terrain pad), a clear 115 x 125 m footprint with no road
 * through it, and a main road 45-200 m away. Greedy by score, one
 * per sector first (so the farms are spread over the open land), at least 300 m apart. Returns [{ cx, cz, score }].
 */
export function pickFarmSites(env, want = 5) {
  const cands = [];
  for (let r = 240; r <= 680; r += 30) {
    for (let a = 0; a < 360; a += 360 / Math.max(10, Math.round((2 * Math.PI * r) / 14))) {
      const cx = Math.cos(a * DEG) * r, cz = Math.sin(a * DEG) * r;
      const rough = env.site(cx, cz); // dry, high enough, away from rivers, gently sloping: the ground is levelled for the farm, ponds inside it filled in
      if (rough === null) continue;
      let ok = true;
      for (let i = 0; i <= 6 && ok; i++) for (let j = 0; j <= 5 && ok; j++) {
        const x = cx - FARM.trackHX - 6 + (i * (2 * FARM.trackHX + 12)) / 6, z = cz + FARM.trackZ0 - 6 + (j * (FARM.trackZ1 - FARM.trackZ0 + 12)) / 5;
        if (!env.free(x, z) || env.roadDist(x, z) < 6) ok = false;
      }
      if (!ok) continue;
      const rd = env.roadDist(cx, cz);
      if (rd < 45 || rd > 200) continue;
      cands.push({ cx, cz, a, score: rough * 1.5 + Math.abs(rd - 90) * 0.02 });
    }
  }
  cands.sort((p, q) => p.score - q.score);
  const sector = (a) => (a >= 30 && a < 150 ? 'city' : a >= 150 && a < 270 ? 'jungle' : 'construction'), picked = [], used = new Map();
  for (const pass of [0, 1]) for (const c of cands) {
    if (picked.length >= want) break;
    if (picked.some((p) => Math.hypot(p.cx - c.cx, p.cz - c.cz) < 300)) continue;
    const s = sector(c.a);
    if (pass === 0 && used.has(s)) continue;
    picked.push(c); used.set(s, (used.get(s) ?? 0) + 1);
  }
  return picked;
}
