/**
 * Drives along a path: accelerates, brakes for corners (lateral-acceleration limit) and for its stops,
 * dwells at each stop, then carries on. Pure: no rendering.
 *   stops: [{ id, s, dwell }]  (s = distance along the path)     phase: 0..1 start position round a closed loop
 */
export class Follower {
  constructor(path, { vmax = 10, accel = 2.4, brake = 3.2, latAccel = 2.6, stops = [], phase = 0 } = {}) {
    this.path = path; this.vmax = vmax; this.accel = accel; this.brake = brake; this.latAccel = latAccel;
    this.stops = [...stops].sort((a, b) => a.s - b.s);
    this.s = path.len * phase; this.v = 0;
    this.state = 'drive'; this.atStop = null; this.dwellLeft = 0;
    // next stop = first one ahead of us
    this.next = Math.max(0, this.stops.findIndex((st) => st.s >= this.s - 0.01));
    if (this.stops.length && this.stops.every((st) => st.s < this.s - 0.01)) this.next = 0;
  }

  distTo(stop) { const d = stop.s - this.s; return this.path.closed ? ((d % this.path.len) + this.path.len) % this.path.len : d; }

  step(dt) {
    if (this.state === 'dwell') {
      this.dwellLeft -= dt;
      if (this.dwellLeft <= 0) { this.state = 'drive'; this.atStop = null; this.next = (this.next + 1) % this.stops.length; }
      return;
    }
    // speed we are allowed right now: top speed, corner limit looking ahead, and a stop braking curve
    let allowed = this.vmax;
    for (const ahead of [0, 8, 16]) allowed = Math.min(allowed, Math.sqrt(this.latAccel / Math.max(1e-4, this.path.curvature(this.s + ahead))));
    allowed = Math.max(allowed, 1.2);
    const stop = this.stops[this.next];
    let gap = Infinity;
    if (stop) { gap = this.distTo(stop); allowed = Math.min(allowed, Math.sqrt(2 * this.brake * Math.max(0, gap)) + 0.4); }
    this.v = this.v < allowed ? Math.min(allowed, this.v + this.accel * dt) : Math.max(allowed, this.v - this.brake * 1.5 * dt);
    const move = this.v * dt;
    if (stop && gap <= move + 0.05) { // arrive exactly on the stop
      this.s = this.path.wrap(stop.s); this.v = 0; this.state = 'dwell'; this.atStop = stop.id; this.dwellLeft = stop.dwell;
      return;
    }
    this.s = this.path.wrap(this.s + move);
  }

  /** rejoin the route at distance s (after somebody else drove this vehicle) */
  resume(s, v = 0) {
    this.s = this.path.wrap(s); this.v = Math.min(Math.abs(v), this.vmax);
    this.state = 'drive'; this.atStop = null; this.dwellLeft = 0;
    const i = this.stops.findIndex((st) => st.s >= this.s - 0.01);
    this.next = i < 0 ? 0 : i;
  }

  pose() { return this.path.sample(this.s); }
}
