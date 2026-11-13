import { SENSORS, lut, RAMP_OF, norm01, denorm, fmtValue } from './sensors.js';
import { CELL } from './grid.js';
import { heightAt, waterLevelAt } from '../world/terrain.js';

/**
 * Canvas painters for the survey imagery. The PLAN MAP is drawn only from the interpolated survey grids (what you
 * actually measured), sun-shaded and contoured like a processed geophysical map. The PROFILE is the data along your
 * most recent line (radargram for GPR, model sections for the electrical / seismic methods, K-U-Th traces for gamma).
 * The drone's SCANNER and 2.5D CUTAWAY show the live instrument response under the drone.
 */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const SENSOR_CSS = (id) => SENSORS[id].css;

function niceStep(span, target = 6) {
  const raw = span / target, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

/** CSS gradient + tick labels for the legend of a channel */
export function legend(S, sensor, chId) {
  const sd = SENSORS[sensor];
  if (chId === 'ternary') return { css: 'linear-gradient(90deg,#ff3030,#30ff30,#3060ff)', ticks: [{ t: 0, label: 'K' }, { t: 0.5, label: 'Th' }, { t: 1, label: 'U' }], unit: 'K-Th-U (RGB)' };
  const ch = sd.channels.find((c) => c.id === chId), L = lut(RAMP_OF[sensor]);
  const stops = Array.from({ length: 9 }, (_, i) => { const k = Math.round((i / 8) * 255) * 3; return `rgb(${L[k]},${L[k + 1]},${L[k + 2]}) ${(i / 8) * 100}%`; });
  const st = S.chan(sensor, chId).stats;
  const ticks = st.n ? [0.05, 0.27, 0.5, 0.73, 0.95].map((t) => ({ t, label: fmtValue(ch, denorm(ch, t, st)) })) : [];
  return { css: `linear-gradient(90deg,${stops.join(',')})`, ticks, unit: ch.unit, label: ch.label };
}

// ------------------------------------------------------------------------------------------------ plan map
const bgCache = { key: '', canvas: null };
function terrainBackdrop(cx, cz, ext) {
  const key = `${Math.round(cx / 4)},${Math.round(cz / 4)},${Math.round(ext)}`;
  if (bgCache.key === key) return bgCache.canvas;
  const N = 128, c = bgCache.canvas ?? document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N), x0 = cx - ext / 2, z0 = cz - ext / 2, d = ext / N;
  const hs = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) hs[j * (N + 1) + i] = heightAt(x0 + i * d, z0 + j * d);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const h = hs[j * (N + 1) + i], gx = hs[j * (N + 1) + i + 1] - h, gz = hs[(j + 1) * (N + 1) + i] - h;
      const s = clamp(0.55 + (gx + gz) * -0.9 / d, 0.15, 1), o = (j * N + i) * 4, wet = h < waterLevelAt(x0 + i * d, z0 + j * d);
      img.data[o] = wet ? 22 : 34 * s + 10; img.data[o + 1] = wet ? 44 : 38 * s + 12; img.data[o + 2] = wet ? 66 : 40 * s + 14; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  bgCache.key = key; bgCache.canvas = c;
  return c;
}

/**
 * Edge-preserving-ish smoothing of a gridded field: a 3x3 binomial filter that only averages cells that have data (it never
 * grows the surveyed area). Like the levelling / low-pass step of real geophysical processing, it removes cell-to-cell
 * counting noise so contours and the radiometric ternary composite read as structure instead of speckle.
 */
function smooth(t, n, passes) {
  let a = t, b = new Float32Array(n * n);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = j * n + i, v = a[c];
        if (!(v === v)) { b[c] = NaN; continue; }
        let s = v * 4, w = 4;
        const add = (q, k) => { const u = a[q]; if (u === u) { s += u * k; w += k; } };
        if (i > 0) add(c - 1, 2); if (i < n - 1) add(c + 1, 2); if (j > 0) add(c - n, 2); if (j < n - 1) add(c + n, 2);
        if (i > 0 && j > 0) add(c - n - 1, 1); if (i < n - 1 && j > 0) add(c - n + 1, 1); if (i > 0 && j < n - 1) add(c + n - 1, 1); if (i < n - 1 && j < n - 1) add(c + n + 1, 1);
        b[c] = s / w;
      }
    }
    [a, b] = [b, a];
  }
  return a;
}
const SMOOTH_PASSES = { gamma: 4, gpr: 2, mag: 1, emi: 2, res: 2, ip: 2, seis: 2 };

/** interpolated normalised values of a channel on the cells covering a view: Float32 (NaN = no data) */
function cellsFor(S, sensor, chId, c0x, c0z, n) {
  const ch = SENSORS[sensor].channels.find((c) => c.id === chId), chan = S.chan(sensor, chId), st = chan.refreshStats(SENSORS[sensor].noise[chId]);
  const t = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = chan.cell(c0x + i, c0z + j); t[j * n + i] = v === v && st.n ? norm01(ch, v, st) : NaN; }
  return smooth(t, n, SMOOTH_PASSES[sensor] ?? 1);
}

const mapCache = new WeakMap();
/**
 * view: { sensor, ch, cx, cz, extent, contours, shade, points, tracks }
 * The raster is rebuilt only when the data or the view changed (at most ~5x/s); overlays every call.
 */
