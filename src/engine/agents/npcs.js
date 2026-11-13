import { Brain } from './brain.js';
import { Puppet } from './puppet.js';
import { buildWalkWorld } from './walkWorld.js';
import { heightAt, waterLevelAt } from '../world/terrain.js';
import { mulberry32 } from '../noise.js';

/** where a person's feet go: on the ground, or - if the ground is under water - floating at the surface, swimming */
export function npcHeight(mode, ground, level, depth) {
  if (mode === 'dive') return { y: level - depth - 0.9, swim: depth > 0.3 };
  if (ground < level - 0.6) return { y: level - 0.95, swim: true };
  return { y: ground, swim: false };
}

/** The 18 townspeople: each a Brain (what it does) + a Puppet (how it looks). Riders disappear into their vehicle. */
export function createNpcs({ scene, world, fleet, propMat, bubbles }) {
  const W = buildWalkWorld();
  const rng = mulberry32(4242);
  const env = {
    rng, graph: W.graph, stops: W.stops,
    vehicleAt: (stopId, kinds) => fleet.vehicles.find((v) => v.atStop === stopId && kinds.includes(v.kind) && v.passengers.length < v.seats) ?? null,
  };
  const col = world.physics.col;
  const people = W.spawns.map((s, i) => {
    const brain = new Brain({ id: `${s.type}-${i}`, type: s.type, graph: W.graph, node: s.node, rng: mulberry32(i * 97 + 11), diveSpot: W.diveSpot });
    const puppet = new Puppet(s.type, propMat, i + 1);
    scene.add(puppet.root);
    return { brain, puppet, y: heightAt(brain.x, brain.z), t: 0 };
  });

  function update(dt) {
    for (const p of people) {
      const b = p.brain, pu = p.puppet;
      const was = b.mode;
      b.step(dt, env);
      pu.root.visible = b.visible;
      if (!b.visible) continue; // inside a vehicle
      const level = waterLevelAt(b.x, b.z);
      if (was === 'dive' && b.mode !== 'dive') p.y = Math.max(p.y, level - 0.9); // surfaced
      const g = b.mode === 'dive' ? 0 : col.surfaceY(b.x, b.z, Math.max(p.y, level) + 2.5) ?? heightAt(b.x, b.z);
      const { y, swim: inWater } = npcHeight(b.mode, g, level, b.depth);
      p.y += (y - p.y) * Math.min(1, dt * 12);
      const sit = b.mode === 'idle' && (b.tag === 'bench' || b.tag === 'bench_bank');
      const fish = b.mode === 'idle' && b.tag === 'fish_spot';
      const swim = inWater;
      pu.animate(dt, swim ? 'swim' : b.mode === 'walk' ? 'walk' : sit ? 'sit' : fish ? 'fish' : 'idle', b.speed);
      pu.place(b.x, p.y + (sit ? -0.25 : 0), b.z, b.h);
      if (swim && bubbles && (p.t -= dt) <= 0) { p.t = 1.2; bubbles.burst(b.x, p.y + 1.2, b.z, 0xffffff, 3, 0.3, 0.8); }
      void was;
    }
  }
  return { people, update, env, graph: W.graph };
}
