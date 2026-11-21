import * as THREE from 'three';
import { GRAVITY, WATER_Y, terrainY } from '../constants';
import { clamp, damp, dampAngle, wrapAngle } from '../core/math';
import type { Game } from '../Game';
import { Actor, DamageKind, nextActorId } from '../characters/Actor';
import { Action, CharacterModel, defaultAnim } from '../characters/CharacterModel';
import { CharacterDef } from '../characters/Roster';
import { Inventory, WEAPONS, WEAPON_ORDER, WeaponId, newInventory } from '../combat/Weapons';
import type { Vehicle } from '../vehicles/Vehicle';

export class Player implements Actor {
  id = nextActorId();
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  radius = 0.35;
  height = 1.8;
  health = 100;
  maxHealth = 100;
  armor = 0;
  alive = true;
  team = 'player' as const;
  isPlayer = true;
  knockT = 0;
  inVehicle = false;
  blocking = false;
  model: CharacterModel;
  stamina = 100;
  grounded = true;
  swimming = false;
  vehicle: Vehicle | null = null;
  lastVehicle: Vehicle | null = null;
  anim = defaultAnim();
  action: Action = 'none';
  actionT = 0;
  actionSide = 1;
  private hitDone = false;
  walkMode = false;
  fallStartY = 0;
  landingT = 0;
  mantle: { fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; t: number } | null = null;
  invulnT = 0;
  inv: Inventory = newInventory();
  weapon: WeaponId = 'fists';
  fireCD = 0;
  reloadT = 0;
  medkits = 1;
  aiming = false;
  aimPitch = 0;
  knockDur = 0;
  knockAmt = 0;
  lastDamageT = -99;
  regenT = 0;
  swimDist = 0;
  enterTarget: Vehicle | null = null;
  enterT = 0;
  bailT = 0;
  speedNow = 0;
  def: CharacterDef;
  noClipT = 0;

  constructor(def: CharacterDef) {
    this.def = def;
    this.model = new CharacterModel(def.look);
    this.maxHealth = this.health = def.health;
  }

  setCharacter(def: CharacterDef, scene: THREE.Scene) {
    const parent = this.model.root.parent;
    this.model.dispose();
    this.def = def;
    this.model = new CharacterModel(def.look);
    this.maxHealth = def.health;
    this.health = Math.min(this.health, def.health);
    (parent ?? scene).add(this.model.root);
    this.model.setWeapon(WEAPONS[this.weapon].visual);
  }

  get weaponDef() {
    return WEAPONS[this.weapon];
  }

  teleport(x: number, z: number, g: Game, yaw = this.yaw) {
    if (this.vehicle) this.exitVehicle(g, true);
    this.pos.set(x, g.col.surfaceY(x, z, 200, 0), z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.grounded = true;
    this.swimming = false;
    this.fallStartY = this.pos.y;
    this.knockT = 0;
    this.knockAmt = 0;
    this.mantle = null;
  }

  takeDamage(amount: number, fromX: number, fromZ: number, kind: DamageKind, source: Actor | null, g: Game) {
    if (!this.alive || g.cheats.god) return;
    if (this.invulnT > 0 && (kind === 'melee' || kind === 'bullet')) return;
    if (this.blocking && kind === 'melee') amount *= 0.2;
    if (this.vehicle && kind === 'bullet') amount *= 0.45;
    if (this.armor > 0 && kind !== 'fall' && kind !== 'drown') {
      const absorbed = Math.min(this.armor, amount * 0.7);
      this.armor -= absorbed;
      amount -= absorbed;
    }
    this.health -= amount;
    this.lastDamageT = g.time;
    const dx = this.pos.x - fromX,
      dz = this.pos.z - fromZ;
    g.ui.damageFlash(Math.atan2(dx, dz) - g.cam.yaw, Math.min(1, amount / 30));
    g.cam.shake(Math.min(0.6, amount / 40));
    if (kind === 'melee' && !this.vehicle && amount > 8 && this.action !== 'block') {
      this.action = 'hit';
      this.actionT = 0;
    }
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      if (!this.vehicle) this.knockdown(dx * 0.5, dz * 0.5, 1, 999);
      g.onPlayerWasted();
    }
  }

  knockdown(ix: number, iz: number, up: number, duration: number) {
    if (this.vehicle) return;
    this.knockT = duration;
    this.knockDur = duration;
    this.vel.set(ix, up, iz);
    this.grounded = false;
    this.mantle = null;
    if (Math.hypot(ix, iz) > 0.1) this.yaw = Math.atan2(-ix, -iz);
    this.action = 'none';
  }

