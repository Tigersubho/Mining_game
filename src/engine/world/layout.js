import { BRANCHES, SECTOR_ANGLES, SITES, polar, consLoc, DEG, DIVE, RIDGE, HUB_RING, HUB_BRIDGE, HUB_END, ISLAND_R, PIT, PADS } from '../config.js';
import { addKeepOut } from './keepout.js';
import { branchPoint, branchNormal, heightAt, riverS, waterLevelAt } from './terrain.js';
import { planRoad, setExistingRoads, cityWedge } from './roadplan.js';
import { layoutFarm, pickFarmSites } from './farmsite.js';
import { noise2 } from '../noise.js';

// ------------------------------------------------------------- bridges
// {x,z centre, dirx,dirz unit axis, length, width, h deck height, kind}
export const BRIDGES = [];

// the three hub bridges leave the island (r = HUB_BRIDGE.from) and land on the far bank (r = HUB_BRIDGE.to): proper two-lane road bridges
for (const a of Object.values(SECTOR_ANGLES)) {
  const mid = (HUB_BRIDGE.from + HUB_BRIDGE.to) / 2, [cx, cz] = polar(mid, a);
  BRIDGES.push({
    kind: 'road', hub: true, x: cx, z: cz, dirx: Math.cos(a * DEG), dirz: Math.sin(a * DEG),
    length: HUB_BRIDGE.to - HUB_BRIDGE.from, width: HUB_BRIDGE.width, h: 2.0, sector: a,
  });
}
BRANCHES.forEach((_, i) => {
  for (const along of [95, 180]) {
    const [x, z] = branchPoint(i, along);
    const [nx, nz] = branchNormal(i);
    BRIDGES.push({ kind: 'road', x, z, dirx: nx, dirz: nz, length: 46, width: 9, h: 2.1, branch: i, along });
  }
});

const BRIDGE_RAMP = 5; // metres of approach ramp at each end (matches roads.js)
/**
 * Height of the bridge deck surface at (x, z), or null when (x, z) is not on a bridge. Cars that follow a route
 * ride this (not the bare terrain, which is the river bed under a bridge).
 */
export function bridgeDeckY(x, z) {
  for (const b of BRIDGES) {
    const dx = x - b.x, dz = z - b.z, hl = b.length / 2;
    const t = dx * b.dirx + dz * b.dirz;
    if (t < -hl || t > hl) continue;
    if (Math.abs(-dx * b.dirz + dz * b.dirx) > b.width / 2) continue;
    if (b.hA === undefined) { b.hA = heightAt(b.x - b.dirx * hl, b.z - b.dirz * hl); b.hB = heightAt(b.x + b.dirx * hl, b.z + b.dirz * hl); }
    const u = t + hl; // 0 .. length from the A end
    if (u < BRIDGE_RAMP) return b.hA + (b.h - b.hA) * (u / BRIDGE_RAMP) + 0.08;
    if (u > b.length - BRIDGE_RAMP) return b.h + (b.hB - b.h) * ((u - (b.length - BRIDGE_RAMP)) / BRIDGE_RAMP) + 0.08;
    return b.h + 0.08;
  }
  return null;
}

// -------------------------------------------------------------- landings
const SECTOR_NAME = { 90: 'city', 210: 'jungle', 330: 'construction' };
/** end of a cross-river bridge that lies in `region` */
export function landing(branch, along, region) {
  const b = BRIDGES.find((q) => q.kind === 'road' && q.branch === branch && q.along === along);
  for (const side of [1, -1]) {
    const a = (((BRANCHES[branch] + 60 * side) % 360) + 360) % 360;
    if (SECTOR_NAME[a] === region) {
      const t = side * (b.length / 2 - 1);
      return [b.x + b.dirx * t, b.z + b.dirz * t];
    }
  }
  throw new Error('no landing');
}

// ---------------------------------------------------------------- routes
export const ROUTES = []; // {pts, width, color, kind, hw, samples}

function catmull(pts, per = 6) {
  if (pts.length < 3) return pts;
  const out = [];
  const P = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** a -> b with a gentle organic bend */
function link(a, b, bend = 0.18, extra = []) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = Math.hypot(dx, dz) || 1;
  const mid = (t, k) => {
    const off = (noise2(a[0] * 0.05 + k * 7.1, a[1] * 0.05 + b[0] * 0.03, 11) - 0.5) * 2 * bend * L;
    return [a[0] + dx * t - (dz / L) * off, a[1] + dz * t + (dx / L) * off];
  };
  return [a, mid(0.33, 1), mid(0.66, 2), ...extra, b];
}

