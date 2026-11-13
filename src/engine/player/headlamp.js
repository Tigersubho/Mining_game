/**
 * The miner's headlamp (pure battery model). Off by default: caves and deep water are genuinely dark until you switch it on (L).
 * It runs for 15 minutes on a full battery, then cuts out; the battery recharges slowly while the lamp is off
 * (faster in daylight, at the surface).
 */
export const LAMP_SECONDS = 15 * 60;
export const LAMP_LOW = 15; // % at which the warning shows

export const newLamp = () => ({ on: false, battery: 100, warned: false });

/**
 * One step. `dark` = the player is somewhere only the lamp lights (inside a cave, or deep under water).
 * Returns { lamp, event } where event is 'low' | 'flat' | 'charged' | null.
 */
export function stepLamp(l, dt, { dark = false } = {}) {
  let { on, battery, warned } = l, event = null;
  if (on) {
    battery = Math.max(0, battery - (100 / LAMP_SECONDS) * dt);
    if (battery <= 0) { on = false; event = 'flat'; }
    else if (battery < LAMP_LOW && !warned) { warned = true; event = 'low'; }
  } else {
    const was = battery;
    battery = Math.min(100, battery + (dark ? 0.4 : 3) * dt);
    if (battery > LAMP_LOW + 10) warned = false;
    if (was < 100 && battery >= 100) event = 'charged';
  }
  return { lamp: { on, battery, warned }, event };
}

export function toggleLamp(l) {
  if (!l.on && l.battery <= 0.5) return { lamp: l, event: 'flat' };
  return { lamp: { ...l, on: !l.on }, event: null };
}

/**
 * What the two lamp lights should do: a WIDE beam (fills the tunnel round you) and a REACH beam (a narrow, long one that lights the way
 * ahead). Stronger in a cave, tinted and shorter under water, dimming as the battery runs flat.
 */
export function lampBeam(l, { cave = 0, underwater = false } = {}) {
  if (!l.on || l.battery <= 0) return { intensity: 0, reach: 0, distance: 40, reachDistance: 60, color: 0xfff0d0 };
  const fade = l.battery < LAMP_LOW ? 0.45 + 0.55 * (l.battery / LAMP_LOW) : 1;
  if (underwater) return { intensity: 90 * fade, reach: 150 * fade, distance: 36, reachDistance: 60, color: 0xcff6ff };
  const base = 26 + 70 * cave;
  return { intensity: base * fade, reach: base * 1.7 * fade, distance: 46, reachDistance: 95, color: 0xfff0d0 };
}
