import * as THREE from 'three';
import { Motor } from './motor.js';
import { moveVector, speedFor, bearingDeg, lerpAngle } from './intent.js';
import { waterState } from './waterState.js';
import { newBreath, stepBreath, ambientAtm, BREATH_SECONDS } from './breath.js';
import { heightAt, regionName, regionWeights, waterLevelAt } from '../world/terrain.js';
import { WORLD_R, DIVE } from '../config.js';
import { clamp, damp, lerp } from '../math.js';
import { notify } from '../../ui/store.js';
import { insideCave } from '../ambience.js';
import { sonarContacts, SONAR_RANGE } from '../gameplay/sonar.js';
import { newLamp, stepLamp, toggleLamp } from './headlamp.js';

const BALLAST = { surface: 0, trim: 0.5, dive: 0.78 };   // tank level each mode aims for
const NEXT_MODE = { surface: 'dive', dive: 'trim', trim: 'surface' };

const CAM_HEIGHT = 1.55;
const DIVE_SPEED = 2.8;

/** Third-person player: input -> motor (physics) -> animation + chase camera. Also drives the submarine. */
export class Player {
  constructor({ scene, camera, world, input, store, bubbles, character }) {
    Object.assign(this, { camera, world, input, store, bubbles });
    this.char = character;
    scene.add(this.char.root);
    this.char.onImpact = () => this.onSwingImpact();
    this.motor = new Motor(world.physics);
    this.pos = this.motor.pos;

    this.vx = 0; this.vz = 0;
    this.facing = 0; this.visY = 0;
    this.water = 'dry'; this.swimming = false; this.diving = false;
    this.equipped = false; this.scuba = false; this.breath = newBreath();
    this.samples = {}; this.ore = 0;
    this.region = ''; this.underground = false;
    this.vehicle = null; this.car = null; this.fleet = null; this.lookT = 0; this.ballast = 0; this.ballastMode = 'surface'; this.holdY = null; this.sonarOn = true; // 0 = blown (floats), 0.5 = neutral trim
    this.camYaw = 0; this.camPitch = 0.38; this.camDist = 7.5; this.camNow = 7.5;
    this.camTarget = new THREE.Vector3();
    this.fov = 60; this.splashT = 0; this.hudT = 0; this.bubbleT = 0;
    this.jungleW = 0; this.state = 'ON FOOT';
    this.drone = null; this.survey = null; // set by the engine: the geophysical survey system
    this.lamp = newLamp(); // the headlamp (L): off until you switch it on
    this.respawn();
  }

  respawn() { const s = this.world.spawn; this.teleport(s.x, s.z, s.yaw); }

  /** place on whatever solid surface is below `fromY` (defaults to terrain) */
  teleport(x, z, yaw = this.facing, fromY) {
    if (this.vehicle) this.exitVehicle(true);
    if (this.car) this.exitCar(true);
    if (this.drone) this.exitDrone(true);
    const y = fromY === undefined ? heightAt(x, z) : this.world.physics.col.groundY(x, z, fromY, this.motor.body) ?? heightAt(x, z);
    this.motor.teleport(x, y, z);
    this.world.step(1 / 60);
    this.vx = this.vz = 0;
    this.water = 'dry'; this.swimming = this.diving = false;
    this.facing = yaw; this.camYaw = yaw + Math.PI;
    this.visY = this.pos.y;
    this.camTarget.set(x, this.pos.y + CAM_HEIGHT, z);
  }

  zoom(delta) { this.camDist = clamp(this.camDist + delta, 3, 22); }

  toggleEquip() {
    if (this.char.swingT >= 0 || this.car || this.drone) return;
    this.equipped = !this.equipped;
    this.char.setEquipped(this.equipped);
    this.store.set({ equipped: this.equipped });
  }

  /** L: headlamp on / off (caves and deep water are dark without it) */
  toggleHeadlamp() {
    const r = toggleLamp(this.lamp); this.lamp = r.lamp;
    this.char.setLamp?.(this.lamp.on);
    notify(this.store, r.event === 'flat' ? 'Headlamp battery flat - it recharges while switched off' : this.lamp.on ? 'Headlamp on' : 'Headlamp off', r.event ? 'warn' : 'info');
  }

