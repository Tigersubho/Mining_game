import * as THREE from 'three';
import { Batch } from '../world/batch.js';
import { damp } from '../math.js';

/** costume per character kind: colours + a hat / extras */
export const COSTUMES = {
  office: { shirt: 0xe8ecef, pants: 0x1f2a38, jacket: 0x1f2a38, tie: 0xb03a2e, boots: 0x111111, hat: null, hair: 0x3a2a1f, bag: 0x3b2f2a },
  police: { shirt: 0x1c2f55, pants: 0x1c2f55, boots: 0x111111, hat: { kind: 'cap', color: 0x1c2f55 }, badge: true, belt: true },
  civilian: { shirt: 0x7a9e7e, pants: 0x4a5568, boots: 0x3a3228, hat: null, hair: 0x5a3b22 },
  miner: { shirt: 0x3a5a78, pants: 0x3d3a36, boots: 0x2b2420, vest: 0xff7a1a, hat: { kind: 'hard', color: 0xffc400 } },
  driver: { shirt: 0x6a5a48, pants: 0x2c3138, boots: 0x222222, jacket: 0x3a4a5a, hat: { kind: 'cap', color: 0x2f3a46 } },
  scuba: { shirt: 0x14181c, pants: 0x14181c, boots: 0x14181c, hat: null, hair: 0x14181c, tank: true, mask: true },
  fisherman: { shirt: 0x8a8f64, pants: 0x3f4a3a, boots: 0x2a2a22, vest: 0x5a4a30, hat: { kind: 'bucket', color: 0xb8a880 }, rod: true },
  farmer: { shirt: 0xa6483a, pants: 0x3a4f6a, boots: 0x3a2f20, hat: { kind: 'safari', color: 0xd9bf68 }, hair: 0x5a3b22 },
  guide: { shirt: 0xb59b6a, pants: 0x6b5e3f, boots: 0x3a2f20, hat: { kind: 'safari', color: 0xa38a58 } },
};
const SKINS = [0xf0b88c, 0xd9a07a, 0xa9734f, 0x7b4f36, 0xe6c3a0];

/**
 * A light-weight walking person: every body part is ONE merged mesh (6 draw calls), costume via vertex colours.
 * Same proportions as the player's miner. Faces +Z.
 */
