import { describe, it, expect } from 'vitest';
import { sonarContacts, fmtBearing } from '../../src/engine/gameplay/sonar.js';

const node = (x, y, z, type = 'gold', alive = true) => ({ x, y, z, type, alive });
const LEVEL = -0.2, ORIGIN = { x: 0, y: -10, z: 0 };

describe('sonar', () => {
  it('lists only live, underwater minerals within range, nearest first', () => {
    const list = sonarContacts([node(0, -12, 40), node(0, -12, 10), node(0, 2, 10), node(0, -12, 200), node(0, -12, 5, 'gold', false)], ORIGIN, 0, LEVEL);
    expect(list.map((c) => Math.round(c.flat))).toEqual([10, 40]);
  });
  it('bearing is relative to the bow: ahead 0, starboard positive, port negative, astern 180', () => {
    const at = (x, z, h = 0) => sonarContacts([node(x, -10.5, z)], ORIGIN, h, LEVEL)[0].bearing;
    expect(at(0, 20)).toBeCloseTo(0, 5);
    expect(at(-20, 0)).toBeCloseTo(Math.PI / 2, 5);  // facing +Z, -X is to starboard
    expect(at(20, 0)).toBeCloseTo(-Math.PI / 2, 5);
    expect(Math.abs(at(0, -20))).toBeCloseTo(Math.PI, 5);
    expect(at(20, 0, Math.PI / 2)).toBeCloseTo(0, 5); // turned to face +X: it is now dead ahead
  });
  it('reports the 3-D distance and whether the deposit is above or below', () => {
    const c = sonarContacts([node(30, -50, 0)], ORIGIN, 0, LEVEL)[0];
    expect(c.dist).toBeCloseTo(Math.hypot(30, 39.5), 1); expect(c.dy).toBeLessThan(0);
    expect(sonarContacts([node(0, -3, 12)], ORIGIN, 0, LEVEL)[0].dy).toBeGreaterThan(0);
  });
  it('formats a bearing', () => { expect(fmtBearing(Math.PI / 4)).toBe('045 R'); expect(fmtBearing(-Math.PI / 2)).toBe('090 L'); expect(fmtBearing(0)).toBe('000'); });
});