  /** what is in the hands when equipped: 'pick' (pickaxe) or 'sensor' (the hand-mounted survey instrument) */
  setTool(tool, equip = this.equipped) {
    if (this.survey) this.survey.tool = tool;
    this.char.tool = tool;
    this.equipped = equip;
    this.char.setEquipped(equip);
    this.store.set({ equipped: equip, tool });
  }

  /** Q: swap pickaxe <-> hand sensor */
  swapTool() {
    const s = this.survey;
    if (this.car || this.drone || this.vehicle || this.char.swingT >= 0) return;
    if (!s?.sensor || s.mode !== 'hand') return notify(this.store, 'No hand-mounted sensor fitted. Press U for the equipment menu', 'warn');
    this.setTool(s.tool === 'sensor' ? 'pick' : 'sensor', true);
    notify(this.store, s.tool === 'sensor' ? 'Survey sensor in hand' : 'Pickaxe in hand', 'info');
  }

  /** movement input, or none while a full-screen menu is open */
  move() { return this.store.get().surveyMenu ? { x: 0, y: 0 } : this.input.move(); }

  toggleScuba() {
    if (this.vehicle || this.car) return;
    this.scuba = !this.scuba;
    this.char.setScuba(this.scuba);
    this.store.set({ scuba: this.scuba });
    notify(this.store, this.scuba ? 'Scuba gear on' : 'Scuba gear off', 'info');
  }

  swing() {
    if (this.car || this.drone) return;
    if (this.vehicle) return this.sampleFromSub();
    if (!this.equipped) return notify(this.store, 'Equip the pickaxe first (F)', 'warn');
    if (this.char.tool === 'sensor') return this.survey?.addMarker(this.pos.x, this.pos.z); // with the sensor in hand, E drops a marker here
    this.char.swing();
  }

  onSwingImpact() {
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    const res = this.world.ore.hit(this.pos.x, this.pos.z, fx, fz, 2.7, this.pos.y);
    this.collect(res, () => {
      const gx = this.pos.x + fx * 1.3, gz = this.pos.z + fz * 1.3;
      // no outcrop in reach: the pickaxe digs into the ground (survey excavation)
      if (!this.survey?.dig(gx, gz, this.pos.y)) this.world.particles.burst(gx, heightAt(gx, gz) + 0.1, gz, 0x8a8174, 6, 2.6, 3);
    });
  }

  collect(res, onMiss) {
    if (res && res !== 'chip') {
      const n = this.world.ore.lastYield ?? 1;
      this.ore += n;
      this.samples[res] = (this.samples[res] || 0) + n;
      this.store.set({ ore: this.ore, samples: { ...this.samples } });
      notify(this.store, `${n > 1 ? `${n} x ` : 'Sample recovered: '}${this.world.ore.typeName(res)}${n > 1 ? ' collected' : ''}`, 'ok');
    } else if (!res) onMiss?.();
  }

  // ----------------------------------------------------------- survey drone (possession)
  nearDrone() { const d = this.survey?.drone; return d?.deployed && Math.hypot(d.x - this.pos.x, d.z - this.pos.z) < 5 ? d : null; }

  enterDrone() {
    const d = this.nearDrone();
    if (!d) return false;
    if (!d.sensor) { notify(this.store, 'Mount a sensor on the drone first (U)', 'warn'); return true; }
    if (!d.launch()) { notify(this.store, 'Drone battery flat - wait beside it to swap batteries', 'warn'); return true; }
    if (this.survey.sensor !== d.sensor || this.survey.mode !== 'drone') { this.survey.sensor = d.sensor; this.survey.mode = 'drone'; }
    this.drone = d;
    this.vx = this.vz = 0;
    this.camDist = 9; this.camNow = 9; this.camPitch = 0.55; this.camYaw = d.yaw + Math.PI;
    notify(this.store, 'Drone launched. WASD fly - SPACE / C altitude - SHIFT fast - X save anomaly - O DRONE OFF', 'info');
    return true;
  }

  exitDrone(silent = false) {
    const d = this.drone;
    if (!d) return;
    this.drone = null; d.release();
    this.camDist = 7.5; this.camNow = 7.5; this.camPitch = 0.38;
    this.camTarget.set(this.pos.x, this.pos.y + CAM_HEIGHT, this.pos.z);
    if (!silent) notify(this.store, 'Drone off: control returned to you. The drone lands where it is; survey data kept.', 'info');
  }

