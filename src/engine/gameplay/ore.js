import * as THREE from 'three';
import { heightAt } from '../world/terrain.js';
import { DEPOSIT_MINERALS } from '../survey/minerals.js';

/** the surface outcrops placed in the world */
export const OUTCROP_MINERALS = ['chalcopyrite', 'malachite', 'hematite', 'gold'];
/** minable minerals: surface outcrops (rock matrix + metallic specimens) and buried deposits found by survey */
export const MINERALS = {
  chalcopyrite: { name: 'Chalcopyrite', color: 0xb59b3a, formula: 'CuFeS2' },
  malachite: { name: 'Malachite', color: 0x2f8f6b, formula: 'Cu2CO3(OH)2' },
  hematite: { name: 'Hematite', color: 0x6a4a4a, formula: 'Fe2O3' },
  gold: { name: 'Native Gold', color: 0xd4af37, formula: 'Au' },
  ...Object.fromEntries(Object.entries(DEPOSIT_MINERALS).map(([k, v]) => [`dep_${k}`, v])),
};

const chunkGeo = new THREE.DodecahedronGeometry(1, 0);
const matrixMat = new THREE.MeshStandardMaterial({ color: 0x6f6a63, roughness: 1, flatShading: true });
const mats = Object.fromEntries(Object.entries(MINERALS).map(([k, v]) => [k, new THREE.MeshStandardMaterial({ color: v.color, roughness: 0.4, metalness: 0.65, flatShading: true })]));

export class OreField {
  constructor(scene, spots, particles) {
    this.particles = particles; this.scene = scene;
    this.lastYield = 1;
    this.nodes = spots.map(([x, z, type, y], i) => this.make(x, z, type, y, i));
    this.total = this.nodes.length;
  }

  /** a deposit exposed by digging: `type` is a deposit mineral key, `amount` units come out when it breaks. Never respawns. */
  add(x, z, type, y, amount) {
    const n = this.make(x, z, `dep_${type}`, y, this.nodes.length, true);
    n.yield = amount; n.once = true; n.hp = 4; n.grow = 0;
    this.nodes.push(n);
    return n;
  }

  /**
   * `reveal` false (every outcrop in the world): a plain grey rock - nothing about it says what, or whether, it holds ore. Minerals
   * are found with the survey sensors; the type only shows when the rock is broken. `reveal` true (ore exposed by an
   * excavation): the mineral itself, so you can see what you uncovered.
   */
  make(x, z, type, y, i, reveal = false) {
    {
      const scene = this.scene;
      const g = new THREE.Group();
      g.position.set(x, y ?? heightAt(x, z), z);
      const add = (mat, sx, sy, sz, px, py, pz, ry) => {
        const m = new THREE.Mesh(chunkGeo, mat);
        m.scale.set(sx, sy, sz); m.position.set(px, py, pz); m.rotation.set(ry * 0.4, ry, ry * 0.3);
        m.castShadow = m.receiveShadow = true;
        g.add(m);
      };
      add(matrixMat, 1.1, 0.55, 0.95, 0, 0.25, 0, i);
      add(matrixMat, 0.6, 0.4, 0.55, 0.7, 0.18, 0.2, i + 2);
      const n = 3 + (i % 3);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + i;
        add(reveal ? mats[type] : matrixMat, 0.2 + (k % 2) * 0.1, 0.16, 0.2, Math.cos(a) * 0.45, 0.55 + (k % 3) * 0.06, Math.sin(a) * 0.4, a); // (plain rock unless revealed)
      }
      scene.add(g);
      return { g, type, x, y: g.position.y, z, hp: 3, alive: true, respawn: 0, pulse: 0, grow: 1, yield: 1 };
    }
  }

  update(dt) {
    for (const n of this.nodes) {
      if (!n.alive) {
        if (!n.once && (n.respawn -= dt) <= 0) { n.alive = true; n.hp = 3; n.grow = 0; n.g.visible = true; }
        continue;
      }
      n.grow = Math.min(1, n.grow + dt * 1.5);
      n.pulse = Math.max(0, n.pulse - dt * 5);
      n.g.scale.setScalar(Math.max(0.001, n.grow) * (1 + n.pulse * 0.05 * Math.sin(performance.now() * 0.06)));
    }
  }

  /** nearest live node in front of (px,pz) facing (fx,fz) */
  nearest(px, pz, fx, fz, reach = 2.7, py = null, vtol = 3) {
    let best = null, bd = reach;
    for (const n of this.nodes) {
      if (!n.alive) continue;
      if (py !== null && Math.abs(n.y + 0.6 - py) > vtol) continue; // too far above / below (seabed from the surface, etc.)
      const dx = n.x - px, dz = n.z - pz, d = Math.hypot(dx, dz);
      if (d > bd || (d > 0.9 && (dx * fx + dz * fz) / d < 0.15)) continue;
      best = n; bd = d;
    }
    return best;
  }

  /** swing impact: 'chip' (hit), a mineral key (node broken), or null (miss) */
  hit(px, pz, fx, fz, reach = 2.7, py = null, vtol = 3) {
    const n = this.nearest(px, pz, fx, fz, reach, py, vtol);
    if (!n) return null;
    n.hp--; n.pulse = 1;
    const c = MINERALS[n.type].color;
    this.particles.burst(n.x, n.y + 0.8, n.z, 0x8a847a, 8, 3.5, 3.5);
    if (n.hp > 0) return 'chip'; // (the colour of the mineral only shows when the rock finally breaks)
    this.particles.burst(n.x, n.y + 0.8, n.z, c, 6, 2.5, 3);
    n.alive = false; n.respawn = 35; n.g.visible = false;
    this.particles.burst(n.x, n.y + 1, n.z, 0x8a847a, 18, 5, 5);
    this.lastYield = n.yield ?? 1;
    return n.type;
  }

  typeName(type) { return MINERALS[type].name; }
}


