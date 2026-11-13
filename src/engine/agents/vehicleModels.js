import * as THREE from 'three';
import { Batch } from '../world/batch.js';
import { car } from '../world/props.js';

/**
 * Low-poly stand-ins for the fleet. Every model faces +Z with its origin at ground level, centred.
 * Replace any of them with a .glb later (the fleet only needs a Group).
 */
const wheel = (b, x, y, z, r = 0.38, w = 0.28) => b.cyl(x, y, z, r, r, w, 0x1c1c1c, 10, 0, 0, Math.PI / 2);
const sedan = (b, color) => car(b, null, 0, 0, 0, color, 0, { collide: false });

const BUILD = {
  taxi(b) { sedan(b, 0xf2c200); b.box(0, 1.62, -0.15, 0.7, 0.22, 0.34, 0xf5f5f0); b.box(0, 0.95, 0, 1.84, 0.1, 4.32, 0x222222); },
  car(b, o) { sedan(b, o.color ?? 0x2471a3); },
  jeep(b) {
    b.box(0, 0.75, 0, 1.9, 0.7, 3.6, 0x6b7a3a); b.box(0, 1.25, -0.3, 1.7, 0.1, 1.2, 0x55602e);
    for (const s of [-0.85, 0.85]) b.cyl(s, 1.55, -0.2, 0.05, 0.05, 1.4, 0x222222, 6); // roll bar
    b.box(0, 1.95, -0.2, 1.8, 0.07, 0.07, 0x222222); b.box(0, 1.25, 1.1, 1.7, 0.5, 0.08, 0x6b7a3a);
    b.cyl(0, 0.85, -1.9, 0.34, 0.34, 0.2, 0x1c1c1c, 10, 0, Math.PI / 2, 0); // spare wheel
    for (const sx of [-0.95, 0.95]) for (const sz of [-1.2, 1.2]) wheel(b, sx, 0.45, sz, 0.45, 0.34);
  },
  pickup(b, o) {
    const c = o.color ?? 0xd9d9d2;
    b.box(0, 0.85, 0.6, 1.95, 0.8, 2.2, c); b.box(0, 1.45, 0.45, 1.8, 0.65, 1.3, c); b.box(0, 1.5, 0.45, 1.84, 0.4, 1.1, 0x22303c);
    b.box(0, 0.75, -1.25, 1.95, 0.5, 1.9, c); b.box(0, 1.02, -1.25, 1.7, 0.06, 1.7, 0x555555);
    for (const sx of [-0.95, 0.95]) for (const sz of [-1.4, 1.5]) wheel(b, sx, 0.42, sz, 0.42, 0.3);
  },
  jcb(b) {
    const y = 0xf2b705;
    b.box(0, 0.9, 0, 2.7, 0.8, 8.0, 0x444444); b.box(0, 2.0, 2.6, 2.5, 1.9, 2.4, y); b.box(0, 2.3, 3.5, 2.2, 0.9, 0.08, 0x22303c);
    b.box(0, 1.9, -1.6, 2.4, 1.2, 4.2, y); b.cyl(0, 2.6, -1.8, 1.0, 1.0, 0.4, 0x333333, 12);
    b.box(0, 3.6, -3.0, 0.9, 0.8, 7.5, 0xe0a000, 0, -0.45); b.box(0, 5.4, -6.6, 0.55, 0.55, 5.0, 0xcfd2d4, 0, -0.45);
    for (const sz of [-2.6, -0.5, 2.0, 3.6]) for (const sx of [-1.2, 1.2]) wheel(b, sx, 0.62, sz, 0.62, 0.5);
    for (const sx of [-1.8, 1.8]) b.box(sx, 0.5, -3.2, 1.2, 0.18, 0.5, 0x555555); // outriggers
  },
  tractor(b, o) {
    const c = o.color ?? 0x3f8f3f;
    b.box(0, 1.15, 0.95, 1.5, 1.0, 2.0, c); b.box(0, 1.15, -0.5, 1.8, 0.45, 1.5, c);              // hood, chassis
    b.box(0, 2.25, -0.7, 1.5, 1.5, 1.5, 0x22303c); b.box(0, 3.05, -0.7, 1.7, 0.12, 1.8, c);        // cab, roof
    b.cyl(0.5, 2.3, 1.7, 0.06, 0.06, 1.1, 0x222222, 6);                                            // exhaust
    for (const sx of [-1.1, 1.1]) { wheel(b, sx, 0.98, -1.0, 0.98, 0.6); wheel(b, sx * 0.85, 0.55, 1.55, 0.55, 0.36); }
    b.box(0, 0.55, -2.7, 2.6, 0.3, 0.7, 0x55595e); for (let k = -2; k <= 2; k++) b.box(k * 0.55, 0.2, -2.95, 0.08, 0.5, 0.08, 0x55595e); // the cultivator on the back
  },
  boat(b) {
    b.box(0, 0.35, 0, 2.3, 0.9, 6.6, 0xe9ecee); b.box(0, 0.35, 3.6, 1.6, 0.9, 1.2, 0xe9ecee, 0, 0, 0); b.box(0, 0.05, 0, 2.1, 0.12, 6.4, 0x1c4e7a);
    b.box(0, 1.35, -0.4, 1.7, 1.1, 2.4, 0xf2f4f5); b.box(0, 1.5, -0.4, 1.74, 0.4, 2.2, 0x22303c); b.box(0, 2.0, -0.4, 2.0, 0.12, 2.7, 0x1c4e7a);
    for (const s of [-1, 1]) b.box(s * 1.1, 1.05, 1.6, 0.06, 0.06, 3.2, 0x8a8f94); // rails
    b.box(0, 0.95, -3.0, 0.5, 0.7, 0.4, 0x333333); // outboard
  },
};

export const MODEL_COLORS = [0xc0392b, 0x2471a3, 0xecf0f1, 0x2c3e50, 0x27ae60, 0xe67e22, 0x7f8c8d];

export function createVehicleModel(kind, material, options = {}) {
  const b = new Batch();
  BUILD[kind](b, options);
  const mesh = b.build(material);
  const g = new THREE.Group();
  g.add(mesh);
  return g;
}