  updateDrone(dt) {
    const { input } = this, d = this.drone, mv = this.move(), dir = moveVector(mv, this.camYaw);
    const heave = (input.held('ascend') ? 1 : 0) - (input.held('descend') ? 1 : 0);
    input.take('jump');
    this.survey.droneCtl = { fx: dir.x, fz: dir.z, heave: this.store.get().surveyMenu ? 0 : heave, fast: input.sprint(), yaw: this.camYaw + Math.PI };
    // the operator stays where they launched from, idling
    this.char.root.position.set(this.pos.x, this.visY, this.pos.z);
    this.char.update(dt, { speed: 0, grounded: true, vy: 0, swimming: this.swimming });
    this.state = d.state === 'flying' ? 'FLYING DRONE' : 'DRONE LANDING';
    this.camTarget.set(d.x, d.y + 0.8, d.z);
    this.updateCamera(dt, true);
    const cam = this.camera.position;
    cam.y = Math.max(cam.y, heightAt(cam.x, cam.z) + 0.5);
    this.updateHud(dt);
  }

  // ----------------------------------------------------------- submarine
  nearSub() {
    const s = this.world.sub.sub.pos;
    return Math.hypot(s.x - this.pos.x, s.z - this.pos.z) < 7 && Math.abs(s.y - this.pos.y) < 6;
  }

  toggleVehicle() {
    if (this.car) return;
    if (this.vehicle) return this.exitVehicle();
    if (!this.nearSub()) return notify(this.store, 'No vehicle within reach', 'warn');
    this.vehicle = this.world.sub;
    this.vehicle.boarded = true;
    this.motor.collider.setEnabled(false);
    this.char.root.visible = false;
    this.camDist = 14; this.camNow = 14;
    this.ballast = 0; this.ballastMode = 'surface'; this.holdY = null; this.sonarOn = true; this.vehicle.lights = true;
    notify(this.store, 'Boarded submarine. B ballast (surface / dive / trim), Space / C thrusters up / down, L lights, N sonar, V exit', 'info');
  }

  exitVehicle(silent = false) {
    const v = this.vehicle;
    if (!v) return;
    const s = v.sub.pos, r = v.sub.body.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const surfaced = v.sub.depth() < 1.6;
    this.vehicle = null; v.boarded = false; v.input = null; v.lights = false;
    this.motor.collider.setEnabled(true);
    this.char.root.visible = true;
    this.motor.teleport(s.x + up.x * 1.9, surfaced ? s.y + 1.5 : s.y + 0.8, s.z + up.z * 1.9);
    this.world.step(1 / 60);
    this.camDist = 7.5; this.camNow = 7.5;
    if (!silent) notify(this.store, surfaced ? 'Left the submarine' : 'Left the submarine - underwater!', 'warn');
  }

  sampleFromSub() {
    const sub = this.vehicle.sub, h = sub.heading(), p = sub.pos;
    const res = this.world.ore.hit(p.x, p.z, Math.sin(h), Math.cos(h), 8, p.y, 7);
    this.collect(res, () => notify(this.store, 'Nothing in range of the sampling arm', 'warn'));
  }

  updateVehicle(dt) {
    const { input } = this, v = this.vehicle, sub = v.sub;
    if (input.take('ballast')) {
      this.ballastMode = NEXT_MODE[this.ballastMode];
      notify(this.store, { surface: 'Ballast blown: the submarine rises and floats', dive: 'Flooding ballast: the submarine dives', trim: 'Ballast neutral: holding depth' }[this.ballastMode], 'info');
    }
    if (input.take('lights')) v.lights = !v.lights;
    if (input.take('sonar')) this.sonarOn = !this.sonarOn;
    const mv = this.move(), heave = (input.held('ascend') ? 1 : 0) - (input.held('descend') ? 1 : 0);
    // the tanks fill / empty gradually, so a dive or a rise builds up instead of snapping
    const aim = BALLAST[this.ballastMode];
    this.ballast += clamp(aim - this.ballast, -dt * 0.3, dt * 0.3);
    // neutral trim holds the depth where you let go of the thrusters
    if (heave || this.ballastMode !== 'trim' || sub.depth() < 1.5) this.holdY = null;
    else if (this.holdY === null) this.holdY = sub.pos.y;
    const level = waterLevelAt(sub.pos.x, sub.pos.z);
    v.input = { throttle: mv.y, yaw: -mv.x, ballast: this.ballast, heave, level, holdY: this.holdY };
    input.take('jump');
    const p = sub.pos;
    this.pos.x = p.x; this.pos.y = p.y; this.pos.z = p.z;
    this.motor.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.facing = sub.heading();
    this.swimming = false; this.diving = false; this.water = 'sub';
    this.state = 'SUBMERSIBLE';
    this.camTarget.set(p.x, p.y + 1.2, p.z);
    this.visY = p.y;
    this.updateCamera(dt, true);
    this.updateHud(dt);
  }

