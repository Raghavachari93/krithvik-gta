import * as THREE from 'three';
import { GRAVITY, WATER_Y, WORLD, terrainY } from '../constants';
import { clamp, damp } from '../core/math';
import type { Game } from '../Game';
import type { AIDriver } from './AIDriver';
import { VehicleRig, buildVehicleRig, burntMaterial, paintMaterial } from './VehicleModel';
import { VehicleSpec } from './VehicleSpecs';

export interface VehicleInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  boost?: boolean;
}

let NEXT_ID = 1;

export class Vehicle {
  id = NEXT_ID++;
  rig: VehicleRig;
  pos = new THREE.Vector3();
  yaw = 0;
  vel = new THREE.Vector3();
  angVel = 0;
  steer = 0;
  input: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  health: number;
  fuel: number;
  destroyed = false;
  burnTimer = -1;
  submerged = false;
  submergedT = 0;
  grounded = true;
  airTime = 0;
  slip = 0;
  rpm = 0.2;
  gear = 1;
  pitch = 0;
  roll = 0;
  driver: 'player' | 'ai' | null = null;
  ai: AIDriver | null = null;
  npcDriver = false;
  persistent = false;
  missionTag: string | null = null;
  locked = false;
  sirenOn = false;
  private sirenT = 0;
  lastImpact = 0;
  lastHitByPlayer = 0;
  deadTime = 0;
  forwardSpeed = 0;
  smokeT = 0;
  maxAir = 0;
  takeoffRamp: number | null = null;
  airDist = 0;
  takeoffPos = new THREE.Vector3();
  wasStolen = false;
  ownedByPlayer = false;
  color: number;
  bornAt = 0;
  private ahead = new THREE.Vector3();
  /** nitro tank 0..1 (crazy cars) */
  nitro = 1;
  boosting = false;
  private fxT = Math.random() * 10;
  /** flight state (planes) */
  flyPitch = 0;
  bank = 0;
  airspeed = 0;
  altitude = 0;

  constructor(public spec: VehicleSpec, color?: number) {
    this.color = color ?? spec.colors[Math.floor(Math.random() * spec.colors.length)];
    this.rig = buildVehicleRig(spec, this.color);
    this.health = spec.health;
    this.fuel = spec.fuelCap * (0.55 + Math.random() * 0.45);
    this.rig.group.userData.vehicle = this;
  }

