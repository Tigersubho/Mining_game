import { describe, it, expect } from 'vitest';
import { lightPatch, treeKept } from '../../src/engine/world/jungleDensity.js';
import { polar } from '../../src/engine/config.js';
import { mulberry32 } from '../../src/engine/noise.js';

describe('jungle density', () => {
  const pts = []; const rng = mulberry32(5);
  for (let i = 0; i < 4000; i++) pts.push(polar(60 + rng() * 150, 160 + rng() * 100));
  it('some parts of the jungle are lightly wooded (roughly a fifth to a half of it)', () => {
    const f = pts.filter(([x, z]) => lightPatch(x, z)).length / pts.length;
    expect(f).toBeGreaterThan(0.15); expect(f).toBeLessThan(0.5);
  });
  it('light patches keep far fewer trees than the dense jungle', () => {
    const r = mulberry32(9);
    const kept = (pred) => { let n = 0, t = 0; for (const [x, z] of pts.filter(([a, b]) => pred(a, b))) { t++; if (treeKept(x, z, r(), 100)) n++; } return n / t; };
    expect(kept((x, z) => lightPatch(x, z))).toBeLessThan(kept((x, z) => !lightPatch(x, z)) * 0.5);
  });
  it('trees thin out beside the mud road', () => {
    const r = mulberry32(3); let near = 0, far = 0;
    for (let i = 0; i < 3000; i++) { if (treeKept(-80, -80, r(), 5)) near++; if (treeKept(-80, -80, r(), 60)) far++; }
    expect(near).toBeLessThan(far * 0.7);
  });
});
