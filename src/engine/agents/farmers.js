import { Puppet } from './puppet.js';
import { NETWORK } from '../world/layout.js';
import { FARM } from '../world/farmsite.js';
import { heightAt } from '../world/terrain.js';
import { mulberry32 } from '../noise.js';

const HOE_SPEED = 0.5, WALK_SPEED = 1.3;

/**
 * Farmers. Three per farm, each tending one field: they walk slowly down a furrow between two crop rows hoeing, step across to the
 * next furrow at the end of the row, turn and come back, and now and then straighten up for a rest. They work all day and never leave their field.
 */
export function createFarmers({ scene, propMat }) {
  const people = [], rowZ = (f, k) => f.z0 + 2 + k * FARM.rowGap; // the furrow just before row k
  NETWORK.farms.forEach((farm, fi) => {
    [0, 1, 3].forEach((which, k) => {
      const f = farm.fields[Math.min(which, farm.fields.length - 1)], seed = fi * 7 + k * 3 + 1, rng = mulberry32(seed * 131);
      const puppet = new Puppet('farmer', propMat, seed); scene.add(puppet.root);
      const rows = Math.floor((f.d - 2) / FARM.rowGap), row = Math.floor(rng() * rows);
      const w = { puppet, f, rows, row, dir: rng() < 0.5 ? 1 : -1, x: f.x0 + 3 + rng() * (f.w - 6), z: 0, h: 0, state: 'work', t: 0, rest: 0, rng, farm: fi };
      w.z = rowZ(f, row); w.h = w.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      puppet.place(w.x, heightAt(w.x, w.z), w.z, w.h);
      people.push(w);
    });
  });
  function update(dt) {
    for (const w of people) {
      const { f, puppet } = w;
      let anim = 'hoe', speed = 1;
      if (w.state === 'work') {
        w.x += w.dir * HOE_SPEED * dt;
        if (w.dir > 0 ? w.x >= f.x0 + f.w - 2.5 : w.x <= f.x0 + 2.5) { w.state = 'turn'; w.row = (w.row + 1) % w.rows; if (w.rng() < 0.25) { w.state = 'rest'; w.t = 4 + w.rng() * 5; } }
      } else if (w.state === 'rest') {
        anim = 'idle'; w.t -= dt; if (w.t <= 0) w.state = 'turn';
      }
      if (w.state === 'turn') {
        anim = 'walk'; speed = 1.4;
        const tz = rowZ(f, w.row), dz = tz - w.z;
        if (Math.abs(dz) > 0.05) { w.z += Math.sign(dz) * Math.min(Math.abs(dz), WALK_SPEED * dt); w.h = dz > 0 ? 0 : Math.PI; }
        else { w.dir = -w.dir; w.state = 'work'; }
      } else {
        const want = w.dir > 0 ? Math.PI / 2 : -Math.PI / 2; let e = want - w.h; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
        w.h += e * Math.min(1, dt * 6);
      }
      puppet.place(w.x, heightAt(w.x, w.z), w.z, w.h);
      puppet.animate(dt, anim, speed);
    }
  }
  return { people, update };
}
