import * as THREE from 'three';
import { BLOCKS, GRAVITY, ROAD_HALF, WATER_Y, locateBlock, roadC, terrainY } from '../constants';
import { clamp, damp, dampAngle } from '../core/math';
import type { Game } from '../Game';
import { Actor, DamageKind, Team, nextActorId } from '../characters/Actor';
import { Action, CharacterLook, CharacterModel, defaultAnim } from '../characters/CharacterModel';
import { WEAPONS, WeaponId } from '../combat/Weapons';
import type { Vehicle } from '../vehicles/Vehicle';

export type PedState = 'walk' | 'idle' | 'talk' | 'waitCross' | 'cross' | 'flee' | 'fight' | 'knocked' | 'dead' | 'phone' | 'enter' | 'goto' | 'cower' | 'police' | 'stand';
export type PedRole = 'civ' | 'gang' | 'police' | 'swat' | 'mission';

const SIDE = 80; // perimeter side length

export function perimeterPoint(bi: number, bj: number, s: number) {
  const x0 = roadC(bi) + ROAD_HALF + 2,
    x1 = roadC(bi + 1) - ROAD_HALF - 2;
  const z0 = roadC(bj) + ROAD_HALF + 2,
    z1 = roadC(bj + 1) - ROAD_HALF - 2;
  s = ((s % (SIDE * 4)) + SIDE * 4) % (SIDE * 4);
  const side = x1 - x0;
  const k = (s % SIDE) / SIDE;
  if (s < SIDE) return { x: x0 + k * side, z: z0 };
  if (s < SIDE * 2) return { x: x1, z: z0 + k * side };
  if (s < SIDE * 3) return { x: x1 - k * side, z: z1 };
  return { x: x0, z: z1 - k * side };
}

export function perimeterParam(bi: number, bj: number, x: number, z: number) {
  const x0 = roadC(bi) + ROAD_HALF + 2,
    x1 = roadC(bi + 1) - ROAD_HALF - 2;
  const z0 = roadC(bj) + ROAD_HALF + 2,
    z1 = roadC(bj + 1) - ROAD_HALF - 2;
  const side = x1 - x0;
  const cands = [
    { s: clamp((x - x0) / side, 0, 1) * SIDE, d: Math.abs(z - z0) },
    { s: SIDE + clamp((z - z0) / side, 0, 1) * SIDE, d: Math.abs(x - x1) },
    { s: SIDE * 2 + clamp((x1 - x) / side, 0, 1) * SIDE, d: Math.abs(z - z1) },
    { s: SIDE * 3 + clamp((z1 - z) / side, 0, 1) * SIDE, d: Math.abs(x - x0) },
  ];
  cands.sort((a, b) => a.d - b.d);
  return cands[0].s;
}

const LINES = [
  "Nice day for it, huh?",
  "Don't you have somewhere to be?",
  "I'm late for my shift at the diner.",
  "Have you tried the tacos at Taco Loco?",
  "The traffic on Neon Highway is a nightmare.",
  "My cousin says Club Ultraviolet is the place to be.",
  "Keep it moving, pal.",
  "Is it just me or are the cops everywhere today?",
  "I heard someone found a gold token on a rooftop downtown.",
  "Beach is beautiful this time of year.",
  "You look like you've had a long day.",
  "Do I know you from somewhere?",
  "They say the view from Coral Key is unbeatable.",
  "Stay off Ocean Drive after midnight, trust me.",
  "I'm saving up for a Zenith R. One day...",
];