function addRoute(pts, width, color, kind, id, per = 6) {
  const smooth = catmull(pts, per);
  // dense samples for keep-out queries
  const samples = [];
  for (let i = 0; i < smooth.length - 1; i++) {
    const [x0, z0] = smooth[i], [x1, z1] = smooth[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2.5));
    for (let k = 0; k < n; k++) samples.push(x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n);
  }
  samples.push(smooth[smooth.length - 1][0], smooth[smooth.length - 1][1]);
  const route = { id, pts: smooth, width, color, kind, hw: width / 2, samples };
  ROUTES.push(route);
  return route;
}
export const routeById = (id) => ROUTES.find((r) => r.id === id);

const nearest = (p, list) => list.reduce((best, q) => (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(best[0] - p[0], best[1] - p[1]) ? q : best));

// ---- jungle trails (dirt)
{
  const DIRT = 0x7a6444;
  const hubEnd = polar(HUB_END, 210);
  const camp = SITES.camp, mine = SITES.mine, temple = SITES.temple;
  addRoute(link(hubEnd, camp), 4, DIRT, 'trail', 'trail-camp');
  addRoute(link(camp, mine), 3.5, DIRT, 'trail');
  addRoute(link(camp, temple), 3.5, DIRT, 'trail', 'trail-temple');
  addRoute(link(landing(2, 95, 'jungle'), camp), 3.5, DIRT, 'trail');
  addRoute(link(landing(1, 95, 'jungle'), camp), 3.5, DIRT, 'trail');
  addRoute(link(landing(1, 180, 'jungle'), temple), 3.5, DIRT, 'trail', 'trail-landing');
  addRoute(link(landing(2, 180, 'jungle'), temple), 3.5, DIRT, 'trail');
}
// ---- jungle safari loop: a muddy track the jeeps follow (closed loop; trees are kept off it)
export const MUD_LOOP = [polar(58, 214), polar(95, 226), polar(138, 246), polar(185, 238), polar(205, 214), polar(170, 190), polar(120, 172), polar(85, 190)];
addRoute([...MUD_LOOP, MUD_LOOP[0], MUD_LOOP[1]], 5, 0x4d3b28, 'mud', 'mud-loop');

// ---- construction haul roads (gravel)
{
  const GRAVEL = 0x8c867a;
  const hubEnd = polar(HUB_END, 330);
  const gate = consLoc(62, 0), rim = consLoc(88, 0), floor = consLoc(128, 0);
  const nodeN = consLoc(120, 80), nodeS = consLoc(120, -80);
  addRoute([hubEnd, consLoc(HUB_END + 5, 0), gate, consLoc(75, 0), rim, consLoc(108, 0), floor], 8, GRAVEL, 'haul', 'cons-axis');
  const lN = landing(0, 95, 'construction'), lS = landing(2, 95, 'construction');
  addRoute(link(lN, gate, 0.05), 6, GRAVEL, 'haul', 'cons-north');
  addRoute(link(lS, gate, 0.05), 6, GRAVEL, 'haul', 'cons-south');
  addRoute(link(lN, nodeN, 0.05), 6, GRAVEL, 'haul', 'cons-nodeN');
  addRoute(link(lS, nodeS, 0.05), 6, GRAVEL, 'haul', 'cons-nodeS');
  addRoute(link(landing(0, 180, 'construction'), nodeN, 0.05), 6, GRAVEL, 'haul');
  addRoute(link(landing(2, 180, 'construction'), nodeS, 0.05), 6, GRAVEL, 'haul');
  addRoute(link(nodeN, consLoc(138, 58), 0.05), 6, GRAVEL, 'haul');
  addRoute(link(nodeS, consLoc(138, -58), 0.05), 6, GRAVEL, 'haul');
}
// ---- the hub roundabout + a spoke from it to every bridge, so a car from any sector can drive into any other
{
  const ASPH = 0x3b3d42, N = 72, ring = [];
  for (let k = 0; k <= N; k++) ring.push(polar(HUB_RING, (k / N) * 360));
  addRoute(ring, 8, ASPH, 'street', 'hub-ring');
  for (const a of Object.values(SECTOR_ANGLES)) addRoute([polar(HUB_RING, a), polar((HUB_RING + HUB_BRIDGE.from) / 2, a), polar(HUB_BRIDGE.from + 1.5, a)], HUB_BRIDGE.width, ASPH, 'street', `hub-spoke-${a}`);
  // each bridge's far end continues as a road to its region (city: the avenue; jungle / construction: the trails already start at HUB_END)
  addRoute([polar(HUB_BRIDGE.to - 1, 90), polar(HUB_END + 6, 90), polar(HUB_END + 14, 90)], 12, ASPH, 'street', 'hub-avenue');
}
// ---- city connectors (asphalt) - the grid itself is drawn by city.js
{
  const ASPH = 0x3b3d42;
  const nodes = [[-36, 78], [36, 78], [-72, 114], [72, 114]]; // (intersections that exist inside the wedge)
  for (const [br, along] of [[0, 95], [1, 95], [0, 180], [1, 180]]) {
    const l = landing(br, along, 'city');
    addRoute(link(l, nearest(l, nodes), 0.04), 7, ASPH, 'street');
  }
}

