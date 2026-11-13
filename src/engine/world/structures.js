import * as THREE from 'three';

/** vertical profile prism: solid from y0 up to a sloped top line hA -> hB, along +X (0..L), centred on Z */
export function wedgeGeo(L, W, y0, hA, hB) {
  const s = new THREE.Shape();
  s.moveTo(0, y0); s.lineTo(L, y0); s.lineTo(L, hB); s.lineTo(0, hA); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: false });
  g.translate(0, 0, -W / 2);
  return g;
}

/** thin sloped slab (road surface) */
export function slabGeo(L, W, yA, yB, th) {
  const s = new THREE.Shape();
  s.moveTo(0, yA); s.lineTo(L, yB); s.lineTo(L, yB + th); s.lineTo(0, yA + th); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: false });
  g.translate(0, 0, -W / 2);
  return g;
}

/**
 * Solid ramp / embankment from (x,z) along (dx,dz), surface height hA -> hB.
 * Adds visuals, side walls (collision) and a walkable deck.
 */
export function makeRamp(b, col, o) {
  const { x, z, dx, dz, L, W, hA, hB } = o;
  const y0 = o.y0 ?? -8;
  const body = o.color ?? 0x9b988f;
  const top = o.top ?? 0x3b3d42;
  const th = 0.08;
  const ry = Math.atan2(-dz, dx);
  const phi = Math.atan2(dz, dx);
  b.geo(wedgeGeo(L, W, y0, hA - th, hB - th), x, 0, z, body, ry);
  b.geo(slabGeo(L, W - 1.2, hA - th, hB - th, th + 0.01), x, 0, z, top, ry);

  col.addDeck({ x: x + (dx * L) / 2, z: z + (dz * L) / 2, ux: dx, uz: dz, hl: L / 2, hw: W / 2 - 0.2, hA, hB });

  if (o.walls !== false) {
    const slope = Math.atan2(hB - hA, L);
    const len = Math.hypot(L, hB - hA);
    const hMax = Math.max(hA, hB);
    // close the solid under the high end (you could otherwise walk into the embankment from below)
    const hi = hA > hB ? 0 : 1;
    col.addBox(x + dx * L * hi, z + dz * L * hi, 0.2, W / 2, phi, -10, hMax - 0.35);
    for (const side of [-1, 1]) {
      const off = side * (W / 2 - 0.3);
      const px = x + (dx * L) / 2 + -dz * off, pz = z + (dz * L) / 2 + dx * off;
      // visual barrier
      b.box(px, (hA + hB) / 2 + 0.45, pz, len, 0.9, 0.5, 0xbdb9ae, ry, 0, slope);
      // solid collision wall (keeps people off the embankment sides)
      col.addBox(px, pz, L / 2, 0.3, phi, -10, hMax + 0.9);
    }
  }
}