export class Ped implements Actor {
  id = nextActorId();
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  radius = 0.33;
  height = 1.75;
  health = 60;
  maxHealth = 60;
  alive = true;
  team: Team = 'civ';
  isPlayer = false;
  knockT = 0;
  inVehicle = false;
  blocking = false;
  model: CharacterModel;
  anim = defaultAnim();
  state: PedState = 'walk';
  timer = 0;
  bi = 0;
  bj = 0;
  s = 0;
  dir = 1;
  walkSpeed = 1.3 + Math.random() * 0.5;
  target: { x: number; z: number } | null = null;
  threat: { x: number; z: number } = { x: 0, z: 0 };
  talkWith: Ped | null = null;
  role: PedRole = 'civ';
  weapon: WeaponId = 'fists';
  fireCD = 0;
  action: Action = 'none';
  actionT = 0;
  actionSide = 1;
  hitDone = false;
  witnessT = -1;
  witnessCrime = '';
  persistent = false;
  name = '';
  hostile = false;
  dialogue: string[] | null = null;
  knockAmt = 0;
  deadT = 0;
  grounded = true;
  crossTo: { x: number; z: number; bi: number; bj: number } | null = null;
  unitId = -1;
  homeX = 0;
  homeZ = 0;
  accuracy = 0.35;
  damageMul = 1;
  lastSpokeT = -99;
  removeMe = false;
  visibleNow = true;
  aggroT = 0;

  constructor(look: CharacterLook, role: PedRole = 'civ') {
    this.model = new CharacterModel(look);
    this.role = role;
    this.team = role === 'police' || role === 'swat' ? 'police' : role === 'gang' ? 'gang' : role === 'mission' ? 'mission' : 'civ';
    if (role === 'swat') {
      this.maxHealth = this.health = 160;
    } else if (role === 'police') this.maxHealth = this.health = 100;
    else if (role === 'gang') this.maxHealth = this.health = 85;
  }

  setWeapon(w: WeaponId) {
    this.weapon = w;
    this.model.setWeapon(WEAPONS[w].visual);
  }

