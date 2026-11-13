import * as THREE from 'three';

/**
 * Low-poly survey hardware: the seven hand instruments (each a distinct silhouette + colour so they read at a
 * glance), the survey rover and the drone. Plain flat-shaded primitives, no textures.
 * Hand models are built around the grip at the origin (the character's hand), pointing forward (+Z).
 */
const matCache = new Map();
const M = (color, o = {}) => {
  const k = `${color}|${o.metal ?? 0}|${o.emissive ?? 0}|${o.opacity ?? 1}`;
  if (!matCache.has(k)) {
    matCache.set(k, new THREE.MeshStandardMaterial({
      color, flatShading: true, roughness: o.rough ?? 0.6, metalness: o.metal ?? 0.1,
      emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissive ? 0.9 : 0,
      transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1, depthWrite: (o.opacity ?? 1) >= 1,
    }));
  }
  return matCache.get(k);
};
const add = (g, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m;
};
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0, r1, h, n = 8) => new THREE.CylinderGeometry(r0, r1, h, n);
const STEEL = 0x9aa2aa, DARK = 0x22262b, SCREEN = 0x5fe0c0;

function screen(g, x, y, z, ry = 0) { add(g, box(0.12, 0.08, 0.02), M(SCREEN, { emissive: SCREEN }), x, y, z, 0, ry); }

const HAND = {
  // GPR: an orange antenna sled on a handle, pushed along the ground
  gpr() {
    const g = new THREE.Group();
    add(g, cyl(0.02, 0.02, 1.0, 6), M(DARK), 0, -0.38, 0.32, -0.95);
    add(g, box(0.46, 0.13, 0.36), M(0xf0a030), 0, -0.78, 0.62);
    add(g, box(0.4, 0.03, 0.3), M(DARK), 0, -0.86, 0.62);
    add(g, box(0.18, 0.12, 0.06), M(DARK), 0, 0.02, 0.06); screen(g, 0, 0.03, 0.095);
    return g;
  },
  // magnetometer: a tall staff with a white sensor bottle on top, kept away from the body
  mag() {
    const g = new THREE.Group();
    add(g, cyl(0.018, 0.018, 1.7, 6), M(0xd9dde2), 0, 0.3, 0.08);
    add(g, cyl(0.07, 0.07, 0.3, 10), M(0xf2f4f6), 0, 1.25, 0.08);
    add(g, cyl(0.075, 0.075, 0.05, 10), M(0x4aa3ff), 0, 1.42, 0.08);
    add(g, box(0.2, 0.14, 0.07), M(0x2a4a7a), 0, -0.05, 0.1); screen(g, 0, -0.04, 0.14);
    return g;
  },
  // gamma spectrometer: a yellow box with the black crystal tube along the bottom and a carry handle
  gamma() {
    const g = new THREE.Group();
    add(g, box(0.16, 0.16, 0.42), M(0xe8c81a), 0, -0.12, 0.16);
    add(g, cyl(0.055, 0.055, 0.46, 10), M(DARK), 0, -0.24, 0.18, Math.PI / 2);
    add(g, box(0.04, 0.06, 0.26), M(DARK), 0, 0.0, 0.14);
    screen(g, 0, -0.06, 0.375);
    add(g, box(0.17, 0.02, 0.05), M(0x101010), 0, -0.12, 0.365); // the radiation trefoil band
    return g;
  },
  // EMI: a long white boom with green coil pods at both ends, carried level at hip height
  emi() {
    const g = new THREE.Group();
    add(g, cyl(0.035, 0.035, 1.5, 8), M(0xf0f2f2), 0, -0.22, 0.2, Math.PI / 2);
    add(g, cyl(0.07, 0.07, 0.14, 10), M(0x38d6b0), 0, -0.22, -0.52, Math.PI / 2);
    add(g, cyl(0.07, 0.07, 0.14, 10), M(0x38d6b0), 0, -0.22, 0.92, Math.PI / 2);
    add(g, box(0.05, 0.22, 0.05), M(DARK), 0, -0.1, 0.02);
    add(g, box(0.14, 0.1, 0.08), M(DARK), 0, -0.12, 0.22); screen(g, 0, -0.08, 0.27);
    return g;
  },
  // resistivity: an orange cable reel with steel electrode stakes
  res() {
    const g = new THREE.Group();
    add(g, cyl(0.17, 0.17, 0.12, 12), M(0xff7a3a), 0, -0.25, 0.12, 0, 0, Math.PI / 2);
    add(g, cyl(0.07, 0.07, 0.14, 10), M(0x3a3f45), 0, -0.25, 0.12, 0, 0, Math.PI / 2);
    for (const s of [-1, 1]) add(g, cyl(0.012, 0.004, 0.55, 5), M(STEEL, { metal: 0.8 }), s * 0.12, -0.38, 0.35, 0.3);
    add(g, box(0.04, 0.2, 0.04), M(DARK), 0, -0.05, 0.12);
    return g;
  },
  // IP: a purple transmitter box with a whip antenna and a copper porous-pot electrode
  ip() {
    const g = new THREE.Group();
    add(g, box(0.26, 0.18, 0.18), M(0x6a3ac0), 0, -0.14, 0.14);
    add(g, cyl(0.006, 0.006, 0.6, 4), M(DARK), 0.09, 0.2, 0.1);
    add(g, cyl(0.05, 0.035, 0.2, 8), M(0xc87533, { metal: 0.7 }), -0.06, -0.33, 0.3);
    screen(g, 0, -0.1, 0.235);
    add(g, box(0.04, 0.1, 0.04), M(DARK), 0, 0, 0.12);
    return g;
  },
  // seismic: a sledgehammer source with a red geophone spike hanging off it
  seis() {
    const g = new THREE.Group();
    add(g, cyl(0.022, 0.022, 0.9, 6), M(0x9a6a3a), 0, -0.3, 0.18, 0.55);
    add(g, box(0.12, 0.12, 0.26), M(0x2b2b2b, { metal: 0.6 }), 0, -0.68, 0.42, 0.55);
    add(g, cyl(0.045, 0.045, 0.06, 8), M(0xff4a4a), 0.14, -0.35, 0.05);
    add(g, cyl(0.008, 0.002, 0.12, 4), M(STEEL, { metal: 0.8 }), 0.14, -0.44, 0.05);
    return g;
  },
};

