export const BREATH_SECONDS = 45; // free-diving lungs
export const SCUBA_SECONDS = 720; // 12 min at the surface rate
const LOW = 10;

/** absolute pressure at `depth` metres (1 atm at the surface, +1 per 10 m) */
export const ambientAtm = (depth) => 1 + Math.max(0, depth) / 10;

export const newBreath = () => ({ air: BREATH_SECONDS, tank: 100, blackoutT: 0 });

/**
 * Advance the air supply by dt seconds.
 *   air = lungs (seconds)   tank = scuba cylinder (percent)   returns { state, event: 'low'|'blackout'|null }
 * Underwater: scuba drains the tank at 100/SCUBA_SECONDS per second x pressure; free diving drains the lungs x pressure.
 */
export function stepBreath(s, dt, { underwater, depth = 0, scuba = false, atBase = false }) {
  let { air, tank, blackoutT } = s, event = null;
  const atm = ambientAtm(depth);
  if (underwater) {
    if (scuba && tank > 0) tank = Math.max(0, tank - (100 / SCUBA_SECONDS) * atm * dt);
    else air = Math.max(0, air - atm * dt);
    if (air <= 0) blackoutT += dt; else blackoutT = 0;
    const lowNow = scuba && tank > 0 ? tank < 12 : air < LOW;
    const lowBefore = scuba && s.tank > 0 ? s.tank < 12 : s.air < LOW;
    if (lowNow && !lowBefore) event = 'low';
    if (blackoutT >= 3) { event = 'blackout'; }
  } else {
    air = Math.min(BREATH_SECONDS, air + (BREATH_SECONDS / 6) * dt); // catch your breath
    blackoutT = 0;
  }
  if (atBase) tank = Math.min(100, tank + 10 * dt);
  return { state: { air, tank, blackoutT }, event };
}
