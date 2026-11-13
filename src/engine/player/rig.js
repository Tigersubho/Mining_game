import * as THREE from 'three';

/** 'mixamorig:LeftArm_26' / 'mixamorigLeftArm' -> 'LeftArm' */
export const boneKey = (name) => name.replace(/^mixamorig:?/i, '').replace(/_\d+$/, '');

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

/**
 * Poses a skinned skeleton from poses.js deltas (rotations about the CHARACTER's axes), whatever the bones' own axes are.
 * Everything is measured in the frame of `root` (x = left, y = up, z = forward) at rest.
 *   local = parentRest^-1 * delta * parentRest * restLocal
 */
export class Rig {
  constructor(root, model) {
    this.bones = {}; this.parentKey = {}; this.rest = {}; this.unit = {};
    root.updateMatrixWorld(true);
    const inv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    model.traverse((o) => { if (o.isBone) { const k = boneKey(o.name); if (!(k in this.bones)) this.bones[k] = o; } });
    for (const [k, b] of Object.entries(this.bones)) {
      let p = b.parent; while (p && !p.isBone) p = p.parent;
      this.parentKey[k] = p ? boneKey(p.name) : null;
      const pq = b.parent.getWorldQuaternion(new THREE.Quaternion()).premultiply(inv);
      this.rest[k] = { local: b.quaternion.clone(), pos: b.position.clone(), pq, pqi: pq.clone().invert(), q: pq.clone().multiply(b.quaternion) };
      this.unit[k] = b.getWorldScale(_v).y; // world metres per local unit
    }
  }

  has(key) { return key in this.bones; }
  /** a bone's position in root space (metres) at rest */
  restPos(key) { return this.bones[key].getWorldPosition(new THREE.Vector3()); }

  apply(pose, bob = 0) {
    for (const [k, b] of Object.entries(this.bones)) {
      const r = this.rest[k], d = pose[k];
      if (d) b.quaternion.copy(r.pqi).multiply(d).multiply(r.pq).multiply(r.local); else b.quaternion.copy(r.local);
    }
    const h = this.rest.Hips; // bob: move the hips up/down in character space
    if (h) this.bones.Hips.position.copy(h.pos).add(_v.set(0, bob, 0).applyQuaternion(h.pqi).divideScalar(this.unit.Hips));
  }

  /** accumulated delta of a bone's whole chain (root joint down to the bone) */
  worldDelta(pose, key) {
    const chain = [];
    for (let k = key; k; k = this.parentKey[k]) chain.push(k);
    const q = new THREE.Quaternion();
    for (let i = chain.length - 1; i >= 0; i--) if (pose[chain[i]]) q.multiply(pose[chain[i]]);
    return q;
  }

  /**
   * Put `obj` (a child of bone `key`, modelled in metres) at `off` (metres, character axes) from the bone with the
   * orientation `want` (character axes). Pass the current pose so it follows the animated bone.
   */
  mount(obj, key, pose, want, off) {
    const qi = _q.copy(this.worldDelta(pose, key)).multiply(this.rest[key].q).invert();
    obj.quaternion.copy(qi).multiply(want);
    obj.position.copy(off).applyQuaternion(qi).divideScalar(this.unit[key]);
    obj.scale.setScalar(1 / this.unit[key]);
  }
}