/** the hand-held version of a sensor */
export function createHandSensor(id) { const g = HAND[id](); g.userData.sensor = id; return g; }

/** a compact pod version of a sensor, for mounting on the rover boom or under the drone */
export function createSensorPod(id, color) {
  const g = new THREE.Group();
  const c = M(color);
  switch (id) {
    case 'mag': add(g, cyl(0.06, 0.06, 0.55, 10), M(0xf2f4f6), 0, 0, 0, Math.PI / 2); add(g, cyl(0.065, 0.065, 0.06, 10), c, 0, 0, 0.28, Math.PI / 2); break;
    case 'emi': add(g, cyl(0.035, 0.035, 1.1, 8), M(0xf0f2f2), 0, 0, 0, 0, 0, Math.PI / 2); for (const s of [-1, 1]) add(g, cyl(0.07, 0.07, 0.12, 10), c, s * 0.55, 0, 0, 0, 0, Math.PI / 2); break;
    case 'gamma': add(g, box(0.36, 0.16, 0.2), M(0xe8c81a)); add(g, cyl(0.05, 0.05, 0.4, 10), M(DARK), 0, -0.1, 0, 0, 0, Math.PI / 2); break;
    case 'gpr': add(g, box(0.5, 0.12, 0.38), c); add(g, box(0.44, 0.03, 0.32), M(DARK), 0, -0.07, 0); break;
    default: add(g, box(0.34, 0.2, 0.26), c); add(g, cyl(0.03, 0.03, 0.3, 6), M(STEEL, { metal: 0.8 }), 0, -0.22, 0); break;
  }
  return g;
}

