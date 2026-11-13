import { TERRAIN_SIZE, WATER_Y, PIT, SECTOR_ANGLES, LAKE, RIDGE, DIVE, polar } from './config.js';
import { ROUTES, BRIDGES, NETWORK } from './world/layout.js';

const px = (x, S) => ((x + TERRAIN_SIZE / 2) / TERRAIN_SIZE) * S;
const srgb = (v) => Math.round(255 * Math.pow(Math.min(1, v), 1 / 2.2));

/** static map background: desaturated terrain, water, roads, bridges, zone labels */
export function drawMinimapBg(canvas, { colors, heights, N }) {
  const S = canvas.width, g = canvas.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = Math.round((x / (S - 1)) * (N - 1)), j = Math.round((y / (S - 1)) * (N - 1)), k = j * N + i;
      const wx = (i / (N - 1) - 0.5) * TERRAIN_SIZE, wz = (j / (N - 1) - 0.5) * TERRAIN_SIZE;
      let r, gg, b;
      if (heights[k] < WATER_Y && Math.hypot(wx - PIT.x, wz - PIT.z) > PIT.R + 20) {
        const d = Math.min(1, (WATER_Y - heights[k]) / 3);
        r = 38 - 14 * d; gg = 78 - 24 * d; b = 104 - 20 * d;
      } else {
        const shade = 0.75 + Math.min(0.25, Math.max(-0.2, (heights[k] - 1.5) * 0.02));
        const R = colors[k * 3], G = colors[k * 3 + 1], B = colors[k * 3 + 2], l = 0.3 * R + 0.59 * G + 0.11 * B;
        r = srgb((R * 0.45 + l * 0.55) * shade * 0.8); gg = srgb((G * 0.45 + l * 0.55) * shade * 0.8); b = srgb((B * 0.45 + l * 0.55) * shade * 0.8);
      }
      const o = (y * S + x) * 4;
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  const line = (pts, w, c) => { g.strokeStyle = c; g.lineWidth = w; g.lineCap = g.lineJoin = 'round'; g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(px(x, S), px(z, S)) : g.moveTo(px(x, S), px(z, S)))); g.stroke(); };
  for (const r of ROUTES) line(r.pts, Math.max(1.2, (r.width / TERRAIN_SIZE) * S * (r.kind === 'highway' ? 2.2 : 1.5)), r.kind === 'highway' ? '#6a7079' : r.kind === 'street' ? '#3a3f46' : r.kind === 'haul' ? '#a9a38f' : r.kind === 'rail' ? '#c9c4b8' : '#8b7a5e');
  for (const x of [-108, -72, -36, 0, 36, 72, 108]) line([[x, 34], [x, 224]], 1, '#2f343a');
  for (const z of [42, 78, 114, 150, 186, 222]) line([[-108, z], [108, z]], 1, '#2f343a');
  line([[-82, 114], [82, 114]], 1.8, '#d9a21b');
  g.fillStyle = '#b3a85a';
  for (const farm of NETWORK.farms) for (const f of farm.fields) g.fillRect(px(f.x0, S), px(f.z0, S), (f.w / TERRAIN_SIZE) * S, (f.d / TERRAIN_SIZE) * S); // farm fields
  for (const b of BRIDGES) line([[b.x - b.dirx * b.length / 2, b.z - b.dirz * b.length / 2], [b.x + b.dirx * b.length / 2, b.z + b.dirz * b.length / 2]], 2.4, '#e6e2d6');
  g.strokeStyle = '#8c5b34'; g.lineWidth = 1.4;
  g.beginPath(); g.arc(px(PIT.x, S), px(PIT.z, S), (PIT.R / TERRAIN_SIZE) * S, 0, Math.PI * 2); g.stroke();

  g.font = '600 10px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.textAlign = 'center';
  g.fillStyle = '#e8e6df'; g.strokeStyle = '#000c'; g.lineWidth = 3;
  const label = (t, r, a) => { const [x, z] = polar(r, a); g.strokeText(t, px(x, S), px(z, S)); g.fillText(t, px(x, S), px(z, S)); };
  label('URBAN CENTRE', 150, SECTOR_ANGLES.city);
  label('JUNGLE ZONE', 150, SECTOR_ANGLES.jungle);
  label('PIT & SITE WORKS', 85, SECTOR_ANGLES.construction);
  label('HUB', 0, 0);
  g.fillStyle = '#e8e6df'; for (const farm of NETWORK.farms) { g.strokeText('FARM', px(farm.cx, S), px(farm.cz + 8, S)); g.fillText('FARM', px(farm.cx, S), px(farm.cz + 8, S)); }
  g.fillText('GREAT LAKE', px(LAKE.x, S), px(LAKE.z, S));
  g.fillText('RIDGE MINE', px(RIDGE.x, S), px(RIDGE.z, S) - 10);
  g.fillText('DIVE BASE', px(DIVE.x, S), px(DIVE.z, S) - 8);
}

