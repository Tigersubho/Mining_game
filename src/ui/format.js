const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const cardinal = (deg) => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

const pad = (v) => `${v < 0 ? '-' : '+'}${String(Math.round(Math.abs(v))).padStart(4, '0')}`;
/** world (x,z) -> grid easting / northing in metres (north = -z) */
export const fmtCoord = (x, z) => ({ e: pad(x), n: pad(-z) });

export const kmh = (ms) => (ms * 3.6).toFixed(1);
export const fmtElev = (y) => `${y < 0 ? '-' : '+'}${Math.abs(y).toFixed(1)}`;

/** ticks for the compass tape: every 5 degrees over three full turns (so it can scroll seamlessly) */
export function compassMarks() {
  const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  const out = [];
  for (let deg = 0; deg <= 1080; deg += 5) out.push({ deg, label: labels[deg % 360] ?? '', major: deg % 15 === 0 });
  return out;
}
