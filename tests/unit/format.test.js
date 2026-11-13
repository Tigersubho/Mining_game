import { describe, it, expect } from 'vitest';
import { cardinal, fmtCoord, kmh, fmtElev, compassMarks } from '../../src/ui/format.js';
import { sanitizeSettings } from '../../src/ui/settings.js';

describe('format', () => {
  it('cardinal points, wrapping at 360', () => {
    expect(cardinal(0)).toBe('N'); expect(cardinal(44)).toBe('NE'); expect(cardinal(90)).toBe('E');
    expect(cardinal(181)).toBe('S'); expect(cardinal(270)).toBe('W'); expect(cardinal(359)).toBe('N');
  });
  it('coordinates: easting = +x, northing = -z, zero padded with sign', () => {
    expect(fmtCoord(12.34, -56.78)).toEqual({ e: '+0012', n: '+0057' });
    expect(fmtCoord(-1, 1000)).toEqual({ e: '-0001', n: '-1000' });
  });
  it('speed in km/h', () => { expect(kmh(5.4)).toBe('19.4'); expect(kmh(0)).toBe('0.0'); });
  it('elevation keeps one decimal and a sign', () => {
    expect(fmtElev(8.64)).toBe('+8.6'); expect(fmtElev(-3.04)).toBe('-3.0'); expect(fmtElev(0)).toBe('+0.0');
  });
  it('compass tape has ticks every 5 degrees across three turns, labels on cardinals', () => {
    const m = compassMarks();
    expect(m.length).toBe((360 * 3) / 5 + 1);
    expect(m.find((k) => k.deg === 360).label).toBe('N');
    expect(m.find((k) => k.deg === 450).label).toBe('E');
    expect(m.find((k) => k.deg === 365).label).toBe('');
  });
});

describe('settings', () => {
  it('fills defaults and clamps bad values', () => {
    expect(sanitizeSettings({})).toEqual({ sensitivity: 1, quality: 'high', invertY: false });
    expect(sanitizeSettings({ sensitivity: 99, quality: 'ultra', invertY: 'yes' })).toEqual({ sensitivity: 2.5, quality: 'high', invertY: false });
    expect(sanitizeSettings({ sensitivity: -1 }).sensitivity).toBe(0.2);
    expect(sanitizeSettings(null).quality).toBe('high');
    expect(sanitizeSettings({ quality: 'low' }).quality).toBe('low');
  });
});
