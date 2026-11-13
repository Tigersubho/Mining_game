import * as THREE from 'three';
import { getGeology, HAND_DEPTH } from './geology.js';
import { Excavator } from './excavator.js';
import { SENSORS, SENSOR_IDS, MODES, footprint, fmtValue } from './sensors.js';
import { Channel, TILE_M } from './grid.js';
import { detect, interpret, intensityOf, describe } from './analysis.js';
import { Rover, Drone } from './platforms.js';
import { createHandSensor } from './models.js';
import { DEPOSIT_MINERALS } from './minerals.js';
import { heightAt, waterLevelAt } from '../world/terrain.js';
import { TERRAIN_SIZE, WORLD_R } from '../config.js';
import { W_MIN } from './grid.js';
import { notify } from '../../ui/store.js';

const gauss = () => { let u = 0; while (!u) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); };
const brg = (dx, dz) => ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
const MAP_PX = 512; // coverage layer resolution (matches the site map canvases)
const toPx = (v) => ((v + TERRAIN_SIZE / 2) / TERRAIN_SIZE) * MAP_PX;
const ALERT_SECONDS = 16, ALERT_MIN = 28, ANALYSE_EVERY = 0.8;

/**
 * The geophysical survey system: instrument + platform configuration, data collection georeferenced to the
 * player / rover / drone, the interpolated grids, anomaly picking, saved locations, navigation targets and
 * excavation. Everything the HUD shows is pushed to the store as `survey` (~6x/s); the maps paint straight from
 * this object (render.js).
 */