  // ---------------- vehicles ----------------
  enterVehicle(v: Vehicle, g: Game) {
    if (v.driver === 'player') return;
    if (v.npcDriver) {
      g.peds.ejectDriver(v, this);
      v.npcDriver = false;
      g.wanted.crime('carjack', v.pos.x, v.pos.z);
      g.progress.stat('carsStolen', 1);
    } else if (v.spec.police) {
      g.wanted.crime('policeCar', v.pos.x, v.pos.z);
    } else if (!v.ownedByPlayer && !v.wasStolen && !v.missionTag) {
      g.progress.stat('carsStolen', 1);
    }
    if (v.ai) {
      g.police.releaseUnit(v);
      v.ai = null;
    }
    v.wasStolen = true;
    v.driver = 'player';
    v.rig.driverDummy.visible = false;
    this.vehicle = v;
    this.lastVehicle = v;
    this.inVehicle = true;
    this.swimming = false;
    this.action = 'none';
    this.aiming = false;
    this.model.root.removeFromParent();
    v.rig.body.add(this.model.root);
    this.model.root.position.copy(v.rig.seat);
    this.model.root.rotation.set(0, 0, 0);
    this.model.setWeapon('none');
    v.persistent = true;
    g.audio.door(v.pos);
    g.cam.onEnterVehicle();
    g.progress.achieve('first_wheels');
    g.onPlayerEnteredVehicle(v);
  }

  exitVehicle(g: Game, force = false) {
    const v = this.vehicle;
    if (!v) return;
    const fast = v.speed > 9 && !force && !v.spec.boat;
    v.driver = null;
    v.sirenOn = false;
    this.vehicle = null;
    this.inVehicle = false;
    this.model.root.removeFromParent();
    g.scene.add(this.model.root);
    this.model.setWeapon(WEAPONS[this.weapon].visual);
    const lx = Math.cos(v.yaw),
      lz = -Math.sin(v.yaw);
    const side = v.spec.wid / 2 + 0.7;
    const candidates = [
      [v.pos.x + lx * side, v.pos.z + lz * side],
      [v.pos.x - lx * side, v.pos.z - lz * side],
      [v.pos.x - Math.sin(v.yaw) * (v.spec.len / 2 + 0.8), v.pos.z - Math.cos(v.yaw) * (v.spec.len / 2 + 0.8)],
    ];
    let px = candidates[0][0],
      pz = candidates[0][1];
    for (const [cx, cz] of candidates) {
      const p = { x: cx, z: cz };
      const r = g.col.pushCircle(p, 0.35, v.pos.y + 0.1, v.pos.y + 1.8, 0.45);
      if (!r.hit || r.pen < 0.2) {
        px = cx;
        pz = cz;
        break;
      }
    }
    if (v.spec.boat) {
      px = v.pos.x + lx * side;
      pz = v.pos.z + lz * side;
    }
    this.pos.set(px, Math.max(v.pos.y + 0.2, g.col.surfaceY(px, pz, v.pos.y + 1.5, 0.5)), pz);
    this.yaw = v.yaw;
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.fallStartY = this.pos.y;
    if (fast) {
      this.vel.set(v.vel.x * 0.6 + lx * 3, 2, v.vel.z * 0.6 + lz * 3);
      this.knockdown(this.vel.x, this.vel.z, 2.5, 1.6);
      this.takeDamage(Math.min(40, v.speed * 0.8), v.pos.x, v.pos.z, 'fall', null, g);
    }
    g.audio.door(v.pos);
    g.cam.onExitVehicle();
    g.onPlayerExitedVehicle(v);
  }

  // ---------------- main update ----------------
  update(dt: number, g: Game) {
    const inp = g.input;
    const controls = g.controlsEnabled();
    this.fireCD -= dt;
    this.invulnT -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.finishReload();
    }
    // health regen up to 40%
    if (this.alive && g.time - this.lastDamageT > 8 && this.health < this.maxHealth * 0.4) this.health = Math.min(this.maxHealth * 0.4, this.health + dt * 3);