export class Puppet {
  constructor(type, material, seed = 0) {
    const c = COSTUMES[type], skin = SKINS[seed % SKINS.length];
    this.root = new THREE.Group(); this.model = new THREE.Group(); this.model.scale.setScalar(0.95); this.root.add(this.model);
    const part = (pivot, fn, x, y, z) => { const b = new Batch(); fn(b); const m = b.build(material); m.position.set(x, y, z); pivot.add(m); };
    this.hips = new THREE.Group(); this.hips.position.y = 0.92; this.model.add(this.hips);
    this.torso = new THREE.Group(); this.hips.add(this.torso);
    const jacket = c.jacket ?? c.shirt;
    part(this.torso, (b) => {
      b.box(0, 0.3, 0, 0.46, 0.58, 0.27, jacket); b.box(0, 0, 0, 0.5, 0.12, 0.3, c.pants);
      if (c.vest) { b.box(0, 0.36, 0, 0.5, 0.42, 0.31, c.vest); b.box(0, 0.27, 0, 0.52, 0.045, 0.32, 0xdfe4e8); }
      if (c.tie) b.box(0, 0.38, 0.14, 0.06, 0.3, 0.02, c.tie);
      if (c.jacket && c.shirt !== c.jacket) b.box(0, 0.45, 0.14, 0.14, 0.2, 0.02, c.shirt);
      if (c.badge) b.box(-0.12, 0.45, 0.14, 0.07, 0.08, 0.02, 0xd4af37);
      if (c.belt) b.box(0, 0.06, 0, 0.52, 0.06, 0.3, 0x111111);
      if (c.bag) b.box(0.3, 0.12, 0.05, 0.12, 0.3, 0.34, c.bag);
      if (c.tank) { for (const s of [-1, 1]) b.cyl(s * 0.11, 0.3, -0.34, 0.1, 0.1, 0.62, 0x2d6fa3, 8); b.box(0, 0.58, -0.34, 0.3, 0.06, 0.06, 0x222222); }
      if (c.rod) b.cyl(0.24, 0.5, -0.3, 0.015, 0.015, 1.9, 0x5a4630, 4, 0, 0.5, 0.15);
    }, 0, 0, 0);
    this.head = new THREE.Group(); this.head.position.set(0, 0.76, 0); this.torso.add(this.head);
    part(this.head, (b) => {
      b.sph(0, 0, 0, 0.16, skin, 1, 1, 1, 1); b.box(-0.06, 0.02, 0.145, 0.05, 0.05, 0.03, 0x1a1a1a); b.box(0.06, 0.02, 0.145, 0.05, 0.05, 0.03, 0x1a1a1a);
      const h = c.hat;
      if (!h && c.hair) b.sph(0, 0.06, -0.02, 0.17, c.hair, 1, 0.8, 1, 1);
      if (h?.kind === 'hard') { b.sph(0, 0.045, 0, 0.19, h.color, 1, 0.8, 1, 1); b.cyl(0, 0.05, 0.02, 0.235, 0.235, 0.025, h.color, 12); }
      if (h?.kind === 'cap') { b.sph(0, 0.06, 0, 0.18, h.color, 1, 0.7, 1, 1); b.box(0, 0.04, 0.2, 0.26, 0.025, 0.14, h.color); }
      if (h?.kind === 'bucket') { b.cyl(0, 0.1, 0, 0.16, 0.18, 0.14, h.color, 10); b.cyl(0, 0.04, 0, 0.27, 0.27, 0.02, h.color, 12); }
      if (h?.kind === 'safari') { b.cyl(0, 0.04, 0, 0.3, 0.3, 0.02, h.color, 14); b.cyl(0, 0.11, 0, 0.15, 0.17, 0.13, h.color, 10); b.cyl(0, 0.07, 0, 0.175, 0.175, 0.03, 0x4a3a22, 10); }
      if (c.mask) { b.box(0, 0.01, 0.16, 0.2, 0.1, 0.05, 0x111418); b.box(0, 0.01, 0.19, 0.16, 0.06, 0.02, 0x7fb7d6); }
    }, 0, 0, 0);
    const arm = (s) => { const g = new THREE.Group(); g.position.set(s * 0.31, 0.52, 0); this.torso.add(g); part(g, (b) => { b.box(0, -0.15, 0, 0.13, 0.3, 0.13, jacket); b.box(0, -0.42, 0, 0.11, 0.24, 0.11, c.jacket ? c.jacket : skin); b.sph(0, -0.57, 0, 0.075, skin, 1, 1, 1, 0); }, 0, 0, 0); return g; };
    this.armL = arm(-1); this.armR = arm(1);
    const leg = (s) => { const g = new THREE.Group(); g.position.set(s * 0.12, 0, 0); this.hips.add(g); part(g, (b) => { b.box(0, -0.39, 0, 0.17, 0.78, 0.19, c.pants); b.box(0, -0.85, 0.04, 0.19, 0.14, 0.3, c.boots); }, 0, 0, 0); return g; };
    this.legL = leg(-1); this.legR = leg(1);
    this.phase = seed * 1.7;
  }

  /** place feet at (x,y,z) facing h */
  place(x, y, z, h) { this.root.position.set(x, y, z); this.root.rotation.y = h; }

  /** anim: idle | walk | sit | swim | fish */
  animate(dt, anim, speed) {
    const k = 16;
    let l = 0, r = 0, al = 0, ar = 0, hipY = 0.92, lean = 0, pitch = 0;
    if (anim === 'walk') { this.phase += dt * (3 + speed * 2.2); const s = Math.sin(this.phase) * Math.min(0.75, 0.3 + speed * 0.25); l = s; r = -s; al = -s; ar = s; lean = 0.06; }
    else if (anim === 'swim') { this.phase += dt * 3; pitch = 1.2; hipY = 0.7; l = Math.sin(this.phase * 1.6) * 0.5; r = -l; al = -2.2; ar = -2.2; }
    else if (anim === 'sit') { l = r = -1.45; hipY = 0.5; al = ar = -0.5; }
    else if (anim === 'fish') { al = ar = -0.9; lean = 0.08; }
    else if (anim === 'hoe') { this.phase += dt * 2.6; const s = Math.sin(this.phase); al = ar = -0.7 + s * 0.85; l = Math.sin(this.phase * 0.5) * 0.12; r = -l; lean = 0.5 + s * 0.08; } // bent over, swinging the hoe
    else { this.phase += dt; al = Math.sin(this.phase) * 0.04; ar = -al; }
    const D = (o, v) => { o.rotation.x = damp(o.rotation.x, v, k, dt); };
    D(this.legL, l); D(this.legR, r); D(this.armL, al); D(this.armR, ar); D(this.torso, lean); D(this.hips, pitch);
    this.hips.position.y = damp(this.hips.position.y, hipY, k, dt);
  }
}