export function paintMap(cv, S, view, carrier) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, { sensor, cx, cz, extent: ext } = view;
  const x0 = cx - ext / 2, z0 = cz - ext / 2, sx = (x) => ((x - x0) / ext) * W, sz = (z) => ((z - z0) / ext) * H;
  let cache = mapCache.get(cv);
  if (!cache) { cache = { key: '', ver: -1, at: 0, canvas: document.createElement('canvas') }; mapCache.set(cv, cache); }
  const key = `${sensor}|${view.ch}|${cx.toFixed(1)}|${cz.toFixed(1)}|${ext}|${view.contours}|${view.shade}|${W}`;
  const now = performance.now();
  if (key !== cache.key || (S.version !== cache.ver && now - cache.at > 200)) {
    cache.key = key; cache.ver = S.version; cache.at = now;
    rasterise(cache.canvas, S, view, W, H);
  }
  g.drawImage(terrainBackdrop(cx, cz, ext), 0, 0, W, H);
  g.drawImage(cache.canvas, 0, 0);

  // grid + coordinates
  const step = niceStep(ext, 6);
  g.strokeStyle = 'rgba(255,255,255,0.13)'; g.lineWidth = 1; g.fillStyle = 'rgba(230,232,236,0.75)'; g.font = '10px ui-monospace, Menlo, monospace';
  for (let x = Math.ceil(x0 / step) * step; x < x0 + ext; x += step) { const p = Math.round(sx(x)) + 0.5; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, H); g.stroke(); g.fillText(`E${x >= 0 ? '+' : ''}${Math.round(x)}`, p + 3, H - 5); }
  for (let z = Math.ceil(z0 / step) * step; z < z0 + ext; z += step) { const p = Math.round(sz(z)) + 0.5; g.beginPath(); g.moveTo(0, p); g.lineTo(W, p); g.stroke(); g.fillText(`N${-z >= 0 ? '+' : ''}${Math.round(-z)}`, 4, p - 3); }

  // where the readings were taken + the survey tracks
  if (view.points !== false && S.pts[S.lk(sensor)]) {
    const P = S.pts[S.lk(sensor)]; g.fillStyle = 'rgba(255,255,255,0.55)';
    const r = Math.max(1, W / ext * 0.35);
    for (let i = 0; i < P.length; i += 2) { const X = sx(P[i]), Y = sz(P[i + 1]); if (X > -2 && X < W + 2 && Y > -2 && Y < H + 2) g.fillRect(X - r / 2, Y - r / 2, r, r); }
  }
  if (view.tracks !== false) {
    g.lineWidth = 1.2; g.strokeStyle = 'rgba(10,12,14,0.65)';
    for (const tr of S.tracks) {
      if (tr.sensor !== sensor || (tr.layer ?? 'surface') !== S.layer) continue;
      g.beginPath();
      for (let i = 0; i < tr.pts.length; i += 2) { const X = sx(tr.pts[i]), Y = sz(tr.pts[i + 1]); i ? g.lineTo(X, Y) : g.moveTo(X, Y); }
      g.stroke();
    }
  }
  // anomalies picked from this sensor
  g.font = '600 10px ui-monospace, Menlo, monospace';
  for (const a of S.anomalies) {
    if (a.layer !== S.layer || a.sensor !== sensor || (view.ch !== 'ternary' && a.ch !== view.ch)) continue;
    const X = sx(a.x), Y = sz(a.z), r = clamp(Math.sqrt(a.area / Math.PI) / ext * W, 6, 40);
    g.strokeStyle = a.saved ? '#ffffff' : '#ffe14a'; g.lineWidth = 1.6; g.setLineDash(a.saved ? [] : [4, 3]);
    g.beginPath(); g.arc(X, Y, r, 0, 7); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#000a'; g.fillRect(X + r * 0.7, Y - r * 0.7 - 11, 30, 12); g.fillStyle = '#ffe14a'; g.fillText(`A${a.id}`, X + r * 0.7 + 3, Y - r * 0.7 - 2);
  }
  // saved locations, confirmed finds, excavations
  for (const e of S.excavations) { const X = sx(e.x), Y = sz(e.z); if ((e.layer ?? 'surface') !== S.layer) continue; g.strokeStyle = e.ok ? '#7dff9a' : '#c9c2b6'; g.lineWidth = 2; g.beginPath(); g.moveTo(X - 4, Y - 4); g.lineTo(X + 4, Y + 4); g.moveTo(X + 4, Y - 4); g.lineTo(X - 4, Y + 4); g.stroke(); }
  for (const w of S.waypoints) {
    const X = sx(w.x), Y = sz(w.z), tgt = S.target === w.id;
    g.fillStyle = w.confirmed === 'barren' ? '#8a8a8a' : w.sensor ? SENSOR_CSS(w.sensor) : '#fff'; g.strokeStyle = tgt ? '#fff' : '#000'; g.lineWidth = tgt ? 2.2 : 1.2;
    g.beginPath(); g.moveTo(X, Y - 8); g.lineTo(X + 6, Y); g.lineTo(X, Y + 8); g.lineTo(X - 6, Y); g.closePath(); g.fill(); g.stroke();
  }
  for (const f of S.finds) { const X = sx(f.x), Y = sz(f.z); g.fillStyle = '#7dff9a'; g.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 3 : 7, a = (k / 10) * Math.PI * 2 - Math.PI / 2; g.lineTo(X + Math.cos(a) * r, Y + Math.sin(a) * r); } g.closePath(); g.fill(); }
  // the instrument
  if (carrier) {
    const X = sx(carrier.x), Y = sz(carrier.z);
    g.save(); g.translate(X, Y); g.rotate(Math.PI - carrier.h);
    g.fillStyle = '#e0a526'; g.strokeStyle = '#111'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill(); g.stroke(); g.restore();
  }
  // north arrow + scale bar
  g.fillStyle = '#e8e6df'; g.font = '700 12px sans-serif'; g.fillText('N', W - 18, 18);
  g.beginPath(); g.moveTo(W - 14, 22); g.lineTo(W - 18, 32); g.lineTo(W - 10, 32); g.closePath(); g.fill();
  const bar = niceStep(ext, 4), bw = (bar / ext) * W;
  g.fillStyle = '#000a'; g.fillRect(W - bw - 22, H - 26, bw + 14, 18);
  g.fillStyle = '#e8e6df'; g.fillRect(W - bw - 15, H - 14, bw, 3); g.font = '10px ui-monospace, monospace'; g.fillText(`${bar} m`, W - bw - 15, H - 17);
}

