import * as THREE from 'three';
import { createExcavator } from './models.js';
import { heightAt } from '../world/terrain.js';
import { wetAt, lineWet } from '../agents/safety.js';
import { consLoc } from '../config.js';
import { damp, clamp } from '../math.js';

/**
 * Where an excavator can start its run: a dry spot ~70 m from the target with a dry straight line to it, preferably on the
 * side facing the construction yard it comes from. Returns [x, z] (never in water, never across water).
 */
export function stagingPoint(x, z, wet = wetAt, lineIsWet = lineWet) {
  const [yx, yz] = consLoc(60, -10), base = Math.atan2(yz - z, yx - x);
  for (const dist of [70, 55, 90, 40, 28]) {
    for (let k = 0; k < 16; k++) {
      const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8), sx = x + Math.cos(a) * dist, sz = z + Math.sin(a) * dist;
      if (!wet(sx, sz) && !lineIsWet(sx, sz, x, z, 4)) return [sx, sz];
    }
  }
  return [x + 20, z];
}

export const DIG_BASE = 14, DIG_PER_M = 4; // seconds of digging = base + per_m * depth
export const CYCLE = 4.5;                  // seconds for one scoop: reach, dig, lift, swing, dump, swing back
const SPEED = 7, STAND = 6.2;              // m/s, and how far from the dig point the machine parks
const SCALE = 0.95;                        // model scale (models.js)

// the arm as a two-link chain in the boom pivot's frame (model units: d forward, y up)
const L1 = Math.hypot(0.7, 4.5), O1 = Math.atan2(0.7, 4.5);   // boom pivot -> stick pivot, and its angle above the boom's own axis
const L2 = Math.hypot(0.2, 2.8), O2 = Math.atan2(-0.2, 2.8);  // stick pivot -> bucket pivot
export const PIVOT = { y: 1.65, z: 1.1 };                     // the boom pivot above / ahead of the machine's origin (model units)

/**
 * Joint rotations that put the bucket pivot at (d, y) with the bucket itself at world pitch `phi` (elbow-up, like a real backhoe):
 * { boom, stick, bucket } are the three.js rotation.x values of the nested pivots.
 */
export function armIK(d, y, phi) {
  const D = clamp(Math.hypot(d, y), Math.abs(L1 - L2) + 0.05, L1 + L2 - 0.05), g = Math.atan2(y, d);
  const A = Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
  const alpha = g + A;                                             // elevation of the boom link
  const ex = L1 * Math.cos(alpha), ey = L1 * Math.sin(alpha);      // the elbow (stick pivot)
  const beta = Math.atan2(D * Math.sin(g) - ey, D * Math.cos(g) - ex); // elevation of the stick link
  const boom = O1 - alpha, stickWorld = -beta + O2;                // (a positive rotation.x tips +Z downwards)
  return { boom, stick: stickWorld - boom, bucket: phi - stickWorld };
}

/** where the bucket pivot ends up for given joint rotations (the inverse of armIK; used by tests) */
export function armFK({ boom, stick }) {
  const alpha = O1 - boom, beta = -(boom + stick) + O2;
  return { d: L1 * Math.cos(alpha) + L2 * Math.cos(beta), y: L1 * Math.sin(alpha) + L2 * Math.sin(beta) };
}

// one scoop as key frames: [cycle fraction, reach d, height y (relative to the boom pivot), bucket pitch, house swing]
// ground level is y = -PIVOT.y; the scoop frames go deeper as the pit grows (see armAt)
const KEYS = [
  [0.00, 4.3, 0.7, 0.5, 0],     // carrying height, bucket curled
  [0.20, 6.3, -1.1, -1.2, 0],   // reach out over the pit and bite in, teeth down
  [0.45, 4.5, -1.6, 0.3, 0],    // drag towards the machine, curling the bucket shut: it is full
  [0.58, 4.2, 0.8, 0.6, 0],     // lift
  [0.72, 4.4, 0.9, 0.6, 1.5],   // swing to the spoil heap
  [0.82, 4.6, 0.9, -1.3, 1.5],  // tip it out
  [1.00, 4.3, 0.7, 0.5, 0],     // swing back
];
const CARRY = { d: 3.7, y: 0.5, phi: 0.6 };

