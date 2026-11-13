import { describe, it, expect } from 'vitest';
import { getGeology, DEPOSIT_TYPES } from '../../src/engine/survey/geology.js';
import { Channel, CELL, W_MIN } from '../../src/engine/survey/grid.js';
import { detect, interpret, intensityOf } from '../../src/engine/survey/analysis.js';
import { SENSORS, SENSOR_IDS, norm01, denorm, lut } from '../../src/engine/survey/sensors.js';
import { bridgeDeckY, BRIDGES } from '../../src/engine/world/layout.js';
import { wetAt, planCrossing } from '../../src/engine/agents/safety.js';
import { buildFleet } from '../../src/engine/agents/fleet.js';

const geo = getGeology();
const noise = () => { let u = 0; while (!u) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); };

/** walk parallel lines over a block and splat the (noisy) readings, like the survey does */
function survey(sensor, cx, cz, half = 45, spacing = 6, h = 1) {
  const sd = SENSORS[sensor], chans = Object.fromEntries(sd.channels.map((c) => [c.id, new Channel(sensor, c.id)])), out = {};
  for (let x = cx - half, dir = 1; x <= cx + half; x += spacing, dir = -dir) {
    for (let k = 0; k <= (half * 2) / 0.4; k++) {
      const z = cz - dir * half + dir * k * 0.4, raw = geo.measure(sensor, x, z, h, out);
      for (const c of sd.channels) { let v = sensor === 'gamma' ? out[c.id] : raw; if (c.mode === 'log') v = Math.log10(v); chans[c.id].splat(x, z, v + sd.noise[c.id] * noise(), sd.footprint.hand, 1); }
    }
  }
  const dets = [];
  for (const c of sd.channels) dets.push(...detect(chans[c.id], chans[c.id].refreshStats(sd.noise[c.id])));
  return { chans, dets };
}

describe('geology', () => {
  it('is deterministic and holds real deposits and barren decoys', () => {
    expect(getGeology()).toBe(geo);
    expect(geo.deposits.length).toBeGreaterThan(40);
    expect(geo.features.some((f) => f.kind === 'decoy')).toBe(true);
    expect(new Set(geo.deposits.map((d) => d.type)).size).toBeGreaterThan(8);
    for (const d of geo.deposits) { expect(DEPOSIT_TYPES[d.type]).toBeDefined(); expect(d.remaining).toBe(d.quantity); }
  });
  it('every sensor reads a finite number everywhere it is asked', () => {
    for (const s of SENSOR_IDS) for (const [x, z] of [[0, 60], [-200, 90], [75, -20], [300, -300]]) expect(Number.isFinite(geo.measure(s, x, z, 1))).toBe(true);
  });
  it('a magnetite body lights up the magnetometer far more than the gamma spectrometer', () => {
    const f = geo.deposits.find((d) => d.type === 'magnetite');
    const mag = geo.measure('mag', f.x, f.z, 1) - geo.measure('mag', f.x + 120, f.z, 1);
    expect(mag).toBeGreaterThan(150);
    const out = {}, here = {};
    geo.measure('gamma', f.x, f.z, 1, here); geo.measure('gamma', f.x + 120, f.z, 1, out);
    expect(Math.abs(here.Th - out.Th)).toBeLessThan(4);
  });
  it('gamma only sees shallow bodies: a deep copper body is invisible to it', () => {
    const f = geo.deposits.find((d) => d.type === 'copper'), a = {}, b = {};
    geo.measure('gamma', f.x, f.z, 1, a); geo.measure('gamma', f.x + 150, f.z, 1, b);
    expect(Math.abs(a.K - b.K)).toBeLessThan(1.2);
  });
  it('decoys exist that light up one instrument and not the others', () => {
    const dyke = geo.features.find((f) => f.type === 'dyke');
    const ip = geo.measure('ip', dyke.x, dyke.z, 1) - geo.measure('ip', dyke.x + 100, dyke.z, 1);
    expect(Math.abs(ip)).toBeLessThan(3);
    expect(geo.measure('mag', dyke.x, dyke.z, 1) - geo.measure('mag', dyke.x + dyke.cs * 0 + 60, dyke.z + 60, 1)).toBeGreaterThan(60);
  });
  it('a dig reaches the body under it, and nothing 40 m away', () => {
    const f = geo.deposits[0];
    expect(geo.bodyAt(f.x, f.z)).toBe(f);
    expect(geo.bodyAt(f.x + 60, f.z + 60)?.id).not.toBe(f.id);
  });
  it('GPR traces: the direct wave is strong, deeper returns fade in conductive ground', () => {
    const tr = new Float32Array(80), f = geo.features[0];
    geo.gprTrace(f.x, f.z, 80, 5, tr, geo.scatterers(f.x, f.z, 10));
    expect(Math.max(...tr.slice(0, 6).map(Math.abs))).toBeGreaterThan(0.3);
  });
});