function rasterise(out, S, view, W, H) {
  out.width = W; out.height = H;
  const g = out.getContext('2d'), img = g.createImageData(W, H), D = img.data;
  const { sensor, cx, cz, extent: ext } = view, x0 = cx - ext / 2, z0 = cz - ext / 2;
  const c0x = Math.floor(x0 / CELL) - 1, c0z = Math.floor(z0 / CELL) - 1, n = Math.ceil(ext / CELL) + 4;
  const ternary = view.ch === 'ternary';
  const layers = ternary ? ['K', 'Th', 'U'].map((c) => cellsFor(S, 'gamma', c, c0x, c0z, n)) : [cellsFor(S, sensor, view.ch, c0x, c0z, n)];
  const t0 = layers[0];
  // sun shading (illumination from the north-west, like a processed TMI image)
  const shade = new Float32Array(n * n).fill(1);
  if (view.shade !== false && !ternary) {
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const c = j * n + i, a = t0[c - 1], b = t0[c + 1], u = t0[c - n], d = t0[c + n];
      if (!(a === a && b === b && u === u && d === d)) continue;
      shade[c] = clamp(1 + ((b - a) + (d - u)) * -2.6, 0.55, 1.35);
    }
  }
  const L = ternary ? null : lut(RAMP_OF[sensor]);
  const sc = ext / W / CELL, lev = new Int16Array(W).fill(-999);
  for (let py = 0; py < H; py++) {
    const fz = (z0 + (py + 0.5) * ext / H) / CELL - 0.5 - c0z, j = Math.floor(fz), v = fz - j;
    let left = -999;
    for (let px = 0; px < W; px++) {
      const fx = (x0 / CELL + (px + 0.5) * sc) - 0.5 - c0x, i = Math.floor(fx), u = fx - i, o = (py * W + px) * 4;
      if (i < 0 || j < 0 || i >= n - 1 || j >= n - 1) { D[o + 3] = 0; continue; }
      const k = j * n + i, w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w01 = (1 - u) * v, w11 = u * v;
      const val = (arr) => { let s = 0, w = 0; const A = arr[k], B = arr[k + 1], C = arr[k + n], E = arr[k + n + 1]; if (A === A) { s += A * w00; w += w00; } if (B === B) { s += B * w10; w += w10; } if (C === C) { s += C * w01; w += w01; } if (E === E) { s += E * w11; w += w11; } return w > 0.35 ? s / w : NaN; };
      const t = val(t0);
      if (!(t === t)) { D[o + 3] = 0; lev[px] = -999; left = -999; continue; }
      let r, gg, b;
      if (ternary) { // R = K, G = Th, B = U, each stretched about the survey background (so a quiet area is a calm grey-brown and an anomaly turns the colour of its element)
        const T2 = val(layers[1]), T3 = val(layers[2]), st = (q) => clamp(0.5 + ((q === q ? q : 0.5) - 0.5) * 2.6, 0, 1);
        r = 40 + 215 * st(t); gg = 40 + 215 * st(T2); b = 40 + 215 * st(T3);
      }
      else {
        const li = Math.round(clamp(t, 0, 1) * 255) * 3, s = shade[k] * w00 + shade[k + 1] * w10 + shade[k + n] * w01 + shade[k + n + 1] * w11;
        r = L[li] * s; gg = L[li + 1] * s; b = L[li + 2] * s;
      }
      // contour lines where the level changes between neighbouring pixels
      const lv = Math.floor(t * 18);
      if (view.contours !== false && !ternary && ((left !== -999 && lv !== left) || (lev[px] !== -999 && lv !== lev[px]))) { r *= 0.45; gg *= 0.45; b *= 0.45; }
      lev[px] = lv; left = lv;
      D[o] = clamp(r, 0, 255); D[o + 1] = clamp(gg, 0, 255); D[o + 2] = clamp(b, 0, 255); D[o + 3] = 238;
    }
  }
  g.putImageData(img, 0, 0);
}

// ------------------------------------------------------------------------------------------------ line profile / section
const SECTION = {
  gpr: { maxD: 5, title: 'GPR RADARGRAM (B-SCAN)' },
  seis: { maxD: 30, title: 'P-WAVE VELOCITY SECTION', ramp: 'vel', lo: 300, hi: 5200, unit: 'm/s', fmt: (v) => Math.round(v) },
  res: { maxD: 18, title: 'RESISTIVITY SECTION (INVERTED)', ramp: 'rainbow', lo: 1, hi: 3.6, log: true, unit: 'ohm.m', fmt: (v) => Math.round(Math.pow(10, v)) },
  ip: { maxD: 15, title: 'CHARGEABILITY SECTION (INVERTED)', ramp: 'plasma', lo: 0, hi: 40, unit: 'mV/V', fmt: (v) => v.toFixed(0) },
  emi: { maxD: 7, title: 'CONDUCTIVITY-DEPTH IMAGE', ramp: 'turbo', lo: 0, hi: 2.6, log: true, unit: 'mS/m', fmt: (v) => Math.round(Math.pow(10, v)) },
  mag: { maxD: 30, title: 'SUSCEPTIBILITY MODEL (DEPTH ESTIMATE)', ramp: 'mag', lo: 0, hi: 12, unit: 'x1e-3 SI', fmt: (v) => v.toFixed(1), blur: true },
};
const profCache = new WeakMap();
const lerpPos = (R, s) => {
  let k = 1; while (k < R.length - 1 && R[k].s < s) k++;
  const a = R[k - 1], b = R[k], t = clamp((s - a.s) / Math.max(1e-6, b.s - a.s), 0, 1);
  return [a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t];
};

export function paintProfile(cv, S, sensor) {
  S.geo.layer = S.layer; // sections are drawn from the layer you are surveying in
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, R = S.recent;
  let cache = profCache.get(cv);
  if (!cache) { cache = { ver: -1, at: 0, sensor: null, canvas: document.createElement('canvas') }; profCache.set(cv, cache); }
  g.fillStyle = '#0b0f13'; g.fillRect(0, 0, W, H);
  if (R.length < 3 || R[R.length - 1].s - R[0].s < 4 || sensor !== S.sensor) {
    g.fillStyle = '#9aa3ab'; g.font = '13px sans-serif'; g.textAlign = 'center';
    g.fillText(sensor !== S.sensor ? 'Profiles show the sensor you are surveying with now' : 'Survey a line (a few metres) to build the profile', W / 2, H / 2); g.textAlign = 'left';
    return;
  }
  const now = performance.now();
  if (cache.ver !== S.version && now - cache.at > 280 || cache.sensor !== sensor || cache.canvas.width !== W) {
    cache.ver = S.version; cache.at = now; cache.sensor = sensor;
    drawProfile(cache.canvas, S, sensor, W, H);
  }
  g.drawImage(cache.canvas, 0, 0);
}

