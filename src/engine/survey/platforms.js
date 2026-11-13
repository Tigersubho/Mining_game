import { createRover, createDrone, mountOn } from './models.js';
import { SENSORS } from './sensors.js';
import { heightAt, waterLevelAt } from '../world/terrain.js';
import { noise2 } from '../noise.js';
import { damp, clamp } from '../math.js';

const ROVER_SPEC = { name: 'Survey Rover', top: 11, boost: 15, accel: 5, turn: 1.6, cruise: 5, len: 2.6 };

/** how the ground under the rover limits it: 1 = smooth, lower = slower; `label` for the HUD */
export function terrainFactor(x, z, h, wet) {
  const e = 2.2, sx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), sz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  const slope = Math.hypot(sx, sz), rock = noise2(x / 14, z / 14, 818);
  if (slope > 0.62) return { f: 0.18, label: 'STEEP SLOPE', slope };
  if (wet > 0.6) return { f: 0.35, label: 'WATERLOGGED', slope };
  if (slope > 0.35) return { f: 0.5, label: 'SLOPE', slope };
  if (rock > 0.7) return { f: 0.55, label: 'ROCKY', slope };
  return { f: 1, label: 'SMOOTH', slope };
}

/**
 * The survey rover. Driven through the player's ordinary car controls (K), so it uses the same driving model and
 * collision as the city cars (`fleet.drive`); `adjust` applies the terrain limits before each driving step.
 */
export class Rover {
  constructor(scene, col, geo) {
    Object.assign(this, { col, geo });
    this.mesh = createRover(); scene.add(this.mesh);
    this.spec = ROVER_SPEC; this.kind = 'rover';
    this.x = 0; this.y = 0; this.z = 0; this.h = 0; this.speed = 0; this.boost = 1; this.boosting = false; this.pitch = 0; this.roll = 0;
    this.mode = 'parked'; this.sensor = null; this.terrain = { f: 1, label: 'SMOOTH' };
    this.mesh.visible = false; this.deployed = false;
  }
  place(x, z, h) { this.x = x; this.z = z; this.h = h; this.y = heightAt(x, z); this.speed = 0; this.deployed = true; this.mesh.visible = true; this.update(0); }
  mount(sensor) { this.sensor = sensor; mountOn(this.mesh.userData.mount, sensor, sensor ? SENSORS[sensor].color : 0); }
  ground(x, z, hint) { const y = this.col.surfaceY(x, z, hint + 2.5); return y === null || y > hint + 1.4 ? Math.min(heightAt(x, z), hint + 1.4) : y; }

  /** terrain limits applied to the control input before fleet.drive runs */
  adjust(ctl) {
    const t = this.terrain = terrainFactor(this.x, this.z, this.y, this.geo.wet(this.x, this.z));
    const cap = this.spec.top * t.f;
    if (Math.abs(this.speed) > cap) this.speed = Math.sign(this.speed) * Math.max(cap, Math.abs(this.speed) - 12 * (1 / 60));
    if (t.f < 0.3) {
      // too steep / too wet to climb: only allow driving out of it (downhill or backwards)
      const fx = Math.sin(this.h), fz = Math.cos(this.h), ahead = heightAt(this.x + fx * 3, this.z + fz * 3) - this.y;
      if (ahead > 0.6 && ctl.throttle > 0) ctl.throttle = 0;
    }
    ctl.throttle *= 0.4 + 0.6 * t.f;
    return ctl;
  }

  update(dt) {
    if (!this.deployed) return;
    const sx = Math.sin(this.h), cz = Math.cos(this.h), L = 0.9, W = 0.75;
    const yf = this.ground(this.x + sx * L, this.z + cz * L, this.y), yr = this.ground(this.x - sx * L, this.z - cz * L, this.y);
    const yl = this.ground(this.x + cz * W, this.z - sx * W, this.y), yR = this.ground(this.x - cz * W, this.z + sx * W, this.y);
    const k = dt > 0 ? dt : 1;
    this.y = dt > 0 ? damp(this.y, (yf + yr + yl + yR) / 4, 12, k) : (yf + yr + yl + yR) / 4;
    this.pitch = damp(this.pitch, -Math.atan2(yf - yr, 2 * L), 10, k); this.roll = damp(this.roll, Math.atan2(yl - yR, 2 * W), 10, k);
    if (this.mode !== 'driven') this.speed = damp(this.speed, 0, 3, k);
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.set(this.pitch, this.h, this.roll, 'YXZ');
  }
}

const FLY = { cruise: 9, fast: 17, climb: 4.5, minAgl: 1.6, maxAgl: 120, drain: 0.2 }; // drain: battery % per second

/**
 * The survey drone. States: 'landed' | 'flying' | 'landing' | 'returning'. While possessed the player flies it
 * (WASD relative to the camera, Space / C altitude, Shift fast). When control is handed back it lands where it is
 * (or flies home on RECALL). It never hands control back by itself.
 */
