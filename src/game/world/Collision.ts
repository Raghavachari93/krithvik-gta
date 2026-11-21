import { terrainY } from '../constants';

export const enum BoxKind {
  Building = 0,
  Prop = 1,
  Tree = 2,
  Rail = 3,
  Surface = 4,
}

export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  kind: BoxKind;
  id: number;
}

export interface Ramp {
  cx: number;
  cz: number;
  yaw: number;
  len: number;
  wid: number;
  h0: number;
  h1: number;
  cos: number;
  sin: number;
  id: number;
  stunt: boolean;
}

export interface RayHit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
  box: Box | null;
}

const CELL = 40;
const OFF = 2000;
const key = (ix: number, iz: number) => (ix + OFF) * 8192 + (iz + OFF);

/** Static collision world: AABB buildings/props + oriented ramps + analytic terrain. */
export class CollisionWorld {
  boxes: Box[] = [];
  ramps: Ramp[] = [];
  private grid = new Map<number, number[]>();
  private rampGrid = new Map<number, number[]>();
  private marks = new Int32Array(1024);
  private stamp = 1;
  private tmp: Box[] = [];

  addBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, kind: BoxKind = BoxKind.Building): Box {
    const b: Box = { minX, minY, minZ, maxX, maxY, maxZ, kind, id: this.boxes.length };
    this.boxes.push(b);
    if (this.marks.length < this.boxes.length) {
      const m = new Int32Array(this.marks.length * 2);
      m.set(this.marks);
      this.marks = m;
    }
    const ix0 = Math.floor(minX / CELL),
      ix1 = Math.floor(maxX / CELL),
      iz0 = Math.floor(minZ / CELL),
      iz1 = Math.floor(maxZ / CELL);
    for (let ix = ix0; ix <= ix1; ix++)
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = key(ix, iz);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(b.id);
      }
    return b;
  }

  addBoxCentered(x: number, z: number, w: number, d: number, y0: number, h: number, kind: BoxKind = BoxKind.Building) {
    return this.addBox(x - w / 2, y0, z - d / 2, x + w / 2, y0 + h, z + d / 2, kind);
  }

  addRamp(cx: number, cz: number, yaw: number, len: number, wid: number, h0: number, h1: number, stunt = false): Ramp {
    const r: Ramp = { cx, cz, yaw, len, wid, h0, h1, cos: Math.cos(yaw), sin: Math.sin(yaw), id: this.ramps.length, stunt };
    this.ramps.push(r);
    const ext = Math.max(len, wid) / 2 + 1;
    for (let ix = Math.floor((cx - ext) / CELL); ix <= Math.floor((cx + ext) / CELL); ix++)
      for (let iz = Math.floor((cz - ext) / CELL); iz <= Math.floor((cz + ext) / CELL); iz++) {
        const k = key(ix, iz);
        let arr = this.rampGrid.get(k);
        if (!arr) this.rampGrid.set(k, (arr = []));
        arr.push(r.id);
      }
    return r;
  }

  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Box[] = this.tmp): Box[] {
    out.length = 0;
    const s = ++this.stamp;
    const ix0 = Math.floor(minX / CELL),
      ix1 = Math.floor(maxX / CELL),
      iz0 = Math.floor(minZ / CELL),
      iz1 = Math.floor(maxZ / CELL);
    for (let ix = ix0; ix <= ix1; ix++)
      for (let iz = iz0; iz <= iz1; iz++) {
        const arr = this.grid.get(key(ix, iz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const id = arr[i];
          if (this.marks[id] === s) continue;
          this.marks[id] = s;
          const b = this.boxes[id];
          if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
          out.push(b);
        }
      }
    return out;
  }

  /** Height of ramp surface at a point (or -Infinity). Also returns the ramp via lastRamp. */
  lastRamp: Ramp | null = null;
  rampY(x: number, z: number): number {
    const arr = this.rampGrid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    let best = -Infinity;
    this.lastRamp = null;
    if (!arr) return best;
    for (const id of arr) {
      const r = this.ramps[id];
      const dx = x - r.cx,
        dz = z - r.cz;
      // local axes: u along yaw forward (sin,cos), v across
      const u = dx * r.sin + dz * r.cos;
      const v = dx * r.cos - dz * r.sin;
      if (Math.abs(u) > r.len / 2 || Math.abs(v) > r.wid / 2) continue;
      const h = r.h0 + ((u + r.len / 2) / r.len) * (r.h1 - r.h0);
      if (h > best) {
        best = h;
        this.lastRamp = r;
      }
    }
    return best;
  }

  /** Highest walkable surface at (x,z) not more than `step` above y. */
  surfaceY(x: number, z: number, y: number, step: number): number {
    let g = terrainY(x, z);
    const lim = y + step;
    const boxes = this.query(x - 0.01, z - 0.01, x + 0.01, z + 0.01);
    for (const b of boxes) {
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (b.maxY <= lim && b.maxY > g) g = b.maxY;
    }
    const r = this.rampY(x, z);
    if (r <= lim && r > g) g = r;
    return g;
  }

  /** True if there is something solid overhead between y and y+h at x,z. */
  ceilingAt(x: number, z: number, y: number): number {
    let c = Infinity;
    for (const b of this.query(x - 0.01, z - 0.01, x + 0.01, z + 0.01)) {
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (b.minY > y && b.minY < c) c = b.minY;
    }
    return c;
  }

  /**
   * Push a vertical circle out of boxes. Mutates p. Returns accumulated push normal and max penetration.
   */
  pushResult = { hit: false, nx: 0, nz: 0, pen: 0, box: null as Box | null };
  pushCircle(p: { x: number; z: number }, r: number, feetY: number, headY: number, step: number) {
    const res = this.pushResult;
    res.hit = false;
    res.nx = 0;
    res.nz = 0;
    res.pen = 0;
    res.box = null;
    const boxes = this.query(p.x - r, p.z - r, p.x + r, p.z + r);
    for (const b of boxes) {
      if (b.maxY <= feetY + step || b.minY >= headY) continue;
      const cx = p.x < b.minX ? b.minX : p.x > b.maxX ? b.maxX : p.x;
      const cz = p.z < b.minZ ? b.minZ : p.z > b.maxZ ? b.maxZ : p.z;
      let dx = p.x - cx,
        dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let nx = 0,
        nz = 0,
        pen = 0;
      if (d2 < 1e-9) {
        const l = p.x - b.minX,
          rr = b.maxX - p.x,
          t = p.z - b.minZ,
          bt = b.maxZ - p.z;
        const m = Math.min(l, rr, t, bt);
        if (m === l) {
          nx = -1;
          pen = l + r;
        } else if (m === rr) {
          nx = 1;
          pen = rr + r;
        } else if (m === t) {
          nz = -1;
          pen = t + r;
        } else {
          nz = 1;
          pen = bt + r;
        }
      } else {
        const d = Math.sqrt(d2);
        nx = dx / d;
        nz = dz / d;
        pen = r - d;
      }
      p.x += nx * pen;
      p.z += nz * pen;
      res.hit = true;
      res.nx += nx;
      res.nz += nz;
      if (pen > res.pen) {
        res.pen = pen;
        res.box = b;
      }
    }
    if (res.hit) {
      const l = Math.hypot(res.nx, res.nz) || 1;
      res.nx /= l;
      res.nz /= l;
    }
    return res;
  }

  /** Ray vs static boxes (and optionally terrain). Direction must be normalised. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, terrain = true): RayHit | null {
    const ex = ox + dx * maxDist,
      ez = oz + dz * maxDist;
    const boxes = this.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez));
    let best: RayHit | null = null;
    let bestT = maxDist;
    const idx = dx !== 0 ? 1 / dx : 1e12,
      idy = dy !== 0 ? 1 / dy : 1e12,
      idz = dz !== 0 ? 1 / dz : 1e12;
    for (const b of boxes) {
      let t1 = (b.minX - ox) * idx,
        t2 = (b.maxX - ox) * idx;
      let tmin = Math.min(t1, t2),
        tmax = Math.max(t1, t2);
      let ax = 0;
      t1 = (b.minY - oy) * idy;
      t2 = (b.maxY - oy) * idy;
      let ymin = Math.min(t1, t2);
      const ymax = Math.max(t1, t2);
      if (ymin > tmin) {
        tmin = ymin;
        ax = 1;
      }
      if (ymax < tmax) tmax = ymax;
      t1 = (b.minZ - oz) * idz;
      t2 = (b.maxZ - oz) * idz;
      const zmin = Math.min(t1, t2),
        zmax = Math.max(t1, t2);
      if (zmin > tmin) {
        tmin = zmin;
        ax = 2;
      }
      if (zmax < tmax) tmax = zmax;
      if (tmax < Math.max(tmin, 0) || tmin > bestT) continue;
      if (tmin < 0) continue; // origin inside box: ignore
      bestT = tmin;
      best = {
        t: tmin,
        nx: ax === 0 ? -Math.sign(dx) : 0,
        ny: ax === 1 ? -Math.sign(dy) : 0,
        nz: ax === 2 ? -Math.sign(dz) : 0,
        box: b,
      };
    }
    if (terrain && dy < 0) {
      // coarse march for terrain (flat-ish world)
      const steps = Math.ceil(bestT / 2);
      for (let i = 1; i <= steps; i++) {
        const t = Math.min(i * 2, bestT);
        const px = ox + dx * t,
          py = oy + dy * t,
          pz = oz + dz * t;
        if (py < terrainY(px, pz)) {
          return { t: Math.max(0, t - 1), nx: 0, ny: 1, nz: 0, box: null };
        }
      }
    }
    return best;
  }

  /** Line of sight between two points (true if clear). */
  los(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    const dx = bx - ax,
      dy = by - ay,
      dz = bz - az;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.01) return true;
    const h = this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d, false);
    return !h;
  }
}
