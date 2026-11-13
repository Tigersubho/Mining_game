/** circular no-vegetation zones (dive base, cave mouths, ...) */
const zones = [];
export const addKeepOut = (x, z, r) => zones.push([x, z, r]);
export const nearKeepOut = (x, z) => zones.some(([a, b, r]) => (x - a) ** 2 + (z - b) ** 2 < r * r);
