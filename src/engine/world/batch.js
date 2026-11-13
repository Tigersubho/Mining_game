import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
let seed = 1337;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

/**
 * Collects many small coloured primitives and merges them into ONE mesh
 * (a single draw call, vertex colours). Positions are world-space.
 */
export class Batch {
  constructor({ uv = false } = {}) {
    this.geos = [];
    this.keepUV = uv;
  }

  add(g, matrix, color, jitter = 0.06) {
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(matrix);
    if (!this.keepUV) g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    _c.set(color);
    const f = 1 + (rnd() - 0.5) * 2 * jitter;
    for (let i = 0; i < n; i++) {
      arr[i * 3] = _c.r * f; arr[i * 3 + 1] = _c.g * f; arr[i * 3 + 2] = _c.b * f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.geos.push(g);
  }

  _mat(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
    return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  }

  /** arbitrary geometry (fresh, un-shared!) at a position */
  geo(g, x, y, z, color, ry = 0, rx = 0, rz = 0) {
    this.add(g, this._mat(x, y, z, rx, ry, rz), color);
  }
  box(x, y, z, w, h, d, color, ry = 0, rx = 0, rz = 0) {
    this.add(new THREE.BoxGeometry(w, h, d), this._mat(x, y, z, rx, ry, rz), color);
  }
  cyl(x, y, z, rTop, rBot, h, color, seg = 8, ry = 0, rx = 0, rz = 0) {
    this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), this._mat(x, y, z, rx, ry, rz), color);
  }
  cone(x, y, z, r, h, color, seg = 8, ry = 0, rx = 0, rz = 0) {
    this.cyl(x, y, z, 0, r, h, color, seg, ry, rx, rz);
  }
  sph(x, y, z, r, color, sx = 1, sy = 1, sz = 1, detail = 1) {
    this.add(new THREE.IcosahedronGeometry(r, detail), this._mat(x, y, z, 0, 0, 0, sx, sy, sz), color);
  }

  build(material, { castShadow = true, receiveShadow = true } = {}) {
    if (!this.geos.length) return null;
    const merged = mergeGeometries(this.geos, false);
    this.geos.forEach((g) => g.dispose());
    this.geos = [];
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    return mesh;
  }
}

/** flat horizontal quads (roads, markings) merged into one geometry */
export class Flats {
  constructor() {
    this.pos = [];
    this.col = [];
  }
  /** axis aligned rectangle at height y */
  rect(x0, z0, x1, z1, y, color) {
    this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], color);
  }
  /** rectangle centred at (cx,cz), length `len` along angle `phi`, width `w` */
  strip(cx, cz, len, w, phi, y, color) {
    const c = Math.cos(phi), s = Math.sin(phi);
    const hl = len / 2, hw = w / 2;
    const P = (a, b) => [cx + c * a - s * b, y, cz + s * a + c * b];
    this.quad(P(-hl, -hw), P(hl, -hw), P(hl, hw), P(-hl, hw), color);
  }
  quad(a, b, c, d, color) {
    _c.set(color);
    // wound so the normal points up (+Y)
    for (const v of [a, d, b, b, d, c]) {
      this.pos.push(v[0], v[1], v[2]);
      this.col.push(_c.r, _c.g, _c.b);
    }
  }
  build(material) {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const n = new Float32Array(this.pos.length);
    for (let i = 1; i < n.length; i += 3) n[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    const mesh = new THREE.Mesh(g, material);
    mesh.receiveShadow = true;
    return mesh;
  }
}