  // ----------------------------------------------------------- cars (K)
  nearCar() {
    const r = this.survey?.rover;
    if (r?.deployed && Math.hypot(r.x - this.pos.x, r.z - this.pos.z) < 6.5 && Math.abs(r.y - this.pos.y) < 3) return r;
    return this.fleet?.nearest(this.pos.x, this.pos.y, this.pos.z) ?? null;
  }

  toggleCar() {
    if (this.drone) return;
    if (this.car) return this.exitCar();
    if (this.vehicle || this.water === 'dive') return;
    if (this.enterDrone()) return;
    const v = this.nearCar();
    if (!v) return notify(this.store, 'No vehicle within reach (K)', 'warn');
    this.car = v; this.fleet.board(v);
    this.motor.collider.setEnabled(false);
    this.char.root.visible = false;
    this.camDist = 11; this.camNow = 11; this.lookT = 9;
    notify(this.store, `Driving the ${v.spec.name}. W/S throttle, A/D steer, Shift boost, Space brake, K exit`, 'info');
  }

  exitCar(silent = false) {
    const v = this.car;
    if (!v) return;
    const col = this.world.physics.col, c = Math.cos(v.h), s = Math.sin(v.h), off = v.spec.len > 7 ? 3.2 : 2.2;
    let x = v.x + c * off, z = v.z - s * off; // driver's side first, then the other
    if (heightAt(x, z) < waterLevelAt(x, z) - 0.3) { x = v.x - c * off; z = v.z + s * off; }
    const y = col.groundY(x, z, v.y + 3, this.motor.body) ?? heightAt(x, z);
    this.car = null; this.fleet.release(v);
    this.motor.collider.setEnabled(true);
    this.char.root.visible = true;
    this.motor.teleport(x, y, z);
    this.world.step(1 / 60);
    this.vx = this.vz = 0; this.visY = this.pos.y;
    this.camDist = 7.5; this.camNow = 7.5;
    this.camTarget.set(x, y + CAM_HEIGHT, z);
    if (!silent) notify(this.store, 'Left the vehicle', 'info');
  }

