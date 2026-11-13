import { describe, it, expect, beforeAll } from 'vitest';
import { createPhysics, addHeightfield } from '../../src/engine/world/physics.js';

let P;
const topAt = (x, z, from = 100) => P.col.groundY(x, z, from);
beforeAll(async () => { P = await createPhysics(); });
const settle = () => P.world.step();

describe('static colliders', () => {
  it('addBox: top surface is where we say it is', () => {
    P.col.addBox(0, 0, 2, 2, 0, -5, 3);
    settle();
    expect(topAt(0, 0)).toBeCloseTo(3, 2);
    expect(topAt(5, 0)).toBeNull();
  });

  it('addBox: rotation convention - local +X axis is (cos rot, sin rot) in (x,z)', () => {
    // long thin box (hx=10, hz=0.5) rotated 90deg => long side lies along Z
    P.col.addBox(100, 0, 10, 0.5, Math.PI / 2, -5, 2);
    settle();
    expect(topAt(100, 8)).toBeCloseTo(2, 2); // inside along z
    expect(topAt(108, 0)).toBeNull(); // would be inside if it were NOT rotated
  });

  it('addCircle: vertical cylinder', () => {
    P.col.addCircle(200, 0, 1, -5, 7);
    settle();
    expect(topAt(200.5, 0)).toBeCloseTo(7, 2);
    expect(topAt(202, 0)).toBeNull();
  });

  it('addDeck: sloped surface interpolates hA -> hB along its direction', () => {
    P.col.addDeck({ x: 300, z: 0, ux: 1, uz: 0, hl: 10, hw: 2, hA: 2, hB: 6 });
    settle();
    expect(topAt(300, 0)).toBeCloseTo(4, 1); // middle
    expect(topAt(295, 0)).toBeCloseTo(3, 1); // quarter
    expect(topAt(305, 0)).toBeCloseTo(5, 1);
    expect(topAt(300, 3)).toBeNull(); // outside width
  });

  it('addDeck: works for diagonal directions too', () => {
    const s = Math.SQRT1_2;
    P.col.addDeck({ x: 400, z: 0, ux: s, uz: s, hl: 8, hw: 2, hA: 1, hB: 1 });
    settle();
    expect(topAt(400, 0)).toBeCloseTo(1, 1);
    expect(topAt(400 + 5 * s, 5 * s)).toBeCloseTo(1, 1);
    expect(topAt(400 + 4, 0 - 4)).toBeNull();
  });
});

describe('terrain heightfield', () => {
  it('matches the source height grid (axis orientation is right)', async () => {
    const Q = await createPhysics(); // fresh world
    const N = 11, size = 100;
    const h = new Float32Array(N * N);
    const f = (x, z) => 0.05 * x + 0.02 * z * z / 10 + 3; // asymmetric in x and z
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = f(-50 + i * 10, -50 + j * 10);
    addHeightfield(Q, h, N, size);
    Q.world.step();
    // off-grid points (a ray exactly through a vertex can slip between triangles)
    for (const [x, z] of [[-43.3, -41.7], [38.2, -44.1], [-39.6, 37.9], [41.4, 42.2], [3.3, 21.1], [22.7, -1.3]]) {
      expect(Q.col.groundY(x, z, 100)).toBeCloseTo(f(x, z), 0); // linear interpolation inside a cell: <0.05 error
    }
  });
});

describe('dynamic bodies', () => {
  it('a dropped box comes to rest on a static floor and falls asleep', () => {
    P.col.addBox(2000, 0, 20, 20, 0, -2, 0);
    const body = P.world.createRigidBody(P.R.RigidBodyDesc.dynamic().setTranslation(2000, 5, 0));
    P.world.createCollider(P.R.ColliderDesc.cuboid(0.5, 0.5, 0.5), body);
    for (let i = 0; i < 400; i++) P.world.step();
    expect(body.translation().y).toBeCloseTo(0.5, 1);
    expect(body.isSleeping()).toBe(true);
  });
});
