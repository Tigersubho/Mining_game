import { describe, it, expect } from 'vitest';
import { waterState, WATER } from '../../src/engine/player/waterState.js';
import { stepBreath, newBreath, ambientAtm, SCUBA_SECONDS, BREATH_SECONDS } from '../../src/engine/player/breath.js';
import { underwaterOptics } from '../../src/engine/ambience.js';

describe('waterState', () => {
  const L = -0.2; // surface level
  it('dry on land', () => { expect(waterState({ feetY: 1.5, level: L, bedY: 1.5 })).toBe('dry'); });
  it('wading in shallow water over the ground', () => { expect(waterState({ feetY: -0.9, level: L, bedY: -0.9 })).toBe('wading'); });
  it('swims on the surface once the water is over head height', () => { expect(waterState({ feetY: -1.25, level: L, bedY: -6 })).toBe('surface'); });
  it('dives only when asked, or when the head is already under', () => {
    expect(waterState({ feetY: -1.25, level: L, bedY: -6, wantDown: true })).toBe('dive');
    expect(waterState({ feetY: -4, level: L, bedY: -6 })).toBe('dive'); // head (feet+1.6) is under
  });
  it('a diver stays diving until the head breaks the surface', () => {
    // head 5 cm above the surface: a diver already diving stays 'dive' (no flicker), a swimmer does not start one
    expect(waterState({ feetY: -1.75, level: L, bedY: -9, prev: 'dive' })).toBe('dive');
    expect(waterState({ feetY: -1.75, level: L, bedY: -9, prev: 'surface' })).toBe('surface');
    expect(waterState({ feetY: -1.1, level: L, bedY: -9, prev: 'dive' })).toBe('surface'); // head clearly out
  });
  it('on a bridge / object above the water you are dry even over deep water', () => { expect(waterState({ feetY: 2.1, level: L, bedY: 2.1 })).toBe('dry'); });
  it('exposes tuning constants', () => { expect(WATER.headHeight).toBeCloseTo(1.6, 5); });
});

describe('ambient pressure', () => {
  it('1 atm at the surface, +1 atm per 10 m', () => { expect(ambientAtm(0)).toBe(1); expect(ambientAtm(10)).toBeCloseTo(2, 5); expect(ambientAtm(30)).toBeCloseTo(4, 5); expect(ambientAtm(-3)).toBe(1); });
});

describe('breath / air model', () => {
  it('free-diving: ~45 s of breath at the surface rate, gone sooner when deep', () => {
    let s = newBreath();
    for (let t = 0; t < 40; t += 1) s = stepBreath(s, 1, { underwater: true, depth: 0.5, scuba: false }).state;
    expect(s.air).toBeGreaterThan(0);
    let d = newBreath(), t = 0; while (d.air > 0 && t < 200) { d = stepBreath(d, 1, { underwater: true, depth: 20, scuba: false }).state; t++; }
    expect(t).toBeLessThan(BREATH_SECONDS / 2); // pressure burns it faster
  });
  it('scuba lasts ~12 min near the surface and about a third of that at 20 m', () => {
    const run = (depth) => { let s = newBreath(), t = 0; while (s.tank > 0 && t < 5000) { s = stepBreath(s, 1, { underwater: true, depth, scuba: true }).state; t++; } return t; };
    expect(run(1)).toBeGreaterThan(SCUBA_SECONDS * 0.8);
    expect(run(20)).toBeLessThan(SCUBA_SECONDS * 0.45);
    expect(run(20)).toBeGreaterThan(SCUBA_SECONDS * 0.25);
  });
  it('breath refills quickly at the surface; the tank does not (it needs the dive base)', () => {
    let s = { ...newBreath(), air: 5, tank: 100 };
    for (let i = 0; i < 6; i++) s = stepBreath(s, 1, { underwater: false, depth: 0, scuba: true }).state;
    expect(s.air).toBeGreaterThan(30);
    expect(s.tank).toBe(100);
  });
  it('tank refills at the dive base', () => {
    let s = { ...newBreath(), tank: 20 };
    for (let i = 0; i < 20; i++) s = stepBreath(s, 1, { underwater: false, depth: 0, scuba: false, atBase: true }).state;
    expect(s.tank).toBeGreaterThan(90);
  });
  it('warns when low and blacks out after running dry underwater', () => {
    let s = { ...newBreath(), air: 12 }, ev = [];
    for (let i = 0; i < 25; i++) { const r = stepBreath(s, 1, { underwater: true, depth: 2, scuba: false }); s = r.state; if (r.event) ev.push(r.event); }
    expect(ev).toContain('low');
    expect(ev).toContain('blackout');
  });
  it('scuba supplies air from the tank first, the lungs stay full', () => {
    const r = stepBreath(newBreath(), 5, { underwater: true, depth: 5, scuba: true });
    expect(r.state.air).toBe(BREATH_SECONDS);
    expect(r.state.tank).toBeLessThan(100);
  });
});

describe('underwater optics', () => {
  it('no effect above the surface', () => { const o = underwaterOptics(-5); expect(o.f).toBe(0); });
  it('fades light and thickens fog with depth, and saturates', () => {
    const a = underwaterOptics(1), b = underwaterOptics(15), c = underwaterOptics(80);
    expect(a.f).toBe(1);
    expect(b.light).toBeLessThan(a.light);
    expect(c.light).toBeGreaterThan(0.02); // never total darkness (the headlamp / sub lights do the rest)
    expect(b.fog).toBeGreaterThan(a.fog);
    expect(c.fog).toBeLessThan(0.2);
  });
});

