import { RAIL, ROUTES } from './layout.js';
import { heightAt } from './terrain.js';
import { loadGLB } from './assets.js';

const SLEEPER = 0x4a3a28, STEEL = 0x8f959b;

/** sleepers + two steel rails following the terrain along the mine railway */
export function buildRail(ctx) {
  const B = ctx.b.cons, route = ROUTES.find((r) => r.kind === 'rail'), pts = route.pts;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / len, dz = (z1 - z0) / len, ry = Math.atan2(dx, dz);
    const y0 = heightAt(x0, z0) + 0.2, y1 = heightAt(x1, z1) + 0.2, slope = -Math.atan2(y1 - y0, len);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, my = (y0 + y1) / 2;
    B.box(mx, my, mz, 0.24, 0.12, len + 0.05, SLEEPER, ry, slope); // sleeper-bed cross pieces are drawn below
    for (const s of [-0.72, 0.72]) B.box(mx - dz * s, my + 0.1, mz + dx * s, 0.1, 0.12, len + 0.05, STEEL, ry, slope);
    for (let t = 0.4; t < len; t += 1.5) B.box(x0 + dx * t, y0 + (y1 - y0) * (t / len) - 0.02, z0 + dz * t, 2.5, 0.12, 0.26, SLEEPER, ry, slope * 0.0);
  }
}

const RAIL_TOP = 0.36;   // rail head above the ground (see buildRail)
const WAGON = { length: 12.5, bogie: 4.2, count: 3, gap: 1.2, buffer: 14 };

/** a point `s` metres along a polyline, with the heading there */
export function along(pts, s) {
  let d = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], len = Math.hypot(x1 - x0, z1 - z0);
    if (d + len >= s || i === pts.length - 2) { const t = Math.min(1, Math.max(0, (s - d) / len)); return { x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t }; }
    d += len;
  }
  return { x: pts[0][0], z: pts[0][1] };
}

/**
 * Where a wagon of this length sits on the track when its centre is `s` metres from the buffer stop: the middle of the
 * two bogie points, yawed along the line between them and pitched with the ground, wheels on the rail head.
 */
export function wagonPose(pts, total, s, y = heightAt) {
  const f = along(pts, total - s + WAGON.bogie), r = along(pts, total - s - WAGON.bogie);
  const yf = y(f.x, f.z) + RAIL_TOP, yr = y(r.x, r.z) + RAIL_TOP;
  return { x: (f.x + r.x) / 2, z: (f.z + r.z) / 2, y: (yf + yr) / 2, yaw: Math.atan2(f.x - r.x, f.z - r.z), pitch: -Math.atan2(yf - yr, 2 * WAGON.bogie) };
}

/** your tanker wagon, three of them coupled on the end of the mine line, wheels on the rails. Loads in the background. */
export function loadVehicles(ctx) {
  const { scene, col } = ctx, pts = ROUTES.find((r) => r.kind === 'rail').pts;
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return loadGLB({ url: '/models/tanker_wagon.glb', fit: { length: WAGON.length }, front: 'auto' }).then((model) => {
    for (let k = 0; k < WAGON.count; k++) {
      const p = wagonPose(pts, total, WAGON.buffer + WAGON.length / 2 + k * (WAGON.length + WAGON.gap)), w = k ? model.clone(true) : model;
      w.position.set(p.x, p.y, p.z); w.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
      scene.add(w);
      const sz = model.userData.size;
      col.addBox(p.x, p.z, sz.x / 2, sz.z / 2, -p.yaw, p.y + 0.3, p.y + sz.y); // the tank and frame, above the rails
    }
  }).catch((e) => console.warn('tanker wagon failed:', e?.message));
}