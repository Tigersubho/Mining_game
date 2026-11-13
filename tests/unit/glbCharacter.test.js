import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GLBCharacter, measure } from '../../src/engine/player/glbCharacter.js';
import { loadCharacter } from '../../src/engine/player/loadCharacter.js';
import { poseFor, swingCurve } from '../../src/engine/player/poses.js';
import { boneKey } from '../../src/engine/player/rig.js';

// A Mixamo-named T-pose skeleton inside a Z-up, centimetre-scaled container (like a sketchfab export), so the test
// proves the posing does not depend on the bones' own axes. World metres (x left, y up, z forward) -> inner = (x, -z, y) * 100.
const T = {
  Hips: [null, 0, 1.0, 0], Spine: ['Hips', 0, 1.1, 0], Spine1: ['Spine', 0, 1.25, 0], Spine2: ['Spine1', 0, 1.4, 0], Neck: ['Spine2', 0, 1.55, 0], Head: ['Neck', 0, 1.62, 0],
  LeftShoulder: ['Spine2', 0.06, 1.5, 0], LeftArm: ['LeftShoulder', 0.2, 1.5, 0], LeftForeArm: ['LeftArm', 0.5, 1.5, 0], LeftHand: ['LeftForeArm', 0.75, 1.5, 0],
  RightShoulder: ['Spine2', -0.06, 1.5, 0], RightArm: ['RightShoulder', -0.2, 1.5, 0], RightForeArm: ['RightArm', -0.5, 1.5, 0], RightHand: ['RightForeArm', -0.75, 1.5, 0],
  LeftUpLeg: ['Hips', 0.1, 0.95, 0], LeftLeg: ['LeftUpLeg', 0.1, 0.5, 0], LeftFoot: ['LeftLeg', 0.1, 0.08, 0], LeftToeBase: ['LeftFoot', 0.1, 0.0, 0.14],
  RightUpLeg: ['Hips', -0.1, 0.95, 0], RightLeg: ['RightUpLeg', -0.1, 0.5, 0], RightFoot: ['RightLeg', -0.1, 0.08, 0], RightToeBase: ['RightFoot', -0.1, 0.0, 0.14],
};
function fakeModel({ faceBack = false, drop = [] } = {}) {
  const container = new THREE.Group(); container.rotation.x = -Math.PI / 2; container.scale.setScalar(0.01);
  const bones = {}, inner = (x, y, z) => new THREE.Vector3(x, -z, y).multiplyScalar(100);
  for (const [name, [parent, x, y, z0]] of Object.entries(T)) {
    if (drop.includes(name)) continue;
    const z = faceBack ? -z0 : z0;
    const b = new THREE.Bone(); b.name = `mixamorig${name}`;
    const p = parent ? inner(...T[parent].slice(1)) : new THREE.Vector3();
    const pz = parent ? (faceBack ? -T[parent][3] : T[parent][3]) : 0;
    b.position.copy(inner(x, y, z)).sub(parent ? inner(T[parent][1], T[parent][2], pz) : new THREE.Vector3());
    void p;
    bones[name] = b; (parent ? bones[parent] : container).add(b);
  }
  const geo = new THREE.BoxGeometry(50, 20, 190).translate(0, 0, 95);
  const n = geo.attributes.position.count;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Float32Array(n * 4), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  container.add(mesh);
  const outer = new THREE.Group(); outer.add(container); outer.updateMatrixWorld(true);
  const list = Object.values(bones);
  const sk = new THREE.Skeleton(list); sk.calculateInverses(); mesh.bind(sk);
  return { scene: outer };
}
const still = { speed: 0, grounded: true, vy: 0, swimming: false };
const wp = (c, name) => { c.root.updateMatrixWorld(true); return c.rig.bones[name].getWorldPosition(new THREE.Vector3()); };
const run = (c, s, secs) => { const out = []; for (let i = 0; i < secs * 60; i++) { c.update(1 / 60, s); out.push(c); } };
const settle = (c, s, secs = 1.5) => run(c, s, secs);