    if (this.vehicle) {
      this.updateInVehicle(dt, g, controls);
      return;
    }
    const camYaw = g.cam.yaw;
    let mf = 0,
      ms = 0;
    if (controls && this.alive && this.knockT <= 0) {
      mf = inp.axis('KeyS', 'KeyW');
      ms = inp.axis('KeyA', 'KeyD');
      if (inp.hit('KeyX')) this.walkMode = !this.walkMode;
    }
    const fwx = Math.sin(camYaw),
      fwz = Math.cos(camYaw);
    const rtx = -Math.cos(camYaw),
      rtz = Math.sin(camYaw);
    let dx = fwx * mf + rtx * ms,
      dz = fwz * mf + rtz * ms;
    const dl = Math.hypot(dx, dz);
    if (dl > 0) {
      dx /= dl;
      dz /= dl;
    }
    const wd = this.weaponDef;
    this.aiming = controls && this.alive && !wd.melee && inp.mouse(2) && !this.swimming && this.knockT <= 0;
    this.blocking = controls && this.alive && wd.melee && inp.mouse(2) && this.grounded && !this.swimming && this.knockT <= 0;
    const sprinting = controls && inp.down('ShiftLeft') && dl > 0 && this.stamina > 1 && !this.aiming && !this.blocking;
    let maxSp = this.walkMode ? 1.8 : 4.6;
    if (sprinting) maxSp = 7.6;
    maxSp *= this.def.speed;
    if (this.aiming) maxSp = Math.min(maxSp, 2.6);
    if (this.blocking) maxSp = 1.2;
    if (this.swimming) maxSp = sprinting ? 3.8 : 2.3;
    if (this.action === 'punch' || this.action === 'swing') maxSp *= 0.35;
    if (sprinting) {
      this.stamina = Math.max(0, this.stamina - dt * (this.swimming ? 16 : 11) / this.def.stamina);
    } else this.stamina = Math.min(100, this.stamina + dt * 16);

    // mantle animation
    if (this.mantle) {
      const m = this.mantle;
      m.t += dt / 0.38;
      const t = Math.min(1, m.t);
      const up = Math.min(1, t * 1.6);
      this.pos.set(m.fx + (m.tx - m.fx) * t, m.fy + (m.ty - m.fy) * up, m.fz + (m.tz - m.fz) * t);
      this.anim.landing = 0.8 * (1 - t);
      if (m.t >= 1) {
        this.mantle = null;
        this.grounded = true;
        this.swimming = false;
        this.vel.set(0, 0, 0);
        this.fallStartY = this.pos.y;
      }
      this.syncModel(dt, 2);
      return;
    }

    // knockdown / ragdoll-like slide
    if (this.knockT > 0) {
      this.knockT -= dt;
      this.knockAmt = Math.min(1, this.knockAmt + dt * 5);
      if (this.knockT < 0.6 && this.alive) this.knockAmt = Math.max(0, this.knockT / 0.6);
      this.vel.x *= 1 - Math.min(1, dt * (this.grounded ? 4 : 0.3));
      this.vel.z *= 1 - Math.min(1, dt * (this.grounded ? 4 : 0.3));
      dx = 0;
      dz = 0;
    } else this.knockAmt = Math.max(0, this.knockAmt - dt * 3);

