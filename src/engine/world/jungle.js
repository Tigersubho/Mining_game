import * as THREE from 'three';
import { SITES, WORLD_R, POOL_R } from '../config.js';
import { clamp } from '../math.js';
import { fbm, mulberry32 } from '../noise.js';
import { heightAt, riverS, regionWeights } from './terrain.js';
import { nearRoad, BRIDGES } from './layout.js';
import { chunkedInstances } from './instancing.js';
import { Forest, loadTree, cellKey, wind } from './foliage.js';
import { nearKeepOut } from './keepout.js';
import { treeKept, lightPatch } from './jungleDensity.js';
import { lamp, crate, barrel } from './props.js';
import { signMesh } from './textures.js';

const HERO_SHARE = 0.3;
const hash01 = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
const GREENS = [0x2f7a2e, 0x3a8a34, 0x256326, 0x4a9a3a, 0x2b6f3c, 0x1f5a2a, 0x6a9f3a];

export function buildJungle(ctx) {
  const rng = mulberry32(777);
  const { col, scene } = ctx;
  const B = ctx.b.jungle;
  const [cx0, cz0] = SITES.camp, [tx0, tz0] = SITES.temple, [mx0, mz0] = SITES.mine;

  // ------------------------------------------------------------ trees (instanced, per chunk)
  const trees = [];
  for (let gx = -WORLD_R; gx < WORLD_R;) {
    const STEP = Math.abs(gx) < 300 ? 3.9 : 5.2; // sparser far away
    for (let gz = -WORLD_R; gz < WORLD_R; gz += STEP) {
      const x = gx + (rng() - 0.5) * STEP * 0.95, z = gz + (rng() - 0.5) * STEP * 0.95;
      const r = Math.hypot(x, z);
      if (r < 46 || r > WORLD_R - 6) continue;
      const w = regionWeights(x, z);
      const wild = r > 260 && w.jungle < 0.55; // sparse scrub / woodland outside the jungle sector
      if (wild ? rng() > 0.09 : w.jungle < 0.55) continue;
      if (riverS(x, z) < 6) continue;
      if (!wild && fbm(x * 0.02 + 30, z * 0.02, 3, 4) < 0.3 + rng() * 0.08) continue;
      if (Math.hypot(x - cx0, z - cz0) < 12 || Math.hypot(x - tx0, z - tz0) < 25 || Math.hypot(x - mx0, z - mz0) < 21) continue;
      const rd = nearRoad(x, z);
      if (rd < 3.5 || nearKeepOut(x, z) || !treeKept(x, z, rng(), rd)) continue;
      const y = heightAt(x, z);
      if (y < 0.4 || y > 48) continue;
      const k = rng(), ry = rng() * 6.28;
      let h, tr, ca;
      if (k < 0.68) { h = 7 + rng() * 5; tr = 0.32 + rng() * 0.18; ca = [3.2 + rng() * 1.4, 2.4 + rng(), 3.2 + rng() * 1.4]; }
      else if (k < 0.9) { h = 12 + rng() * 7; tr = 0.28 + rng() * 0.12; ca = [2.3 + rng() * 0.8, 4 + rng() * 1.6, 2.3 + rng() * 0.8]; }
      else { h = 9 + rng() * 4; tr = 0.5 + rng() * 0.25; ca = [6 + rng() * 2, 2.4, 6 + rng() * 2]; }
      const hv = hash01(x, z), hero = r < 300 && hv < HERO_SHARE; // a share of the trees are the detailed .glb ones near the viewer
      trees.push({ hero, species: riverS(x, z) < 26 && hash01(z, x) < 0.65 ? 'willow' : 'oak', hs: hv / HERO_SHARE, x, y, z, h, tr, ca, ry, far: r > 300, g1: GREENS[Math.floor(rng() * GREENS.length)], g2: GREENS[Math.floor(rng() * GREENS.length)], j: [rng() - 0.5, rng() - 0.5], bark: 0.8 + rng() * 0.4 });
      col.addCircle(x, z, tr + 0.18, -5, y + h);
    }
    gx += Math.abs(gx) < 300 ? 3.9 : 5.2;
  }
  const trunkGeo = new THREE.CylinderGeometry(0.62, 1, 1, 6).translate(0, 0.5, 0);
  const treeMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
  const bark = new THREE.Color(0x5e4630);
  /** the low-poly tree: trunk + two canopy blobs (all trees at a distance, and the not-detailed ones everywhere) */
  const lowPoly = (list, opt = {}) => [
    ...chunkedInstances(scene, trunkGeo, treeMat, list, (t, put) => put(t.x, t.y - 0.3, t.z, t.tr, t.h + 0.3, t.tr, t.ry, bark.clone().multiplyScalar(t.bark)), opt),
    ...[[false, 1], [true, 0]].flatMap(([far, detail]) => {
      const l = list.filter((t) => t.far === far), geo = new THREE.IcosahedronGeometry(1, detail);
      return [
        ...chunkedInstances(scene, geo, treeMat, l, (t, put) => put(t.x, t.y + t.h + t.ca[1] * 0.35, t.z, t.ca[0], t.ca[1], t.ca[2], t.ry, t.g1), opt),
        ...chunkedInstances(scene, geo, treeMat, l, (t, put) => put(t.x + t.j[0] * 2.2, t.y + t.h + t.ca[1] * 1.15, t.z + t.j[1] * 2.2, t.ca[0] * 0.62, t.ca[1] * 0.7, t.ca[2] * 0.62, t.ry + 1, t.g2), opt),
      ];
    }),
  ];
  lowPoly(trees.filter((t) => !t.hero));
  const forest = ctx.forest = new Forest();
  const heroes = trees.filter((t) => t.hero);
  lowPoly(heroes, { key: (t) => cellKey(t.x, t.z) }).forEach((m) => forest.addFar(m)); // shown beyond ~115 m
  const heroItems = heroes.map((t) => ({ x: t.x, y: t.y, z: t.z, ry: t.ry * 3, species: t.species, s: t.species === 'willow' ? 0.75 + 0.5 * t.hs : 0.8 + 0.55 * t.hs }));
  // .glb trees switched off: every tree stays low-poly. To bring them back, load tree1.glb / willow.glb with loadTree() and call forest.addNear(scene, heroItems, { oak, willow })
  void heroItems;
  ctx.updaters.push((dt, t) => { wind.uTime.value = t; });
  // -------------------------------------------------- understory: bushes, rocks, reeds
  const scatter = (count, accept) => {
    const out = [];
    let tries = 0;
    while (out.length < count && tries++ < count * 25) {
      const a = rng() * Math.PI * 2, rr = 40 + Math.sqrt(rng()) * (WORLD_R - 50);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const y = accept(x, z);
      if (y !== null) out.push({ x, y, z });
    }
    return out;
  };
  const nearBridge = (x, z, pad) => BRIDGES.some((b) => {
    const dx = x - b.x, dz = z - b.z;
    const s = dx * b.dirx + dz * b.dirz, t = -dx * b.dirz + dz * b.dirx;
    return Math.abs(s) < b.length / 2 + pad && Math.abs(t) < b.width / 2 + pad;
  });
  const jungleAt = (x, z) => {
    if (regionWeights(x, z).jungle < 0.5 || riverS(x, z) < 3 || nearRoad(x, z) < 1.5 || nearKeepOut(x, z)) return null;
    const y = heightAt(x, z);
    return y < 0.3 || y > 48 ? null : y;
  };
  const flat = (geo) => [geo, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true })];

  const bushes = scatter(9000, (x, z) => (lightPatch(x, z) && rng() < 0.6 ? null : jungleAt(x, z))).map((b) => ({ ...b, sc: 0.5 + rng() * 1.1, ry: rng() * 6, c: GREENS[Math.floor(rng() * GREENS.length)] }));
  chunkedInstances(scene, ...flat(new THREE.IcosahedronGeometry(1, 0)), bushes, (b, put) => put(b.x, b.y + b.sc * 0.3, b.z, b.sc * 1.4, b.sc * 0.85, b.sc * 1.4, b.ry, new THREE.Color(b.c).multiplyScalar(0.9)));

  const shore = (x, z) => Math.hypot(x, z) > 40 && riverS(x, z) > -1 && riverS(x, z) < 5 && regionWeights(x, z).city < 0.5 && nearRoad(x, z) > 2 && !nearBridge(x, z, 5) && !nearKeepOut(x, z) ? heightAt(x, z) : null;
  const rocks = [...scatter(900, jungleAt), ...scatter(500, shore)].map((r) => ({ ...r, sc: 0.5 + Math.pow(rng(), 2.2) * 3.2, rot: [rng() * 0.5, rng() * 6, rng() * 0.5], t: 0.8 + rng() * 0.45 }));
  chunkedInstances(scene, ...flat(new THREE.DodecahedronGeometry(1, 0)), rocks, (r, put) => put(r.x, r.y + r.sc * 0.25, r.z, r.sc * 1.2, r.sc * 0.8, r.sc, r.rot[1], new THREE.Color(0x7b756c).multiplyScalar(r.t), r.rot[0], r.rot[2]));
  for (const r of rocks) if (r.sc > 1.1) col.addCircle(r.x, r.z, r.sc * 0.9, -5, r.y + r.sc * 0.9);

  // reeds along every river / lake bank
  const reeds = scatter(3500, (x, z) => {
    const sv = riverS(x, z);
    if (sv < -0.6 || sv > 3.2 || Math.hypot(x, z) < POOL_R + 3 || regionWeights(x, z).city > 0.6 || nearBridge(x, z, 4) || nearKeepOut(x, z)) return null;
    return heightAt(x, z);
  }).map((r) => ({ ...r, sc: 0.7 + rng() * 0.9, ry: rng() * 6, t: [(rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3], l: 0.8 + rng() * 0.4 }));
  chunkedInstances(scene, ...flat(new THREE.ConeGeometry(0.12, 1.6, 4).translate(0, 0.8, 0)), reeds, (r, put) => put(r.x, r.y - 0.1, r.z, r.sc, r.sc, r.sc, r.ry, new THREE.Color(0x7da83a).multiplyScalar(r.l), r.t[0], r.t[1]), { shadow: false });
  // fallen logs
  for (const { x, y, z } of scatter(120, jungleAt)) {
    if (Math.hypot(x - cx0, z - cz0) < 14) continue;
    const ry = rng() * 3.14, L = 4 + rng() * 4;
    B.cyl(x, y + 0.45, z, 0.42, 0.5, L, 0x5a4330, 7, ry, 0, Math.PI / 2);
    B.cyl(x, y + 0.45, z, 0.43, 0.43, L * 0.98, 0x6b8f3a, 7, ry, 0, Math.PI / 2);
    col.addBox(x, z, 0.45, L / 2, -ry, -5, y + 0.9, true);
  }

  // ------------------------------------------------------------------ camp
  {
    const y = heightAt(cx0, cz0);
    const ring = 2.2;
    // fire pit
    B.cyl(cx0, y + 0.15, cz0, 1.0, 1.1, 0.3, 0x55504a, 9);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * 6.28;
      B.sph(cx0 + Math.cos(a) * 1.15, y + 0.3, cz0 + Math.sin(a) * 1.15, 0.28, 0x6e6a63, 1, 0.8, 1, 0);
    }
    B.box(cx0, y + 0.45, cz0, 1.1, 0.14, 0.14, 0x4a3320, 0.4);
    B.box(cx0, y + 0.45, cz0, 1.1, 0.14, 0.14, 0x4a3320, -0.7);
    col.addCircle(cx0, cz0, 1.3, -5, y + 0.4, false);
    ctx.glow.cone(cx0, y + 0.95, cz0, 0.42, 1.1, 0xff9a2a, 6);
    ctx.glow.cone(cx0, y + 0.8, cz0, 0.28, 0.8, 0xffe08a, 6);
    const light = new THREE.PointLight(0xffa24a, 40, 26, 1.6);
    light.position.set(cx0, y + 1.6, cz0);
    scene.add(light);
    ctx.updaters.push((dt, t) => { light.intensity = 36 + Math.sin(t * 13) * 5 + Math.sin(t * 7.3) * 4; });
    // tents
    for (let i = 0; i < 3; i++) {
      const a = 0.6 + i * 2.1;
      const tx = cx0 + Math.cos(a) * 7.5, tz = cz0 + Math.sin(a) * 7.5, ty = heightAt(tx, tz);
      const ry = -a + Math.PI / 2;
      const colr = [0xd96f32, 0x3f7f9c, 0xb8a04a][i];
      B.geo(new THREE.CylinderGeometry(0, 1.9, 2.2, 4, 1).rotateY(Math.PI / 4), tx, ty + 1.1, tz, colr, ry);
      B.box(tx, ty + 0.03, tz, 3.2, 0.06, 3.6, 0x4a3f33, ry);
      col.addBox(tx, tz, 1.4, 1.5, -ry, -5, ty + 1.8, false);
    }
    // supplies
    crate(B, col, cx0 - 5, cz0 - 4, 0.3, 1, undefined);
    crate(B, col, cx0 - 4, cz0 - 4.7, 0.9, 0.8, undefined);
    crate(B, col, cx0 - 5, cz0 - 4, 0.3, 0.8, heightAt(cx0 - 5, cz0 - 4) + 1);
    barrel(B, col, cx0 + 4.5, cz0 - 5, 0x2e6da4);
    barrel(B, col, cx0 + 5.4, cz0 - 4.5, 0x2e6da4);
    // log seats
    for (let i = 0; i < 4; i++) {
      const a = i * 1.57 + 0.4;
      const bx = cx0 + Math.cos(a) * 3.2, bz = cz0 + Math.sin(a) * 3.2;
      B.cyl(bx, heightAt(bx, bz) + 0.25, bz, 0.35, 0.35, 0.5, 0x6a4a2a, 7);
      col.addCircle(bx, bz, 0.38, -5, heightAt(bx, bz) + 0.5, true);
    }
    // lantern posts
    for (const [dx, dz] of [[-9, 2], [9, -3]]) lamp(B, ctx.glow, col, cx0 + dx, cz0 + dz, undefined, { h: 3.4, arm: 0.0, color: 0x5a4632 });
    const sign = signMesh(['EXPLORATION CAMP', { text: 'Survey Team 02', size: 56, color: '#ffffff' }], 3.6, 1.2, { w: 768, h: 256, bg: '#3b2d1c', fg: '#ffd23f' }, true);
    sign.position.set(cx0 - 3, y + 2.3, cz0 + 9);
    scene.add(sign);
    B.cyl(cx0 - 4.6, y + 1.2, cz0 + 9, 0.08, 0.08, 2.4, 0x4a3320, 5);
    B.cyl(cx0 - 1.4, y + 1.2, cz0 + 9, 0.08, 0.08, 2.4, 0x4a3320, 5);
  }

  // ---------------------------------------------------------------- temple ruin
  {
    const ty = heightAt(tx0, tz0);
    const stone = 0x8f9a86, moss = 0x587a3f, dark = 0x6f786a;
    const tiers = [[24, 1.5], [19, 1.5], [14, 1.5], [9.5, 1.5]];
    let top = ty;
    tiers.forEach(([sz, hh], k) => {
      B.box(tx0, top + hh / 2 - (k === 0 ? 1.5 : 0), tz0, sz, hh + (k === 0 ? 3 : 0), sz, k % 2 ? dark : stone);
      for (let i = 0; i < 5; i++) {
        const ox = (rng() - 0.5) * sz * 0.9, oz = (rng() - 0.5) * sz * 0.9;
        B.box(tx0 + ox, top + hh + 0.04, tz0 + oz, 1.5 + rng() * 2.5, 0.08, 1.5 + rng() * 2.5, moss);
      }
      // side vines
      for (let i = 0; i < 4; i++) B.box(tx0 + (rng() - 0.5) * sz, top + hh / 2, tz0 + sz / 2 + 0.03, 0.8 + rng(), hh * 0.9, 0.06, 0x3f6f2c);
      top += hh;
      col.addBox(tx0, tz0, sz / 2, sz / 2, 0, ty - 6, top, true);
    });
    // grand staircase on the +x side: 12 steps of 0.5 m, cutting over the tiers
    const d = 1.1;
    for (let i = 0; i < 12; i++) {
      const px = tx0 + 4.75 + i * d + d / 2;
      const topH = ty + 6 - 0.5 * i;
      B.box(px, (ty - 1 + topH) / 2, tz0, d, topH - (ty - 1), 5, i % 2 ? stone : dark);
      col.addBox(px, tz0, d / 2, 2.5, 0, ty - 5, topH, true);
    }
    for (const sg of [-1, 1]) {
      B.box(tx0 + 4.75 + 6.6, ty + 3.6, tz0 + sg * 2.75, 13.2, 1.0, 0.5, stone, 0, 0, -Math.atan2(5.5, 13.2));
    }
    // shrine
    const pillar = (px, pz) => {
      B.cyl(px, top + 2.2, pz, 0.45, 0.55, 4.4, stone, 8);
      col.addCircle(px, pz, 0.6, -5, top + 4.4);
    };
    for (const [ax, az] of [[-2.8, -2.8], [2.8, -2.8], [-2.8, 2.8], [2.8, 2.8]]) pillar(tx0 + ax, tz0 + az);
    B.box(tx0, top + 4.7, tz0, 7.6, 0.6, 7.6, dark);
    B.cone(tx0, top + 6.2, tz0, 4.6, 2.6, 0x7b8573, 4, Math.PI / 4);
    B.box(tx0, top + 0.9, tz0, 1.4, 1.8, 1.4, 0xc9a24b); // golden idol
    col.addBox(tx0, tz0, 0.75, 0.75, 0, -5, top + 1.8, true);
    B.sph(tx0, top + 2.2, tz0, 0.55, 0xe5c15a, 1, 1.1, 1, 1);
    // broken columns around
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.28 + 0.3, d = 17.5;
      const px = tx0 + Math.cos(a) * d, pz = tz0 + Math.sin(a) * d;
      if (Math.cos(a) > 0.75) continue;
      const hh = 1.5 + rng() * 3.5, gy = heightAt(px, pz);
      B.cyl(px, gy + hh / 2, pz, 0.5, 0.6, hh, stone, 8);
      col.addCircle(px, pz, 0.65, -5, gy + hh);
    }
    ctx.glow.sph(tx0, top + 3.0, tz0, 0.25, 0xffe28a, 1, 1, 1, 0);
  }

  // ----------------------------------------------------- mine entrance (rock formation)
  {
    const my = heightAt(mx0, mz0);
    // face the hub (origin)
    const fx = -mx0 / Math.hypot(mx0, mz0), fz = -mz0 / Math.hypot(mx0, mz0);
    const ry = Math.atan2(fx, fz);
    const px = -fz, pz = fx; // lateral
    const rockC = [0x7b756c, 0x6c665e, 0x8a8479];
    const place = (a, l, up, sx, sy, sz, ci) => {
      const geo = new THREE.DodecahedronGeometry(1, 0);
      const x = mx0 + fx * a + px * l, z = mz0 + fz * a + pz * l;
      B.add(geo, new THREE.Matrix4().compose(new THREE.Vector3(x, my + up, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry + a * 0.3, 0)), new THREE.Vector3(sx, sy, sz)), rockC[ci]);
    };
    place(-5, 0, 5.5, 7.5, 7, 7, 0);
    place(-2, -8.5, 3.2, 4.6, 4.4, 4.4, 1);
    place(-2, 8.5, 3.2, 4.6, 5, 4.4, 2);
    place(-11, 0, 8, 7, 8, 6, 1);
    place(-4, -13, 1.8, 3.6, 3, 3.6, 2);
    place(-4, 13, 1.8, 3.6, 3.5, 3.6, 0);
    col.addBox(mx0 + fx * -4, mz0 + fz * -4, 14, 7, -ry, -5, my + 14);
    // timber portal
    const wood = 0x7a5530;
    const ax = mx0 + fx * 3.6, az = mz0 + fz * 3.6;
    for (const sg of [-1, 1]) {
      B.box(ax + px * 2.6 * sg, my + 2.1, az + pz * 2.6 * sg, 0.55, 4.2, 0.55, wood, ry);
      col.addCircle(ax + px * 2.6 * sg, az + pz * 2.6 * sg, 0.45, -5, my + 4.2);
    }
    B.box(ax, my + 4.35, az, 6.2, 0.6, 0.7, wood, ry);
    B.box(ax - fx * 0.4, my + 2.1, az - fz * 0.4, 4.6, 4.2, 0.4, 0x0a0a0c, ry); // dark opening
    ctx.glow.box(ax, my + 3.7, az + 0.0, 0.5, 0.4, 0.5, 0xffd27a, ry);
    // rails + cart leading out
    for (let i = 0; i < 14; i++) {
      const a = 3.6 + i * 1.1, rx = mx0 + fx * a, rz = mz0 + fz * a, gy = heightAt(rx, rz);
      B.box(rx, gy + 0.08, rz, 1.7, 0.1, 0.22, 0x5a4632, ry);
    }
    for (const sg of [-1, 1]) {
      const sx2 = mx0 + fx * 11 + px * 0.65 * sg, sz2 = mz0 + fz * 11 + pz * 0.65 * sg;
      B.box(sx2, heightAt(sx2, sz2) + 0.14, sz2, 0.1, 0.08, 15, 0x9aa0a6, ry);
    }
    const cxm = mx0 + fx * 9, czm = mz0 + fz * 9, cym = heightAt(cxm, czm);
    B.box(cxm, cym + 0.75, czm, 1.5, 0.9, 2.2, 0x8a4a2a, ry);
    B.box(cxm, cym + 1.28, czm, 1.3, 0.2, 2.0, 0x4a4a52, ry);
    B.sph(cxm, cym + 1.5, czm, 0.7, 0x2f8f6b, 1.4, 0.6, 1.8, 0);
    col.addBox(cxm, czm, 0.8, 1.15, -ry, -5, cym + 1.2, true);
    const sign = signMesh(['LEGACY MINE', { text: 'Access restricted', size: 56, color: '#ffffff' }], 3.4, 1.15, { w: 768, h: 260, bg: '#2a2018', fg: '#ff8a1c' }, true);
    sign.position.set(mx0 + fx * 7 + px * 5, my + 2.4, mz0 + fz * 7 + pz * 5);
    sign.rotation.y = ry;
    scene.add(sign);
    B.cyl(mx0 + fx * 7 + px * 5, my + 1.2, mz0 + fz * 7 + pz * 5, 0.08, 0.08, 2.4, 0x4a3320, 5);
  }

  // ------------------------------------------------------------- fireflies
  {
    const n = 420;
    const off = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { off[i * 3] = rng() * 80; off[i * 3 + 1] = rng(); off[i * 3 + 2] = rng() * 80; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aOff', new THREE.BufferAttribute(off, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uAlpha: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aOff; uniform float uTime; uniform vec3 uCenter; varying float vB;
        void main() {
          vec2 rel = mod(aOff.xz - uCenter.xz + 40.0, 80.0) - 40.0;
          vec3 w = vec3(uCenter.x + rel.x + sin(uTime * 0.5 + aOff.z) * 1.2, uCenter.y + 0.4 + aOff.y * 4.5 + sin(uTime * 0.8 + aOff.x) * 0.5, uCenter.z + rel.y + cos(uTime * 0.4 + aOff.x) * 1.2);
          vec4 mv = viewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          vB = 0.5 + 0.5 * sin(uTime * 2.0 + aOff.x * 7.0);
          gl_PointSize = clamp(55.0 / -mv.z, 2.0, 14.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAlpha; varying float vB;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vB * uAlpha;
          gl_FragColor = vec4(vec3(0.75, 1.0, 0.35) * a, a);
          #include <colorspace_fragment>
        }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    ctx.fireflies = mat;
  }
}


