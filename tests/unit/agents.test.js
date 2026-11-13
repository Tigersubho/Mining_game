import { describe, it, expect } from 'vitest';
import { makePath, offsetPoints, smoothClosed, outAndBack, roundCorners } from '../../src/engine/agents/path.js';
import { Follower } from '../../src/engine/agents/follower.js';

const square = [[0, 0], [100, 0], [100, 100], [0, 100]]; // (x, z)

describe('path', () => {
  it('has the right length and closes seamlessly', () => {
    const p = makePath(square, true);
    expect(p.len).toBeCloseTo(400, 5);
    const a = p.sample(0), b = p.sample(p.len);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1e-6);
  });
  it('heading is atan2(dx, dz): +X = PI/2, +Z = 0', () => {
    const p = makePath(square, true);
    expect(p.sample(50).h).toBeCloseTo(Math.PI / 2, 5); // first leg runs along +X
    expect(p.sample(150).h).toBeCloseTo(0, 5); // second leg runs along +Z
  });
  it('right-hand offset: travelling +X, right is +Z', () => {
    const o = offsetPoints([[0, 0], [10, 0], [20, 0]], 2);
    for (const q of o) expect(q[1]).toBeCloseTo(2, 5);
  });
  it('curvature of a circle is 1/r; straight is 0', () => {
    const c = []; for (let i = 0; i < 64; i++) c.push([30 * Math.cos((i / 64) * 6.2832), 30 * Math.sin((i / 64) * 6.2832)]);
    const p = makePath(smoothClosed(c, 3), true);
    expect(p.curvature(20)).toBeGreaterThan(1 / 30 * 0.8);
    expect(p.curvature(20)).toBeLessThan(1 / 30 * 1.2);
    expect(makePath(square, true).curvature(50)).toBeCloseTo(0, 5);
  });
  it('nearestS finds the closest point along the path', () => {
    const p = makePath(square, true);
    expect(p.nearestS(50, 5)).toBeCloseTo(50, 3);
  });
  it('outAndBack makes a closed loop that uses opposite lanes there and back', () => {
    const loop = outAndBack([[0, 0], [50, 0], [100, 0]], 1.5);
    const zs = loop.map((q) => q[1]);
    expect(Math.max(...zs)).toBeCloseTo(1.5, 5); expect(Math.min(...zs)).toBeCloseTo(-1.5, 5);
  });
});

describe('Follower', () => {
  const run = (f, sec, dt = 1 / 30) => { const trace = []; for (let i = 0; i < sec / dt; i++) { f.step(dt); trace.push({ s: f.s, v: f.v, at: f.atStop, st: f.state }); } return trace; };

  it('never exceeds its top speed and its position never jumps', () => {
    const path = makePath(square, true), f = new Follower(path, { vmax: 10 });
    let last = path.sample(f.s), maxStep = 0, vMax = 0;
    for (let i = 0; i < 30 * 120; i++) {
      f.step(1 / 30);
      const p = path.sample(f.s);
      maxStep = Math.max(maxStep, Math.hypot(p.x - last.x, p.z - last.z)); last = p; vMax = Math.max(vMax, f.v);
    }
    expect(vMax).toBeLessThanOrEqual(10.001);
    expect(maxStep).toBeLessThan(10 / 30 + 0.01); // no teleporting at the loop seam either
  });
  it('slows down for tight corners', () => {
    const path = makePath(smoothClosed(square, 4), true), f = new Follower(path, { vmax: 14 });
    const trace = run(f, 120);
    const straight = Math.max(...trace.map((t) => t.v));
    const corner = Math.min(...trace.slice(100).map((t) => t.v));
    expect(corner).toBeLessThan(straight * 0.8);
  });
  it('stops at each stop, dwells for the set time, then drives on; loops forever', () => {
    const path = makePath(square, true);
    const f = new Follower(path, { vmax: 10, stops: [{ id: 'A', s: 50, dwell: 6 }, { id: 'B', s: 250, dwell: 3 }] });
    const trace = run(f, 200);
    const visits = trace.filter((t, i) => t.st === 'dwell' && trace[i - 1]?.st !== 'dwell').map((t) => t.at);
    expect(visits.slice(0, 4)).toEqual(['A', 'B', 'A', 'B']); // loops, in order
    const aStop = trace.filter((t) => t.at === 'A' && t.st === 'dwell');
    expect(aStop.length / 30).toBeGreaterThan(5.5); // dwelt ~6 s
    expect(Math.min(...aStop.map((t) => t.v))).toBeLessThan(0.05);
    expect(Math.abs(aStop[0].s - 50)).toBeLessThan(1); // stopped AT the stop
  });
  it('reports the stop it is dwelling at only while stopped', () => {
    const f = new Follower(makePath(square, true), { vmax: 10, stops: [{ id: 'A', s: 60, dwell: 5 }] });
    const trace = run(f, 40);
    expect(trace.some((t) => t.at === 'A')).toBe(true);
    expect(trace.every((t) => (t.at === null) === (t.st === 'drive'))).toBe(true);
  });
  it('can start part-way round (phase) so vehicles are spread out', () => {
    const p = makePath(square, true);
    expect(new Follower(p, { vmax: 5, phase: 0.5 }).s).toBeCloseTo(200, 5);
  });
});

describe('Follower.resume', () => {
  it('rejoins the route at a new position and serves the next stop ahead of it', () => {
    const f = new Follower(makePath([[0, 0], [100, 0], [100, 100], [0, 100]], true), { vmax: 10, stops: [{ id: 'A', s: 60, dwell: 5 }, { id: 'B', s: 250, dwell: 5 }] });
    f.resume(100, 6);
    expect(f.s).toBe(100); expect(f.v).toBe(6); expect(f.state).toBe('drive'); expect(f.stops[f.next].id).toBe('B');
    f.resume(300, 99); expect(f.v).toBe(10); expect(f.stops[f.next].id).toBe('A');
  });
});
describe('roundCorners', () => {
  const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];
  it('never strays more than r from the corner it rounds, and keeps the straight parts', () => {
    const out = roundCorners(sq, 5, true);
    for (const [x, z] of out) { const inside = (x >= -0.01 && x <= 100.01 && z >= -0.01 && z <= 100.01); expect(inside).toBe(true); }
    const nearCorner = out.filter(([x, z]) => Math.hypot(x - 100, z) < 5);
    expect(nearCorner.length).toBeGreaterThan(0);
    expect(Math.min(...out.map(([x, z]) => Math.hypot(x - 100, z)))).toBeGreaterThan(1.2); // actually cut the corner
    expect(out.some(([x, z]) => Math.abs(z) < 1e-9 && x > 40 && x < 60) || out.some(([x]) => x === 5)).toBe(true);
  });
});