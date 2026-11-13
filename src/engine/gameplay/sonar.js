
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
export const SONAR_RANGE = 90; // metres

/**
 * Underwater rock outcrops around a vessel, nearest first. Sonar sees a hard target on the bed, not what it is made of: every
 * contact is just an outcrop until somebody breaks it open.
 *   nodes: ore nodes ({ x, y, z, alive, type }); pos: {x,y,z}; heading: radians (0 = +Z, forward = (sin h, cos h)); level: water surface y
 * bearing is relative to the bow in radians: positive = to starboard (right), negative = to port; dy > 0 = above the vessel.
 */
export function sonarContacts(nodes, pos, heading, level, range = SONAR_RANGE, max = 12) {
  const out = [];
  for (const n of nodes) {
    if (!n.alive || n.y > level - 0.8) continue; // only what is under water
    const dx = n.x - pos.x, dz = n.z - pos.z, dy = n.y + 0.5 - pos.y, dist = Math.hypot(dx, dy, dz);
    if (dist > range) continue;
    out.push({ type: n.type, name: 'Rock outcrop', color: 0x9fd6c8, dist, flat: Math.hypot(dx, dz), bearing: wrap(heading - Math.atan2(dx, dz)), dy });
  }
  return out.sort((a, b) => a.dist - b.dist).slice(0, max);
}

/** "045 R" / "120 L" / "000" - relative bearing for the contact list */
export const fmtBearing = (rad) => { const d = Math.round(Math.abs(rad) * 180 / Math.PI) % 360; return `${String(d).padStart(3, '0')}${d === 0 || d === 180 ? '' : rad > 0 ? ' R' : ' L'}`; };