import { CELL, TILE } from './grid.js';
import { SENSORS } from './sensors.js';

/**
 * Anomaly picking on the interpolated survey grids, and the interpretation that combines several instruments.
 * Works only from MEASURED data (never from the hidden geology), so what the player sees is what they surveyed.
 */
const Z_PICK = 4.0;      // robust z-score (of the residual) a cell must reach to belong to an anomaly
const MIN_CELLS = 6;      // at least 24 m2 above threshold
const MIN_SUPPORT = 3;    // ... and backed by at least this many readings near its peak

/** which polarities count as anomalous for each sensor / channel */
const SIGNS = { mag: [1], gpr: [1], emi: [1], ip: [1], res: [-1, 1], seis: [-1, 1], gamma: [1] };

/** headline + meaning of a single-instrument anomaly */
const STRONG = 15; // residual z-score of a "strong" anomaly
export function describe(sensor, ch, sign, strength, elong) {
  const strong = strength >= STRONG;
  switch (sensor) {
    case 'mag': return elong > 3
      ? { title: 'LINEAR MAGNETIC ANOMALY', text: 'Long and narrow: typical of a dyke or a magnetic contact. Often barren.' }
      : strong ? { title: 'STRONG MAGNETIC ANOMALY', text: 'Possible magnetite or iron-bearing mineralisation.' }
        : { title: 'MAGNETIC ANOMALY', text: 'Iron-bearing rock; possible host to Cu, Ni or Co mineralisation.' };
    case 'gamma': return ch === 'K' ? { title: 'ELEVATED POTASSIUM RESPONSE', text: 'Potassic alteration (porphyry halo) or K-rich granite / pegmatite.' }
      : ch === 'U' ? { title: 'ELEVATED URANIUM RESPONSE', text: 'Possible uranium mineralisation, or U in phosphates / black shale.' }
        : { title: 'ELEVATED THORIUM RESPONSE', text: 'Monazite / thorite: thorium, laterite or REE-bearing rock.' };
    case 'emi': return { title: 'HIGH CONDUCTIVITY ZONE', text: 'Conductive sulphide or graphite, metal, clay or saline water.' };
    case 'ip': return { title: 'HIGH CHARGEABILITY ANOMALY', text: 'Disseminated sulphides (possible copper) or graphite. Clay gives weak false positives.' };
    case 'res': return sign < 0 ? { title: 'LOW RESISTIVITY ZONE', text: 'Conductive mineralisation, clay, a wet fracture or groundwater.' } : { title: 'RESISTIVE BODY', text: 'Silicified rock, quartz veins, pegmatite or an air-filled void.' };
    case 'seis': return sign < 0 ? { title: 'LOW-VELOCITY ZONE', text: 'Fractured or weathered rock, a fault or a cavity.' } : { title: 'HIGH-VELOCITY BODY', text: 'Dense competent rock: an intrusion or massive mineralisation.' };
    default: return { title: 'SUBSURFACE STRUCTURAL ANOMALY', text: 'Strong radar reflector: buried body, cavity, boulders or a layer boundary.' };
  }
}

/**
 * Scan the dirty tiles of a channel for anomalies. Like real processing, a REGIONAL field (a broad moving average of
 * the gridded data) is removed first, and anomalies are picked on the RESIDUAL in units of its robust spread, so a
 * slow change of rock type across the block does not hide (or fake) a local anomaly. Returns raw detections:
 * { sensor, ch, sign, x, z, peak, zscore, area, elong, depth, support }
 */
