import RAPIER from '@dimforge/rapier3d-compat';
import { Colliders } from './colliders.js';

let ready;

/** one physics world + the static-collider builder used by every region */
export async function createPhysics() {
  ready ??= RAPIER.init();
  await ready;
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  return { R: RAPIER, world, col: new Colliders(RAPIER, world) };
}

/**
 * Terrain collider from a row-major height grid (index = j*N + i, x from i, z from j).
 * Rapier stores heights column-major with rows along z and columns along x, so we transpose.
 */
export function addHeightfield({ R, world }, heights, N, size) {
  const n = N - 1;
  const t = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) t[i * N + j] = heights[j * N + i];
  return world.createCollider(R.ColliderDesc.heightfield(n, n, t, { x: size, y: 1, z: size }).setFriction(1));
}

/**
 * Terrain collision with true holes (cave mouths). Rapier heightfields cannot have holes, so inside each
 * zone the heightfield is dropped far below and a triangle mesh with the hole cells removed takes over.
 *   zones: [{x0,z0,x1,z1}] world rectangles   isHole(x, z): is the cell centred here cut out?
 */
export function addTerrainCollider(P, heights, N, size, { zones = [], isHole = () => false } = {}) {
  const half = size / 2, step = size / (N - 1), field = heights.slice();
  const at = (v) => Math.min(N - 1, Math.max(0, Math.round((v + half) / step)));
  for (const z of zones) {
    const i0 = at(z.x0), i1 = at(z.x1), j0 = at(z.z0), j1 = at(z.z1), W = i1 - i0 + 1;
    for (let j = j0 + 1; j < j1; j++) for (let i = i0 + 1; i < i1; i++) field[j * N + i] = -300; // the trimesh takes over here
    const verts = new Float32Array(W * (j1 - j0 + 1) * 3), idx = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const o = ((j - j0) * W + (i - i0)) * 3;
      verts[o] = -half + i * step; verts[o + 1] = heights[j * N + i]; verts[o + 2] = -half + j * step;
    }
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      if (isHole(-half + (i + 0.5) * step, -half + (j + 0.5) * step)) continue;
      const k = (j - j0) * W + (i - i0);
      idx.push(k, k + W, k + 1, k + 1, k + W, k + W + 1);
    }
    P.world.createCollider(P.R.ColliderDesc.trimesh(verts, new Uint32Array(idx)).setFriction(1));
  }
  return addHeightfield(P, field, N, size);
}
