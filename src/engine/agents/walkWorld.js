import { Graph } from './graph.js';
import { STOPS, corner } from './fleet.js';
import { CITY_GRID, inCity } from '../world/city.js';
import { ROUTES } from '../world/layout.js';
import { branchPoint } from '../world/terrain.js';
import { SITES, consLoc, polar, DIVE, ISLAND_R, HUB_BRIDGE, HUB_END } from '../config.js';

const { XS, XW, ZS, ZW } = CITY_GRID;
const pierPt = (s, lat = 0) => { const [tx, tz] = DIVE.toWater; return [DIVE.x + tx * s - tz * lat, DIVE.z + tz * s + tx * lat]; };
const SECTORS = [90, 210, 330];

/** The place NPCs walk around in: one graph (disconnected islands where only a vehicle can bridge the gap). */
export function buildWalkWorld() {
  const g = new Graph();
  const near = (x, z, max = 6) => { const id = g.nearest(x, z); return id >= 0 && Math.hypot(g.nodes[id].x - x, g.nodes[id].z - z) <= max ? id : -1; };
  const node = (x, z, tag = '', max = 0.01) => { const id = max > 0 ? near(x, z, max) : -1; return id >= 0 ? id : g.add(x, z, tag); };

  // ---- city: the four sidewalk corners of every intersection, linked round the blocks
  const key = (i, j, sx, sz) => `${i},${j},${sx},${sz}`, C = new Map();
  for (let i = 0; i < XS.length; i++) for (let j = 0; j < ZS.length; j++) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [x, z] = corner(i, j, sx, sz);
    if (inCity(x, z, 0)) C.set(key(i, j, sx, sz), g.add(x, z, i === 3 || j === 2 ? 'patrol' : ''));
  }
  const L = (a, b, mid = false) => {
    const A = C.get(a), B = C.get(b);
    if (A === undefined || B === undefined) return;
    if (!mid) return g.link(A, B);
    const n = g.nodes, m = g.add((n[A].x + n[B].x) / 2, (n[A].z + n[B].z) / 2, ['office', 'office', 'cafe', 'bench', 'patrol', 'office'][(A * 7 + B) % 6]);
    g.link(A, m); g.link(m, B);
  };
  for (let i = 0; i < XS.length; i++) for (let j = 0; j < ZS.length; j++) for (const s of [-1, 1]) {
    L(key(i, j, -1, s), key(i, j, 1, s)); // across the vertical street
    L(key(i, j, s, -1), key(i, j, s, 1)); // across the horizontal street
    L(key(i, j, 1, s), key(i + 1, j, -1, s), true); // along a sidewalk, east
    L(key(i, j, s, 1), key(i, j + 1, s, -1), true); // along a sidewalk, north
  }

  // ---- hub plaza: an inner ring round the monument, an outer promenade (benches), spokes between them, then a chain of nodes along each bridge
  const ring = [], outer = [], OR = ISLAND_R - 4.5;
  for (let k = 0; k < 24; k++) ring.push(g.add(...polar(5.6, k * 15), 'plaza'));
  ring.forEach((r, k) => g.link(r, ring[(k + 1) % 24]));
  for (let k = 0; k < 24; k++) outer.push(g.add(...polar(OR, k * 15), [135, 165, 255, 285].includes(k * 15) ? 'bench' : 'plaza'));
  outer.forEach((r, k) => { g.link(r, outer[(k + 1) % 24]); g.link(r, ring[k]); });
  const bridgeEnd = {};
  for (const a of [...SECTORS, 150]) {
    const radii = a === 150 ? [ISLAND_R + 2.5] : [HUB_BRIDGE.from + 2.5, 29, 35, 41, HUB_END];
    const chain = radii.map((r) => g.add(...polar(r, a)));
    g.link(outer[a / 15], chain[0]); chain.slice(1).forEach((n, k) => g.link(chain[k], n));
    bridgeEnd[a] = chain.at(-1);
  }
  const quayNode = g.add(...STOPS.quay.at, 'quay'); g.link(bridgeEnd[150], quayNode);

  // ---- city <-> hub: the avenue's sidewalk corners nearest the bridge end
  {
    const e = g.nodes[bridgeEnd[90]];
    [...C.values()].sort((p, q) => Math.hypot(g.nodes[p].x - e.x, g.nodes[p].z - e.z) - Math.hypot(g.nodes[q].x - e.x, g.nodes[q].z - e.z)).slice(0, 2).forEach((c) => g.link(bridgeEnd[90], c));
  }

  // ---- jungle: trails sampled every ~18 m, plus the camp, the temple stairs and the trailhead
  for (const r of ROUTES.filter((q) => q.kind === 'trail')) {
    let prev = -1, acc = 1e9;
    for (let k = 0; k < r.pts.length; k++) {
      const [x, z] = r.pts[k], last = k === r.pts.length - 1;
      if (k > 0) acc += Math.hypot(x - r.pts[k - 1][0], z - r.pts[k - 1][1]);
      if (acc < 18 && !last && prev >= 0) continue;
      acc = 0;
      const n = node(x, z, '', 6);
      if (prev >= 0 && n !== prev) g.link(prev, n);
      prev = n;
    }
  }
  const [cx, cz] = SITES.camp, [tx, tz] = SITES.temple, [hx, hz] = polar(HUB_END + 5, 210);
  const addPoi = (x, z, tag) => { const id = g.add(x, z, tag); g.link(id, g.nearest(x, z, (n) => n.id !== id && n.x < 0 && n.z < 5 && n.tag !== 'bench')); return id; };
  const trailhead = addPoi(hx, hz, 'trailhead'); g.link(trailhead, bridgeEnd[210]);
  addPoi(cx + 4, cz - 3, 'camp'); addPoi(tx + 18, tz, 'temple');
  for (const id of ['safari_trail', 'safari_camp', 'safari_temple']) addPoi(...STOPS[id].at, 'jeep_stop');

  // ---- mining area (consLoc: f along the sector axis, l sideways)
  const M = (f, l, tag) => g.add(...consLoc(f, l), tag);
  const m0 = M(HUB_END + 3, 5, ''), mYard = M(47, 6.5, 'mine_rest'), mGate = M(62, 6.5, 'mine_rest'), mRim = M(78, 6.5, 'mine_work');
  const mCab = M(68, 12, 'mine_rest'), mBld = M(76, 28, 'mine_work'), mYa = M(46, -10, 'mine_work'), mYb = M(56, -22, 'mine_work'), mPark = M(60, -6, 'parking');
  [[m0, mYard], [mYard, mGate], [mGate, mRim], [mGate, mCab], [mCab, mBld], [mYard, mYa], [mYa, mYb], [mYa, mPark], [mPark, mGate]].forEach(([a, b]) => g.link(a, b));
  g.link(m0, bridgeEnd[330]);

  // ---- river bank (jungle landing) and the dive base shore + pier
  const landing = g.add(...STOPS.landing.at, 'landing');
  [[188, 17.5, 'fish_spot'], [214, 17.5, 'fish_spot'], [200, 22, 'bench_bank']].forEach(([a, l, t]) => g.link(landing, g.add(...branchPoint(1, a, l), t)));
  const shed = g.add(...pierPt(1, 7), 'dive_shed'), p6 = g.add(...pierPt(6, 0), 'pier'), p25 = g.add(...pierPt(25, 0), 'pier'), p45 = g.add(...pierPt(45, 0), 'pier'), pEnd = g.add(...pierPt(61, 0), 'pier_end');
  [[shed, p6], [p6, p25], [p25, p45], [p45, pEnd]].forEach(([a, b]) => g.link(a, b));
  const boatPier = g.add(...STOPS.pier.at, 'boat_pier'); g.link(p45, boatPier);

  // ---- stop registry: stop id -> graph node
  const stops = {};
  const exact = { quay: quayNode, landing, pier: boatPier, mine_yard: mYard, mine_gate: mGate, mine_rim: mRim };
  for (const [id, s] of Object.entries(STOPS)) stops[id] = { node: exact[id] ?? g.nearest(...s.at), kinds: s.kinds, at: s.at };
  const diveSpot = () => ({ x: pierPt(72, 0)[0], z: pierPt(72, 0)[1], depth: 8 });

  // ---- who lives where (18 characters)
  const spawns = [];
  const choose = (tags, n, type, seed) => {
    const pool = g.nodes.filter((q) => tags.includes(q.tag));
    for (let k = 0; k < n; k++) spawns.push({ type, node: pool[(seed + k * 7 + k * k * 3) % pool.length].id });
  };
  choose(['office'], 4, 'office', 3); choose(['patrol'], 2, 'police', 5); choose(['bench', 'cafe'], 2, 'civilian', 1); choose(['plaza'], 1, 'civilian', 4);
  choose(['mine_work'], 3, 'miner', 0); choose(['mine_rest', 'parking'], 2, 'driver', 1);
  choose(['dive_shed', 'pier'], 2, 'scuba', 0); choose(['fish_spot'], 1, 'fisherman', 0); choose(['camp'], 1, 'guide', 0);
  return { graph: g, stops, spawns, diveSpot };
}