/** survey layer: excavations, confirmed finds, saved anomaly locations, the navigation target, rover and drone */
const SENSOR_CSS = { gpr: '#f0a030', mag: '#4aa3ff', gamma: '#c8e04a', emi: '#38d6b0', res: '#ff7a3a', ip: '#b36bff', seis: '#ff5a5a' };
function drawSurveyMarks(g, S, sv, player) {
  for (const e of sv.excavations) {
    const x = px(e.x, S), y = px(e.z, S);
    g.strokeStyle = e.ok ? '#7dff9a' : '#b9b2a6'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(x - 3, y - 3); g.lineTo(x + 3, y + 3); g.moveTo(x + 3, y - 3); g.lineTo(x - 3, y + 3); g.stroke();
  }
  for (const f of sv.finds) { // confirmed deposit: a green star
    const x = px(f.x, S), y = px(f.z, S);
    g.fillStyle = '#7dff9a'; g.strokeStyle = '#000'; g.lineWidth = 1; g.beginPath();
    for (let k = 0; k < 10; k++) { const r = k % 2 ? 2.6 : 6, a = (k / 10) * Math.PI * 2 - Math.PI / 2; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    g.closePath(); g.fill(); g.stroke();
  }
  for (const w of sv.waypoints) {
    const x = px(w.x, S), y = px(w.z, S), tgt = sv.target === w.id;
    g.fillStyle = w.confirmed === 'barren' ? '#8a8a8a' : SENSOR_CSS[w.sensor] ?? '#fff'; g.strokeStyle = tgt ? '#fff' : '#000'; g.lineWidth = tgt ? 2 : 1;
    g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 5, y); g.lineTo(x, y + 6); g.lineTo(x - 5, y); g.closePath(); g.fill(); g.stroke();
    if (tgt) {
      g.setLineDash([4, 4]); g.strokeStyle = '#ffffffaa'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(px(player.pos.x, S), px(player.pos.z, S)); g.lineTo(x, y); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.arc(x, y, 10, 0, 7); g.stroke();
    }
  }
  const plat = (o, c, shape) => {
    if (!o.deployed) return;
    const x = px(o.x, S), y = px(o.z, S);
    g.fillStyle = c; g.strokeStyle = '#000'; g.lineWidth = 1.2;
    if (shape === 'x') { g.beginPath(); g.moveTo(x - 5, y - 5); g.lineTo(x + 5, y + 5); g.moveTo(x + 5, y - 5); g.lineTo(x - 5, y + 5); g.strokeStyle = c; g.lineWidth = 2.4; g.stroke(); g.beginPath(); g.arc(x, y, 2.4, 0, 7); g.fill(); }
    else { g.fillRect(x - 4, y - 3, 8, 6); g.strokeRect(x - 4, y - 3, 8, 6); }
  };
  plat(sv.rover, '#ffffff', 'box');
  plat(sv.drone, '#ff9f2a', 'x');
}

/** live layer: player marker (north is up: -Z) */
const DOT = { taxi: '#f2c200', gmc: '#ffffff', car: '#cfd4d8', jeep: '#7fae4a', pickup: '#e0a526', jcb: '#e0a526', boat: '#4fb3e8' };
export function drawMinimapFg(canvas, player, extra = null) {
  const S = canvas.width, g = canvas.getContext('2d');
  g.clearRect(0, 0, S, S);
  if (extra) {
    if (extra.survey?.cov) g.drawImage(extra.survey.cov, 0, 0, S, S); // survey coverage + track history
    for (const n of extra.npcs.people) if (n.brain.visible) { g.fillStyle = '#9aa3ab'; g.fillRect(px(n.brain.x, S) - 1, px(n.brain.z, S) - 1, 2.5, 2.5); }
    for (const v of extra.fleet.vehicles) { g.fillStyle = DOT[v.kind] ?? '#fff'; g.strokeStyle = '#000a'; g.lineWidth = 1; g.beginPath(); g.arc(px(v.x, S), px(v.z, S), v.kind === 'boat' ? 3.2 : 2.6, 0, 6.3); g.fill(); g.stroke(); }
    if (extra.survey) drawSurveyMarks(g, S, extra.survey, player);
  }
  g.save();
  g.translate(px(player.pos.x, S), px(player.pos.z, S));
  g.rotate(Math.PI - player.facing);
  g.fillStyle = '#e0a526'; g.strokeStyle = '#111'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(0, 3); g.lineTo(-5.5, 6); g.closePath(); g.fill(); g.stroke();
  g.restore();
}