// ---- outer roads + the mine railway (rail line runs beside the ridge road)
export const RAIL = [consLoc(66, -66), [118, -178], [212, -232], [RIDGE.mouth.x - 14, RIDGE.mouth.z + 9]];
{
  const GRAVEL = 0x8c867a;
  addRoute([landing(1, 180, 'jungle'), [-250, 45], [-350, 70], [DIVE.x, DIVE.z]], 6, GRAVEL, 'haul', 'road-lake'); // to the lake dive base
  addRoute([consLoc(120, -80), [150, -195], [240, -250], [RIDGE.mouth.x - 4, RIDGE.mouth.z]], 6, GRAVEL, 'haul', 'road-ridge'); // to Ridge Mine
  addRoute(RAIL, 5, 0x6a6459, 'rail');
  addKeepOut(DIVE.x, DIVE.z, 42);
  addKeepOut(RIDGE.mouth.x, RIDGE.mouth.z, 34);
}

/** spatial index of every road sample (rebuilt when roads are added): nearRoad is called for every tree / prop candidate */
let ROAD_IDX = null, ROAD_COUNT = -1;
const RC = 24;
function roadIndex() {
  if (ROAD_IDX && ROAD_COUNT === ROUTES.length) return ROAD_IDX;
  const m = new Map();
  for (const r of ROUTES) {
    const sm = r.samples;
    for (let i = 0; i < sm.length; i += 2) { const k = Math.floor(sm[i] / RC) * 8192 + Math.floor(sm[i + 1] / RC); let l = m.get(k); if (!l) m.set(k, (l = [])); l.push(sm[i], sm[i + 1], r.hw); }
  }
  ROAD_COUNT = ROUTES.length;
  return (ROAD_IDX = m);
}

/** distance from (x,z) to the nearest route edge (<0 = on a road); 60 when no road is within 60 m */
export function nearRoad(x, z) {
  const m = roadIndex(), cx = Math.floor(x / RC), cz = Math.floor(z / RC);
  let best = 60;
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
    const l = m.get((cx + i) * 8192 + (cz + j)); if (!l) continue;
    for (let k = 0; k < l.length; k += 3) { const d = Math.hypot(l[k] - x, l[k + 1] - z) - l[k + 2]; if (d < best) best = d; }
  }
  return best;
}

// =================================================================================================================================
//  The road network across the open land.
//    perimeter  a road round the city wedge; every city street ends on it (nothing stops in the grass)
//    ring A     r ~ 290 m, a full circle: three river bridges join the three districts
//    ring B     r ~ 500 m, round the construction sector, with arms that run out to the lake and the jungle edge
//    ring C     r ~ 650 m, round the far city plains (the farmland)
//    spokes     link the rings; every other road that would end is joined to the nearest road (see joinDeadEnds)
//  Routes are planned over the real terrain (roadplan.js): dry, gentle, long and straight, merging into roads that already exist.
// =================================================================================================================================
export const NETWORK = { failures: [], skipped: [], bridges: [], routes: [], farms: [] };
const HWY = 0x3b3d42, ROAD_W = 7, GRAVEL_COLOR = 0x8c867a;
const city = { x: (a) => a };
void city;