export function detect(chan, stats, margin = 16) {
  const out = [], sensor = chan.sensor;
  const tiles = chan.takeDirty();
  if (!stats.n || stats.n < 40) return out;
  const fp = SENSORS[sensor], noise = fp.noise[chan.ch] ?? 1, RR = sensor === 'mag' ? 20 : 12;
  for (const t of tiles) {
    if (!t) continue;
    const i0 = t.tx * TILE - margin, j0 = t.tz * TILE - margin, N = TILE + 2 * margin;
    const vals = new Float32Array(N * N).fill(NaN);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const v = chan.cell(i0 + i, j0 + j); if (v === v) vals[j * N + i] = v; }
    // pass 1: regional = box mean of everything; pass 2: box mean of the cells that pass 1 did NOT flag as anomalous
    let r1 = residual(vals, null, N, RR);
    if (!r1) continue;
    const keep = new Uint8Array(N * N);
    for (let c = 0; c < N * N; c++) keep[c] = r1.res[c] === r1.res[c] && Math.abs(r1.res[c] - r1.mid) < 2.5 * r1.sd ? 1 : 0;
    const r2 = residual(vals, keep, N, RR) ?? r1;
    const sd = Math.max(noise * 1.2, r2.sd);
    const zs = r2.res.map((r) => (r - r2.mid) / sd);
    for (const sign of SIGNS[sensor]) {
      const seen = new Uint8Array(N * N);
      for (let s = 0; s < N * N; s++) {
        if (seen[s] || !(zs[s] * sign >= Z_PICK)) continue;
        // flood fill one connected component
        const stack = [s], cells = []; seen[s] = 1;
        while (stack.length) {
          const c = stack.pop(); cells.push(c);
          const ci = c % N, cj = (c / N) | 0;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
            const q = nj * N + ni; if (!seen[q] && zs[q] * sign >= Z_PICK) { seen[q] = 1; stack.push(q); }
          }
        }
        if (cells.length < MIN_CELLS) continue;
        let peak = cells[0], wx = 0, wz = 0, wsum = 0, mx = 0, mz = 0;
        for (const c of cells) { if (zs[c] * sign > zs[peak] * sign) peak = c; }
        const pi = peak % N, pj = (peak / N) | 0;
        // the anomaly must rest on real readings (not one noisy spike): count readings that landed inside it
        let support = 0;
        for (const c of cells) support += chan.support(i0 + (c % N), j0 + ((c / N) | 0));
        if (support < MIN_SUPPORT * 2) continue;
        // centroid of the upper half of the anomaly (where the source is) + second moments for elongation
        const half = Math.max(Z_PICK, zs[peak] * sign * 0.5);
        const pts = [];
        for (const c of cells) { const z = zs[c] * sign; if (z < half) continue; const w = z - half + 0.1, x = (i0 + (c % N) + 0.5) * CELL, zz = (j0 + ((c / N) | 0) + 0.5) * CELL; wx += w * x; wz += w * zz; wsum += w; pts.push([x, zz, w]); }
        mx = wx / wsum; mz = wz / wsum;
        let sxx = 0, szz = 0, sxz = 0;
        for (const [x, zz, w] of pts) { sxx += w * (x - mx) ** 2; szz += w * (zz - mz) ** 2; sxz += w * (x - mx) * (zz - mz); }
        sxx /= wsum; szz /= wsum; sxz /= wsum;
        const tr = sxx + szz, det = sxx * szz - sxz * sxz, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
        const l1 = tr / 2 + disc, l2 = Math.max(0.5, tr / 2 - disc), elong = Math.sqrt(l1 / l2);
        const halfWidth = Math.sqrt((pts.length * CELL * CELL) / Math.PI) / Math.sqrt(Math.max(1, elong));
        // half-width rule of thumb: potential fields ~ 0.8 x half-width, electrical / EM ~ 0.5 x, GPR / gamma are shallow
        const depth = sensor === 'gamma' ? 0.3 : Math.min(fp.depth, Math.max(0.5, halfWidth * (sensor === 'mag' ? 0.8 : sensor === 'gpr' ? 0.25 : 0.5) - (sensor === 'mag' ? 1 : 0)));
        out.push({ sensor, ch: chan.ch, sign, x: mx, z: mz, peak: vals[peak], zscore: zs[peak] * sign, area: cells.length * CELL * CELL, elong, depth, support });
      }
    }
  }
  return out;
}

/**
 * value - regional, where regional = box mean (+-RR cells) of the cells with data (and `keep`, when given).
 * Returns the residual grid with its robust centre (median) and spread (1.4826 x MAD), or null if too little data.
 */
function residual(vals, keep, N, RR) {
  const N1 = N + 1, sum = new Float64Array(N1 * N1), cnt = new Float64Array(N1 * N1);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const c = j * N + i, v = vals[c], ok = v === v && (!keep || keep[c]), a = (j + 1) * N1 + i + 1;
      sum[a] = (ok ? v : 0) + sum[a - 1] + sum[a - N1] - sum[a - N1 - 1];
      cnt[a] = (ok ? 1 : 0) + cnt[a - 1] + cnt[a - N1] - cnt[a - N1 - 1];
    }
  }
  const res = new Float32Array(N * N).fill(NaN), sample = [];
  for (let j = 0; j < N; j++) {
    const ja = Math.max(0, j - RR), jb = Math.min(N, j + RR + 1);
    for (let i = 0; i < N; i++) {
      const v = vals[j * N + i]; if (!(v === v)) continue;
      const ia = Math.max(0, i - RR), ib = Math.min(N, i + RR + 1);
      const c = cnt[jb * N1 + ib] - cnt[ja * N1 + ib] - cnt[jb * N1 + ia] + cnt[ja * N1 + ia];
      if (c < 12) continue;
      const r = v - (sum[jb * N1 + ib] - sum[ja * N1 + ib] - sum[jb * N1 + ia] + sum[ja * N1 + ia]) / c;
      res[j * N + i] = r;
      if ((i + j) % 2 === 0) sample.push(r);
    }
  }
  if (sample.length < 30) return null;
  sample.sort((a, b) => a - b);
  const mid = sample[sample.length >> 1];
  const dev = sample.map((r) => Math.abs(r - mid)).sort((a, b) => a - b);
  return { res, mid, sd: 1.4826 * dev[dev.length >> 1] };
}

