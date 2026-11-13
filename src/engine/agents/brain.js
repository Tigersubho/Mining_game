/**
 * What each kind of character does with its day, and what it is willing to ride.
 *   visit: node tags it walks to     rides: vehicle kinds it may board     pRide: chance that its next trip is a ride
 *   pDive: (scuba) chance that its next trip is a dive       dwell: seconds it lingers at a place
 */
export const ROLES = {
  office: { visit: ['office', 'cafe', 'bench'], rides: ['taxi'], pRide: 0.3, speed: [1.2, 1.6], dwell: [10, 30] },
  police: { visit: ['patrol'], rides: [], pRide: 0, speed: [1.1, 1.4], dwell: [6, 14] },
  civilian: { visit: ['bench', 'cafe', 'plaza', 'office'], rides: ['taxi', 'boat', 'jeep', 'gmc'], pRide: 0.25, speed: [1.0, 1.5], dwell: [12, 40] },
  miner: { visit: ['mine_work', 'mine_rest'], rides: ['pickup', 'gmc'], pRide: 0.3, speed: [1.2, 1.6], dwell: [10, 25] },
  driver: { visit: ['mine_rest', 'parking'], rides: ['pickup', 'gmc', 'taxi'], pRide: 0.4, speed: [1.2, 1.6], dwell: [8, 20] },
  scuba: { visit: ['dive_shed', 'pier'], rides: ['boat'], pRide: 0.2, pDive: 0.5, speed: [1.1, 1.5], dwell: [10, 25] },
  fisherman: { visit: ['fish_spot', 'bench_bank'], rides: ['boat'], pRide: 0.25, speed: [0.9, 1.2], dwell: [25, 60] },
  guide: { visit: ['camp', 'trailhead', 'temple'], rides: ['jeep'], pRide: 0.4, speed: [1.2, 1.6], dwell: [10, 30] },
};

const WAIT_MAX = 90;
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const between = (rng, [a, b]) => a + (b - a) * rng();

/**
 * One character's behaviour. step(dt, env) advances it; x, z, h, mode, depth describe where it is.
 * env: { rng, graph, stops: {id: {node, kinds}}, vehicleAt(stopId, kinds) -> vehicle | null }
 * A vehicle looks like { kind, atStop, stopIds, seats, passengers: [] } and is "dwelling" when atStop is set.
 * modes: idle | walk | wait | ride | dive
 */
export class Brain {
  constructor({ id, type, graph, node, rng, diveSpot = null }) {
    this.id = id; this.type = type; this.role = { ...ROLES[type] }; this.graph = graph; this.rng = rng; this.diveSpot = diveSpot;
    this.node = node; this.x = graph.nodes[node].x; this.z = graph.nodes[node].z; this.h = 0;
    this.mode = 'idle'; this.timer = 1 + rng() * 6; this.speed = between(rng, this.role.speed);
    this.path = []; this.leg = 0; this.goal = null; this.vehicle = null; this.dest = null; this.depth = 0; this.dive = null; this.tag = graph.nodes[node].tag;
  }

  get visible() { return this.mode !== 'ride'; }

  step(dt, env) {
    const fn = this[`_${this.mode}`];
    fn.call(this, dt, env);
  }

  _idle(dt, env) {
    if ((this.timer -= dt) > 0) return;
    this._plan(env);
  }

  _plan(env) {
    const g = this.graph, comp = g.component(this.node), r = this.role, rng = this.rng;
    if (r.pDive && this.diveSpot && rng() < r.pDive) {
      const goal = g.nodes.find((n) => n.tag === 'pier_end' && comp.has(n.id));
      if (goal) return this._goTo(goal.id, { kind: 'dive' });
    }
    if (r.rides.length && rng() < r.pRide) {
      const stops = Object.entries(env.stops).filter(([, s]) => comp.has(s.node) && s.kinds.some((k) => r.rides.includes(k)));
      if (stops.length) { const [sid, s] = pick(rng, stops); return this._goTo(s.node, { kind: 'ride', stop: sid }); }
    }
    const places = g.nodes.filter((n) => r.visit.includes(n.tag) && comp.has(n.id) && n.id !== this.node);
    if (!places.length) { this.timer = 5 + rng() * 5; return; }
    this._goTo(pick(rng, places).id, { kind: 'visit' });
  }

