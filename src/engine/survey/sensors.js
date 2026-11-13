/**
 * The seven geophysical instruments. Each one measures a DIFFERENT physical property (see geology.js), has its own
 * footprint, investigation depth, survey speed, accuracy, data rate, battery drain and colour scale.
 *
 *  footprint  ground radius (m) one reading represents, per platform (airborne grows with altitude)
 *  depth      effective investigation depth (m)
 *  speed      ideal survey speed on foot (m/s); going much faster degrades the data
 *  accuracy / sensitivity   0..1 (accuracy: low noise; sensitivity: how small an anomaly it can resolve)
 *  rate       readings per second       drain  battery % per minute
 *  noise      1-sigma reading noise per channel, in the channel's unit
 */
export const SENSOR_IDS = ['gpr', 'mag', 'gamma', 'emi', 'res', 'ip', 'seis'];

export const SENSORS = {
  gpr: {
    id: 'gpr', name: 'Ground Penetrating Radar', short: 'GPR', css: '#f0a030', color: 0xf0a030,
    channels: [{ id: 'refl', label: 'REFLECTION STRENGTH', unit: 'rel.', mode: 'lin', digits: 2 }], noise: { refl: 0.035 },
    desc: 'Sends radar pulses into the ground and records the echoes. Shows layers, cavities, buried objects, fractures and geological boundaries as a radargram.',
    detects: ['Subsurface layers & boundaries', 'Cavities and voids', 'Buried objects', 'Fractures', 'Shallow mineral-bearing structures'],
    footprint: { hand: 1.6, rover: 2.0, drone: 3.0 }, depth: 5, speed: 1.4, accuracy: 0.85, sensitivity: 0.8, rate: 10, drain: 4.5, product: 'RADARGRAM',
  },
  mag: {
    id: 'mag', name: 'Magnetometer', short: 'MAG', css: '#4aa3ff', color: 0x4aa3ff,
    channels: [{ id: 'tmi', label: 'TOTAL MAGNETIC INTENSITY', unit: 'nT', mode: 'asinh', digits: 0 }], noise: { tmi: 3.0 },
    desc: 'Measures small changes in the Earth\'s magnetic field caused by magnetic minerals. Finds magnetite and iron-bearing rock, and the host structures of copper, nickel and cobalt mineralisation.',
    detects: ['Magnetite & iron-bearing rock', 'Mafic dykes and structures', 'Ni-Co sulphide hosts', 'Skarn / copper-associated rocks'],
    footprint: { hand: 2.4, rover: 3.0, drone: 5.0 }, depth: 25, speed: 1.8, accuracy: 0.9, sensitivity: 0.85, rate: 10, drain: 2.2, product: 'TMI MAP',
  },
  gamma: {
    id: 'gamma', name: 'Gamma Ray Spectrometer', short: 'GRS', css: '#c8e04a', color: 0xc8e04a,
    channels: [
      { id: 'K', label: 'POTASSIUM', unit: '% K', mode: 'lin', digits: 2 },
      { id: 'U', label: 'URANIUM', unit: 'ppm eU', mode: 'lin', digits: 1 },
      { id: 'Th', label: 'THORIUM', unit: 'ppm eTh', mode: 'lin', digits: 1 },
    ], noise: { K: 0.1, U: 0.35, Th: 0.8 },
    desc: 'Counts gamma rays from natural potassium, uranium and thorium in the top half metre of ground. Separate K, U and Th channels plus a ternary composite. Blind to anything deeper.',
    detects: ['Potassium (K) alteration / granite', 'Uranium (U) mineralisation', 'Thorium (Th) enrichment', 'Radioactive REE-bearing rocks'],
    footprint: { hand: 3.0, rover: 3.5, drone: 6.0 }, depth: 0.5, speed: 1.2, accuracy: 0.7, sensitivity: 0.75, rate: 4, drain: 3.0, product: 'RADIOMETRIC MAP',
  },
  emi: {
    id: 'emi', name: 'Electromagnetic Induction (EMI)', short: 'EMI', css: '#38d6b0', color: 0x38d6b0,
    channels: [{ id: 'ec', label: 'APPARENT CONDUCTIVITY', unit: 'mS/m', mode: 'asinh', digits: 1 }], noise: { ec: 0.8 },
    desc: 'Induces currents in the ground and measures how well it conducts. Finds conductive mineralisation, metallic objects, clay and saline water without touching the soil.',
    detects: ['Conductive sulphide / graphite bodies', 'Metallic objects', 'Clay and saline zones', 'Mineralised shear zones'],
    footprint: { hand: 2.6, rover: 3.2, drone: 6.0 }, depth: 6, speed: 1.6, accuracy: 0.8, sensitivity: 0.8, rate: 8, drain: 3.4, product: 'CONDUCTIVITY MAP',
  },
  res: {
    id: 'res', name: 'Electrical Resistivity', short: 'ERT', css: '#ff7a3a', color: 0xff7a3a,
    channels: [{ id: 'rho', label: 'APPARENT RESISTIVITY', unit: 'ohm.m', mode: 'log', digits: 0 }], noise: { rho: 0.05 },
    desc: 'Pushes current through electrodes and measures resistance. Separates rock types, weathered zones, fractures and groundwater, and flags conductive mineralisation. Slow, but deep.',
    detects: ['Rock type contrasts', 'Weathered zones & fractures', 'Groundwater', 'Conductive mineralisation', 'Silicified / resistive bodies'],
    footprint: { hand: 3.4, rover: 3.8, drone: 0 }, depth: 15, speed: 0.7, accuracy: 0.85, sensitivity: 0.7, rate: 2, drain: 5.0, product: 'RESISTIVITY SECTION', noDrone: true,
  },
  ip: {
    id: 'ip', name: 'Induced Polarisation (IP)', short: 'IP', css: '#b36bff', color: 0xb36bff,
    channels: [{ id: 'chg', label: 'CHARGEABILITY', unit: 'mV/V', mode: 'asinh', digits: 1 }], noise: { chg: 0.3 },
    desc: 'Measures how the ground stores electrical charge. Disseminated sulphide minerals, the classic copper porphyry signature, light up strongly even when they are not very conductive.',
    detects: ['Disseminated sulphides (copper)', 'Graphite', 'Clay (weak, a false target)', 'Porphyry-style mineralisation'],
    footprint: { hand: 3.4, rover: 3.8, drone: 0 }, depth: 12, speed: 0.7, accuracy: 0.75, sensitivity: 0.85, rate: 2, drain: 5.5, product: 'CHARGEABILITY MAP', noDrone: true,
  },
  seis: {
    id: 'seis', name: 'Seismic Sensor', short: 'SEIS', css: '#ff5a5a', color: 0xff5a5a,
    channels: [{ id: 'vp', label: 'BEDROCK VELOCITY', unit: 'm/s', mode: 'lin', digits: 0 }], noise: { vp: 60 },
    desc: 'Listens to sound waves travelling through the ground. Maps soil thickness, depth to bedrock, fractures and rock stiffness as a velocity section.',
    detects: ['Layer thicknesses', 'Depth to bedrock', 'Fractures & faults', 'Rock stiffness (velocity)'],
    footprint: { hand: 4.2, rover: 4.6, drone: 0 }, depth: 30, speed: 0.6, accuracy: 0.8, sensitivity: 0.55, rate: 1.5, drain: 3.8, product: 'VELOCITY SECTION', noDrone: true,
  },
};

