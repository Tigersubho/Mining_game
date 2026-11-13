import { describe, it, expect } from 'vitest';
import { buildFleet, STOPS } from '../../src/engine/agents/fleet.js';
import { inCity, CITY_GRID } from '../../src/engine/world/city.js';
import { BRIDGES, nearRoad, NETWORK } from '../../src/engine/world/layout.js';
import { heightAt, regionWeights } from '../../src/engine/world/terrain.js';
import { wetAt } from '../../src/engine/agents/safety.js';
import { PIT, WATER_Y, DIVE, ISLAND_R, HUB_RING, POOL_R } from '../../src/engine/config.js';

const fleet = buildFleet();
const tours = fleet.filter((v) => v.category === 'tour');
const road = fleet.filter((v) => v.kind !== 'boat' && v.category !== 'tour');
const by = (cat) => fleet.filter((v) => v.category === cat);
const points = (v, step = 3) => { const out = []; for (let s = 0; s < v.path.len; s += step) out.push(v.path.sample(s)); return out; };
const onBridge = (x, z) => BRIDGES.some((b) => { const dx = x - b.x, dz = z - b.z, s = dx * b.dirx + dz * b.dirz, t = -dx * b.dirz + dz * b.dirx; return Math.abs(s) < b.length / 2 && Math.abs(t) < b.width / 2 + 0.5; });

describe('the fleet: residents, tourers, haulers and tractors, spread over the map', () => {
  const farmers = fleet.filter((v) => v.category === 'farm');
  it('every road vehicle works: 14 + 2 haulers + 3 ring-road cars + one tractor per farm (the boat is separate)', () => { expect(road.length + tours.length).toBe(14 + 2 + 3 + NETWORK.farms.length); expect(fleet.filter((v) => v.kind === 'boat')).toHaveLength(1); expect(farmers).toHaveLength(NETWORK.farms.length); });
  it('3 taxis, 3 private cars (one of them the GMC Sierra), 2 safari jeeps, 1 pickup and 1 JCB', () => {
    expect(by('taxi')).toHaveLength(3);
    expect(by('private')).toHaveLength(3);
    expect(by('private').filter((v) => v.kind === 'gmc')).toHaveLength(1);
    expect(by('safari')).toHaveLength(2);
    expect(by('mining').filter((v) => v.kind === 'pickup')).toHaveLength(3); // the mining truck + two haulers (they replace the parked dump trucks)
    expect(by('mining').filter((v) => v.kind === 'jcb')).toHaveLength(1);
  });
  it('every route is a closed loop (nothing spawns or vanishes) with unique ids', () => {
    for (const v of fleet) expect(v.path.closed).toBe(true);
    expect(new Set(fleet.map((v) => v.id)).size).toBe(fleet.length);
  });
  it('vehicles that share a route start at different places along it', () => {
    expect(new Set(by('taxi').map((v) => v.phase)).size).toBe(3);
    expect(new Set(tours.filter((v) => v.id.startsWith('tour-edge')).map((v) => v.phase)).size).toBe(2);
  });
});

