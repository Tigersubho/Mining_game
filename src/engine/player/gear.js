import * as THREE from 'three';

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...o });

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const part = (parent, geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };

/** the miner's pickaxe: grip at the origin, head up (+Y). Shared by every character implementation. */
export function createPickaxe() {
  const g = new THREE.Group(), wood = mat(0x8a5a2b), steel = mat(0xaab0b8, { metalness: 0.7, roughness: 0.35 });
  part(g, new THREE.CylinderGeometry(0.028, 0.034, 1.0, 6), wood, 0, 0.25, 0);
  part(g, box(0.07, 0.1, 0.09), steel, 0, 0.74, 0);
  part(g, new THREE.ConeGeometry(0.05, 0.38, 5), steel, -0.22, 0.72, 0).rotation.z = Math.PI / 2 - 0.25;
  part(g, new THREE.ConeGeometry(0.05, 0.38, 5), steel, 0.22, 0.72, 0).rotation.z = -Math.PI / 2 + 0.25;
  return g;
}

/** scuba gear: {back: twin cylinders (attach to the torso), mask (attach to the head)}, both start hidden */
export function createScubaGear() {
  const back = new THREE.Group(), mask = new THREE.Group(), tank = mat(0x2d6fa3, { metalness: 0.5, roughness: 0.4 });
  for (const s of [-1, 1]) part(back, new THREE.CylinderGeometry(0.1, 0.1, 0.62, 10), tank, s * 0.11, 0.3, -0.34);
  part(back, box(0.3, 0.06, 0.06), mat(0x222222), 0, 0.58, -0.34);
  part(mask, box(0.2, 0.1, 0.05), mat(0x111418), 0, 0.01, 0.16);
  part(mask, box(0.16, 0.06, 0.02), mat(0x7fb7d6, { transparent: true, opacity: 0.7 }), 0, 0.01, 0.19);
  back.visible = mask.visible = false;
  return { back, mask };
}