export class Drone {
  constructor(scene, col) {
    this.col = col;
    this.mesh = createDrone(); scene.add(this.mesh); this.mesh.visible = false;
    this.x = 0; this.y = 0; this.z = 0; this.yaw = 0; this.vx = 0; this.vy = 0; this.vz = 0;
    this.state = 'landed'; this.possessed = false; this.battery = 100; this.deployed = false; this.sensor = null;
    this.spin = 0; this.tiltX = 0; this.tiltZ = 0; this.home = null;
  }
  floor(x, z) { const s = this.col.surfaceY(x, z, this.y + 0.2); return Math.max(heightAt(x, z), waterLevelAt(x, z), s ?? -Infinity); }
  get agl() { return this.y - this.floor(this.x, this.z); }
  place(x, z, yaw) { this.x = x; this.z = z; this.yaw = yaw; this.y = this.floor(x, z); this.vx = this.vy = this.vz = 0; this.state = 'landed'; this.deployed = true; this.mesh.visible = true; this.pose(0); }
  mount(sensor) { this.sensor = sensor; mountOn(this.mesh.userData.mount, sensor, sensor ? SENSORS[sensor].color : 0); }
  launch() { if (this.battery <= 1) return false; this.possessed = true; if (this.state !== 'flying') { this.state = 'flying'; this.vy = 3; } return true; }
  release() { this.possessed = false; if (this.state === 'flying') this.state = 'landing'; }
  recall(x, z) { this.home = { x, z }; this.possessed = false; if (this.state === 'landed') { this.state = 'returning'; this.vy = 3; } else this.state = 'returning'; }

  /** ctl: { fx, fz (world direction, |f| <= 1), heave -1..1, fast } — only used while possessed */
  update(dt, ctl, player) {
    if (!this.deployed) return;
    const fl = this.floor(this.x, this.z);
    let tvx = 0, tvz = 0, tvy = 0;
    if (this.state === 'flying' && this.possessed && ctl) {
      const sp = this.battery > 0 ? (ctl.fast ? FLY.fast : FLY.cruise) : 0;
      tvx = ctl.fx * sp; tvz = ctl.fz * sp; tvy = this.battery > 0 ? ctl.heave * FLY.climb : -2;
      if (ctl.yaw !== undefined) this.yaw = ctl.yaw; // the drone faces where the camera looks
    } else if (this.state === 'landing' || (this.state === 'flying' && !this.possessed)) {
      this.state = 'landing'; tvy = -2.2;
    } else if (this.state === 'returning') {
      const dx = this.home.x - this.x, dz = this.home.z - this.z, d = Math.hypot(dx, dz);
      const want = fl + 14;
      tvy = clamp((want - this.y) * 0.8, -3, 3);
      if (d > 3) { tvx = (dx / d) * Math.min(12, d); tvz = (dz / d) * Math.min(12, d); this.yaw = Math.atan2(dx, dz); } else this.state = 'landing';
    }
    const k = 1 - Math.exp(-3.2 * dt);
    this.vx += (tvx - this.vx) * k; this.vz += (tvz - this.vz) * k; this.vy += (tvy - this.vy) * (1 - Math.exp(-4 * dt));
    if (this.state !== 'landed') {
      this.x += this.vx * dt; this.z += this.vz * dt; this.y += this.vy * dt;
      const nf = this.floor(this.x, this.z), lo = nf + (this.state === 'landing' ? 0 : FLY.minAgl);
      if (this.y < lo) { this.y = lo; this.vy = Math.max(0, this.vy); }
      if (this.y > nf + FLY.maxAgl) { this.y = nf + FLY.maxAgl; this.vy = Math.min(0, this.vy); }
      if (this.state === 'landing' && this.y - nf < 0.05) { this.state = 'landed'; this.y = nf; this.vx = this.vz = this.vy = 0; }
      const r = Math.hypot(this.x, this.z); if (r > 770) { this.x *= 770 / r; this.z *= 770 / r; }
      this.battery = Math.max(0, this.battery - dt * FLY.drain * (ctl?.fast ? 1.6 : 1));
    } else {
      this.y = fl;
      if (player && Math.hypot(player.x - this.x, player.z - this.z) < 6) this.battery = Math.min(100, this.battery + dt * 2.5); // battery swap at the operator
    }
    this.pose(dt);
  }

  pose(dt) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const fwd = this.vx * s + this.vz * c, side = this.vx * c - this.vz * s;
    this.tiltX = damp(this.tiltX, clamp(fwd * 0.03, -0.35, 0.35), 6, dt || 1); this.tiltZ = damp(this.tiltZ, clamp(-side * 0.03, -0.35, 0.35), 6, dt || 1);
    this.spin += dt * (this.state === 'landed' ? 0 : 60);
    for (const r of this.mesh.userData.rotors) r.rotation.y = this.spin;
    this.mesh.position.set(this.x, this.y + 0.62, this.z);
    this.mesh.rotation.set(this.tiltX, this.yaw, this.tiltZ, 'YXZ');
  }
}
