import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt } from './terrain.js';

/**
 * Drop-in helper for your own .glb models (put them in /public/models, URL "/models/<file>.glb").
 *   await placeGLB(scene, world.col, { url, x, z, ry, fit: { length: 9 }, collider: true })
 * Models arrive in arbitrary units, so `fit` rescales them to metres. Meshes are merged per
 * material (a 400-mesh truck becomes ~100 draw calls).
 */
export const fitScale = (size, fit, scale = 1) => (fit?.length ? fit.length / Math.max(size.x, size.z) : fit?.height ? fit.height / size.y : scale);

/** bake world transforms and merge every mesh that shares a material */
export function mergeByMaterial(root) {
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const keep = ['position', 'normal', 'uv'];
    for (const n of Object.keys(g.attributes)) if (!keep.includes(n)) g.deleteAttribute(n);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    const ng = g.index ? g.toNonIndexed() : g;
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(ng);
  });
  const out = new THREE.Group();
  for (const [mat, list] of byMat) out.add(new THREE.Mesh(list.length > 1 ? mergeGeometries(list) : list[0], mat));
  return out;
}

const loader = new GLTFLoader();

/** every [x, y, z] vertex of a parentless model, sampled (about `max` of them), in its parent's space (rotation / scale included) */
export function vertices(model, max = 40000, only = null) {
  model.updateMatrixWorld(true);
  const v = new THREE.Vector3(), out = [];
  model.traverse((o) => {
    if (!o.isMesh || (only && !only(o))) return;
    const p = o.geometry.attributes.position, step = Math.max(1, Math.floor(p.count * model.children.length / max));
    for (let i = 0; i < p.count; i += step) out.push(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).toArray());
  });
  return out;
}

/** yaw (rotation about Y) that turns the model's long horizontal axis (its principal axis) onto +Z; the direction is arbitrary */
export function principalYaw(pts) {
  let mx = 0, mz = 0;
  for (const p of pts) { mx += p[0]; mz += p[2]; }
  mx /= pts.length; mz /= pts.length;
  let sxx = 0, szz = 0, sxz = 0;
  for (const p of pts) { const dx = p[0] - mx, dz = p[2] - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz); // direction of the largest variance, measured from +X towards +Z
  return -Math.atan2(Math.cos(ang), Math.sin(ang)); // = rotation taking that direction onto +Z
}

/** after the long axis is on Z: is the front at +Z? The cab end of a pickup / the taller end is the front. */
export function tallEndIsPositive(pts) {
  const zs = pts.map((p) => p[2]), lo = Math.min(...zs), hi = Math.max(...zs), mid = (lo + hi) / 2;
  const top = (list) => { const ys = list.map((p) => p[1]).sort((a, b) => a - b); return ys[Math.floor(ys.length * 0.9)] ?? 0; };
  return top(pts.filter((p) => p[2] > mid)) >= top(pts.filter((p) => p[2] <= mid));
}

/** the cab (windows, seats, dashboard) tells which end of a truck is the front */
export const CAB_MATERIAL = /window|glass|dash|seat|steer|interior|cyfer/i;
export const cabEndIsPositive = (pts) => { const zs = pts.map((p) => p[2]); return pts.reduce((s, p) => s + p[2], 0) / pts.length >= (Math.min(...zs) + Math.max(...zs)) / 2; };

const FRONT_YAW = { '+z': 0, '-z': Math.PI, '+x': -Math.PI / 2, '-x': Math.PI / 2 }; // yaw taking that axis onto +Z

/**
 * load + normalise a model into a Group at the origin (feet on y = 0, centred); not added to any scene.
 *   flip: true turns an 'auto' model round (when the heuristic picks the wrong end)
 *   fit: { length | height }     front: '+x' | '-x' | '+z' | '-z' (the axis the model's nose points along)
 *                                or 'auto' = find the long axis by PCA (a model saved at an angle) and put the taller end in front
 */
export async function loadGLB(o) {
  const model = mergeByMaterial((await loader.loadAsync(o.url)).scene);
  model.traverse((c) => { if (c.isMesh) { c.castShadow = o.castShadow ?? true; c.receiveShadow = true; } });
  let box = new THREE.Box3().setFromObject(model);
  const raw = box.getSize(new THREE.Vector3());
  if (o.front === 'auto') {
    model.rotation.y = principalYaw(vertices(model));
    model.updateMatrixWorld(true);
    const cab = vertices(model, 20000, (m) => CAB_MATERIAL.test(m.material?.name ?? ''));
    const front = cab.length > 30 ? cabEndIsPositive(cab) : tallEndIsPositive(vertices(model));
    if (!front !== !!o.flip) model.rotation.y += Math.PI; // flip: the heuristic picks the wrong end for this model
  } else if (o.front) model.rotation.y = FRONT_YAW[o.front];
  else if (o.fit?.length && raw.x > raw.z) model.rotation.y = Math.PI / 2; // legacy: long axis -> local Z
  model.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(model);
  model.scale.multiplyScalar(fitScale(box.getSize(new THREE.Vector3()), o.fit, o.scale));
  box = new THREE.Box3().setFromObject(model);
  const c = box.getCenter(new THREE.Vector3()), holder = new THREE.Group();
  model.position.set(-c.x, -box.min.y, -c.z);
  holder.add(model);
  holder.userData.size = box.getSize(new THREE.Vector3());
  holder.userData.glb = o.url;
  return holder;
}
export async function placeGLB(scene, col, o) {
  const holder = await loadGLB(o);
  const sz = holder.userData.size;
  const y = o.y ?? heightAt(o.x, o.z);
  holder.position.set(o.x, y, o.z);
  holder.rotation.y = o.ry ?? 0;
  if (o.tilt) holder.rotation.x = o.tilt;
  scene.add(holder);
  if (o.collider) {
    col.addBox(o.x, o.z, sz.x / 2, sz.z / 2, -(o.ry ?? 0), y - 0.2, y + sz.y);
  }
  return holder;
}


