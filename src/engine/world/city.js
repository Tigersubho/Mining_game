import * as THREE from 'three';
import { DEG, LAND_Y } from '../config.js';
import { clamp } from '../math.js';
import { mulberry32 } from '../noise.js';
import { riverS, heightAt } from './terrain.js';
import { nearRoad } from './layout.js';
import { Batch } from './batch.js';
import { makeRamp } from './structures.js';
import { lamp, treeSmall, bench, car } from './props.js';
import { signMesh } from './textures.js';

// street grid ------------------------------------------------------
const XS = [-108, -72, -36, 0, 36, 72, 108];
const XW = [6, 6, 6, 12, 6, 6, 6]; // x = 0 is the main avenue
const ZS = [42, 78, 114, 150, 186, 222];
const ZW = [6, 6, 14, 6, 6, 6]; // z = 114 is the boulevard under the highway

export const CITY_GRID = { XS, XW, ZS, ZW };
export const HIGHWAY = { z: 114, H: 8.6, flat: 50, ramp: 32, w: 12 };

/** is (x,z) inside the flat, drawn part of the city? */
export function inCity(x, z, pad = 0) {
  const r = Math.hypot(x, z);
  if (r < 31 || r > 226) return false;
  if ((Math.abs(Math.atan2(x, z)) / DEG) > 38) return false;
  return riverS(x, z) > 9 + pad;
}

const ASPH = 0x3b3d42, LINE = 0xece8d8, YEL = 0xe8b92e, WALK = 0xc2bfb6, GRASS = 0x6aa357;
const PALETTE = [0xdacbb5, 0xc9b8a0, 0xb7bec6, 0xa7b1ba, 0xd3d8dc, 0xb7593f, 0x9c6c54, 0xe2dacb, 0x8fa5b5, 0xc7c0b2];
const CAR_COLORS = [0xc0392b, 0x2471a3, 0xf4d03f, 0xecf0f1, 0x2c3e50, 0x27ae60, 0xe67e22, 0x7f8c8d];

