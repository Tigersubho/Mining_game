import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROUTES, BRIDGES, NETWORK, roadGraph, nearRoad } from '../../src/engine/world/layout.js';
import { heightAt, waterLevelAt, regionWeights } from '../../src/engine/world/terrain.js';
import { wetAt } from '../../src/engine/agents/safety.js';
import { planRoad, cityWedge } from '../../src/engine/world/roadplan.js';
import { layoutFarm, FARM } from '../../src/engine/world/farmsite.js';
import { getGeology } from '../../src/engine/survey/geology.js';
import { WORLD_R } from '../../src/engine/config.js';

describe('the road network', () => {
  const graph = roadGraph(10);
  it('is ONE connected network: every road, bridge and the city grid join the rest', () => {
    expect(graph.components.length, graph.components.map((c) => c.slice(0, 4).join(',')).join(' | ')).toBe(1);
  });
  it('no road just stops: every end meets another road, a bridge, a city street or the water', () => {
    expect(graph.dangling).toEqual([]);
  });
  it('has the pieces it should: a perimeter round the city, the ring road with its bridges, spokes, farm roads', () => {
    const ids = NETWORK.routes.map((r) => r.id);
    for (const part of ['perimeter-arc', 'ringA-city', 'ringA-jungle', 'ringA-construction']) expect(ids.some((i) => i.startsWith(part)), part).toBe(true);
    expect(ids.filter((i) => i.startsWith('spoke-')).length).toBeGreaterThanOrEqual(8);
    expect(ids.filter((i) => i.startsWith('city-stub-')).length).toBeGreaterThanOrEqual(12);
    expect(NETWORK.failures).toEqual([]);
    expect(NETWORK.bridges.length).toBeGreaterThanOrEqual(5);
  });
  it('the three ring-road bridges leave dry land at both ends and sit at the height of the banks', () => {
    for (const { b, plus, minus } of NETWORK.ringA) {
      expect(wetAt(...plus)).toBe(false); expect(wetAt(...minus)).toBe(false);
      expect(Math.abs(heightAt(...plus) - heightAt(...minus))).toBeLessThan(6);
      expect(b.h).toBeGreaterThanOrEqual(Math.min(heightAt(...plus), heightAt(...minus)) - 1);
    }
  });
  it('no road ever runs through water (a bridge deck is not a road route; the flooded pit ramp is the one landing)', () => {
    for (const r of ROUTES) {
      if (r.kind === 'rail' || r.id === 'cons-axis') continue;
      for (let i = 0; i < r.samples.length; i += 8) expect(wetAt(r.samples[i], r.samples[i + 1]), `${r.id ?? r.kind} at ${Math.round(r.samples[i])},${Math.round(r.samples[i + 1])}`).toBe(false);
    }
  });
  it('the new roads are gentle: no steeper than 1 in 2 over any 6 m', () => {
    for (const r of NETWORK.routes) for (let i = 0; i + 12 < r.samples.length; i += 12) {
      const dh = Math.abs(heightAt(r.samples[i], r.samples[i + 1]) - heightAt(r.samples[i + 12], r.samples[i + 13])), d = Math.hypot(r.samples[i] - r.samples[i + 12], r.samples[i + 1] - r.samples[i + 13]);
      expect(dh / Math.max(d, 1), r.id).toBeLessThan(0.55);
    }
  });
  it('every city street that reaches the edge of the wedge runs into the perimeter road', () => {
    const per = NETWORK.routes.filter((r) => r.id.startsWith('perimeter'));
    const dist = (x, z) => Math.min(...per.map((r) => { let d = 1e9; for (let i = 0; i < r.samples.length; i += 2) d = Math.min(d, Math.hypot(r.samples[i] - x, r.samples[i + 1] - z)); return d; }));
    for (const x of [-72, -36, 0, 36, 72]) { let zEnd = 0; for (let z = 50; z < 260; z += 2) if (Math.hypot(x, z) < 226 && Math.abs(Math.atan2(x, z)) <= (38 * Math.PI) / 180) zEnd = z; expect(dist(x, zEnd + 3), `x=${x}`).toBeLessThan(25); }
  });
  it('the open land is served: at most a quarter of the land is more than 150 m from a road', () => {
    let land = 0, far = 0;
    for (let x = -700; x <= 700; x += 40) for (let z = -700; z <= 700; z += 40) { if (Math.hypot(x, z) > WORLD_R - 80 || heightAt(x, z) < waterLevelAt(x, z) + 0.5) continue; land++; if (nearRoad(x, z) > 150 - 3.5) far++; }
    expect(far / land).toBeLessThan(0.28);
  });
  it('nearRoad (spatially indexed) agrees with the plain search', () => {
    const slow = (x, z) => { let best = 60; for (const r of ROUTES) for (let i = 0; i < r.samples.length; i += 2) best = Math.min(best, Math.hypot(r.samples[i] - x, r.samples[i + 1] - z) - r.hw); return best; };
    for (const [x, z] of [[0, 120], [150, -60], [-300, 40], [400, 300], [10, 10]]) expect(nearRoad(x, z)).toBeCloseTo(slow(x, z), 3);
  });
});

