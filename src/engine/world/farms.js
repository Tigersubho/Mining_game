import * as THREE from 'three';
import { NETWORK } from './layout.js';
import { heightAt } from './terrain.js';
import { FARM } from './farmsite.js';
import { mulberry32 } from '../noise.js';

/**
 * The farms (sited and joined to the road network in layout.js): tilled fields that follow the ground, rows of crops, a farmhouse, a barn,
 * a silo, hay bales and scarecrows. Everything is low-poly. The tractor (agents/fleet.js) and the farmers (agents/farmers.js) work them.
 */
export const CROPS = [
  { name: 'wheat', col: 0xd9c25c, h: 0.85, w: 0.6, soil: 0x7a5a3a },
  { name: 'corn', col: 0x5f9c3a, h: 1.9, w: 0.5, soil: 0x6a4c32 },
  { name: 'cabbage', col: 0x86b96a, h: 0.45, w: 1.0, soil: 0x6f5036 },
  { name: 'sunflower', col: 0x4d8a35, top: 0xe6b82a, h: 1.5, w: 0.3, soil: 0x72543a },
  { name: 'potato', col: 0x4a7a3a, h: 0.55, w: 0.85, soil: 0x654a30 },
];

const soilMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

/** a field-sized patch of ground that follows the terrain (so it never floats or sinks on a slope) */
function soilPatch(f, color, rng) {
  const nx = 10, nz = 8, pos = [], col = [], idx = [], c = new THREE.Color(color);
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = f.x0 + (i / nx) * f.w, z = f.z0 + (j / nz) * f.d, k = 0.9 + rng() * 0.2;
    pos.push(x, heightAt(x, z) + 0.07, z); col.push(c.r * k, c.g * k, c.b * k);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1; idx.push(a, d, b, b, d, e); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const n = g.attributes.normal; for (let i = 0; i < n.count; i++) if (n.getY(i) < 0) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  const m = new THREE.Mesh(g, soilMat); m.receiveShadow = true;
  return m;
}

export function buildFarms(ctx) {
  const { scene, col } = ctx, B = ctx.b.farm, rng = mulberry32(4242);
  for (const farm of NETWORK.farms) {
    for (const f of farm.fields) {
      const crop = CROPS[f.crop % CROPS.length];
      scene.add(soilPatch(f, crop.soil, rng));
      // crop rows: long thin boxes in short pieces so each follows the ground
      const rows = Math.floor((f.d - 2) / FARM.rowGap), pieces = 4;
      for (let k = 0; k < rows; k++) {
        const z = f.z0 + 2 + k * FARM.rowGap + 1.1, len = (f.w - 4) / pieces;
        for (let p = 0; p < pieces; p++) {
          const x = f.x0 + 2 + len * (p + 0.5), y = heightAt(x, z) + 0.07;
          B.box(x, y + crop.h / 2, z, len - 0.1, crop.h, crop.w, crop.col, 0);
          if (crop.top && (k + p) % 2 === 0) for (let q = 0; q < 3; q++) B.box(x - len / 3 + (q * len) / 3, y + crop.h + 0.12, z, 0.34, 0.3, 0.34, crop.top, 0); // sunflower heads
        }
      }
      // a scarecrow in the corner of each field
      const sx = f.x0 + f.w - 3.5, sz = f.z0 + 3.5, sy = heightAt(sx, sz) + 0.07;
      B.box(sx, sy + 0.9, sz, 0.12, 1.8, 0.12, 0x6b4a2b); B.box(sx, sy + 1.45, sz, 1.3, 0.1, 0.1, 0x6b4a2b); B.box(sx, sy + 1.2, sz, 0.5, 0.6, 0.2, 0x7a5a9a);
      B.sph(sx, sy + 1.95, sz, 0.2, 0xd9c08a, 1, 1, 1, 0); B.cone(sx, sy + 2.25, sz, 0.34, 0.28, 0x6b4a2b, 6);
    }
    // ---- the farmyard
    const { house, barn, silo } = farm, y = (o) => heightAt(o.x, o.z);
    {
      const hy = y(house); // farmhouse: cream walls, a pyramid roof, a door and two windows
      B.box(house.x, hy + 1.6, house.z, 7, 3.2, 6, 0xe8dcc4); B.cone(house.x, hy + 4.4, house.z, 5.2, 2.4, 0xa8452e, 4, Math.PI / 4);
      B.box(house.x, hy + 1.0, house.z + 3.02, 1.1, 2.0, 0.08, 0x5a3b22);
      for (const s of [-1, 1]) B.box(house.x + s * 2.2, hy + 1.9, house.z + 3.02, 1.0, 1.0, 0.08, 0x7fb7d6);
      B.box(house.x + 2.3, hy + 4.2, house.z - 1.2, 0.7, 1.6, 0.7, 0x8a8576);
      col.addBox(house.x, house.z, 3.5, 3, 0, hy - 0.5, hy + 4);
    }
    {
      const by = y(barn); // barn: red, a gable roof from two tilted panels, a big door
      B.box(barn.x, by + 2.4, barn.z, 11, 4.8, 8, 0xa63b2b);
      B.box(barn.x, by + 5.45, barn.z - 2.0, 11.6, 0.3, 4.7, 0x5a4a44, 0, -0.5); B.box(barn.x, by + 5.45, barn.z + 2.0, 11.6, 0.3, 4.7, 0x5a4a44, 0, 0.5);
      B.box(barn.x, by + 6.3, barn.z, 11.6, 0.25, 0.5, 0x4a3c36);
      B.box(barn.x, by + 1.7, barn.z + 4.02, 3.6, 3.4, 0.08, 0xe8e0d0); B.box(barn.x, by + 1.7, barn.z + 4.06, 0.18, 3.4, 0.06, 0x8a3226);
      col.addBox(barn.x, barn.z, 5.5, 4, 0, by - 0.5, by + 6);
    }
    {
      const sy = y(silo); // silo
      B.cyl(silo.x, sy + 4, silo.z, 1.7, 1.7, 8, 0xb8bcc0, 10); B.sph(silo.x, sy + 8, silo.z, 1.7, 0xa0a4a8, 1, 0.6, 1, 1);
      col.addCircle(silo.x, silo.z, 1.8, sy - 0.5, sy + 9);
    }
    for (let k = 0; k < 9; k++) { // hay bales in the yard
      const hx = barn.x - 14 + (k % 3) * 2.4 + rng() * 0.6, hz = barn.z + 7 + Math.floor(k / 3) * 1.9, hy = heightAt(hx, hz);
      B.cyl(hx, hy + 0.6, hz, 0.75, 0.75, 1.3, 0xd8c06a, 10, 0, 0, Math.PI / 2);
    }
    // fence posts along the yard side of the track
    for (let x = farm.cx - FARM.trackHX + 6; x <= farm.cx + FARM.trackHX - 6; x += 9) { const z = farm.cz + FARM.trackZ0 + 3; B.box(x, heightAt(x, z) + 0.55, z, 0.16, 1.1, 0.16, 0x7a5a3a); }
  }
}
