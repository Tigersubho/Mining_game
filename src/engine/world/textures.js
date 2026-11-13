import * as THREE from 'three';
import { mulberry32 } from '../noise.js';

export function windowTexture() {
  const rng = mulberry32(99);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const lit = rng() < 0.16;
      const x = i * 64 + 11, y = j * 64 + 13, w = 42, h = 38;
      g.fillStyle = lit ? '#ffe7a0' : rng() < 0.5 ? '#5f7d98' : '#4a647c';
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,0.28)';
      g.fillRect(x, y, w, 6);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x, y + h - 4, w, 4);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(x + w / 2 - 1, y, 2, h);
    }
    g.fillStyle = 'rgba(0,0,0,0.10)';
    g.fillRect(0, j * 64 + 58, 256, 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** text board texture. lines: array of strings (or {text,size,color}) */
export function signTexture(lines, { w = 1024, h = 256, bg = '#1c2530', fg = '#ffd23f', border = '#ffd23f', font = '"Arial Black", Impact, sans-serif' } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = border;
  g.lineWidth = 10;
  g.strokeRect(14, 14, w - 28, h - 28);
  // hazard stripes
  g.save();
  g.beginPath(); g.rect(14, 14, w - 28, h - 28); g.clip();
  g.fillStyle = border;
  for (let x = -h; x < w + h; x += 46) {
    g.beginPath(); g.moveTo(x, h - 14); g.lineTo(x + 24, h - 14); g.lineTo(x + 24 + 14, h - 4); g.lineTo(x + 14, h - 4); g.fill();
  }
  g.restore();
  const arr = Array.isArray(lines) ? lines : [lines];
  const n = arr.length;
  arr.forEach((ln, i) => {
    const o = typeof ln === 'string' ? { text: ln } : ln;
    const size = o.size ?? Math.min(h / (n + 0.6), 150);
    g.font = `${size}px ${font}`;
    g.fillStyle = o.color ?? fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(o.text, w / 2, (h / (n + 0.2)) * (i + 0.6) + 8, w - 90);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function signMesh(lines, width, height, opts = {}, doubleSided = false) {
  const tex = signTexture(lines, { ...opts, w: opts.w ?? 1024, h: opts.h ?? Math.round(1024 * (height / width)) });
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
}
