import { describe, it, expect } from 'vitest';
import { buildWalkWorld } from '../../src/engine/agents/walkWorld.js';
import { ROLES } from '../../src/engine/agents/brain.js';
import { inCity } from '../../src/engine/world/city.js';

const W = buildWalkWorld(), g = W.graph;
const comp = (id) => g.component(id);
const tagsIn = (id) => new Set([...comp(id)].map((n) => g.nodes[n].tag));

describe('the NPC population', () => {
  it('has 18 characters of the expected kinds', () => {
    expect(W.spawns).toHaveLength(18);
    const n = (t) => W.spawns.filter((s) => s.type === t).length;
    expect([n('office'), n('police'), n('civilian'), n('miner'), n('driver'), n('scuba'), n('fisherman'), n('guide')]).toEqual([4, 2, 3, 3, 2, 2, 1, 1]);
  });
  it('every NPC starts on a real node, and every kind has a role definition', () => {
    for (const s of W.spawns) { expect(g.nodes[s.node]).toBeDefined(); expect(ROLES[s.type]).toBeDefined(); }
  });
});

describe('walkable world', () => {
  it('city sidewalk nodes are inside the city', () => {
    const cityNodes = g.nodes.filter((n) => n.z > 56 && Math.abs(n.x) < 130); // (beyond the hub bridge end)
    expect(cityNodes.length).toBeGreaterThan(100);
    for (const n of cityNodes) expect(inCity(n.x, n.z, -1)).toBe(true);
  });
  it('no single step is longer than 45 m (no teleporting shortcuts through the scenery)', () => {
    for (const n of g.nodes) for (const e of g.adj[n.id]) expect(e.d).toBeLessThan(45);
  });
  it('the city, the hub, the jungle and the mining area are all connected on foot via the hub', () => {
    const office = W.spawns.find((s) => s.type === 'office').node;
    const t = tagsIn(office);
    for (const tag of ['office', 'plaza', 'quay', 'camp', 'temple', 'mine_work', 'mine_rest', 'patrol']) expect(t.has(tag)).toBe(true);
  });
  it('the river bank and the dive base are separate: only the boat gets you there', () => {
    const office = W.spawns.find((s) => s.type === 'office').node;
    const fisher = W.spawns.find((s) => s.type === 'fisherman').node, scuba = W.spawns.find((s) => s.type === 'scuba').node;
    expect(comp(office).has(fisher)).toBe(false);
    expect(comp(office).has(scuba)).toBe(false);
    expect(comp(fisher).has(scuba)).toBe(false);
  });
});

describe('every character has something to do and a suitable way to travel', () => {
  for (const type of Object.keys(ROLES)) {
    it(`${type}: can reach its places, and a stop for a vehicle it may ride (or rides nothing)`, () => {
      const spawn = W.spawns.find((s) => s.type === type);
      const reachTags = tagsIn(spawn.node), role = ROLES[type];
      expect(role.visit.filter((t) => reachTags.has(t)).length).toBeGreaterThan(0);
      if (role.rides.length) {
        const c = comp(spawn.node);
        expect(Object.values(W.stops).some((s) => c.has(s.node) && s.kinds.some((k) => role.rides.includes(k)))).toBe(true);
      }
    });
  }
  it('the boat quay is reachable from the city on foot, the landing + pier only by boat', () => {
    const office = W.spawns.find((s) => s.type === 'office').node;
    expect(comp(office).has(W.stops.quay.node)).toBe(true);
    expect(comp(office).has(W.stops.landing.node)).toBe(false);
    expect(comp(office).has(W.stops.pier.node)).toBe(false);
  });
  it('the GMC depot is in the city and the mine gate is in the mining area, both reachable from their NPCs', () => {
    expect(comp(W.spawns.find((s) => s.type === 'office').node).has(W.stops.gmc_depot.node)).toBe(true);
    expect(comp(W.spawns.find((s) => s.type === 'miner').node).has(W.stops.mine_gate.node)).toBe(true);
  });
});
