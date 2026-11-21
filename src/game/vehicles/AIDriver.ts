import { ROAD_HALF } from '../constants';
import { clamp, wrapAngle } from '../core/math';
import type { Game } from '../Game';
import { GNode } from '../world/CityLayout';
import type { Vehicle } from './Vehicle';

export type DriveMode = 'traffic' | 'pursuit' | 'race' | 'flee' | 'goto' | 'idle';

interface P2 {
  x: number;
  z: number;
}

/** Drives a physics vehicle by producing throttle/brake/steer inputs. */
export class AIDriver {
  mode: DriveMode = 'traffic';
  from!: GNode;
  to!: GNode;
  laneOff = 2;
  laneTarget = 2;
  turnPts: P2[] | null = null;
  next: GNode | null = null;
  cruise = 13;
  skill = 1;
  stuckT = 0;
  reverseT = 0;
  blockedT = 0;
  honkT = 0;
  panicT = 0;
  route: P2[] = [];
  routeIdx = 0;
  routeT = 0;
  target: P2 | null = null;
  checkpoints: P2[] = [];
  cpIndex = 0;
  lap = 0;
  finished = false;
  aggressive = false;
  stopDist = 0;
  private lastHonk = 0;

  constructor(public v: Vehicle) {}

  startTraffic(from: GNode, to: GNode, lane = Math.random() < 0.5 ? 2 : 6) {
    this.mode = 'traffic';
    this.from = from;
    this.to = to;
    this.laneOff = this.laneTarget = lane;
    this.turnPts = null;
    this.next = null;
    this.cruise = 11 + Math.random() * 4;
  }

