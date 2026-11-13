import * as THREE from 'three';
import { BED_Y } from '../config.js';
import { heightAt } from './terrain.js';
import { BRIDGES, ROUTES } from './layout.js';
import { lamp } from './props.js';
import { slabGeo } from './structures.js';

/** all dirt trails / haul roads / connector streets as one terrain-hugging ribbon mesh */
export function buildRouteMesh() {
  const pos = [], col = [], idx = [];
  const c = new THREE.Color();
  let base = 0;
  for (const r of ROUTES) {
    const pts = r.pts;
    c.set(r.color);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const L = Math.hypot(tx, tz) || 1;
      tx /= L; tz /= L;
      const nx = -tz, nz = tx;
      for (const side of [-1, 1]) {
        const x = pts[i][0] + nx * r.hw * side, z = pts[i][1] + nz * r.hw * side;
        pos.push(x, heightAt(x, z) + 0.08, z);
        const edge = 0.92;
        col.push(c.r * edge, c.g * edge, c.b * edge);
      }
      if (i < pts.length - 1) {
        const k = base + i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    base += pts.length * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // ensure up-facing normals regardless of winding
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) if (n.getY(i) < 0) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** the 3 hub footbridges + 6 river road bridges */
export function buildBridges(ctx) {
  const { col } = ctx;
  const B = ctx.b.bridge;
  for (const br of BRIDGES) {
    const { x, z, dirx: dx, dirz: dz, length: L, width: W, h } = br;
    const hl = L / 2, ramp = 5;
    const phi = Math.atan2(dz, dx), ry = -phi;
    const road = br.kind === 'road';
    const px = -dz, pz = dx; // perpendicular
    const hA = heightAt(x - dx * hl, z - dz * hl), hB = heightAt(x + dx * hl, z + dz * hl);
    const sections = [
      [-hl, -hl + ramp, hA, h],
      [-hl + ramp, hl - ramp, h, h],
      [hl - ramp, hl, h, hB],
    ];
    for (const [t0, t1, h0, h1] of sections) {
      const len = t1 - t0, tm = (t0 + t1) / 2;
      const cx = x + dx * tm, cz = z + dz * tm;
      const sx = x + dx * t0, sz = z + dz * t0;
      col.addDeck({ x: cx, z: cz, ux: dx, uz: dz, hl: len / 2, hw: W / 2, hA: h0, hB: h1 });
      const slope = Math.atan2(h1 - h0, len), rl = Math.hypot(len, h1 - h0);
      if (road) {
        B.geo(slabGeo(len, W, h0 - 0.6, h1 - 0.6, 0.54), sx, 0, sz, 0x9c998f, ry);
        B.geo(slabGeo(len, W - 1.4, h0 - 0.06, h1 - 0.06, 0.06), sx, 0, sz, 0x3b3d42, ry);
      } else {
        B.geo(slabGeo(len, W, h0 - 0.35, h1 - 0.35, 0.35), sx, 0, sz, 0x8a6a45, ry);
      }
      for (const side of [-1, 1]) {
        const off = side * (W / 2 - 0.2);
        const mx = cx + px * off, mz = cz + pz * off;
        const lo = Math.min(h0, h1), hi = Math.max(h0, h1);
        if (road) {
          B.box(mx, (h0 + h1) / 2 + 0.47, mz, rl, 0.95, 0.4, 0xb9b6ac, ry, 0, slope);
          B.box(mx, (h0 + h1) / 2 + 0.97, mz, rl, 0.08, 0.5, 0x8e8b82, ry, 0, slope);
        } else {
          B.box(mx, (h0 + h1) / 2 + 0.95, mz, rl, 0.1, 0.12, 0x6b4a2b, ry, 0, slope);
          const n = Math.max(1, Math.round(len / 2));
          for (let k = 0; k <= n; k++) {
            const tt = t0 + (len * k) / n;
            const hh = h0 + ((h1 - h0) * k) / n;
            B.cyl(x + dx * tt + px * off, hh + 0.5, z + dz * tt + pz * off, 0.07, 0.07, 1.0, 0x6b4a2b, 5);
          }
        }
        col.addBox(mx, mz, len / 2, 0.2, phi, lo - 0.5, hi + 0.95);
      }
    }

    const t0 = -hl + ramp, t1 = hl - ramp;
    if (road) {
      for (let t = t0 + 1.5; t < t1 - 1; t += 5) {
        B.box(x + dx * t, h + 0.02, z + dz * t, 2.4, 0.02, 0.2, 0xf2f2f2, ry);
      }
      for (let t = t0 + 4; t <= t1 - 3; t += 15) {
        for (const side of [-1, 1]) {
          const lx = x + dx * t + px * side * (W / 2 - 0.5), lz = z + dz * t + pz * side * (W / 2 - 0.5);
          lamp(B, ctx.glow, col, lx, lz, h, { h: 5.5, arm: 1.1, ry: Math.atan2(-px * side, -pz * side) });
        }
      }
    } else {
      for (let t = t0 + 0.4; t < t1; t += 0.9) {
        B.box(x + dx * t, h + 0.01, z + dz * t, 0.07, 0.02, W - 0.3, 0x5e4630, ry);
      }
      for (const t of [t0 + 1, t1 - 1]) {
        for (const side of [-1, 1]) {
          const lx = x + dx * t + px * side * (W / 2 - 0.2), lz = z + dz * t + pz * side * (W / 2 - 0.2);
          lamp(B, ctx.glow, col, lx, lz, h, { h: 3.0, arm: 0.0, ry: 0, color: 0x5a4632 });
        }
      }
    }

    // piers wherever the span is over water / low ground
    for (let t = t0 + 4; t < t1 - 2; t += 8) {
      for (const side of [-1, 1]) {
        const ox = x + dx * t + px * side * (W / 2 - 1), oz = z + dz * t + pz * side * (W / 2 - 1);
        const gh = heightAt(ox, oz);
        if (gh < h - 1.2) {
          const top = h - (road ? 0.6 : 0.35), bot = Math.min(gh, BED_Y) - 1;
          B.cyl(ox, (top + bot) / 2, oz, 0.55, 0.75, top - bot, road ? 0x9c998f : 0x7d7a70, 8);
          col.addCircle(ox, oz, 0.8, -10, top);
        }
      }
    }
  }
}
