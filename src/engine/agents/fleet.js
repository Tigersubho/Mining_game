import { makePath, offsetPoints, outAndBack, chaikin, roundCorners } from './path.js';
import { CITY_GRID } from '../world/city.js';
import { routeById, MUD_LOOP, NETWORK } from '../world/layout.js';
import { branchPoint } from '../world/terrain.js';
import { consLoc, polar, LAKE, DIVE, DEG, HUB_RING, HUB_BRIDGE, ISLAND_R, SITES } from '../config.js';
import { SPECS } from './drive.js';

const { XS, XW, ZS, ZW } = CITY_GRID;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** sidewalk corner of intersection (i, j): sx, sz in {-1, +1} pick which of the four corners */
export const corner = (i, j, sx, sz, off = 1.7) => [XS[i] + sx * (XW[i] / 2 + off), ZS[j] + sz * (ZW[j] / 2 + off)];

// ---------------------------------------------------------------- stop positions (the walk graph puts a node on each)
const pierPt = (s, lat = 0) => { const [tx, tz] = DIVE.toWater; return [DIVE.x + tx * s - tz * lat, DIVE.z + tz * s + tx * lat]; };
const lakeAng = (deg, r) => [LAKE.x + Math.cos(deg * DEG) * r, LAKE.z + Math.sin(deg * DEG) * r];
const bankPt = (along, lat) => branchPoint(1, along, lat);

export const STOPS = {
  taxi_hub: { at: corner(3, 1, +1, -1), kinds: ['taxi'] },
  taxi_mid: { at: corner(3, 2, -1, -1, 1.7), kinds: ['taxi'] },
  taxi_east: { at: corner(4, 3, +1, -1), kinds: ['taxi'] },
  taxi_hq: { at: corner(4, 4, -1, -1), kinds: ['taxi'] },
  taxi_west: { at: corner(1, 3, -1, -1), kinds: ['taxi'] },
  gmc_depot: { at: corner(3, 1, -1, -1), kinds: ['gmc'] },
  mine_gate: { at: consLoc(62, 6.5), kinds: ['gmc', 'pickup'] },
  mine_yard: { at: consLoc(47, 6.5), kinds: ['pickup'] },
  mine_rim: { at: consLoc(78, 6.5), kinds: ['pickup'] },
  safari_trail: { at: polar(58, 214), kinds: ['jeep'] },
  safari_camp: { at: polar(80, 206), kinds: ['jeep'] },
  safari_temple: { at: polar(138, 246), kinds: ['jeep'] },
  quay: { at: polar(ISLAND_R + 8, 150), kinds: ['boat'] },
  landing: { at: bankPt(200, 15), kinds: ['boat'] },
  pier: { at: pierPt(45, 2.4), kinds: ['boat'] },
};

// ---------------------------------------------------------------- helpers
const rect = (...c) => c; // corner list
const arc = (r, a0, a1, n) => Array.from({ length: n + 1 }, (_, k) => polar(r, lerp(a0, a1, k / n)));
/** straight run along the direction `deg` from radius r0 to r1 */
const spoke = (deg, r0, r1, n) => Array.from({ length: n + 1 }, (_, k) => polar(lerp(r0, r1, k / n), deg));
const stopsOn = (path, ids, dwell = 4, within = 9) => ids
  .map((id) => { const s = path.nearestS(...STOPS[id].at), q = path.sample(s); return { id, s, d: Math.hypot(q.x - STOPS[id].at[0], q.z - STOPS[id].at[1]), dwell }; })
  .filter((st) => st.d < within).map(({ id, s, dwell: dw }) => ({ id, s, dwell: dw }));
const cityLoop = (cs, reverse = false) => roundCorners(offsetPoints(reverse ? [...cs].reverse() : cs, 1.5, true), 4.5, true);
const ALL_TAXI_STOPS = ['taxi_hub', 'taxi_mid', 'taxi_east', 'taxi_hq', 'taxi_west'];

// city rectangles (grid intersections that really exist inside the wedge-shaped city)
const R_A = rect([XS[2], ZS[1]], [XS[4], ZS[1]], [XS[4], ZS[3]], [XS[2], ZS[3]]);
const R_B = rect([XS[1], ZS[2]], [XS[5], ZS[2]], [XS[5], ZS[4]], [XS[1], ZS[4]]); // (the z5 corners at x1 / x5 lie outside the city: no street there)
const R_C = rect([XS[3], ZS[1]], [XS[4], ZS[1]], [XS[4], ZS[4]], [XS[3], ZS[4]]);
const R_D = rect([XS[1], ZS[3]], [XS[2], ZS[3]], [XS[2], ZS[4]], [XS[1], ZS[4]]);
const R_E = rect([XS[4], ZS[2]], [XS[5], ZS[2]], [XS[5], ZS[3]], [XS[4], ZS[3]]);
const R_F = rect([XS[0], ZS[3]], [XS[6], ZS[3]], [XS[6], ZS[4]], [XS[0], ZS[4]]);
const R_G = rect([XS[2], ZS[4]], [XS[4], ZS[4]], [XS[4], ZS[5]], [XS[2], ZS[5]]);

