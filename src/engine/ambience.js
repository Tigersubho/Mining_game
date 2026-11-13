const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** 0 outdoors .. 1 deep inside a cave (ramps over the first 14 m so the portal fades smoothly) */
export const caveFactor = (depthIntoCave) => clamp(depthIntoCave / 14, 0, 1);
export const blend = (f, outdoor, indoor) => outdoor + (indoor - outdoor) * f;

/** metres inside any cave at (x,z,y), or 0. `y` must be within the tunnel's height band (not on the hill above it) */
export function insideCave(caves, x, z, y) {
  for (const c of caves) {
    if (y < c.floorY - 1 || y > c.floorY + c.height + 1) continue;
    if (c.open(x, z)) return c.depth(x, z);
  }
  return 0;
}

/**
 * Light + fog for a camera `depth` metres under the surface (<= 0 = in air).
 * f: 1 underwater, light: multiplier for sun/ambient, fog: fog density
 */
export function underwaterOptics(depth) {
  if (depth <= 0) return { f: 0, light: 1, fog: 0 };
  return { f: 1, light: Math.max(0.03, Math.exp(-depth * 0.09)), fog: 0.035 + 0.1 * (1 - Math.exp(-depth * 0.05)) };
}
