import * as THREE from 'three';

export const STEP = 0.7; // kept for compatibility (autostep height)

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

/**
 * Rapier-backed static collision. Same builder API the world code already uses:
 *   addCircle  -> vertical cylinder (trees, pillars, lamp posts)
 *   addBox     -> oriented box (buildings, walls, containers). `rot` = angle of the local +X axis in (x,z)
 *   addDeck    -> thin sloped slab (bridges, ramps, floors)
 * Everything is a real physics collider: you walk up stairs with auto-step, stand on whatever
 * you can jump onto, and dynamic props (crates, barrels, cones) get pushed around.
 */
export class Colliders {
  constructor(RAPIER, world) {
    this.R = RAPIER;
    this.world = world;
    this.count = 0;
  }

  _add(desc) {
    this.count++;
    return this.world.createCollider(desc);
  }

  addCircle(x, z, r, y0 = -20, y1 = 60) {
    const hh = Math.max(0.05, (y1 - y0) / 2);
    return this._add(this.R.ColliderDesc.cylinder(hh, r).setTranslation(x, (y0 + y1) / 2, z).setFriction(0.8));
  }

  addBox(x, z, hx, hz, rot = 0, y0 = -20, y1 = 60) {
    const hh = Math.max(0.03, (y1 - y0) / 2);
    const th = -rot;
    return this._add(
      this.R.ColliderDesc.cuboid(Math.max(0.03, hx), hh, Math.max(0.03, hz))
        .setTranslation(x, (y0 + y1) / 2, z)
        .setRotation({ x: 0, y: Math.sin(th / 2), z: 0, w: Math.cos(th / 2) })
        .setFriction(0.8),
    );
  }

  /** walkable sloped rectangle {x,z centre, ux,uz unit dir, hl half length, hw half width, hA,hB surface heights} */
  addDeck(d) {
    const rise = d.hB - d.hA, run = 2 * d.hl;
    const len = Math.hypot(run, rise);
    const ca = run / len, sa = rise / len;
    _x.set(d.ux * ca, sa, d.uz * ca); // along the slope
    _z.set(-d.uz, 0, d.ux); // across
    _y.crossVectors(_z, _x).normalize(); // up-ish normal
    _m.makeBasis(_x, _y, _z);
    _q.setFromRotationMatrix(_m);
    const th = 0.3;
    const cy = (d.hA + d.hB) / 2;
    return this._add(
      this.R.ColliderDesc.cuboid(len / 2, th / 2, d.hw)
        .setTranslation(d.x - _y.x * th / 2, cy - _y.y * th / 2, d.z - _y.z * th / 2)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setFriction(1.0),
    );
  }

  /** first thing hit by a ray; returns distance or null. `exclude` = rigid body to ignore */
  cast(ox, oy, oz, dx, dy, dz, maxDist, exclude) {
    const ray = new this.R.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.world.castRay(ray, maxDist, true, undefined, undefined, undefined, exclude);
    return hit ? hit.timeOfImpact : null;
  }

  /** first MOVABLE thing hit by a ray (the player, crates, barrels, cones); ignores terrain, buildings and every other fixed collider */
  castMovable(ox, oy, oz, dx, dy, dz, maxDist) {
    const ray = new this.R.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.world.castRay(ray, maxDist, true, this.R.QueryFilterFlags.EXCLUDE_FIXED);
    return hit ? hit.timeOfImpact : null;
  }

  /** y of the highest FIXED surface (terrain, decks, buildings) below fromY; ignores crates / cones */
  surfaceY(x, z, fromY) {
    const ray = new this.R.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, fromY + 60, true, this.R.QueryFilterFlags.EXCLUDE_DYNAMIC);
    return hit ? fromY - hit.timeOfImpact : null;
  }

  /** y of the highest solid surface at (x,z) below `fromY` (null if none) */
  groundY(x, z, fromY = 400, exclude) {
    const t = this.cast(x, fromY, z, 0, -1, 0, fromY + 50, exclude);
    return t === null ? null : fromY - t;
  }
}
