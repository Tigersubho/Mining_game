import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const CELL = 48; // metres: trees are grouped in cells that switch between the detailed .glb trees (near) and low-poly ones (far)
export const wind = { uTime: { value: 0 } };
export const cellKey = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;

/**
 * Load a tree .glb into plain parts [{ geo, mat }]: baked to its rest pose, base centred on the origin, `height` metres tall,
 * leaves and branches swaying in the wind (a vertex shader bends them with height; every instance sways out of step).
 */
export async function loadTree(url, { height, sway = 0.45 }) {
  const root = (await loader.loadAsync(url)).scene;
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    geo.morphAttributes = {}; // the file carries baked morph targets; an instanced tree is static
    parts.push({ geo, mat: o.material });
  });
  const box = new THREE.Box3();
  for (const p of parts) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); }
  const H = box.max.y - box.min.y, low = box.min.y + H * 0.03;
  let bx = 0, bz = 0, n = 0;
  for (const { geo } of parts) { const q = geo.attributes.position; for (let i = 0; i < q.count; i++) if (q.getY(i) < low) { bx += q.getX(i); bz += q.getZ(i); n++; } }
  if (!n) { bx = (box.min.x + box.max.x) / 2; bz = (box.min.z + box.max.z) / 2; n = 1; }
  const s = height / H;
  for (const p of parts) {
    p.geo.translate(-bx / n, -box.min.y, -bz / n); p.geo.scale(s, s, s);
    const mat = p.mat.clone();
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = wind.uTime; sh.uniforms.uH = { value: height };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uH;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 ip = vec3(0.0);
          #endif
          float hh = clamp(position.y / uH, 0.0, 1.0), sw = hh * hh * ${sway.toFixed(3)}, ph = ip.x * 0.11 + ip.z * 0.07;
          transformed.x += (sin(uTime * 1.1 + ph) + 0.35 * sin(uTime * 2.7 + ph * 2.0 + position.z * 0.6)) * sw;
          transformed.z += cos(uTime * 0.9 + ph) * sw * 0.7;`);
    };
    mat.customProgramCacheKey = () => `sway${sway}`;
    p.mat = mat;
  }
  return { parts, height };
}

/**
 * Per cell, one set of far (low-poly) meshes and one set of near (.glb) meshes. update() shows the near set inside
 * `radius` metres of the viewer and the far set outside it - so there are never two trees in one spot.
 */
export class Forest {
  constructor() { this.cells = new Map(); }
  cell(key) { if (!this.cells.has(key)) { const [i, j] = key.split(',').map(Number); this.cells.set(key, { cx: (i + 0.5) * CELL, cz: (j + 0.5) * CELL, far: [], near: [] }); } return this.cells.get(key); }
  addFar(mesh) { this.cell(mesh.userData.key).far.push(mesh); }

  /** `items`: [{ x, y, z, s, ry, species }]; `models`: { species: { parts } } */
  addNear(scene, items, models) {
    const groups = new Map();
    for (const it of items) { const k = `${cellKey(it.x, it.z)}|${it.species}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const [k, list] of groups) {
      const [key, species] = k.split('|'), cell = this.cell(key);
      for (const part of models[species].parts) {
        const mesh = new THREE.InstancedMesh(part.geo, part.mat, list.length);
        list.forEach((it, i) => { q.setFromEuler(e.set(0, it.ry, 0)); mesh.setMatrixAt(i, m.compose(p.set(it.x, it.y - 0.15, it.z), q, sc.setScalar(it.s))); });
        mesh.castShadow = false; mesh.receiveShadow = true; mesh.visible = false;
        mesh.computeBoundingSphere();
        scene.add(mesh); cell.near.push(mesh);
      }
    }
  }

  update(px, pz, radius = 115) {
    for (const c of this.cells.values()) {
      const near = Math.hypot(c.cx - px, c.cz - pz) - CELL * 0.75 < radius && c.near.length > 0;
      for (const m of c.near) m.visible = near;
      for (const m of c.far) m.visible = !near;
    }
  }
}