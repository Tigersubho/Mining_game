import { describe, it, expect } from 'vitest';
import { npcHeight } from '../../src/engine/agents/npcs.js';

describe('where a person stands', () => {
  it('on dry ground: the ground', () => { expect(npcHeight('walk', 1.5, -0.2, 0)).toEqual({ y: 1.5, swim: false }); });
  it('in shallow water: still wading on the bottom', () => { expect(npcHeight('walk', -0.5, -0.2, 0).swim).toBe(false); });
  it('where the ground is deep under water: floating at the surface, swimming (never on the bed)', () => {
    const r = npcHeight('walk', -4, -0.2, 0); expect(r.swim).toBe(true); expect(r.y).toBeGreaterThan(-1.3); expect(r.y).toBeLessThan(0);
  });
  it('divers go down with their depth and come back to the surface at depth 0', () => {
    expect(npcHeight('dive', 0, -0.2, 8).y).toBeCloseTo(-9.1, 5);
    const up = npcHeight('dive', 0, -0.2, 0); expect(up.y).toBeCloseTo(-1.1, 5); expect(up.swim).toBe(false);
  });
});