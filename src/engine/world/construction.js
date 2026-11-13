import * as THREE from 'three';
import { createExcavator } from '../survey/models.js';
import { armPose } from '../survey/excavator.js';
import { CONS_AXIS, CONS_LAT, consLoc, PIT } from '../config.js';
import { mulberry32 } from '../noise.js';
import { heightAt } from './terrain.js';
import { Batch } from './batch.js';
import { makeRamp } from './structures.js';
import { signMesh } from './textures.js';
import {
  container, cone, barrel, jersey, crate, pile, excavator, dumpTruck, mixerTruck, lamp,
} from './props.js';

// Local frame helpers: f = along the sector axis (away from the hub), l = lateral.
const RY = Math.atan2(CONS_AXIS[0], CONS_AXIS[1]); // mesh yaw whose +Z points along +f
const L = (f, l) => consLoc(f, l);
const STEEL = 0x5b6068, YELLOW = 0xf2b705, CONC = 0xa9a79e;

export function buildConstruction(ctx) {
  const rng = mulberry32(555);
  const { col, scene } = ctx;
  const B = ctx.b.cons;
  const G = ctx.glow;

  const signAt = (lines, w, h, x, y, z, ry, opts = {}) => {
    const s = signMesh(lines, w, h, { w: 1024, h: Math.round(1024 * h / w), ...opts });
    s.position.set(x, y, z);
    s.rotation.y = ry;
    scene.add(s);
    const s2 = signMesh(lines, w, h, { w: 1024, h: Math.round(1024 * h / w), ...opts });
    s2.position.set(x - Math.sin(ry) * 0.05, y, z - Math.cos(ry) * 0.05);
    s2.rotation.y = ry + Math.PI;
    scene.add(s2);
  };

  // ------------------------------------------------------------- gate arch
  {
    const f = 58;
    for (const sg of [-1, 1]) {
      const [x, z] = L(f, sg * 6.8);
      B.box(x, heightAt(x, z) + 3.6, z, 0.8, 7.4, 0.8, YELLOW, RY);
      col.addCircle(x, z, 0.6, -5, 12);
    }
    const [bx, bz] = L(f, 0);
    const by = heightAt(bx, bz) + 7.4;
    B.box(bx, by, bz, 0.7, 0.9, 14.6, STEEL, RY);
    signAt([{ text: 'MINING HAVEN', size: 130 }, { text: 'CONSTRUCTION SITE', size: 80, color: '#ffffff' }], 10, 2.6, bx - CONS_AXIS[0] * 0.5, by - 0.2, bz - CONS_AXIS[1] * 0.5, RY + Math.PI, { bg: '#1a1d22' });
    // chain-link fencing flanking the gate
    for (const sg of [-1, 1]) {
      for (let k = 0; k < 7; k++) {
        const [x, z] = L(f, sg * (9.6 + k * 2.6));
        const y = heightAt(x, z);
        B.box(x, y + 0.95, z, 0.1, 1.9, 0.1, STEEL);
        B.box(x, y + 0.95, z, 0.04, 1.6, 2.6, 0xb4bcc4, RY + Math.PI / 2);
        col.addBox(x, z, 0.3, 1.3, -(RY + Math.PI / 2), -5, y + 1.9);
      }
    }
  }

  // ------------------------------------------------------ site offices
  for (let k = 0; k < 3; k++) {
    const [x, z] = L(72, 16 + k * 3.2);
    const y = heightAt(x, z);
    container(B, col, x, z, RY, 0xe8e6df, y, k === 1 ? 2 : 1);
    for (let w = -1; w <= 1; w += 2) {
      const wx = x + Math.cos(RY) * 1.23, wz = z - Math.sin(RY) * 1.23;
      B.box(wx + Math.sin(RY) * w * 1.7, y + 1.4, wz + Math.cos(RY) * w * 1.7, 0.08, 0.8, 1.1, 0x7ba7c9, RY);
    }
  }
  {
    const [x, z] = L(72, 9);
    const y = heightAt(x, z);
    B.box(x, y + 0.7, z, 1.3, 1.4, 2.2, 0x2f6f4a, RY);
    B.cyl(x, y + 1.6, z, 0.1, 0.1, 0.6, 0x222222, 6);
    col.addBox(x, z, 0.65, 1.1, -RY, -5, y + 1.4, true);
  }

  // ---------------------------------------- building under construction
  {
    const [cx, cz] = L(98, 32);
    const y0 = heightAt(cx, cz);
    const half = 8.3, FL = 4.2;
    const at = (f, l, y) => { const [x, z] = L(98 + f, 32 + l); return [x, y, z]; };
    for (let k = 1; k <= 3; k++) {
      B.box(cx, y0 + FL * k - 0.25, cz, half * 2, 0.5, half * 2, CONC, RY);
    }
    for (const f of [-6.5, 0, 6.5]) for (const l of [-6.5, 0, 6.5]) {
      const [x, , z] = at(f, l, 0);
      B.box(x, y0 + (FL * 3 - 1) / 2 - 0.5, z, 0.8, FL * 3 + 1, 0.8, 0xb8b6ad, RY);
      B.cyl(x, y0 + FL * 3 + 0.9, z, 0.03, 0.03, 1.8, 0x8a4a2a, 4);
      col.addCircle(x, z, 0.55, -5, y0 + FL * 3);
    }
    // 1st floor is walkable
    col.addDeck({ x: cx, z: cz, ux: CONS_AXIS[0], uz: CONS_AXIS[1], hl: half, hw: half, hA: y0 + FL, hB: y0 + FL });
    // edge barriers (leave a gap on the -f side for the ramp)
    const wall = (f, l, lenF, lenL) => {
      const [x, , z] = at(f, l, 0);
      B.box(x, y0 + FL + 0.55, z, lenL, 1.1, lenF, YELLOW, RY);
      col.addBox(x, z, lenL / 2, lenF / 2, -RY, y0 + FL - 0.4, y0 + FL + 1.1);
    };
    wall(half, 0, 0.2, half * 2); // +f
    wall(0, half, half * 2, 0.2); // +l
    wall(0, -half, half * 2, 0.2); // -l
    wall(-half, -5.6, 0.2, 5.6); // -f, two halves around a 4.8 m ramp gap
    wall(-half, 5.6, 0.2, 5.6);
    // ramp up from the -f side
    const rampL = 13;
    const [rx, , rz] = at(-half - rampL, 0, 0);
    makeRamp(B, col, { x: rx, z: rz, dx: CONS_AXIS[0], dz: CONS_AXIS[1], L: rampL, W: 4.6, hA: heightAt(rx, rz) + 0.08, hB: y0 + FL, color: 0xa9a79e, top: 0x6a6760 });
    // scaffolding on the +l side
    for (let k = 0; k < 4; k++) {
      const [x, , z] = at(-7.5 + k * 5, half + 1.4, 0);
      B.box(x, y0 + 6.5, z, 0.14, 13, 0.14, 0xc6c9cc);
    }
    for (let lvl = 1; lvl <= 3; lvl++) {
      const [x, , z] = at(0, half + 1.4, 0);
      B.box(x, y0 + lvl * 4.2 - 0.9, z, 1.6, 0.14, 16, 0x9a7a4a, RY);
      B.box(x, y0 + lvl * 4.2, z, 0.1, 0.1, 16, 0xc6c9cc, RY);
    }
    // material hoist + stacked bricks
    for (let k = 0; k < 6; k++) crate(B, col, ...L(92 + (k % 3) * 1.3, 11 + Math.floor(k / 3) * 1.3), RY, 1.1, undefined, 0xb4553b);
    ctx.oreSpots.push([...L(106, 52), 'chalcopyrite']);
  }

  // ----------------------------------------------------------- tower crane
  towerCrane(ctx, ...L(114, 12));

  // ----------------------------------------------------------- south yard
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 2; c++) {
      const [x, z] = L(44 + c * 8.5, -18 - r * 3.7);
      container(B, col, x, z, RY, undefined, undefined, rng() < 0.4 ? 2 : 1);
    }
  }
  // pipe rack + pallets + piles
  for (let k = 0; k < 6; k++) {
    const [x, z] = L(50, -35 - (k % 3) * 0.85);
    const y = heightAt(x, z);
    B.cyl(x, y + 0.42 + (k > 2 ? 0.72 : 0), z, 0.4, 0.4, 7, 0x2a7bd6, 10, RY, Math.PI / 2, 0);
  }
  {
    const [x, z] = L(50, -36.5);
    col.addBox(x, z, 1.7, 3.6, -RY, -5, heightAt(x, z) + 1.2, true);
  }
  for (const [f, l, r] of [[52, -50, 3.4], [58, -53, 2.6], [46, -54, 3]]) { const [x, z] = L(f, l); pile(B, col, x, z, r, r > 3 ? 0xb8a98a : 0x8e8e88); }
  for (let k = 0; k < 10; k++) { const [x, z] = L(41 + (k % 5) * 1.3, -44 - Math.floor(k / 5) * 1.3); crate(B, col, x, z, RY, 1, undefined, k % 2 ? 0xc9a96b : 0x9a7646); }
  for (let k = 0; k < 6; k++) { const [x, z] = L(56 + (k % 3) * 1.0, -32 - Math.floor(k / 3) * 1.0); barrel(B, col, x, z, [0xd35400, 0x2e6da4, 0x1e8449][k % 3]); }
  ctx.oreSpots.push([...L(58, -62), 'malachite']);

  // ----------------------------------------------------------- machines
  // (the dump trucks and the mixer that used to stand here are now hauler vehicles that drive the haul roads - see agents/fleet.js)
  { // the site excavator keeps digging: its arm runs the same scoop cycle as the one you can call
    const [x, z] = L(88, -62), y = heightAt(x, z), mesh = createExcavator(), u = mesh.userData;
    mesh.position.set(x, y, z); mesh.rotation.y = RY + 2.4; ctx.scene.add(mesh);
    col.addBox(x, z, 1.9, 2.6, -(RY + 2.4), y - 0.5, y + 3.2);
    ctx.updaters.push((dt, t) => { const a = armPose(t + 7, 4000); u.house.rotation.y = a.swing; u.boom.rotation.x = a.boom; u.stick.rotation.x = a.stick; u.bucket.rotation.x = a.bucket; u.load.visible = a.loaded; });
  }

  // ------------------------------------------------- haul road dressing
  for (let k = 0; k < 6; k++) {
    for (const sg of [-1, 1]) {
      const [x, z] = L(70 + k * 3.1, sg * 5.3);
      if (k >= 1) jersey(B, col, x, z, RY, sg > 0 ? 0xcfcfc8 : 0xcfcfc8);
    }
  }
  for (let k = 0; k < 12; k++) for (const sg of [-1, 1]) { const [x, z] = L(46 + k * 3.2, sg * 4.7); cone(B, col, x, z); }
  for (const sg of [-1, 1]) {
    const [x, z] = L(83, sg * 7.2);
    const y = heightAt(x, z);
    signAt([{ text: 'DANGER', size: 120, color: '#e5484d' }, { text: 'OPEN PIT - KEEP OUT', size: 62, color: '#ffffff' }], 4.4, 1.8, x, y + 2.9, z, RY + Math.PI, { bg: '#2a1b0a', fg: '#ffb020', border: '#ff4d2e' });
    B.cyl(x, y + 1.4, z, 0.08, 0.08, 2.8, STEEL, 5);
  }

  // floodlight towers
  for (const [f, l] of [[56, -20], [112, 38], [70, 30], [86, 62]]) {
    const [x, z] = L(f, l);
    const y = heightAt(x, z);
    B.cyl(x, y + 5, z, 0.12, 0.2, 10, STEEL, 6);
    B.box(x, y + 10.1, z, 2.6, 0.6, 0.4, 0x2b2b2b, RY);
    G.box(x, y + 10.0, z, 2.4, 0.4, 0.1, 0xfff6c8, RY + 0.0);
    col.addCircle(x, z, 0.3, -5, y + 10);
  }

  // ---------------------------------------------------------- headframe
  {
    const [hx, hz] = L(152, 76);
    const hy = heightAt(hx, hz);
    const hf = new Batch();
    const H = 22;
    for (const zz of [-2.6, 2.6]) {
      for (const sg of [-1, 1]) {
        const dx = 3.8, tilt = Math.atan2(dx, H);
        hf.box(sg * (dx / 2 + 0.7), H / 2, zz, 0.55, Math.hypot(H, dx), 0.55, 0x6a4a2a, 0, 0, sg * tilt);
      }
    }
    for (const yy of [5, 10, 15]) {
      const half = 0.7 + (3.8 * (H - yy)) / H;
      hf.box(0, yy, -2.6, half * 2, 0.35, 0.35, 0x6a4a2a);
      hf.box(0, yy, 2.6, half * 2, 0.35, 0.35, 0x6a4a2a);
      hf.box(0, yy, 0, 0.35, 0.35, 5.4, 0x6a4a2a);
    }
    hf.cyl(0, H + 0.4, 0, 2.3, 2.3, 0.7, 0x3d4349, 16, 0, Math.PI / 2, 0);
    hf.cyl(0, H + 0.4, 0, 0.5, 0.5, 1.2, 0xf2b705, 8, 0, Math.PI / 2, 0);
    hf.box(-9, 1.6, 0, 6, 3.2, 5, 0x8c8a82);
    hf.box(-9, 3.4, 0, 6.6, 0.4, 5.6, 0xb4553b);
    hf.box(-4.5, (H + 0.4 + 3.5) / 2, 0, 0.1, Math.hypot(9, H - 3), 0.1, 0x222222, 0, 0, -Math.atan2(9, H - 3.1));
    const m = hf.build(ctx.propMat);
    const th = RY + Math.PI / 2;
    m.position.set(hx, hy, hz);
    m.rotation.y = th;
    scene.add(m);
    const cs = Math.cos(th), sn = Math.sin(th);
    const toWorld = (lx, lz) => [hx + lx * cs + lz * sn, hz - lx * sn + lz * cs];
    for (const zz of [-2.6, 2.6]) for (const sg of [-1, 1]) {
      const [wx, wz] = toWorld(sg * 4.5, zz);
      col.addCircle(wx, wz, 0.8, -5, hy + 22);
    }
    const [hutX, hutZ] = toWorld(-9, 0);
    col.addBox(hutX, hutZ, 3, 2.5, -th, -5, hy + 3.4, true);
  }

  // ---------------------------------------------------------- ore spots in the pit
  const nodes = [];
  for (let tries = 0; nodes.length < 16 && tries < 400; tries++) {
    const a = rng() * Math.PI * 2, d = 7 + rng() * 36;
    const x = PIT.x + Math.cos(a) * d, z = PIT.z + Math.sin(a) * d;
    const dx = x - PIT.x, dz = z - PIT.z;
    const along = dx * PIT.vx + dz * PIT.vz, perp = Math.abs(dx * PIT.nx + dz * PIT.nz);
    if (perp < 11 && along > -12) continue;
    if (nodes.some(([nx, nz]) => Math.hypot(nx - x, nz - z) < 7)) continue;
    nodes.push([x, z]);
  }
  nodes.forEach(([x, z], i) => ctx.oreSpots.push([x, z, i % 7 === 0 ? 'gold' : i % 3 === 0 ? 'hematite' : i % 2 ? 'chalcopyrite' : 'malachite']));
  // a couple of mine carts on the pit floor
  for (const [f, l] of [[128, 6], [143, -7]]) {
    const [x, z] = L(f, l);
    const y = heightAt(x, z);
    B.box(x, y + 0.75, z, 1.6, 0.9, 2.3, 0x8a4a2a, RY + 0.4);
    B.box(x, y + 1.28, z, 1.4, 0.18, 2.1, 0x3a3a42, RY + 0.4);
    col.addBox(x, z, 0.85, 1.2, -(RY + 0.4), -5, y + 1.25, true);
  }
}

