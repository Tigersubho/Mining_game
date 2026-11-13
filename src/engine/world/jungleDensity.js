import { fbm } from '../noise.js';

/** low-frequency patches where the jungle is only lightly wooded (clearings, savanna-like glades) */
export const lightPatch = (x, z) => fbm(x * 0.007 + 50, z * 0.007 - 20, 2, 13) > 0.54;

/** chance a candidate tree site is kept: thin in light patches, thinner again beside the mud road (roadDist in metres) */
export function treeKept(x, z, r, roadDist) {
  let p = 1;
  if (lightPatch(x, z)) p *= 0.3;
  if (roadDist < 14) p *= 0.5;
  return r < p;
}