  _goTo(target, goal) {
    const p = this.graph.path(this.node, target);
    if (!p || p.length < 2) { this.mode = 'idle'; this.timer = 4; if (goal.kind === 'ride') this._arrived(goal, target); return; }
    this.path = p; this.leg = 0; this.goal = goal; this.mode = 'walk';
    this.speed = between(this.rng, this.role.speed);
  }

  _walk(dt, env) {
    let budget = this.speed * dt;
    const g = this.graph;
    while (budget > 0 && this.leg < this.path.length - 1) {
      const to = g.nodes[this.path[this.leg + 1]], dx = to.x - this.x, dz = to.z - this.z, d = Math.hypot(dx, dz);
      this.h = Math.atan2(dx, dz);
      if (d <= budget) { this.x = to.x; this.z = to.z; budget -= d; this.leg++; this.node = this.path[this.leg]; this.tag = to.tag; }
      else { this.x += (dx / d) * budget; this.z += (dz / d) * budget; budget = 0; }
    }
    if (this.leg >= this.path.length - 1) this._arrived(this.goal, this.node, env);
  }

  _arrived(goal, node) {
    this.tag = this.graph.nodes[node].tag;
    if (goal.kind === 'ride') { this.mode = 'wait'; this.timer = WAIT_MAX; this.stop = goal.stop; return; }
    if (goal.kind === 'dive') {
      const spot = this.diveSpot(this.graph.nodes[node]);
      this.dive = { ...spot, t: 0, dur: 40 + this.rng() * 40, a0: this.rng() * 6.28, from: node };
      this.mode = 'dive'; return;
    }
    this.mode = 'idle'; this.timer = between(this.rng, this.role.dwell);
  }

  _wait(dt, env) {
    const v = env.vehicleAt(this.stop, this.role.rides);
    if (v && v.passengers.length < v.seats) {
      const options = v.stopIds.filter((s) => s !== this.stop && env.stops[s]);
      if (options.length) {
        v.passengers.push(this); this.vehicle = v; this.dest = pick(this.rng, options); this.mode = 'ride'; return;
      }
    }
    if ((this.timer -= dt) <= 0) { this.mode = 'idle'; this.timer = 5 + this.rng() * 10; }
  }

  _ride(dt, env) {
    const v = this.vehicle;
    if (v.atStop === this.dest) { // arrived and doors open: step out at the stop
      v.passengers.splice(v.passengers.indexOf(this), 1);
      const n = this.graph.nodes[env.stops[this.dest].node];
      this.node = n.id; this.x = n.x; this.z = n.z; this.tag = n.tag; this.vehicle = null; this.dest = null;
      this.mode = 'idle'; this.timer = between(this.rng, this.role.dwell);
    }
  }

  _dive(dt) {
    const d = this.dive;
    d.t += dt;
    const k = Math.min(1, d.t / 6, (d.dur - d.t) / 6); // ease down and back up
    const a = d.a0 + d.t * 0.12;
    this.x = d.x + Math.cos(a) * 9 * Math.max(0.2, k); this.z = d.z + Math.sin(a) * 9 * Math.max(0.2, k);
    this.h = a + Math.PI / 2;
    this.depth = Math.max(0, k) * d.depth;
    if (d.t >= d.dur) {
      const n = this.graph.nodes[d.from];
      this.x = n.x; this.z = n.z; this.depth = 0; this.node = n.id; this.mode = 'idle'; this.timer = between(this.rng, this.role.dwell); this.dive = null;
    }
  }
}
