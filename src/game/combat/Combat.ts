import * as THREE from 'three';
import type { Game } from '../Game';
import { Actor } from '../characters/Actor';
import type { Vehicle } from '../vehicles/Vehicle';
import { WeaponDef } from './Weapons';

interface Bullet {
  active: boolean;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  dist: number;
  max: number;
  dmg: number;
  shooter: Actor | null;
  fromPlayer: boolean;
}

const SPEED = 260;
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _t = new THREE.Vector3();

export class CombatSystem {
  bullets: Bullet[] = [];
  private aim = { o: new THREE.Vector3(), d: new THREE.Vector3() };
  lastShotT = -99;

  constructor(private g: Game) {
    for (let i = 0; i < 160; i++) this.bullets.push({ active: false, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, dist: 0, max: 0, dmg: 0, shooter: null, fromPlayer: false });
  }

  // ---------------- melee ----------------
  findMeleeTarget(a: Actor, range: number): Actor | null {
    let best: Actor | null = null,
      bd = range;
    const fx = Math.sin(a.yaw),
      fz = Math.cos(a.yaw);
    for (const t of this.g.actors()) {
      if (t === a || !t.alive || t.inVehicle) continue;
      const dx = t.pos.x - a.pos.x,
        dz = t.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > bd || Math.abs(t.pos.y - a.pos.y) > 1.5) continue;
      if ((dx * fx + dz * fz) / (d || 1) < 0.2) continue;
      bd = d;
      best = t;
    }
    return best;
  }

  meleeAttack(a: Actor, w: WeaponDef, mult = 1) {
    const g = this.g;
    const fx = Math.sin(a.yaw),
      fz = Math.cos(a.yaw);
    let hitAny = false;
    for (const t of g.actors()) {
      if (t === a || !t.alive || t.inVehicle) continue;
      const dx = t.pos.x - a.pos.x,
        dz = t.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > w.range + t.radius || Math.abs(t.pos.y - a.pos.y) > 1.4) continue;
      if ((dx * fx + dz * fz) / (d || 1) < 0.35) continue;
      const dmg = w.damage * mult * (0.85 + Math.random() * 0.3);
      const blocked = t.blocking;
      t.takeDamage(dmg, a.pos.x, a.pos.z, 'melee', a, g);
      hitAny = true;
      _t.set(t.pos.x, t.pos.y + 1.3, t.pos.z);
      g.fx.hitPuff(_t, true);
      g.audio.punch(t.pos, w.id === 'bat');
      if (!blocked && (w.id === 'bat' || Math.random() < 0.25 * mult || t.health < 25) && t.alive) t.knockdown(fx * 3, fz * 3, 1.5, 1.8);
      if (a.isPlayer) this.onPlayerAttacked(t, t.health <= 0);
    }
    // bats damage vehicles
    if (w.id === 'bat') {
      for (const v of g.vehicles.list) {
        const dx = v.pos.x - a.pos.x,
          dz = v.pos.z - a.pos.z;
        if (Math.hypot(dx, dz) < v.spec.len / 2 + 1.5) {
          v.damage(40, g, a.isPlayer);
          g.audio.crash(v.pos, 0.2);
          hitAny = true;
          break;
        }
      }
    }
    if (hitAny && a.isPlayer) g.cam.shake(0.15);
  }

  onPlayerAttacked(t: Actor, killed: boolean) {
    const g = this.g;
    if (t.team === 'police') {
      g.wanted.crime(killed ? 'killCop' : 'assaultCop', t.pos.x, t.pos.z);
      if (killed) g.progress.stat('copsDown', 1);
    } else if (t.team === 'civ' || t.team === 'gang') {
      g.wanted.crime(killed ? 'kill' : 'assault', t.pos.x, t.pos.z);
    }
    if (killed) g.progress.stat('knockouts', 1);
    g.peds.panic(t.pos.x, t.pos.z, 18, g.player);
  }

  // ---------------- guns ----------------
  playerFire(p: Actor, w: WeaponDef) {
    const g = this.g;
    g.cam.aimRay(this.aim);
    // resolve aim point from camera ray
    let aimDist = w.range;
    const hit = g.col.raycast(this.aim.o.x, this.aim.o.y, this.aim.o.z, this.aim.d.x, this.aim.d.y, this.aim.d.z, w.range + 10, true);
    if (hit) aimDist = hit.t;
    // aim assist: actor nearest to the crosshair ray
    let assist: Actor | null = null,
      bestAng = g.player.aiming ? 0.05 : 0.09;
    for (const t of g.actors()) {
      if (t === p || !t.alive) continue;
      _t.set(t.pos.x - this.aim.o.x, t.pos.y + 1.2 - this.aim.o.y, t.pos.z - this.aim.o.z);
      const d = _t.length();
      if (d > w.range || d < 1) continue;
      const ang = Math.acos(Math.min(1, _t.dot(this.aim.d) / d));
      if (ang < bestAng) {
        bestAng = ang;
        assist = t;
      }
    }
    const target = assist ? _t.set(assist.pos.x, assist.pos.y + 1.15, assist.pos.z) : _t.copy(this.aim.o).addScaledVector(this.aim.d, aimDist);
    const fx = Math.sin(p.yaw),
      fz = Math.cos(p.yaw);
    _o.set(p.pos.x + fx * 0.5 - fz * 0.25, p.pos.y + 1.4, p.pos.z + fz * 0.5 + fx * 0.25);
    const spread = w.spread * (g.player.aiming ? 0.5 : 1.3);
    for (let i = 0; i < w.pellets; i++) {
      _d.copy(target).sub(_o).normalize();
      _d.x += (Math.random() - 0.5) * spread * 2;
      _d.y += (Math.random() - 0.5) * spread * 2;
      _d.z += (Math.random() - 0.5) * spread * 2;
      _d.normalize();
      this.spawnBullet(_o, _d, w.range, w.damage, p, true);
    }
    g.fx.muzzle(_o);
    g.audio.gunshot(_o, w.id);
    g.cam.shake(w.id === 'shotgun' ? 0.25 : 0.06);
    g.progress.stat('shotsFired', 1);
    this.lastShotT = g.time;
    g.wanted.crime('shooting', p.pos.x, p.pos.z);
    g.peds.panic(p.pos.x, p.pos.z, 45, p);
  }

  npcFire(shooter: Actor, tx: number, ty: number, tz: number, accuracy: number, dmg: number) {
    const g = this.g;
    const fx = Math.sin(shooter.yaw),
      fz = Math.cos(shooter.yaw);
    _o.set(shooter.pos.x + fx * 0.5, shooter.pos.y + 1.4, shooter.pos.z + fz * 0.5);
    _d.set(tx - _o.x, ty - _o.y, tz - _o.z).normalize();
    const sp = (1 - accuracy) * 0.22 + 0.015;
    _d.x += (Math.random() - 0.5) * sp * 2;
    _d.y += (Math.random() - 0.5) * sp * 2;
    _d.z += (Math.random() - 0.5) * sp * 2;
    _d.normalize();
    this.spawnBullet(_o, _d, 80, dmg, shooter, false);
    g.fx.muzzle(_o);
    g.audio.gunshot(_o, 'pistol');
  }

  private spawnBullet(o: THREE.Vector3, d: THREE.Vector3, max: number, dmg: number, shooter: Actor | null, fromPlayer: boolean) {
    const b = this.bullets.find((x) => !x.active);
    if (!b) return;
    b.active = true;
    b.x = o.x;
    b.y = o.y;
    b.z = o.z;
    b.dx = d.x;
    b.dy = d.y;
    b.dz = d.z;
    b.dist = 0;
    b.max = max;
    b.dmg = dmg;
    b.shooter = shooter;
    b.fromPlayer = fromPlayer;
  }

  update(dt: number) {
    const g = this.g;
    for (const b of this.bullets) {
      if (!b.active) continue;
      const step = Math.min(SPEED * dt, b.max - b.dist);
      // static world
      const hit = g.col.raycast(b.x, b.y, b.z, b.dx, b.dy, b.dz, step, true);
      let len = hit ? hit.t : step;
      // actors
      let hitActor: Actor | null = null;
      for (const a of g.actors()) {
        if (a === b.shooter || !a.alive) continue;
        if (a.inVehicle) continue;
        const t = this.rayCapsule(b, a, len);
        if (t >= 0 && t < len) {
          len = t;
          hitActor = a;
        }
      }
      // vehicles
      let hitVeh: Vehicle | null = null;
      for (const v of g.vehicles.list) {
        if (b.shooter && b.shooter.isPlayer && v.driver === 'player') continue;
        const t = this.rayVehicle(b, v, len);
        if (t >= 0 && t < len) {
          len = t;
          hitVeh = v;
          hitActor = null;
        }
      }
      const ex = b.x + b.dx * len,
        ey = b.y + b.dy * len,
        ez = b.z + b.dz * len;
      g.fx.tracer(b.x, b.y, b.z, ex, ey, ez);
      if (hitActor) {
        _t.set(ex, ey, ez);
        g.fx.hitPuff(_t, true);
        const head = ey - hitActor.pos.y > 1.5;
        hitActor.takeDamage(b.dmg * (head ? 2 : 1), b.x, b.z, 'bullet', b.shooter, g);
        if (b.fromPlayer) {
          g.ui.hitMarker();
          this.onPlayerAttacked(hitActor, hitActor.health <= 0);
          g.progress.stat('shotsHit', 1);
        }
        b.active = false;
      } else if (hitVeh) {
        _t.set(ex, ey, ez);
        g.fx.sparks(_t, 4);
        g.audio.impact(_t);
        hitVeh.damage(b.dmg * 0.9, g, b.fromPlayer);
        if (hitVeh.driver === 'player' && !b.fromPlayer && Math.random() < 0.3) g.player.takeDamage(b.dmg * 0.5, b.x, b.z, 'bullet', b.shooter, g);
        if (b.fromPlayer && hitVeh.spec.police) g.wanted.crime('assaultCop', hitVeh.pos.x, hitVeh.pos.z);
        if (b.fromPlayer && hitVeh.ai && hitVeh.npcDriver && hitVeh.ai.mode === 'traffic') hitVeh.ai.panicT = 15;
        b.active = false;
      } else if (hit) {
        _t.set(ex, ey, ez);
        g.fx.hitPuff(_t, false);
        if (Math.random() < 0.3) g.audio.impact(_t);
        b.active = false;
      } else {
        b.x = ex;
        b.y = ey;
        b.z = ez;
        b.dist += step;
        if (b.dist >= b.max - 0.01) b.active = false;
      }
    }
  }

  private rayCapsule(b: Bullet, a: Actor, maxT: number) {
    // approximate the body as a vertical capsule (two spheres + middle)
    const r = a.knockT > 0 ? 0.5 : 0.32;
    const ys = a.knockT > 0 ? [0.2] : [0.5, 1.0, 1.45, 1.68];
    let best = -1;
    for (const yo of ys) {
      const cx = a.pos.x,
        cy = a.pos.y + yo,
        cz = a.pos.z;
      const ox = b.x - cx,
        oy = b.y - cy,
        oz = b.z - cz;
      const bb = ox * b.dx + oy * b.dy + oz * b.dz;
      const c = ox * ox + oy * oy + oz * oz - (yo > 1.6 ? 0.14 : r) ** 2;
      const disc = bb * bb - c;
      if (disc < 0) continue;
      const t = -bb - Math.sqrt(disc);
      if (t >= 0 && t <= maxT && (best < 0 || t < best)) best = t;
    }
    return best;
  }

  private rayVehicle(b: Bullet, v: Vehicle, maxT: number) {
    const dx = b.x - v.pos.x,
      dz = b.z - v.pos.z;
    if (dx * dx + dz * dz > (maxT + 6) ** 2) return -1;
    const c = Math.cos(v.yaw),
      s = Math.sin(v.yaw);
    // into vehicle local space (x right-ish, z forward)
    const lx = dx * c - dz * s,
      lz = dx * s + dz * c,
      ly = b.y - v.pos.y;
    const ldx = b.dx * c - b.dz * s,
      ldz = b.dx * s + b.dz * c,
      ldy = b.dy;
    const hx = v.spec.wid / 2,
      hz = v.spec.len / 2;
    const y0 = 0.2,
      y1 = v.spec.height;
    let tmin = 0,
      tmax = maxT;
    for (const [o, d, lo, hi] of [
      [lx, ldx, -hx, hx],
      [ly, ldy, y0, y1],
      [lz, ldz, -hz, hz],
    ]) {
      if (Math.abs(d) < 1e-8) {
        if (o < lo || o > hi) return -1;
      } else {
        let t1 = (lo - o) / d,
          t2 = (hi - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return -1;
      }
    }
    return tmin;
  }

  // ---------------- explosions ----------------
  explosion(p: THREE.Vector3, radius: number, dmg: number, source: 'player' | null) {
    const g = this.g;
    g.fx.explosion(p, radius / 8);
    g.audio.explosion(p);
    const dc = p.distanceTo(g.camera.position);
    g.cam.shake(Math.max(0, 1 - dc / 80));
    for (const a of g.actors()) {
      if (!a.alive) continue;
      const d = a.pos.distanceTo(p);
      if (d > radius) continue;
      const k = 1 - d / radius;
      const dx = a.pos.x - p.x,
        dz = a.pos.z - p.z;
      const l = Math.hypot(dx, dz) || 1;
      if (a.isPlayer && g.player.vehicle) {
        a.takeDamage(dmg * k * 0.6, p.x, p.z, 'explosion', null, g);
        continue;
      }
      a.takeDamage(dmg * k, p.x, p.z, 'explosion', null, g);
      a.knockdown((dx / l) * 10 * k, (dz / l) * 10 * k, 5 * k, 2.5);
      if (source === 'player' && !a.isPlayer) this.onPlayerAttacked(a, a.health <= 0);
    }
    for (const v of g.vehicles.list) {
      const d = v.pos.distanceTo(p);
      if (d > radius * 1.4 || d < 0.5) continue;
      const k = 1 - d / (radius * 1.4);
      v.damage(dmg * 2.5 * k, g, source === 'player');
      const dx = v.pos.x - p.x,
        dz = v.pos.z - p.z;
      const l = Math.hypot(dx, dz) || 1;
      v.vel.x += (dx / l) * 9 * k;
      v.vel.z += (dz / l) * 9 * k;
      v.vel.y += 5 * k;
      v.grounded = false;
    }
    for (const pr of g.props.nearby(p.x, p.z, radius, [])) {
      if (pr.broken) continue;
      if (Math.hypot(pr.x - p.x, pr.z - p.z) < radius) g.props.breakProp(pr, (pr.x - p.x) * 2, (pr.z - p.z) * 2, 10);
    }
    g.peds.panic(p.x, p.z, 70, null);
    if (source === 'player') g.wanted.crime('explosion', p.x, p.z);
  }

  /** vehicle vs walking actors */
  vehicleVsActors(v: Vehicle) {
    const g = this.g;
    const sp = v.speed;
    if (sp < 2.5) return;
    const fx = Math.sin(v.yaw),
      fz = Math.cos(v.yaw);
    const rx = -Math.cos(v.yaw),
      rz = Math.sin(v.yaw);
    for (const a of g.actors()) {
      if (!a.alive && a.knockT <= 0) continue;
      if (a.inVehicle) continue;
      const dx = a.pos.x - v.pos.x,
        dz = a.pos.z - v.pos.z;
      if (Math.abs(dx) > 6 || Math.abs(dz) > 6) continue;
      if (a.pos.y > v.pos.y + v.spec.height || a.pos.y + 1.6 < v.pos.y) continue;
      const lf = dx * fx + dz * fz,
        lr = dx * rx + dz * rz;
      if (Math.abs(lf) > v.spec.len / 2 + a.radius || Math.abs(lr) > v.spec.wid / 2 + a.radius) continue;
      // relative speed toward the actor
      const rel = Math.hypot(v.vel.x - a.vel.x, v.vel.z - a.vel.z);
      if (rel < 2.5 || a.knockT > 0.8) continue;
      let dmg = rel < 6 ? rel * 3 : rel * 6;
      if (a.isPlayer) dmg = Math.min(dmg * (v.driver === 'ai' ? 0.4 : 1), a.maxHealth * 0.55);
      a.takeDamage(dmg, v.pos.x, v.pos.z, 'vehicle', null, g);
      a.knockdown(v.vel.x * 0.8 + (Math.random() - 0.5) * 2, v.vel.z * 0.8 + (Math.random() - 0.5) * 2, 2 + rel * 0.25, 2.2);
      g.audio.thud(a.pos, Math.min(1, rel / 15));
      v.vel.multiplyScalar(0.92);
      v.damage(rel * 0.8, g);
      if (v.driver === 'player') {
        if (a.team === 'police') g.wanted.crime(a.health <= 0 ? 'killCop' : 'assaultCop', a.pos.x, a.pos.z);
        else g.wanted.crime(a.health <= 0 ? 'kill' : 'hitPed', a.pos.x, a.pos.z);
        g.peds.panic(a.pos.x, a.pos.z, 25, g.player);
        if (a.health <= 0) g.progress.stat('knockouts', 1);
      }
    }
  }
}
