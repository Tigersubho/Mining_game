import { describe, it, expect } from 'vitest';
import { SITES_LIST } from '../../src/engine/world/caveSites.js';
import { heightAt, cellHeld, holeFloorAt } from '../../src/engine/world/terrain.js';

describe.each(SITES_LIST.map((s) => [s.def.name, s]))('cave site: %s', (_name, site) => {
  const cave = site.cave(), M = site.def.mouth;
  it('floor sits at the mouth apron height', () => { expect(cave.floorY).toBeCloseTo(M.y, 5); });
  it('the terrain meets the floor slab at the portal: no step or cliff on the approach', () => {
    for (const dx of [-14, -12, -9, -6, -3]) for (const dz of [-3, 0, 3]) expect(Math.abs(heightAt(M.x + dx, M.z + dz) - M.y)).toBeLessThan(0.8);
  });
  it('has a main adit, galleries and chambers (>= 300 cells)', () => { expect(cave.cells).toBeGreaterThan(300); });
  it('reaches its deep chamber', () => { expect(cave.open(M.x + site.def.reach, M.z)).toBe(true); });
  it('has >= 2 m of rock above the ceiling everywhere beyond the portal zone', () => {
    let worst = Infinity, n = 0;
    for (let x = M.x + 36; x < M.x + 170; x += 3) for (let z = M.z - 80; z < M.z + 80; z += 3) {
      if (!cave.open(x, z)) continue;
      n++; worst = Math.min(worst, heightAt(x, z) - (cave.floorY + cave.height));
    }
    expect(n).toBeGreaterThan(250);
    expect(worst).toBeGreaterThan(2);
  });
  it('the terrain is cut away only at the portal', () => {
    site.registerHoles();
    expect(cellHeld(M.x + 3, M.z)).toBe(true);
    expect(holeFloorAt(M.x + 3, M.z)).toBeCloseTo(M.y, 5);
    expect(cellHeld(M.x + 110, M.z)).toBe(false);
    expect(cellHeld(M.x + 3, M.z + 50)).toBe(false);
    expect(cellHeld(M.x - 14, M.z)).toBe(false); // never a gap in the ground in FRONT of the entrance
    expect(cellHeld(M.x - 13, M.z + 1)).toBe(false);
    expect(cellHeld(0, 100)).toBe(false);
  });
  it('its terrain-collision zone has a wide margin around every cutout (no hole touches the zone edge)', () => {
    const z = site.zone();
    expect(M.x - 12 - z.x0).toBeGreaterThanOrEqual(12);
    expect(z.z1 - (M.z + 80)).toBeGreaterThanOrEqual(0);
    for (const s of cave.segments) for (const [x, zz] of [[s.x0, s.z0], [s.x1, s.z1]]) {
      expect(x).toBeGreaterThanOrEqual(z.x0); expect(x).toBeLessThanOrEqual(z.x1);
      expect(zz).toBeGreaterThanOrEqual(z.z0); expect(zz).toBeLessThanOrEqual(z.z1);
    }
  });
});

