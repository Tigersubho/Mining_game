import * as THREE from 'three';
import { heightAt } from './terrain.js';

// Procedural placeholder props. Everything draws into a Batch and registers
// collision. When you provide .glb models these can be swapped one by one.

const PHI = (ry) => -ry; // mesh yaw -> collider rot

export function lamp(b, glow, col, x, z, y = heightAt(x, z), { h = 6, arm = 1.2, ry = 0, color = 0x4b5157 } = {}) {
  b.cyl(x, y + h / 2, z, 0.07, 0.11, h, color, 6);
  const ax = Math.sin(ry) * arm, az = Math.cos(ry) * arm;
  b.box(x + ax / 2, y + h, z + az / 2, Math.abs(ax) + 0.12, 0.1, Math.abs(az) + 0.12, color);
  glow.box(x + ax, y + h - 0.08, z + az, 0.5, 0.14, 0.34, 0xfff3c4, ry);
  col.addCircle(x, z, 0.2, -5, y + h);
}

export function treeSmall(b, col, x, z, y = heightAt(x, z), s = 1) {
  b.cyl(x, y + 1.2 * s, z, 0.12 * s, 0.18 * s, 2.4 * s, 0x6b4a2e, 5);
  b.sph(x, y + 3.2 * s, z, 1.5 * s, 0x3f8f3a, 1, 0.9, 1, 1);
  b.sph(x + 0.5 * s, y + 4.1 * s, z - 0.2 * s, 1.0 * s, 0x4aa044, 1, 0.9, 1, 1);
  col.addCircle(x, z, 0.3 * s, -5, y + 3);
}

export function bench(b, col, x, z, ry = 0, y = heightAt(x, z)) {
  b.box(x, y + 0.45, z, 1.8, 0.1, 0.5, 0x8a5a2b, ry);
  b.box(x - Math.sin(ry) * 0.22, y + 0.8, z - Math.cos(ry) * 0.22, 1.8, 0.4, 0.08, 0x8a5a2b, ry);
  for (const s of [-0.75, 0.75]) b.box(x + Math.cos(ry) * s, y + 0.22, z - Math.sin(ry) * s, 0.1, 0.44, 0.45, 0x333333, ry);
  col.addBox(x, z, 0.9, 0.3, PHI(ry), -5, y + 0.5, true);
}

export function car(b, col, x, z, ry, color, y = heightAt(x, z), { collide = true } = {}) {
  const cs = Math.sin(ry), cc = Math.cos(ry);
  b.box(x, y + 0.62, z, 1.8, 0.7, 4.3, color, ry);
  b.box(x - cs * 0.15, y + 1.2, z - cc * 0.15, 1.6, 0.55, 2.2, color, ry);
  b.box(x - cs * 0.15, y + 1.22, z - cc * 0.15, 1.64, 0.4, 2.0, 0x22303c, ry); // glass band
  b.box(x + cs * 2.1, y + 0.55, z + cc * 2.1, 1.7, 0.18, 0.12, 0x222222, ry); // bumper
  for (const sx of [-0.9, 0.9]) for (const sz of [-1.4, 1.4]) {
    b.cyl(x + cc * sx + cs * sz, y + 0.34, z - cs * sx + cc * sz, 0.34, 0.34, 0.26, 0x1c1c1c, 10, ry, 0, Math.PI / 2);
  }
  if (collide) col.addBox(x, z, 0.95, 2.15, PHI(ry), -5, y + 1.45, true);
}

const CONTAINER_COLORS = [0xc0392b, 0x2e6da4, 0xd68910, 0x1e8449, 0x7d3c98, 0x5d6d7e, 0xb7950b];
export function container(b, col, x, z, ry, color, y = heightAt(x, z), stack = 1) {
  const c = color ?? CONTAINER_COLORS[Math.floor(Math.abs(Math.sin(x * 12.9 + z * 78.2)) * 7)];
  const rib = new THREE.Color(c).multiplyScalar(0.78);
  for (let k = 0; k < stack; k++) {
    const yy = y + 1.2 + k * 2.4;
    b.box(x, yy, z, 2.44, 2.4, 6.06, c, ry);
    // ribs
    for (let i = -5; i <= 5; i++) {
      const o = i * 0.5;
      b.box(x + Math.sin(ry) * o, yy, z + Math.cos(ry) * o, 2.5, 2.3, 0.05, rib, ry);
    }
  }
  col.addBox(x, z, 1.22, 3.03, PHI(ry), -5, y + stack * 2.4, true);
}

export function cone(b, col, x, z, y = heightAt(x, z)) {
  col.dyn.add('cone', x, y, z, { color: 0xff6a13 });
}

export function barrel(b, col, x, z, color = 0xd35400, y = heightAt(x, z)) {
  col.dyn.add('barrel', x, y, z, { color });
}

export function jersey(b, col, x, z, ry, color = 0xcfcfc8, y = heightAt(x, z)) {
  b.box(x, y + 0.4, z, 0.55, 0.8, 2.9, color, ry);
  b.box(x, y + 0.55, z, 0.57, 0.12, 2.92, 0xff7a00, ry);
  col.addBox(x, z, 0.28, 1.45, PHI(ry), -5, y + 0.8, true);
}

