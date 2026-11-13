import * as THREE from 'three';

const RHO = 1000, G = 9.81;
const R = 0.8, HALF = 4.2; // hull radius, half length of the cylindrical section (capsule)
const VOLUME = Math.PI * R * R * (2 * HALF) + (4 / 3) * Math.PI * R ** 3; // ~22 m3
const W = RHO * G * VOLUME; // weight of the displaced water = our weight (neutral when fully submerged)

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3(), _t = new THREE.Vector3();

/**
 * A small research submarine: a dynamic Rapier body with hand-written fluid forces
 * (buoyancy, ballast, thrust, quadratic drag, rudder, self-righting). Heading 0 faces +Z.
 *   step(dt, { throttle, yaw, heave, ballast, level })   throttle/yaw/heave in -1..1, ballast 0..1 (0.5 = neutral)
 */
export class Submarine {
  constructor({ R: RAPIER, world }, { x = 0, y = 0, z = 0, yaw = 0, roll = 0 } = {}) {
    this.battery = 100;
    _q.setFromEuler(new THREE.Euler(0, yaw, roll, 'YXZ'));
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }).setCanSleep(false),
    );
    const axis = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)); // capsule axis Y -> Z (forward)
    world.createCollider(
      RAPIER.ColliderDesc.capsule(HALF, R).setRotation({ x: axis.x, y: axis.y, z: axis.z, w: axis.w })
        .setDensity(RHO).setFriction(0.6).setRestitution(0.05), // mass = displaced water: neutral
      this.body,
    );
    this.level = -0.2;
  }

  get pos() { return this.body.translation(); }
  depth() { return Math.max(0, this.level - this.pos.y); }
  heading() { const r = this.body.rotation(); _q.set(r.x, r.y, r.z, r.w); _v.set(0, 0, 1).applyQuaternion(_q); return Math.atan2(_v.x, _v.z); }
  roll() { const r = this.body.rotation(); _q.set(r.x, r.y, r.z, r.w); _v.set(1, 0, 0).applyQuaternion(_q); return Math.asin(Math.max(-1, Math.min(1, _v.y))); }
  speed() { const v = this.body.linvel(); return Math.hypot(v.x, v.y, v.z); }

  step(dt, { throttle = 0, yaw = 0, heave = 0, ballast = 0.5, level = -0.2, holdY = null } = {}) {
    this.level = level;
    const b = this.body, t = b.translation(), r = b.rotation(), v = b.linvel(), w = b.angvel();
    _q.set(r.x, r.y, r.z, r.w);
    const qi = _q.clone().invert();

    const sub = Math.min(1, Math.max(0, (level - (t.y - R)) / (2 * R))); // submerged fraction
    const powered = this.battery > 0 ? 1 : 0;
    const medium = 0.15 + 0.85 * sub; // drag in air is much lower

    // vertical: buoyancy - (weight handled by gravity) +/- ballast authority (+-20% of displacement) + thrusters
    let fy = RHO * G * VOLUME * sub - (ballast - 0.5) * 0.4 * W + heave * 30000 * powered * (sub > 0.5 ? 1 : 0.2);
    if (holdY !== null && powered) fy += Math.max(-22000, Math.min(22000, (holdY - t.y) * 9000 - v.y * 14000)); // depth hold: thrusters trim out any drift
    _f.set(0, fy, 0);

    // thrust along the hull axis (propeller must be wet)
    _u.set(0, 0, 1).applyQuaternion(_q);
    _f.addScaledVector(_u, throttle * 60000 * powered * (sub > 0.35 ? 1 : 0.1));

    // quadratic drag in the body frame (cheap along the hull, expensive sideways / vertically)
    _v.set(v.x, v.y, v.z).applyQuaternion(qi);
    // viscous (linear) + quadratic drag per axis: sideways / vertical are expensive, along the hull is cheap
    const drag = (c1, c2, u) => -(c1 + c2 * Math.abs(u)) * u;
    const dl = new THREE.Vector3(drag(6000, 12000, _v.x), drag(8000, 12000, _v.y), drag(2500, 2963, _v.z)).multiplyScalar(medium);
    dl.applyQuaternion(_q);
    _f.add(dl);
    // gravity: the body is a dynamic collider with density RHO, so the engine already applies -m g

    // torques: rudder (about world up), self-righting spring + damping
    _u.set(0, 1, 0).applyQuaternion(_q); // body up
    _t.crossVectors(_u, new THREE.Vector3(0, 1, 0)).multiplyScalar(90000);
    _t.y += yaw * 70000 * powered * (sub > 0.35 ? 1 : 0.2) * Math.min(1, 0.4 + this.speed() / 2);
    _t.x -= w.x * 9000 * medium; _t.y -= w.y * 26000 * medium; _t.z -= w.z * 9000 * medium;

    b.applyImpulse({ x: _f.x * dt, y: _f.y * dt, z: _f.z * dt }, true);
    b.applyTorqueImpulse({ x: _t.x * dt, y: _t.y * dt, z: _t.z * dt }, true);

    this.battery = Math.max(0, this.battery - dt * (0.02 + 0.35 * (Math.abs(throttle) + Math.abs(heave))));
  }
}

