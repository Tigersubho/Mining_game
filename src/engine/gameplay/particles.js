import * as THREE from 'three';

/** tiny CPU particle pool (rock chips, water splashes) rendered as one InstancedMesh */
export class Particles {
  constructor(scene, count = 160, { gravity = 14, sphere = false, size = 0.12, color = 0xffffff } = {}) {
    this.gravity = gravity; // m/s2 downward (negative = rises: bubbles)
    this.n = count;
    this.mesh = new THREE.InstancedMesh(
      sphere ? new THREE.SphereGeometry(size, 8, 6) : new THREE.BoxGeometry(size, size, size),
      sphere ? new THREE.MeshStandardMaterial({ color, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.55 }) : new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }),
      count,
    );
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.max = new Float32Array(count).fill(1);
    this.next = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) {
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, this._c.set(0xffffff));
    }
    scene.add(this.mesh);
  }

  burst(x, y, z, color, n = 10, speed = 4, up = 3, size = 1) {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const a = Math.random() * Math.PI * 2, s = (0.35 + Math.random() * 0.65) * speed;
      this.pos.set([x, y, z], i * 3);
      this.vel.set([Math.cos(a) * s, up * (0.5 + Math.random()), Math.sin(a) * s], i * 3);
      this.life[i] = this.max[i] = 0.5 + Math.random() * 0.5;
      this.mesh.setColorAt(i, this._c.set(color).multiplyScalar(0.8 + Math.random() * 0.4));
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    const { _m, _q, _e, _p, _s } = this;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const i3 = i * 3;
      this.vel[i3 + 1] -= this.gravity * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const sc = Math.max(0, this.life[i] / this.max[i]);
      _q.setFromEuler(_e.set(this.life[i] * 7, this.life[i] * 5, 0));
      this.mesh.setMatrixAt(i, _m.compose(_p.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]), _q, _s.set(sc, sc, sc)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