    // horizontal velocity
    const accel = this.grounded || this.swimming ? 16 : 3;
    const tvx = dx * maxSp,
      tvz = dz * maxSp;
    if (this.knockT <= 0 && this.action !== 'dodge') {
      this.vel.x = damp(this.vel.x, tvx, accel, dt);
      this.vel.z = damp(this.vel.z, tvz, accel, dt);
    }
    // facing
    if (this.aiming || (this.blocking && dl === 0)) this.yaw = dampAngle(this.yaw, camYaw, 20, dt);
    else if (dl > 0 && this.knockT <= 0 && this.action !== 'dodge') this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 11, dt);

    // jump / dodge
    if (controls && this.alive && this.knockT <= 0) {
      if (inp.hit('Space')) {
        if (this.swimming || !this.tryMantle(g, true)) {
          if (this.grounded && !this.swimming) {
            this.vel.y = 7.4;
            this.grounded = false;
            this.fallStartY = this.pos.y;
            g.audio.footstep(this.pos, 0.6);
          }
        }
      }
      if (inp.hit('KeyQ') && this.grounded && !this.swimming && this.stamina > 15 && this.action !== 'dodge') {
        this.action = 'dodge';
        this.actionT = 0;
        this.invulnT = 0.42;
        this.stamina -= 15;
        const ddx = dl > 0 ? dx : Math.sin(this.yaw),
          ddz = dl > 0 ? dz : Math.cos(this.yaw);
        this.yaw = Math.atan2(ddx, ddz);
        this.vel.x = ddx * 7.5;
        this.vel.z = ddz * 7.5;
      }
      this.handleCombatInput(dt, g);
      if (inp.hit('KeyF')) this.tryEnterVehicle(g);
      if (inp.hit('KeyH') && this.medkits > 0 && this.health < this.maxHealth) {
        this.medkits--;
        this.health = Math.min(this.maxHealth, this.health + 60);
        g.ui.notify('Used a Med Kit (+60 HP)', 'good');
        g.audio.pickup();
      }
    }
    if (this.action !== 'none') {
      this.actionT += dt;
      const dur = this.action === 'punch' ? 0.36 : this.action === 'swing' ? 0.6 : this.action === 'dodge' ? 0.55 : this.action === 'hit' ? 0.3 : this.action === 'interact' ? 0.6 : 0.5;
      if (this.action === 'dodge') {
        this.vel.x *= 1 - dt * 1.5;
        this.vel.z *= 1 - dt * 1.5;
      }
      if (!this.hitDone && (this.action === 'punch' || this.action === 'swing') && this.actionT > (this.action === 'punch' ? 0.11 : 0.24)) {
        this.hitDone = true;
        g.combat.meleeAttack(this, this.weaponDef, this.def.melee);
      }
      if (this.actionT > dur) this.action = 'none';
    }

    // gravity & swimming
    if (this.swimming) {
      this.vel.y = 0;
      this.pos.y = damp(this.pos.y, WATER_Y, 6, dt);
    } else this.vel.y -= GRAVITY * dt;
    const ox = this.pos.x,
      oz = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.swimming ? 0 : this.vel.y * dt;

    // collisions (walls)
    const res = g.col.pushCircle(this.pos, this.radius, this.pos.y, this.pos.y + this.height, 0.45);
    const hitWall = res.hit;
    const wallBox = res.box;
    g.props.pushCharacter(this.pos, this.radius, this.pos.y);
    g.vehicles.pushCharacter(this.pos, this.radius, this.pos.y);
    const ry = g.col.rampY(this.pos.x, this.pos.z);
    if (ry > this.pos.y + 0.5) {
      this.pos.x = ox;
      this.pos.z = oz;
    }
    // auto-mantle when running into low ledges while airborne
    if (hitWall && wallBox && !this.grounded && controls && dl > 0 && inp.down('Space')) this.tryMantle(g, false);

    // ground
    const step = this.grounded ? 0.5 : 0.15;
    const gY = g.col.surfaceY(this.pos.x, this.pos.z, this.pos.y, step);
    if (!this.swimming) {
      if (this.grounded && this.vel.y <= 0.01) {
        if (gY >= this.pos.y - 0.55) {
          this.pos.y = damp(this.pos.y, gY, 30, dt);
          if (Math.abs(this.pos.y - gY) < 0.02) this.pos.y = gY;
          this.vel.y = 0;
        } else {
          this.grounded = false;
          this.fallStartY = this.pos.y;
        }
      } else if (this.pos.y <= gY && this.vel.y <= 0) {
        // landing
        const fall = this.fallStartY - gY;
        this.pos.y = gY;
        const impact = -this.vel.y;
        this.vel.y = 0;
        this.grounded = true;
        this.landingT = clamp(impact / 14, 0, 1);
        if (fall > 4.5 && this.knockT <= 0) {
          const dmg = (fall - 4.5) * 11;
          this.takeDamage(dmg, this.pos.x, this.pos.z, 'fall', null, g);
          if (fall > 8 && this.alive) this.knockdown(0, 0, 0, 1.3);
          g.audio.thud(this.pos, 0.8);
        } else if (impact > 4) g.audio.footstep(this.pos, 1);
        this.fallStartY = gY;
      } else if (this.pos.y > gY + 0.05) this.grounded = false;
      if (!this.grounded && this.vel.y > 0) this.fallStartY = Math.max(this.fallStartY, this.pos.y);
      if (!this.grounded) this.fallStartY = Math.max(this.fallStartY, this.pos.y);
    }
    // ceiling
    const ceil = g.col.ceilingAt(this.pos.x, this.pos.z, this.pos.y + 0.5);
    if (this.pos.y + this.height > ceil && this.vel.y > 0) this.vel.y = 0;

    // water
    const ty = terrainY(this.pos.x, this.pos.z);
    if (!this.swimming && ty < WATER_Y - 1.3 && this.pos.y < WATER_Y - 1.1 && gY < WATER_Y - 1.1) {
      this.swimming = true;
      this.grounded = false;
      this.knockT = 0;
      g.fx.splash(this.pos, 1.2);
      g.audio.splash(this.pos, 0.7);
    } else if (this.swimming) {
      const floor = g.col.surfaceY(this.pos.x, this.pos.z, WATER_Y, 0.2);
      if (floor > WATER_Y - 1.25) {
        this.swimming = false;
        this.pos.y = Math.max(floor, this.pos.y - 1.0);
        this.grounded = true;
      }
      if (Math.hypot(this.vel.x, this.vel.z) > 0.5) this.swimDist += Math.hypot(this.vel.x, this.vel.z) * dt;
    }
    this.speedNow = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && this.speedNow > 0.5) g.progress.addDistance('walk', this.speedNow * dt);
    if (this.swimming && this.speedNow > 0.3) g.progress.addDistance('swim', this.speedNow * dt);
    this.landingT = Math.max(0, this.landingT - dt * 4);
    this.syncModel(dt, this.speedNow);
  }

  private tryMantle(g: Game, fromJumpPress: boolean) {
    const fx = Math.sin(this.yaw),
      fz = Math.cos(this.yaw);
    const reach = 0.75;
    const px = this.pos.x + fx * reach,
      pz = this.pos.z + fz * reach;
    const baseY = this.swimming ? WATER_Y - 0.6 : this.pos.y;
    const top = g.col.surfaceY(px, pz, baseY, 2.4);
    const rise = top - baseY;
    if (rise < 0.6 || rise > 2.4) return false;
    // landing spot must be free of walls above top
    const tx = px + fx * 0.35,
      tz = pz + fz * 0.35;
    const tTop = g.col.surfaceY(tx, tz, top, 0.3);
    if (Math.abs(tTop - top) > 0.3) return false;
    const ceiling = g.col.ceilingAt(tx, tz, top + 0.1);
    if (ceiling < top + 1.8) return false;
    void fromJumpPress;
    this.mantle = { fx: this.pos.x, fy: this.pos.y, fz: this.pos.z, tx, ty: top, tz, t: 0 };
    this.vel.set(0, 0, 0);
    this.action = 'none';
    g.audio.footstep(this.pos, 0.8);
    return true;
  }

  private tryEnterVehicle(g: Game) {
    const v = g.vehicles.nearestEnterable(this.pos, 4.2);
    if (v) this.enterVehicle(v, g);
  }

  private handleCombatInput(dt: number, g: Game) {
    const inp = g.input;
    for (const w of WEAPON_ORDER) {
      const def = WEAPONS[w];
      if (inp.hit(`Digit${def.slot}`) && this.inv[w].owned) this.switchWeapon(w);
    }
    if (this.swimming) return;
    const wd = this.weaponDef;
    if (inp.hit('KeyR') && !wd.melee) this.startReload(g);
    if (wd.melee) {
      if (inp.mouseHit(0) && (this.action === 'none' || (this.action === 'punch' && this.actionT > 0.22))) {
        this.action = wd.id === 'bat' ? 'swing' : 'punch';
        this.actionSide = -this.actionSide;
        this.actionT = 0;
        this.hitDone = false;
        g.audio.whoosh(this.pos);
        // soft-lock: face nearest target in front
        const t = g.combat.findMeleeTarget(this, 3.5);
        if (t) this.yaw = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
      }
    } else if ((wd.id === 'smg' ? inp.mouse(0) : inp.mouseHit(0)) && this.fireCD <= 0 && this.reloadT <= 0 && this.action !== 'dodge') {
      const slot = this.inv[wd.id];
      if (slot.clip <= 0) {
        if (slot.ammo > 0) this.startReload(g);
        else {
          g.audio.click();
          g.ui.notify('Out of ammo', 'warn');
          this.fireCD = 0.4;
        }
        return;
      }
      slot.clip--;
      this.fireCD = wd.rate;
      if (!this.aiming) this.yaw = g.cam.yaw;
      g.combat.playerFire(this, wd);
      if (slot.clip <= 0 && slot.ammo > 0) this.startReload(g);
    }
  }

  switchWeapon(w: WeaponId) {
    if (w === this.weapon) return;
    this.weapon = w;
    this.reloadT = 0;
    this.model.setWeapon(WEAPONS[w].visual);
  }

  cycleWeapon(dir: number) {
    const owned = WEAPON_ORDER.filter((w) => this.inv[w].owned);
    const i = owned.indexOf(this.weapon);
    this.switchWeapon(owned[(i + dir + owned.length) % owned.length]);
  }

  private startReload(g: Game) {
    const wd = this.weaponDef;
    const slot = this.inv[wd.id];
    if (this.reloadT > 0 || slot.ammo <= 0 || slot.clip >= wd.clip) return;
    this.reloadT = wd.id === 'shotgun' ? 1.6 : 1.1;
    g.audio.reload();
  }
  private finishReload() {
    const wd = this.weaponDef;
    const slot = this.inv[wd.id];
    const need = wd.clip - slot.clip;
    const take = Math.min(need, slot.ammo);
    slot.clip += take;
    slot.ammo -= take;
  }

  giveWeapon(w: WeaponId, ammo: number) {
    const s = this.inv[w];
    const first = !s.owned;
    s.owned = true;
    const def = WEAPONS[w];
    if (!def.melee) {
      if (first) {
        s.clip = Math.min(def.clip, ammo);
        s.ammo += ammo - s.clip;
      } else s.ammo += ammo;
    }
    if (first) this.switchWeapon(w);
  }

  private updateInVehicle(dt: number, g: Game, controls: boolean) {
    const v = this.vehicle!;
    const inp = g.input;
    const vi = v.input;
    if (controls && this.alive && g.freezeVehicle) {
      vi.throttle = 0;
      vi.brake = 1;
      vi.steer = 0;
      vi.handbrake = true;
    } else if (controls && this.alive) {
      vi.throttle = inp.down('KeyW') || inp.down('ArrowUp') ? 1 : 0;
      vi.brake = inp.down('KeyS') || inp.down('ArrowDown') ? 1 : 0;
      vi.steer = (inp.down('KeyD') || inp.down('ArrowRight') ? 1 : 0) - (inp.down('KeyA') || inp.down('ArrowLeft') ? 1 : 0);
      vi.handbrake = inp.down('Space');
      vi.boost = inp.down('ShiftLeft') || inp.down('ShiftRight');
      if (inp.hit('KeyH')) g.audio.horn(v.pos, true);
      if (inp.hit('KeyL') && v.spec.police) v.sirenOn = !v.sirenOn;
      if (inp.hit('KeyR')) g.audio.nextStation();
      if (inp.hit('KeyF')) {
        this.exitVehicle(g);
        return;
      }
    } else {
      vi.throttle = 0;
      vi.brake = 0.5;
      vi.steer = 0;
      vi.handbrake = !this.alive;
    }
    // follow the seat for focus/collision purposes
    this.pos.copy(v.pos);
    this.pos.y += 0.5;
    this.vel.copy(v.vel);
    this.yaw = v.yaw;
    if (v.submerged && v.submergedT > 1.5 && !v.spec.boat) {
      this.exitVehicle(g, true);
      this.pos.y = WATER_Y - 1.2;
      g.ui.notify('Your vehicle is sinking!', 'warn');
      return;
    }
    const kmh = v.speed * 3.6;
    g.progress.maxSpeed(kmh);
    if (v.grounded) g.progress.addDistance('drive', v.speed * dt);
    this.anim.driving = true;
    this.anim.speed = 0;
    this.anim.action = 'none';
    this.model.update(dt, this.anim);
  }

  private syncModel(dt: number, speed: number) {
    const a = this.anim;
    a.driving = false;
    a.speed = this.knockT > 0 ? 0 : speed;
    a.grounded = this.grounded || this.mantle !== null;
    a.vy = this.vel.y;
    a.swim = this.swimming;
    a.action = this.aiming ? 'aim' : this.blocking ? 'block' : this.reloadT > 0 ? 'interact' : this.action;
    a.actionT = this.actionT;
    a.actionSide = this.actionSide;
    a.aimPitch = this.aimPitch;
    a.knocked = this.knockAmt;
    a.landing = Math.max(this.landingT, this.mantle ? 0.6 : 0);
    a.twoHanded = this.weaponDef.twoHanded;
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.set(0, this.yaw, 0);
    this.model.update(dt, a);
  }

  syncAimPitch(camPitch: number) {
    this.aimPitch = clamp(camPitch, -1.0, 1.0);
  }

  wrapYaw() {
    this.yaw = wrapAngle(this.yaw);
  }
}