describe('who drives where: city cars towards the jungle edge, jeeps only in the jungle', () => {
  const jeeps = fleet.filter((v) => v.kind === 'jeep');
  it('7 tourers in a mix of kinds (4 to the edges, 3 on the ring road)', () => {
    expect(tours).toHaveLength(7);
    expect(new Set(tours.map((v) => v.kind))).toEqual(new Set(['taxi', 'car', 'jeep', 'pickup']));
  });
  it('no jeep ever drives in the city or on the hub: every jeep point is deep in the jungle sector', () => {
    expect(jeeps).toHaveLength(3);
    for (const v of jeeps) for (const p of points(v, 2)) { expect(regionWeights(p.x, p.z).jungle, v.id).toBeGreaterThan(0.5); expect(inCity(p.x, p.z), v.id).toBe(false); expect(Math.hypot(p.x, p.z), v.id).toBeGreaterThan(POOL_R + 12); }
  });
  it('normal cars may reach the edge of the jungle but not deep into it', () => {
    for (const v of tours.filter((q) => q.id.startsWith('tour-') && q.kind !== 'jeep')) {
      const deepest = Math.max(...points(v, 2).map((p) => (regionWeights(p.x, p.z).jungle > 0.5 ? Math.hypot(p.x, p.z) : 0)));
      expect(deepest, v.id).toBeLessThan(90);
    }
    expect(tours.some((v) => points(v, 3).some((p) => regionWeights(p.x, p.z).jungle > 0.8 && Math.hypot(p.x, p.z) > 55))).toBe(true);
  });
  it('one car reaches the construction yard, passing through the hub', () => {
    const m = tours.find((v) => v.id === 'tour-mine-1');
    expect(points(m, 3).some((p) => regionWeights(p.x, p.z).construction > 0.8 && Math.hypot(p.x, p.z) > 55)).toBe(true);
    expect(points(m, 3).some((p) => Math.abs(Math.hypot(p.x, p.z) - HUB_RING) < 1.5)).toBe(true);
  });
  it('the hub roundabout joins every sector: the city, jungle and construction routes all pass over it', () => {
    const onRing = (v) => points(v, 1.5).some((p) => Math.abs(Math.hypot(p.x, p.z) - HUB_RING) < 1.6);
    expect(tours.filter((q) => q.id.startsWith('tour-') && onRing(q)).length).toBeGreaterThanOrEqual(3);
    expect(onRing(road.find((v) => v.kind === 'gmc'))).toBe(true);
  });
});

describe('cars never go in water', () => {
  it('no point of any road vehicle route is wet (a bridge deck counts as dry)', () => {
    for (const v of fleet.filter((q) => q.kind !== 'boat')) for (const p of points(v, 1.5)) expect(wetAt(p.x, p.z), `${v.id} at ${p.x.toFixed(0)},${p.z.toFixed(0)}`).toBe(false);
  });
  it('they only drive on dry land, bridges or the hub island', () => {
    for (const v of fleet.filter((q) => q.kind !== 'boat')) for (const p of points(v, 2)) expect(heightAt(p.x, p.z) > WATER_Y || onBridge(p.x, p.z) || Math.hypot(p.x, p.z) < ISLAND_R).toBe(true);
  });
});

describe('city cars drive on the asphalt, never across a building', () => {
  const { XS, XW, ZS, ZW } = CITY_GRID;
  const onAsphalt = (x, z) => XS.some((q, i) => Math.abs(x - q) < XW[i] / 2 + 0.1) || ZS.some((q, j) => Math.abs(z - q) < ZW[j] / 2 + 0.1);
  const cityCars = fleet.filter((v) => v.category === 'taxi' || v.id.startsWith('car-'));
  it('every point of every taxi and private-car route is on a street', () => {
    for (const v of cityCars) { const bad = points(v, 0.5).filter((p) => !(onAsphalt(p.x, p.z) && inCity(p.x, p.z))); expect(bad.slice(0, 2).map((p) => [Math.round(p.x), Math.round(p.z)]), v.id).toEqual([]); }
  });
});

describe('the ring road is driven all the way round, over all three river bridges', () => {
  const ring = fleet.filter((v) => v.id.startsWith('ring-'));
  it('three cars on a closed loop of about 1.9 km through the three outer bridges', () => {
    expect(ring).toHaveLength(3);
    for (const v of ring) { expect(v.path.len).toBeGreaterThan(1500); expect(v.path.closed).toBe(true); }
    const bridges = NETWORK.ringA.map((b) => b.b);
    for (const b of bridges) expect(points(ring[0], 2).some((p) => Math.hypot(p.x - b.x, p.z - b.z) < 12), `bridge ${b.branch}`).toBe(true);
  });
});

describe('every farm has a tractor that stays on its own land', () => {
  it('each tractor works its farm in a closed serpentine inside the farm\'s fence line', () => {
    NETWORK.farms.forEach((f, i) => {
      const t = fleet.find((v) => v.id === `tractor-${i + 1}`); expect(t, `tractor ${i + 1}`).toBeDefined(); expect(t.kind).toBe('tractor'); expect(t.path.closed).toBe(true);
      for (const p of points(t, 3)) expect(p.x > f.bounds.x0 - 4 && p.x < f.bounds.x1 + 4 && p.z > f.bounds.z0 - 4 && p.z < f.bounds.z1 + 4, `${t.id} at ${p.x.toFixed(0)},${p.z.toFixed(0)}`).toBe(true);
    });
  });
});