// ======================================================================== tower crane
function towerCrane(ctx, x, z) {
  const B = ctx.b.cons;
  const y0 = heightAt(x, z) - 0.6;
  const SEC = 3, N = 14, w = 2.2;
  for (let k = 0; k < N; k++) {
    const yb = y0 + k * SEC, yc = yb + SEC / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(x + sx * w / 2, yc, z + sz * w / 2, 0.24, SEC, 0.24, YELLOW);
    for (const sg of [-1, 1]) {
      B.box(x, yb, z + sg * w / 2, w, 0.14, 0.14, YELLOW);
      B.box(x + sg * w / 2, yb, z, 0.14, 0.14, w, YELLOW);
      const len = Math.hypot(w, SEC), ang = Math.atan2(SEC, w) * (k % 2 ? 1 : -1);
      B.box(x, yc, z + sg * w / 2, len, 0.12, 0.12, YELLOW, 0, 0, ang);
      B.box(x + sg * w / 2, yc, z, 0.12, 0.12, len, YELLOW, 0, ang, 0);
    }
  }
  ctx.col.addBox(x, z, 1.7, 1.7, 0, -5, y0 + N * SEC);
  B.box(x, y0 + 0.4, z, 4.4, 0.8, 4.4, 0x8a8a82); // base slab
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(x + sx * 2.1, y0 + 1.1, z + sz * 2.1, 1.2, 1.4, 1.2, 0x555555); // ballast

  // rotating part (pivot at mast top)
  const R = new Batch();
  R.cyl(0, 0.4, 0, 1.5, 1.5, 0.8, 0x444444, 12);
  R.box(1.6, 1.1, 0, 2.2, 2.0, 1.8, YELLOW); // cab
  R.box(2.75, 1.2, 0, 0.06, 1.0, 1.4, 0x2a3a4a);
  // jib
  const jib = 38;
  R.box(jib / 2, 1.5, 0, jib, 0.18, 0.18, YELLOW);
  R.box(jib / 2, 0.2, -0.7, jib, 0.16, 0.16, YELLOW);
  R.box(jib / 2, 0.2, 0.7, jib, 0.16, 0.16, YELLOW);
  for (let t = 0; t < jib; t += 2) {
    const a = Math.atan2(1.3, 1);
    R.box(t + 0.5, 0.85, 0, Math.hypot(1.3, 1), 0.1, 0.1, 0xd9a400, 0, 0, t % 4 ? a : -a);
    R.box(t + 1, 0.2, 0, 0.1, 0.1, 1.4, 0xd9a400);
  }
  // counter jib
  R.box(-6, 1.0, 0, 12, 0.2, 1.4, YELLOW);
  for (let k = 0; k < 3; k++) R.box(-9 + k * 0.1, 1.9 + k * 0.0, 0, 2.0, 1.6, 1.6, 0x9a9a92);
  R.box(-9, 0.8, 0, 2.2, 0.4, 1.6, 0x777777);
  // apex + tie cables
  R.box(0, 4.2, 0, 0.5, 7.4, 0.5, YELLOW);
  R.box(9.5, 4.55, 0, Math.hypot(19, 6.1), 0.06, 0.06, 0x333333, 0, 0, -Math.atan2(6.1, 19));
  R.box(-6, 4.3, 0, Math.hypot(12, 6.6), 0.06, 0.06, 0x333333, 0, 0, Math.atan2(6.6, 12));
  // trolley, hook, load
  R.box(23, 0.1, 0, 1.2, 0.4, 1.1, 0x333333);
  R.box(23, -7.5, 0, 0.05, 15, 0.05, 0x222222);
  R.box(23, -15.2, 0, 0.5, 0.6, 0.5, 0xff7a00);
  R.box(23, -16.4, 0, 2.2, 1.0, 2.2, 0xb4553b);
  const mesh = R.build(ctx.propMat);
  mesh.position.set(x, y0 + N * SEC, z);
  mesh.rotation.y = 0.8;
  ctx.scene.add(mesh);
  ctx.updaters.push((dt) => { mesh.rotation.y += dt * 0.07; });
}


