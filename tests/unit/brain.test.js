import { describe, it, expect } from 'vitest';
import { Graph } from '../../src/engine/agents/graph.js';
import { Brain, ROLES } from '../../src/engine/agents/brain.js';

function line() { // A --20m-- B --20m-- C   (+ island D, unreachable)
  const g = new Graph();
  const A = g.add(0, 0, 'office'), B = g.add(20, 0, 'bench'), C = g.add(40, 0, 'cafe'), D = g.add(500, 500, 'office');
  g.link(A, B); g.link(B, C);
  return { g, A, B, C, D };
}
const mulberry = (a) => () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

describe('Graph', () => {
  it('finds shortest paths and knows what is reachable', () => {
    const { g, A, C, D } = line();
    expect(g.path(A, C)).toEqual([A, 1, C]);
    expect(g.path(A, D)).toBeNull();
    expect([...g.component(A)].sort()).toEqual([0, 1, 2]);
  });
  it('nearest node, optionally filtered by tag', () => {
    const { g } = line();
    expect(g.nearest(18, 3)).toBe(1);
    expect(g.nearest(18, 3, (n) => n.tag === 'cafe')).toBe(2);
  });
  it('picks the shorter of two routes', () => {
    const g = new Graph(); const a = g.add(0, 0), b = g.add(10, 0), c = g.add(10, 100), d = g.add(20, 0);
    g.link(a, b); g.link(b, d); g.link(a, c); g.link(c, d);
    expect(g.path(a, d)).toEqual([a, b, d]);
  });
});

function world({ vehicle } = {}) {
  const L = line();
  const stops = { S1: { node: L.A, kinds: ['taxi'] }, S2: { node: L.C, kinds: ['taxi'] } };
  const env = { rng: mulberry(7), graph: L.g, stops, vehicleAt: (sid, kinds) => (vehicle && vehicle.atStop === sid && kinds.includes(vehicle.kind) ? vehicle : null), now: 0 };
  return { ...L, env, stops };
}
const make = (type, w, node, seed = 3) => new Brain({ id: type, type, graph: w.g, node, rng: mulberry(seed) });
const sim = (b, env, sec, dt = 0.1) => { const out = []; for (let i = 0; i < sec / dt; i++) { b.step(dt, env); out.push({ x: b.x, z: b.z, mode: b.mode }); } return out; };

describe('Brain: walking', () => {
  it('walks between graph nodes at a human pace, only along edges', () => {
    const w = world();
    const b = make('office', w, w.A);
    const tr = sim(b, w.env, 120);
    for (const p of tr) expect(Math.abs(p.z)).toBeLessThan(0.01); // never leaves the A-B-C line
    let maxStep = 0; for (let i = 1; i < tr.length; i++) maxStep = Math.max(maxStep, Math.hypot(tr[i].x - tr[i - 1].x, tr[i].z - tr[i - 1].z));
    expect(maxStep).toBeLessThan(2.2 * 0.1 + 1e-6);
    expect(new Set(tr.map((t) => t.mode)).has('walk')).toBe(true);
    expect(Math.max(...tr.map((t) => t.x))).toBeGreaterThan(15); // actually went somewhere
  });
  it('only goes to places it can reach', () => {
    const w = world(); const b = make('office', w, w.A);
    for (const p of sim(b, w.env, 300)) expect(p.x).toBeLessThan(100); // never "teleports" to the island
  });
});