const roadSamples = () => ROUTES.filter((r) => r.kind !== 'rail').map((r) => r.samples);
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** resample a polyline every `step` metres (the planner returns sparse points; the road mesh wants an even spread) */
function resample(pts, step = 14) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.round(dist2(a, b) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

function lay(pts, id, { width = ROAD_W, color = HWY, kind = 'highway' } = {}) {
  const r = addRoute(resample(pts), width, color, kind, id, 3);
  NETWORK.routes.push(r);
  return r;
}

/** plan through a list of waypoints (each leg A*); returns the joined polyline or null (and records the failure) */
function planThrough(way, tag) {
  setExistingRoads(roadSamples());
  let out = [];
  for (let k = 1; k < way.length; k++) {
    let leg = planRoad(way[k - 1][0], way[k - 1][1], way[k][0], way[k][1]);
    if (!leg) leg = planRoad(way[k - 1][0], way[k - 1][1], way[k][0], way[k][1], { slope: 0.42, free: 60 }); // a steeper road rather than none
    if (!leg) { NETWORK.failures.push(`${tag}: no land route ${way[k - 1].map(Math.round)} -> ${way[k].map(Math.round)}`); return null; }
    out = out.length ? [...out, ...leg.slice(1)] : leg;
  }
  return out;
}

/** a bridge over river `branch` near `around` metres out, at the spot where both banks are flattest and highest */
function outerBridge(branch, around) {
  const [nx, nz] = branchNormal(branch);
  let best = null;
  for (let a = around - 48; a <= around + 48; a += 3) {
    const [cx, cz] = branchPoint(branch, a), e1 = [cx + nx * 22, cz + nz * 22], e2 = [cx - nx * 22, cz - nz * 22], h1 = heightAt(...e1), h2 = heightAt(...e2);
    if (h1 < 1 || h2 < 1 || riverS(...e1) < 9 || riverS(...e2) < 9) continue;
    const rough = Math.abs(h1 - h2) + 0.4 * (Math.abs(heightAt(e1[0] + nx * 16, e1[1] + nz * 16) - h1) + Math.abs(heightAt(e2[0] - nx * 16, e2[1] - nz * 16) - h2)) + 0.01 * Math.abs(a - around);
    if (!best || rough < best.rough) best = { a, rough, cx, cz, h1, h2 };
  }
  if (!best) { NETWORK.failures.push(`bridge: no flat crossing of river ${branch} near ${around}`); const [cx, cz] = branchPoint(branch, around); best = { a: around, cx, cz, h1: 2, h2: 2 }; }
  const h = Math.max(2.1, (best.h1 + best.h2) / 2 + 0.5), b = { kind: 'road', x: best.cx, z: best.cz, dirx: nx, dirz: nz, length: 46, width: 9, h, branch, along: best.a, outer: true };
  BRIDGES.push(b); NETWORK.bridges.push(b);
  // plus = the end on the counter-clockwise side of the river (the next sector round), minus = the other end
  return { b, plus: [best.cx + nx * 22, best.cz + nz * 22], minus: [best.cx - nx * 22, best.cz - nz * 22] };
}

const angles = (a0, a1, n) => Array.from({ length: n + 1 }, (_, k) => a0 + ((a1 - a0) * k) / n);
const onRing = (R, list) => list.map((a) => polar(R, a));

// ---- bridges
const bA = [0, 1, 2].map((i) => outerBridge(i, 290));
NETWORK.ringA = bA; // (bridge heads, for the ring traffic loop)
const bB = { 0: outerBridge(0, 500), 2: outerBridge(2, 500) };
const bC = { 0: outerBridge(0, 650) };

// ---- the city perimeter: an arc just outside the wedge and a straight road up each side
{
  const PR = 236, a0 = 90 - 41, a1 = 90 + 41;
  const arc = planThrough(onRing(PR, angles(a0, a1, 6)), 'perimeter arc');
  if (arc) lay(arc, 'perimeter-arc', { kind: 'street' });
  for (const [a, id] of [[a0, 'perimeter-e'], [a1, 'perimeter-w']]) {
    const side = planThrough([polar(66, a), ...onRing(150, [a]), polar(PR, a)], id);
    if (side) lay(side, id, { kind: 'street' });
  }
}

// ---- ring A (a full circle through the three bridges), ring B and C (arcs through the outer bridges)
/**
 * One arc of a ring, planned leg by leg. A leg the terrain forbids (a pond, a cliff) is skipped and the road continues after it: the
 * pieces left either side are joined to the nearest road by joinDeadEnds. Ring A is essential: a missing leg there is a real failure.
 */
const sector = (name, from, to, R, deg) => {
  const way = [from, ...onRing(R, deg), to].filter(Boolean);
  let acc = null, part = 0;
  const flush = () => { if (acc && acc.length > 1) lay(acc, `${name}-${part++}`); acc = null; };
  setExistingRoads(roadSamples());
  for (let k = 1; k < way.length; k++) {
    const a = way[k - 1], b = way[k];
    const leg = planRoad(a[0], a[1], b[0], b[1]) ?? planRoad(a[0], a[1], b[0], b[1], { slope: 0.42, free: 60 });
    if (!leg) { (name.startsWith('ringA') ? NETWORK.failures : NETWORK.skipped).push(`${name}: ${a.map(Math.round)} -> ${b.map(Math.round)}`); flush(); continue; }
    acc = acc ? [...acc, ...leg.slice(1)] : leg;
  }
  flush();
};
const A = 290, B = 500, C = 650;
sector('ringA-city', bA[0].plus, bA[1].minus, A, angles(60, 120, 3));
sector('ringA-jungle', bA[1].plus, bA[2].minus, A, angles(180, 240, 3));
sector('ringA-construction', bA[2].plus, bA[0].minus, A, angles(300, 360, 3));
sector('ringB-construction', bB[2].plus, bB[0].minus, B, angles(296, 364, 4));
sector('ringB-city', bB[0].plus, null, B, angles(56, 124, 4));
sector('ringB-jungle', bB[2].minus, null, B, angles(244, 176, 4));
sector('ringC-city', bC[0].plus, null, C, angles(56, 124, 4));

// ---- spokes between the rings (each runs from the nearest point on one ring to the nearest on the next)
const ringPts = (prefix) => NETWORK.routes.filter((r) => r.id?.startsWith(prefix));
function nearestOn(routes, x, z) {
  let best = null;
  for (const r of routes) for (let i = 0; i < r.samples.length; i += 2) { const d = Math.hypot(r.samples[i] - x, r.samples[i + 1] - z); if (!best || d < best.d) best = { d, x: r.samples[i], z: r.samples[i + 1] }; }
  return best;
}
function spoke(deg, R0, R1, from, to, id, opt) {
  const a = nearestOn(from, ...polar(R0, deg)), b = nearestOn(to, ...polar(R1, deg));
  if (!a || !b) { NETWORK.skipped.push(`${id}: ring missing`); return; }
  if (a.d > 170 || b.d > 170) { NETWORK.skipped.push(`${id}: no ring near`); return; } // that ring does not reach this direction
  setExistingRoads(roadSamples());
  const p = planRoad(a.x, a.z, b.x, b.z) ?? planRoad(a.x, a.z, b.x, b.z, { slope: 0.42, free: 60 });
  if (p) lay(p, id, opt); else NETWORK.skipped.push(`${id}: no land route`);
}
const perim = ringPts('perimeter'), rA = ringPts('ringA'), rB = ringPts('ringB'), rC = ringPts('ringC');
for (const d of [62, 90, 118]) spoke(d, 236, A, perim, rA, `spoke-PA-${d}`);
for (const d of [62, 90, 118, 196, 236, 300, 336, 6]) spoke(d, A, B, rA, rB, `spoke-AB-${d}`);
for (const d of [74, 104]) spoke(d, B, C, rB, rC, `spoke-BC-${d}`);

// ---- farms: flat open ground a little way off the main roads. Each is a closed gravel track round six fields and a farmyard, joined to the
//      nearest main road by an access road (so no farm road is a dead end), and trees are kept off it
{
  const [ax, az] = [Math.cos(330 * DEG), Math.sin(330 * DEG)], [lx, lz] = [-az, ax];
  const sites = [SITES.camp, SITES.temple, SITES.mine];
  const env = {
    h: (x, z) => heightAt(x, z),
    site: (cx, cz) => {
      const hc = heightAt(cx, cz);
      if (hc < 1.6 || hc > 8 || riverS(cx, cz) < 60) return null;
      let rough = 0;
      for (let k = 0; k < 12; k++) for (const rr of [30, 60]) rough = Math.max(rough, Math.abs(heightAt(cx + Math.cos(k * 30 * DEG) * rr, cz + Math.sin(k * 30 * DEG) * rr) - hc));
      return rough <= 7 ? rough : null;
    },
    free: (x, z) => {
      if (cityWedge(x, z, 34) || Math.hypot(x, z) < 110 || Math.hypot(x - PIT.x, z - PIT.z) < PIT.R + 80 || Math.hypot(x - DIVE.x, z - DIVE.z) < 110) return false;
      if (sites.some(([a, b]) => Math.hypot(x - a, z - b) < 60)) return false;
      if (x > RIDGE.mouth.x - 60 && x < RIDGE.mouth.x + 200 && Math.abs(z - RIDGE.mouth.z) < 120) return false;
      const f = x * ax + z * az, l = x * lx + z * lz;
      return !(f > 20 && f < 200 && Math.abs(l) < 125);
    },
    roadDist: nearRoad,
  };
  const mains = () => ROUTES.filter((r) => r.kind !== 'rail' && !r.id?.startsWith('farm-'));
  pickFarmSites(env, 8).forEach((site) => {
    if (NETWORK.farms.length >= 5) return;
    const farm = layoutFarm(site.cx, site.cz), idx = NETWORK.farms.length;
    // the access road runs from the track to the nearest main road it can actually reach (ponds and slopes can cut off the nearest one)
    const pts = []; for (const r of mains()) for (let k = 0; k < r.samples.length; k += 12) pts.push([Math.hypot(r.samples[k] - farm.cx, r.samples[k + 1] - farm.cz), r.samples[k], r.samples[k + 1]]);
    pts.sort((a, b) => a[0] - b[0]);
    let access = null, gate = null;
    setExistingRoads(roadSamples());
    for (const to of pts.filter((q, n) => n < 40 && (n % 4 === 0)).slice(0, 8)) {
      gate = farm.track.reduce((b2, q) => (!b2 || Math.hypot(q[0] - to[1], q[1] - to[2]) < Math.hypot(b2[0] - to[1], b2[1] - to[2]) ? q : b2), null);
      access = planRoad(to[1], to[2], gate[0], gate[1]);
      if (access) break;
    }
    if (!access) { NETWORK.skipped.push(`farm at ${Math.round(site.cx)},${Math.round(site.cz)}: no access road`); return; }
    const track = addRoute(farm.track, 4, GRAVEL_COLOR, 'haul', `farm-track-${idx}`, 3);
    track.closed = true; NETWORK.routes.push(track);
    lay(access, `farm-road-${idx}`, { kind: 'haul', width: 5, color: GRAVEL_COLOR });
    addKeepOut(farm.cx, farm.cz + 14, 108);
    PADS.push({ x: farm.cx, z: farm.cz + 14, r: 80, blend: 46 }); // level the ground for the farm (fills any pond inside it)
    farm.index = idx; NETWORK.farms.push(farm);
  });
}

// ---- the city: every street that would stop at the edge of the wedge runs into the perimeter
{
  const T38 = Math.tan(38 * DEG), stubs = [];
  for (const x of [-108, -72, -36, 0, 36, 72, 108]) { let zEnd = null; for (let z = 50; z < 260; z += 2) if (Math.hypot(x, z) < 226 && Math.abs(Math.atan2(x, z)) <= 38 * DEG) zEnd = z; if (zEnd) stubs.push([x, zEnd]); }
  for (const z of [78, 114, 150, 186, 222]) for (const s of [-1, 1]) { const xEnd = Math.min(111, z * T38, Math.sqrt(Math.max(0, 226 * 226 - z * z))); if (xEnd > 20) stubs.push([s * xEnd, z]); }
  const per = ringPts('perimeter');
  for (const sx of [-1, 1]) lay([[sx * 43, 50], [sx * 36, 52]], `perimeter-gate-${sx}`, { kind: 'street', width: 6 }); // the perimeter's inner ends meet the first street
  stubs.forEach(([x, z], k) => {
    const n = nearestOn(per, x, z);
    if (n && n.d < 60) lay([[x, z], [n.x, n.z]], `city-stub-${k}`, { kind: 'street', width: 6 });
  });
}

// ---- finally: any road that still stops in the middle of nowhere is joined to the nearest road
const STREET_X = [-108, -72, -36, 0, 36, 72, 108], STREET_Z = [78, 114, 150, 186, 222];
const onCityStreet = (x, z) => cityWedge(x, z, 4) && (STREET_X.some((q) => Math.abs(x - q) < 8) || STREET_Z.some((q) => Math.abs(z - q) < 8));
const touches = (self, x, z, tol = 6) => ROUTES.some((o) => o !== self && o.kind !== 'rail' && o.samples.some((v, i) => i % 2 === 0 && Math.hypot(v - x, o.samples[i + 1] - z) < tol + o.hw))
  || BRIDGES.some((b) => { const hl = b.length / 2; return [-1, 1].some((s) => Math.hypot(b.x + b.dirx * hl * s - x, b.z + b.dirz * hl * s - z) < 8); }) || onCityStreet(x, z);
export function joinDeadEnds(passes = 4) {
  const result = [];
  for (let pass = 0; pass < passes; pass++) {
    let fixed = 0;
    for (const r of [...ROUTES]) {
      if (r.kind === 'rail' || r.closed || r.id === 'mud-loop' || r.id === 'hub-ring') continue;
      for (const end of [r.pts[0], r.pts.at(-1)]) {
        if (touches(r, end[0], end[1])) continue;
        if (heightAt(end[0], end[1]) < waterLevelAt(end[0], end[1]) + 0.6) continue; // a ramp that runs into the water is a landing, not a dead end
        const others = ROUTES.filter((o) => o !== r && o.kind !== 'rail' && !o.id?.startsWith('link-'));
        const cands = [];
        for (const o of others) for (let i = 0; i < o.samples.length; i += 8) cands.push([Math.hypot(o.samples[i] - end[0], o.samples[i + 1] - end[1]), o.samples[i], o.samples[i + 1], !!o.id && /^(ring|spoke|perimeter)/.test(o.id)]);
        cands.sort((a, b) => a[0] - b[0] - (b[3] - a[3]) * 60); // a nearby ring / spoke is worth up to 60 m of extra distance
        let ok = false;
        for (const c of cands.slice(0, 14)) {
          if (c[0] < 3) { ok = true; break; }
          setExistingRoads(roadSamples());
          const p = planRoad(end[0], end[1], c[1], c[2]) ?? planRoad(end[0], end[1], c[1], c[2], { slope: 0.42, free: 60 }) ?? planRoad(end[0], end[1], c[1], c[2], { slope: 0.58, free: 80 }); // a service link may be steeper than a main road
          if (p) { addRoute(resample(p), 6, GRAVEL_COLOR, 'haul', `link-${r.id ?? r.kind}-${result.length}`, 3); result.push(`${r.id ?? r.kind}@${end.map(Math.round)}`); ok = true; fixed++; break; }
        }
        if (!ok) {
          if (NETWORK.routes.includes(r)) { // a generated stub the terrain will not let us join: remove it rather than leave a dead end
            ROUTES.splice(ROUTES.indexOf(r), 1); NETWORK.routes.splice(NETWORK.routes.indexOf(r), 1); NETWORK.skipped.push(`removed unjoinable stub ${r.id}`); fixed++; break;
          }
          NETWORK.failures.push(`dead end not joined: ${r.id ?? r.kind} at ${end.map(Math.round)}`);
        }
      }
    }
    if (!fixed) break;
  }
  return result;
}
NETWORK.joined = joinDeadEnds();
// the mud loop is a closed circuit: make sure it is joined to the road it starts beside
{
  const mud = ROUTES.find((r) => r.id === 'mud-loop');
  if (mud && !touches(mud, mud.pts[0][0], mud.pts[0][1], 10)) {
    const near = nearestOn(ROUTES.filter((r) => r !== mud && r.kind !== 'rail'), mud.pts[0][0], mud.pts[0][1]);
    if (near && near.d < 120) { setExistingRoads(roadSamples()); const p = planRoad(mud.pts[0][0], mud.pts[0][1], near.x, near.z); if (p) addRoute(resample(p), 4, GRAVEL_COLOR, 'trail', 'link-mud-loop', 3); }
  }
}

/**
 * A graph of the whole road network for tests and tools: routes and bridges are nodes, joined where they meet (an end within `tol` m of
 * another road's body or a bridge head); the city street grid counts as one node. Returns { components: [[names]], dangling: [names] }
 * where `dangling` lists route ends that touch nothing and are not at the water (a road that just stops).
 */
export function roadGraph(tol = 10) {
  const routes = ROUTES.filter((r) => r.kind !== 'rail'), name = (r, i) => r.id ?? `${r.kind}-${i}`;
  const node = new Map(routes.map((r, i) => [r, name(r, i)])), parent = new Map();
  const find = (a) => { if (!parent.has(a)) parent.set(a, a); while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
  const join = (a, b) => parent.set(find(a), find(b));
  routes.forEach((r) => find(node.get(r))); BRIDGES.forEach((_, i) => find(`bridge-${i}`)); find('CITY');
  const dangling = [];
  for (const r of routes) {
    if (r.closed || r.id === 'mud-loop' || r.id === 'hub-ring') { /* closed circuits have no ends, but they still have to join something below */ }
    const circuit = r.closed || r.id === 'mud-loop' || r.id === 'hub-ring';
    const ends = circuit ? r.pts.filter((_, i) => i % 3 === 0) : [r.pts[0], r.pts.at(-1)]; // a closed circuit may join a road anywhere along it
    let anyHit = false;
    for (const e of ends) {
      let hit = false;
      for (const o of routes) if (o !== r && o.samples.some((v, i) => i % 2 === 0 && Math.hypot(v - e[0], o.samples[i + 1] - e[1]) < tol + o.hw)) { join(node.get(r), node.get(o)); hit = true; }
      BRIDGES.forEach((b, i) => { const hl = b.length / 2; if ([-1, 1].some((sg) => Math.hypot(b.x + b.dirx * hl * sg - e[0], b.z + b.dirz * hl * sg - e[1]) < tol)) { join(node.get(r), `bridge-${i}`); hit = true; } });
      if (onCityStreet(e[0], e[1])) { join(node.get(r), 'CITY'); hit = true; }
      anyHit ||= hit;
      if (!circuit && !hit && heightAt(e[0], e[1]) >= waterLevelAt(e[0], e[1]) + 0.6) dangling.push(`${node.get(r)}@${Math.round(e[0])},${Math.round(e[1])}`);
    }
    if (circuit && !anyHit) dangling.push(`${node.get(r)} (a closed circuit joined to nothing)`);
  }
  const groups = new Map();
  for (const a of parent.keys()) { const root = find(a); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(a); }
  return { components: [...groups.values()], dangling, route: (n) => routes.find((r, i) => name(r, i) === n) };
}

// ---- the network must be ONE piece: any island of roads (e.g. two arcs that only joined each other) is linked to the main network
{
  for (let pass = 0; pass < 8; pass++) {
    const g = roadGraph(10);
    if (g.components.length <= 1) break;
    g.components.sort((a, b) => b.length - a.length);
    const main = g.components[0].map((n) => g.route(n)).filter(Boolean);
    let linked = false;
    for (const comp of g.components.slice(1)) {
      const mine = comp.map((n) => g.route(n)).filter(Boolean);
      if (!mine.length) continue;
      let best = null;
      for (const r of mine) for (let i = 0; i < r.samples.length; i += 8) { const n = nearestOn(main, r.samples[i], r.samples[i + 1]); if (n && (!best || n.d < best.d)) best = { d: n.d, from: [r.samples[i], r.samples[i + 1]], to: [n.x, n.z] }; }
      let ok = false;
      if (best) { setExistingRoads(roadSamples()); const p = planRoad(best.from[0], best.from[1], best.to[0], best.to[1]) ?? planRoad(best.from[0], best.from[1], best.to[0], best.to[1], { slope: 0.42, free: 60 }); if (p) { addRoute(resample(p), 6, GRAVEL_COLOR, 'haul', `link-island-${pass}`, 3); ok = true; linked = true; } }
      if (!ok && mine.every((r) => NETWORK.routes.includes(r) || r.id?.startsWith('link-'))) { for (const r of mine) { ROUTES.splice(ROUTES.indexOf(r), 1); if (NETWORK.routes.includes(r)) NETWORK.routes.splice(NETWORK.routes.indexOf(r), 1); } NETWORK.skipped.push(`removed unreachable island ${comp.join(',')}`); linked = true; }
    }
    if (!linked) break;
  }
}
