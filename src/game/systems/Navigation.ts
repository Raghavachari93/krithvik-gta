import { CityLayout, GNode } from '../world/CityLayout';

/** A* routing over the road graph + GPS waypoint state. */
export class Navigation {
  waypoint: { x: number; z: number } | null = null;
  missionTarget: { x: number; z: number } | null = null;
  route: { x: number; z: number }[] = [];
  private timer = 0;

  constructor(private layout: CityLayout) {}

  nearestNode(x: number, z: number, exclude?: Set<number>): GNode {
    let best = this.layout.nodes[0],
      bd = Infinity;
    for (const n of this.layout.nodes) {
      if (exclude && exclude.has(n.id)) continue;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  path(a: GNode, b: GNode): GNode[] {
    const nodes = this.layout.nodes;
    const open = new Set<number>([a.id]);
    const came = new Map<number, number>();
    const gS = new Map<number, number>([[a.id, 0]]);
    const fS = new Map<number, number>([[a.id, Math.hypot(a.x - b.x, a.z - b.z)]]);
    let guard = 0;
    while (open.size && guard++ < 5000) {
      let cur = -1,
        best = Infinity;
      for (const id of open) {
        const f = fS.get(id) ?? Infinity;
        if (f < best) {
          best = f;
          cur = id;
        }
      }
      if (cur === b.id) {
        const out: GNode[] = [nodes[cur]];
        while (came.has(cur)) {
          cur = came.get(cur)!;
          out.push(nodes[cur]);
        }
        return out.reverse();
      }
      open.delete(cur);
      const cn = nodes[cur];
      for (const nid of cn.links) {
        const nn = nodes[nid];
        const tg = (gS.get(cur) ?? Infinity) + Math.hypot(cn.x - nn.x, cn.z - nn.z);
        if (tg < (gS.get(nid) ?? Infinity)) {
          came.set(nid, cur);
          gS.set(nid, tg);
          fS.set(nid, tg + Math.hypot(nn.x - b.x, nn.z - b.z));
          open.add(nid);
        }
      }
    }
    return [a, b];
  }

  routeBetween(x0: number, z0: number, x1: number, z1: number) {
    const a = this.nearestNode(x0, z0),
      b = this.nearestNode(x1, z1);
    const p = this.path(a, b).map((n) => ({ x: n.x, z: n.z }));
    return [{ x: x0, z: z0 }, ...p, { x: x1, z: z1 }];
  }

  get target() {
    return this.missionTarget ?? this.waypoint;
  }

  setWaypoint(x: number, z: number) {
    this.waypoint = { x, z };
    this.timer = 99;
  }
  clearWaypoint() {
    this.waypoint = null;
    this.route = [];
  }

  update(dt: number, px: number, pz: number) {
    const t = this.target;
    if (!t) {
      this.route = [];
      return;
    }
    if (this.waypoint && !this.missionTarget && Math.hypot(px - this.waypoint.x, pz - this.waypoint.z) < 15) {
      this.clearWaypoint();
      return;
    }
    this.timer += dt;
    if (this.timer > 0.6) {
      this.timer = 0;
      if (Math.hypot(px - t.x, pz - t.z) < 60) this.route = [{ x: px, z: pz }, t];
      else this.route = this.routeBetween(px, pz, t.x, t.z);
      // drop the first graph node if we're already past it
      if (this.route.length > 3) {
        const a = this.route[1],
          b = this.route[2];
        const dab = Math.hypot(a.x - b.x, a.z - b.z),
          dpb = Math.hypot(px - b.x, pz - b.z);
        if (dpb < dab) this.route.splice(1, 1);
      }
    }
  }

  /** Next point to steer toward (for the in-world arrow). */
  nextPoint() {
    return this.route.length > 1 ? this.route[1] : null;
  }
}
