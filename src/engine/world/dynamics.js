import * as THREE from 'three';

/**
 * Simulated loose props (crates, barrels, traffic cones). They are real rigid bodies:
 * you can shove them, they tumble, stack and come to rest. Rendered as InstancedMeshes.
 */
class Kind {
  constructor(scene, geo, mat, max) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.items = [];
    this.max = max;
  }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

export class Dynamics {
  constructor(scene, RAPIER, world) {
    this.R = RAPIER;
    this.world = world;
    const std = (o = {}) => new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true, ...o });
    this.kinds = {
      cone: new Kind(scene, new THREE.ConeGeometry(0.17, 0.6, 8), std(), 80),
      barrel: new Kind(scene, new THREE.CylinderGeometry(0.3, 0.3, 1, 12), std({ metalness: 0.4, roughness: 0.6 }), 80),
      crate: new Kind(scene, new THREE.BoxGeometry(1, 1, 1), std(), 80),
    };
  }

  add(kind, x, y, z, { ry = 0, s = 1, color = 0xffffff } = {}) {
    const k = this.kinds[kind];
    if (k.items.length >= k.max) return;
    const R = this.R;
    let desc, cdesc;
    if (kind === 'cone') cdesc = R.ColliderDesc.cylinder(0.3, 0.16).setDensity(0.5);
    else if (kind === 'barrel') cdesc = R.ColliderDesc.cylinder(0.5, 0.3).setDensity(0.8);
    else cdesc = R.ColliderDesc.cuboid(0.5 * s, 0.5 * s, 0.5 * s).setDensity(0.5);
    const half = kind === 'cone' ? 0.3 : kind === 'barrel' ? 0.5 : 0.5 * s;
    _q.setFromAxisAngle(_p.set(0, 1, 0), ry);
    desc = R.RigidBodyDesc.dynamic()
      .setTranslation(x, y + half + 0.02, z)
      .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
      .setLinearDamping(0.25).setAngularDamping(0.6).setCanSleep(true);
    const body = this.world.createRigidBody(desc);
    this.world.createCollider(cdesc.setFriction(0.9).setRestitution(0.08), body);
    const idx = k.items.length;
    k.items.push({ body, s, dirty: true });
    k.mesh.count = k.items.length;
    k.mesh.setColorAt(idx, _c.set(color));
    k.mesh.instanceColor.needsUpdate = true;
  }

  update() {
    for (const k of Object.values(this.kinds)) {
      let changed = false;
      for (let i = 0; i < k.items.length; i++) {
        const it = k.items[i];
        if (!it.dirty && it.body.isSleeping()) continue;
        const t = it.body.translation(), r = it.body.rotation();
        _m.compose(_p.set(t.x, t.y, t.z), _q.set(r.x, r.y, r.z, r.w), _s.setScalar(it.s));
        k.mesh.setMatrixAt(i, _m);
        it.dirty = false;
        changed = true;
      }
      if (changed) k.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
