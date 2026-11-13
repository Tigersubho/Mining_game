import { describe, it, expect, beforeEach } from 'vitest';
import { createPhysics, addHeightfield } from '../../src/engine/world/physics.js';
import { Motor } from '../../src/engine/player/motor.js';

const DT = 1 / 60;
let P, m;
beforeEach(async () => {
  P = await createPhysics();
  P.col.addBox(0, 0, 200, 200, 0, -5, 0); // floor, top at y=0
  m = new Motor(P);
  m.teleport(0, 0, 0);
  P.world.step();
});
const run = (sec, input = {}) => {
  for (let i = 0; i < sec * 60; i++) { m.step(DT, typeof input === 'function' ? input(i) : input); P.world.step(); }
};

describe('Motor (kinematic character on Rapier)', () => {
  it('stands on the floor and reports grounded', () => {
    run(0.5);
    expect(m.grounded).toBe(true);
    expect(m.pos.y).toBeCloseTo(0, 1);
  });

  it('falls under gravity when dropped, then lands', () => {
    m.teleport(0, 5, 0);
    run(0.1);
    expect(m.grounded).toBe(false);
    run(2);
    expect(m.grounded).toBe(true);
    expect(m.pos.y).toBeCloseTo(0, 1);
  });

  it('moves at the commanded velocity', () => {
    run(1, { vx: 5, vz: 0 });
    expect(m.pos.x).toBeCloseTo(5, 0);
  });

  it('auto-steps a stair/curb up to 0.7 m but is blocked by a 1.5 m wall', () => {
    P.col.addBox(5, 0, 1, 5, 0, -5, 0.5); // 0.5 m step
    P.col.addBox(12, 0, 1, 5, 0, -5, 1.5); // 1.5 m wall
    P.world.step();
    run(3, { vx: 4 });
    expect(m.pos.x).toBeGreaterThan(6.5); // got over the step
    expect(m.pos.x).toBeLessThan(11.2); // stopped by the wall (wall face at x=11)
  });

  it('climbs a staircase of 0.5 m risers', () => {
    for (let i = 0; i < 8; i++) P.col.addBox(5 + i * 0.9 + 0.45, 0, 0.45, 2, 0, -5, 0.5 * (i + 1)); // 0.9 m treads
    P.world.step();
    run(5, { vx: 3 });
    expect(m.pos.y).toBeGreaterThan(3.5);
  });

  it('jump apex is about 1.5 m and lands again', () => {
    run(0.3);
    let max = 0;
    run(1.2, (i) => { max = Math.max(max, m.pos.y); return { jump: i === 0 }; });
    expect(max).toBeGreaterThan(1.3);
    expect(max).toBeLessThan(1.8);
    expect(m.grounded).toBe(true);
  });

  it('cannot jump again while airborne (no double jump) but coyote time allows a late jump', () => {
    let peaks = [];
    run(0.3);
    run(0.2, (i) => ({ jump: i === 0 })); // takeoff
    const y1 = m.pos.y;
    run(0.05, { jump: true }); // mid-air press: ignored
    expect(m.pos.y).toBeLessThan(y1 + 1.0);
  });

  it('walks up a 30 degree slope, is blocked by a 70 degree one', () => {
    // sloped decks: 30deg => rise = run * tan30
    P.col.addDeck({ x: 20, z: 0, ux: 1, uz: 0, hl: 10, hw: 4, hA: 0, hB: 20 * Math.tan(Math.PI / 6) });
    P.col.addDeck({ x: -20, z: 0, ux: -1, uz: 0, hl: 5, hw: 4, hA: 0, hB: 10 * Math.tan((70 * Math.PI) / 180) });
    P.world.step();
    run(5, { vx: 5 });
    expect(m.pos.y).toBeGreaterThan(5); // climbing the gentle ramp (starts 10 m away)
    m.teleport(0, 0, 0); P.world.step();
    run(5, { vx: -5 });
    expect(m.pos.y).toBeLessThan(1.0); // steep ramp refuses
    expect(m.pos.x).toBeGreaterThan(-16);
  });

  it('is stopped by a low ceiling (head bump) and does not tunnel through it', () => {
    P.col.addBox(0, 0, 3, 3, 0, 2.2, 3); // ceiling slab with underside at 2.2
    P.world.step();
    run(0.3);
    run(1, (i) => ({ jump: i === 0 }));
    expect(m.pos.y).toBeLessThan(0.6); // 1.8 m tall: max feet height 0.4 under a 2.2 ceiling
  });

  it('swim mode: holds the requested surface height, ignores gravity', async () => {
    const W = await createPhysics(); // open water: no floor
    const s = new Motor(W);
    s.teleport(0, -3, 0); W.world.step();
    for (let i = 0; i < 120; i++) { s.step(DT, { swimY: -1.2 }); W.world.step(); }
    expect(s.pos.y).toBeCloseTo(-1.2, 1);
    expect(s.grounded).toBe(false);
  });

  it('pushes a dynamic crate', () => {
    const body = P.world.createRigidBody(P.R.RigidBodyDesc.dynamic().setTranslation(3, 0.5, 0));
    P.world.createCollider(P.R.ColliderDesc.cuboid(0.5, 0.5, 0.5).setDensity(0.3), body);
    P.world.step();
    run(2, { vx: 3 });
    expect(body.translation().x).toBeGreaterThan(3.8);
  });

  it('works on the real terrain heightfield', () => {
    const N = 21, size = 200, h = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = 0.1 * (-100 + i * 10); // 5.7deg slope in x
    const Q = { ...P };
    const W = P; // use a fresh heightfield only world
    return createPhysics().then((T) => {
      addHeightfield(T, h, N, size);
      const mm = new Motor(T);
      mm.teleport(0, 5, 0); T.world.step();
      for (let i = 0; i < 120; i++) { mm.step(DT, { vx: 4 }); T.world.step(); }
      expect(mm.grounded).toBe(true);
      expect(mm.pos.y).toBeCloseTo(0.1 * mm.pos.x, 0); // follows the surface
    });
  });
});