export const MODES = {
  hand: { id: 'hand', label: 'HAND MOUNTED', short: 'HAND', desc: 'Carry it. Walk any route; readings are logged as you move.', height: 1.0, speedMul: 1, quality: 1, drainMul: 1 },
  rover: { id: 'rover', label: 'ROVER MOUNTED', short: 'ROVER', desc: 'Drive a survey rover. Faster, continuous lines. Rough ground slows it, steep or wet ground stops it.', height: 0.7, speedMul: 4.5, quality: 1.15, drainMul: 0.8 },
  drone: { id: 'drone', label: 'DRONE MOUNTED', short: 'DRONE', desc: 'Fly it. Fastest coverage, wide footprint, but blurrier and weaker at height.', height: 12, speedMul: 7, quality: 0.8, drainMul: 0.6 },
};

/** footprint radius (m) of one reading for a platform at height h (m above ground) */
export function footprint(sensor, mode, h = 0) {
  const base = SENSORS[sensor].footprint[mode] || SENSORS[sensor].footprint.hand;
  return mode === 'drone' ? base + h * 0.35 : base;
}

/** colour ramps: [t, r, g, b] stops, t in 0..1 */
const RAMPS = {
  // the magnetometer scale asked for: blue (low) - green (background) - yellow - orange - red (strong)
  mag: [[0, 20, 40, 190], [0.18, 40, 120, 235], [0.36, 40, 190, 190], [0.5, 60, 190, 80], [0.64, 235, 225, 50], [0.8, 245, 140, 30], [1, 215, 25, 25]],
  turbo: [[0, 48, 18, 59], [0.12, 70, 100, 230], [0.28, 30, 190, 220], [0.45, 60, 220, 110], [0.62, 200, 235, 50], [0.8, 250, 150, 40], [1, 180, 20, 20]],
  plasma: [[0, 13, 8, 135], [0.25, 106, 0, 168], [0.5, 204, 71, 120], [0.75, 248, 149, 64], [1, 240, 249, 33]],
  // resistivity: blue = conductive (low), red = resistive (high)
  rainbow: [[0, 20, 30, 170], [0.2, 30, 130, 240], [0.4, 40, 210, 190], [0.55, 110, 220, 70], [0.72, 245, 220, 50], [0.88, 240, 120, 30], [1, 160, 20, 30]],
  // seismic velocity: red = slow, blue = fast
  vel: [[0, 170, 20, 30], [0.2, 240, 110, 40], [0.4, 245, 220, 70], [0.6, 110, 215, 100], [0.8, 50, 150, 220], [1, 25, 40, 160]],
  hot: [[0, 8, 8, 12], [0.3, 110, 40, 20], [0.6, 235, 140, 30], [0.85, 255, 225, 120], [1, 255, 255, 245]],
  gray: [[0, 0, 0, 0], [1, 255, 255, 255]],
  radar: [[0, 0, 0, 0], [0.5, 128, 128, 128], [1, 255, 255, 255]],
};
const lutCache = {};
/** 256-entry RGB lookup table for a named ramp */
export function lut(name) {
  if (lutCache[name]) return lutCache[name];
  const s = RAMPS[name], out = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0; while (k < s.length - 2 && t > s[k + 1][0]) k++;
    const a = s[k], b = s[k + 1], u = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
    for (let c = 0; c < 3; c++) out[i * 3 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * u;
  }
  return (lutCache[name] = out);
}
export const RAMP_OF = { gpr: 'hot', mag: 'mag', gamma: 'turbo', emi: 'turbo', res: 'rainbow', ip: 'plasma', seis: 'vel' };

