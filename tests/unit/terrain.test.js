import { describe, it, expect } from 'vitest';
import { heightAt, riverS, regionName, waterLevelAt, branchPoint, cellHeld } from '../../src/engine/world/terrain.js';
import { PIT_WATER_Y } from '../../src/engine/world/terrain.js';
import { LAND_Y, WATER_Y, WORLD_R, LAKE, RIDGE, GROTTO, PIT, TERRAIN_SIZE, polar } from '../../src/engine/config.js';

describe('world scale', () => {
  it('is roughly 1.6 km across', () => {
    expect(TERRAIN_SIZE).toBeGreaterThanOrEqual(1600);
    expect(WORLD_R).toBeGreaterThanOrEqual(750);
  });
});

describe('core village is unchanged', () => {
  it('city is exactly flat', () => { expect(heightAt(0, 100)).toBeCloseTo(LAND_Y, 5); expect(heightAt(-60, 150)).toBeCloseTo(LAND_Y, 5); });
  it('hub island is 2.0 m', () => { expect(heightAt(0, 0)).toBeCloseTo(2.0, 1); expect(heightAt(3, 4)).toBeCloseTo(2.0, 1); });
  it('hub island is a big flat plaza (radius 25 m, six times the old one)', () => { for (const [x, z] of [[0, 20], [14, 14], [-20, 10]]) expect(heightAt(x, z)).toBeCloseTo(2.0, 1); });
  it('the central pool is water, ringing the island', () => { expect(heightAt(0, 33)).toBeLessThan(WATER_Y - 1); expect(heightAt(33, 0)).toBeLessThan(WATER_Y - 1); });
});

describe('great lake', () => {
  it('is deep in the middle (diveable) and has a shoreline', () => {
    expect(heightAt(LAKE.x, LAKE.z)).toBeLessThan(-25);
    expect(heightAt(LAKE.x, LAKE.z) - WATER_Y).toBeGreaterThan(-60);
    const shore = riverS(LAKE.x + LAKE.R * 1.3, LAKE.z);
    expect(shore).toBeGreaterThan(5); // land beyond the shore
  });
  it('is fed by the river branch (river is water between the village and the lake)', () => {
    const [x, z] = branchPoint(1, 330); // branch 150deg, 330 m out
    expect(heightAt(x, z)).toBeLessThan(WATER_Y);
  });
  it('named as a zone', () => { expect(regionName(LAKE.x, LAKE.z)).toMatch(/lake/i); });
});

describe('ridge mine highlands', () => {
  it('has a mountain with a flat entrance apron at the foot', () => {
    expect(heightAt(RIDGE.x, RIDGE.z)).toBeGreaterThan(40);
    const m = RIDGE.mouth;
    expect(Math.abs(heightAt(m.x, m.z) - heightAt(m.x - 5, m.z))).toBeLessThan(0.6);
  });
  it('the terrain rises above the tunnel ceiling a little way inside the mountain', () => {
    const m = RIDGE.mouth;
    expect(heightAt(m.x + 40, m.z)).toBeGreaterThan(m.y + 8);
  });
});

describe('world edge', () => {
  it('is a high wall all round (no walking out)', () => {
    for (const a of [0, 60, 130, 200, 290]) {
      const [x, z] = polar(WORLD_R + 20, a);
      expect(heightAt(x, z)).toBeGreaterThan(30);
    }
  });
});

describe('water levels and terrain holes', () => {
  it('normal water level everywhere outside special basins', () => { expect(waterLevelAt(0, 100)).toBe(WATER_Y); });
  it('cellHeld is false when no cave registered at the point', () => { expect(cellHeld(0, 100)).toBe(false); });
});

describe('flooded open pit', () => {
  it('the pit holds its own, lower water level and is deep enough to dive', () => {
    expect(waterLevelAt(PIT.x, PIT.z)).toBe(PIT_WATER_Y);
    expect(PIT_WATER_Y).toBeLessThan(WATER_Y);
    expect(PIT_WATER_Y - heightAt(PIT.x, PIT.z)).toBeGreaterThan(3); // 3+ m of water over the pit floor
    expect(waterLevelAt(PIT.x + PIT.R + 30, PIT.z)).toBe(WATER_Y); // outside the pit: normal level
  });
});

describe('flooded grotto on the lake bed', () => {
  it('its mouth is well underwater, on the lake bed', () => {
    expect(GROTTO.mouth.y).toBeLessThan(WATER_Y - 12);
    expect(Math.hypot(GROTTO.mouth.x - LAKE.x, GROTTO.mouth.z - LAKE.z)).toBeLessThan(LAKE.R);
  });
  it('the bed rises over the tunnel: at least 4 m of rock above the ceiling 45 m in', () => {
    expect(heightAt(GROTTO.mouth.x + 45, GROTTO.mouth.z) - (GROTTO.mouth.y + 3.8)).toBeGreaterThan(4);
  });
});
