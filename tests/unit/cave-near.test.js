import { describe, it, expect } from 'vitest';
import { makeCave } from '../../src/engine/world/cave.js';
describe('cave.near (terrain cutout footprint)', () => {
  const cave = makeCave({ segments: [{ x0: 0, z0: 0, x1: 30, z1: 0, w: 6 }], cell: 3, floorY: 0 });
  it('includes the open cells and the 1 m wall band, but nothing further out', () => {
    expect(cave.near(10, 0, 1.2)).toBe(true);
    expect(cave.near(10, 3.6, 1.2)).toBe(true); // wall band (open edge is at z = 3)
    expect(cave.near(10, 5.5, 1.2)).toBe(false); // 2.5 m from the open edge: leave the terrain alone
  });
});