  updateCar(dt) {
    const { input, car: v, pos } = this, mv = this.move();
    const ctl = { throttle: mv.y, steer: mv.x, boost: input.sprint(), brake: input.held('ascend') };
    v.adjust?.(ctl, dt); // the survey rover's terrain limits
    this.fleet.drive(v, ctl, dt);
    input.take('jump');
    pos.x = v.x; pos.y = v.y; pos.z = v.z;
    this.motor.body.setTranslation({ x: v.x, y: v.y + 1, z: v.z }, true);
    this.facing = v.h; this.vx = Math.sin(v.h) * v.speed; this.vz = Math.cos(v.h) * v.speed;
    this.swimming = this.diving = false; this.water = 'dry'; this.underground = insideCave(this.world.caves, v.x, v.z, v.y) > 0;
    this.state = v.boosting ? 'BOOST' : 'DRIVING';
    if (this.lookT > 1.5 && Math.abs(v.speed) > 2) this.camYaw = lerpAngle(this.camYaw, v.h + (v.speed < 0 ? 0 : Math.PI), 1 - Math.exp(-2.2 * dt));
    this.camTarget.set(v.x, v.y + 1.5, v.z);
    this.visY = v.y;
    this.updateCamera(dt, true);
    this.updateHud(dt);
  }
  // --------------------------------------------------------------- update
  update(dt, time) {
    const { input, motor, pos, world } = this;
    const cfg = this.store.get().settings;
    const look = input.takeLook(dt);
    this.camYaw -= look.x * 0.0026 * cfg.sensitivity;
    this.camPitch = clamp(this.camPitch + look.y * 0.0023 * cfg.sensitivity * (cfg.invertY ? -1 : 1), -0.6, 1.4);
    if (input.take('equip')) this.toggleEquip();
    if (input.take('swing')) this.swing();
    if (input.take('respawn')) this.respawn();
    if (input.take('scuba')) this.toggleScuba();
    if (input.take('board')) this.toggleVehicle();
    if (input.take('drive')) this.toggleCar();
    if (input.take('tool')) this.swapTool();
    if (!this.vehicle && input.take('lights')) this.toggleHeadlamp();
    { // headlamp battery: drains while on, recharges while off (slowly in the dark)
      const depthNow = Math.max(0, waterLevelAt(pos.x, pos.z) - pos.y);
      const r = stepLamp(this.lamp, dt, { dark: this.underground || (this.diving && depthNow > 6) });
      this.lamp = r.lamp;
      if (r.event === 'low') notify(this.store, 'Headlamp battery low', 'warn');
      if (r.event === 'flat') { notify(this.store, 'Headlamp battery flat', 'warn'); this.char.setLamp?.(false); }
    }
    if (input.take('droneOff') && this.drone) this.exitDrone();
    this.lookT = Math.abs(look.x) + Math.abs(look.y) > 0.5 ? 0 : this.lookT + dt;
    if (this.drone) return this.updateDrone(dt);
    if (this.car) return this.updateCar(dt);
    if (this.vehicle) return this.updateVehicle(dt);
    input.take('ballast'); input.take('lights'); input.take('sonar');

    this.underground = insideCave(world.caves, pos.x, pos.z, pos.y) > 0;
    const level = waterLevelAt(pos.x, pos.z);
    const bedY = world.physics.col.groundY(pos.x, pos.z, pos.y + 0.6, motor.body) ?? -Infinity;
    this.water = waterState({ feetY: pos.y, level, bedY, prev: this.water, wantDown: input.held('descend') });
    const wading = this.water === 'wading', diving = this.water === 'dive';
    this.swimming = this.water === 'surface' || diving;
    this.diving = diving;

    // intent -> velocity
    const mv = this.move();
    const dir = moveVector(mv, this.camYaw);
    const sprint = input.sprint() && Math.hypot(mv.x, mv.y) > 0.5;
    let speed = speedFor({ sprint, swimming: this.swimming, wading, swinging: this.char.swingT >= 0 });
    if (diving) speed = DIVE_SPEED * (this.scuba ? 1.15 : 1);
    const k = 1 - Math.exp(-(motor.grounded || this.swimming ? 16 : 5) * dt);
    this.vx = lerp(this.vx, dir.x * speed, k);
    this.vz = lerp(this.vz, dir.z * speed, k);
    const hs = Math.hypot(this.vx, this.vz);
    if (Math.hypot(dir.x, dir.z) > 0.05 && this.char.swingT < 0) this.facing = lerpAngle(this.facing, Math.atan2(dir.x, dir.z), 1 - Math.exp(-14 * dt));

    const jump = input.take('jump');
    const step = { vx: this.vx, vz: this.vz, jump };
    if (diving) {
      // swim where the camera looks (W while looking down dives), plus Space / C for straight up / down
      const heave = (input.held('ascend') ? 1 : 0) - (input.held('descend') ? 1 : 0);
      step.dive = { vy: clamp(-Math.sin(this.camPitch) * mv.y * speed + heave * 2.0, -3, 3) };
    } else if (this.water === 'surface') step.swimY = level - 1.05 + Math.sin(time * 2.3) * 0.05;
    motor.step(dt, step);
    const r = Math.hypot(pos.x, pos.z);
    if (r > WORLD_R + 4) motor.teleport(pos.x * (WORLD_R + 4) / r, pos.y, pos.z * (WORLD_R + 4) / r);
    if (pos.y < -60) this.respawn();

    this.updateBreath(dt, level);

    if ((wading || this.water === 'surface') && hs > 1.5 && (this.splashT -= dt) <= 0) {
      this.splashT = 0.14;
      world.particles.burst(pos.x, level + 0.05, pos.z, 0xcfeaff, 3, 1.6, 2.4);
    }
    if (diving && this.scuba && (this.bubbleT -= dt) <= 0) {
      this.bubbleT = 0.9;
      this.bubbles.burst(pos.x, pos.y + 1.55, pos.z, 0xffffff, 4, 0.4, 0.8);
    }

    this.visY = pos.y > this.visY ? damp(this.visY, pos.y, 28, dt) : pos.y;
    this.char.root.position.set(pos.x, this.visY, pos.z);
    this.char.root.rotation.y = this.facing;
    this.char.update(dt, { speed: hs, grounded: motor.grounded, vy: motor.vy, swimming: this.swimming });
    this.updateCamera(dt);
    this.state = diving ? 'DIVING' : this.water === 'surface' ? 'SWIMMING' : wading ? 'WADING' : !motor.grounded ? 'AIRBORNE' : sprint && hs > 6 ? 'SPRINTING' : 'ON FOOT';
    this.updateHud(dt);
  }

