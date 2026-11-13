/**
 * Physics-driven character body: a Rapier kinematic capsule + character controller.
 * Pure logic (no Three.js / DOM) so it is unit-testable. `pos` is at the FEET.
 *
 *   motor.step(dt, { vx, vz, jump, swimY })
 *   - vx,vz : desired horizontal velocity (m/s)
 *   - jump  : true on the frame the jump key goes down (buffered + coyote time)
 *   - swimY : when a number, float toward that height instead of using gravity
 *   - dive  : {vy} free vertical swimming (no gravity)
 */
export class Motor {
  constructor({ R, world }, { radius = 0.35, height = 1.8, gravity = 26, jumpSpeed = 9, stepHeight = 0.7, maxSlope = 55 } = {}) {
    this.height = height;
    this.radius = radius;
    this.gravity = gravity;
    this.jumpSpeed = jumpSpeed;
    this.pos = { x: 0, y: 0, z: 0 };
    this.vy = 0;
    this.grounded = false;
    this.jumpBuf = 0;
    this.coyote = 0;

    this.body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, height / 2, 0));
    this.collider = world.createCollider(R.ColliderDesc.capsule((height - 2 * radius) / 2, radius).setFriction(0), this.body);

    const c = (this.ctrl = world.createCharacterController(0.02));
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setSlideEnabled(true);
    c.enableAutostep(stepHeight, 0.1, false);
    c.enableSnapToGround(0.3);
    c.setMaxSlopeClimbAngle((maxSlope * Math.PI) / 180);
    c.setMinSlopeSlideAngle(((maxSlope + 5) * Math.PI) / 180);
    c.setApplyImpulsesToDynamicBodies(true);
    c.setCharacterMass(80);
  }

  teleport(x, y, z) {
    // start just OUTSIDE the controller's 2 cm skin: spawning exactly touching a surface lets the capsule leak through it
    y += 0.03;
    this.pos.x = x; this.pos.y = y; this.pos.z = z;
    this.vy = 0;
    this.grounded = false;
    this.body.setTranslation({ x, y: y + this.height / 2, z }, true);
  }

  step(dt, { vx = 0, vz = 0, jump = false, swimY = null, dive = null } = {}) {
    if (jump) this.jumpBuf = 0.14;
    this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    this.coyote = this.grounded ? 0.1 : Math.max(0, this.coyote - dt);

    let dy;
    if (dive) {
      dy = dive.vy * dt; // free 3D movement under water: no gravity, collisions still apply
      this.vy = 0;
    } else if (swimY !== null) {
      dy = (swimY - this.pos.y) * (1 - Math.exp(-7 * dt));
      this.vy = 0;
    } else {
      if (this.jumpBuf > 0 && (this.grounded || this.coyote > 0)) {
        this.vy = this.jumpSpeed;
        this.jumpBuf = 0;
        this.coyote = 0;
        this.grounded = false;
      }
      this.vy -= this.gravity * dt;
      dy = this.vy * dt;
    }

    const want = { x: vx * dt, y: dy, z: vz * dt };
    this.ctrl.computeColliderMovement(this.collider, want);
    const m = this.ctrl.computedMovement();
    this.grounded = swimY === null && !dive && this.ctrl.computedGrounded();
    if (this.grounded && this.vy <= 0) this.vy = 0;
    if (this.vy > 0 && m.y < want.y - 1e-4) this.vy = 0; // bumped a ceiling

    this.pos.x += m.x; this.pos.y += m.y; this.pos.z += m.z;
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y + this.height / 2, z: this.pos.z }, true);
  }
}