function drawProfile(out, S, sensor, W, H) {
  out.width = W; out.height = H;
  const g = out.getContext('2d'), R = S.recent, s0 = R[0].s, s1 = R[R.length - 1].s, span = s1 - s0, sd = S.geo && SENSORS[sensor];
  const padL = 46, padR = 12, plotW = W - padL - padR;
  g.fillStyle = '#0b0f13'; g.fillRect(0, 0, W, H);
  g.font = '10px ui-monospace, Menlo, monospace';
  const xOf = (s) => padL + ((s - s0) / span) * plotW;
  // ---- measured trace(s) along the line
  const top = 18, ph = sensor === 'gamma' ? H - top - 26 : Math.round(H * 0.27);
  const series = sd.channels.map((ch) => ({ ch, pts: R.map((r) => [r.s, r.v[ch.id]]).filter((p) => Number.isFinite(p[1])) }));
  const cols = sensor === 'gamma' ? ['#ff5a4a', '#5aa0ff', '#6aff6a'] : [sd.css];
  series.forEach(({ ch, pts }, si) => {
    if (!pts.length) return;
    let lo = Infinity, hi = -Infinity; for (const [, v] of pts) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const pad = (hi - lo) * 0.12 + 1e-6; lo -= pad; hi += pad;
    const yOf = (v) => top + ph - ((v - lo) / (hi - lo)) * ph;
    g.strokeStyle = cols[si]; g.lineWidth = 1.4; g.beginPath();
    pts.forEach(([s, v], i) => (i ? g.lineTo(xOf(s), yOf(v)) : g.moveTo(xOf(s), yOf(v)))); g.stroke();
    g.fillStyle = cols[si];
    g.fillText(`${ch.id === 'K' || ch.id === 'U' || ch.id === 'Th' ? ch.id : ch.label} ${fmtValue(ch, hi)} / ${fmtValue(ch, lo)} ${ch.unit}`, padL + 4 + si * 150, top - 5);
  });
  g.strokeStyle = 'rgba(255,255,255,0.15)'; g.strokeRect(padL, top, plotW, ph);
  if (sensor === 'gamma') { axisS(g, s0, span, xOf, H - 8); g.fillStyle = '#c8cdd2'; g.fillText('K / U / Th along the line: gamma rays only come from the top ~0.5 m', padL, H - 20); return; }

  // ---- section under the line
  const cfg = SECTION[sensor], y0 = top + ph + 22, sh = H - y0 - 22, maxD = cfg.maxD;
  g.fillStyle = '#c8cdd2'; g.font = '600 10px ui-monospace, Menlo, monospace'; g.fillText(cfg.title, padL, y0 - 7);
  const nc = Math.min(260, Math.max(20, Math.round(plotW / 2))), nr = Math.min(110, Math.round(sh / 2));
  const img = g.createImageData(nc, nr), D = img.data;
  if (sensor === 'gpr') {
    const [cx, cz] = lerpPos(R, s0 + span / 2), scat = S.geo.scatterers(cx, cz, span / 2 + 6), tr = new Float32Array(nr);
    for (let i = 0; i < nc; i++) {
      const [x, z] = lerpPos(R, s0 + (i / (nc - 1)) * span);
      S.geo.gprTrace(x, z, nr, maxD, tr, scat);
      for (let j = 0; j < nr; j++) {
        const d = (j / nr) * maxD, gain = 1 + 5 * Math.pow(d / maxD, 1.3);
        const v = clamp(128 + tr[j] * gain * 92 + (Math.random() - 0.5) * 14, 0, 255), o = (j * nc + i) * 4;
        D[o] = v; D[o + 1] = v; D[o + 2] = v * 0.96; D[o + 3] = 255;
      }
    }
  } else {
    const L = lut(cfg.ramp), cr = cfg.blur ? 3 : 1;
    for (let i = 0; i < nc; i++) {
      const [x, z] = lerpPos(R, s0 + (i / (nc - 1)) * span), ctx = S.geo.column(x, z);
      for (let j = 0; j < nr; j++) {
        const d = ((j + 0.5) / nr) * maxD;
        let v = 0;
        for (let k = 0; k < cr; k++) v += S.geo.property(sensor === 'emi' ? 'emi' : sensor, x, z, d + (k - (cr - 1) / 2) * maxD * 0.06, ctx);
        v /= cr;
        if (cfg.log) v = Math.log10(Math.max(0.1, v));
        const doi = clamp(1 - (d - sd.depth) / (maxD * 0.35), 0.25, 1); // fade below the depth of investigation
        const t = clamp((v - cfg.lo) / (cfg.hi - cfg.lo) + (Math.random() - 0.5) * 0.02, 0, 1), li = Math.round(t * 255) * 3, o = (j * nc + i) * 4;
        D[o] = L[li] * doi + 40 * (1 - doi); D[o + 1] = L[li + 1] * doi + 42 * (1 - doi); D[o + 2] = L[li + 2] * doi + 46 * (1 - doi); D[o + 3] = 255;
      }
    }
  }
  const tmp = document.createElement('canvas'); tmp.width = nc; tmp.height = nr; tmp.getContext('2d').putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true; g.drawImage(tmp, padL, y0, plotW, sh);
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.strokeRect(padL, y0, plotW, sh);
  // depth axis (and two-way travel time for GPR, at ~0.1 m/ns)
  g.fillStyle = '#c8cdd2'; g.font = '10px ui-monospace, Menlo, monospace';
  const ds = niceStep(maxD, 5);
  for (let d = 0; d <= maxD + 1e-6; d += ds) { const y = y0 + (d / maxD) * sh; g.fillText(`${d}m`, 6, y + 3); if (sensor === 'gpr') g.fillText(`${Math.round(d * 20)}ns`, W - padR - 34, y + 3); g.fillRect(padL - 4, y, 4, 1); }
  if (sd.depth < maxD) { const y = y0 + (sd.depth / maxD) * sh; g.setLineDash([5, 4]); g.strokeStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + plotW, y); g.stroke(); g.setLineDash([]); g.fillText('DOI', padL + 4, y - 3); }
  axisS(g, s0, span, xOf, H - 6);
  if (cfg.ramp) { // colour bar
    const L = lut(cfg.ramp), bw = 120, bx = W - padR - bw, by = y0 - 15;
    for (let i = 0; i < bw; i++) { const li = Math.round((i / (bw - 1)) * 255) * 3; g.fillStyle = `rgb(${L[li]},${L[li + 1]},${L[li + 2]})`; g.fillRect(bx + i, by, 1, 7); }
    g.fillStyle = '#c8cdd2'; g.fillText(`${cfg.fmt(cfg.lo)}`, bx - 22, by + 7); g.fillText(`${cfg.fmt(cfg.hi)} ${cfg.unit}`, bx + bw + 3 - 60, by - 2);
  }
}
function axisS(g, s0, span, xOf, y) {
  g.fillStyle = '#c8cdd2'; const st = niceStep(span, 6);
  for (let s = 0; s <= span; s += st) g.fillText(`${Math.round(s)}m`, xOf(s0 + s) - 8, y);
}