describe('the road planner', () => {
  it('finds dry, gentle, near-straight roads and never crosses water', () => {
    const p = planRoad(60, 120, 250, 160);
    expect(p).toBeTruthy();
    for (let k = 1; k < p.length; k++) for (let t = 0; t <= 1; t += 0.25) { const x = p[k - 1][0] + (p[k][0] - p[k - 1][0]) * t, z = p[k - 1][1] + (p[k][1] - p[k - 1][1]) * t; expect(wetAt(x, z)).toBe(false); }
    const len = p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
    expect(len).toBeLessThan(Math.hypot(190, 40) * 1.3);
  });
  it('says so when two places are not connected by land (a river with no bridge between them)', () => {
    expect(planRoad(60, 200, -400, 330)).toBeNull();
  });
  it('keeps out of the city wedge', () => { expect(cityWedge(0, 100, 0)).toBe(true); expect(cityWedge(0, 300, 0)).toBe(false); });
});

describe('farms', () => {
  const geo = getGeology();
  it('there are farms on open ground, in more than one part of the map', () => {
    expect(NETWORK.farms.length).toBeGreaterThanOrEqual(3);
    const sector = (f) => { const a = ((Math.atan2(f.cz, f.cx) * 180) / Math.PI + 360) % 360; return a >= 30 && a < 150 ? 'city' : a >= 150 && a < 270 ? 'jungle' : 'construction'; };
    expect(new Set(NETWORK.farms.map(sector)).size).toBeGreaterThanOrEqual(2);
    expect(NETWORK.farms.some((f) => regionWeights(f.cx, f.cz).city > 0.7)).toBe(true); // the open southern plains
  });
  it('every farm: four fields on dry ground, a closed track, an access road, a yard', () => {
    for (const f of NETWORK.farms) {
      expect(f.fields).toHaveLength(FARM.cols * FARM.rows);
      for (const fl of f.fields) expect(heightAt(fl.x0 + fl.w / 2, fl.z0 + fl.d / 2)).toBeGreaterThan(waterLevelAt(f.cx, f.cz) + 0.5);
      expect(ROUTES.some((r) => r.id === `farm-track-${f.index}` && r.closed)).toBe(true);
      expect(ROUTES.some((r) => r.id === `farm-road-${f.index}`)).toBe(true);
      expect(f.house.z).toBeGreaterThan(f.fields[0].z0 + FARM.fieldD);
    }
  });
  it('the ground under each farm is levelled (the farm is not on a slope) and is kept clear of trees', () => {
    for (const f of NETWORK.farms) {
      const hs = f.fields.flatMap((fl) => [[fl.x0, fl.z0], [fl.x0 + fl.w, fl.z0], [fl.x0, fl.z0 + fl.d], [fl.x0 + fl.w, fl.z0 + fl.d]]).map(([x, z]) => heightAt(x, z));
      expect(Math.max(...hs) - Math.min(...hs), `farm ${f.index}`).toBeLessThan(2.2);
    }
  });
  it('there is something to find under every farm (hidden deposits and a decoy), and they move with each shift', () => {
    for (const f of NETWORK.farms) expect(geo.features.filter((q) => q.layer === 'surface' && Math.hypot(q.x - f.cx, q.z - f.cz) < 70).length, `farm ${f.index}`).toBeGreaterThanOrEqual(2);
  });
  it('the farm layout is deterministic', () => { expect(JSON.stringify(layoutFarm(100, 200))).toBe(JSON.stringify(layoutFarm(100, 200))); });
});

describe('nothing sits idle', () => {
  it('the city no longer has parked cars (they never moved)', () => {
    const src = readFileSync(new URL('../../src/engine/world/city.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\bcar\(B, col/);
    expect(src).toMatch(/no parked cars/);
  });
  it('the construction site has no parked trucks; its excavator is animated', () => {
    const src = readFileSync(new URL('../../src/engine/world/construction.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/dumpTruck\(B|mixerTruck\(B|[^a-zA-Z]excavator\(B/);
    expect(src).toMatch(/armPose/);
  });
});
