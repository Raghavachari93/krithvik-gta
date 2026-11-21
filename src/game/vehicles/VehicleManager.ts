import * as THREE from 'three';
import { WATER_Y, terrainY } from '../constants';
import type { Game } from '../Game';
import { ParkingSpot } from '../world/CityLayout';
import { Vehicle } from './Vehicle';
import { TRAFFIC_POOL, VEHICLES } from './VehicleSpecs';

const _a = new THREE.Vector3();

interface SpotState {
  spot: ParkingSpot;
  vehicle: Vehicle | null;
  cooldown: number;
  specId: string;
  filled: boolean;
}

export class VehicleManager {
  list: Vehicle[] = [];
  private spots: SpotState[] = [];
  private streamT = 0;
  private skidAcc = new Map<number, number>();

  constructor(private g: Game) {
    for (const s of g.layout.parking) {
      let specId: string;
      if (s.kind === 'marina') specId = Math.random() < 0.5 ? 'marlin' : 'wave';
      else if (s.kind === 'police') specId = 'interceptor';
      else if (s.kind === 'dealer') specId = s.district === 'luxury' ? ['zenith', 'vortex', 'stallion', 'viper'][Math.floor(Math.random() * 4)] : ['comet', 'ranger', 'mule', 'viper'][Math.floor(Math.random() * 4)];
      else {
        const pool = TRAFFIC_POOL[s.district] ?? TRAFFIC_POOL.residential;
        specId = pool[Math.floor(Math.random() * pool.length)];
        if (specId === 'hauler' && s.kind === 'drive') specId = 'comet';
      }
      this.spots.push({ spot: s, vehicle: null, cooldown: 0, specId, filled: s.kind === 'dealer' || s.kind === 'marina' || Math.random() < 0.7 });
    }
  }

  spawn(specId: string, x: number, z: number, yaw: number, color?: number): Vehicle {
    const spec = VEHICLES[specId] ?? VEHICLES.comet;
    const v = new Vehicle(spec, color);
    v.place(x, z, yaw, this.g.col);
    v.bornAt = this.g.time;
    this.g.scene.add(v.group);
    this.list.push(v);
    v.setHeadlights(this.g.env.night);
    return v;
  }

  remove(v: Vehicle) {
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
    v.dispose();
    for (const s of this.spots) if (s.vehicle === v) s.vehicle = null;
    if (this.g.player.lastVehicle === v) this.g.player.lastVehicle = null;
  }

