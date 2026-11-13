import * as THREE from 'three';
import { DEG, SECTOR_ANGLES, ISLAND_R, HUB_RING, HUB_BRIDGE } from '../config.js';
import { lamp, bench, treeSmall } from './props.js';
import { signMesh } from './textures.js';

export const SPAWN = { x: 0, z: 6.6, yaw: Math.PI }; // faces the monument

const angDiff = (a, b) => {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

export function buildHub(ctx) {
  const B = ctx.b.hub;
  const G = ctx.glow;
  const { col, scene } = ctx;
  const Y = 2.0;
  const gaps = [...Object.values(SECTOR_ANGLES), 150]; // 150 = the boat quay

  // low stone wall around the island with an opening at every bridge (and the quay)
  const WALL_R = ISLAND_R - 1.5, STEP = 2.5, GAP = Math.asin((HUB_BRIDGE.width / 2 + 1.2) / WALL_R) / DEG;
  for (let a = 0; a < 360; a += STEP) {
    const mid = a + STEP / 2;
    if (gaps.some((g) => angDiff(mid, g) < GAP)) continue;
    const r = mid * DEG;
    const x = Math.cos(r) * WALL_R, z = Math.sin(r) * WALL_R;
    B.box(x, Y + 0.3, z, 0.7, 0.6, 1.1, 0x9d9484, -r);
    col.addBox(x, z, 0.35, 0.55, r, -5, Y + 0.65, true);
    if (Math.round(a / STEP) % 6 === 0) {
      B.box(x, Y + 0.65, z, 0.95, 0.5, 0.95, 0xb2a994, -r);
      G.box(x, Y + 1.05, z, 0.35, 0.3, 0.35, 0xffdf8a, -r);
    }
  }

  // central monument: ore display on a pedestal, framed by a big sign gate
  B.cyl(0, Y + 0.3, 0, 2.3, 2.5, 0.6, 0xb7ae9a, 12);
  col.addCircle(0, 0, 2.4, -5, Y + 0.6, true);
  // ore specimen display on the pedestal
  for (const [x, z, r, c] of [[0, 0, 0.9, 0xb59b3a], [0.9, 0.5, 0.6, 0x2f8f6b], [-0.9, 0.6, 0.65, 0x6a4a4a], [0.1, -1.0, 0.5, 0xd4af37]]) B.sph(x, Y + 0.6 + r * 0.7, z, r, c, 1, 0.8, 1, 0);

  for (const sg of [-1, 1]) {
    B.box(sg * 3.9, Y + 3.3, -1.2, 1.2, 6.6, 1.2, 0x8a8576);
    B.box(sg * 3.9, Y + 0.3, -1.2, 1.7, 0.6, 1.7, 0x6d695e);
    B.box(sg * 3.9, Y + 6.7, -1.2, 1.6, 0.4, 1.6, 0x6d695e);
    G.sph(sg * 3.9, Y + 7.3, -1.2, 0.25, 0xffe2a8, 1, 1.4, 1, 1);
    col.addCircle(sg * 3.9, -1.2, 0.95, -5, Y + 7);
  }
  B.box(0, Y + 6.3, -1.2, 7.4, 0.35, 0.9, 0x6d695e);
  B.box(0, Y + 3.2, -1.2, 7.0, 0.3, 0.9, 0x6d695e);
  const title = [{ text: 'MINING HAVEN', size: 140 }, { text: 'OPERATIONS HUB', size: 62, color: '#ffffff' }];
  for (const [zz, ry] of [[-0.69, 0], [-1.71, Math.PI]]) {
    const s = signMesh(title, 7, 3.0, { w: 1024, h: 439, bg: '#1b2430' }, false);
    s.position.set(0, Y + 4.75, zz);
    s.rotation.y = ry;
    scene.add(s);
  }
  // crossed pickaxes on top
  for (const sg of [-1, 1]) {
    B.box(0, Y + 7.9, -1.2, 0.18, 2.6, 0.18, 0x7a5530, 0, 0, sg * 0.75);
    B.box(sg * 0.95, Y + 8.85, -1.2, 1.4, 0.2, 0.2, 0xaab0b8, 0, 0, sg * 0.75);
  }

  // direction signposts at the three bridge mouths
  const labels = { 90: ['CITY', 'Urban centre'], 210: ['JUNGLE', 'Exploration zone'], 330: ['CONSTRUCTION', 'Pit and site works'] };
  for (const a of Object.keys(labels).map(Number)) { // (the 150 degree gap is the boat quay: no signpost)
    const r = a * DEG;
    const lx = -Math.sin(r), lz = Math.cos(r);
    const SIDE = HUB_BRIDGE.width / 2 + 2.2, x = Math.cos(r) * (ISLAND_R - 3.5) + lx * SIDE, z = Math.sin(r) * (ISLAND_R - 3.5) + lz * SIDE;
    const [t1, t2] = labels[a];
    const s = signMesh([{ text: t1, size: 120 }, { text: t2, size: 52, color: '#ffffff' }], 3.0, 1.1, { w: 768, h: 282, bg: '#2a1f12' }, false);
    s.position.set(x, Y + 2.5, z);
    s.rotation.y = Math.atan2(-Math.cos(r), -Math.sin(r));
    scene.add(s);
    B.cyl(x, Y + 1.25, z, 0.09, 0.09, 2.5, 0x5a4632, 6);
    col.addCircle(x, z, 0.2, -5, Y + 3);
    // lamp on the other side
    const ox = Math.cos(r) * (ISLAND_R - 3.5) - lx * SIDE, oz = Math.sin(r) * (ISLAND_R - 3.5) - lz * SIDE;
    lamp(B, G, col, ox, oz, Y, { h: 4.4, arm: 0.9, ry: Math.atan2(-Math.cos(r), -Math.sin(r)) });
  }
  // benches, trees and lamp posts on the plaza between the roundabout and the wall (kept clear of the bridge mouths)
  const PL = ISLAND_R - 4.5;
  for (const a of [135, 165, 255, 285]) { // (multiples of 15: the NPC walk graph has a bench node at each)
    const r = a * DEG;
    bench(B, col, Math.cos(r) * PL, Math.sin(r) * PL, Math.atan2(-Math.cos(r), -Math.sin(r)), Y);
  }
  for (const a of [60, 120, 180, 240, 300, 0]) {
    const r = a * DEG;
    treeSmall(B, col, Math.cos(r) * (ISLAND_R - 2.6), Math.sin(r) * (ISLAND_R - 2.6), Y, 1);
  }
  for (const a of [45, 135, 195, 255, 285, 15]) {
    const r = a * DEG, ry = Math.atan2(-Math.cos(r), -Math.sin(r));
    lamp(B, G, col, Math.cos(r) * (HUB_RING + 5.2), Math.sin(r) * (HUB_RING + 5.2), Y, { h: 5, arm: 1.0, ry });
  }
  // centre-island flower beds inside the roundabout
  for (let k = 0; k < 8; k++) { const r = (k * 45 + 22) * DEG; B.sph(Math.cos(r) * 8.4, Y + 0.25, Math.sin(r) * 8.4, 0.9, [0x6aa357, 0x4f8f48][k % 2], 1, 0.5, 1, 0); }
  // boat quay at 150 degrees: a jetty from the island wall out into the pool
  const r150 = 150 * DEG, qx = Math.cos(r150), qz = Math.sin(r150), QC = ISLAND_R + 5, QL = 12;
  B.box(qx * QC, Y - 0.15, qz * QC, 4, 0.3, QL, 0x7a6244, -r150 + Math.PI / 2);
  col.addDeck({ x: qx * QC, z: qz * QC, ux: qx, uz: qz, hl: QL / 2, hw: 2, hA: Y, hB: Y });
  for (const s of [-1.8, 1.8]) for (const d of [QC - 4, QC, QC + 4]) B.cyl(qx * d - qz * s, Y - 2.5, qz * d + qx * s, 0.25, 0.28, 5, 0x4a3a28, 7);
  G.sph(qx * (QC + 5.6), Y + 1.4, qz * (QC + 5.6), 0.2, 0xffe2a8, 1, 1, 1, 0);
}