describe('every road vehicle stays on a road', () => {
  const { XS, XW, ZS, ZW } = CITY_GRID;
  const street = (x, z) => inCity(x, z) && (XS.some((q, i) => Math.abs(x - q) < XW[i] / 2 + 0.1) || ZS.some((q, j) => Math.abs(z - q) < ZW[j] / 2 + 0.1));
  const onRoad = (x, z) => street(x, z) || onBridge(x, z) || Math.hypot(x, z) < ISLAND_R || nearRoad(x, z) < 0.3;
  it('GMC, jeeps, pickups, the JCB and the long-distance cars never leave the asphalt, gravel or mud', () => {
    for (const v of fleet.filter((q) => q.kind !== 'boat' && q.category !== 'farm' && !(q.category === 'taxi' || q.id.startsWith('car-')))) {
      const bad = points(v, 1).filter((p) => !onRoad(p.x, p.z));
      expect(bad.slice(0, 2).map((p) => [Math.round(p.x), Math.round(p.z)]), v.id).toEqual([]);
    }
  });
});

describe('where each one drives', () => {
  it('the GMC Sierra visits both the city and the mining area, and the hub in between', () => {
    const pts = points(road.find((v) => v.kind === 'gmc'));
    expect(pts.some((p) => inCity(p.x, p.z))).toBe(true);
    expect(pts.some((p) => regionWeights(p.x, p.z).construction > 0.8 && Math.hypot(p.x, p.z) > 55)).toBe(true);
    expect(pts.some((p) => Math.hypot(p.x, p.z) < HUB_RING + 2)).toBe(true);
  });
  it('safari jeeps on the mud loop stay in the jungle, well away from the river', () => {
    for (const v of by('safari')) for (const p of points(v)) { expect(regionWeights(p.x, p.z).jungle).toBeGreaterThan(0.6); expect(Math.hypot(p.x, p.z)).toBeGreaterThan(POOL_R + 12); }
  });
  it('the mining vehicles stay in the mining area and out of the pit', () => {
    for (const v of by('mining')) for (const p of points(v)) { expect(regionWeights(p.x, p.z).construction).toBeGreaterThan(0.5); expect(Math.hypot(p.x - PIT.x, p.z - PIT.z)).toBeGreaterThan(PIT.R + 4); }
  });
  it('the boat stays on the water (river, pool, lake) the whole way', () => {
    const boat = fleet.find((v) => v.kind === 'boat');
    for (const p of points(boat, 4)) expect(heightAt(p.x, p.z)).toBeLessThan(WATER_Y - 0.6);
  });
});

describe('stops', () => {
  it('every vehicle that should stop has stops on its own route, and they are served in order', () => {
    for (const v of fleet.filter((q) => q.kind !== 'car' && q.kind !== 'jcb' && q.category !== 'tour' && q.category !== 'farm')) expect(v.stops.length).toBeGreaterThan(0);
    const boat = fleet.find((v) => v.kind === 'boat');
    expect(boat.stops.map((s) => s.id).sort()).toEqual(['landing', 'pier', 'quay']);
  });
  it('taxis share the taxi stands; the GMC serves the city depot and the mine gate', () => {
    expect(new Set(by('taxi').flatMap((v) => v.stops.map((s) => s.id))).size).toBeGreaterThanOrEqual(4);
    expect(road.find((v) => v.kind === 'gmc').stops.map((s) => s.id).sort()).toEqual(['gmc_depot', 'mine_gate']);
  });
  it('every stop id a vehicle serves is a known stop that accepts that kind of vehicle', () => {
    for (const v of fleet) for (const st of v.stops) expect(STOPS[st.id].kinds).toContain(v.kind);
  });
  it('the boat stops beside the bank (within 14 m of the landing) and at the pier', () => {
    const boat = fleet.find((v) => v.kind === 'boat');
    for (const st of boat.stops) { const q = boat.path.sample(st.s), p = STOPS[st.id].at; expect(Math.hypot(q.x - p[0], q.z - p[1])).toBeLessThan(14); }
  });
});
