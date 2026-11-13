import { describe, it, expect, beforeEach } from 'vitest';
import { createPhysics } from '../../src/engine/world/physics.js';
import { Submarine } from '../../src/engine/vehicles/submarine.js';

const DT = 1 / 60, LEVEL = -0.2;
let P;
beforeEach(async () => { P = await createPhysics(); P.world.timestep = DT; });
const run = (sub, sec, input = {}) => { for (let i = 0; i < sec * 60; i++) { sub.step(DT, { level: LEVEL, ...input }); P.world.step(); } };
const speed = (sub) => { const v = sub.body.linvel(); return Math.hypot(v.x, v.y, v.z); };

describe('Submarine physics', () => {
  it('floats on the surface with a little freeboard when the ballast is empty', () => {
    const s = new Submarine(P, { x: 0, y: -3, z: 0 });
    run(s, 25, { ballast: 0 });
    expect(speed(s)).toBeLessThan(0.15);
    expect(s.pos.y).toBeGreaterThan(LEVEL - 1.1); // hull top clears the water
    expect(s.pos.y).toBeLessThan(LEVEL + 0.5);
    expect(s.depth()).toBeLessThan(1.3);
  });
  it('floods ballast to dive, and holds its depth with neutral ballast', () => {
    const s = new Submarine(P, { x: 0, y: LEVEL, z: 0 });
    run(s, 14, { ballast: 1 });
    expect(s.depth()).toBeGreaterThan(8);
    run(s, 6, { ballast: 0.5 }); // go neutral: bleed off the sink rate with a little lift
    const d0 = s.depth();
    run(s, 12, { ballast: 0.5 });
    expect(Math.abs(s.depth() - d0)).toBeLessThan(1.5); // hovers
  });
  it('vertical thrusters move it up and down even when neutral', () => {
    const s = new Submarine(P, { x: 0, y: -10, z: 0 });
    run(s, 12, { ballast: 0.5, heave: 1 });
    expect(s.pos.y).toBeGreaterThan(-6);
    run(s, 20, { ballast: 0.5, heave: -1 });
    expect(s.pos.y).toBeLessThan(-9);
  });
  it('drives forward along its heading to a terminal speed of ~4-5 m/s, then coasts to a stop', () => {
    const s = new Submarine(P, { x: 0, y: -4, z: 0, yaw: 0 });
    run(s, 25, { ballast: 0.5, throttle: 1 });
    expect(speed(s)).toBeGreaterThan(3);
    expect(speed(s)).toBeLessThan(5.5);
    expect(s.pos.z).toBeGreaterThan(40); // heading 0 = +Z
    run(s, 25, { ballast: 0.5, throttle: 0 });
    expect(speed(s)).toBeLessThan(0.4);
  });
  it('steers: the rudder turns the heading', () => {
    const s = new Submarine(P, { x: 0, y: -4, z: 0, yaw: 0 });
    run(s, 8, { ballast: 0.5, throttle: 0.6, yaw: 1 });
    expect(Math.abs(s.heading())).toBeGreaterThan(0.3);
  });
  it('rests on the seabed instead of sinking through it', () => {
    P.col.addBox(0, 0, 80, 80, 0, -30, -12); // seabed top at y = -12
    const s = new Submarine(P, { x: 0, y: -4, z: 0 });
    run(s, 40, { ballast: 1 });
    expect(s.pos.y).toBeGreaterThan(-12.1);
    expect(s.pos.y).toBeLessThan(-10);
  });
  it('rights itself after being rolled', () => {
    const s = new Submarine(P, { x: 0, y: -6, z: 0, roll: 0.7 });
    run(s, 20, { ballast: 0.5 });
    expect(Math.abs(s.roll())).toBeLessThan(0.08);
  });
  it('drains the battery with use and cannot thrust when flat', () => {
    const s = new Submarine(P, { x: 0, y: -4, z: 0 });
    run(s, 20, { ballast: 0.5, throttle: 1 });
    expect(s.battery).toBeLessThan(100);
    s.battery = 0;
    const z0 = s.pos.z; run(s, 5, { ballast: 0.5, throttle: 1 });
    expect(s.pos.z - z0).toBeLessThan(15); // coasting only
  });
  it('holds a chosen depth with the depth hold, even when pushed off it', () => {
    const s = new Submarine(P, { x: 0, y: -10, z: 0 });
    run(s, 6, { ballast: 0.5, holdY: -10 });
    s.body.applyImpulse({ x: 0, y: 12000, z: 0 }, true); // a shove upwards
    run(s, 20, { ballast: 0.5, holdY: -10 });
    expect(Math.abs(s.pos.y + 10)).toBeLessThan(0.5);
    expect(Math.abs(s.body.linvel().y)).toBeLessThan(0.2);
  });
  it('surfaces by itself when the ballast is blown from depth, and floats there', () => {
    const s = new Submarine(P, { x: 0, y: -14, z: 0 });
    run(s, 40, { ballast: 0 });
    expect(s.depth()).toBeLessThan(1.3);
    expect(speed(s)).toBeLessThan(0.2);
  });});