export function createSurvey({ scene, world, store, player }) {
  const geo = getGeology(), col = world.physics.col;
  const S = {
    geo, store, player, world,
    sensor: null, mode: 'hand', tool: 'pick',
    channels: new Map(), battery: Object.fromEntries(SENSOR_IDS.map((id) => [id, 100])),
    tracks: [], track: null, recent: [], pts: {}, anomalies: [], waypoints: [], excavations: [], finds: [],
    target: null, alert: null, carrier: null, collecting: false, status: 'NO SENSOR', quality: 1, signal: 0, zNow: 0, last: null,
    nextId: 1, acc: 0, lastRead: null, sinceRead: 0, analyseT: 0, pubT: 0, version: 0, time: 0, droneCtl: null,
  };
  S.rover = new Rover(scene, col, geo);
  S.exc = new Excavator(scene, world.particles);
  S.layer = 'surface';
  S.handDepth = HAND_DEPTH; // how deep a pickaxe reaches (deeper ore needs the excavator)
  S.drone = new Drone(scene, col);
  if (typeof document !== 'undefined') { S.cov = document.createElement('canvas'); S.cov.width = S.cov.height = MAP_PX; }
  const handModels = {};
  const beacons = new THREE.Group(); scene.add(beacons);
  const pulse = new THREE.Mesh(new THREE.RingGeometry(2.2, 3, 32), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
  pulse.rotation.x = -Math.PI / 2; pulse.visible = false; scene.add(pulse);

  // ---------------------------------------------------------------- data channels
  /** data is kept per layer (surface / cave0 / cave1 / water) so a cave survey never mixes into the hill above it */
  S.lk = (sensor) => (S.layer === 'surface' ? sensor : `${S.layer}.${sensor}`);
  S.chan = (sensor, ch) => {
    const k = `${S.layer === 'surface' ? '' : S.layer + ':'}${sensor}.${ch}`;
    if (!S.channels.has(k)) S.channels.set(k, new Channel(sensor, ch));
    return S.channels.get(k);
  };
  S.primary = (sensor = S.sensor) => (sensor ? S.chan(sensor, SENSORS[sensor].channels[sensor === 'gamma' ? 2 : 0].id) : null);
  S.stats = (sensor, ch) => S.chan(sensor, ch).refreshStats(SENSORS[sensor].noise[ch]);

  // ---------------------------------------------------------------- configuration
  S.canMount = (sensor, mode) => !(mode === 'drone' && SENSORS[sensor].noDrone);

  /** fit `sensor` to `mode` (from the equipment menu) */
  S.deploy = (sensor, mode) => {
    const sd = SENSORS[sensor];
    if (!S.canMount(sensor, mode)) { notify(store, `${sd.short} needs ground contact: it cannot fly on the drone`, 'warn'); return false; }
    if (player.drone && mode !== 'drone') player.exitDrone(true);
    S.sensor = sensor; S.mode = mode; S.recent = []; S.lastRead = null;
    const p = player.pos, fx = Math.sin(player.facing), fz = Math.cos(player.facing);
    const spot = (d) => { let x = p.x + fx * d, z = p.z + fz * d; if (heightAt(x, z) < waterLevelAt(x, z) + 0.3) { x = p.x; z = p.z; } return [x, z]; };
    if (mode === 'hand') {
      handModels[sensor] ??= createHandSensor(sensor);
      player.char.setSensorModel?.(handModels[sensor]);
      player.setTool('sensor', true);
      notify(store, `${sd.name} in hand. Walk to survey - Z map - X save - Q swap to pickaxe`, 'info');
    } else {
      player.char.setSensorModel?.(null);
      player.setTool('pick', false);
      const plat = mode === 'rover' ? S.rover : S.drone;
      const busy = mode === 'rover' ? player.car === S.rover : player.drone;
      if (!busy && (!plat.deployed || Math.hypot(plat.x - p.x, plat.z - p.z) > 15)) {
        const [x, z] = spot(mode === 'rover' ? 4 : 3.5);
        if (mode === 'rover') S.rover.place(x, z, player.facing); else S.drone.place(x, z, player.facing);
      }
      plat.mount(sensor);
      notify(store, mode === 'rover' ? `${sd.short} mounted on the survey rover. Walk up and press K to drive it` : `${sd.short} slung under the drone. Walk up and press K to launch`, 'info');
    }
    publish(true);
    return true;
  };
  S.recallDrone = () => { if (!S.drone.deployed) return; if (player.drone) player.exitDrone(true); S.drone.recall(player.pos.x, player.pos.z); notify(store, 'Drone returning to you', 'info'); };

  // ---------------------------------------------------------------- collection
  /** which hidden layer the player is in: the rock of cave 0 / 1, the lake-river-pit beds (diving), or the open surface */
  function layerNow() {
    const p = player.pos;
    for (let i = 0; i < world.caves.length; i++) { const c = world.caves[i]; if (p.y >= c.floorY - 1 && p.y <= c.floorY + c.height + 1 && c.open(p.x, p.z)) return `cave${i}`; }
    return player.water === 'dive' ? 'water' : 'surface';
  }
  S.layerNow = layerNow;
  /** the solid floor of a layer at (x, z): the cave floor, the lake / river / pit bed, or the ground */
  const floorOf = (layer, x, z) => (layer.startsWith('cave') ? world.caves[+layer.slice(4)].floorY : heightAt(x, z));

  function carrier() {
    if (!S.sensor) return null;
    if (S.mode === 'hand') {
      if (S.tool !== 'sensor' || !player.equipped || player.car || player.vehicle || player.drone || (player.swimming && !player.diving)) return null;
      const lay = layerNow(), up = lay === 'surface' ? 0 : Math.max(0, player.pos.y - floorOf(lay, player.pos.x, player.pos.z)); // a diver above the bed holds the sensor further from the rock
      return { x: player.pos.x, z: player.pos.z, h: MODES.hand.height + up, speed: Math.hypot(player.vx, player.vz), kind: 'hand' };
    }
    if (S.mode === 'rover') return player.car === S.rover && S.rover.sensor === S.sensor ? { x: S.rover.x, z: S.rover.z, h: MODES.rover.height, speed: Math.abs(S.rover.speed), kind: 'rover' } : null;
    const d = S.drone;
    return d.possessed && d.state === 'flying' && d.sensor === S.sensor ? { x: d.x, z: d.z, h: Math.max(0.5, d.agl), speed: Math.hypot(d.vx, d.vz), kind: 'drone' } : null;
  }

  /** where the "you are here" arrow goes on the survey map: the drone, the car / rover, or the player */
  S.pose = () => {
    if (player.drone) return { x: S.drone.x, z: S.drone.z, h: S.drone.yaw };
    if (player.car) return { x: player.car.x, z: player.car.z, h: player.car.h };
    return { x: player.pos.x, z: player.pos.z, h: player.facing };
  };

  function reading(c, q) {
    const sd = SENSORS[S.sensor], md = MODES[S.mode], out = {};
    const raw = geo.measure(S.sensor, c.x, c.z, c.h, out), rad = footprint(S.sensor, S.mode, c.h);
    const nm = (1 / Math.max(0.2, q)) * (1.6 - 0.6 * sd.accuracy) * (S.mode === 'drone' ? 1.3 : 1);
    const values = {};
    let zMax = 0;
    for (const ch of sd.channels) {
      let v = S.sensor === 'gamma' ? out[ch.id] : raw;
      if (ch.mode === 'log') v = Math.log10(Math.max(0.1, v));
      v += sd.noise[ch.id] * nm * gauss() * (S.sensor === 'gamma' ? Math.sqrt(Math.max(0.3, v) / 2) : 1);
      values[ch.id] = v;
      const chan = S.chan(S.sensor, ch.id);
      chan.splat(c.x, c.z, v, rad, q * md.quality);
      const st = chan.stats;
      if (st.n) zMax = Math.max(zMax, Math.abs(v - st.bg) / (st.sd || 1));
    }
    S.zNow = zMax; S.signal = Math.min(1, zMax / 14);
    S.last = { values, x: c.x, z: c.z, h: c.h };
    const pk = S.lk(S.sensor);
    (S.pts[pk] ??= []).push(c.x, c.z);
    if (S.pts[pk].length > 60000) S.pts[pk].splice(0, 20000);
    if (S.recent.length && (S.recent[0].sensor !== S.sensor || S.recent[0].layer !== S.layer)) S.recent = []; // the line profile belongs to one instrument
    const prev = S.recent[S.recent.length - 1], step = prev ? Math.hypot(c.x - prev.x, c.z - prev.z) : 0;
    if (!prev || step > 0.3) {
      S.recent.push({ sensor: S.sensor, layer: S.layer, x: c.x, z: c.z, s: (prev?.s ?? 0) + step, h: c.h, v: values });
      while (S.recent.length > 2 && S.recent[S.recent.length - 1].s - S.recent[0].s > 140) S.recent.shift();
    }
    if (S.cov) { const g = S.cov.getContext('2d'); g.fillStyle = sd.css + '55'; const r = Math.max(1.2, (rad / TERRAIN_SIZE) * MAP_PX * 1.6); g.fillRect(toPx(c.x) - r / 2, toPx(c.z) - r / 2, r, r); }
    S.version++;
  }

  function collect(c, dt) {
    const sd = SENSORS[S.sensor], md = MODES[S.mode];
    const ideal = sd.speed * md.speedMul;
    const q = c.speed <= ideal * 1.5 ? 1 : Math.max(0.2, (ideal * 1.5) / c.speed);
    S.quality = q;
    S.status = S.battery[S.sensor] <= 0 ? 'BATTERY FLAT' : q < 0.6 ? 'TOO FAST - DATA DEGRADED' : 'COLLECTING';
    if (S.battery[S.sensor] <= 0) { S.collecting = false; return; }
    S.collecting = true;
    S.battery[S.sensor] = Math.max(0, S.battery[S.sensor] - (sd.drain / 60) * md.drainMul * dt);
    S.acc += dt * sd.rate; S.sinceRead += dt;
    let n = 0;
    while (S.acc >= 1 && n < 4) {
      S.acc -= 1;
      const moved = S.lastRead ? Math.hypot(c.x - S.lastRead[0], c.z - S.lastRead[1]) : 99;
      if (moved < 0.3 && S.sinceRead < 1.5) continue; // standing still: don't stack hundreds of readings on one spot
      reading(c, q); S.lastRead = [c.x, c.z]; S.sinceRead = 0; n++;
    }
    // the survey track (a polyline per sensor / platform run)
    const tr = S.track;
    if (!tr || tr.sensor !== S.sensor || tr.mode !== S.mode || tr.layer !== S.layer) { S.track = { sensor: S.sensor, mode: S.mode, layer: S.layer, pts: [c.x, c.z] }; S.tracks.push(S.track); }
    else {
      const L = tr.pts.length, d = Math.hypot(c.x - tr.pts[L - 2], c.z - tr.pts[L - 1]);
      if (d > 1.2) {
        if (d > 30) { S.track = { sensor: S.sensor, mode: S.mode, layer: S.layer, pts: [c.x, c.z] }; S.tracks.push(S.track); }
        else {
          if (S.cov) { const g = S.cov.getContext('2d'); g.strokeStyle = sd.css; g.lineWidth = 1; g.beginPath(); g.moveTo(toPx(tr.pts[L - 2]), toPx(tr.pts[L - 1])); g.lineTo(toPx(c.x), toPx(c.z)); g.stroke(); }
          tr.pts.push(c.x, c.z);
        }
      }
    }
  }

  // ---------------------------------------------------------------- anomalies
  function analyse() {
    if (!S.sensor) return;
    for (const ch of SENSORS[S.sensor].channels) {
      const chan = S.chan(S.sensor, ch.id), st = chan.refreshStats(SENSORS[S.sensor].noise[ch.id]);
      for (const d of detect(chan, st)) merge(d);
    }
    for (const w of S.waypoints) if (!w.manual && w.layer === S.layer) Object.assign(w, pick(interpret(S.anomalies, w.x, w.z, 28, w.layer)));
  }
  const pick = (it) => ({ title: it.title, text: it.text, confidence: it.confidence, sensors: it.sensors, targets: it.targets });

  function merge(d) {
    const ex = S.anomalies.find((a) => a.layer === S.layer && a.sensor === d.sensor && a.ch === d.ch && a.sign === d.sign && Math.hypot(a.x - d.x, a.z - d.z) < 14);
    const desc = describe(d.sensor, d.ch, d.sign, d.zscore, d.elong);
    if (ex) {
      if (d.zscore >= ex.zscore * 0.85) Object.assign(ex, { x: d.x, z: d.z, peak: d.peak, area: Math.max(ex.area, d.area), elong: d.elong, depth: d.depth });
      ex.zscore = Math.max(ex.zscore, d.zscore); ex.intensity = intensityOf(ex.zscore); Object.assign(ex, desc);
      return;
    }
    const a = { id: S.nextId++, ...d, ...desc, layer: S.layer, intensity: intensityOf(d.zscore), mode: S.mode, time: S.time, saved: false };
    S.anomalies.push(a);
    if (a.intensity >= ALERT_MIN && (!S.alert || a.intensity > S.alert.intensity)) {
      S.alert = { id: a.id, t: ALERT_SECONDS };
      notify(store, `${a.title} (${a.intensity}%)`, 'warn');
    }
  }

  S.skipAlert = () => { S.alert = null; publish(true); };
  // ---------------------------------------------------------------- how much of each layer is mapped, per sensor (the world coverage map)
  const areas = {};
  /** area (m2) of ground that can be surveyed in a layer: dry land, the floor of a cave, or the beds under water */
  S.areaOf = (layer) => {
    if (areas[layer] !== undefined) return areas[layer];
    let a = 0;
    if (layer.startsWith('cave')) { for (const r of world.caves[+layer.slice(4)].floors) a += 4 * r.hx * r.hz; }
    else for (let x = -WORLD_R + 6; x < WORLD_R; x += 12) for (let z = -WORLD_R + 6; z < WORLD_R; z += 12) {
      if (Math.hypot(x, z) > WORLD_R - 30) continue;
      const h = heightAt(x, z), w = waterLevelAt(x, z);
      if (layer === 'water' ? h < w - 1.0 : h >= w + 0.3) a += 144;
    }
    return (areas[layer] = a);
  };
  const covCache = { key: '', value: null };
  /** { area, sensors: { id: { m2, pct } }, union: { m2, pct } } for a layer (cached until the data changes) */
  S.coverage = (layer) => {
    const key = `${layer}:${S.version}`;
    if (covCache.key === key) return covCache.value;
    const area = S.areaOf(layer), prefix = layer === 'surface' ? '' : `${layer}:`, masks = new Map(), sensors = {};
    for (const id of SENSOR_IDS) {
      const chan = S.channels.get(`${prefix}${id}.${SENSORS[id].channels[id === 'gamma' ? 2 : 0].id}`);
      let m2 = 0;
      if (chan) for (const t of chan.tiles.values()) {
        m2 += t.covered * 4;
        const k = t.tx * 65536 + t.tz; let m = masks.get(k); if (!m) masks.set(k, (m = new Uint8Array(t.ws.length)));
        for (let i = 0; i < m.length; i++) if (t.ws[i] >= W_MIN) m[i] = 1;
      }
      sensors[id] = { m2, pct: area ? (100 * m2) / area : 0 };
    }
    let u = 0; for (const m of masks.values()) for (let i = 0; i < m.length; i++) u += m[i] * 4;
    covCache.key = key; covCache.value = { area, sensors, union: { m2: u, pct: area ? (100 * u) / area : 0 } };
    return covCache.value;
  };

  /** the minerals have shifted: every reading, anomaly and saved location describes ground that no longer holds them */
  S.onReshuffle = () => {
    S.channels.clear(); S.anomalies = []; S.tracks = []; S.track = null; S.recent = []; S.pts = {}; S.alert = null; S.last = null; S.lastRead = null;
    for (const w of S.waypoints) if (w.mesh) beacons.remove(w.mesh);
    S.waypoints = []; S.target = null;
    const keep = S.exc.busy ? S.exc.site : null; // (a job in progress finishes on the ore it was sent for)
    for (const e of S.excavations) if (e !== keep && e.mesh) scene.remove(e.mesh);
    S.excavations = keep ? [keep] : []; S.finds = [];
    if (S.cov) S.cov.getContext('2d').clearRect(0, 0, S.cov.width, S.cov.height);
    S.version++; publish(true);
  };
  /** X: save the alerted anomaly, else the nearest one, else drop a manual marker */
  S.saveAlert = () => {
    if (S.alert) return S.saveAnomaly(S.alert.id);
    const c = S.carrier ?? { x: player.pos.x, z: player.pos.z };
    const near = S.anomalies.filter((a) => a.layer === S.layer && !a.saved && Math.hypot(a.x - c.x, a.z - c.z) < 35).sort((a, b) => b.intensity - a.intensity)[0];
    if (near) return S.saveAnomaly(near.id);
    return S.addMarker(c.x, c.z);
  };
  S.saveAnomaly = (id) => {
    const a = S.anomalies.find((q) => q.id === id);
    if (!a) return null;
    if (S.alert?.id === id) S.alert = null;
    if (a.saved) { notify(store, 'Already saved', 'info'); return null; }
    a.saved = true;
    const w = { id: S.nextId++, anomalyId: a.id, layer: a.layer, x: a.x, z: a.z, sensor: a.sensor, ch: a.ch, intensity: a.intensity, depth: a.depth, peak: a.peak, mode: a.mode, time: S.time, confirmed: null, ...pick(interpret(S.anomalies, a.x, a.z, 28, a.layer)) };
    S.waypoints.push(w); beacon(w);
    if (!S.target) S.target = w.id;
    notify(store, `Location saved: ${w.title}`, 'ok');
    publish(true);
    return w;
  };
  S.addMarker = (x, z) => {
    const it = interpret(S.anomalies, x, z, 18, S.layer);
    const w = { id: S.nextId++, layer: S.layer, x, z, sensor: S.sensor, intensity: 0, depth: null, mode: S.mode, time: S.time, confirmed: null, manual: !it.count, ...(it.count ? pick(it) : { title: 'SURVEY MARKER', text: 'Manual marker', confidence: 0, sensors: [], targets: [] }) };
    S.waypoints.push(w); beacon(w);
    notify(store, 'Marker placed on the map', 'ok');
    publish(true);
    return w;
  };
  S.setTarget = (id) => { S.target = S.target === id ? null : id; publish(true); };
  S.removeWaypoint = (id) => {
    const i = S.waypoints.findIndex((w) => w.id === id); if (i < 0) return;
    const w = S.waypoints[i]; S.waypoints.splice(i, 1); if (w.mesh) beacons.remove(w.mesh);
    const a = S.anomalies.find((q) => q.id === w.anomalyId); if (a) a.saved = false;
    if (S.target === id) S.target = null;
    publish(true);
  };

  /** a low-poly survey stake with a flag in the sensor colour, so a saved spot can be found on the ground */
  function beacon(w) {
    const g = new THREE.Group(), col = new THREE.Color(w.sensor ? SENSORS[w.sensor].color : 0xffffff);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, flatShading: true }));
    pole.position.y = 1.2; g.add(pole);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.35, 0.6), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5, flatShading: true }));
    flag.position.set(0, 2.2, 0.3); g.add(flag);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.35, 24), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; g.add(ring);
    g.position.set(w.x, heightAt(w.x, w.z), w.z);
    beacons.add(g); w.mesh = g;
  }

  // ---------------------------------------------------------------- excavation
  const holeMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1, flatShading: true });
  const moundMat = new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 1, flatShading: true });
  const holeFor = (x, y, z, scale) => {
    const g = new THREE.Group();
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.7, 0.3, 9), holeMat); hole.position.y = -0.1; g.add(hole);
    const mound = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.28, 4, 10), moundMat); mound.rotation.x = Math.PI / 2; mound.position.y = 0.05; g.add(mound);
    g.position.set(x, y, z); g.scale.setScalar(scale); scene.add(g);
    return g;
  };
  const bodyIn = (x, z, layer) => geo.bodyAt(x, z, layer);
  const NO_MACHINE = 'An excavator cannot get into a cave or under water: dig that rock with the pickaxe';

  /**
   * A pickaxe blow that hit no rock lands here; returns true if it dug. A pickaxe only opens the top HAND_DEPTH (1.5 m): it finds what
   * lies within that and says NOTHING about what is deeper (only the sensors can tell you that). Deeper ore needs the excavator (Y).
   * Works in the caves and on the lake / river / pit beds too, where the ore sits just under the rock face.
   */
  S.dig = (x, z, feetY) => {
    const layer = layerNow(), gy = floorOf(layer, x, z);
    if (layer === 'surface' && gy < waterLevelAt(x, z) + 0.2) return false; // standing in the shallows: nothing to dig
    if (layer !== 'surface' && feetY - gy > 3) return false;                // swimming well above the bed
    let site = S.excavations.find((e) => !e.done && e.hand && e.layer === layer && Math.hypot(e.x - x, e.z - z) < 2.4);
    if (!site) {
      if (S.excavations.some((e) => e.done && e.layer === layer && Math.hypot(e.x - x, e.z - z) < 1.6)) { notify(store, 'Already dug here - try a little further along', 'info'); return true; }
      const body = bodyIn(x, z, layer), reach = !!body && body.depth <= HAND_DEPTH;
      site = { id: S.nextId++, x, z, y: gy, layer, hits: 0, need: reach ? 2 + Math.ceil(body.depth * 1.3) : 4, depth: reach ? body.depth : HAND_DEPTH, body: reach ? body : null, done: false, result: null, ok: false, hand: true };
      site.mesh = holeFor(x, gy, z, 0.35);
      S.excavations.push(site);
    }
    site.hits++;
    world.particles.burst(x, gy + 0.15, z, 0x5a4330, 9, 3.2, 3.8);
    site.mesh.scale.setScalar(0.35 + 0.65 * Math.min(1, site.hits / site.need));
    if (site.hits >= site.need) finish(site);
    else notify(store, `Digging ${site.hits}/${site.need} - ${(site.depth * site.hits / site.need).toFixed(1)} m down`, 'info');
    publish(true);
    return true;
  };

  /**
   * Y: call an excavator to the selected target (or a given saved location, or the spot just ahead of you). It drives in from the yard,
   * scoops the soil out (about 15-40 s, longer the deeper it goes) and leaves whatever is down there exposed for you to collect.
   */
  S.callExcavator = (w = null) => {
    if (S.exc.busy) return notify(store, 'The excavator is already on a job', 'warn');
    const tw = w ?? S.waypoints.find((q) => q.id === S.target);
    if (tw ? (tw.layer ?? 'surface') !== 'surface' : layerNow() !== 'surface') return notify(store, NO_MACHINE, 'warn');
    const x = tw ? tw.x : player.pos.x + Math.sin(player.facing) * 6, z = tw ? tw.z : player.pos.z + Math.cos(player.facing) * 6;
    const gy = heightAt(x, z);
    if (gy < waterLevelAt(x, z) + 0.4) return notify(store, 'That spot is under water: the excavator only works on dry land', 'warn');
    if (S.excavations.some((e) => e.done && e.machine && Math.hypot(e.x - x, e.z - z) < 4)) return notify(store, 'The excavator has already opened this spot', 'warn');
    const body = bodyIn(x, z, 'surface');
    const site = { id: S.nextId++, x, z, y: gy, layer: 'surface', hits: 0, need: 1, depth: body ? body.depth : 4, body, done: false, result: null, ok: false, machine: true };
    site.mesh = holeFor(x, gy, z, 0.5); S.excavations.push(site);
    const eta = S.exc.call(site);
    notify(store, `Excavator dispatched from the yard: about ${Math.round(eta)} s to open the ground`, 'ok');
    publish(true);
    return site;
  };

  function finish(site) {
    site.done = true;
    const b = site.body;
    const near = S.waypoints.filter((w) => (w.layer ?? 'surface') === site.layer && Math.hypot(w.x - site.x, w.z - site.z) < 22);
    if (b && b.kind === 'deposit' && b.remaining > 0) {
      const amt = Math.min(b.remaining, 2 + Math.round(b.grade * 4 + b.R / 6));
      b.remaining -= amt;
      world.ore.add(site.x, site.z, b.type, site.y - 0.25, amt);
      site.result = b.type; site.ok = true;
      S.finds.push({ id: S.nextId++, x: site.x, z: site.z, type: b.type, amount: amt, grade: b.grade, host: b.label });
      near.forEach((w) => { w.confirmed = b.type; });
      notify(store, `MINERAL CONFIRMED: ${DEPOSIT_MINERALS[b.type].name} in ${b.label}. Grade ${Math.round(b.grade * 100)}%, ${amt} units exposed - swing to collect`, 'ok');
    } else if (b && b.kind === 'deposit') {
      site.result = 'exhausted'; notify(store, 'This part of the deposit is worked out. Try elsewhere on the anomaly.', 'warn');
    } else if (b) {
      site.result = 'barren'; near.forEach((w) => { w.confirmed = 'barren'; });
      notify(store, `No ore: ${b.label}. The anomaly was real, the mineral was not.`, 'warn');
    } else if (site.hand) { // (the same words whether or not something lies deeper: a pickaxe pit tells you nothing about that)
      site.result = 'shallow'; notify(store, `Nothing within reach of a pickaxe (${HAND_DEPTH} m). If your survey puts a target deeper here, call the excavator (Y)`, 'warn');
    } else {
      site.result = 'barren'; near.forEach((w) => { w.confirmed = 'barren'; });
      notify(store, 'Barren ground: soil and weathered rock all the way down.', 'warn');
    }
  }

  // ---------------------------------------------------------------- input + per-frame update
  S.ui = (patch) => { store.set(patch); };
  S.input = (input) => {
    const st = store.get();
    if (input.take('surveyMenu')) store.set({ surveyMenu: !st.surveyMenu, surveyMap: false });
    if (input.take('surveyMap')) store.set({ surveyMap: !st.surveyMap, surveyMenu: false });
    if (input.take('closeUi') && (st.surveyMenu || st.surveyMap)) store.set({ surveyMenu: false, surveyMap: false });
    if (input.take('saveAnom')) S.saveAlert();
    if (input.take('skipAnom') && S.alert) S.skipAlert();
    if (input.take('callExc')) S.callExcavator();
  };

  S.update = (dt) => {
    S.time += dt;
    S.drone.update(dt, S.droneCtl, { x: player.pos.x, z: player.pos.z }); S.droneCtl = null;
    const ev = S.exc.update(dt), es = S.exc.site;
    if (ev === 'dug') { es.done = false; finish(es); notify(store, 'Excavator finished: the ground is open - walk up and collect', 'ok'); }
    if (ev === 'gone') notify(store, 'The excavator has left the site', 'info');
    if (S.exc.state === 'digging' && es?.mesh) es.mesh.scale.setScalar(0.5 + 2.0 * S.exc.progress);
    S.rover.mode = player.car === S.rover ? 'driven' : 'parked';
    S.rover.update(dt);
    S.layer = S.mode === 'hand' && !player.car && !player.drone ? layerNow() : 'surface';
    geo.layer = S.layer;
    const c = S.carrier = carrier();
    if (c) collect(c, dt);
    else {
      S.collecting = false; S.signal *= Math.exp(-dt * 2);
      S.status = !S.sensor ? 'NO SENSOR' : S.mode === 'hand' ? (S.tool === 'sensor' && player.equipped ? 'PAUSED' : 'STOWED') : S.mode === 'rover' ? 'ROVER PARKED' : 'DRONE ON STANDBY';
      for (const id of SENSOR_IDS) S.battery[id] = Math.min(100, S.battery[id] + dt * 0.5);
    }
    if ((S.analyseT -= dt) <= 0) { S.analyseT = ANALYSE_EVERY; analyse(); }
    if (S.alert && (S.alert.t -= dt) <= 0) S.alert = null;
    const al = S.alert && S.anomalies.find((a) => a.id === S.alert.id);
    pulse.visible = !!al;
    if (al) { const k = (S.time * 0.8) % 1; pulse.position.set(al.x, heightAt(al.x, al.z) + 0.15, al.z); pulse.scale.setScalar(1 + k * 3); pulse.material.opacity = 0.7 * (1 - k); }
    for (const w of S.waypoints) if (w.mesh) w.mesh.children[1].rotation.y = Math.sin(S.time * 2 + w.id) * 0.4;
    if ((S.pubT -= dt) <= 0) publish();
  };

  // ---------------------------------------------------------------- store snapshot for the HUD
  function publish(force = false) {
    S.pubT = 0.16;
    const p = player.pos, sd = S.sensor && SENSORS[S.sensor];
    const c = S.carrier ?? (S.mode === 'drone' && player.drone ? { x: S.drone.x, z: S.drone.z } : { x: p.x, z: p.z });
    let coverage = 0, area = 0, value = null;
    if (sd) {
      const pc = S.primary(), tx = Math.floor(c.x / TILE_M), tz = Math.floor(c.z / TILE_M);
      coverage = pc.coverage(tx, tz); area = pc.measuredArea();
      if (S.last) value = sd.channels.map((ch) => `${fmtValue(ch, S.last.values[ch.id])} ${ch.unit}`).join('  ');
    }
    const tw = S.waypoints.find((w) => w.id === S.target);
    const al = S.alert && S.anomalies.find((a) => a.id === S.alert.id);
    const wp = (w) => ({ id: w.id, layer: w.layer ?? 'surface', machine: (w.layer ?? 'surface') === 'surface' && w.depth != null && w.depth > HAND_DEPTH, x: w.x, z: w.z, sensor: w.sensor, title: w.title, text: w.text, intensity: w.intensity, depth: w.depth, confidence: w.confidence, sensors: w.sensors, targets: w.targets, confirmed: w.confirmed, dist: Math.hypot(w.x - p.x, w.z - p.z), bearing: brg(w.x - p.x, w.z - p.z) });
    store.set({
      survey: {
        sensor: S.sensor, mode: S.mode, tool: S.tool, layer: S.layer, collecting: S.collecting, status: S.status, quality: S.quality, signal: S.signal, z: S.zNow, value,
        coverage, area, anomalies: S.anomalies.length, battery: S.sensor ? S.battery[S.sensor] : 100, batteries: { ...S.battery },
        drone: S.drone.deployed ? { active: !!player.drone, state: S.drone.state, battery: S.drone.battery, alt: S.drone.agl, speed: Math.hypot(S.drone.vx, S.drone.vz), sensor: S.drone.sensor, dist: Math.hypot(S.drone.x - p.x, S.drone.z - p.z) } : null,
        rover: S.rover.deployed ? { driving: player.car === S.rover, terrain: S.rover.terrain.label, factor: S.rover.terrain.f, sensor: S.rover.sensor, dist: Math.hypot(S.rover.x - p.x, S.rover.z - p.z) } : null,
        alert: al ? { id: al.id, title: al.title, text: al.text, intensity: al.intensity, x: al.x, z: al.z, sensor: al.sensor, depth: al.depth, t: S.alert.t, dist: Math.hypot(al.x - c.x, al.z - c.z) } : null,
        target: tw ? wp(tw) : null,
        waypoints: S.waypoints.map(wp),
        list: S.anomalies.slice().sort((a, b) => b.intensity - a.intensity).slice(0, 60).map((a) => ({ id: a.id, layer: a.layer, sensor: a.sensor, ch: a.ch, title: a.title, intensity: a.intensity, depth: a.depth, saved: a.saved, x: a.x, z: a.z, dist: Math.hypot(a.x - p.x, a.z - p.z) })),
        finds: S.finds.length, digs: S.excavations.length,
        excavator: S.exc.busy ? { state: S.exc.state, progress: S.exc.progress, eta: Math.max(0, S.exc.eta - S.exc.t - (S.exc.state === 'mobilising' ? 0 : 6)) } : null,
      },
    });
    if (force) S.version++;
  }
  publish(true);
  return S;
}