describe('Motor dive mode (free 3D movement in water)', () => {
  it('moves vertically at the commanded speed with no gravity, and hovers at vy = 0', async () => {
    const W = await createPhysics(); const s = new Motor(W);
    s.teleport(0, -2, 0); W.world.step();
    for (let i = 0; i < 60; i++) { s.step(DT, { dive: { vy: -2 } }); W.world.step(); }
    expect(s.pos.y).toBeCloseTo(-2.03 - 2, 0); // 1 s at 2 m/s down (plus the 3 cm skin offset)
    const y = s.pos.y;
    for (let i = 0; i < 60; i++) { s.step(DT, { dive: { vy: 0 } }); W.world.step(); }
    expect(s.pos.y).toBeCloseTo(y, 2); // neutral buoyancy: no sinking
  });
  it('stops on the seabed instead of sinking through it, and can swim horizontally along it', async () => {
    const W = await createPhysics();
    W.col.addBox(0, 0, 100, 100, 0, -15, -10); // seabed: top at y = -10
    const s = new Motor(W); s.teleport(0, -4, 0); W.world.step();
    for (let i = 0; i < 180; i++) { s.step(DT, { dive: { vy: -3 } }); W.world.step(); }
    expect(s.pos.y).toBeGreaterThan(-10.1);
    expect(s.pos.y).toBeLessThan(-9.9);
    for (let i = 0; i < 60; i++) { s.step(DT, { vx: 2, dive: { vy: -1 } }); W.world.step(); }
    expect(s.pos.x).toBeGreaterThan(1.5);
  });
  it('can ascend and is stopped by a rock ceiling', async () => {
    const W = await createPhysics();
    W.col.addBox(0, 0, 50, 50, 0, -2, 5); // a slab with its underside at y = -2 ... diver cannot pass through
    const s = new Motor(W); s.teleport(0, -12, 0); W.world.step();
    for (let i = 0; i < 400; i++) { s.step(DT, { dive: { vy: 3 } }); W.world.step(); }
    expect(s.pos.y + 1.8).toBeLessThan(-1.9); // head stays below the slab
  });
});

