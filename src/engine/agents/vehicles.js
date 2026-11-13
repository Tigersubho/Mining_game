import { buildFleet } from './fleet.js';
import { Follower } from './follower.js';
import { SPECS, stepDrive } from './drive.js';
import { createVehicleModel, MODEL_COLORS } from './vehicleModels.js';
import { loadGLB } from '../world/assets.js';
import { heightAt, waterLevelAt } from '../world/terrain.js';
import { bridgeDeckY } from '../world/layout.js';
import { wetAt, planCrossing } from './safety.js';
import { WATER_Y, WORLD_R } from '../config.js';
import { damp, clamp } from '../math.js';

/** where the car is and which way it points: the midpoint and direction of its front and rear axles on the route (so it never sits angled across a bend) */
function pose(v) {
  const f = v.follower;
  if (!v.spec) return f.pose();
  const half = v.spec.len * 0.3, a = f.path.sample(f.s + half), b = f.path.sample(f.s - half);
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, h: Math.atan2(a.x - b.x, a.z - b.z) };
}

const PARK_TIME = 8; // seconds a car you left stays where you parked it before driving back to its route
const angleDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

/**
 * All road vehicles + the boat. Each follows a closed loop forever (no spawning, no vanishing), stopping at its stops
 * with the doors open (atStop) so NPCs can get on and off. The player can take the wheel of any road vehicle:
 *   mode 'auto' (AI on its route) -> 'driven' (you) -> 'parked' (waits PARK_TIME) -> 'return' (drives back) -> 'auto'
 */
