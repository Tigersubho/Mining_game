import { heightAt, waterLevelAt } from '../world/terrain.js';
import { BRIDGES, bridgeDeckY } from '../world/layout.js';

/**
 * Water safety for road vehicles. A spot is WET when water stands deeper than `tol` above the ground a car would sit
 * on; a bridge deck is always dry. Cars on rails never get routed through wet spots (checked in tests), and anything
 * that does end up in water (a car you abandoned, a physics shove) is recovered by these helpers.
 */
export const WET_TOL = 0.25;

export function wetAt(x, z, tol = WET_TOL) {
  if (bridgeDeckY(x, z) !== null) return false;
  return waterLevelAt(x, z) - heightAt(x, z) > tol;
}

/** true if any point of the straight line a -> b (sampled every `step` m) is wet */
export function lineWet(ax, az, bx, bz, step = 3) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
  for (let i = 0; i <= n; i++) if (wetAt(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n)) return true;
  return false;
}

/**
 * The way from (x, z) to (tx, tz) when water is in between: waypoints through the cheapest bridge (approach point,
 * far-end point) whose approaches are dry. Returns [] when the straight line is already dry.
 */
export function planCrossing(x, z, tx, tz) {
  if (!lineWet(x, z, tx, tz)) return [];
  let best = null;
  for (const b of BRIDGES) {
    const hl = b.length / 2;
    const ends = [[b.x - b.dirx * (hl + 6), b.z - b.dirz * (hl + 6)], [b.x + b.dirx * (hl + 6), b.z + b.dirz * (hl + 6)]];
    for (const [A, B] of [[ends[0], ends[1]], [ends[1], ends[0]]]) {
      let cost = Math.hypot(A[0] - x, A[1] - z) + b.length + Math.hypot(tx - B[0], tz - B[1]);
      if (lineWet(x, z, A[0], A[1])) cost += 400; // prefer approaches that are dry
      if (lineWet(B[0], B[1], tx, tz)) cost += 400;
      if (!best || cost < best.cost) best = { cost, way: [A, B] };
    }
  }
  return best ? best.way : [];
}
