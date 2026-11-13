/** Walkable graph (nodes are [x, z] with an optional tag), Dijkstra, reachability. Pure. */
export class Graph {
  constructor() { this.nodes = []; this.adj = []; }

  add(x, z, tag = '', y = null) { this.nodes.push({ id: this.nodes.length, x, z, tag, y }); this.adj.push([]); return this.nodes.length - 1; }
  link(a, b) {
    const d = Math.hypot(this.nodes[a].x - this.nodes[b].x, this.nodes[a].z - this.nodes[b].z);
    if (!this.adj[a].some((e) => e.to === b)) { this.adj[a].push({ to: b, d }); this.adj[b].push({ to: a, d }); }
  }

  nearest(x, z, filter = null) {
    let best = -1, bd = Infinity;
    for (const n of this.nodes) {
      if (filter && !filter(n)) continue;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n.id; }
    }
    return best;
  }

  component(a) {
    const seen = new Set([a]), q = [a];
    while (q.length) for (const e of this.adj[q.pop()]) if (!seen.has(e.to)) { seen.add(e.to); q.push(e.to); }
    return seen;
  }

  /** shortest node-id path a -> b (inclusive) or null */
  path(a, b) {
    if (a === b) return [a];
    const dist = new Map([[a, 0]]), prev = new Map(), open = new Set([a]);
    while (open.size) {
      let u = -1, ud = Infinity;
      for (const n of open) if (dist.get(n) < ud) { ud = dist.get(n); u = n; }
      if (u === b) break;
      open.delete(u);
      for (const e of this.adj[u]) {
        const nd = ud + e.d;
        if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, u); open.add(e.to); }
      }
    }
    if (!prev.has(b)) return null;
    const out = [b];
    while (out[0] !== a) out.unshift(prev.get(out[0]));
    return out;
  }
}
