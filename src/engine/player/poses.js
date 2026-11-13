import * as THREE from 'three';

/**
 * Procedural animation for a Mixamo-style skeleton (the model ships with no clips). Pure maths, no rendering.
 * A pose is { BoneKey: Quaternion } - each a rotation about the CHARACTER's axes (x = left, y = up, z = forward) applied
 * to that bone on top of its parent's, measured from the rest (T) pose. The Rig converts that to each bone's own axes.
 * Sign conventions with the arms/legs hanging down: rotX(-a) swings a limb forward by a; rotZ(-s*a) lowers an arm
 * (s = +1 left, -1 right) from horizontal; the knee bends with rotX(+k); the elbow with rotY(-s*e).
 */
const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
export const rot = (axis, a) => new THREE.Quaternion().setFromAxisAngle(AX[axis], a);
export const mul = (...qs) => qs.reduce((a, b) => a.multiply(b));
const lerp = THREE.MathUtils.lerp, clamp = THREE.MathUtils.clamp;
const side = (s) => (s > 0 ? 'Left' : 'Right');
export const ARM_DOWN = 1.25; // radians below horizontal when the arms hang

/** pickaxe swing keyframes: arm raise (rad, forward), pickaxe handle angle (rad from vertical, forward), torso lean */
export function swingCurve(t) {
  const e = (x) => x * x * (3 - 2 * x);
  if (t < 0.16) { const k = e(t / 0.16); return { arm: lerp(0.55, 2.5, k), psi: lerp(0.5, -0.7, k), lean: lerp(0, -0.12, k) }; }
  if (t < 0.3) { const k = ((t - 0.16) / 0.14) ** 2; return { arm: lerp(2.5, 0.75, k), psi: lerp(-0.7, 2.3, k), lean: lerp(-0.12, 0.3, k) }; }
  const k = e(clamp((t - 0.3) / 0.3, 0, 1));
  return { arm: lerp(0.75, 0.55, k), psi: lerp(2.3, 0.5, k), lean: lerp(0.3, 0, k) };
}

/**
 * m = { mode: 'idle'|'loco'|'jump'|'swim'|'tread', phase, t, speed, vy, swing (seconds into the swing, or -1), carry (pickaxe in hand) }
 * returns { pose, bob (metres the hips drop/rise), pitch (whole-body pitch, rad), psi (pickaxe handle angle, rad) }
 */
export function poseFor({ mode, phase = 0, t = 0, speed = 0, vy = 0, swing = -1, carry = false }) {
  const P = {};
  let bob = 0, pitch = 0, psi = 0.5;
  const arm = (s, sw, down, elbow) => { P[`${side(s)}Arm`] = mul(rot('x', -sw), rot('z', -s * down)); P[`${side(s)}ForeArm`] = rot('y', -s * elbow); };
  const leg = (s, sw, knee, splay = 0.04) => {
    P[`${side(s)}UpLeg`] = mul(rot('x', -sw), rot('z', s * splay));
    P[`${side(s)}Leg`] = rot('x', knee);
    P[`${side(s)}Foot`] = rot('x', (sw - knee) * 0.6);
  };

  if (mode === 'idle') {
    const br = Math.sin(t * 1.7);
    arm(1, 0.03 * br, ARM_DOWN - 0.03 * br, 0.12); arm(-1, -0.03 * br, ARM_DOWN - 0.03 * br, 0.12);
    leg(1, 0, 0.04); leg(-1, 0, 0.04, 0.07);
    P.Hips = rot('z', 0.02 * Math.sin(t * 0.6));
    P.Spine = rot('x', 0.02 * br); P.Spine2 = rot('x', 0.015 * br);
    P.Head = rot('y', 0.06 * Math.sin(t * 0.4));
    bob = -0.004 * br;
  } else if (mode === 'loco') {
    const run = clamp((speed - 3.2) / 3.5, 0, 1), m = clamp(speed / 1.2, 0, 1);
    const A = lerp(0.5, 1.0, run) * m, K = lerp(0.9, 1.55, run) * m, B = lerp(0.4, 0.95, run) * m;
    const elbow = lerp(0.25, 1.45, run), lean = lerp(0.04, 0.22, run) * m, s = Math.sin(phase), c = Math.cos(phase);
    leg(1, A * s, K * Math.max(0, c) + 0.08); leg(-1, -A * s, K * Math.max(0, -c) + 0.08);
    arm(1, -B * s, ARM_DOWN - 0.1 * run, elbow); arm(-1, B * s, ARM_DOWN - 0.1 * run, elbow);
    P.Hips = mul(rot('y', 0.1 * A * c), rot('z', 0.03 * s * m));
    P.Spine = mul(rot('x', lean), rot('y', -0.14 * A * c));
    P.Spine2 = rot('y', -0.06 * A * c);
    P.Head = rot('x', -lean * 0.8);
    bob = (lerp(0.018, 0.05, run) * Math.cos(2 * phase) - 0.012 - lean * 0.05) * m;
  } else if (mode === 'jump') {
    const up = vy > 0;
    leg(1, up ? 0.7 : 0.25, up ? 1.1 : 0.5); leg(-1, up ? -0.15 : 0.1, up ? 0.5 : 0.3, 0.08);
    if (up) { arm(1, 1.5, ARM_DOWN, 0.5); arm(-1, 1.5, ARM_DOWN, 0.5); } else { arm(1, 0.2, 0.75, 0.3); arm(-1, 0.2, 0.75, 0.3); }
    P.Spine = rot('x', 0.1);
    bob = up ? 0.02 : -0.03;
  } else if (mode === 'swim') {
    pitch = 1.25;
    P.Hips = mul(rot('z', 0.12 * Math.sin(phase)), rot('x', pitch));
    P.Neck = rot('x', -0.7); P.Head = rot('x', -0.35);
    for (const s of [1, -1]) {
      const th = -(phase + (s > 0 ? 0 : Math.PI)); // crawl stroke: forward, down, back, then up and over
      arm(s, th, 1.45, 0.4);
    }
    leg(1, 0.35 * Math.sin(2 * phase), 0.25 + 0.2 * Math.max(0, Math.sin(2 * phase)), 0.03);
    leg(-1, -0.35 * Math.sin(2 * phase), 0.25 + 0.2 * Math.max(0, -Math.sin(2 * phase)), 0.03);
  } else { // tread water: upright, bicycle legs, sculling arms
    const s = Math.sin(phase);
    leg(1, 0.6 * s, 0.9 + 0.5 * s); leg(-1, -0.6 * s, 0.9 - 0.5 * s, 0.1);
    arm(1, 0.35, 0.55 + 0.12 * s, 0.9); arm(-1, 0.35, 0.55 - 0.12 * s, 0.9);
    P.Hips = rot('z', 0.04 * s);
    bob = 0.025 * Math.sin(phase * 0.5);
  }

  if (swing >= 0 && mode !== 'swim' && mode !== 'tread') { // the pickaxe swing replaces whatever the arms were doing
    const c = swingCurve(swing);
    arm(1, c.arm, ARM_DOWN - 0.25, 0.55); arm(-1, c.arm, ARM_DOWN - 0.25, 0.55);
    P.Spine = mul(P.Spine ?? new THREE.Quaternion(), rot('x', c.lean));
    psi = c.psi;
  } else if (carry && mode !== 'swim' && mode !== 'tread') { // pickaxe held at the ready
    arm(-1, 0.5, ARM_DOWN - 0.1, 1.0);
    if (mode === 'idle' || mode === 'loco') arm(1, 0.25, ARM_DOWN - 0.1, 0.6);
  }
  return { pose: P, bob, pitch, psi };
}