/** the survey rover: a white four-wheeled buggy with a solar deck, a GNSS mast and a front sensor boom. Front is +Z. */
export function createRover() {
  const g = new THREE.Group(), body = new THREE.Group();
  g.add(body);
  add(body, box(1.5, 0.35, 2.4), M(0xe9ecef), 0, 0.75, 0);
  add(body, box(1.3, 0.3, 1.1), M(0xf28c28), 0, 1.07, -0.35);
  add(body, box(1.4, 0.04, 1.2), M(0x1f3a5a, { metal: 0.4 }), 0, 1.25, -0.35); // solar deck
  add(body, box(0.9, 0.25, 0.6), M(DARK), 0, 1.02, 0.65);
  add(body, cyl(0.025, 0.025, 1.1, 6), M(DARK), -0.55, 1.75, -0.8);
  add(body, cyl(0.12, 0.12, 0.05, 10), M(0xf2f4f6), -0.55, 2.3, -0.8); // GNSS antenna
  add(body, box(0.08, 0.08, 1.1), M(DARK), 0, 0.7, 1.65); // the sensor boom
  for (const [x, z] of [[-0.85, 0.85], [0.85, 0.85], [-0.85, -0.85], [0.85, -0.85]]) {
    add(g, cyl(0.38, 0.38, 0.3, 10), M(0x1d1f22), x, 0.38, z, 0, 0, Math.PI / 2);
    add(g, cyl(0.2, 0.2, 0.32, 8), M(0x8a9097, { metal: 0.6 }), x, 0.38, z, 0, 0, Math.PI / 2);
  }
  add(body, box(1.0, 0.06, 0.05), M(0xffd27a, { emissive: 0xffd27a }), 0, 0.85, 1.21); // light bar
  const mount = new THREE.Group(); mount.position.set(0, 0.45, 2.15); body.add(mount);
  g.userData.mount = mount;
  return g;
}

/** the survey drone: an X-frame quadcopter with skids and a sensor slung underneath. Front is +Z. */
export function createDrone() {
  const g = new THREE.Group(), frame = new THREE.Group();
  g.add(frame);
  add(frame, box(0.5, 0.16, 0.62), M(0x2b3138), 0, 0, 0);
  add(frame, box(0.32, 0.08, 0.3), M(0xf28c28), 0, 0.11, -0.05);
  add(frame, box(0.12, 0.08, 0.06), M(DARK), 0, -0.04, 0.33); // camera
  add(frame, box(0.05, 0.05, 0.02), M(0x9fd6ff, { emissive: 0x6fb6ff }), 0, -0.04, 0.365);
  const rotors = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const ax = sx * 0.62, az = sz * 0.62;
    add(frame, box(0.06, 0.05, 0.9), M(0x2b3138), ax / 2, 0, az / 2, 0, Math.atan2(ax, az));
    add(frame, cyl(0.07, 0.07, 0.12, 8), M(DARK), ax, 0.06, az);
    const rotor = new THREE.Group(); rotor.position.set(ax, 0.14, az); frame.add(rotor);
    add(rotor, box(0.62, 0.012, 0.05), M(0x15181b));
    add(rotor, cyl(0.33, 0.33, 0.01, 18), M(0xb8c4cc, { opacity: 0.18 }));
    add(frame, box(0.04, 0.03, 0.03), M(sz > 0 ? 0xff3b3b : 0x3bff6b, { emissive: sz > 0 ? 0xff3b3b : 0x3bff6b }), ax, 0.02, az + sz * 0.08);
    rotors.push(rotor);
  }
  for (const s of [-1, 1]) {
    add(frame, box(0.03, 0.03, 0.62), M(DARK), s * 0.24, -0.34, 0);
    add(frame, box(0.03, 0.26, 0.03), M(DARK), s * 0.24, -0.2, 0.18);
    add(frame, box(0.03, 0.26, 0.03), M(DARK), s * 0.24, -0.2, -0.18);
  }
  add(frame, cyl(0.006, 0.006, 0.3, 4), M(DARK), 0, -0.22, 0); // the sling
  const mount = new THREE.Group(); mount.position.set(0, -0.42, 0); frame.add(mount);
  g.userData.mount = mount; g.userData.rotors = rotors; g.userData.frame = frame;
  g.scale.setScalar(1.35);
  return g;
}

