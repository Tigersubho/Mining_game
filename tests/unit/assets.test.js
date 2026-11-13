import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { fitScale, mergeByMaterial, principalYaw, tallEndIsPositive } from '../../src/engine/world/assets.js';

describe('fitScale', () => {
  it('scales the longest horizontal side to the requested length', () => { expect(fitScale({ x: 3, y: 1, z: 6 }, { length: 12 })).toBeCloseTo(2, 5); });
  it('scales by height when asked', () => { expect(fitScale({ x: 3, y: 5, z: 6 }, { height: 10 })).toBeCloseTo(2, 5); });
  it('defaults to the given scale, or 1', () => { expect(fitScale({ x: 1, y: 1, z: 1 }, undefined, 3)).toBe(3); expect(fitScale({ x: 1, y: 1, z: 1 })).toBe(1); });
});

describe('mergeByMaterial', () => {
  const box = (mat, x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat); m.position.x = x; return m; };
  it('collapses many meshes into one mesh per material, keeping world positions', () => {
    const red = new THREE.MeshStandardMaterial({ color: 0xff0000 }), blue = new THREE.MeshStandardMaterial({ color: 0x0000ff });
    const root = new THREE.Group();
    const sub = new THREE.Group(); sub.position.y = 10; // a transformed parent must be baked in
    [0, 2, 4].forEach((x) => sub.add(box(red, x)));
    [6, 8].forEach((x) => root.add(box(blue, x)));
    root.add(sub);
    const out = mergeByMaterial(root);
    const meshes = []; out.traverse((o) => o.isMesh && meshes.push(o));
    expect(meshes).toHaveLength(2);
    const redMesh = meshes.find((m) => m.material === red);
    redMesh.geometry.computeBoundingBox();
    expect(redMesh.geometry.boundingBox.min.y).toBeCloseTo(9.5, 5); // parent offset baked
    expect(redMesh.geometry.boundingBox.max.x).toBeCloseTo(4.5, 5);
  });
});

describe('aligning a model that was saved at an angle (the GMC)', () => {
  // a 6 x 2 x 1.5 "truck" (cab end taller) turned by `deg` about Y
  const truck = (deg) => {
    const a = (deg * Math.PI) / 180, pts = [];
    for (let i = 0; i <= 60; i++) for (let j = 0; j <= 10; j++) {
      const x = -1 + j * 0.2, z = -3 + i * 0.1, y = z > 0 ? 1.9 : 1.1; // front (+z) is the tall cab
      pts.push([x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)]);
    }
    return pts;
  };
  const turn = (pts, yaw) => pts.map(([x, y, z]) => [x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw)]);
  it('turns the long axis onto Z whatever the angle it was saved at', () => {
    for (const deg of [0, 20, 37, 45, 90, 130, -60]) {
      const out = turn(truck(deg), principalYaw(truck(deg)));
      const xs = out.map((p) => p[0]), zs = out.map((p) => p[2]);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2, 1);
      expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(6, 1);
    }
  });
  it('finds the front: the taller (cab) end', () => {
    expect(tallEndIsPositive(truck(0))).toBe(true);
    expect(tallEndIsPositive(turn(truck(0), Math.PI))).toBe(false);
  });
});