/**
 * The arm `t` seconds into a dig that lasts `dur` seconds: interpolated key frames, the scoop going deeper as the pit grows.
 * Returns { swing, boom, stick, bucket, loaded, c } (c = the fraction of the current scoop).
 */
export function armPose(t, dur) {
  const c = (t % CYCLE) / CYCLE, deep = 0.9 * clamp(t / dur, 0, 1);
  let k = 0; while (k < KEYS.length - 2 && c > KEYS[k + 1][0]) k++;
  const a = KEYS[k], b = KEYS[k + 1], q = clamp((c - a[0]) / (b[0] - a[0]), 0, 1), u = q * q * (3 - 2 * q), mix = (i) => a[i] + (b[i] - a[i]) * u;
  const inPit = (key) => (key[2] < 0 ? deep : 0), y = a[2] - inPit(a) + (b[2] - inPit(b) - (a[2] - inPit(a))) * u;
  return { swing: mix(4), ...armIK(mix(1), y, mix(3)), loaded: c > 0.4 && c < 0.78, c };
}

/**
 * The excavator for ore that is too deep for a pickaxe. States: off -> mobilising (it is being sent from the yard) -> driving
 * (it arrives under its own power) -> digging (the arm scoops soil out of the pit and tips it on a spoil heap) -> done (waits beside
 * the exposed ore) -> leaving -> off. One machine at a time. `update` returns 'dug' on the frame the ore is exposed, 'gone' when it has left.
 */
export class Excavator {
  constructor(scene, particles) {
    this.particles = particles; this.scene = scene;
    this.mesh = createExcavator(); this.mesh.visible = false; scene.add(this.mesh);
    this.state = 'off'; this.site = null; this.t = 0; this.x = 0; this.y = 0; this.z = 0; this.h = 0; this.pitch = 0; this.dur = 1;
    this.start = [0, 0]; this.stand = [0, 0]; this.eta = 0; this.heap = null; this.scoops = 0;
    this._v = new THREE.Vector3();
  }

  get busy() { return this.state !== 'off'; }
  get progress() { return this.state === 'digging' ? clamp(this.t / this.dur, 0, 1) : this.state === 'done' || this.state === 'leaving' ? 1 : 0; }

  /** send it to dig out `site` ({ x, z, y, depth }); returns the ETA to exposed ore in seconds */
  call(site) {
    this.site = site; this.state = 'mobilising'; this.t = 0; this.scoops = 0; this.heap = null;
    this.start = stagingPoint(site.x, site.z);
    const dx = this.start[0] - site.x, dz = this.start[1] - site.z, d = Math.hypot(dx, dz) || 1;
    this.stand = [site.x + (dx / d) * STAND, site.z + (dz / d) * STAND];
    this.dur = Math.ceil((DIG_BASE + DIG_PER_M * site.depth) / CYCLE) * CYCLE; // whole scoops
    this.eta = 6 + Math.hypot(this.start[0] - this.stand[0], this.start[1] - this.stand[1]) / SPEED + this.dur;
    return this.eta;
  }

  place(x, z, h) { this.x = x; this.z = z; this.h = h; this.y = heightAt(x, z); this.pose(0, this.armCarry()); }

  armCarry() { return { swing: 0, ...armIK(CARRY.d, CARRY.y, CARRY.phi), loaded: false }; }

  /** the arm during the dig, `t` seconds in (see armPose) */
  armAt(t) { return armPose(t, this.dur); }

