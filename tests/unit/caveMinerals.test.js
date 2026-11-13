import { describe, it, expect } from 'vitest';
import { newLamp, stepLamp, toggleLamp, lampBeam, LAMP_SECONDS, LAMP_LOW } from '../../src/engine/player/headlamp.js';
import { SPREAD_INTERVAL, createMineralSpread } from '../../src/engine/gameplay/mineralSpread.js';
import { getGeology, HAND_DEPTH, LAYERS } from '../../src/engine/survey/geology.js';
import { Excavator, stagingPoint, DIG_BASE, DIG_PER_M, CYCLE, armIK, armFK } from '../../src/engine/survey/excavator.js';
import { sonarContacts } from '../../src/engine/gameplay/sonar.js';
import { SITES_LIST } from '../../src/engine/world/caveSites.js';
import { heightAt, waterLevelAt, PIT_WATER_Y } from '../../src/engine/world/terrain.js';
import { wetAt } from '../../src/engine/agents/safety.js';
import { PIT, LAKE, WATER_Y } from '../../src/engine/config.js';

describe('headlamp', () => {
  const run = (l, secs, opt) => { let ev = []; for (let t = 0; t < secs; t += 1) { const r = stepLamp(l, 1, opt); l = r.lamp; if (r.event) ev.push(r.event); } return { l, ev }; };
  it('starts off with a full battery: caves are dark until you switch it on', () => { const l = newLamp(); expect(l.on).toBe(false); expect(l.battery).toBe(100); expect(lampBeam(l).intensity).toBe(0); });
  it('runs for 15 minutes, warns once when low, then cuts out', () => {
    let l = toggleLamp(newLamp()).lamp; expect(l.on).toBe(true);
    const r = run(l, LAMP_SECONDS + 1);
    expect(r.l.on).toBe(false); expect(r.l.battery).toBeLessThan(4); // cut out at 0, then starts to recharge
    expect(r.ev.filter((e) => e === 'low')).toHaveLength(1);
    expect(r.ev).toContain('flat');
  });
  it('a flat lamp will not switch on, and recharges while off (faster in daylight than in the dark)', () => {
    const flat = { on: false, battery: 0, warned: true };
    expect(toggleLamp(flat).event).toBe('flat');
    const dark = run(flat, 60, { dark: true }).l.battery, light = run(flat, 60, { dark: false }).l.battery;
    expect(dark).toBeGreaterThan(0); expect(light).toBeGreaterThan(dark * 3);
  });
  it('the beam is stronger inside a cave, tinted and shorter under water, and dims as the battery runs flat', () => {
    const on = { on: true, battery: 100, warned: false };
    expect(lampBeam(on, { cave: 1 }).intensity).toBeGreaterThan(lampBeam(on, { cave: 0 }).intensity);
    const uw = lampBeam(on, { underwater: true }), air = lampBeam(on, { cave: 1 });
    expect(uw.distance).toBeLessThan(air.distance); expect(uw.color).not.toBe(air.color);
    expect(lampBeam({ ...on, battery: LAMP_LOW / 3 }, { cave: 1 }).intensity).toBeLessThan(air.intensity);
  });
});

