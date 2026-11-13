const KEY = 'mining-haven:settings';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function sanitizeSettings(s) {
  s = s && typeof s === 'object' ? s : {};
  return {
    sensitivity: clamp(Number.isFinite(+s.sensitivity) && s.sensitivity !== undefined ? +s.sensitivity : 1, 0.2, 2.5),
    quality: ['low', 'medium', 'high'].includes(s.quality) ? s.quality : 'high',
    invertY: s.invertY === true,
  };
}

export function loadSettings() {
  try { return sanitizeSettings(JSON.parse(localStorage.getItem(KEY))); } catch { return sanitizeSettings(null); }
}
export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}
