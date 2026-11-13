const TAU = Math.PI * 2;

/** Polyline path (points are [x, z]); closed paths wrap. sample(s) -> {x, z, h} with h = atan2(dx, dz). */
export function makePath(pts, closed = true) {
  const P = closed ? [...pts, pts[0]] : pts.slice();
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const len = cum[cum.length - 1];
  const wrap = (s) => (closed ? ((s % len) + len) % len : Math.min(len, Math.max(0, s)));
  const locate = (s) => {
    s = wrap(s);
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    return [lo, (s - cum[lo]) / Math.max(1e-9, cum[lo + 1] - cum[lo])];
  };
  const sample = (s) => {
    const [i, t] = locate(s), a = P[i], b = P[i + 1];
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, h: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  };
  const curvature = (s, d = 4) => {
    let dh = sample(s + d).h - sample(s - d).h;
    while (dh > Math.PI) dh -= TAU;
    while (dh < -Math.PI) dh += TAU;
    return Math.abs(dh) / (2 * d);
  };
  const nearestS = (x, z) => {
    let best = Infinity, bs = 0;
    for (let i = 0; i < P.length - 1; i++) {
      const [ax, az] = P[i], dx = P[i + 1][0] - ax, dz = P[i + 1][1] - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (d < best) { best = d; bs = cum[i] + t * Math.sqrt(l2); }
    }
    return bs;
  };
  return { pts: P, len, closed, sample, curvature, nearestS, wrap };
}

/** right-hand (direction of travel) offset by d metres, mitred at the corners */
export function offsetPoints(pts, d, closed = false) {
  const n = pts.length;
  const dir = (i) => { const a = pts[i], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  return pts.map((p, i) => {
    const d1 = i === 0 && !closed ? dir(0) : dir((i - 1 + n) % n), d2 = i === n - 1 && !closed ? dir(n - 2) : dir(i);
    let nx = -(d1[1] + d2[1]), nz = d1[0] + d2[0]; // right normals (-dz, dx), summed
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    const miter = Math.min(2.2, 1 / Math.max(0.45, nx * -d1[1] + nz * d1[0]));
    return [p[0] + nx * d * miter, p[1] + nz * d * miter];
  });
}

/** Catmull-Rom through a closed loop of points */
export function smoothClosed(pts, per = 6) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)));
    }
  }
  return out;
}

/** a there-and-back route as a closed loop: right-hand lane out, right-hand lane back */
export function outAndBack(pts, lane) {
  const out = offsetPoints(pts, lane), back = offsetPoints([...pts].reverse(), lane);
  return [...out, ...back];
}

/** round off the corners of a polyline (Chaikin corner cutting) */
export function chaikin(pts, closed = true, iters = 2) {
  let P = pts;
  for (let k = 0; k < iters; k++) {
    const out = [], n = P.length, last = closed ? n : n - 1;
    if (!closed) out.push(P[0]);
    for (let i = 0; i < last; i++) {
      const a = P[i], b = P[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(P[n - 1]);
    P = out;
  }
  return P;
}
/**
 * Round every corner with a quadratic curve that starts `r` metres before it and ends `r` metres after it
 * (never more than half of an adjoining edge). Unlike chaikin the curve never wanders further than r from the corner,
 * so a route along city streets stays on the asphalt.
 */
export function roundCorners(pts, r, closed = true, steps = 6) {
  const n = pts.length, out = [];
  const at = (i) => pts[(i + n) % n];
  for (let i = 0; i < n; i++) {
    const p = at(i);
    if (!closed && (i === 0 || i === n - 1)) { out.push(p); continue; }
    const a = at(i - 1), b = at(i + 1);
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const c = Math.min(r, la / 2, lb / 2);
    if (c < 1e-6) { out.push(p); continue; }
    const s = [p[0] + ((a[0] - p[0]) / la) * c, p[1] + ((a[1] - p[1]) / la) * c], e = [p[0] + ((b[0] - p[0]) / lb) * c, p[1] + ((b[1] - p[1]) / lb) * c];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, u = 1 - t;
      out.push([u * u * s[0] + 2 * u * t * p[0] + t * t * e[0], u * u * s[1] + 2 * u * t * p[1] + t * t * e[1]]);
    }
  }
  return out;
}