// ------------------------------------------------------------------------------------------------ live drone views
/** normalised live response (0..1) of the active sensor at a point, using the survey's statistics when it has them */
function liveSampler(S, sensor, h) {
  const sd = SENSORS[sensor], out = {};
  if (sensor === 'gamma') {
    const st = ['K', 'U', 'Th'].map((c) => S.chan('gamma', c).stats);
    return (x, z) => { S.geo.measure('gamma', x, z, h, out); return [out.K, out.Th, out.U].map((v, i) => (st[i === 0 ? 0 : i === 1 ? 2 : 1].n ? norm01(sd.channels[i === 0 ? 0 : i === 1 ? 2 : 1], v, st[i === 0 ? 0 : i === 1 ? 2 : 1]) : clamp(v / [3, 18, 5][i], 0, 1))); };
  }
  const ch = sd.channels[0], st = S.chan(sensor, ch.id).stats;
  const fallback = { mag: { bg: 30, sd: 12 }, emi: { bg: 12, sd: 3 }, gpr: { bg: 0.2, sd: 0.05 } }[sensor] ?? { bg: 0, sd: 1 };
  return (x, z) => { let v = S.geo.measure(sensor, x, z, h); if (ch.mode === 'log') v = Math.log10(v); return norm01(ch, v, st.n ? st : fallback); };
}

const scanCache = new WeakMap();
/** the circular live scanner (upper right while flying): the instrument's response under the drone, north up */
export function paintScanner(cv, S, now) {
  S.geo.layer = 'surface';
  const g = cv.getContext('2d'), W = cv.width, c = W / 2, R = c - 4, d = S.drone, sensor = d.sensor;
  g.clearRect(0, 0, W, W);
  if (!sensor) return;
  let cache = scanCache.get(cv);
  if (!cache) { cache = { at: 0, canvas: document.createElement('canvas') }; scanCache.set(cv, cache); }
  const gr = clamp(16 + d.agl * 1.4, 18, 120);
  if (now - cache.at > 120) {
    cache.at = now;
    const N = 64, cc = cache.canvas; cc.width = cc.height = N;
    const cg = cc.getContext('2d'), img = cg.createImageData(N, N), D = img.data, f = liveSampler(S, sensor, Math.max(0.5, d.agl)), L = lut(RAMP_OF[sensor]);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N * 2 - 1, v = (j + 0.5) / N * 2 - 1, o = (j * N + i) * 4;
      if (u * u + v * v > 1.02) { D[o + 3] = 0; continue; }
      const x = d.x + u * gr, z = d.z + v * gr, t = f(x, z);
      let r, gg, b;
      if (Array.isArray(t)) { r = t[0] * 255; gg = t[1] * 255; b = t[2] * 255; }
      else {
        const k = sensor === 'gpr' ? clamp(t + 0.18 * Math.sin(Math.hypot(u, v) * 26 - now * 0.008) * (0.4 + t), 0, 1) : t; // radar returns ring out from the antenna
        const li = Math.round(k * 255) * 3; r = L[li]; gg = L[li + 1]; b = L[li + 2];
      }
      // "x-ray" look: inverted, contrast-stretched luminance carrying the sensor colours, with scan lines
      const lum = 0.3 * r + 0.59 * gg + 0.11 * b, inv = 255 - lum, sl = j % 2 ? 0.82 : 1;
      D[o] = clamp((r * 0.75 + inv * 0.25) * sl, 0, 255); D[o + 1] = clamp((gg * 0.75 + inv * 0.25) * sl, 0, 255); D[o + 2] = clamp((b * 0.75 + inv * 0.35) * sl, 0, 255); D[o + 3] = 255;
    }
    cg.putImageData(img, 0, 0);
  }
  g.save(); g.beginPath(); g.arc(c, c, R, 0, 7); g.clip();
  g.fillStyle = '#05080a'; g.fillRect(0, 0, W, W);
  g.imageSmoothingEnabled = true; g.drawImage(cache.canvas, c - R, c - R, 2 * R, 2 * R);
  const sweep = ((now / 2200) % 1) * Math.PI * 2;
  for (let k = 0; k < 28; k++) { g.strokeStyle = `rgba(190,255,230,${0.35 * (1 - k / 28)})`; g.lineWidth = 2; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(sweep - k * 0.025) * R, c + Math.sin(sweep - k * 0.025) * R); g.stroke(); }
  const vg = g.createRadialGradient(c, c, R * 0.55, c, c, R); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.65)'); g.fillStyle = vg; g.fillRect(0, 0, W, W);
  g.restore();
  g.strokeStyle = 'rgba(160,240,220,0.55)'; g.lineWidth = 1;
  for (const f of [0.33, 0.66, 1]) { g.beginPath(); g.arc(c, c, R * f, 0, 7); g.stroke(); }
  g.beginPath(); g.moveTo(c - R, c); g.lineTo(c + R, c); g.moveTo(c, c - R); g.lineTo(c, c + R); g.stroke();
  // saved / detected anomalies in range
  for (const a of S.anomalies) {
    const u = (a.x - d.x) / gr, v = (a.z - d.z) / gr; if (u * u + v * v > 1) continue;
    g.strokeStyle = a.saved ? '#ffffff' : '#ffe14a'; g.lineWidth = 2; g.beginPath(); g.arc(c + u * R, c + v * R, 6 + a.intensity / 12, 0, 7); g.stroke();
  }
  // heading tick
  g.save(); g.translate(c, c); g.rotate(Math.PI - d.yaw); g.fillStyle = '#e0a526'; g.beginPath(); g.moveTo(0, -11); g.lineTo(6, 6); g.lineTo(-6, 6); g.closePath(); g.fill(); g.restore();
  g.fillStyle = '#d6fff2'; g.font = '600 11px ui-monospace, Menlo, monospace';
  g.fillText('N', c - 4, 16); g.fillText(`${SENSORS[sensor].short}  R ${Math.round(gr)}m`, 12, W - 10);
}