  pose(dt, arm = null) {
    const m = this.mesh, k = dt > 0 ? dt : 1;
    const gy = (a) => heightAt(this.x + Math.sin(this.h) * a, this.z + Math.cos(this.h) * a);
    const target = (gy(1.8) + gy(-1.8)) / 2;
    this.y = dt > 0 ? damp(this.y, target, 10, k) : target;
    this.pitch = dt > 0 ? damp(this.pitch, -Math.atan2(gy(1.8) - gy(-1.8), 3.6), 8, k) : -Math.atan2(gy(1.8) - gy(-1.8), 3.6);
    m.position.set(this.x, this.y, this.z); m.rotation.set(this.pitch, this.h, 0, 'YXZ');
    const u = m.userData;
    if (arm) {
      u.house.rotation.y = arm.swing; u.boom.rotation.x = arm.boom; u.stick.rotation.x = arm.stick; u.bucket.rotation.x = arm.bucket;
      if (u.load) u.load.visible = !!arm.loaded;
    }
  }

  /** world position of the bucket (for the soil that falls out of it) */
  bucketWorld() { return this.mesh.userData.bucket.getWorldPosition(this._v); }

  update(dt) {
    const s = this.site;
    if (this.state === 'off') return null;
    this.t += dt;
    if (this.state === 'mobilising') {
      if (this.t >= 6) {
        this.state = 'driving'; this.t = 0;
        this.place(this.start[0], this.start[1], Math.atan2(s.x - this.start[0], s.z - this.start[1])); this.mesh.visible = true;
      }
      return null;
    }
    if (this.state === 'driving' || this.state === 'leaving') {
      const to = this.state === 'driving' ? this.stand : this.start, dx = to[0] - this.x, dz = to[1] - this.z, d = Math.hypot(dx, dz);
      if (d > 0.6) {
        const want = Math.atan2(dx, dz); let e = want - this.h;
        while (e > Math.PI) e -= 2 * Math.PI;
        while (e < -Math.PI) e += 2 * Math.PI;
        this.h += clamp(e, -1.2 * dt, 1.2 * dt);
        const v = Math.min(SPEED, d * 1.5 + 0.5) * (Math.abs(e) > 0.8 ? 0.3 : 1);
        this.x += Math.sin(this.h) * v * dt; this.z += Math.cos(this.h) * v * dt;
        this.pose(dt, this.armCarry());
      } else if (this.state === 'driving') {
        this.h = Math.atan2(s.x - this.x, s.z - this.z); this.state = 'digging'; this.t = 0; this.pose(0, this.armCarry());
        // the spoil heap: beside the machine, where the swing ends
        const a = this.h + KEYS[4][4], r = (PIVOT.z + KEYS[5][1]) * SCALE, hx = this.x + Math.sin(a) * r, hz = this.z + Math.cos(a) * r;
        this.heap = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.1, 8), new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 1, flatShading: true }));
        this.heap.position.set(hx, heightAt(hx, hz) + 0.05, hz); this.heap.scale.setScalar(0.05); this.heap.castShadow = this.heap.receiveShadow = true;
        this.scene.add(this.heap);
      } else { this.state = 'off'; this.mesh.visible = false; return 'gone'; }
      return null;
    }
    if (this.state === 'digging') {
      const arm = this.armAt(this.t), prev = ((this.t - dt) % CYCLE) / CYCLE;
      this.pose(dt, arm);
      if (prev < 0.24 && arm.c >= 0.24) this.particles.burst(s.x, s.y + 0.2, s.z, 0x5a4330, 10, 3.2, 3.6);   // the bucket bites into the ground
      if (prev < 0.76 && arm.c >= 0.76) {                                                                    // ... and tips its load on the heap
        const b = this.bucketWorld(); this.particles.burst(b.x, b.y - 0.4, b.z, 0x6b5236, 12, 1.6, 0.6);
        this.scoops++;
        if (this.heap) { const k = Math.min(1, this.scoops / Math.max(1, this.dur / CYCLE)); this.heap.scale.set(0.35 + 0.75 * k, 0.25 + 0.95 * k, 0.35 + 0.75 * k); this.heap.position.y = heightAt(this.heap.position.x, this.heap.position.z) + 0.55 * (0.25 + 0.95 * k); }
      }
      if (this.t >= this.dur) { this.state = 'done'; this.t = 0; this.pose(dt, this.armCarry()); return 'dug'; }
      return null;
    }
    if (this.state === 'done' && this.t > 14) { this.state = 'leaving'; this.t = 0; }
    return null;
  }
}
