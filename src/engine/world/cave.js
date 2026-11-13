/**
 * Procedural cave network (pure geometry, no Three.js).
 * Axis-aligned tunnel segments -> occupancy grid -> merged floor / ceiling / wall rectangles.
 *   makeCave({ segments:[{x0,z0,x1,z1,w}], cell, floorY, height, entry:{x,z,w} })
 */
export function makeCave({ segments, cell = 3, floorY = 0, height = 3.8, entry }) {
  const open = new Set();
  const key = (i, j) => `${i},${j}`;
  const cellOf = (v) => Math.floor(v / cell);
  for (const s of segments) {
    const x0 = Math.min(s.x0, s.x1) - s.w / 2, x1 = Math.max(s.x0, s.x1) + s.w / 2;
    const z0 = Math.min(s.z0, s.z1) - s.w / 2, z1 = Math.max(s.z0, s.z1) + s.w / 2;
    for (let i = cellOf(x0); i <= cellOf(x1); i++) for (let j = cellOf(z0); j <= cellOf(z1); j++) {
      const cx = (i + 0.5) * cell, cz = (j + 0.5) * cell;
      if (cx >= x0 && cx <= x1 && cz >= z0 && cz <= z1) open.add(key(i, j));
    }
  }
  const isOpen = (i, j) => open.has(key(i, j));
  const cells = [...open].map((k) => k.split(',').map(Number));

  // greedy-merge the open cells into rectangles (rows of runs, merged vertically)
  const rects = [];
  const rows = new Map();
  for (const [i, j] of cells) { if (!rows.has(j)) rows.set(j, []); rows.get(j).push(i); }
  let live = new Map(); // "i0,i1" -> rect being extended
  for (const j of [...rows.keys()].sort((a, b) => a - b)) {
    const is = rows.get(j).sort((a, b) => a - b), runs = [];
    for (const i of is) { const r = runs.at(-1); r && r[1] === i - 1 ? (r[1] = i) : runs.push([i, i]); }
    const next = new Map();
    for (const [a, b] of runs) {
      const k = `${a},${b}`, r = live.get(k);
      if (r && r.j1 === j - 1) { r.j1 = j; next.set(k, r); live.delete(k); } else { const n = { i0: a, i1: b, j0: j, j1: j }; rects.push(n); next.set(k, n); }
    }
    live = next;
  }
  const toBox = (r) => ({ x: ((r.i0 + r.i1 + 1) / 2) * cell, z: ((r.j0 + r.j1 + 1) / 2) * cell, hx: ((r.i1 - r.i0 + 1) * cell) / 2, hz: ((r.j1 - r.j0 + 1) * cell) / 2 });
  const floors = rects.map(toBox);

  // walls on every open/closed boundary (merged into runs), except the entrance opening
  const T = 1; // wall thickness
  const edges = new Map(); // "axis,coord,side" -> [positions]
  const add = (axis, coord, side, pos) => { const k = `${axis},${coord},${side}`; if (!edges.has(k)) edges.set(k, []); edges.get(k).push(pos); };
  const inEntry = (j) => entry && Math.abs((j + 0.5) * cell - entry.z) <= entry.w / 2;
  // the entrance is the westmost open cell(s) of the tunnel on the entry row: left open (no wall)
  const entryX = entry ? Math.min(...cells.filter(([, j]) => inEntry(j)).map(([i]) => i)) : null;
  for (const [i, j] of cells) {
    if (!isOpen(i - 1, j) && !(i === entryX && inEntry(j))) add('x', i, -1, j); // west face
    if (!isOpen(i + 1, j)) add('x', i + 1, 1, j);
    if (!isOpen(i, j - 1)) add('z', j, -1, i);
    if (!isOpen(i, j + 1)) add('z', j + 1, 1, i);
  }
  const walls = [];
  for (const [k, list] of edges) {
    const [axis, c, side] = k.split(',');
    list.sort((a, b) => a - b);
    let a = list[0], b = a;
    const flush = () => {
      const len = (b - a + 1) * cell, mid = ((a + b + 1) / 2) * cell, at = +c * cell + (+side === 1 ? T / 2 : -T / 2);
      walls.push(axis === 'x' ? { x: at, z: mid, hx: T / 2, hz: len / 2 } : { x: mid, z: at, hx: len / 2, hz: T / 2 });
    };
    for (let n = 1; n < list.length; n++) { if (list[n] === b + 1) b = list[n]; else { flush(); a = b = list[n]; } }
    flush();
  }

  const westX = entry ? entryX * cell : -Infinity; // x of the open entrance face
  return {
    floorY, height, cell, cells: cells.length, floors, ceilings: floors, walls, segments,
    open: (x, z) => isOpen(cellOf(x), cellOf(z)),
    /** metres into the mountain along +x from the entrance (0 outside / in rock) - drives lighting */
    depth(x, z) { return isOpen(cellOf(x), cellOf(z)) && entry ? Math.max(0, x - entry.x) : 0; },
    /** within `m` metres of the open space, sampled on a 3x3 pattern (used to cut the terrain exactly to slab + wall thickness) */
    near(x, z, m) {
      if (entry && x < westX && Math.abs(z - entry.z) <= entry.w / 2) return false; // in front of the entrance the ground must stay solid
      for (const dx of [-m, 0, m]) for (const dz of [-m, 0, m]) if (isOpen(cellOf(x + dx), cellOf(z + dz))) return true;
      return false;
    },
  };
}

/** register every slab and wall as a physics collider (floor top = floorY, ceiling underside = floorY + height) */
export function addCaveColliders(col, cave) {
  const { floorY: f, height: h } = cave;
  for (const r of cave.floors) {
    col.addBox(r.x, r.z, r.hx, r.hz, 0, f - 1.5, f);
    col.addBox(r.x, r.z, r.hx, r.hz, 0, f + h, f + h + 1.5);
  }
  for (const w of cave.walls) col.addBox(w.x, w.z, w.hx, w.hz, 0, f - 1.5, f + h + 1.5);
}