/**
 * The 2.5D subsurface window: an isometric block of ground under the drone. Top = live instrument response draped
 * on the terrain; the two cut faces = a conceptual depth section of the anomalies the sensor sees (smeared to the
 * depth the measurement suggests, NOT the true geology); detected anomalies are drawn inside the block at their
 * estimated depth. Every instrument gets its own palette and section style.
 */
export function paint25D(cv, S, now) {
  S.geo.layer = 'surface'; // the drone only ever sees the open surface
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, d = S.drone, sensor = d.sensor;
  g.fillStyle = '#0a0e12'; g.fillRect(0, 0, W, H);
  if (!sensor) return;
  const sd = SENSORS[sensor], L = lut(RAMP_OF[sensor]), N = 26, B = 56, D = clamp(sd.depth * 1.3, 4, 26);
  const h = Math.max(0.5, d.agl), f = liveSampler(S, sensor, h), x0 = d.x - B / 2, z0 = d.z - B / 2;
  const kx = W * 0.36, ky = W * 0.17, depthPx = H * 0.36, ox = W / 2, oy = H * 0.12;
  const yBase = heightAt(d.x, d.z);
  const P = (u, v, e = 0, dep = 0) => [ox + (u - v) * kx, oy + (u + v) * ky - e * 3.2 + (dep / D) * depthPx];
  const grid = [], hgt = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = x0 + (i / N) * B, z = z0 + (j / N) * B, t = f(x, z);
    grid.push(Array.isArray(t) ? t : [t]); hgt.push(clamp(heightAt(x, z) - yBase, -6, 6));
  }
  const at = (i, j) => grid[j * (N + 1) + i], hAt = (i, j) => hgt[j * (N + 1) + i];
  const col = (t, k = 1, a = 1) => { if (t.length === 3) return `rgba(${t[0] * 255 * k | 0},${t[1] * 255 * k | 0},${t[2] * 255 * k | 0},${a})`; const li = Math.round(clamp(t[0], 0, 1) * 255) * 3; return `rgba(${L[li] * k | 0},${L[li + 1] * k | 0},${L[li + 2] * k | 0},${a})`; };
  const strength = (t) => (t.length === 3 ? Math.max(...t) * 2 - 1 : sensor === 'res' || sensor === 'seis' ? Math.abs(t[0] - 0.5) * 2 : (t[0] - 0.5) * 2);
  // estimated source depth: from the nearest detected anomaly, else a third of the investigation depth
  const near = S.anomalies.filter((a) => a.sensor === sensor && Math.abs(a.x - d.x) < B / 2 && Math.abs(a.z - d.z) < B / 2);
  const d0 = near.length ? near.reduce((s, a) => s + a.depth, 0) / near.length : sd.depth * 0.33, sig = Math.max(0.8, sd.depth * 0.22);
  const layerCol = (dep) => { const k = dep < 0.8 ? 0.42 : dep < D * 0.45 ? 0.3 : 0.22; return [44 * k * 2.4, 40 * k * 2.4, 36 * k * 2.4]; };
  // the two visible cut faces (south face v = 1, east face u = 1)
  const face = (fixedV) => {
    const rows = 14;
    for (let k = 0; k < N; k++) {
      const i = fixedV ? k : N, j = fixedV ? N : k, i2 = fixedV ? k + 1 : N, j2 = fixedV ? N : k + 1;
      const t = at(i, j), a = clamp(strength(t), 0, 1), e1 = hAt(i, j), e2 = hAt(i2, j2);
      for (let r = 0; r < rows; r++) {
        const da = (r / rows) * D, db = ((r + 1) / rows) * D, w = a * Math.exp(-(((da + db) / 2 - d0) ** 2) / (2 * sig * sig));
        const lc = layerCol(da), u1 = i / N, v1 = j / N, u2 = i2 / N, v2 = j2 / N;
        let rgb;
        if (t.length === 3) rgb = [lc[0] + w * t[0] * 230, lc[1] + w * t[1] * 230, lc[2] + w * t[2] * 230];
        else { const li = Math.round(clamp(0.5 + (sensor === 'res' || sensor === 'seis' ? (t[0] - 0.5) : Math.max(0, t[0] - 0.5)) * 1.6 * Math.exp(-(((da + db) / 2 - d0) ** 2) / (2 * sig * sig)), 0, 1) * 255) * 3; rgb = [lc[0] * (1 - w) + L[li] * w, lc[1] * (1 - w) + L[li + 1] * w, lc[2] * (1 - w) + L[li + 2] * w]; }
        const shadeF = fixedV ? 0.95 : 0.8;
        g.fillStyle = `rgb(${rgb[0] * shadeF | 0},${rgb[1] * shadeF | 0},${rgb[2] * shadeF | 0})`;
        const p1 = P(u1, v1, e1, da), p2 = P(u2, v2, e2, da), p3 = P(u2, v2, e2, db), p4 = P(u1, v1, e1, db);
        g.beginPath(); g.moveTo(...p1); g.lineTo(...p2); g.lineTo(...p3); g.lineTo(...p4); g.closePath(); g.fill();
      }
    }
  };
  face(true); face(false);
  // the ground surface, semi-transparent so the bodies beneath read through it
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const t = at(i, j), sh = clamp(1 + (hAt(i + 1, j) - hAt(i, j) + hAt(i, j + 1) - hAt(i, j)) * -0.25, 0.6, 1.25);
    g.fillStyle = col(t, sh, 0.72);
    const a = P(i / N, j / N, hAt(i, j)), b = P((i + 1) / N, j / N, hAt(i + 1, j)), c = P((i + 1) / N, (j + 1) / N, hAt(i + 1, j + 1)), e = P(i / N, (j + 1) / N, hAt(i, j + 1));
    g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.lineTo(...c); g.lineTo(...e); g.closePath(); g.fill();
  }
  // detected anomalies inside the block, at their estimated depth
  for (const a of near) {
    const u = (a.x - x0) / B, v = (a.z - z0) / B, r = clamp(Math.sqrt(a.area / Math.PI) / B, 0.04, 0.25);
    const [sx0, sy0] = P(u, v, 0, 0), [sx, sy] = P(u, v, 0, Math.min(D, a.depth + 0.6));
    g.setLineDash([3, 3]); g.strokeStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.moveTo(sx0, sy0); g.lineTo(sx, sy); g.stroke(); g.setLineDash([]);
    const glow = g.createRadialGradient(sx, sy, 1, sx, sy, r * kx * 1.4);
    const pulseA = 0.55 + 0.25 * Math.sin(now * 0.005 + a.id);
    glow.addColorStop(0, `rgba(255,240,170,${pulseA})`); glow.addColorStop(0.45, `${sd.css}aa`); glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow; g.beginPath(); g.ellipse(sx, sy, r * kx * 1.4, r * ky * 1.6, 0, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = '600 10px ui-monospace, Menlo, monospace'; g.fillText(`A${a.id} ~${a.depth.toFixed(1)}m`, sx + 8, sy - 4);
  }
  // block outline + drone + scan cone
  g.strokeStyle = 'rgba(220,230,240,0.45)'; g.lineWidth = 1;
  const C = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => P(u, v, 0)), Cd = [[1, 0], [1, 1], [0, 1]].map(([u, v]) => P(u, v, 0, D));
  g.beginPath(); C.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p))); g.closePath(); g.stroke();
  g.beginPath(); g.moveTo(...C[1]); g.lineTo(...Cd[0]); g.lineTo(...Cd[1]); g.lineTo(...Cd[2]); g.lineTo(...C[3]); g.moveTo(...C[2]); g.lineTo(...Cd[1]); g.stroke();
  const [dx, dy] = P(0.5, 0.5, Math.min(18, h) * 0.6 + 4);
  g.strokeStyle = 'rgba(255,200,90,0.5)'; g.beginPath();
  const fr = clamp((6 + h * 0.35) / B, 0.05, 0.45);
  for (const [u, v] of [[0.5 - fr, 0.5], [0.5 + fr, 0.5], [0.5, 0.5 - fr], [0.5, 0.5 + fr]]) { g.moveTo(dx, dy); g.lineTo(...P(u, v, 0)); }
  g.stroke();
  g.fillStyle = '#ff9f2a'; g.beginPath(); g.moveTo(dx - 8, dy); g.lineTo(dx, dy - 4); g.lineTo(dx + 8, dy); g.lineTo(dx, dy + 4); g.closePath(); g.fill();
  // depth ticks on the east face + labels
  g.fillStyle = '#c8cdd2'; g.font = '10px ui-monospace, Menlo, monospace';
  for (let k = 0; k <= 4; k++) { const dd = (k / 4) * D, [px, py] = P(1, 1, 0, dd); g.fillText(`${dd.toFixed(0)}m`, px + 4, py + 3); }
  const [nx, ny] = P(0, 0, 0); g.fillText('N', nx - 4, ny - 6);
  g.fillText(`${B} m block - ${sensor === 'gamma' ? 'surface radiometrics (top 0.5 m)' : 'conceptual depth view'}`, 8, H - 8);
}