describe('hidden minerals: layers, depth and the 15-minute shift', () => {
  const geo = getGeology(), caves = SITES_LIST.map((x) => x.cave());
  const inLayer = (l) => geo.features.filter((f) => f.layer === l);
  it('shifts every 15 minutes of play', () => { expect(SPREAD_INTERVAL).toBe(900); });
  it('minerals live in four layers: the surface, the rock of each cave, and the lake / river / pit beds', () => {
    expect(LAYERS).toEqual(['surface', 'cave0', 'cave1', 'water']);
    for (const l of LAYERS) expect(inLayer(l).filter((f) => f.kind === 'deposit').length, l).toBeGreaterThan(2);
  });
  it('cave deposits are inside their own cave; water deposits are really under water', () => {
    for (const f of inLayer('cave0')) expect(caves[0].open(f.x, f.z)).toBe(true);
    for (const f of inLayer('cave1')) expect(caves[1].open(f.x, f.z)).toBe(true);
    for (const f of inLayer('water')) expect(heightAt(f.x, f.z)).toBeLessThan(waterLevelAt(f.x, f.z) - 1);
  });
  it('rock and bed deposits are shallow (a pickaxe reaches them); the surface has both shallow and deep ones', () => {
    for (const f of [...inLayer('cave0'), ...inLayer('cave1'), ...inLayer('water')]) expect(f.depth).toBeLessThanOrEqual(HAND_DEPTH);
    const surf = inLayer('surface').filter((f) => f.kind === 'deposit');
    expect(surf.some((f) => f.depth <= HAND_DEPTH)).toBe(true);
    expect(surf.some((f) => f.depth > HAND_DEPTH)).toBe(true);
  });
  it('a sensor reads only the layer it is in: a cave body is invisible from the hill above and vice versa', () => {
    const f = inLayer('cave0').find((q) => q.kind === 'deposit' && q.props.mag > 100) ?? inLayer('cave0')[0];
    geo.layer = 'cave0'; const inside = geo.measure('ip', f.x, f.z, 1); geo.layer = 'surface'; const above = geo.measure('ip', f.x, f.z, 1);
    geo.layer = 'surface';
    expect(Math.abs(inside - above)).toBeGreaterThan(0.2);
    expect(geo.bodyAt(f.x, f.z, 'cave0')?.id).toBe(f.id);
  });
  it('a shift re-rolls everything: new places, same rules, deterministic per epoch', () => {
    const snap = () => JSON.stringify(geo.deposits.map((d) => [d.layer, d.type, Math.round(d.x), Math.round(d.z)]));
    const e0 = geo.epoch; geo.reshuffle(5); const a = snap(); geo.reshuffle(6); const b = snap(); geo.reshuffle(5); const c = snap();
    expect(a).toBe(c); expect(a).not.toBe(b);
    const keys = (s) => new Set(JSON.parse(s).map((d) => `${d[2]},${d[3]}`)); const A = keys(a), B = keys(b);
    expect([...A].filter((k) => B.has(k)).length).toBeLessThan(A.size * 0.1);
    for (const l of LAYERS) expect(inLayer(l).length, l).toBeGreaterThan(0);
    geo.reshuffle(e0);
  });
  it('the shift clock fires exactly once per 15 minutes, clears survey data and publishes the countdown', () => {
    const log = []; const store = { set: (p) => log.push(p), get: () => ({ notices: [] }) };
    let cleared = 0; const survey = { onReshuffle: () => { cleared++; } };
    const e0 = geo.epoch; geo.reshuffle(0);
    const sp = createMineralSpread({ geo, survey, store });
    expect(Math.round(sp.left)).toBe(900);
    for (let t = 0; t < 899; t++) sp.update(1);
    expect(cleared).toBe(0); expect(geo.epoch).toBe(0);
    sp.update(2); expect(cleared).toBe(1); expect(geo.epoch).toBe(1);
    expect(log.some((p) => p.spread)).toBe(true);
    sp.skip(); sp.update(0); expect(cleared).toBe(2); expect(geo.epoch).toBe(2);
    geo.reshuffle(e0);
  });
});

