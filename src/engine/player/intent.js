/** Pure helpers for turning input into motion (no Three.js, no DOM). */
export const WALK = 5.4, SPRINT = 9.4, SWIM = 3.4;
const TAU = Math.PI * 2;

/** stick/keys {x: right, y: forward} + camera yaw -> world-space direction {x,z} (length = input length) */
export function moveVector({ x, y }, camYaw) {
  const s = Math.sin(camYaw), c = Math.cos(camYaw);
  // camera forward = (-s, -c), camera right = (c, -s)
  return { x: -s * y + c * x, z: -c * y - s * x };
}

export function speedFor({ sprint = false, swimming = false, wading = false, swinging = false } = {}) {
  let v = sprint ? SPRINT : WALK;
  if (swimming) return SWIM;
  if (wading) v *= 0.75;
  if (swinging) v *= 0.45;
  return v;
}

/** compass bearing of the camera, degrees clockwise from north (north = -Z, east = +X) */
export function bearingDeg(camYaw) {
  return ((((-camYaw / TAU) % 1) + 1) % 1) * 360;
}

export function lerpAngle(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}