  get group() {
    return this.rig.group;
  }
  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }
  get healthPct() {
    return clamp(this.health / this.spec.health, 0, 1);
  }
  get alive() {
    return !this.destroyed;
  }

  place(x: number, z: number, yaw: number, col: Game['col']) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    const y = this.spec.boat ? WATER_Y - 0.2 : col.surfaceY(x, z, 50, 0);
    this.pos.y = this.spec.boat ? WATER_Y - 0.2 : y;
    this.vel.set(0, 0, 0);
    this.angVel = 0;
    this.syncVisual(0);
  }

  damage(amount: number, g: Game, byPlayer = false) {
    if (this.destroyed) return;
    this.health -= amount;
    if (byPlayer) this.lastHitByPlayer = g.time;
    if (this.health <= 0 && this.burnTimer < 0) {
      this.health = 0;
      this.burnTimer = 4.5;
    }
  }

  explode(g: Game) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.burnTimer = -1;
    this.deadTime = g.time;
    this.rig.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material && (m.material as THREE.MeshPhysicalMaterial).vertexColors && m.material !== burntMaterial) {
        if ((m.material as THREE.Material).name !== 'wheel') m.material = burntMaterial;
      }
    });
    this.rig.headMat.color.setRGB(0.05, 0.05, 0.05);
    this.rig.tailMat.color.setRGB(0.05, 0, 0);
    if (this.rig.extras) this.rig.extras.visible = false;
    for (const f of this.rig.flames) f.visible = false;
    this.vel.y = 6;
    this.grounded = false;
    this.angVel += (Math.random() - 0.5) * 3;
    g.combat.explosion(this.pos.clone().setY(this.pos.y + 0.8), 8, 220, this.lastHitByPlayer > 0 && g.time - this.lastHitByPlayer < 15 ? 'player' : null);
    g.onVehicleDestroyed(this);
  }

  update(dt: number, g: Game) {
    if (this.ai && this.driver === 'ai') this.ai.update(dt, g);
    if (this.driver === null) {
      this.input.throttle = 0;
      this.input.brake = this.destroyed ? 1 : 0.4;
      this.input.steer = 0;
      this.input.handbrake = true;
    }
    const steps = dt > 1 / 50 ? 2 : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.physics(h, g);
    if (this.burnTimer >= 0) {
      this.burnTimer -= dt;
      if (this.burnTimer <= 0) this.explode(g);
    }
    // damage FX
    this.smokeT -= dt;
    if (this.smokeT <= 0 && !this.spec.boat) {
      const hp = this.healthPct;
      const front = this.ahead.set(this.pos.x + Math.sin(this.yaw) * this.spec.len * 0.38, this.pos.y + this.spec.shape.belt + 0.2, this.pos.z + Math.cos(this.yaw) * this.spec.len * 0.38);
      if (this.destroyed) {
        if (g.time - this.deadTime < 25) {
          g.fx.smoke(front, 0.25, 2.2);
          this.smokeT = 0.18;
        }
      } else if (this.burnTimer >= 0) {
        g.fx.fire(front, 1.2);
        g.fx.smoke(front, 0.2, 1.8);
        this.smokeT = 0.05;
      } else if (hp < 0.35) {
        g.fx.smoke(front, hp < 0.18 ? 0.25 : 0.55, hp < 0.18 ? 1.4 : 0.9);
        this.smokeT = hp < 0.18 ? 0.08 : 0.2;
      } else this.smokeT = 0.5;
    }
    this.syncVisual(dt);
  }

  private physics(h: number, g: Game) {
    const sp = this.spec;
    const inp = this.input;
    const fx = Math.sin(this.yaw),
      fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw),
      rz = Math.sin(this.yaw);
    let vF = this.vel.x * fx + this.vel.z * fz;
    let vL = this.vel.x * rx + this.vel.z * rz;
    const engine = !this.destroyed && !this.submerged && this.burnTimer < 0 && (this.fuel > 0 || this.driver !== 'player');
    const absF = Math.abs(vF);
    const steerLimit = sp.steerMax / (1 + absF / sp.steerFalloff);
    const tgtSteer = inp.steer * steerLimit;
    const sd = 3.2 * h;
    this.steer += clamp(tgtSteer - this.steer, -sd, sd);

    if (sp.boat) {
      this.boatPhysics(h, g, vF, vL, fx, fz, rx, rz, engine);
      return;
    }
    if (sp.plane) {
      this.planePhysics(h, g, engine);
      return;
    }

    if (this.grounded) {
      let a = 0;
      const thr = engine ? inp.throttle : 0;
      if (thr > 0) {
        if (vF < -0.5) a += sp.brake * thr;
        else a += sp.accel * thr * Math.max(0, 1 - (vF / sp.maxSpeed) ** 2) * (this.healthPct < 0.15 ? 0.5 : 1);
      }
      this.boosting = !!(sp.crazy && inp.boost && thr > 0 && this.nitro > 0.02 && vF > -1);
      if (this.boosting) {
        a += sp.accel * 1.1 * Math.max(0, 1 - (vF / (sp.maxSpeed * 1.35)) ** 2);
        this.nitro = Math.max(0, this.nitro - h * 0.2);
      } else if (sp.crazy) this.nitro = Math.min(1, this.nitro + h * 0.07);
      if (inp.brake > 0) {
        if (vF > 0.5) a -= sp.brake * inp.brake;
        else if (engine && vF > -sp.reverse) a -= sp.accel * 0.7 * inp.brake;
        else if (!engine) a -= Math.sign(vF) * Math.min(Math.abs(vF) / h, sp.brake);
      }
      a -= vF * 0.035 + (thr === 0 ? Math.sign(vF) * 0.4 : 0);
      if (inp.handbrake) a -= Math.sign(vF) * Math.min(Math.abs(vF) / h, 6.5);
      vF += a * h;
      if (thr === 0 && Math.abs(vF) < 0.2 && (inp.brake > 0 || inp.handbrake)) vF = 0;
      // lateral grip
      let grip = sp.grip * (1 - g.env.wet * 0.18);
      if (inp.handbrake) grip *= sp.driftGrip;
      const slipRatio = Math.abs(vL) / (Math.abs(vF) + 2);
      if (slipRatio > 0.18 && !sp.bike) grip *= 0.72;
      const dv = Math.min(Math.abs(vL), grip * h);
      vL -= Math.sign(vL) * dv;
      // yaw (bicycle model)
      const wb = sp.shape.wheelX * 2;
      let targetYaw = -(vF * Math.tan(this.steer)) / wb;
      if (inp.handbrake) targetYaw *= 1.4;
      const resp = inp.handbrake || slipRatio > 0.3 ? 3.5 : 11;
      this.angVel = damp(this.angVel, targetYaw, resp, h);
      this.slip = Math.abs(vL) + (inp.handbrake && absF > 5 ? 4 : 0) + (inp.brake > 0 && vF > 10 ? 3 : 0) + (thr > 0.9 && vF < 7 && sp.accel > 9 ? 4 : 0);
    } else {
      this.angVel *= 1 - 0.4 * h;
      this.slip = 0;
    }
    this.yaw += this.angVel * h;
    this.vel.x = fx * vF + rx * vL;
    this.vel.z = fz * vF + rz * vL;
    this.forwardSpeed = vF;

    const ox = this.pos.x,
      oz = this.pos.z;
    this.pos.x += this.vel.x * h;
    this.pos.z += this.vel.z * h;
    this.collideStatic(h, g, ox, oz);

    // vertical
    const col = g.col;
    const gY = col.surfaceY(this.pos.x, this.pos.z, this.pos.y, 0.75);
    if (this.grounded) {
      if (gY < this.pos.y - 0.35) {
        this.grounded = false;
        this.airTime = 0;
        this.maxAir = 0;
        this.airDist = 0;
        this.takeoffPos.copy(this.pos);
      } else {
        // backward difference: slope of the surface we just drove over (keeps launch speed at ramp lips)
        const back = 1.0 * Math.sign(vF || 1);
        const gB = col.surfaceY(this.pos.x - fx * back, this.pos.z - fz * back, this.pos.y + 0.3, 0.6);
        let rise = gY - gB;
        if (rise < -0.3) rise = 0;
        const slope = clamp(rise / Math.abs(back), -0.8, 0.8);
        this.vel.y = slope * Math.abs(vF);
        this.pos.y = gY;
        const rr = col.rampY(this.pos.x, this.pos.z);
        this.takeoffRamp = col.lastRamp && col.lastRamp.stunt && rr > -Infinity ? col.lastRamp.id : this.takeoffRamp && gY > terrainY(this.pos.x, this.pos.z) + 0.3 ? this.takeoffRamp : null;
      }
    } else {
      this.vel.y -= GRAVITY * h;
      this.pos.y += this.vel.y * h;
      this.airTime += h;
      this.airDist += Math.hypot(this.vel.x, this.vel.z) * h;
      if (this.pos.y <= gY) {
        const impact = -this.vel.y;
        this.pos.y = gY;
        this.vel.y = 0;
        this.grounded = true;
        if (impact > 10) this.damage((impact - 10) * 22, g);
        if (impact > 3) g.audio.thud(this.pos, Math.min(1, impact / 15));
        g.onVehicleLanded(this, this.airTime, this.airDist);
        this.takeoffRamp = null;
      }
    }

    // water
    const depth = WATER_Y - this.pos.y;
    if (depth > 0.7 && !this.submerged) {
      this.submerged = true;
      g.fx.splash(this.pos, 2.5);
      g.audio.splash(this.pos, 1);
    }
    if (this.submerged) {
      this.submergedT += h;
      this.vel.multiplyScalar(1 - Math.min(1, 2.5 * h));
      this.angVel *= 1 - 2 * h;
      if (this.submergedT > 10 && !this.destroyed) {
        this.destroyed = true;
        this.deadTime = g.time;
      }
    }

    // fuel + rpm
    if (this.driver === 'player' && engine) this.fuel = Math.max(0, this.fuel - inp.throttle * sp.fuelUse * h - 0.002 * h);
    const ratio = clamp(Math.abs(vF) / sp.maxSpeed, 0, 1);
    const gf = ratio * sp.gears;
    this.gear = Math.min(sp.gears, Math.floor(gf) + 1);
    const within = gf - (this.gear - 1);
    let rpmT = 0.16 + within * 0.72 + (inp.throttle > 0 && Math.abs(vF) < 3 ? inp.throttle * 0.35 : 0) + (this.slip > 4 ? 0.12 : 0);
    if (!this.grounded) rpmT = 0.3 + inp.throttle * 0.65;
    if (!engine) rpmT = 0;
    this.rpm = damp(this.rpm, rpmT, 7, h);
  }

  /** Arcade flight: throttle sets airspeed, SPACE climbs, SHIFT dives, steering banks and turns. */
  private planePhysics(h: number, g: Game, engine: boolean) {
    const sp = this.spec;
    const inp = this.input;
    const piloted = this.driver !== null;
    const thr = engine && piloted ? inp.throttle : 0;
    const climb = piloted && inp.handbrake;
    const dive = piloted && !!inp.boost;
    const stall = sp.stall ?? 25;
    if (this.destroyed) {
      // wreck: fall and come to rest
      this.airspeed = 0;
      this.vel.x *= 1 - 2 * h;
      this.vel.z *= 1 - 2 * h;
      this.vel.y -= GRAVITY * h;
      this.pos.addScaledVector(this.vel, h);
      const fl = Math.max(g.col.surfaceY(this.pos.x, this.pos.z, this.pos.y + 1, 0), terrainY(this.pos.x, this.pos.z) < WATER_Y ? WATER_Y - 1.5 : -999);
      if (this.pos.y <= fl) {
        this.pos.y = fl;
        this.vel.set(0, 0, 0);
        this.grounded = true;
      }
      this.flyPitch = damp(this.flyPitch, 0, 2, h);
      return;
    }
    let s = this.airspeed;
    s += sp.accel * thr * Math.max(0, 1 - (s / sp.maxSpeed) ** 2) * h;
    if (inp.brake > 0 && piloted) s -= (this.grounded ? sp.brake : 5) * inp.brake * h;
    s -= s * (this.grounded ? 0.03 : 0.004) * h + (this.grounded && thr === 0 ? 2 * h : 0);
    if (!this.grounded) s -= Math.sin(this.flyPitch) * 5 * h;
    s = clamp(s, this.grounded ? -3 : 0, sp.maxSpeed * 1.15);
    const prevX = this.pos.x,
      prevZ = this.pos.z;
    if (this.grounded) {
      this.bank = damp(this.bank, 0, 6, h);
      this.flyPitch = damp(this.flyPitch, 0, 6, h);
      if (!piloted && Math.abs(s) < 0.3) s = 0;
      this.angVel = -this.steer * clamp(Math.abs(s) / 6, 0, 1) * 1.6 * Math.sign(s || 1);
      this.yaw += this.angVel * h;
      // lift off once fast enough (holding SPACE lifts off a bit earlier)
      if (piloted && s > stall * (climb ? 1.0 : 1.12)) {
        this.grounded = false;
        this.flyPitch = 0.22;
        this.pos.y += 0.3;
      }
      this.vel.set(Math.sin(this.yaw) * s, 0, Math.cos(this.yaw) * s);
    } else {
      let pt = climb ? 0.5 : dive ? -0.55 : 0.04;
      if (s < stall) pt -= 0.5 * (1 - s / stall);
      if (this.pos.y > 520) pt = Math.min(pt, -0.1);
      this.flyPitch = damp(this.flyPitch, pt, 1.5, h);
      this.bank = damp(this.bank, (piloted ? inp.steer : 0) * 0.85, 2.4, h);
      this.angVel = -this.bank * 1.1 * clamp(s / 30, 0.4, 1.3);
      this.yaw += this.angVel * h;
      const cp = Math.cos(this.flyPitch);
      this.vel.set(Math.sin(this.yaw) * cp * s, Math.sin(this.flyPitch) * s, Math.cos(this.yaw) * cp * s);
      if (s < stall) this.vel.y -= (stall - s) * 0.7;
    }
    this.pos.addScaledVector(this.vel, h);
    this.airspeed = s;
    this.forwardSpeed = s;
    this.rpm = clamp(0.22 + thr * 0.6 + (s / sp.maxSpeed) * 0.3, 0, 1);
    this.gear = 1;
    // world limits: turn back towards the city
    if (this.pos.x < WORLD.minX - 600 || this.pos.x > WORLD.maxX + 600 || this.pos.z < WORLD.minZ - 600 || this.pos.z > WORLD.maxZ + 600) this.yaw += 1.2 * h;
    const wreck = () => {
      if (this.pos.y < WATER_Y + 0.5) g.fx.splash(this.pos, 3);
      this.health = 0;
      this.airspeed = 0;
      this.vel.set(0, 0, 0);
      this.explode(g);
    };
    // buildings
    const boxes = g.col.query(this.pos.x - 0.5, this.pos.z - 0.5, this.pos.x + 0.5, this.pos.z + 0.5);
    for (const b of boxes) {
      if (this.pos.x < b.minX || this.pos.x > b.maxX || this.pos.z < b.minZ || this.pos.z > b.maxZ) continue;
      if (b.maxY > this.pos.y + 0.6 && b.minY < this.pos.y + 2) {
        if (s > 14) return wreck();
        this.pos.x = prevX;
        this.pos.z = prevZ;
        this.airspeed = 0;
        this.vel.set(0, 0, 0);
        break;
      }
    }
    const ground = g.col.surfaceY(this.pos.x, this.pos.z, this.pos.y + 0.6, 0);
    const water = terrainY(this.pos.x, this.pos.z) < WATER_Y;
    const floor = water ? Math.max(ground, WATER_Y) : ground;
    this.altitude = this.pos.y - floor;
    if (!this.grounded && this.pos.y <= floor) {
      if (!water && this.vel.y > -9 && this.flyPitch > -0.4 && Math.abs(this.bank) < 0.7) {
        this.grounded = true;
        this.pos.y = floor;
        if (this.vel.y < -5) this.damage(40, g, false);
      } else return wreck();
    }
    if (this.grounded) {
      if (water) return wreck();
      if (floor < this.pos.y - 0.8) this.grounded = false; // rolled off an edge
      else this.pos.y = floor;
    }
  }

  private boatPhysics(h: number, g: Game, vF: number, vL: number, fx: number, fz: number, rx: number, rz: number, engine: boolean) {
    const sp = this.spec;
    const inp = this.input;
    const t = g.time;
    const waterY = WATER_Y + Math.sin(t * 1.3 + this.pos.x * 0.08) * 0.08 + Math.sin(t * 0.9 + this.pos.z * 0.06) * 0.06;
    const ground = terrainY(this.pos.x, this.pos.z);
    const depth = waterY - ground;
    const aground = depth < 0.4;
    let a = 0;
    const thr = engine ? inp.throttle : 0;
    if (thr > 0 && depth > 0.15) a += sp.accel * thr * Math.max(0, 1 - (vF / sp.maxSpeed) ** 2);
    if (inp.brake > 0) a -= vF > 0.5 ? sp.accel * 0.8 * inp.brake : vF > -sp.reverse ? sp.accel * 0.5 * inp.brake : 0;
    a -= vF * 0.12;
    if (aground) a -= vF * 4;
    vF += a * h;
    const dv = Math.min(Math.abs(vL), sp.grip * h * (inp.handbrake ? 0.5 : 1));
    vL -= Math.sign(vL) * dv;
    const rudder = -this.steer * (0.35 + Math.min(1, Math.abs(vF) / 8) * 0.9) * (vF >= -0.5 ? 1 : -1);
    this.angVel = damp(this.angVel, rudder, 2.5, h);
    this.yaw += this.angVel * h;
    this.vel.x = fx * vF + rx * vL;
    this.vel.z = fz * vF + rz * vL;
    this.forwardSpeed = vF;
    const ox = this.pos.x,
      oz = this.pos.z;
    this.pos.x += this.vel.x * h;
    this.pos.z += this.vel.z * h;
    this.collideStatic(h, g, ox, oz);
    const targetY = aground ? Math.max(ground, waterY - 0.25) : waterY - 0.25 + Math.min(0.25, Math.abs(vF) * 0.008);
    this.pos.y = damp(this.pos.y, targetY, 6, h);
    this.grounded = true;
    this.slip = Math.abs(vL);
    this.pitch = damp(this.pitch, -Math.min(0.14, Math.max(0, vF) * 0.005) + Math.sin(t * 2.1 + this.pos.x) * 0.02, 3, h);
    this.roll = damp(this.roll, clamp(-this.angVel * vF * 0.02, -0.25, 0.25), 3, h);
    const ratio = clamp(Math.abs(vF) / sp.maxSpeed, 0, 1);
    this.rpm = damp(this.rpm, engine ? 0.2 + ratio * 0.6 + thr * 0.2 : 0, 5, h);
    this.gear = 1;
    if (this.driver === 'player' && engine) this.fuel = Math.max(0, this.fuel - thr * sp.fuelUse * h);
    if (Math.abs(vF) > 6 && Math.random() < h * 30) {
      const back = this.ahead.set(this.pos.x - fx * sp.len * 0.45, WATER_Y + 0.1, this.pos.z - fz * sp.len * 0.45);
      g.fx.spray(back, Math.abs(vF) / sp.maxSpeed);
    }
  }

  private cp = { x: 0, z: 0 };
  private collideStatic(h: number, g: Game, ox: number, oz: number) {
    const sp = this.spec;
    const fx = Math.sin(this.yaw),
      fz = Math.cos(this.yaw);
    const r = sp.bike ? 0.42 : sp.wid / 2;
    const half = sp.len / 2;
    const offs = sp.bike ? [0.55, -0.55] : sp.len > 6 ? [half - r, half * 0.3, -half * 0.3, -(half - r)] : [half - r, 0, -(half - r)];
    let nx = 0,
      nz = 0,
      hits = 0;
    let leverSum = 0;
    for (const off of offs) {
      const c = this.cp;
      c.x = this.pos.x + fx * off;
      c.z = this.pos.z + fz * off;
      const res = g.col.pushCircle(c, r, this.pos.y + 0.35, this.pos.y + sp.height, 0);
      if (res.hit) {
        this.pos.x += c.x - (this.pos.x + fx * off);
        this.pos.z += c.z - (this.pos.z + fz * off);
        nx += res.nx;
        nz += res.nz;
        hits++;
        leverSum += off;
      }
      // ramps hit from the side behave like walls
      const ry = g.col.rampY(c.x, c.z);
      if (ry > this.pos.y + 1.1 && ry > -Infinity) {
        this.pos.x = ox;
        this.pos.z = oz;
        nx -= this.vel.x;
        nz -= this.vel.z;
        hits++;
      }
      // props
      g.props.vehicleHit(c.x, c.z, r, this.vel.x, this.vel.z, this.pos.y, sp.mass, (p, pnx, pnz, blocked) => {
        if (blocked) {
          const rr = r + 0.3;
          const dx = c.x - p.x,
            dz = c.z - p.z;
          const d = Math.hypot(dx, dz) || 1;
          if (d < rr) {
            this.pos.x += (dx / d) * (rr - d);
            this.pos.z += (dz / d) * (rr - d);
          }
          const vn = this.vel.x * pnx + this.vel.z * pnz;
          if (vn < 0) {
            this.vel.x -= pnx * vn * 1.2;
            this.vel.z -= pnz * vn * 1.2;
          }
        } else {
          this.vel.multiplyScalar(p.type === 'lamp' ? 0.82 : 0.95);
          if (p.type === 'lamp') this.damage(25, g);
        }
      });
    }
    if (hits > 0) {
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn < 0) {
        const impact = -vn;
        this.vel.x -= nx * vn * 1.25;
        this.vel.z -= nz * vn * 1.25;
        const tf = 1 - Math.min(0.5, impact * 0.025);
        const tx = this.vel.x - nx * (this.vel.x * nx + this.vel.z * nz);
        const tz = this.vel.z - nz * (this.vel.x * nx + this.vel.z * nz);
        this.vel.x -= tx * (1 - tf);
        this.vel.z -= tz * (1 - tf);
        const lever = leverSum / hits;
        this.angVel += lever * (fx * nz - fz * nx) * impact * 0.06;
        if (impact > 2.5) {
          this.lastImpact = impact;
          const dmg = Math.pow(impact - 2.5, 1.35) * 9 * (this.spec.cls === 'swat' ? 0.5 : 1);
          this.damage(dmg, g);
          g.onVehicleImpact(this, impact, this.pos.x - nx * r, this.pos.z - nz * r, null);
        }
      }
    }
  }

  syncVisual(dt: number) {
    const sp = this.spec;
    const grp = this.rig.group;
    grp.position.copy(this.pos);
    grp.rotation.set(0, this.yaw, 0);
    if (!sp.boat) {
      if (this.grounded) {
        this.pitch = damp(this.pitch, -clamp(this.vel.y / Math.max(4, Math.abs(this.forwardSpeed)), -0.4, 0.4) * Math.sign(this.forwardSpeed || 1), 10, dt);
      } else this.pitch = damp(this.pitch, clamp(0.25 - this.vel.y * 0.02, -0.3, 0.45), 1.2, dt);
      if (sp.bike) this.roll = damp(this.roll, clamp(-this.angVel * this.forwardSpeed * 0.055, -0.8, 0.8), 8, dt);
      else this.roll = damp(this.roll, clamp(this.angVel * this.forwardSpeed * 0.0045, -0.07, 0.07), 6, dt);
    }
    if (sp.plane) {
      this.pitch = -this.flyPitch;
      this.roll = this.bank;
      if (this.rig.prop && !this.destroyed) this.rig.prop.rotation.z += (this.driver ? 8 + this.input.throttle * 55 : this.airspeed > 1 ? 4 : 0) * dt;
      for (const f of this.rig.flames) {
        const k = this.destroyed || !this.driver ? 0 : 0.35 + this.input.throttle * 0.8 + Math.random() * 0.2;
        f.visible = k > 0.1;
        f.scale.set(0.8 + k * 0.2, 0.8 + k * 0.2, k);
      }
    }
    this.rig.body.rotation.set(this.pitch, 0, this.roll);
    if (sp.crazy && !this.destroyed) {
      this.fxT += dt;
      const thr = this.driver ? this.input.throttle : 0;
      for (const f of this.rig.flames) {
        const k = this.boosting ? 1.4 + Math.random() * 0.5 : sp.crazy === 'rocket' && thr > 0 ? 0.35 + Math.random() * 0.2 : 0;
        f.visible = k > 0;
        if (k > 0) f.scale.set(0.8 + k * 0.25, 0.8 + k * 0.25, k);
      }
      if (sp.crazy === 'hover') {
        this.rig.body.position.y = 0.08 + Math.sin(this.fxT * 2.4) * 0.06;
        const pulse = 1.6 + Math.sin(this.fxT * 9) * 0.5 + (this.boosting ? 1.5 : 0);
        this.rig.hoverPads?.color.setRGB(0.2 * pulse, 1.4 * pulse, 1.9 * pulse);
      }
    }
    const wr = sp.shape.wheelR;
    for (const w of this.rig.wheels) {
      w.mesh.rotation.x += (this.forwardSpeed * dt) / wr;
      if (w.front) w.pivot.rotation.y = -this.steer;
      if (sp.bike) {
        w.pivot.rotation.z = this.roll;
        w.pivot.position.x = -Math.sin(this.roll) * wr;
      }
    }
    // lights
    if (!this.destroyed) {
      const braking = this.input.brake > 0.1 && this.forwardSpeed > 0.5;
      const rev = this.forwardSpeed < -0.5;
      this.rig.tailMat.color.setRGB(braking ? 4 : rev ? 2.5 : 0.9, braking ? 0.15 : rev ? 2.5 : 0.02, braking ? 0.1 : rev ? 2.5 : 0.02);
    }
    if (this.rig.sirenR && this.rig.sirenB) {
      this.sirenT += dt;
      if (this.sirenOn && !this.destroyed) {
        const ph = Math.floor(this.sirenT * 6) % 2;
        this.rig.sirenR.color.setRGB(ph ? 6 : 0.3, 0, 0);
        this.rig.sirenB.color.setRGB(0, 0.1, ph ? 0.3 : 7);
      } else {
        this.rig.sirenR.color.setRGB(0.25, 0, 0);
        this.rig.sirenB.color.setRGB(0, 0, 0.25);
      }
    }
  }

  repaint(color: number) {
    const next = paintMaterial(color);
    this.rig.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material === this.rig.paint) m.material = next;
    });
    this.rig.paint = next;
    this.color = color;
  }

  repair() {
    this.health = this.spec.health;
    this.burnTimer = -1;
  }

  setHeadlights(night: number) {
    if (this.destroyed) return;
    const k = 0.8 + night * 3.5;
    this.rig.headMat.color.setRGB(k, k * 0.96, k * 0.85);
  }

  dispose() {
    this.rig.group.removeFromParent();
  }
}