const ASINH_MAX = Math.asinh(18);
/**
 * value -> 0..1 colour position. `st` = {bg, sd} are the robust background / spread of the survey so far.
 * 'log' channels (resistivity) are stored as log10 values, so they are linear here.
 */
export function norm01(ch, v, st) {
  if (ch.mode === 'log') return Math.min(1, Math.max(0, 0.5 + (v - st.bg) / 1.4));
  if (ch.mode === 'asinh') return Math.min(1, Math.max(0, 0.5 + 0.5 * Math.asinh((v - st.bg) / (2.2 * st.sd)) / ASINH_MAX * 1.35));
  return Math.min(1, Math.max(0, 0.5 + (v - st.bg) / (8 * st.sd)));
}
/** inverse of norm01 (for legend ticks) */
export function denorm(ch, t, st) {
  if (ch.mode === 'log') return st.bg + (t - 0.5) * 1.4;
  if (ch.mode === 'asinh') return st.bg + 2.2 * st.sd * Math.sinh(((t - 0.5) * 2 * ASINH_MAX) / 1.35);
  return st.bg + (t - 0.5) * 8 * st.sd;
}
/** a channel value as text in its own unit (log channels are stored as log10) */
export function fmtValue(ch, v) {
  if (!Number.isFinite(v)) return '--';
  const x = ch.mode === 'log' ? Math.pow(10, v) : v;
  return x.toFixed(Math.abs(x) >= 1000 ? 0 : ch.digits);
}