describe('the excavator (ore deeper than a pickaxe reaches)', () => {
  it('hand tools reach 1.5 m', () => { expect(HAND_DEPTH).toBe(1.5); });
  it('starts its run from dry ground with a dry line to the site, never from or across water', () => {
    for (const [x, z] of [[75, -20], [-150, -60], [200, 150], [-300, 40]]) {
      const [sx, sz] = stagingPoint(x, z);
      expect(wetAt(sx, sz), `${x},${z}`).toBe(false);
    }
  });
  it('drives in, digs for a time that grows with depth, exposes the ore once, waits, then leaves', () => {
    const bursts = []; const scene = { add() {} }, particles = { burst: (...a) => bursts.push(a) };
    const ex = new Excavator(scene, particles), site = { x: 75, z: -20, y: heightAt(75, -20), depth: 3 };
    const eta = ex.call(site);
    expect(ex.busy).toBe(true); expect(ex.state).toBe('mobilising');
    expect(eta).toBeGreaterThan(DIG_BASE + DIG_PER_M * 3);
    const events = []; let seen = new Set(); let tDug = -1, t = 0;
    for (; t < 400 && ex.busy; t += 0.1) { const e = ex.update(0.1); seen.add(ex.state); if (e) events.push(e); if (e === 'dug') tDug = t; }
    for (const st of ['mobilising', 'driving', 'digging', 'done', 'leaving']) expect(seen.has(st), st).toBe(true);
    expect(events).toEqual(['dug', 'gone']);
    expect(bursts.length).toBeGreaterThan(10); // soil flies while it digs
    expect(ex.busy).toBe(false);
    // a deeper hole takes longer
    const ex2 = new Excavator(scene, particles); ex2.call({ x: 75, z: -20, y: 1.5, depth: 5 });
    expect(ex2.dur).toBeGreaterThan(ex.dur);
  });
  it('only one job at a time', () => {
    const ex = new Excavator({ add() {} }, { burst() {} }); ex.call({ x: 0, z: 100, y: 1.5, depth: 2 });
    expect(ex.busy).toBe(true);
  });
  it('the arm goes where it is told (the joint solver round-trips)', () => {
    for (const [d, y] of [[6.3, -1.1], [4.5, -1.6], [4.2, 0.8], [5.5, -2.4]]) { const r = armFK(armIK(d, y, 0)); expect(r.d).toBeCloseTo(d, 3); expect(r.y).toBeCloseTo(y, 3); }
  });
  it('every scoop the bucket goes down INTO the pit at the dig site, then lifts clear and tips its load on a heap beside the machine', () => {
    const bursts = [], ex = new Excavator({ add() {} }, { burst: (...a) => bursts.push(a) }), site = { x: 75, z: -20, y: heightAt(75, -20), depth: 3 };
    ex.call(site);
    for (let t = 0; ex.state !== 'digging' && t < 300; t += 0.05) ex.update(0.05);
    expect(ex.state).toBe('digging');
    bursts.length = 0;
    let low = Infinity, lowAt = null, high = -Infinity, loaded = 0;
    for (let k = 0; k < CYCLE / 0.05; k++) { ex.update(0.05); const b = ex.bucketWorld(); if (b.y < low) { low = b.y; lowAt = [b.x, b.z]; } high = Math.max(high, b.y); if (ex.mesh.userData.load.visible) loaded++; }
    expect(low).toBeLessThan(site.y + 0.6);                                    // down to the ground / into the pit
    expect(Math.hypot(lowAt[0] - site.x, lowAt[1] - site.z)).toBeLessThan(2.5); // ... at the dig site, not out in the air beyond it
    expect(high).toBeGreaterThan(site.y + 1.5);                                // lifted clear to swing
    expect(loaded).toBeGreaterThan(10);                                        // it carries soil part of the cycle
    expect(bursts.length).toBe(2);                                             // one bite, one dump per scoop
    const dump = bursts[1];                                                    // the load falls well away from the pit
    expect(Math.hypot(dump[0] - site.x, dump[2] - site.z)).toBeGreaterThan(4);
    expect(ex.heap).toBeTruthy();
  });
});

describe('ore never gives itself away', () => {
  it('sonar reports rock outcrops, never the mineral inside', () => {
    const list = sonarContacts([{ x: 0, y: -12, z: 10, type: 'gold', alive: true }, { x: 5, y: -12, z: 20, type: 'hematite', alive: true }], { x: 0, y: -10, z: 0 }, 0, -0.2);
    expect(list).toHaveLength(2);
    expect(new Set(list.map((c) => c.name)).size).toBe(1);
    expect(new Set(list.map((c) => c.color)).size).toBe(1);
    expect(list[0].name).toBe('Rock outcrop');
  });
});