// ------------------------------------------------------------------------------------------------ world coverage map
/**
 * The COMPLETE 2D map of what has been surveyed: the whole layer (the island, a cave, or the lake / river / pit beds) with the ground
 * nobody has measured left dim and the mapped ground revealed in full brightness and tinted in the colour of the sensor that mapped it.
 * Drawn straight from the survey grids (a cell counts as mapped once enough readings support it), tile by tile, so it costs almost nothing.
 */
import { TILE, TILE_M, W_MIN } from './grid.js';
const rgbOf = (css) => [parseInt(css.slice(1, 3), 16), parseInt(css.slice(3, 5), 16), parseInt(css.slice(5, 7), 16)];
const bmpCache = new WeakMap();
function tileBitmap(t, rgb) {
  const c = bmpCache.get(t);
  if (c && c.ver === t.ver) return c.canvas;
  const cv = c?.canvas ?? document.createElement('canvas'); cv.width = cv.height = TILE;
  const g = cv.getContext('2d'), img = g.createImageData(TILE, TILE), D = img.data;
  for (let i = 0; i < TILE * TILE; i++) if (t.ws[i] >= W_MIN) { D[i * 4] = rgb[0]; D[i * 4 + 1] = rgb[1]; D[i * 4 + 2] = rgb[2]; D[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0); bmpCache.set(t, { ver: t.ver, canvas: cv });
  return cv;
}

/** the part of the world a layer's map should show: { cx, cz, extent } */
export function layerView(S, layer) {
  if (!layer.startsWith('cave')) return { cx: 0, cz: 0, extent: 1700 };
  const fl = S.world.caves[+layer.slice(4)].floors;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of fl) { x0 = Math.min(x0, r.x - r.hx); x1 = Math.max(x1, r.x + r.hx); z0 = Math.min(z0, r.z - r.hz); z1 = Math.max(z1, r.z + r.hz); }
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, extent: Math.max(x1 - x0, z1 - z0) * 1.14 };
}

