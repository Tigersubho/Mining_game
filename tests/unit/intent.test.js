import { describe, it, expect } from 'vitest';
import { moveVector, speedFor, bearingDeg, lerpAngle } from '../../src/engine/player/intent.js';

const near = (a, b) => expect(a).toBeCloseTo(b, 5);

describe('moveVector (camera relative)', () => {
  it('camera yaw 0 looks toward -Z: forward = -Z, right = +X', () => {
    const f = moveVector({ x: 0, y: 1 }, 0); near(f.x, 0); near(f.z, -1);
    const r = moveVector({ x: 1, y: 0 }, 0); near(r.x, 1); near(r.z, 0);
  });
  it('rotating the camera rotates the controls with it', () => {
    const f = moveVector({ x: 0, y: 1 }, -Math.PI / 2); // camera looks +X
    near(f.x, 1); near(f.z, 0);
    const b = moveVector({ x: 0, y: -1 }, Math.PI); // camera looks +Z, backwards = -Z
    near(b.x, 0); near(b.z, -1);
  });
  it('preserves analog magnitude', () => {
    const v = moveVector({ x: 0, y: 0.5 }, 0); near(Math.hypot(v.x, v.z), 0.5);
  });
});

describe('speedFor', () => {
  it('walk < sprint, swim and wading are slower, swinging slows you down', () => {
    const w = speedFor({}), s = speedFor({ sprint: true });
    expect(s).toBeGreaterThan(w);
    expect(speedFor({ swimming: true })).toBeLessThan(w);
    expect(speedFor({ wading: true, sprint: true })).toBeLessThan(s);
    expect(speedFor({ swinging: true })).toBeLessThan(w);
  });
});

describe('bearingDeg (compass: north = -Z, east = +X)', () => {
  it('maps camera yaw to a 0..360 bearing', () => {
    near(bearingDeg(0), 0); // looking -Z = north
    near(bearingDeg(-Math.PI / 2), 90); // looking +X = east
    near(bearingDeg(Math.PI), 180); // looking +Z = south
    near(bearingDeg(Math.PI / 2), 270); // looking -X = west
    near(bearingDeg(-10 * Math.PI), 0 + 0); // wraps
  });
});

describe('lerpAngle', () => {
  it('takes the short way round', () => {
    const a = lerpAngle(3.0, -3.0, 0.5); // 3.0 -> -3.0 is a ~0.28 rad turn across the +-PI seam
    expect(Math.abs(a - Math.PI)).toBeLessThan(0.2);
  });
});