describe('Brain: transit', () => {
  const forceRide = (b) => { b.role = { ...b.role, pRide: 1 }; };

  it('waits at a stop, boards a matching vehicle, rides, and alights at its destination', () => {
    const veh = { kind: 'taxi', atStop: 'S1', stopIds: ['S1', 'S2'], seats: 3, passengers: [] };
    const w = world({ vehicle: veh });
    const b = make('office', w, w.A); forceRide(b);
    let boarded = false, alighted = false;
    for (let i = 0; i < 2000 && !alighted; i++) {
      b.step(0.1, w.env);
      if (b.mode === 'ride') { boarded = true; expect(veh.passengers).toContain(b); veh.atStop = i % 40 === 0 ? 'S2' : veh.atStop; if (veh.atStop === 'S2') veh.atStop = 'S2'; }
      if (boarded && b.mode !== 'ride') alighted = true;
    }
    expect(boarded).toBe(true); expect(alighted).toBe(true);
    expect(veh.passengers).not.toContain(b);
    expect(Math.hypot(b.x - 40, b.z)).toBeLessThan(2); // standing at stop S2 (node C)
  });
  it('a scuba diver never gets into a taxi (not suited to the vehicle)', () => {
    const veh = { kind: 'taxi', atStop: 'S1', stopIds: ['S1', 'S2'], seats: 3, passengers: [] };
    const w = world({ vehicle: veh });
    const b = make('scuba', w, w.A); forceRide(b);
    sim(b, w.env, 300);
    expect(veh.passengers).toHaveLength(0);
  });
  it('does not board a full vehicle, and gives up waiting after a while', () => {
    const veh = { kind: 'taxi', atStop: 'S1', stopIds: ['S1', 'S2'], seats: 1, passengers: [{}] };
    const w = world({ vehicle: veh });
    const b = make('office', w, w.A); forceRide(b);
    const tr = sim(b, w.env, 400);
    expect(veh.passengers).toHaveLength(1);
    const w0 = tr.findIndex((t) => t.mode === 'wait');
    expect(w0).toBeGreaterThanOrEqual(0);
    expect(tr.slice(w0).some((t) => t.mode === 'idle')).toBe(true); // gave up waiting and went back to its day
    const waited = tr.slice(w0).findIndex((t) => t.mode !== 'wait');
    expect(waited * 0.1).toBeGreaterThan(60); // ...but only after a good long wait (~90 s)
  });
  it('a vehicle that is not at the stop is not boarded', () => {
    const veh = { kind: 'taxi', atStop: null, stopIds: ['S1', 'S2'], seats: 3, passengers: [] };
    const w = world({ vehicle: veh }); const b = make('office', w, w.A); forceRide(b);
    sim(b, w.env, 60); expect(veh.passengers).toHaveLength(0);
  });
});

describe('Brain: roles', () => {
  it('every role lists what it visits and what it may ride', () => {
    for (const k of ['office', 'police', 'civilian', 'miner', 'driver', 'scuba', 'fisherman', 'guide']) {
      expect(ROLES[k]).toBeDefined();
      expect(ROLES[k].visit.length).toBeGreaterThan(0);
    }
    expect(ROLES.scuba.rides).toContain('boat'); expect(ROLES.fisherman.rides).toContain('boat');
    expect(ROLES.scuba.rides).not.toContain('taxi'); expect(ROLES.police.rides).toHaveLength(0);
    expect(ROLES.miner.rides).toEqual(expect.arrayContaining(['pickup', 'gmc']));
    expect(ROLES.office.rides).toContain('taxi'); expect(ROLES.guide.rides).toContain('jeep');
  });
  it('a scuba diver goes under water for a while, then comes back up', () => {
    const g = new Graph(); const shed = g.add(0, 0, 'dive_shed'), pier = g.add(30, 0, 'pier_end'); g.link(shed, pier);
    const b = new Brain({ id: 's', type: 'scuba', graph: g, node: shed, rng: mulberry(5), diveSpot: (n) => ({ x: n.x + 10, z: n.z + 5, depth: 8 }) });
    b.role = { ...b.role, pDive: 1 };
    const env = { rng: mulberry(2), graph: g, stops: {}, vehicleAt: () => null };
    let maxDepth = 0, dove = false, back = false;
    for (let i = 0; i < 4000; i++) { b.step(0.1, env); if (b.depth > 0.5) { dove = true; maxDepth = Math.max(maxDepth, b.depth); } if (dove && b.depth === 0 && b.mode !== 'dive') { back = true; break; } }
    expect(dove).toBe(true); expect(maxDepth).toBeGreaterThan(5); expect(back).toBe(true);
  });
});