describe('GLBCharacter: a rigged Mixamo model animated by the game', () => {
  const make = (o) => new GLBCharacter(fakeModel(o));

  it('normalises to 1.8 m tall with the feet on the ground', () => {
    const c = make(); settle(c, still, 0.5);
    [c.pick, c.scubaBack, c.scubaMask].forEach((o) => o.removeFromParent());
    const box = measure(c.model);
    expect(box.max.y - box.min.y).toBeCloseTo(1.8, 1);
    expect(box.min.y).toBeCloseTo(0, 1);
  });
  it('refuses a model without a Mixamo skeleton (there is no stand-in)', () => {
    expect(() => make({ drop: ['RightHand'] })).toThrow(/Mixamo/);
  });
  it('turns a model that faces -Z round to face +Z', () => {
    const c = make({ faceBack: true });
    expect(wp(c, 'LeftToeBase').z).toBeGreaterThan(wp(c, 'LeftFoot').z + 0.05);
  });
  it('idle: the arms hang down at the sides (not in the T pose)', () => {
    const c = make(); settle(c, still);
    expect(wp(c, 'LeftHand').y).toBeLessThan(wp(c, 'LeftShoulder').y - 0.45);
    expect(wp(c, 'RightHand').y).toBeLessThan(wp(c, 'RightShoulder').y - 0.45);
    expect(wp(c, 'LeftHand').x).toBeGreaterThan(0); expect(wp(c, 'RightHand').x).toBeLessThan(0); // left stays on +x
  });
  it('walking swings the legs forward and back, left and right in turn, with the arms opposite', () => {
    const c = make(); let lo = 9, hi = -9, armLo = 9, armHi = -9;
    for (let i = 0; i < 240; i++) { c.update(1 / 60, { ...still, speed: 3 }); const d = wp(c, 'LeftFoot').z - wp(c, 'RightFoot').z; lo = Math.min(lo, d); hi = Math.max(hi, d); const a = wp(c, 'LeftHand').z - wp(c, 'RightHand').z; armLo = Math.min(armLo, a); armHi = Math.max(armHi, a); }
    expect(hi).toBeGreaterThan(0.3); expect(lo).toBeLessThan(-0.3);
    expect(armHi).toBeGreaterThan(0.15); expect(armLo).toBeLessThan(-0.15);
  });
  it('running strides further than walking, and the feet never go through the ground', () => {
    const stride = (speed) => { const c = make(); let hi = 0, minY = 9; for (let i = 0; i < 300; i++) { c.update(1 / 60, { ...still, speed }); hi = Math.max(hi, Math.abs(wp(c, 'LeftFoot').z - wp(c, 'RightFoot').z)); if (i > 60) minY = Math.min(minY, wp(c, 'LeftFoot').y, wp(c, 'RightFoot').y); } return { hi, minY }; };
    const w = stride(3), r = stride(8);
    expect(r.hi).toBeGreaterThan(w.hi + 0.15);
    expect(r.minY).toBeGreaterThan(-0.2);
  });
  it('jump: the arms come up and forward', () => {
    const c = make(); settle(c, { ...still, grounded: false, vy: 4 });
    expect(wp(c, 'LeftHand').z).toBeGreaterThan(wp(c, 'LeftShoulder').z + 0.4);
  });
  it('swimming lays the body flat, head forward; treading water stays upright', () => {
    const c = make(); settle(c, { ...still, swimming: true, speed: 2 }, 2);
    expect(Math.abs(wp(c, 'Head').y - wp(c, 'Hips').y)).toBeLessThan(0.45);
    expect(wp(c, 'Head').z).toBeGreaterThan(wp(c, 'Hips').z + 0.4);
    settle(c, { ...still, swimming: true, speed: 0 }, 2);
    expect(wp(c, 'Head').y).toBeGreaterThan(wp(c, 'Hips').y + 0.4);
  });
  it('the pickaxe: stowed on the back, held in the right hand, and a swing fires one impact then ends', () => {
    const c = make(); let hits = 0; c.onImpact = () => hits++;
    expect(c.pick.parent).toBe(c.rig.bones.Spine2);
    c.setEquipped(true); settle(c, still, 0.5);
    expect(c.pick.parent).toBe(c.rig.bones.RightHand);
    expect(c.swing()).toBe(true); expect(c.swing()).toBe(false);
    let top = -9;
    for (let i = 0; i < 90; i++) { c.update(1 / 60, still); top = Math.max(top, wp(c, 'RightHand').y); }
    expect(hits).toBe(1); expect(c.swingT).toBe(-1);
    expect(top).toBeGreaterThan(wp(c, 'Head').y); // the arms went overhead
    c.setEquipped(false);
    expect(c.swing()).toBe(false);
  });
  it('scuba gear is hidden until switched on and rides on the back and head', () => {
    const c = make();
    expect(c.scubaBack.visible).toBe(false); c.setScuba(true); expect(c.scubaBack.visible && c.scubaMask.visible).toBe(true);
    expect(c.scubaBack.parent).toBe(c.rig.bones.Spine2); expect(c.scubaMask.parent).toBe(c.rig.bones.Head);
  });
});

describe('pose generator', () => {
  it('names bones the way Mixamo exports do', () => { expect(boneKey('mixamorig:LeftArm_26')).toBe('LeftArm'); expect(boneKey('mixamorigHips')).toBe('Hips'); });
  it('every mode returns finite unit-length rotations', () => {
    for (const mode of ['idle', 'loco', 'jump', 'swim', 'tread']) for (const phase of [0, 1, 2.5, 5]) {
      const { pose } = poseFor({ mode, phase, t: phase, speed: 5, vy: 1, swing: -1, carry: true });
      for (const q of Object.values(pose)) expect(Math.abs(q.length() - 1)).toBeLessThan(1e-6);
    }
  });
  it('the pickaxe swing winds up (head back), strikes (head forward and down), then recovers', () => {
    expect(swingCurve(0.16).psi).toBeLessThan(0); expect(swingCurve(0.3).psi).toBeGreaterThan(2); expect(swingCurve(0.6).psi).toBeCloseTo(0.5, 1);
    expect(swingCurve(0.16).arm).toBeGreaterThan(2);
  });
});

describe('loading', () => {
  it('uses the low-poly character for now (the .glb is switched off until the models are final)', async () => {
    const c = await loadCharacter(new THREE.MeshBasicMaterial({ vertexColors: true }));
    expect(c.root).toBeDefined();
    for (const k of ['update', 'setEquipped', 'setScuba', 'swing', 'setSensorModel']) expect(typeof c[k]).toBe('function');
  });
});