export function crate(b, col, x, z, ry = 0, s = 1, y = heightAt(x, z), color = 0x9a7646) {
  col.dyn.add('crate', x, y, z, { ry, s, color });
}

export function pile(b, col, x, z, r, color = 0xa89878, y = heightAt(x, z)) {
  b.cone(x, y + r * 0.35, z, r, r * 0.9, color, 9);
  col.addCircle(x, z, r * 0.7, -5, y + r * 0.5, false);
}

// ----------------------------------------------------------- machines (placeholders)
export function excavator(b, col, x, z, ry, y = heightAt(x, z), color = 0xf2b705) {
  const f = (a, up) => [x + Math.sin(ry) * a, z + Math.cos(ry) * a];
  // tracks
  for (const s of [-1.3, 1.3]) {
    const px = x + Math.cos(ry) * s, pz = z - Math.sin(ry) * s;
    b.box(px, y + 0.5, pz, 0.9, 1.0, 4.4, 0x2b2b2b, ry);
    b.box(px, y + 0.5, pz, 0.95, 0.35, 4.5, 0x444444, ry);
  }
  b.box(x, y + 1.15, z, 2.6, 0.45, 3.4, 0x444444, ry);
  // cab + body
  b.box(x, y + 1.9, z, 2.7, 1.0, 3.0, color, ry);
  const [cx, cz] = f(0.7);
  b.box(cx, y + 2.9, cz, 1.6, 1.4, 1.5, color, ry);
  b.box(cx + Math.sin(ry) * 0.76, y + 2.95, cz + Math.cos(ry) * 0.76, 1.4, 1.0, 0.06, 0x2a3a4a, ry);
  // counterweight
  const [bx, bz] = f(-1.6);
  b.box(bx, y + 2.0, bz, 2.4, 1.2, 0.9, 0x333333, ry);
  // boom + stick + bucket
  const [mx, mz] = f(2.7);
  b.box(mx, y + 3.6, mz, 0.5, 0.6, 4.4, color, ry, -0.5);
  const [sx, sz] = f(5.3);
  b.box(sx, y + 4.0, sz, 0.4, 0.5, 3.0, color, ry, 0.7);
  const [kx, kz] = f(6.5);
  b.box(kx, y + 2.5, kz, 1.3, 0.9, 0.8, 0x555555, ry, 0.3);
  col.addBox(x, z, 1.7, 2.4, PHI(ry), -5, y + 3.6, true);
}

export function dumpTruck(b, col, x, z, ry, y = heightAt(x, z), color = 0xf2b705) {
  const s = Math.sin(ry), c = Math.cos(ry);
  const at = (a, up) => [x + s * a, y + up, z + c * a];
  // chassis
  let p = at(0, 1.0);
  b.box(p[0], p[1], p[2], 2.6, 0.5, 8.4, 0x2b2b2b, ry);
  // cab
  p = at(3.1, 2.1);
  b.box(p[0], p[1], p[2], 2.5, 2.0, 2.2, color, ry);
  p = at(4.15, 2.3);
  b.box(p[0], p[1], p[2], 2.2, 1.0, 0.08, 0x2a3a4a, ry);
  // tipping bed
  p = at(-1.2, 2.6);
  b.box(p[0], p[1], p[2], 3.4, 1.8, 5.2, color, ry, -0.05);
  p = at(-1.2, 3.55);
  b.box(p[0], p[1], p[2], 3.0, 0.15, 4.8, 0x6a5a45, ry);
  // wheels
  for (const sx of [-1.35, 1.35]) for (const sz of [-3.0, -1.4, 3.0]) {
    b.cyl(x + c * sx + s * sz, y + 0.75, z - s * sx + c * sz, 0.75, 0.75, 0.55, 0x1b1b1b, 12, ry, 0, Math.PI / 2);
  }
  col.addBox(x, z, 1.8, 4.3, PHI(ry), -5, y + 3.5, false);
}

export function mixerTruck(b, col, x, z, ry, y = heightAt(x, z)) {
  const s = Math.sin(ry), c = Math.cos(ry);
  const at = (a, up) => [x + s * a, y + up, z + c * a];
  let p = at(0, 1.0);
  b.box(p[0], p[1], p[2], 2.5, 0.5, 8.0, 0x2b2b2b, ry);
  p = at(3.0, 2.1);
  b.box(p[0], p[1], p[2], 2.4, 2.0, 2.1, 0xf5f5f0, ry);
  p = at(-1.0, 2.9);
  b.cyl(p[0], p[1], p[2], 0.7, 1.35, 5.2, 0xe8e3d5, 14, ry, -(Math.PI / 2 - 0.25));
  for (const sx of [-1.3, 1.3]) for (const sz of [-3.0, -1.6, 3.0]) {
    b.cyl(x + c * sx + s * sz, y + 0.75, z - s * sx + c * sz, 0.75, 0.75, 0.55, 0x1b1b1b, 12, ry, 0, Math.PI / 2);
  }
  col.addBox(x, z, 1.7, 4.2, PHI(ry), -5, y + 3.6, false);
}