  update(dt: number, g: Game) {
    const v = this.v;
    const inp = v.input;
    inp.handbrake = false;
    if (v.destroyed || v.submerged) {
      inp.throttle = 0;
      inp.brake = 1;
      inp.steer = 0;
      return;
    }
    this.honkT -= dt;
    this.panicT -= dt;
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      inp.throttle = 0;
      inp.brake = 1;
      inp.steer = -Math.sign(inp.steer || 1);
      return;
    }
    let target: P2 | null = null;
    let desired = 0;
    switch (this.mode) {
      case 'traffic': {
        const r = this.traffic(dt, g);
        target = r.target;
        desired = r.speed;
        break;
      }
      case 'pursuit':
      case 'goto':
      case 'flee': {
        const r = this.chase(dt, g);
        target = r.target;
        desired = r.speed;
        break;
      }
      case 'race': {
        const r = this.race(dt, g);
        target = r.target;
        desired = r.speed;
        break;
      }
      case 'idle':
        inp.throttle = 0;
        inp.brake = 1;
        inp.steer = 0;
        return;
    }
    if (!target) {
      inp.throttle = 0;
      inp.brake = 1;
      return;
    }
    // steering toward target
    const dx = target.x - v.pos.x,
      dz = target.z - v.pos.z;
    const ty = Math.atan2(dx, dz);
    const diff = wrapAngle(ty - v.yaw);
    inp.steer = clamp(-diff * 2.2, -1, 1);
    // if target behind us at low speed, reverse-turn
    if (Math.abs(diff) > 2.2 && v.speed < 4 && this.mode !== 'traffic') {
      inp.throttle = 0;
      inp.brake = 1;
      inp.steer = clamp(diff * 2, -1, 1);
      this.stuckT += dt;
      if (this.stuckT > 0.8) {
        this.reverseT = 1.2;
        this.stuckT = 0;
      }
      return;
    }
    // whiskers for non-traffic modes
    if (this.mode !== 'traffic') {
      const look = 5 + v.speed * 0.45;
      const y = v.pos.y + 0.8;
      for (const side of [-1, 1]) {
        const a = v.yaw + side * 0.3;
        const hit = g.col.raycast(v.pos.x, y, v.pos.z, Math.sin(a), 0, Math.cos(a), look, false);
        if (hit) inp.steer = clamp(inp.steer + side * (1 - hit.t / look) * 1.6, -1, 1);
      }
      const hitF = g.col.raycast(v.pos.x, y, v.pos.z, Math.sin(v.yaw), 0, Math.cos(v.yaw), look * 0.6, false);
      if (hitF && v.speed > 8) desired = Math.min(desired, 6);
      // avoid other vehicles (overtake or brake)
      const fx = Math.sin(v.yaw),
        fz = Math.cos(v.yaw),
        rx = -Math.cos(v.yaw),
        rz = Math.sin(v.yaw);
      const scan = 8 + v.speed * 1.1;
      for (const o of g.vehicles.list) {
        if (o === v || (this.mode === 'pursuit' && o === g.player.vehicle)) continue;
        const ox = o.pos.x - v.pos.x,
          oz = o.pos.z - v.pos.z;
        if (Math.abs(ox) > scan || Math.abs(oz) > scan) continue;
        const ahead = ox * fx + oz * fz;
        if (ahead <= 0 || ahead > scan) continue;
        const lat = ox * rx + oz * rz;
        const clear = (o.spec.wid + v.spec.wid) / 2 + 0.9;
        if (Math.abs(lat) > clear) continue;
        // steer away from the obstacle side
        const side = lat >= 0 ? -1 : 1;
        inp.steer = clamp(inp.steer + side * (1 - ahead / scan) * 1.4, -1, 1);
        const ofs = o.vel.x * fx + o.vel.z * fz;
        const gap = ahead - (v.spec.len + o.spec.len) / 2;
        desired = Math.min(desired, Math.max(Math.max(0, ofs) + Math.max(0, gap - 3) * 0.9, gap > 1.5 ? 4 : 0));
      }
    }
    const sp = v.forwardSpeed;
    if (sp < desired) {
      inp.throttle = clamp((desired - sp) * 0.35 + 0.2, 0, 1);
      inp.brake = 0;
    } else {
      inp.throttle = 0;
      inp.brake = sp > desired + 1 ? clamp((sp - desired) * 0.25, 0.1, 1) : 0;
      if (desired < 0.3 && sp < 0.6) inp.brake = 1;
    }
    // stuck detection
    if (desired > 3 && Math.abs(sp) < 0.6) {
      this.stuckT += dt;
      if (this.stuckT > (this.mode === 'traffic' ? 4 : 1.6)) {
        this.reverseT = 1.3;
        this.stuckT = 0;
      }
    } else this.stuckT = Math.max(0, this.stuckT - dt);
  }

  // ---------------- traffic ----------------
  private pickNext(g: Game): GNode {
    const nodes = g.layout.nodes;
    const opts = this.to.links.filter((id) => id !== this.from.id).map((id) => nodes[id]);
    if (opts.length === 0) return this.from;
    // prefer going straight
    const dx = this.to.x - this.from.x,
      dz = this.to.z - this.from.z;
    const l = Math.hypot(dx, dz);
    const straight = opts.find((n) => {
      const ex = n.x - this.to.x,
        ez = n.z - this.to.z;
      return (ex * dx + ez * dz) / (Math.hypot(ex, ez) * l) > 0.9;
    });
    if (straight && Math.random() < 0.55) return straight;
    return opts[Math.floor(Math.random() * opts.length)];
  }

  private traffic(dt: number, g: Game): { target: P2; speed: number } {
    const v = this.v;
    const fx = this.from.x,
      fz = this.from.z;
    let dx = this.to.x - fx,
      dz = this.to.z - fz;
    const len = Math.hypot(dx, dz);
    dx /= len;
    dz /= len;
    const rx = -dz,
      rz = dx;
    // lane offset easing
    this.laneOff += clamp(this.laneTarget - this.laneOff, -1.5 * dt, 1.5 * dt);
    const s = (v.pos.x - fx) * dx + (v.pos.z - fz) * dz;
    let speed = this.panicT > 0 ? 22 : this.cruise;
    if (this.to.gj === 6 && this.from.gj === 6) speed += 4; // highway
    const endS = len - (this.to.links.length > 1 ? 11 : 4);
    let target: P2;
    if (!this.turnPts) {
      const look = 5 + Math.abs(v.forwardSpeed) * 0.5;
      const ts = Math.min(s + look, len - 6);
      target = { x: fx + dx * ts + rx * this.laneOff, z: fz + dz * ts + rz * this.laneOff };
      // signals
      if (this.to.light && this.panicT <= 0) {
        const axis = Math.abs(dz) > Math.abs(dx) ? 'ns' : 'ew';
        const st = g.lights.state(axis);
        const dStop = endS - 1.5 - s;
        if (st !== 'green' && dStop > -1.5) {
          if (!(st === 'yellow' && dStop < v.forwardSpeed * 0.9)) speed = Math.min(speed, Math.max(0, dStop - 0.5) * 0.7);
        }
      }
      if (s > endS - 1) {
        // build the turn
        this.next = this.pickNext(g);
        const nx = this.next.x - this.to.x,
          nz = this.next.z - this.to.z;
        const nl = Math.hypot(nx, nz) || 1;
        const d2x = nx / nl,
          d2z = nz / nl;
        const r2x = -d2z,
          r2z = d2x;
        const off = this.laneOff;
        const e0 = { x: this.to.x - dx * (ROAD_HALF + 3) + rx * off, z: this.to.z - dz * (ROAD_HALF + 3) + rz * off };
        const x1 = { x: this.to.x + d2x * (ROAD_HALF + 3) + r2x * off, z: this.to.z + d2z * (ROAD_HALF + 3) + r2z * off };
        const dot = dx * d2x + dz * d2z;
        let c: P2;
        if (dot > 0.9) c = { x: (e0.x + x1.x) / 2, z: (e0.z + x1.z) / 2 };
        else if (dot < -0.9) c = { x: this.to.x + dx * 6, z: this.to.z + dz * 6 };
        else c = { x: this.to.x + rx * off + r2x * off, z: this.to.z + rz * off + r2z * off };
        const pts: P2[] = [];
        for (let i = 1; i <= 6; i++) {
          const t = i / 6;
          const a = (1 - t) * (1 - t),
            b = 2 * (1 - t) * t,
            cc = t * t;
          pts.push({ x: a * e0.x + b * c.x + cc * x1.x, z: a * e0.z + b * c.z + cc * x1.z });
        }
        this.turnPts = pts;
      }
    } else {
      const pts = this.turnPts;
      while (pts.length > 1 && Math.hypot(pts[0].x - v.pos.x, pts[0].z - v.pos.z) < 4.5) pts.shift();
      target = pts.length > 1 ? pts[1] : pts[0];
      const turning = this.next && Math.abs(((this.next.x - this.to.x) * dx + (this.next.z - this.to.z) * dz) / (Math.hypot(this.next.x - this.to.x, this.next.z - this.to.z) || 1)) < 0.5;
      if (turning) speed = Math.min(speed, 7.5);
      if (pts.length <= 1 && Math.hypot(pts[0].x - v.pos.x, pts[0].z - v.pos.z) < 5) {
        this.from = this.to;
        this.to = this.next!;
        this.turnPts = null;
        this.next = null;
      }
    }
    // obstacles ahead
    const yf = Math.sin(v.yaw),
      zf = Math.cos(v.yaw);
    const yr = -Math.cos(v.yaw),
      zr = Math.sin(v.yaw);
    let gap = Infinity;
    let blockerStopped = false;
    for (const o of g.vehicles.list) {
      if (o === v || o.destroyed && o.speed < 0.1 && false) continue;
      const ox = o.pos.x - v.pos.x,
        oz = o.pos.z - v.pos.z;
      if (Math.abs(ox) > 35 || Math.abs(oz) > 35) continue;
      const ahead = ox * yf + oz * zf;
      if (ahead <= 0 || ahead > 30) continue;
      const lat = Math.abs(ox * yr + oz * zr);
      if (lat > (o.spec.wid + v.spec.wid) / 2 + 0.5) continue;
      const gp = ahead - (v.spec.len + o.spec.len) / 2;
      if (gp < gap) {
        gap = gp;
        blockerStopped = o.speed < 1;
      }
    }
    for (const a of g.walkers()) {
      const ox = a.pos.x - v.pos.x,
        oz = a.pos.z - v.pos.z;
      if (Math.abs(ox) > 25 || Math.abs(oz) > 25) continue;
      const ahead = ox * yf + oz * zf;
      if (ahead <= 0 || ahead > 18) continue;
      const lat = Math.abs(ox * yr + oz * zr);
      if (lat > v.spec.wid / 2 + 0.8) continue;
      const gp = ahead - v.spec.len / 2 - 0.5;
      if (gp < gap) {
        gap = gp;
        blockerStopped = false;
        if (gp < 10 && this.honkT <= 0 && a.isPlayer) {
          this.honkT = 4;
          if (g.time - this.lastHonk > 3) {
            this.lastHonk = g.time;
            g.audio.horn(v.pos);
          }
        }
      }
    }
    if (gap < Infinity) speed = Math.min(speed, Math.max(0, gap - 2.5) * 0.85);
    if (gap < 12 && blockerStopped && !this.turnPts && endS - s > 25) {
      this.blockedT += dt;
      if (this.blockedT > 2.5) {
        this.blockedT = 0;
        this.laneTarget = this.laneTarget > 4 ? 2 : 6;
        if (this.honkT <= 0) {
          this.honkT = 5;
          g.audio.horn(v.pos);
        }
      }
    } else this.blockedT = Math.max(0, this.blockedT - dt * 0.5);
    return { target, speed };
  }

  // ---------------- pursuit / goto / flee ----------------
  private chase(dt: number, g: Game): { target: P2 | null; speed: number } {
    const v = this.v;
    let goal: P2 | null = this.target;
    let speed = v.spec.maxSpeed * 0.92 * this.skill;
    let directOk = false;
    if (this.mode === 'pursuit') {
      const p = g.player;
      const tp = p.vehicle ? p.vehicle.pos : p.pos;
      const tv = p.vehicle ? p.vehicle.vel : p.vel;
      const d = Math.hypot(tp.x - v.pos.x, tp.z - v.pos.z);
      const lead = Math.min(1.5, d / 30);
      goal = { x: tp.x + tv.x * lead, z: tp.z + tv.z * lead };
      directOk = d < 70 && g.col.los(v.pos.x, v.pos.y + 1, v.pos.z, tp.x, tp.y + 1, tp.z);
      if (!p.vehicle && d < 60) speed = Math.min(speed, Math.sqrt(Math.max(0, 2 * 10 * (d - 11))));
      if (this.stopDist > 0 && d < this.stopDist) speed = 0;
      if (!this.aggressive && d < 20) speed = Math.min(speed, (p.vehicle ? p.vehicle.speed : 0) + 6);
    } else if (this.mode === 'flee') {
      speed = v.spec.maxSpeed * 0.85 * this.skill;
    }
    if (!goal) return { target: null, speed: 0 };
    if (v.spec.boat) return { target: goal, speed };
    const dGoal = Math.hypot(goal.x - v.pos.x, goal.z - v.pos.z);
    if (this.mode === 'goto' && dGoal < 8) return { target: goal, speed: 0 };
    if (directOk || dGoal < 40) return { target: goal, speed };
    this.routeT -= dt;
    if (this.routeT <= 0 || this.route.length === 0) {
      this.routeT = this.mode === 'pursuit' ? 1.2 : 4;
      this.route = g.nav.routeBetween(v.pos.x, v.pos.z, goal.x, goal.z).slice(1);
      this.routeIdx = 0;
    }
    while (this.routeIdx < this.route.length - 1) {
      const p = this.route[this.routeIdx];
      if (Math.hypot(p.x - v.pos.x, p.z - v.pos.z) < 12) this.routeIdx++;
      else break;
    }
    const tp = this.route[this.routeIdx] ?? goal;
    // slow for corners
    const nxt = this.route[this.routeIdx + 1];
    if (nxt) {
      const d = Math.hypot(tp.x - v.pos.x, tp.z - v.pos.z);
      const a1 = Math.atan2(tp.x - v.pos.x, tp.z - v.pos.z),
        a2 = Math.atan2(nxt.x - tp.x, nxt.z - tp.z);
      const turn = Math.abs(wrapAngle(a2 - a1));
      if (turn > 0.6 && d < 35) speed = Math.min(speed, 10 + d * 0.5);
    }
    return { target: tp, speed };
  }

  // ---------------- race ----------------
  raceStart: P2 | null = null;
  private race(dt: number, g: Game): { target: P2 | null; speed: number } {
    const v = this.v;
    const cps = this.checkpoints;
    if (this.finished || cps.length === 0) return { target: null, speed: 0 };
    const B = cps[this.cpIndex % cps.length];
    const A = this.cpIndex === 0 ? this.raceStart ?? { x: v.pos.x, z: v.pos.z } : cps[this.cpIndex - 1];
    const C = cps[this.cpIndex + 1];
    // pure pursuit along the road segment A->B (checkpoints sit on intersections)
    let dx = B.x - A.x,
      dz = B.z - A.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const t = (v.pos.x - A.x) * dx + (v.pos.z - A.z) * dz;
    const look = 7 + v.speed * 0.45;
    const remain = len - t;
    let target: P2;
    if (remain > look || !C) target = { x: A.x + dx * Math.min(len, t + look), z: A.z + dz * Math.min(len, t + look) };
    else {
      const cl = Math.hypot(C.x - B.x, C.z - B.z) || 1;
      const k = Math.min(cl, look - Math.max(0, remain));
      target = { x: B.x + ((C.x - B.x) / cl) * k, z: B.z + ((C.z - B.z) / cl) * k };
    }
    let speed = v.spec.maxSpeed * this.skill;
    if (C) {
      const turn = Math.abs(wrapAngle(Math.atan2(C.x - B.x, C.z - B.z) - Math.atan2(dx, dz)));
      const vc = turn > 2 ? 7 : turn > 1.2 ? 11 + (2 - turn) * 4 : turn > 0.4 ? 20 : 60;
      const dist = Math.max(0, Math.hypot(B.x - v.pos.x, B.z - v.pos.z) - 6);
      speed = Math.min(speed, Math.sqrt(vc * vc + 2 * 11 * dist));
    }
    // if we've drifted far off the line (crash/overshoot), slow down to recover
    const off = Math.abs((v.pos.x - A.x) * -dz + (v.pos.z - A.z) * dx);
    if (off > 9) speed = Math.min(speed, 9);
    return { target, speed };
  }
}