  nearestEnterable(pos: THREE.Vector3, r: number): Vehicle | null {
    let best: Vehicle | null = null,
      bd = r;
    for (const v of this.list) {
      if (v.destroyed || v.locked || v.burnTimer >= 0) continue;
      const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z) - v.spec.len * 0.25;
      if (d < bd && Math.abs(v.pos.y - pos.y) < 3) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  /** keep walkers out of vehicle bodies */
  pushCharacter(pos: { x: number; z: number }, r: number, feetY: number) {
    for (const v of this.list) {
      const dx = pos.x - v.pos.x,
        dz = pos.z - v.pos.z;
      if (Math.abs(dx) > 7 || Math.abs(dz) > 7) continue;
      if (feetY > v.pos.y + v.spec.height - 0.2 || feetY + 1.7 < v.pos.y) continue;
      const c = Math.cos(v.yaw),
        s = Math.sin(v.yaw);
      const lx = dx * c - dz * s,
        lz = dx * s + dz * c;
      const hx = v.spec.wid / 2 + r,
        hz = v.spec.len / 2 + r;
      if (Math.abs(lx) >= hx || Math.abs(lz) >= hz) continue;
      const px = hx - Math.abs(lx),
        pz = hz - Math.abs(lz);
      let nlx = lx,
        nlz = lz;
      if (px < pz) nlx = Math.sign(lx || 1) * hx;
      else nlz = Math.sign(lz || 1) * hz;
      // back to world
      pos.x = v.pos.x + nlx * c + nlz * s;
      pos.z = v.pos.z - nlx * s + nlz * c;
    }
  }

  private collidePairs() {
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        const dx = b.pos.x - a.pos.x,
          dz = b.pos.z - a.pos.z;
        const reach = (a.spec.len + b.spec.len) / 2 + 0.5;
        if (dx * dx + dz * dz > reach * reach) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 2.2) continue;
        if (a.spec.boat !== b.spec.boat) continue;
        this.collide(a, b);
      }
    }
  }

  private circles(v: Vehicle) {
    const r = v.spec.bike ? 0.42 : v.spec.wid / 2;
    const h = v.spec.len / 2;
    const fx = Math.sin(v.yaw),
      fz = Math.cos(v.yaw);
    const offs = v.spec.bike ? [0.55, -0.55] : v.spec.len > 6 ? [h - r, h * 0.3, -h * 0.3, -(h - r)] : [h - r, 0, -(h - r)];
    return { r, pts: offs.map((o) => ({ x: v.pos.x + fx * o, z: v.pos.z + fz * o, o })) };
  }

  private collide(a: Vehicle, b: Vehicle) {
    const ca = this.circles(a),
      cb = this.circles(b);
    let best = 0,
      nx = 0,
      nz = 0,
      px = 0,
      pz = 0;
    for (const p of ca.pts)
      for (const q of cb.pts) {
        const dx = q.x - p.x,
          dz = q.z - p.z;
        const rr = ca.r + cb.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.01;
        const pen = rr - d;
        if (pen > best) {
          best = pen;
          nx = dx / d;
          nz = dz / d;
          px = (p.x + q.x) / 2;
          pz = (p.z + q.z) / 2;
        }
      }
    if (best <= 0) return;
    const ma = a.spec.mass,
      mb = b.spec.mass;
    const ta = mb / (ma + mb),
      tb = ma / (ma + mb);
    a.pos.x -= nx * best * ta;
    a.pos.z -= nz * best * ta;
    b.pos.x += nx * best * tb;
    b.pos.z += nz * best * tb;
    const rvx = b.vel.x - a.vel.x,
      rvz = b.vel.z - a.vel.z;
    const vn = rvx * nx + rvz * nz;
    if (vn >= 0) return;
    const e = 0.3;
    const jImp = (-(1 + e) * vn) / (1 / ma + 1 / mb);
    a.vel.x -= (jImp / ma) * nx;
    a.vel.z -= (jImp / ma) * nz;
    b.vel.x += (jImp / mb) * nx;
    b.vel.z += (jImp / mb) * nz;
    // spin from off-centre hits
    const la = (px - a.pos.x) * Math.cos(a.yaw) - (pz - a.pos.z) * Math.sin(a.yaw);
    const lb = (px - b.pos.x) * Math.cos(b.yaw) - (pz - b.pos.z) * Math.sin(b.yaw);
    a.angVel += la * (jImp / ma) * 0.08;
    b.angVel -= lb * (jImp / mb) * 0.08;
    const impact = -vn;
    if (impact > 2.5) {
      const g = this.g;
      const dmg = Math.pow(impact - 2.5, 1.3) * 7;
      a.damage(dmg * (mb / ma) ** 0.5, g, b.driver === 'player');
      b.damage(dmg * (ma / mb) ** 0.5, g, a.driver === 'player');
      g.onVehicleImpact(a, impact, px, pz, b);
    }
  }

  private streamParked(dt: number) {
    const g = this.g;
    this.streamT -= dt;
    if (this.streamT > 0) return;
    this.streamT = 0.5;
    const f = g.focus;
    for (const s of this.spots) {
      const d = Math.hypot(s.spot.x - f.x, s.spot.z - f.z);
      s.cooldown -= 0.5;
      if (!s.vehicle && s.filled && d < 150 && d > 30 && s.cooldown <= 0) {
        if (s.spot.kind === 'marina' && terrainY(s.spot.x, s.spot.z) > WATER_Y - 0.5) continue;
        const v = this.spawn(s.specId, s.spot.x, s.spot.z, s.spot.yaw);
        v.driver = null;
        s.vehicle = v;
      } else if (s.vehicle && d > 210) {
        const v = s.vehicle;
        const moved = Math.hypot(v.pos.x - s.spot.x, v.pos.z - s.spot.z) > 3;
        if (!v.persistent && v.driver !== 'player') {
          this.remove(v);
          s.cooldown = moved ? 60 : 0;
          if (moved) s.filled = Math.random() < 0.7;
        }
        s.vehicle = null;
      } else if (s.vehicle && !this.list.includes(s.vehicle)) s.vehicle = null;
    }
  }

  update(dt: number) {
    const g = this.g;
    for (const v of this.list) v.update(dt, g);
    this.collidePairs();
    const night = g.env.night;
    const camPos = g.camera.position;
    for (const v of this.list) {
      if (v.driver !== null || v.speed > 2.5) g.combat.vehicleVsActors(v);
      v.setHeadlights(night);
      // skid marks + tyre smoke
      if (v.grounded && !v.spec.boat && v.slip > 4.5 && v.speed > 2 && v.pos.distanceToSquared(camPos) < 120 * 120) {
        const acc = (this.skidAcc.get(v.id) ?? 0) + v.speed * dt;
        if (acc > 0.5) {
          const fx = Math.sin(v.yaw),
            fz = Math.cos(v.yaw);
          const rx = -Math.cos(v.yaw),
            rz = Math.sin(v.yaw);
          const back = -v.spec.shape.wheelX;
          for (const side of v.spec.bike ? [0] : [-1, 1]) {
            const x = v.pos.x + fx * back + rx * side * v.spec.shape.track,
              z = v.pos.z + fz * back + rz * side * v.spec.shape.track;
            g.fx.skid(x, v.pos.y, z, Math.atan2(v.vel.x, v.vel.z));
            if (v.slip > 6.5 && Math.random() < 0.6) g.fx.tireSmoke(x, v.pos.y, z, Math.min(0.55, v.slip / 20));
          }
          this.skidAcc.set(v.id, 0);
        } else this.skidAcc.set(v.id, acc);
      }
    }
    // clean up wrecks
    for (const v of [...this.list]) {
      if (v.destroyed && g.time - v.deadTime > 45 && v.driver !== 'player') {
        _a.copy(v.pos).project(g.camera);
        if (Math.abs(_a.x) > 1.2 || _a.z > 1 || v.pos.distanceTo(camPos) > 120) this.remove(v);
      }
    }
    this.streamParked(dt);
  }

  clearNonPersistent() {
    for (const v of [...this.list]) if (!v.persistent && v.driver !== 'player') this.remove(v);
  }
}
