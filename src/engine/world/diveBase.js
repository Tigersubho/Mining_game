import * as THREE from 'three';
import { DIVE, LAKE } from '../config.js';
import { heightAt } from './terrain.js';
import { signMesh } from './textures.js';
import { Submarine } from '../vehicles/submarine.js';
import { createSubmarineMesh, loadSubmarineModel, syncSubmarine } from '../vehicles/submarineView.js';
import { WATER_Y } from '../config.js';

const STEEL = 0x6b7279, WOOD = 0x7a6244, HULL = 0x5f6b6e;

/** the lake dive base (dock, shed, tank rack), the submarine, two wrecks and seabed ore */
export function buildDiveBase(ctx, physics) {
  const { col, scene } = ctx, B = ctx.b.dive, G = ctx.glow;
  const [tx, tz] = DIVE.toWater, ry = Math.atan2(tx, tz), nx = -tz, nz = tx; // forward (to the water) and lateral
  const y0 = heightAt(DIVE.x, DIVE.z);
  const at = (s, l, y = y0) => [DIVE.x + tx * s + nx * l, y, DIVE.z + tz * s + nz * l];

  // ---- pier: 64 m of decking out over deep water, on piles
  const [px, , pz] = at(33.5, 0);
  B.box(px, y0 - 0.15, pz, 4.2, 0.3, 61, WOOD, ry);
  col.addDeck({ x: px, z: pz, ux: tx, uz: tz, hl: 30.5, hw: 2.1, hA: y0, hB: y0 });
  for (let s = 6; s <= 62; s += 7) for (const l of [-1.8, 1.8]) {
    const [x, , z] = at(s, l), bed = heightAt(x, z);
    B.cyl(x, (bed - 1 + y0) / 2, z, 0.28, 0.3, y0 - bed + 1, 0x4a3a28, 7);
    col.addCircle(x, z, 0.35, bed - 1, y0 - 0.3);
  }
  for (const l of [-2, 2]) { // handrails
    const [x, , z] = at(33.5, l);
    B.box(x, y0 + 0.55, z, 0.1, 0.1, 61, STEEL, ry);
    col.addBox(x, z, 0.12, 30.5, -ry, y0 - 0.3, y0 + 1.1);
  }
  for (let s = 8; s <= 60; s += 13) for (const l of [-2.1, 2.1]) { const [x, , z] = at(s, l); G.box(x, y0 + 1.1, z, 0.22, 0.22, 0.22, 0xffe2a8); B.cyl(x, y0 + 0.5, z, 0.05, 0.05, 1.0, STEEL, 5); }

  // ---- shed + equipment
  const [sx, , sz] = at(-4, 11);
  B.box(sx, y0 + 2, sz, 9, 4, 6, 0x4b5a52, ry + Math.PI / 2);
  B.box(sx, y0 + 4.2, sz, 9.6, 0.5, 6.6, 0x2f3a35, ry + Math.PI / 2);
  col.addBox(sx, sz, 3.1, 4.6, -(ry + Math.PI / 2), -5, y0 + 4.4);
  const sign = signMesh([{ text: 'DIVE BASE', size: 130 }, { text: 'SCUBA - SUBMERSIBLES', size: 58, color: '#ffffff' }], 5.4, 1.7, { w: 1024, h: 322, bg: '#10242e', fg: '#e0a526', border: '#e0a526' });
  sign.position.set(sx + tx * 3.2, y0 + 3.0, sz + tz * 3.2); sign.rotation.y = ry;
  scene.add(sign);
  for (let k = 0; k < 6; k++) { // cylinder rack
    const [x, , z] = at(1.5, 6 + k * 0.55);
    B.cyl(x, y0 + 0.5, z, 0.2, 0.2, 1.2, k % 2 ? 0xdfe3e6 : 0x2d6fa3, 9);
  }
  col.addBox(...at(1.5, 7.4).filter((_, i) => i !== 1), 0.4, 1.0, -ry, y0 - 0.2, y0 + 1.2);
  for (let k = 0; k < 3; k++) { const [x, , z] = at(0.5 + k * 1.2, 15); col.dyn.add('crate', x, y0, z, { ry: k, s: 0.9, color: 0x4a6a5a }); }
  G.sph(...at(-4, 11.0, y0 + 4.6), 0.18, 0xffe2a8, 1, 1, 1, 0);

  // ---- the submarine, moored beside the pier head
  const mesh = createSubmarineMesh();
  // .glb submarine switched off: the low-poly one stays (loadSubmarineModel(mesh) brings it back)
  const [bx, , bz] = at(58, 5.5);
  const sub = new Submarine(physics, { x: bx, y: WATER_Y - 0.4, z: bz, yaw: ry });
  scene.add(mesh);
  const state = { sub, mesh, input: null, lights: false, boarded: false };
  ctx.updaters.push((dt) => {
    sub.step(dt, { level: WATER_Y, ballast: 0, ...(state.input ?? {}) });
    syncSubmarine(mesh, sub, state.input?.throttle ?? 0, dt, state.lights);
  });

  // ---- wrecks (a shallow tug for scuba, a deep barge for the submarine)
  const wreck = (cx, cz, len, wid, yaw, tilt, gold) => {
    const y = heightAt(cx, cz);
    B.box(cx, y + 1.2, cz, wid, 2.4, len, HULL, yaw, tilt);
    B.box(cx - Math.sin(yaw) * len * 0.22, y + 3.2, cz - Math.cos(yaw) * len * 0.22, wid * 0.7, 2.2, len * 0.28, 0x7c8588, yaw, tilt);
    B.cyl(cx + Math.sin(yaw) * len * 0.1, y + 4.6, cz + Math.cos(yaw) * len * 0.1, 0.5, 0.5, 2.6, 0x4d5558, 8, 0, 0, tilt);
    for (let k = 0; k < 4; k++) B.box(cx + Math.sin(yaw) * (k - 1.5) * 2.1 + 0.8, y + 2.7, cz + Math.cos(yaw) * (k - 1.5) * 2.1, 1.4, 1.2, 1.4, 0x8a6a45, yaw + k);
    col.addBox(cx, cz, wid / 2, len / 2, -yaw, y - 2, y + 3.4);
    if (gold) ctx.oreSpots.push([cx + Math.sin(yaw) * 2.2, cz + Math.cos(yaw) * 2.2, 'gold', y + 2.5]);
  };
  const ang = (a, rr) => [LAKE.x + Math.cos(a) * rr, LAKE.z + Math.sin(a) * rr];
  wreck(...ang(-1.0, 118), 17, 5.5, 0.9, 0.05, true); // shallow tug
  wreck(...ang(0.4, 62), 26, 8, 2.1, -0.08, true); // deep barge

  // ---- seabed ore: shallow ring (scuba) and deep ring (submarine); the pool beside the hub; the pit floor is flooded too
  const kinds = ['hematite', 'chalcopyrite', 'malachite', 'gold'];
  for (let k = 0; k < 18; k++) {
    const a = -1.9 + k * 0.33, rr = k < 8 ? 112 + (k % 4) * 6 : 50 + (k % 5) * 12;
    const [x, z] = ang(a, rr);
    ctx.oreSpots.push([x, z, kinds[(k * 7 + 3) % 4]]);
  }
  for (const [x, z] of [[19, 0], [-9.5, 16.5], [-9.5, -16.5]]) ctx.oreSpots.push([x, z, 'malachite']);
  return state;
}