export function buildCity(ctx) {
  const rng = mulberry32(2024);
  const { col, flats } = ctx;
  const B = ctx.b.city;
  const Y = LAND_Y;

  // ---- roads ---------------------------------------------------
  for (let i = 0; i < XS.length; i++) {
    for (let z = 30; z < 232; z += 6) {
      if (inCity(XS[i], z + 3)) flats.road.rect(XS[i] - XW[i] / 2, z, XS[i] + XW[i] / 2, z + 6, Y + 0.05, ASPH);
    }
  }
  for (let j = 0; j < ZS.length; j++) {
    for (let x = -114; x < 114; x += 6) {
      if (inCity(x + 3, ZS[j])) flats.road.rect(x, ZS[j] - ZW[j] / 2, x + 6, ZS[j] + ZW[j] / 2, Y + 0.05, ASPH);
    }
  }
  // lane markings
  const inIntersection = (x, z) => {
    for (let i = 0; i < XS.length; i++) if (Math.abs(x - XS[i]) < XW[i] / 2 + 1.2) return true;
    for (let j = 0; j < ZS.length; j++) if (Math.abs(z - ZS[j]) < ZW[j] / 2 + 1.2) return true;
    return false;
  };
  for (let i = 0; i < XS.length; i++) {
    for (let z = 32; z < 230; z += 6) {
      if (!inCity(XS[i], z + 1.5, 1) ) continue;
      if (ZS.some((q, j) => Math.abs(z + 1.5 - q) < ZW[j] / 2 + 1.5)) continue;
      flats.mark.rect(XS[i] - 0.1, z, XS[i] + 0.1, z + 3, Y + 0.07, i === 3 ? YEL : LINE);
    }
  }
  for (let j = 0; j < ZS.length; j++) {
    for (let x = -112; x < 112; x += 6) {
      if (!inCity(x + 1.5, ZS[j], 1)) continue;
      if (XS.some((q, i) => Math.abs(x + 1.5 - q) < XW[i] / 2 + 1.5)) continue;
      flats.mark.rect(x, ZS[j] - 0.1, x + 3, ZS[j] + 0.1, Y + 0.07, j === 2 ? YEL : LINE);
    }
  }
  // crosswalks
  for (let i = 0; i < XS.length; i++) {
    for (let j = 0; j < ZS.length; j++) {
      if (!inCity(XS[i], ZS[j], 2)) continue;
      const hx = XW[i] / 2, hz = ZW[j] / 2;
      for (let k = -hx + 0.6; k < hx - 0.3; k += 1.0) {
        for (const sg of [-1, 1]) flats.mark.rect(XS[i] + k, ZS[j] + sg * (hz + 1.8), XS[i] + k + 0.5, ZS[j] + sg * (hz + 0.4), Y + 0.07, LINE);
      }
      for (let k = -hz + 0.6; k < hz - 0.3; k += 1.0) {
        for (const sg of [-1, 1]) flats.mark.rect(XS[i] + sg * (hx + 0.4), ZS[j] + k, XS[i] + sg * (hx + 1.8), ZS[j] + k + 0.5, Y + 0.07, LINE);
      }
    }
  }

  // ---- blocks: sidewalks + buildings ---------------------------------
  const winMat = ctx.windowMat;
  const BLD = ctx.buildings; // Batch with uv
  const hq = { cx: 21, cz: 168, s: 24 };
  const tiers = [];

  const addBuilding = (cx, cz, w, d, h, color) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const uo = Math.floor(rng() * 4) / 4;
    for (let v = 0; v < uv.count; v++) {
      const face = Math.floor(v / 4);
      const u0 = uv.getX(v), v0 = uv.getY(v);
      if (face === 0 || face === 1) uv.setXY(v, u0 * (d / 12) + uo, v0 * (h / 14.4));
      else if (face === 4 || face === 5) uv.setXY(v, u0 * (w / 12) + uo, v0 * (h / 14.4));
      else uv.setXY(v, 0.004, 0.004);
    }
    const m = new THREE.Matrix4().makeTranslation(cx, Y + h / 2, cz);
    BLD.add(g, m, color, 0.05);
    col.addBox(cx, cz, w / 2, d / 2, 0, -10, Y + h);
    // roof
    const top = Y + h;
    B.box(cx, top + 0.25, cz, w + 0.5, 0.5, d + 0.5, 0x8d8a82);
    const n = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const rx = cx + (rng() - 0.5) * (w - 4), rz = cz + (rng() - 0.5) * (d - 4);
      if (rng() < 0.5) B.box(rx, top + 1.2, rz, 2.4, 1.4, 2.0, 0xb5b8bb);
      else { B.cyl(rx, top + 2.0, rz, 1.3, 1.3, 2.4, 0x8a6a45, 10); B.cone(rx, top + 3.7, rz, 1.5, 1.0, 0x5d4630, 10); }
    }
    if (h > 40) B.cyl(cx, top + 5, cz, 0.08, 0.14, 9, 0xcfcfcf, 5);
  };

  for (let i = 0; i < XS.length - 1; i++) {
    for (let j = 0; j < ZS.length - 1; j++) {
      const x0 = XS[i] + XW[i] / 2, x1 = XS[i + 1] - XW[i + 1] / 2;
      const z0 = ZS[j] + ZW[j] / 2, z1 = ZS[j + 1] - ZW[j + 1] / 2;
      if (![[x0, z0], [x1, z0], [x0, z1], [x1, z1]].every(([x, z]) => inCity(x, z))) continue;
      flats.walk.rect(x0, z0, x1, z1, Y + 0.03, WALK);

      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      if (Math.abs(cx - hq.cx) < 18 && Math.abs(cz - hq.cz) < 18) {
        tiers.push({ x: cx, z: cz });
        continue;
      }
      const ix0 = x0 + 2.4, ix1 = x1 - 2.4, iz0 = z0 + 2.4, iz1 = z1 - 2.4;
      const lw = (ix1 - ix0 - 1.2) / 2, ld = (iz1 - iz0 - 1.2) / 2;
      for (let a = 0; a < 2; a++) {
        for (let c = 0; c < 2; c++) {
          const lx = ix0 + lw / 2 + a * (lw + 1.2), lz = iz0 + ld / 2 + c * (ld + 1.2);
          const kind = rng();
          if (nearRoad(lx, lz) < lw * 0.8) continue;
          if (kind < 0.13) {
            // pocket park
            flats.walk.rect(lx - lw / 2, lz - ld / 2, lx + lw / 2, lz + ld / 2, Y + 0.045, GRASS);
            treeSmall(B, col, lx - 2.5, lz - 2.5, Y, 1.3);
            treeSmall(B, col, lx + 2.5, lz + 2.2, Y, 1.1);
            bench(B, col, lx, lz + 3.5, 0, Y);
            continue;
          }
          if (kind > 0.93) continue;
          const dist = Math.hypot(lx, lz - 135);
          const tall = clamp(1 - dist / 120, 0, 1);
          const h = 10 + rng() * 16 + tall * (8 + rng() * 40);
          const sw = lw - rng() * 1.8, sd = ld - rng() * 1.8;
          addBuilding(lx, lz, sw, sd, h, PALETTE[Math.floor(rng() * PALETTE.length)]);
        }
      }
    }
  }

  // ---- HQ tower ----------------------------------------------------
  {
    const T = [[hq.s, 54], [hq.s - 7, 78], [hq.s - 14, 98]];
    T.forEach(([s, h], k) => {
      const g = new THREE.BoxGeometry(s, h, s);
      const uv = g.attributes.uv;
      for (let v = 0; v < uv.count; v++) {
        const face = Math.floor(v / 4);
        if (face < 2 || (face > 3)) uv.setXY(v, uv.getX(v) * (s / 12), uv.getY(v) * (h / 14.4));
        else uv.setXY(v, 0.004, 0.004);
      }
      BLD.add(g, new THREE.Matrix4().makeTranslation(hq.cx, Y + h / 2, hq.cz), k === 0 ? 0xaab4bd : k === 1 ? 0x95a3b0 : 0x7f92a3, 0);
    });
    col.addBox(hq.cx, hq.cz, hq.s / 2, hq.s / 2, 0, -10, Y + 98);
    B.cone(hq.cx, Y + 98 + 9, hq.cz, 1.2, 18, 0xd8d8d8, 6);
    B.box(hq.cx, Y + 54.3, hq.cz, hq.s + 1, 0.8, hq.s + 1, 0x6e7378);
    B.box(hq.cx, Y + 78.3, hq.cz, hq.s - 6, 0.8, hq.s - 6, 0x6e7378);
    const sign = signMesh([{ text: 'MINING HAVEN', size: 150 }, { text: 'HEADQUARTERS', size: 90, color: '#ffffff' }], 22, 6.6, { w: 1024, h: 307 });
    sign.position.set(hq.cx, Y + 40, hq.cz - hq.s / 2 - 0.1);
    sign.rotation.y = Math.PI;
    ctx.scene.add(sign);
    // lobby canopy
    B.box(hq.cx, Y + 4, hq.cz - hq.s / 2 - 2, 14, 0.4, 4.4, 0xf2b705);
  }

  // ---- elevated highway -----------------------------------------------
  {
    const { z: Z, H, flat, ramp, w: W } = HIGHWAY;
    const th = 0.08;
    B.box(0, H - 0.55 - th, Z, flat * 2, 1.1, W, 0xa09e95);
    B.box(0, H - th / 2, Z, flat * 2, th, W - 1.4, ASPH);
    col.addDeck({ x: 0, z: Z, ux: 1, uz: 0, hl: flat, hw: W / 2 - 0.2, hA: H, hB: H });
    for (const sg of [-1, 1]) {
      B.box(0, H + 0.45, Z + sg * (W / 2 - 0.2), flat * 2, 0.9, 0.4, 0xbdb9ae);
      B.box(0, H + 0.95, Z + sg * (W / 2 - 0.2), flat * 2, 0.08, 0.5, 0x8e8b82);
      col.addBox(0, Z + sg * (W / 2 - 0.2), flat, 0.22, 0, H - 0.4, H + 0.95);
    }
    for (let x = -flat + 3; x < flat - 2; x += 6) {
      B.box(x, H + 0.015, Z, 3, 0.02, 0.2, LINE);
    }
    B.box(0, H + 0.015, Z - 3.4, flat * 2, 0.02, 0.16, LINE);
    B.box(0, H + 0.015, Z + 3.4, flat * 2, 0.02, 0.16, LINE);
    for (let x = -flat; x <= flat; x += 20) {
      B.box(x, (H - 1.1 + Y) / 2, Z, 1.7, H - 1.1 - Y, 1.7, 0xa09e95);
      B.box(x, H - 1.3, Z, 2.4, 0.8, W - 2.5, 0xa09e95);
      col.addCircle(x, Z, 1.15, -5, H - 1.0);
    }
    for (let x = -flat + 8; x < flat; x += 16) {
      for (const sg of [-1, 1]) lamp(B, ctx.glow, col, x, Z + sg * (W / 2 - 0.9), H, { h: 5.5, arm: 1.2, ry: sg > 0 ? Math.PI : 0 });
    }
    makeRamp(B, col, { x: flat, z: Z, dx: 1, dz: 0, L: ramp, W, hA: H, hB: Y + 0.08 });
    makeRamp(B, col, { x: -flat, z: Z, dx: -1, dz: 0, L: ramp, W, hA: H, hB: Y + 0.08 });
    // "HIGH ROAD" gantry at the entry
    for (const sg of [-1, 1]) {
      const gx = sg * (flat + ramp - 6);
      const [gy] = [Y + 4.6];
      B.box(gx, gy, Z - 7.2, 0.5, 9, 0.5, 0x5b6068);
      B.box(gx, gy, Z + 7.2, 0.5, 9, 0.5, 0x5b6068);
      col.addCircle(gx, Z - 7.2, 0.4, -5, Y + 9);
      col.addCircle(gx, Z + 7.2, 0.4, -5, Y + 9);
      B.box(gx, Y + 9, Z, 0.6, 0.6, 15, 0x5b6068);
      const s = signMesh(['HIGH ROAD', { text: sg < 0 ? '→ EAST' : '← WEST', size: 70, color: '#ffffff' }], 8, 2.4, { w: 640, h: 192, bg: '#1d6b3a', fg: '#ffffff', border: '#ffffff' }, true);
      s.position.set(gx, Y + 7.8, Z);
      s.rotation.y = Math.PI / 2;
      ctx.scene.add(s);
    }
  }

  // ---- street furniture ---------------------------------------------------
  for (let i = 0; i < XS.length; i++) {
    for (let z = 36; z < 228; z += 24) {
      if (!inCity(XS[i], z, 3) || ZS.some((q, j) => Math.abs(z - q) < ZW[j] / 2 + 3)) continue;
      for (const sg of [-1, 1]) {
        lamp(B, ctx.glow, col, XS[i] + sg * (XW[i] / 2 + 0.7), z, Y, { h: 6, arm: 1.2, ry: sg > 0 ? -Math.PI / 2 : Math.PI / 2 });
      }
      if (rng() < 0.5) treeSmall(B, col, XS[i] + (rng() < 0.5 ? -1 : 1) * (XW[i] / 2 + 1.0), z + 12, Y, 1);
    }
  }
  for (let j = 0; j < ZS.length; j++) {
    for (let x = -108; x < 108; x += 24) {
      if (!inCity(x, ZS[j], 3) || XS.some((q, i) => Math.abs(x - q) < XW[i] / 2 + 3)) continue;
      lamp(B, ctx.glow, col, x, ZS[j] + ZW[j] / 2 + 0.7, Y, { h: 6, arm: 1.2, ry: Math.PI });
    }
  }

  // (no parked cars: every car in the world is driving somewhere)
}