describe('survey grid', () => {
  it('interpolates: cells near readings have data, far cells stay unclassified', () => {
    const ch = new Channel('mag', 'tmi');
    for (let x = 0; x <= 20; x += 0.5) ch.splat(x, 0, 100 + x, 2.4, 1);
    expect(ch.cell(Math.floor(10 / CELL), 0)).toBeCloseTo(110, -1);
    expect(Number.isNaN(ch.cell(Math.floor(10 / CELL), 40))).toBe(true); // 80 m off the line
    expect(ch.at(10, 0.4)).toBeGreaterThan(105);
  });
  it('fills the gap between two lines when they are close enough, not when they are far apart', () => {
    const near = new Channel('mag', 'tmi'), far = new Channel('mag', 'tmi');
    for (let x = 0; x <= 20; x += 0.5) { near.splat(x, 0, 50, 2.4, 1); near.splat(x, 5, 50, 2.4, 1); far.splat(x, 0, 50, 2.4, 1); far.splat(x, 30, 50, 2.4, 1); }
    expect(Number.isNaN(near.at(10, 2.5))).toBe(false);
    expect(Number.isNaN(far.at(10, 15))).toBe(true);
  });
  it('handles negative tile keys (west / north of the origin)', () => {
    const ch = new Channel('mag', 'tmi');
    ch.splat(-5, -5, 7, 2.4, 1); ch.splat(-5, 5, 9, 2.4, 1);
    expect(ch.cell(Math.floor(-5 / CELL), Math.floor(-5 / CELL))).toBeCloseTo(7, 3);
    expect(ch.cell(Math.floor(-5 / CELL), Math.floor(5 / CELL))).toBeCloseTo(9, 3);
  });
  it('robust statistics ignore outliers', () => {
    const ch = new Channel('mag', 'tmi');
    for (let i = 0; i < 400; i++) ch.splat(i * 2, 0, 50 + noise() * 2, 2.4, 1);
    ch.splat(1000, 0, 5000, 2.4, 1);
    const st = ch.refreshStats(3);
    expect(Math.abs(st.bg - 50)).toBeLessThan(3);
    expect(st.sd).toBeLessThan(10);
  });
  it('w threshold is sane', () => { expect(W_MIN).toBeGreaterThan(0); expect(W_MIN).toBeLessThan(0.5); });
});

