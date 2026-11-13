import { describe, it, expect } from 'vitest';
import { SPECS, stepDrive } from '../../src/engine/agents/drive.js';

const run = (spec, ctl, secs, s0 = { v: 0, h: 0, boost: 1 }) => { let s = s0; for (let i = 0; i < secs * 60; i++) s = stepDrive(s, spec, ctl, 1 / 60); return s; };
const go = { throttle: 1, steer: 0, boost: false, brake: false };

describe('driving model', () => {
  it('every kind has a name, a top speed, a faster boost and a cruise speed below top', () => {
    for (const sp of Object.values(SPECS)) { expect(sp.name).toBeTruthy(); expect(sp.boost).toBeGreaterThan(sp.top); expect(sp.cruise).toBeLessThan(sp.top); }
  });
  it('accelerates to, and never beyond, the top speed', () => {
    const s = run(SPECS.car, go, 20);
    expect(s.v).toBeCloseTo(SPECS.car.top, 1);
  });
  it('boost reaches a higher speed, drains the tank and then falls back to top speed', () => {
    const b = run(SPECS.car, { ...go, boost: true }, 2);
    expect(b.boosting).toBe(true); expect(b.boost).toBeLessThan(1);
    const spent = run(SPECS.car, { ...go, boost: true }, 15);
    expect(spent.boost).toBeLessThan(0.05);
    expect(run(SPECS.car, { ...go, boost: true }, 8).v).toBeLessThanOrEqual(SPECS.car.boost + 0.01);
    expect(spent.v).toBeLessThan(SPECS.car.top + 1);
  });
  it('the boost tank refills when not boosting', () => {
    expect(run(SPECS.car, { ...go, throttle: 0 }, 5, { v: 0, h: 0, boost: 0 }).boost).toBeGreaterThan(0.4);
  });
  it('brakes to a halt and reverses slowly', () => {
    const fast = { v: 30, h: 0, boost: 1 };
    expect(run(SPECS.car, { ...go, throttle: 0, brake: true }, 4, fast).v).toBe(0);
    const back = run(SPECS.car, { ...go, throttle: -1 }, 15);
    expect(back.v).toBeLessThan(0); expect(Math.abs(back.v)).toBeLessThanOrEqual(SPECS.car.top * 0.3 + 0.01);
  });
  it('steers right (heading decreases) when moving, and cannot turn on the spot', () => {
    expect(run(SPECS.car, { ...go, steer: 1 }, 2, { v: 15, h: 0, boost: 1 }).h).toBeLessThan(-0.5);
    expect(run(SPECS.car, { throttle: 0, steer: 1, boost: false, brake: false }, 2).h).toBe(0);
  });
  it('steering feels the same when reversing (the nose swings the other way)', () => {
    const f = run(SPECS.car, { throttle: 0, steer: 1, boost: false, brake: false }, 1, { v: 8, h: 0, boost: 1 }).h;
    const r = run(SPECS.car, { throttle: 0, steer: 1, boost: false, brake: false }, 1, { v: -8, h: 0, boost: 1 }).h;
    expect(f).toBeLessThan(0); expect(r).toBeGreaterThan(0);
  });
  it('a JCB is slower than a sedan', () => { expect(run(SPECS.jcb, go, 20).v).toBeLessThan(run(SPECS.car, go, 20).v / 2); });
});
