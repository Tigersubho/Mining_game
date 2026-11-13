/** Pure water-state logic for the player. */
export const WATER = { headHeight: 1.6, wadeMax: 1.2, dryBelow: 0.2 };

/**
 * dry | wading | surface | dive
 *   feetY : player feet height     level : water surface height here
 *   bedY  : solid ground height under the player (-Infinity if none)
 *   prev  : previous state (hysteresis)   wantDown : player is pushing "descend"
 */
export function waterState({ feetY, level, bedY, prev = 'dry', wantDown = false }) {
  if (feetY >= level - 0.05 && feetY > bedY - 0.05 && level - bedY <= WATER.dryBelow) return 'dry';
  const groundDepth = level - bedY;
  const standing = feetY - bedY < 0.3; // feet on / near the ground
  if (feetY > level) return 'dry'; // on a bridge, deck, roof ...
  if (groundDepth <= WATER.dryBelow) return 'dry';
  if (standing && groundDepth < (prev === 'wading' ? WATER.wadeMax + 0.3 : WATER.wadeMax)) return 'wading';
  const headUnder = feetY + WATER.headHeight < level - (prev === 'dive' ? -0.1 : 0.0);
  if (headUnder) return 'dive';
  if (wantDown) return 'dive';
  return 'surface';
}
