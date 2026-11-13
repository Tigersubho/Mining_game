import { describe, it, expect } from 'vitest';
import { along, wagonPose } from '../../src/engine/world/rail.js';

const line = [[0, 0], [0, 50], [30, 80]]; // 50 m north, then a 42 m diagonal
const total = 50 + Math.hypot(30, 30);

describe('wagons on the track', () => {
  it('along() walks the polyline, round the corner', () => {
    expect(along(line, 25)).toEqual({ x: 0, z: 25 });
    const p = along(line, 50 + Math.hypot(30, 30) / 2); expect(p.x).toBeCloseTo(15, 5); expect(p.z).toBeCloseTo(65, 5);
  });
  it('sits on a straight, level track: centred, pointing along it, wheels on the rail head', () => {
    const p = wagonPose([[0, 0], [0, 100]], 100, 30, () => 2);
    expect(p.x).toBeCloseTo(0, 5); expect(p.z).toBeCloseTo(70, 5); expect(p.yaw).toBeCloseTo(0, 5); expect(p.pitch).toBeCloseTo(0, 5); expect(p.y).toBeCloseTo(2.36, 5);
  });
  it('follows the bend: yawed along the line between its two bogies', () => {
    const p = wagonPose(line, total, 14); // near the diagonal
    expect(p.yaw).toBeGreaterThan(0.1); expect(p.yaw).toBeLessThan(Math.PI / 4 + 0.01);
  });
  it('tilts with the slope (nose up when the front bogie is higher) and never faces backwards', () => {
    const p = wagonPose([[0, 0], [0, 100]], 100, 30, (x, z) => z * 0.1);
    expect(p.pitch).toBeLessThan(-0.05); expect(p.yaw).toBeCloseTo(0, 5);
  });
});