/**
 * The whole fleet. 15 resident road vehicles + 12 long-distance tourers + 1 boat. Every route is a CLOSED loop, so nothing ever spawns or vanishes.
 *  4 taxis (city only)  5 private cars (city only)  1 GMC Sierra (city <-> mine)  2 safari jeeps (jungle mud loop)
 *  2 pickups + 1 JCB (mining area)
 */
export function buildFleet() {
  const defs = [];
  const add = (d) => { const path = makePath(d.loop, true); defs.push({ ...d, path, stops: d.stopIds ? stopsOn(path, d.stopIds, d.dwell ?? 4, d.within ?? 12) : [] }); };

  // taxis
  add({ id: 'taxi-1', kind: 'taxi', category: 'taxi', vmax: 9, seats: 3, phase: 0.0, loop: cityLoop(R_A), stopIds: ALL_TAXI_STOPS });
  add({ id: 'taxi-2', kind: 'taxi', category: 'taxi', vmax: 9, seats: 3, phase: 0.35, loop: cityLoop(R_B), stopIds: ALL_TAXI_STOPS });
  add({ id: 'taxi-3', kind: 'taxi', category: 'taxi', vmax: 9, seats: 3, phase: 0.6, loop: cityLoop(R_C, true), stopIds: ALL_TAXI_STOPS });
  // private cars: two stay in the city ...
  [[R_D, false, 0.1], [R_G, false, 0.3]].forEach(([r, rev, ph], i) =>
    add({ id: `car-${i + 1}`, kind: 'car', category: 'private', vmax: 8 + (i % 3), seats: 0, phase: ph, loop: cityLoop(r, rev) }));
  // ... and the GMC Sierra commutes city -> hub roundabout -> mine -> hub -> city ...
  const avenue = [[0, 100], [0, 80], [0, 62], ...spoke(90, HUB_BRIDGE.to + 6, HUB_RING, 8)]; // down the avenue, over the hub bridge, onto the roundabout
  const toMine0 = [...avenue, ...arc(HUB_RING, 90, -30, 12), ...spoke(330, HUB_RING, 62, 10)];
  const out = [...toMine0, consLoc(74, 0)];
  add({ id: 'gmc', kind: 'gmc', category: 'private', vmax: 11, seats: 4, phase: 0, loop: chaikin(outAndBack(out, 0.9), true, 2), stopIds: ['gmc_depot', 'mine_gate'], dwell: 5, within: 12 });
  // safari jeeps on the mud loop
  const mudRoad = routeById('mud-loop').pts.slice(0, MUD_LOOP.length * 6); // the road's own curve, closed (it repeats its first points)
  const mud = (rev) => chaikin(offsetPoints(rev ? [...mudRoad].reverse() : mudRoad, 1.2, true), true, 1);
  add({ id: 'jeep-1', kind: 'jeep', category: 'safari', vmax: 7, seats: 3, phase: 0, loop: mud(false), stopIds: ['safari_trail', 'safari_camp', 'safari_temple'], dwell: 5, within: 30 });
  add({ id: 'jeep-2', kind: 'jeep', category: 'safari', vmax: 7, seats: 3, phase: 0.5, loop: mud(true), stopIds: ['safari_trail', 'safari_camp', 'safari_temple'], dwell: 5, within: 30 });
  // mining area: two pickups + a JCB backhoe
  const axis = [consLoc(50, 0), consLoc(62, 0), consLoc(72, 0), consLoc(80, 0)];
  add({ id: 'pickup-1', kind: 'pickup', category: 'mining', vmax: 8, seats: 2, phase: 0, loop: chaikin(outAndBack(axis, 3.0), true, 2), stopIds: ['mine_yard', 'mine_gate', 'mine_rim'], dwell: 4, within: 9 });
  add({ id: 'jcb', kind: 'jcb', category: 'mining', vmax: 3.2, seats: 0, phase: 0.2, loop: chaikin(outAndBack(routeById('cons-nodeN').pts, 1.7), true, 2) });

  // ---- long-distance traffic: mixed cars on the highways that reach the whole world (out and back, right-hand lane)
  const rid = (id, rev = false) => { const p = routeById(id).pts; return rev ? [...p].reverse() : p; };
  const join = (...parts) => parts.reduce((acc, p) => (acc.length ? [...acc, ...p.slice(1)] : [...p]), []);
  // every long route runs: city avenue -> hub bridge -> the hub roundabout -> the bridge to the next sector. The hub is the
  // junction where a car from one area can turn into another.
  // city cars stop at the jungle's edge: over the hub bridge, then along the real jungle trail (which bends away from the straight line) until r = 66
  const trailEdge = []; for (const p of rid('trail-camp')) { trailEdge.push(p); if (Math.hypot(p[0], p[1]) > 66) break; }
  const toJungle = [...avenue, ...arc(HUB_RING, 90, 210, 10), ...spoke(210, HUB_RING, HUB_BRIDGE.to, 8), ...trailEdge.slice(1)];
  const toMine = toMine0;
  const mineRun = [...toMine, consLoc(70, 0), consLoc(78, 0)];
  // river landing -> temple, all on the jungle trail. The temple has solid stairs, so the jeep turns round at the edge of the temple pad
  const TP = SITES.temple, TR = 30;
  const jungleTrail = []; for (const p of rid('trail-landing')) { jungleTrail.push(p); if (Math.hypot(p[0] - TP[0], p[1] - TP[1]) < TR) break; }
  const tour = (id, kind, route, phase) => {
    const sp = SPECS[kind];
    add({ id, kind, category: 'tour', vmax: sp.cruise * 1.6, seats: kind === 'taxi' ? 3 : 0, phase, loop: chaikin(outAndBack(route, 0.9), true, 1) });
  };
  tour('tour-edge-1', 'taxi', toJungle, 0);
  tour('tour-edge-2', 'car', toJungle, 0.5);
  tour('tour-mine-1', 'car', mineRun, 0.3);
  tour('tour-jungle-1', 'jeep', jungleTrail, 0.2);

  // ---- hauler trucks: the dump trucks and the mixer that used to stand idle on the site now work the haul roads all day
  add({ id: 'hauler-1', kind: 'pickup', category: 'mining', vmax: 8, seats: 2, phase: 0.35, loop: chaikin(outAndBack(routeById('cons-south').pts, 3.0), true, 2), stopIds: ['mine_gate'], dwell: 4, within: 14 });
  add({ id: 'hauler-2', kind: 'pickup', category: 'mining', vmax: 8, seats: 2, phase: 0.8, loop: chaikin(outAndBack([...routeById('cons-north').pts].reverse(), 3.0), true, 2), stopIds: ['mine_gate'], dwell: 4, within: 14 });

  // ---- a tractor on every farm, working the rows in a serpentine and coming back along the edge of the field block
  NETWORK.farms.forEach((farm, i) => add({ id: `tractor-${i + 1}`, kind: 'tractor', category: 'farm', vmax: SPECS.tractor.cruise, seats: 0, phase: (i * 0.37) % 1, loop: chaikin(farm.rows, true, 2) }));

  // ---- the ring road: a full circle through the three river bridges, so there is traffic out in the open land too
  {
    const [b0, b1, b2] = NETWORK.ringA ?? [], part = (prefix) => NETWORK.routes.filter((r) => r.id?.startsWith(prefix)).flatMap((r) => r.pts);
    const city = part('ringA-city'), jungle = part('ringA-jungle'), cons = part('ringA-construction');
    if (b0 && b1 && b2 && city.length && jungle.length && cons.length) {
      const loop = join(city, [b1.minus, b1.plus], jungle, [b2.minus, b2.plus], cons, [b0.minus, b0.plus, city[0]]);
      const ring = (id, kind, phase) => add({ id, kind, category: 'tour', vmax: SPECS[kind].cruise * 1.7, seats: kind === 'taxi' ? 3 : 0, phase, loop: chaikin(offsetPoints(loop, 1.7, true), true, 1) });
      ring('ring-car-1', 'car', 0.05); ring('ring-pickup-1', 'pickup', 0.38); ring('ring-car-2', 'car', 0.7);
    }
  }

  // the river boat: hub quay -> jungle landing -> dive-base pier, and back again
  const lat = (a) => 7 * smooth01(28, 70, a);
  const river = [];
  river.push(STOPS.quay.at); // the boat starts at the quay jetty, then follows the river out of the pool
  for (let a = 40; a <= 385; a += 15) river.push(branchPoint(1, a, lat(a)));
  const lake = [lakeAng(-34, 150), lakeAng(-44, 134), lakeAng(-58, 122), lakeAng(-72, 117), lakeAng(-79, 117)];
  const toPier = [...river, ...lake, [pierPt(45, 8.5)[0], pierPt(45, 8.5)[1]]];
  add({ id: 'boat', kind: 'boat', category: 'boat', vmax: 4.8, seats: 5, phase: 0, loop: chaikin([...toPier, ...[...toPier].reverse().slice(1, -1)], true, 2), stopIds: ['quay', 'landing', 'pier'], dwell: 12, within: 14 });
  return defs;
}