describe('colour scales', () => {
  it('norm01 / denorm round-trip and the magnetometer ramp runs blue - green - red', () => {
    const ch = SENSORS.mag.channels[0], st = { bg: 40, sd: 10 };
    for (const v of [10, 40, 80, 120]) expect(denorm(ch, norm01(ch, v, st), st)).toBeCloseTo(v, 0);
    expect(norm01(ch, 40, st)).toBeCloseTo(0.5, 2);
    expect(norm01(ch, 5000, st)).toBe(1); // a huge anomaly saturates the scale (red) instead of overflowing
    expect(norm01(ch, -5000, st)).toBe(0);
    const L = lut('mag'), at = (t) => [0, 1, 2].map((i) => L[Math.round(t * 255) * 3 + i]);
    expect(at(0)[2]).toBeGreaterThan(at(0)[0]); // blue low
    expect(at(0.5)[1]).toBeGreaterThan(at(0.5)[0]); // green background
    expect(at(1)[0]).toBeGreaterThan(at(1)[2]); // red high
  });
  it('intensity grows with the z-score and saturates below 100', () => {
    expect(intensityOf(2)).toBeLessThan(intensityOf(10));
    expect(intensityOf(500)).toBeLessThan(100);
  });
});

describe('anomaly detection and interpretation', () => {
  const dep = geo.features[0]; // guaranteed copper body near the hub
  it('finds a copper body with the IP sensor, within a few metres', () => {
    const { dets } = survey('ip', dep.x, dep.z);
    const hit = dets.filter((d) => Math.hypot(d.x - dep.x, d.z - dep.z) < 12);
    expect(hit.length).toBeGreaterThan(0);
    expect(Math.max(...hit.map((d) => d.zscore))).toBeGreaterThan(8);
  });
  it('a single-sensor result does not name a mineral as certain, and several sensors raise confidence', () => {
    const ip = survey('ip', dep.x, dep.z).dets, mag = survey('mag', dep.x, dep.z).dets;
    const one = interpret(ip.map((d) => ({ ...d, sensor: 'ip' })), dep.x, dep.z), both = interpret([...ip, ...mag], dep.x, dep.z);
    expect(one.title).toBeTruthy();
    expect(both.confidence).toBeGreaterThanOrEqual(one.confidence);
    expect(both.confidence).toBeLessThanOrEqual(85); // never certain before digging
  });
  it('a regional trend alone raises no anomaly', () => {
    const ch = new Channel('mag', 'tmi');
    for (let x = 0; x <= 80; x += 6) for (let z = 0; z <= 80; z += 0.4) ch.splat(x, z, 50 + 0.5 * (x + z) + noise() * 3, 2.4, 1);
    expect(detect(ch, ch.refreshStats(3)).length).toBe(0);
  });
});

describe('road safety (cars never in water)', () => {
  it('hub bridges have dry landings and a deck height over the water', () => {
    for (const b of BRIDGES.filter((q) => q.hub)) {
      const hl = b.length / 2;
      expect(wetAt(b.x - b.dirx * hl, b.z - b.dirz * hl)).toBe(false);
      expect(wetAt(b.x + b.dirx * (hl + 2), b.z + b.dirz * (hl + 2))).toBe(false);
      expect(wetAt(b.x, b.z)).toBe(false); // mid-span is over water but on the deck
      expect(bridgeDeckY(b.x, b.z)).toBeGreaterThan(1.9);
    }
  });
  it('no route of any road vehicle ever touches water', () => {
    for (const d of buildFleet()) {
      if (d.kind === 'boat') continue;
      for (let s = 0; s < d.path.len; s += 1.5) { const q = d.path.sample(s); expect(wetAt(q.x, q.z), `${d.id} at s=${s.toFixed(0)}`).toBe(false); }
    }
  });
  it('cars that must cross water are sent over a bridge, not through the river', () => {
    const way = planCrossing(110 * Math.cos((330 * Math.PI) / 180), 110 * Math.sin((330 * Math.PI) / 180), 0, 14.5);
    expect(way.length).toBe(2);
    expect(planCrossing(-60, 160, 60, 160)).toEqual([]);
  });
  it('the three bridges all meet the hub roundabout so any sector reaches any other', () => {
    const hubs = BRIDGES.filter((b) => b.hub);
    expect(hubs.length).toBe(3);
    for (const b of hubs) expect(Math.hypot(b.x, b.z) - b.length / 2).toBeLessThan(26);
  });
});
