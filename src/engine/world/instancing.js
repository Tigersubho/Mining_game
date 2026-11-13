import * as THREE from 'three';
import { chunkKey } from './terrainMesh.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

/**
 * Many copies of one mesh, split per terrain chunk so the GPU can cull whole groups.
 *   fill(item, put)  where  put(x, y, z, sx, sy, sz, ry, color, rx = 0, rz = 0)
 */
export function chunkedInstances(scene, geo, mat, items, fill, { shadow = true, key = (it) => chunkKey(it.x, it.z) } = {}) {
  const groups = new Map();
  for (const it of items) {
    const k = key(it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const meshes = [];
  for (const [k, list] of groups) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => fill(it, (x, y, z, sx, sy, sz, ry, color, rx = 0, rz = 0) => {
      _q.setFromEuler(_e.set(rx, ry, rz));
      mesh.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)));
      mesh.setColorAt(i, _c.set(color));
    }));
    mesh.userData.key = k;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}
