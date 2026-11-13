import * as THREE from 'three';
import { Rig } from './rig.js';
import { poseFor, rot, mul } from './poses.js';
import { createPickaxe, createScubaGear } from './gear.js';

/** posed bounding box (skinned meshes need their bone matrices refreshed first) */
export const measure = (model) => {
  model.updateMatrixWorld(true);
  model.traverse((o) => { if (o.isSkinnedMesh) { o.skeleton.update(); o.boundingBox = null; o.computeBoundingBox(); } });
  return new THREE.Box3().setFromObject(model);
};

const REQUIRED = ['Hips', 'Spine2', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot'];
const IDENT = new THREE.Quaternion();
const HAND = new THREE.Vector3(0, -0.06, 0.02);       // where the pickaxe grip sits, from the wrist bone (character axes)
const BACK = new THREE.Vector3(0.04, -0.25, -0.2);     // stowed pickaxe, on the back
const BACK_TILT = mul(rot('z', -0.55), rot('x', 0.1));
const TANKS = new THREE.Vector3(0, -0.28, 0.17), MASK = new THREE.Vector3(0, 0.1, -0.04);

/**
 * The player's body: a Mixamo-skeleton .glb. The model carries no animation clips, so the bones are posed here
 * (poses.js): idle, walk/run (a continuous blend by speed), jump, swim, tread water and the pickaxe swing.
 * Same API the Player uses: root, update(dt, state), setEquipped, setScuba, swing, onImpact, swingT.
 */
export class GLBCharacter {
  constructor({ scene }, { height = 1.8 } = {}) {
    this.root = new THREE.Group();
    const model = this.model = scene;
    this.root.add(model);
    const flat = []; // the sketchfab export carries two stray ground planes
    model.traverse((o) => { if (o.isMesh && o.geometry.attributes.position.count <= 4) flat.push(o); });
    flat.forEach((o) => o.removeFromParent());
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });

    // turn the model to face +Z (the way the toes point), then scale to `height` with the feet on the ground
    const bone = (re) => { let f = null; model.traverse((o) => { if (!f && o.isBone && re.test(o.name)) f = o; }); return f; };
    const foot = bone(/mixamorig:?LeftFoot/i), toe = bone(/mixamorig:?LeftToeBase/i);
    if (foot && toe) {
      this.root.updateMatrixWorld(true);
      const d = toe.getWorldPosition(new THREE.Vector3()).sub(foot.getWorldPosition(new THREE.Vector3()));
      if (Math.hypot(d.x, d.z) > 1e-4) model.rotation.y -= Math.atan2(d.x, d.z);
    }
    let box = measure(model);
    model.scale.multiplyScalar(height / (box.max.y - box.min.y));
    box = measure(model);
    model.position.set(model.position.x - (box.min.x + box.max.x) / 2, model.position.y - box.min.y, model.position.z - (box.min.z + box.max.z) / 2);
    this.root.updateMatrixWorld(true);

    this.rig = new Rig(this.root, model);
    const missing = REQUIRED.filter((k) => !this.rig.has(k));
    if (missing.length) throw new Error(`character.glb is not a Mixamo skeleton (missing bones: ${missing.join(', ')})`);

    this.cur = {}; this.curBob = 0; this.curPitch = 0;
    this.t = 0; this.phase = 0;
    this.carry = false;
    this.pick = createPickaxe();
    const gear = createScubaGear();
    this.scubaBack = gear.back; this.scubaMask = gear.mask;
    this.rig.bones.Spine2.add(this.scubaBack); this.rig.mount(this.scubaBack, 'Spine2', {}, IDENT, TANKS);
    this.rig.bones.Head.add(this.scubaMask); this.rig.mount(this.scubaMask, 'Head', {}, IDENT, MASK);
    this.equipped = false;
    this.setEquipped(false);
    this.swingT = -1; this.impacted = false; this.onImpact = null;
    this.update(0, { speed: 0, grounded: true, vy: 0, swimming: false });
  }

  setEquipped(on) {
    this.equipped = on;
    this.pick.removeFromParent();
    if (on) { this.rig.bones.RightHand.add(this.pick); this.rig.mount(this.pick, 'RightHand', this.cur, rot('x', 0.5), HAND); }
    else { this.rig.bones.Spine2.add(this.pick); this.rig.mount(this.pick, 'Spine2', {}, BACK_TILT, BACK); }
  }

  setScuba(on) { this.scubaBack.visible = this.scubaMask.visible = on; }

  swing() {
    if (!this.equipped || this.swingT >= 0) return false;
    this.swingT = 0; this.impacted = false;
    return true;
  }

  /** ease every bone towards its target so changes of state blend instead of snapping */
  blend(target, bob, pitch, rate, dt) {
    const k = 1 - Math.exp(-rate * dt);
    for (const key of new Set([...Object.keys(this.cur), ...Object.keys(target)])) (this.cur[key] ??= new THREE.Quaternion()).slerp(target[key] ?? IDENT, k);
    this.curBob += (bob - this.curBob) * k; this.curPitch += (pitch - this.curPitch) * k;
  }

  /** state: {speed, grounded, vy, swimming} */
  update(dt, s) {
    this.t += dt;
    const mode = s.swimming ? (s.speed > 0.4 ? 'swim' : 'tread') : !s.grounded ? 'jump' : s.speed > 0.3 ? 'loco' : 'idle';
    if (mode === 'loco') this.phase += (2 * Math.PI * s.speed / (1.4 + 0.45 * s.speed)) * dt; // stride grows with speed
    else if (mode === 'swim') this.phase += 2 * Math.PI * (0.9 + 0.25 * s.speed) * dt;
    else if (mode === 'tread') this.phase += 2 * Math.PI * 0.8 * dt;

    let swing = -1;
    if (this.swingT >= 0) {
      this.swingT += dt; swing = this.swingT;
      if (!this.impacted && swing >= 0.3) { this.impacted = true; this.onImpact?.(); }
      if (swing >= 0.6) this.swingT = swing = -1;
    }
    const { pose, bob, pitch, psi } = poseFor({ mode, phase: this.phase, t: this.t, speed: s.speed, vy: s.vy, swing, carry: this.equipped });
    this.blend(pose, bob, pitch, swing >= 0 ? 30 : 16, dt);
    this.rig.apply(this.cur, this.curBob);
    if (this.equipped) this.rig.mount(this.pick, 'RightHand', this.cur, rot('x', psi + this.curPitch), HAND);
  }
}
