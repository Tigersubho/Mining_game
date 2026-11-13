import * as THREE from 'three';
import { TERRAIN_SIZE, TERRAIN_SEG, CHUNK, WATER_Y } from '../config.js';
import { heightAt, colorAt, cellHeld, waterLevelAt } from './terrain.js';

export const CELL = TERRAIN_SIZE / TERRAIN_SEG; // metres per cell
export const CHUNK_M = CHUNK * CELL; // metres per chunk edge
export const chunkKey = (x, z) => `${Math.floor((x + TERRAIN_SIZE / 2) / CHUNK_M)},${Math.floor((z + TERRAIN_SIZE / 2) / CHUNK_M)}`;

/**
 * Whole-world terrain as a grid of chunk meshes (so the GPU can cull what is off-screen) plus the
 * global height/colour arrays (physics heightfield, minimap). Water gets its own meshes, only for
 * chunks that actually contain water, with a per-vertex depth for shading.
 */
export function buildTerrain(waterMat, onProgress = () => {}) {
  const N = TERRAIN_SEG + 1, half = TERRAIN_SIZE / 2;
  const heights = new Float32Array(N * N), colors = new Float32Array(N * N * 3);
  const c = new THREE.Color();
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -half + i * CELL, z = -half + j * CELL, k = j * N + i;
      const h = heightAt(x, z);
      heights[k] = h;
      colorAt(x, z, h, c);
      colors[k * 3] = c.r; colors[k * 3 + 1] = c.g; colors[k * 3 + 2] = c.b;
    }
    if (j % 20 === 0) onProgress(j / N);
  }

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const group = new THREE.Group(), waterGroup = new THREE.Group();
  const H = (i, j) => heights[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
  const nc = TERRAIN_SEG / CHUNK, V = CHUNK + 1;

  for (let cj = 0; cj < nc; cj++) {
    for (let ci = 0; ci < nc; ci++) {
      const pos = new Float32Array(V * V * 3), nor = new Float32Array(V * V * 3), col = new Float32Array(V * V * 3), dep = new Float32Array(V * V);
      const idx = [], widx = [];
      let wet = false;
      for (let b = 0; b < V; b++) {
        for (let a = 0; a < V; a++) {
          const i = ci * CHUNK + a, j = cj * CHUNK + b, k = b * V + a, g = j * N + i;
          const x = -half + i * CELL, z = -half + j * CELL;
          pos[k * 3] = x; pos[k * 3 + 1] = heights[g]; pos[k * 3 + 2] = z;
          const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * CELL), dz = (H(i, j + 1) - H(i, j - 1)) / (2 * CELL), l = Math.hypot(dx, 1, dz);
          nor[k * 3] = -dx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -dz / l;
          col[k * 3] = colors[g * 3]; col[k * 3 + 1] = colors[g * 3 + 1]; col[k * 3 + 2] = colors[g * 3 + 2];
          dep[k] = Math.max(0, waterLevelAt(x, z) - heights[g]);
          if (dep[k] > 0) wet = true;
        }
      }
      for (let b = 0; b < CHUNK; b++) {
        for (let a = 0; a < CHUNK; a++) {
          const k = b * V + a, k1 = k + 1, k2 = k + V, k3 = k2 + 1;
          const cx = -half + (ci * CHUNK + a + 0.5) * CELL, cz = -half + (cj * CHUNK + b + 0.5) * CELL;
          if (!cellHeld(cx, cz)) idx.push(k, k2, k1, k1, k2, k3);
          if (wet && (dep[k] > 0 || dep[k1] > 0 || dep[k2] > 0 || dep[k3] > 0)) widx.push(k, k2, k1, k1, k2, k3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = m.receiveShadow = true;
      group.add(m);

      if (widx.length) {
        const wp = new Float32Array(pos);
        for (let k = 0; k < V * V; k++) wp[k * 3 + 1] = waterLevelAt(pos[k * 3], pos[k * 3 + 2]);
        const wg = new THREE.BufferGeometry();
        wg.setAttribute('position', new THREE.BufferAttribute(wp, 3));
        wg.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1));
        wg.setIndex(widx);
        wg.computeBoundingSphere();
        const wm = new THREE.Mesh(wg, waterMat);
        wm.renderOrder = 2;
        waterGroup.add(wm);
      }
    }
    onProgress((cj + 1) / nc);
  }
  return { group, waterGroup, N, heights, colors };
}