  updateBreath(dt, level) {
    const near = Math.hypot(this.pos.x - DIVE.x, this.pos.z - DIVE.z) < 16 && this.water === 'dry';
    const res = stepBreath(this.breath, dt, { underwater: this.diving, depth: Math.max(0, level - this.pos.y), scuba: this.scuba, atBase: near });
    this.breath = res.state;
    if (res.event === 'low') notify(this.store, this.scuba ? 'Low tank pressure - surface now' : 'Low on breath - surface now', 'warn');
    if (res.event === 'blackout') {
      notify(this.store, 'You blacked out. The dive team recovered you at the base.', 'warn');
      this.breath = newBreath();
      const [tx, tz] = DIVE.toWater;
      this.teleport(DIVE.x + tx * 6, DIVE.z + tz * 6, Math.atan2(tx, tz));
    }
  }

  updateCamera(dt, vehicle = false) {
    const { pos, camera: cam, camTarget: t, motor } = this;
    if (!vehicle) { t.x = damp(t.x, pos.x, 16, dt); t.z = damp(t.z, pos.z, 16, dt); t.y = damp(t.y, this.visY + CAM_HEIGHT, 10, dt); }
    const cp = Math.cos(this.camPitch);
    const d = { x: Math.sin(this.camYaw) * cp, y: Math.sin(this.camPitch), z: Math.cos(this.camYaw) * cp };
    const hit = this.world.physics.col.cast(t.x, t.y, t.z, d.x, d.y, d.z, this.camDist + 0.4, vehicle ? this.world.sub.sub.body : motor.body);
    const want = hit === null ? this.camDist : clamp(hit - 0.5, 1.4, this.camDist);
    this.camNow = damp(this.camNow, want, want < this.camNow ? 22 : 4, dt);
    cam.position.set(t.x + d.x * this.camNow, t.y + d.y * this.camNow, t.z + d.z * this.camNow);
    if (!this.underground && !this.diving && !vehicle) cam.position.y = Math.max(cam.position.y, heightAt(cam.position.x, cam.position.z) + 0.35);
    cam.lookAt(t.x, t.y + 0.1, t.z);
    const fov = 60 + clamp((Math.hypot(this.vx, this.vz) - 5) * 1.6, 0, 7);
    this.fov = damp(this.fov, fov, 4, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }

  /** push readouts to the UI ~10x/s */
  updateHud(dt) {
    if ((this.hudT -= dt) > 0) return;
    this.hudT = 0.1;
    const { pos, world } = this;
    const name = this.underground ? (pos.y < -5 ? 'Sunken Grotto (Underwater)' : 'Ridge Mine (Underground)') : regionName(pos.x, pos.z);
    if (name !== this.region) {
      this.region = name;
      this.jungleW = regionWeights(pos.x, pos.z).jungle * (Math.hypot(pos.x, pos.z) > 40 ? 1 : 0);
      notify(this.store, name, 'zone');
    }
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    const near = !this.vehicle && world.ore.nearest(pos.x, pos.z, fx, fz, 4.2, pos.y);
    let hint = '';
    const sv = this.survey, nearDrone = !this.drone && !this.car && this.nearDrone();
    if (this.drone) hint = 'WASD FLY - SPACE / C ALTITUDE - SHIFT FAST - Z MAP - X SAVE ANOMALY - O DRONE OFF';
    else if (this.car === sv?.rover) hint = `SURVEY ROVER - TERRAIN ${sv.rover.terrain.label} - Z MAP - X SAVE - K EXIT`;
    else if (this.car) hint = 'SHIFT BOOST - SPACE BRAKE - K EXIT';
    else if (this.vehicle) hint = 'B BALLAST - L LIGHTS - N SONAR - E SAMPLE - V EXIT';
    else if (nearDrone) hint = nearDrone.sensor ? 'K LAUNCH DRONE' : 'U MOUNT A SENSOR ON THE DRONE';
    else if (!this.vehicle && this.nearCar()) hint = `K DRIVE ${this.nearCar().spec.name.toUpperCase()}`;
    else if (this.nearSub()) hint = 'V BOARD SUBMARINE';
    else if (!this.lamp.on && (this.underground || (this.diving && Math.max(0, waterLevelAt(pos.x, pos.z) - pos.y) > 6))) hint = 'L - SWITCH ON HEADLAMP';
    else if (near) hint = this.equipped && this.char.tool !== 'sensor' ? 'ROCK OUTCROP - SWING THE PICKAXE TO BREAK IT OPEN' : 'ROCK OUTCROP - EQUIP THE PICKAXE (F) TO BREAK IT OPEN'; // (it looks like any rock: what is in it shows when it breaks)
    else {
      // standing on the selected saved location: say which tool the survey's depth estimate calls for
      const tw = sv?.target ? sv.waypoints.find((q) => q.id === sv.target) : null;
      const here = tw && !tw.confirmed && (tw.layer ?? 'surface') === sv.layerNow() && Math.hypot(tw.x - pos.x, tw.z - pos.z) < 6;
      const pick = this.equipped && this.char.tool !== 'sensor';
      if (here && (tw.layer ?? 'surface') === 'surface' && tw.depth != null && tw.depth > sv.handDepth) {
        hint = sv.exc.busy ? `EXCAVATOR ${sv.exc.state === 'digging' ? 'DIGGING' : sv.exc.state === 'done' ? 'DONE - COLLECT THE ORE' : 'ON ITS WAY'}` : `AT TARGET - EST. ${tw.depth.toFixed(1)} M DOWN: TOO DEEP FOR A PICKAXE - Y CALLS THE EXCAVATOR`;
      } else if (here) hint = pick ? 'AT TARGET - SWING THE PICKAXE TO DIG' : 'AT TARGET - Q / F FOR THE PICKAXE, THEN DIG';
      else if (this.equipped && this.char.tool === 'sensor') hint = 'SURVEYING - Z MAP - X SAVE ANOMALY - E MARK HERE - Q PICKAXE';
    }
    const level = waterLevelAt(pos.x, pos.z), submerged = this.water === 'surface' || this.water === 'dive' || this.vehicle;
    let dive = null;
    if (this.vehicle) {
      const s = this.vehicle.sub;
      const vy = s.body.linvel().y, d = s.depth();
      const status = d < 0.9 ? 'SURFACED' : this.holdY !== null && Math.abs(vy) < 0.3 ? 'HOLDING DEPTH' : vy < -0.25 ? 'DIVING' : vy > 0.25 ? 'RISING' : 'SUBMERGED';
      dive = { mode: 'sub', depth: d, atm: ambientAtm(d), speed: s.speed(), battery: s.battery, trim: this.ballastMode === 'trim', lights: this.vehicle.lights, ballastMode: this.ballastMode, tank: this.ballast, status, heading: bearingDeg(s.heading()), sonar: this.sonarOn };
    } else if (submerged) {
      const depth = Math.max(0, level - pos.y);
      dive = { mode: this.scuba ? 'scuba' : 'breath', depth, atm: ambientAtm(depth), air: this.breath.air / BREATH_SECONDS, tank: this.breath.tank, airSec: this.breath.air };
    }
    this.store.set({ lamp: { on: this.lamp.on, battery: this.lamp.battery }, region: name, heading: bearingDeg(this.camYaw), x: pos.x, z: pos.z, elev: pos.y, speed: Math.hypot(this.vx, this.vz), state: this.state, hint, dive, scuba: this.scuba, sonar: this.vehicle && this.sonarOn ? { range: SONAR_RANGE, heading: this.vehicle.sub.heading(), contacts: sonarContacts(world.ore.nodes, this.vehicle.sub.pos, this.vehicle.sub.heading(), waterLevelAt(this.vehicle.sub.pos.x, this.vehicle.sub.pos.z)) } : null, drive: this.car ? { name: this.car.spec.name, speed: Math.abs(this.car.speed), top: this.car.spec.top, boostTop: this.car.spec.boost, boost: this.car.boost, boosting: this.car.boosting } : null });
  }
}
