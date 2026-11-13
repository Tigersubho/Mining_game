import { describe, it, expect } from 'vitest';
import { caveFactor, blend, insideCave } from '../../src/engine/ambience.js';

describe('cave ambience', () => {
  it('is 0 outside / at the portal and ramps to 1 deeper in', () => {
    expect(caveFactor(0)).toBe(0);
    expect(caveFactor(7)).toBeCloseTo(0.5, 5);
    expect(caveFactor(40)).toBe(1);
    expect(caveFactor(-3)).toBe(0);
  });
  it('blend interpolates between outdoor and indoor values', () => {
    expect(blend(0, 1.0, 0.1)).toBe(1.0);
    expect(blend(1, 1.0, 0.1)).toBeCloseTo(0.1, 5);
    expect(blend(0.5, 2, 0)).toBe(1);
  });
  it('insideCave only counts when the player is within the tunnel height band', () => {
    const cave = { floorY: 10, height: 3.8, open: (x) => x > 0, depth: (x) => x };
    expect(insideCave([cave], 5, 0, 10)).toBe(5);
    expect(insideCave([cave], 5, 0, 30)).toBe(0); // standing on top of the mountain
    expect(insideCave([cave], -5, 0, 10)).toBe(0); // not in the open cells
    expect(insideCave([], 5, 0, 10)).toBe(0);
  });
});