/** 0..100 signal intensity from a robust z-score */
export const intensityOf = (z) => Math.round(Math.min(99, 100 * (1 - Math.exp(-z / 14))));

/**
 * Combine every anomaly within `r` metres of (x, z) into one interpretation. Never names a mineral as certain:
 * it returns a target CLASS, the reasoning and a confidence that only digging can settle.
 */
export function interpret(anoms, x, z, r = 28, layer = null) {
  const near = anoms.filter((a) => (!layer || a.layer === layer) && Math.hypot(a.x - x, a.z - z) < r);
  const has = (s, ch, sign = 1) => near.find((a) => a.sensor === s && (!ch || a.ch === ch) && a.sign === sign);
  const linear = near.find((a) => a.sensor === 'mag' && a.elong > 3);
  const M = near.find((a) => a.sensor === 'mag' && a.elong <= 3), Ms = near.find((a) => a.sensor === 'mag' && a.elong <= 3 && a.zscore >= STRONG);
  const I = has('ip'), E = has('emi'), Rl = has('res', null, -1), Rh = has('res', null, 1);
  const K = has('gamma', 'K'), U = has('gamma', 'U'), Th = has('gamma', 'Th'), G = has('gpr'), Vl = has('seis', null, -1), Vh = has('seis', null, 1);
  const sensors = new Set(near.map((a) => a.sensor));
  let title = null, text = '', targets = [];
  if (Ms && (E || Rl) && I) { title = 'POSSIBLE MASSIVE Ni-Co SULPHIDE'; text = 'Strong magnetics with a conductor and chargeability: magmatic sulphide signature.'; targets = ['nickel', 'cobalt', 'copper']; }
  else if (I && (M || E || Rl || K)) { title = 'POSSIBLE COPPER-BEARING MINERALISATION'; text = 'Chargeable zone with a supporting magnetic / conductive / potassic response: disseminated sulphide signature.'; targets = ['copper', 'silver', 'cobalt']; }
  else if (Th && U && M) { title = 'POTENTIAL REE / CEE INTEREST'; text = 'Thorium + uranium + magnetics together: carbonatite / alkaline-intrusion style signature. Needs digging to confirm.'; targets = ['ree', 'cee', 'thorium']; }
  else if (E && I && !M) { title = 'CONDUCTIVE + CHARGEABLE BODY'; text = 'Graphite or sulphides, but black shale gives the same response.'; targets = ['graphite', 'silver']; }
  else if (Ms) { title = 'POSSIBLE MAGNETITE / IRON ORE'; text = 'Compact strong magnetic source. A dyke would look long and narrow.'; targets = ['magnetite', 'iron']; }
  else if (linear && !M) { title = 'LINEAR MAGNETIC FEATURE'; text = 'Long, narrow magnetic high: most likely a barren dyke. Low priority.'; targets = []; }
  else if (U && U.zscore > 10 && !Th) { title = 'URANIUM TARGET'; text = 'Strong uranium-channel response with little thorium.'; targets = ['uranium']; }
  else if (Th && (K || U)) { title = 'THORIUM-RICH ZONE'; text = 'Monazite placer, laterite or granite. REE possible but not proven.'; targets = ['thorium', 'bauxite', 'ree', 'tin']; }
  else if ((Rh || Vh) && K) { title = 'RESISTIVE POTASSIC BODY'; text = 'Pegmatite or greisen: lithium, tin or tungsten possible. Granite is the barren look-alike.'; targets = ['lithium', 'tin', 'tungsten']; }
  else if (Rh && (G || Vl)) { title = 'POSSIBLE CAVITY OR QUARTZ VEIN'; text = 'Resistive radar reflector. Voids and veins look alike: low velocity points to a void.'; targets = Vl ? [] : ['gold', 'silver']; }
  else if ((E || Rl) && !I) { title = 'CONDUCTIVE, NOT CHARGEABLE'; text = 'Clay or saline water is the likely cause. Low priority.'; targets = []; }
  const top = near.slice().sort((a, b) => b.zscore - a.zscore)[0];
  if (!title && top) { const d = describe(top.sensor, top.ch, top.sign, top.zscore, top.elong); title = d.title; text = d.text; }
  const confidence = Math.min(85, Math.round(18 + 16 * Math.min(4, sensors.size) + (top ? intensityOf(top.zscore) / 6 : 0)));
  return { title, text, targets, sensors: [...sensors], confidence, count: near.length };
}