const worldBuf = new WeakMap();
/** o: { layer, sensors: Set of sensor ids, cx, cz, extent, base (the island image, 1700 m square, centred on 0), pose } */
export function paintWorld(cv, S, o) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, { layer, cx, cz, extent: ext } = o;
  const x0 = cx - ext / 2, z0 = cz - ext / 2, sx = (x) => ((x - x0) / ext) * W, sz = (z) => ((z - z0) / ext) * H, k = W / ext;
  let buf = worldBuf.get(cv);
  if (!buf || buf.mask.width !== W) { const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; }; buf = { mask: mk(), tmp: mk() }; worldBuf.set(cv, buf); }
  const prefix = layer === 'surface' ? '' : `${layer}:`;

  const drawBase = (c) => {
    c.fillStyle = '#0b0f13'; c.fillRect(0, 0, W, H);
    if (layer.startsWith('cave')) {
      const cave = S.world.caves[+layer.slice(4)];
      c.fillStyle = '#1b2027'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#4a5059'; for (const r of cave.floors) c.fillRect(sx(r.x - r.hx), sz(r.z - r.hz), r.hx * 2 * k + 0.6, r.hz * 2 * k + 0.6);
      c.fillStyle = '#9aa1ab'; c.font = '600 11px ui-monospace, Menlo, monospace'; c.textAlign = 'left'; c.fillText('PORTAL', sx(cave.segments[0].x0) - 4, sz(cave.segments[0].z0) - 12);
    } else if (o.base) { const B = 1700; c.imageSmoothingEnabled = true; c.drawImage(o.base, sx(-B / 2), sz(-B / 2), B * k, B * k); }
  };
  const tilesOf = (id) => SENSORS[id].channels.flatMap((ch) => { const chan = S.channels.get(`${prefix}${id}.${ch.id}`); return chan ? [...chan.tiles.values()] : []; });
  const sensors = [...o.sensors].filter((id) => SENSORS[id]);
  const stamp = (c, rgbFor, alpha) => {
    c.imageSmoothingEnabled = false; c.globalAlpha = alpha;
    for (const id of sensors) for (const t of tilesOf(id)) c.drawImage(tileBitmap(t, rgbFor(id)), sx(t.tx * TILE_M), sz(t.tz * TILE_M), TILE_M * k + 0.7, TILE_M * k + 0.7);
    c.globalAlpha = 1;
  };

  // 1. everything, dimmed: this is how unmapped ground looks
  drawBase(g); g.fillStyle = 'rgba(5,8,11,0.68)'; g.fillRect(0, 0, W, H);
  // 2. the mapped ground (union of the chosen sensors) at full brightness: the base drawn through a mask of the coverage
  const m = buf.mask.getContext('2d'); m.globalCompositeOperation = 'source-over'; m.clearRect(0, 0, W, H); stamp(m, () => [255, 255, 255], 1);
  const t = buf.tmp.getContext('2d'); t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, W, H); drawBase(t);
  t.globalCompositeOperation = 'destination-in'; t.drawImage(buf.mask, 0, 0); t.globalCompositeOperation = 'source-over';
  g.drawImage(buf.tmp, 0, 0);
  // 3. a tint per sensor so you can see WHICH instrument mapped it
  stamp(g, (id) => rgbOf(SENSORS[id].css), 0.38);
  g.imageSmoothingEnabled = true;

  // grid + coordinates
  const step = niceStep(ext, 8);
  g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 1; g.fillStyle = 'rgba(230,232,236,0.7)'; g.font = '10px ui-monospace, Menlo, monospace'; g.textAlign = 'left';
  for (let x = Math.ceil(x0 / step) * step; x < x0 + ext; x += step) { const p = Math.round(sx(x)) + 0.5; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, H); g.stroke(); g.fillText(`E${x >= 0 ? '+' : ''}${Math.round(x)}`, p + 3, H - 5); }
  for (let z = Math.ceil(z0 / step) * step; z < z0 + ext; z += step) { const p = Math.round(sz(z)) + 0.5; g.beginPath(); g.moveTo(0, p); g.lineTo(W, p); g.stroke(); g.fillText(`N${-z >= 0 ? '+' : ''}${Math.round(-z)}`, 4, p - 3); }

  // what was found
  for (const a of S.anomalies) {
    if (a.layer !== layer || !o.sensors.has(a.sensor)) continue;
    const X = sx(a.x), Y = sz(a.z), r = Math.max(5, Math.min(28, Math.sqrt(a.area / Math.PI) * k));
    g.strokeStyle = a.saved ? '#ffffff' : SENSORS[a.sensor].css; g.lineWidth = 1.6; g.beginPath(); g.arc(X, Y, r, 0, 7); g.stroke();
  }
  for (const w of S.waypoints) {
    if ((w.layer ?? 'surface') !== layer) continue;
    const X = sx(w.x), Y = sz(w.z);
    g.fillStyle = w.confirmed === 'barren' ? '#8a8a8a' : w.sensor ? SENSORS[w.sensor].css : '#fff'; g.strokeStyle = S.target === w.id ? '#fff' : '#000'; g.lineWidth = S.target === w.id ? 2.2 : 1.2;
    g.beginPath(); g.moveTo(X, Y - 8); g.lineTo(X + 6, Y); g.lineTo(X, Y + 8); g.lineTo(X - 6, Y); g.closePath(); g.fill(); g.stroke();
  }
  for (const f of S.finds) {
    if ((f.layer ?? 'surface') !== layer) continue;
    const X = sx(f.x), Y = sz(f.z); g.fillStyle = '#7dff9a'; g.beginPath();
    for (let q = 0; q < 10; q++) { const r = q % 2 ? 3 : 7, a = (q / 10) * Math.PI * 2 - Math.PI / 2; g.lineTo(X + Math.cos(a) * r, Y + Math.sin(a) * r); }
    g.closePath(); g.fill();
  }
  if (o.pose && S.layerNow() === layer) { // you
    g.save(); g.translate(sx(o.pose.x), sz(o.pose.z)); g.rotate(Math.PI - o.pose.h); g.fillStyle = '#e0a526'; g.strokeStyle = '#111'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill(); g.stroke(); g.restore();
  }
  // north arrow + scale bar
  g.fillStyle = '#e8e6df'; g.font = '700 12px sans-serif'; g.fillText('N', W - 18, 18);
  g.beginPath(); g.moveTo(W - 14, 22); g.lineTo(W - 18, 32); g.lineTo(W - 10, 32); g.closePath(); g.fill();
  const bar = niceStep(ext, 4), bw = (bar / ext) * W;
  g.fillStyle = '#000a'; g.fillRect(W - bw - 22, H - 26, bw + 14, 18);
  g.fillStyle = '#e8e6df'; g.fillRect(W - bw - 15, H - 14, bw, 3); g.font = '10px ui-monospace, monospace'; g.fillText(bar >= 1000 ? `${bar / 1000} km` : `${bar} m`, W - bw - 15, H - 17);
}