export function mountOn(mount, sensorId, color) { mount.clear(); if (sensorId) mount.add(createSensorPod(sensorId, color)); }

/**
 * The excavator you call for deep ore: yellow tracked body, a cab on a swing ring and a three-part arm (boom, stick, bucket) that
 * the Excavator class animates. Front is +Z. userData: { house (swing), boom, stick, bucket } are the pivots.
 */
export function createExcavator() {
  const g = new THREE.Group(), YEL = 0xf2b21c, DK = 0x24272b;
  for (const s of [-1, 1]) {
    add(g, box(0.95, 0.75, 4.3), M(DK), s * 1.35, 0.4, 0);
    add(g, box(1.0, 0.12, 4.0), M(YEL), s * 1.35, 0.82, 0);
    for (const z of [-1.7, 1.7]) add(g, cyl(0.42, 0.42, 1.0, 8), M(0x3a3e44), s * 1.35, 0.42, z, 0, 0, Math.PI / 2);
  }
  add(g, box(2.2, 0.35, 2.2), M(0x34383d), 0, 0.9, 0);
  const house = new THREE.Group(); house.position.set(0, 1.1, 0); g.add(house);
  add(house, box(2.9, 0.9, 3.4), M(YEL), 0, 0.35, -0.35);
  add(house, box(1.2, 1.25, 1.3), M(0x2f3338), 0, 0.9, -1.45); // engine hood
  add(house, box(1.7, 1.5, 1.5), M(YEL), -0.55, 1.35, 0.55); // cab
  add(house, box(1.5, 0.95, 0.06), M(0x6fb6d6, { opacity: 0.8 }), -0.55, 1.5, 1.32); // windscreen
  add(house, cyl(0.12, 0.12, 0.9, 6), M(DK), 0.9, 1.8, -1.5); // exhaust
  add(house, box(0.18, 0.14, 0.5), M(0xffd27a, { emissive: 0xffd27a }), -0.55, 2.2, 1.0); // beacon
  const boom = new THREE.Group(); boom.position.set(0.55, 0.55, 1.1); house.add(boom);
  add(boom, box(0.5, 0.55, 4.6), M(YEL), 0, 0.45, 2.2, -0.0);
  const stick = new THREE.Group(); stick.position.set(0, 0.7, 4.5); boom.add(stick);
  add(stick, box(0.38, 0.42, 3.0), M(0xe0a516), 0, -0.1, 1.3);
  const bucket = new THREE.Group(); bucket.position.set(0, -0.2, 2.8); stick.add(bucket);
  // a backhoe bucket: the teeth point back TOWARDS the machine (it digs by pulling soil in), the closed back is on the far side
  add(bucket, box(1.3, 0.14, 1.1), M(0x4a4e54), 0, -0.45, -0.25);
  add(bucket, box(1.3, 0.8, 0.14), M(0x4a4e54), 0, -0.1, 0.3);
  for (const s of [-1, 1]) add(bucket, box(0.12, 0.7, 1.0), M(0x4a4e54), s * 0.62, -0.15, -0.1);
  for (let k = -2; k <= 2; k++) add(bucket, box(0.1, 0.18, 0.2), M(0x9aa0a6, { metal: 0.7 }), k * 0.26, -0.5, -0.8); // teeth
  add(bucket, box(1.1, 0.5, 0.9), M(0x5a4330), 0, -0.18, -0.2).name = 'load'; // the soil in the bucket (shown while it carries a load)
  g.userData = { house, boom, stick, bucket, load: bucket.getObjectByName('load') };
  g.scale.setScalar(0.95);
  return g;
}
