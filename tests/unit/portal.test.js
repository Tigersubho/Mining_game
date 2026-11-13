import { describe, it, expect } from 'vitest';
import { createPhysics, addHeightfield, addTerrainCollider } from '../../src/engine/world/physics.js';
import { makeCave, addCaveColliders } from '../../src/engine/world/cave.js';
import { Motor } from '../../src/engine/player/motor.js';

// A hillside rising 0.5 m per metre from the portal (x = 0), with a tunnel driven straight into it.
const N = 101, SIZE = 200, half = SIZE / 2, CELL = SIZE / (N - 1);
const hill = (x) => Math.max(0, x) * 0.5;
const heights = new Float32Array(N * N);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) heights[j * N + i] = hill(-half + i * CELL);
const cave = makeCave({ segments: [{ x0: -6, z0: 0, x1: 70, z1: 0, w: 6 }], cell: 3, floorY: 0, height: 3.8, entry: { x: -6, z: 0, w: 6 } });
const isHole = (x, z) => cave.near(x, z, 1.2) && hill(x) < cave.floorY + cave.height + 2.5; // same rule as the visual cutout
const zone = { x0: -40, z0: -20, x1: 90, z1: 20 };

async function world(holes) {
  const P = await createPhysics();
  if (holes) addTerrainCollider(P, heights, N, SIZE, { zones: [zone], isHole }); else addHeightfield(P, heights, N, SIZE);
  addCaveColliders(P.col, cave);
  P.world.step();
  return P;
}
const walk = (P, from, vx, sec) => {
  const m = new Motor(P);
  m.teleport(from, 0, 0); P.world.step();
  for (let i = 0; i < 60 * sec; i++) { m.step(1 / 60, { vx }); P.world.step(); }
  return m.pos;
};

describe('terrain collider with cave cutouts', () => {
  it('REGRESSION: a plain hillside heightfield cuts across the tunnel mouth and blocks you', async () => {
    expect(walk(await world(false), -25, 6, 14).x).toBeLessThan(10);
  });
  it('with true holes you walk in through the portal and far down the tunnel', async () => {
    const p = walk(await world(true), -25, 6, 14);
    expect(p.x).toBeGreaterThan(55);
    expect(Math.abs(p.z)).toBeLessThan(3);
  });
  it('the hillside is still solid outside the holes: you can walk up the slope beside the portal', async () => {
    const P = await world(true);
    const m = new Motor(P);
    m.teleport(-8, 0, 12); P.world.step(); // beside the tunnel, on the foot of the hill
    for (let i = 0; i < 60 * 8; i++) { m.step(1 / 60, { vx: 4 }); P.world.step(); }
    expect(m.pos.x).toBeGreaterThan(14);
    expect(m.pos.y).toBeGreaterThan(5); // climbed the hill, did not fall into the zone
  });
  it('and you cannot fall through the ground in the zone away from the holes', async () => {
    const P = await world(true);
    const m = new Motor(P);
    m.teleport(60, hill(60) + 1, 15); P.world.step(); // on the hillside above the tunnel zone (inside the trimesh area)
    for (let i = 0; i < 90; i++) { m.step(1 / 60, {}); P.world.step(); }
    expect(m.pos.y).toBeGreaterThan(hill(60) - 0.5); // held up by the trimesh, did not fall into the tunnel
  });
});