export function createFleet({ scene, world, propMat }) {
  const defs = buildFleet();
  const vehicles = defs.map((d, i) => {
    const kind = d.kind === 'gmc' ? 'pickup' : d.kind;
    const mesh = createVehicleModel(kind, propMat, { color: d.kind === 'gmc' ? 0x1b1d20 : MODEL_COLORS[i % MODEL_COLORS.length] });
    mesh.userData.fleetId = d.id;
    if (d.kind !== 'boat') mesh.scale.setScalar(0.94); // very slightly smaller
    scene.add(mesh);
    const follower = new Follower(d.path, { vmax: d.vmax, stops: d.stops, phase: d.phase });
    const p = pose({ follower, spec: SPECS[d.kind] });
    return {
      id: d.id, kind: d.kind, category: d.category, seats: d.seats, stopIds: d.stops.map((s) => s.id), passengers: [],
      spec: SPECS[d.kind] ?? null, follower, mesh, x: p.x, z: p.z, y: bridgeDeckY(p.x, p.z) ?? heightAt(p.x, p.z), h: p.h, pitch: 0, roll: 0,
      mode: 'auto', speed: 0, boost: 1, boosting: false, timer: 0, stuck: 0, relocations: 0,
      way: [], rec: { stuck: 0, phase: null, t: 0, tries: 0, free: 0, cool: 0, dir: 1 }, // way: bridge waypoints on the trip home; rec: stuck-recovery state
      get atStop() { return this.mode === 'auto' && this.follower.state === 'dwell' ? this.follower.atStop : null; },
    };
  });

  const col = world.physics.col;
  const api = { observer: null }; // observer: the player's position {x, z}, so recovered cars never pop into view
  // never snap more than a ramp's rise above where we are (a probe that starts inside a building would hit its roof)
const ground = (x, z, hint) => { const y = col.surfaceY(x, z, hint + 2.5); return y === null || y > hint + 1.4 ? Math.min(heightAt(x, z), hint + 1.4) : y; };

  /** one driving step for a vehicle that is not on rails; returns true when it ran into something */
  function drive(v, ctl, dt) {
    const sp = v.spec, s = stepDrive({ v: v.speed, h: v.h, boost: v.boost }, sp, ctl, dt);
    let move = s.v * dt, blocked = false;
    const fx = Math.sin(s.h), fz = Math.cos(s.h);
    if (Math.abs(move) > 1e-4) {
      const dir = Math.sign(move), reach = Math.abs(move) + sp.len / 2;
      const slope = clamp(-v.pitch, -0.7, 0.7), cs = Math.cos(slope), sn = Math.sin(slope) * dir; // probe along the slope so hills can be climbed
      const hit = col.cast(v.x, v.y + 0.9, v.z, fx * dir * cs, sn, fz * dir * cs, reach + 0.3);
      const nx = v.x + fx * dir * reach, nz = v.z + fz * dir * reach;
      const wet = waterLevelAt(nx, nz) - ground(nx, nz, v.y) > 0.5;
      const edge = Math.hypot(nx, nz) > WORLD_R;
      blocked = hit !== null && hit < reach || wet || edge;
    }
    if (blocked) { s.v = -s.v * 0.2; move = 0; }
    v.speed = s.v; v.h = s.h; v.boost = s.boost; v.boosting = s.boosting;
    v.x += fx * move; v.z += fz * move;
    return blocked;
  }

  const resetRec = (v) => { v.rec.stuck = 0; v.rec.phase = null; v.rec.t = 0; v.rec.tries = 0; v.rec.free = 0; v.rec.cool = 0; };
  function board(v) {
    v.mode = 'driven'; v.boost = 1; v.stuck = 0; v.way = [];
    if (v.follower) { v.speed = v.follower.state === 'dwell' ? 0 : v.follower.v; resetRec(v); } // (the survey rover is not on a route)
    else v.speed = 0;
  }
  function release(v) { v.mode = 'parked'; v.timer = PARK_TIME; v.boosting = false; }
  /** the nearest road vehicle within `reach` metres (the player's K key) */
  function nearest(x, y, z, reach = 6) {
    let best = null, bd = reach;
    for (const v of vehicles) {
      if (!v.spec || v.mode === 'driven' || Math.abs(v.y - y) > 4) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  function rejoin(v) {
    const f = v.follower, s = f.path.nearestS(v.x, v.z);
    f.resume(s, Math.abs(v.speed)); const p = pose(v); v.x = p.x; v.z = p.z; v.h = p.h; v.mode = 'auto'; v.speed = 0; v.way = []; resetRec(v);
  }

  /**
   * Last resort for a car that cannot free itself (or ended up in water): put it back on its own route somewhere else -
   * on dry road, away from the player's eyes and from other cars. It carries on from there in automatic mode.
   */
  function relocate(v) {
    const f = v.follower, path = f.path, here = v.mode === 'auto' ? f.s : path.nearestS(v.x, v.z), ob = api.observer;
    let best = null, fallback = null;
    for (let k = 0; k < 40 && best === null; k++) {
      const s = path.wrap(here + 30 + k * 13), q = path.sample(s);
      if (wetAt(q.x, q.z)) continue;
      fallback ??= s;
      if (ob && Math.hypot(q.x - ob.x, q.z - ob.z) < 50) continue; // not in front of the player
      if (vehicles.some((o) => o !== v && o.spec && Math.hypot(o.x - q.x, o.z - q.z) < 9)) continue;
      best = s;
    }
    f.resume(best ?? fallback ?? here, 0);
    const p = pose(v);
    v.x = p.x; v.z = p.z; v.h = p.h; v.y = bridgeDeckY(p.x, p.z) ?? heightAt(p.x, p.z); v.pitch = v.roll = 0;
    v.mode = 'auto'; v.speed = 0; v.way = []; v.timer = 0; v.stuck = 0; resetRec(v);
    v.relocations++;
  }

  /** a bridge-aware trip back to the route: through the nearest bridge when water is in the way */
  function startReturn(v) {
    const f = v.follower, q = f.path.sample(f.path.nearestS(v.x, v.z));
    v.way = planCrossing(v.x, v.z, q.x, q.z).map(([x, z]) => ({ x, z }));
    v.stuck = 0; resetRec(v);
  }

  function steerHome(v, dt) {
    const f = v.follower, s = f.path.nearestS(v.x, v.z), q = f.path.sample(s);
    v.timer += dt;
    while (v.way.length && Math.hypot(v.way[0].x - v.x, v.way[0].z - v.z) < 6) v.way.shift();
    const t = v.way.length ? v.way[0] : f.path.sample(s + 10);
    const d = Math.hypot(q.x - v.x, q.z - v.z), err = angleDiff(Math.atan2(t.x - v.x, t.z - v.z), v.h);
    if (!v.way.length && d < 2.5 && Math.abs(angleDiff(q.h, v.h)) < 0.9) return rejoin(v);
    if (v.timer > 90) return relocate(v);
    const r = v.rec;
    let ctl;
    if (r.phase === 'reverse') { // free yourself: back up with the wheel turned
      r.t -= dt; ctl = { throttle: -0.85, steer: r.dir * 0.9, boost: false, brake: false };
      if (r.t <= 0) { r.phase = null; r.stuck = 0; }
    } else ctl = { throttle: Math.abs(err) > 1.2 ? 0.35 : v.speed < v.spec.cruise ? 0.8 : 0, steer: clamp(-err * 1.6, -1, 1), boost: false, brake: false };
    const blocked = drive(v, ctl, dt);
    if (r.phase === 'reverse') return;
    // stuck = pressed against something, or hardly moving while asked to drive
    r.stuck = blocked || (Math.abs(v.speed) < 0.4 && ctl.throttle > 0.3) ? r.stuck + dt : Math.max(0, r.stuck - dt * 2);
    if (r.stuck > 1.6) {
      if (++r.tries > 2) return relocate(v); // reversing did not help: put it somewhere else on its route
      r.phase = 'reverse'; r.t = 1.7; r.dir = Math.random() < 0.5 ? -1 : 1; r.stuck = 0;
    }
  }

  /**
   * A route-follower never drives through solid things: it brakes in front of them. If it stays blocked it backs up along
   * its route and tries again; after three failed attempts it is put somewhere else on its route (relocate).
   * Returns true when the car must not advance this frame.
   */
  function guardAuto(v, dt) {
    const f = v.follower, r = v.rec;
    if (r.phase === 'reverse') {
      r.t -= dt; f.s = f.path.wrap(f.s - 3 * dt); f.v = 0;
      if (r.t <= 0) { r.phase = null; r.stuck = 0; }
      return true;
    }
    if (f.state !== 'drive') { r.stuck = 0; return false; }
    // only movable things count (the player, crates, barrels, cones): a route may brush past fixed scenery, but a car never drives through something that can be in its way
    const reach = v.spec.len / 2 + 0.9;
    const hit = col.castMovable(v.x, v.y + 0.9, v.z, Math.sin(v.h), 0, Math.cos(v.h), reach + 0.3);
    if (hit === null || hit >= reach) {
      r.stuck = Math.max(0, r.stuck - dt * 2);
      r.free += f.v * dt; if (r.free > 60) { r.tries = 0; r.free = 0; }
      return false;
    }
    f.v = 0; // brake
    const ob = api.observer;
    if (ob && Math.hypot(ob.x - v.x, ob.z - v.z) < reach + 4) return true; // it is the player in the way: just wait
    r.stuck += dt;
    if (r.stuck > 1.4) {
      if (++r.tries > 2) { relocate(v); return true; }
      r.phase = 'reverse'; r.t = 1.8; r.stuck = 0;
    }
    return true;
  }

  function update(dt) {
    for (const v of vehicles) {
      if (v.mode === 'parked') {
        drive(v, { throttle: 0, steer: 0, boost: false, brake: true }, dt);
        if ((v.timer -= dt) <= 0) { v.mode = 'return'; v.timer = 0; startReturn(v); }
      } else if (v.mode === 'return') steerHome(v, dt);
      else if (v.mode === 'auto') {
        const held = v.spec ? guardAuto(v, dt) : false;
        if (!held) v.follower.step(dt);
        const p = pose(v);
        v.x = p.x; v.z = p.z; v.h = p.h;
      }
      if (v.kind === 'boat') {
        const t = performance.now() * 0.001;
        v.y = WATER_Y - 0.3 + Math.sin(t * 1.3) * 0.05; v.pitch = Math.sin(t * 0.9) * 0.015;
      } else {
        if (v.mode !== 'driven' && wetAt(v.x, v.z)) relocate(v); // never sit in water: back onto dry road at once
        const sx = Math.sin(v.h), cz = Math.cos(v.h), L = (v.spec?.len ?? 4.6) * 0.33, W = 0.9;
        // on its route a car follows the road: the bridge deck on a bridge, else the bare terrain (so it can never climb onto a roof or awning); driven cars use the full collision surface
        const gy = v.mode === 'auto' ? (x, z) => bridgeDeckY(x, z) ?? heightAt(x, z) : (x, z) => ground(x, z, v.y);
        const yf = gy(v.x + sx * L, v.z + cz * L), yr = gy(v.x - sx * L, v.z - cz * L);
        const yl = gy(v.x + cz * W, v.z - sx * W), yR = gy(v.x - cz * W, v.z + sx * W); // left / right of the car
        v.y = damp(v.y, (yf + yr + yl + yR) / 4, 12, dt);
        v.pitch = damp(v.pitch, -Math.atan2(yf - yr, 2 * L), 10, dt); v.roll = damp(v.roll, Math.atan2(yl - yR, 2 * W), 10, dt);
      }
      v.mesh.position.set(v.x, v.y, v.z);
      v.mesh.rotation.set(v.pitch, v.h, v.roll, 'YXZ');
    }
  }

  /** swap a vehicle's stand-in body for a .glb (the front is found / told so the car drives forwards along its road) */
  async function loadModel(url, fit, front, pick, flip = false) {
    try {
      const model = await loadGLB({ url, fit, front, flip });
      for (const v of vehicles.filter(pick)) { v.mesh.clear(); v.mesh.add(model.clone(true)); }
    } catch (e) { console.warn(`${url} unavailable, keeping the stand-ins:`, e?.message); }
  }
  const loadGmc = () => loadModel('/models/gmc_sierra_hd2500.glb', { length: 5.9 }, 'auto', (v) => v.kind === 'gmc');
  const loadJeep = () => loadModel('/models/jeep.glb', { length: 3.9 }, '+z', (v) => v.kind === 'jeep');
  const loadJcb = () => loadModel('/models/jcb.glb', { length: 6.0 }, 'auto', (v) => v.kind === 'jcb', true); // the backhoe end is the rear: the loader bucket leads
  const loadTruck = () => loadModel('/models/truck1.glb', { length: 8.5 }, 'auto', (v) => v.kind === 'pickup');
  const loadTaxi = () => loadModel('/models/taxi.glb', { length: 4.9 }, '+x', (v) => v.kind === 'taxi');
  return Object.assign(api, { vehicles, update, loadGmc, loadTaxi, loadJeep, loadJcb, loadTruck, drive, board, release, nearest, relocate, byId: (id) => vehicles.find((v) => v.id === id), road: vehicles.filter((v) => v.kind !== 'boat') });
}