  takeDamage(amount: number, fromX: number, fromZ: number, kind: DamageKind, source: Actor | null, g: Game) {
    if (!this.alive) return;
    if (this.blocking && kind === 'melee') amount *= 0.25;
    this.health -= amount * this.damageMul;
    this.threat.x = fromX;
    this.threat.z = fromZ;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.state = 'dead';
      this.deadT = 0;
      const dx = this.pos.x - fromX,
        dz = this.pos.z - fromZ;
      const l = Math.hypot(dx, dz) || 1;
      if (this.knockT <= 0) this.knockdown((dx / l) * 2, (dz / l) * 2, 1, 999);
      else this.knockT = 999;
      g.peds.onPedKilled(this, source);
      return;
    }
    if (kind === 'melee' || kind === 'bullet') {
      this.action = 'hit';
      this.actionT = 0;
    }
    if (Math.random() < 0.4) g.audio.scream(this.pos);
    if (source && source.isPlayer) {
      this.aggroT = 30;
      if (this.role === 'gang' || this.role === 'police' || this.role === 'swat' || (this.role === 'civ' && Math.random() < 0.15 && kind === 'melee')) {
        this.hostile = true;
        if (this.role !== 'police' && this.role !== 'swat') this.state = 'fight';
      } else if (this.role === 'civ' && this.state !== 'knocked') this.startFlee(fromX, fromZ);
    }
  }

  knockdown(ix: number, iz: number, up: number, duration: number) {
    this.knockT = duration;
    this.vel.set(ix, up, iz);
    this.grounded = false;
    if (Math.hypot(ix, iz) > 0.1) this.yaw = Math.atan2(-ix, -iz);
    if (this.alive) this.state = 'knocked';
    this.talkWith = null;
  }

  startFlee(x: number, z: number, t = 8 + Math.random() * 8) {
    if (this.role === 'mission' && !this.hostile) {
      this.state = 'cower';
      this.timer = t;
      return;
    }
    if (!this.alive || this.state === 'knocked') return;
    this.threat.x = x;
    this.threat.z = z;
    if (this.talkWith) {
      this.talkWith.talkWith = null;
      this.talkWith = null;
    }
    if (Math.random() < 0.15 && this.state !== 'flee') {
      this.state = 'cower';
      this.timer = 4 + Math.random() * 4;
    } else {
      this.state = 'flee';
      this.timer = t;
    }
  }

  say(g: Game, line?: string) {
    const text = line ?? this.dialogue?.[Math.floor(Math.random() * this.dialogue.length)] ?? LINES[Math.floor(Math.random() * LINES.length)];
    g.ui.subtitle(this.name || 'Pedestrian', text);
    g.audio.babble(this.pos, this.model.look.height > 1 ? 0.85 : 1.15);
    this.lastSpokeT = g.time;
  }

  private moveToward(x: number, z: number, speed: number, dt: number, rate = 8) {
    const dx = x - this.pos.x,
      dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) {
      this.vel.x = damp(this.vel.x, 0, rate, dt);
      this.vel.z = damp(this.vel.z, 0, rate, dt);
      return d;
    }
    const sp = Math.min(speed, d * 3);
    this.vel.x = damp(this.vel.x, (dx / d) * sp, rate, dt);
    this.vel.z = damp(this.vel.z, (dz / d) * sp, rate, dt);
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 8, dt);
    return d;
  }

  update(dt: number, g: Game) {
    this.timer -= dt;
    this.fireCD -= dt;
    this.aggroT -= dt;
    if (this.action !== 'none') {
      this.actionT += dt;
      if ((this.action === 'punch' || this.action === 'swing') && !this.hitDone && this.actionT > (this.action === 'punch' ? 0.12 : 0.25)) {
        this.hitDone = true;
        g.combat.meleeAttack(this, WEAPONS[this.weapon], this.role === 'swat' ? 1.3 : 1);
      }
      if (this.actionT > 0.5) this.action = 'none';
    }
    this.blocking = false;
    const p = g.player;
    const pd = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);

    if (this.knockT > 0) {
      this.knockT -= dt;
      this.knockAmt = Math.min(1, this.knockAmt + dt * 5);
      this.vel.x *= 1 - Math.min(1, dt * (this.grounded ? 4 : 0.3));
      this.vel.z *= 1 - Math.min(1, dt * (this.grounded ? 4 : 0.3));
      if (this.alive && this.knockT < 0.6) this.knockAmt = Math.max(0, this.knockT / 0.6);
      if (this.knockT <= 0 && this.alive) {
        this.knockAmt = 0;
        if (this.hostile || this.role === 'police' || this.role === 'swat') this.state = this.role === 'police' || this.role === 'swat' ? 'police' : 'fight';
        else this.startFlee(p.pos.x, p.pos.z);
      }
    } else if (!this.alive) {
      this.deadT += dt;
    } else {
      switch (this.state) {
        case 'walk':
          this.walk(dt, g);
          break;
        case 'waitCross':
          this.vel.x = damp(this.vel.x, 0, 8, dt);
          this.vel.z = damp(this.vel.z, 0, 8, dt);
          if (this.crossTo) {
            const axis = Math.abs(this.crossTo.x - this.pos.x) > Math.abs(this.crossTo.z - this.pos.z) ? 'ns' : 'ew';
            if (g.lights.canCross(axis)) this.state = 'cross';
            this.yaw = dampAngle(this.yaw, Math.atan2(this.crossTo.x - this.pos.x, this.crossTo.z - this.pos.z), 5, dt);
          } else this.state = 'walk';
          if (this.timer < -25) this.state = 'walk';
          break;
        case 'cross':
          if (this.crossTo) {
            const d = this.moveToward(this.crossTo.x, this.crossTo.z, this.walkSpeed * 1.25, dt);
            if (d < 0.6) {
              this.bi = this.crossTo.bi;
              this.bj = this.crossTo.bj;
              this.s = perimeterParam(this.bi, this.bj, this.pos.x, this.pos.z);
              this.crossTo = null;
              this.state = 'walk';
            }
          } else this.state = 'walk';
          break;
        case 'talk':
        case 'idle':
        case 'stand':
          this.vel.x = damp(this.vel.x, 0, 8, dt);
          this.vel.z = damp(this.vel.z, 0, 8, dt);
          if (this.talkWith) {
            const o = this.talkWith;
            this.yaw = dampAngle(this.yaw, Math.atan2(o.pos.x - this.pos.x, o.pos.z - this.pos.z), 4, dt);
            if (pd < 14 && Math.random() < dt * 0.4) g.audio.babble(this.pos, this.model.look.height > 1 ? 0.85 : 1.15);
          }
          if (this.state === 'stand' && pd < 4 && this.role === 'mission') this.yaw = dampAngle(this.yaw, Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z), 4, dt);
          if (this.timer <= 0 && this.state !== 'stand') {
            if (this.talkWith) this.talkWith.talkWith = null;
            this.talkWith = null;
            this.state = 'walk';
          }
          break;
        case 'phone':
          this.vel.x = damp(this.vel.x, 0, 6, dt);
          this.vel.z = damp(this.vel.z, 0, 6, dt);
          if (this.timer <= 0) this.startFlee(this.threat.x, this.threat.z, 6);
          break;
        case 'cower':
          this.vel.x = damp(this.vel.x, 0, 8, dt);
          this.vel.z = damp(this.vel.z, 0, 8, dt);
          if (this.timer <= 0) this.state = this.role === 'mission' ? 'stand' : 'flee';
          if (this.state === 'flee') this.timer = 6;
          break;
        case 'flee': {
          let dx = this.pos.x - this.threat.x,
            dz = this.pos.z - this.threat.z;
          const l = Math.hypot(dx, dz) || 1;
          dx /= l;
          dz /= l;
          // wobble so they don't all run in straight lines
          const w = Math.sin(g.time * 0.7 + this.id) * 0.4;
          const fx = dx * Math.cos(w) - dz * Math.sin(w),
            fz = dx * Math.sin(w) + dz * Math.cos(w);
          this.moveToward(this.pos.x + fx * 5, this.pos.z + fz * 5, 5.8, dt, 6);
          if (this.timer <= 0) this.rejoinPath();
          break;
        }
        case 'fight':
          this.fight(dt, g, pd);
          break;
        case 'goto':
        case 'enter':
          if (this.target) {
            const d = this.moveToward(this.target.x, this.target.z, this.state === 'enter' ? this.walkSpeed : this.walkSpeed * 1.6, dt);
            if (d < 0.8) {
              if (this.state === 'enter') this.removeMe = true;
              else this.state = 'stand';
            }
          } else this.state = 'walk';
          break;
        case 'police':
          g.police.updateOfficer(this, dt, pd);
          break;
      }
      this.avoidVehicles(g);
      if (this.witnessT > 0) {
        this.witnessT -= dt;
        if (this.state !== 'phone' && this.witnessT < 2.5 && this.state !== 'knocked') {
          this.state = 'phone';
          this.timer = 2.5;
        }
        if (this.witnessT <= 0) {
          this.witnessT = -1;
          g.wanted.witnessReport(this.witnessCrime, this.pos.x, this.pos.z);
        }
      }
    }

    // physics
    if (!this.grounded || this.knockT > 0) this.vel.y -= GRAVITY * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    g.col.pushCircle(this.pos, this.radius, this.pos.y, this.pos.y + this.height, 0.45);
    if (this.alive && this.knockT <= 0) g.props.pushCharacter(this.pos, this.radius, this.pos.y);
    const gY = g.col.surfaceY(this.pos.x, this.pos.z, this.pos.y, 0.5);
    if (this.pos.y <= gY + 0.02 || (this.grounded && this.pos.y - gY < 0.5)) {
      if (!this.grounded && this.vel.y < -14 && this.alive) this.takeDamage((-this.vel.y - 14) * 8, this.pos.x, this.pos.z, 'fall', null, g);
      this.pos.y = gY;
      this.vel.y = 0;
      this.grounded = true;
    } else this.grounded = false;
    if (this.pos.y < WATER_Y - 1.2 && terrainY(this.pos.x, this.pos.z) < WATER_Y - 1.2) {
      // peds don't swim: they drown and get removed
      this.alive = false;
      this.removeMe = true;
    }

    // visuals
    if (this.visibleNow) {
      const a = this.anim;
      a.speed = this.knockT > 0 ? 0 : Math.hypot(this.vel.x, this.vel.z);
      a.grounded = this.grounded;
      a.vy = this.vel.y;
      a.swim = false;
      a.knocked = this.alive ? this.knockAmt : Math.min(1, (this.knockAmt = Math.min(1, this.knockAmt + dt * 5)));
      a.action =
        this.action !== 'none'
          ? this.action
          : this.state === 'talk'
            ? 'talk'
            : this.state === 'phone'
              ? 'phone'
              : this.state === 'cower'
                ? 'handsUp'
                : this.state === 'fight' && WEAPONS[this.weapon].melee && this.weapon === 'fists'
                  ? 'block'
                  : (this.state === 'police' || this.state === 'fight') && !WEAPONS[this.weapon].melee && pd < 40
                    ? 'aim'
                    : 'none';
      if (a.action === 'block' && pd > 4) a.action = 'none';
      a.actionT = this.actionT;
      a.actionSide = this.actionSide;
      a.twoHanded = WEAPONS[this.weapon].twoHanded;
      a.aimPitch = 0;
      a.landing = 0;
      this.model.root.position.copy(this.pos);
      this.model.root.rotation.y = this.yaw;
      this.model.update(dt, a);
    }
  }

  rejoinPath() {
    const b = locateBlock(this.pos.x, this.pos.z);
    if (b) {
      this.bi = b.bi;
      this.bj = b.bj;
      this.s = perimeterParam(b.bi, b.bj, this.pos.x, this.pos.z);
      this.state = 'walk';
    } else {
      this.homeX = this.pos.x;
      this.state = 'idle';
      this.timer = 999;
    }
  }

  private walk(dt: number, g: Game) {
    const prevS = this.s;
    this.s += this.dir * this.walkSpeed * dt * 0.98;
    const tgt = perimeterPoint(this.bi, this.bj, this.s + this.dir * 1.5);
    this.moveToward(tgt.x, tgt.z, this.walkSpeed, dt, 6);
    // corner crossing
    const c0 = Math.floor(prevS / SIDE),
      c1 = Math.floor(this.s / SIDE);
    if (c0 !== c1 && Math.random() < 0.4) {
      const corner = perimeterPoint(this.bi, this.bj, (this.dir > 0 ? c1 : c0) * SIDE);
      // travel direction before the corner
      const before = perimeterPoint(this.bi, this.bj, (this.dir > 0 ? c1 : c0) * SIDE - this.dir * 5);
      let dx = corner.x - before.x,
        dz = corner.z - before.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const tx = corner.x + dx * (ROAD_HALF * 2 + 4),
        tz = corner.z + dz * (ROAD_HALF * 2 + 4);
      const b = locateBlock(tx, tz);
      if (b && b.bi >= 0 && b.bi < BLOCKS && b.bj >= 0 && b.bj < BLOCKS) {
        this.crossTo = { x: tx, z: tz, bi: b.bi, bj: b.bj };
        this.state = 'waitCross';
        this.timer = 0;
        return;
      }
    }
    // occasional chat
    if (Math.random() < dt * 0.04) {
      for (const o of g.peds.list) {
        if (o === this || o.state !== 'walk' || o.role !== 'civ' || this.role !== 'civ') continue;
        if (o.pos.distanceToSquared(this.pos) < 6) {
          this.state = o.state = 'talk';
          this.talkWith = o;
          o.talkWith = this;
          this.timer = o.timer = 6 + Math.random() * 8;
          break;
        }
      }
    }
    // occasionally enter a shop/club
    if (Math.random() < dt * 0.05) {
      for (const poi of g.layout.pois) {
        if (poi.type !== 'diner' && poi.type !== 'club' && poi.type !== 'weapons' && poi.type !== 'hospital') continue;
        if (Math.hypot(poi.ex - this.pos.x, poi.ez - this.pos.z) < 10 && !this.persistent) {
          this.state = 'enter';
          this.target = { x: poi.x, z: poi.ez + (poi.yaw === 0 ? -2.5 : 2.5) };
          break;
        }
      }
    }
  }

  private fight(dt: number, g: Game, pd: number) {
    const p = g.player;
    if (!p.alive || (pd > 45 && this.aggroT < 0)) {
      this.hostile = false;
      this.rejoinPath();
      return;
    }
    const tp = p.vehicle ? p.vehicle.pos : p.pos;
    const w = WEAPONS[this.weapon];
    if (w.melee) {
      const d = this.moveToward(tp.x, tp.z, pd > 3 ? 5.2 : 1.2, dt);
      if (d < 1.6 && this.action === 'none' && this.fireCD <= 0 && !p.vehicle) {
        this.action = this.weapon === 'bat' ? 'swing' : 'punch';
        this.actionT = 0;
        this.actionSide = -this.actionSide;
        this.hitDone = false;
        this.fireCD = 0.7 + Math.random() * 0.6;
      }
      this.blocking = d < 3 && Math.random() < 0.02;
    } else {
      // keep distance and shoot
      const want = 9;
      if (pd > want + 4) this.moveToward(tp.x, tp.z, 4.5, dt);
      else if (pd < want - 3) this.moveToward(this.pos.x - (tp.x - this.pos.x), this.pos.z - (tp.z - this.pos.z), 3, dt);
      else {
        this.vel.x = damp(this.vel.x, 0, 6, dt);
        this.vel.z = damp(this.vel.z, 0, 6, dt);
      }
      this.yaw = dampAngle(this.yaw, Math.atan2(tp.x - this.pos.x, tp.z - this.pos.z), 10, dt);
      if (this.fireCD <= 0 && pd < 45 && g.col.los(this.pos.x, this.pos.y + 1.5, this.pos.z, tp.x, tp.y + 1.2, tp.z)) {
        this.fireCD = 0.55 + Math.random() * 0.6;
        g.combat.npcFire(this, tp.x, tp.y + 1.1, tp.z, this.accuracy, w.damage * 0.55);
      }
    }
  }

  private avoidVehicles(g: Game) {
    if (this.state === 'fight' || this.state === 'police') return;
    for (const v of g.vehicles.list) {
      if (v.speed < 3) continue;
      const dx = this.pos.x - v.pos.x,
        dz = this.pos.z - v.pos.z;
      if (Math.abs(dx) > 14 || Math.abs(dz) > 14) continue;
      // predicted closest approach in 0.9s
      const px = v.pos.x + v.vel.x * 0.7,
        pz = v.pos.z + v.vel.z * 0.7;
      if (Math.hypot(this.pos.x - px, this.pos.z - pz) < 2.6) {
        const sx = -v.vel.z,
          sz = v.vel.x;
        const l = Math.hypot(sx, sz) || 1;
        const side = dx * sx + dz * sz > 0 ? 1 : -1;
        this.vel.x = (sx / l) * 5.5 * side;
        this.vel.z = (sz / l) * 5.5 * side;
        if (this.state !== 'flee' && Math.random() < 0.5) {
          g.audio.scream(this.pos);
          if (v.driver === 'player') this.startFlee(v.pos.x, v.pos.z, 5);
        }
        break;
      }
    }
  }

  dispose() {
    this.model.dispose();
  }
}

export function ejectPosition(v: Vehicle) {
  const lx = Math.cos(v.yaw),
    lz = -Math.sin(v.yaw);
  return { x: v.pos.x + lx * (v.spec.wid / 2 + 0.7), z: v.pos.z + lz * (v.spec.wid / 2 + 0.7) };
}
