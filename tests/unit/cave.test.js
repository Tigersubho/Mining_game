import { describe, it, expect, beforeEach } from 'vitest';
import { makeCave, addCaveColliders } from '../../src/engine/world/cave.js';
import { createPhysics } from '../../src/engine/world/physics.js';
import { Motor } from '../../src/engine/player/motor.js';

// an L-shaped adit with a chamber, entering from the west (-x) at z = 0
const SEGS = [
  { x0: -6, z0: 0, x1: 60, z1: 0, w: 6 }, // main tunnel
  { x0: 30, z0: 0, x1: 30, z1: 45, w: 6 }, // side branch
  { x0: 50, z0: 12, x1: 62, z1: 12, w: 18 }, // chamber
];
const cave = makeCave({ segments: SEGS, cell: 3, floorY: 5, height: 3.8, entry: { x: -6, z: 0, w: 6 } });

describe('cave occupancy', () => {
  it('is open inside the tunnels and closed outside', () => {
    expect(cave.open(10, 0)).toBe(true);
    expect(cave.open(30, 30)).toBe(true);
    expect(cave.open(56, 10)).toBe(true);
    expect(cave.open(10, 10)).toBe(false);
    expect(cave.open(-20, 0)).toBe(false);
  });
  it('floor rectangles cover exactly the open cells (no gaps, no overlaps)', () => {
    const area = cave.floors.reduce((a, r) => a + r.hx * r.hz * 4, 0);
    expect(area).toBeCloseTo(cave.cells * 9, 5); // cell = 3 m -> 9 m2 each
  });
  it('every open/closed boundary has a wall, except the entrance', () => {
    let missing = 0, checked = 0;
    const c = 3;
    for (let i = -4; i < 24; i++) {
      for (let j = -6; j < 20; j++) {
        const x = (i + 0.5) * c, z = (j + 0.5) * c;
        if (!cave.open(x, z)) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (cave.open(x + dx * c, z + dz * c)) continue;
          if (dx === -1 && i === -3 && Math.abs(z) < 3) continue; // the entrance opening (westmost cell of the main tunnel)
          checked++;
          const px = x + dx * (c / 2 + 0.5), pz = z + dz * (c / 2 + 0.5); // middle of the wall band
          if (!cave.walls.some((w) => Math.abs(px - w.x) <= w.hx + 1e-6 && Math.abs(pz - w.z) <= w.hz + 1e-6)) missing++;
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
    expect(missing).toBe(0);
  });  it('reports how far inside the mountain a point is (for lighting)', () => {
    expect(cave.depth(-5, 0)).toBeLessThan(2);
    expect(cave.depth(40, 0)).toBeGreaterThan(30);
    expect(cave.depth(10, 10)).toBe(0); // rock
  });
});

describe('cave physics', () => {
  let P;
  const DT = 1 / 60;
  beforeEach(async () => { P = await createPhysics(); addCaveColliders(P.col, cave); P.world.step(); }); // fresh world per test
  const walk = (m, vx, vz, sec) => { for (let i = 0; i < sec * 60; i++) { m.step(DT, { vx, vz }); P.world.step(); } };

  it('you can walk in through the entrance, down the main tunnel and into the chamber', () => {
    const m = new Motor(P);
    m.teleport(-4, 5, 0); P.world.step();
    walk(m, 5, 0, 7); // 35 m
    expect(m.pos.x).toBeGreaterThan(30);
    expect(Math.abs(m.pos.z)).toBeLessThan(3);
    walk(m, 5, 0, 7);
    expect(m.pos.x).toBeGreaterThan(55); // reached the chamber
  });
  it('you can take the side branch', () => {
    const m = new Motor(P);
    m.teleport(30, 5, 0); P.world.step();
    walk(m, 0, 5, 7);
    expect(m.pos.z).toBeGreaterThan(30);
  });
  it('rock walls hold: you cannot walk out of the tunnel sideways', () => {
    const m = new Motor(P);
    m.teleport(10, 5, 0); P.world.step();
    walk(m, 0, 6, 4); expect(m.pos.z).toBeLessThan(3.2);
    walk(m, 0, -6, 6); expect(m.pos.z).toBeGreaterThan(-3.2);
  });
  it('the ceiling holds: you cannot jump out through the roof', () => {
    const m = new Motor(P);
    m.teleport(10, 5, 0); P.world.step();
    for (let i = 0; i < 90; i++) { m.step(DT, { jump: i === 0 }); P.world.step(); }
    expect(m.pos.y).toBeLessThan(5 + 3.8);
  });
  it('the floor holds', () => {
    const m = new Motor(P);
    m.teleport(10, 5, 0); P.world.step();
    walk(m, 0, 0, 2);
    expect(m.pos.y).toBeCloseTo(5, 0);
    expect(m.grounded).toBe(true);
  });
});

