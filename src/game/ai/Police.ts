import * as THREE from 'three';
import { ROAD_HALF } from '../constants';
import { clamp, damp, dampAngle } from '../core/math';
import type { Game } from '../Game';
import { policeLook } from '../characters/CharacterModel';
import { AIDriver } from '../vehicles/AIDriver';
import type { Vehicle } from '../vehicles/Vehicle';
import { Ped } from './Pedestrian';

interface Unit {
  id: number;
  vehicle: Vehicle;
  crew: Ped[];
  crewSize: number;
  swat: boolean;
  state: 'pursuit' | 'deployed' | 'roadblock' | 'leave';
  t: number;
}

interface Heli {
  group: THREE.Group;
  rotor: THREE.Object3D;
  tail: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  light: THREE.SpotLight;
  cone: THREE.Mesh;
  fireCD: number;
  leaving: boolean;
  health: number;
}

const UNITS_BY_LEVEL = [0, 2, 3, 5, 7, 9, 12];
let UNIT_ID = 1;

export class PoliceManager {
  units: Unit[] = [];
  officers: Ped[] = [];
  helis: Heli[] = [];
  playerSeen = false;
  private seeT = 0;
  private spawnT = 0;
  private roadblockT = 15;
  private arrestT = 0;
  private patrolT = 0;

  private spotPool: THREE.SpotLight[] = [];

  constructor(private g: Game) {
    for (let i = 0; i < 2; i++) {
      const l = new THREE.SpotLight(0xe8f0ff, 0, 160, 0.22, 0.45, 1);
      g.scene.add(l, l.target);
      this.spotPool.push(l);
    }
  }

  /** can any police unit witness a crime at (x,z)? */
  canWitness(x: number, z: number) {
    const g = this.g;
    for (const v of g.vehicles.list) {
      if (!v.spec.police || v.driver !== 'ai' || v.destroyed) continue;
      const d = Math.hypot(v.pos.x - x, v.pos.z - z);
      if (d < 60 && g.col.los(v.pos.x, v.pos.y + 1.4, v.pos.z, x, g.player.pos.y + 1.2, z)) return true;
    }
    for (const o of this.officers) {
      if (!o.alive || o.knockT > 0) continue;
      const d = Math.hypot(o.pos.x - x, o.pos.z - z);
      if (d < 50 && g.col.los(o.pos.x, o.pos.y + 1.6, o.pos.z, x, g.player.pos.y + 1.2, z)) return true;
    }
    return false;
  }

  private computeSeen() {
    const g = this.g;
    const p = g.player;
    const py = p.pos.y + 1.2;
    const changedCar = g.wanted.playerVehicleWhenSeen !== (p.vehicle ? p.vehicle.id : null) && g.wanted.seenT > 2;
    const range = changedCar ? 30 : p.vehicle ? 120 : 85;
    for (const u of this.units) {
      const v = u.vehicle;
      if (v.destroyed || v.driver !== 'ai') continue;
      const d = Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z);
      if (d < range && g.col.los(v.pos.x, v.pos.y + 1.5, v.pos.z, p.pos.x, py, p.pos.z)) return true;
    }
    for (const o of this.officers) {
      if (!o.alive || o.knockT > 0) continue;
      const d = Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z);
      if (d < range * 0.8 && g.col.los(o.pos.x, o.pos.y + 1.6, o.pos.z, p.pos.x, py, p.pos.z)) return true;
    }
    for (const h of this.helis) {
      if (h.leaving) continue;
      const d = Math.hypot(h.pos.x - p.pos.x, h.pos.z - p.pos.z);
      if (d < 170 && g.col.los(h.pos.x, h.pos.y - 2, h.pos.z, p.pos.x, py, p.pos.z)) return true;
    }
    return false;
  }

  releaseUnit(v: Vehicle) {
    const i = this.units.findIndex((u) => u.vehicle === v);
    if (i >= 0) this.units.splice(i, 1);
  }

  standDown() {
    for (const u of this.units) {
      u.state = 'leave';
      u.vehicle.sirenOn = false;
      if (u.vehicle.ai) {
        u.vehicle.ai.mode = 'goto';
        const n = this.g.layout.nodes[Math.floor(Math.random() * this.g.layout.nodes.length)];
        u.vehicle.ai.target = { x: n.x, z: n.z };
      }
    }
    for (const h of this.helis) h.leaving = true;
  }

  private spawnUnit(swat: boolean, roadblock = false, at?: { x: number; z: number; yaw: number }) {
    const g = this.g;
    let x: number, z: number, yaw: number;
    if (at) {
      x = at.x;
      z = at.z;
      yaw = at.yaw;
    } else {
      const p = g.player;
      const cand = g.layout.nodes.filter((n) => {
        const d = Math.hypot(n.x - p.pos.x, n.z - p.pos.z);
        return d > 130 && d < 230;
      });
      if (!cand.length) return null;
      // prefer nodes that are not in front of the camera
      cand.sort(() => Math.random() - 0.5);
      const fwd = new THREE.Vector3();
      g.camera.getWorldDirection(fwd);
      const n = cand.find((c) => (c.x - p.pos.x) * fwd.x + (c.z - p.pos.z) * fwd.z < 0) ?? cand[0];
      x = n.x + 4;
      z = n.z + 4;
      yaw = Math.atan2(p.pos.x - n.x, p.pos.z - n.z);
    }
    const v = g.vehicles.spawn(swat ? 'bulwark' : 'interceptor', x, z, yaw);
    if (!v) return null;
    v.driver = 'ai';
    v.npcDriver = true;
    v.rig.driverDummy.visible = true;
    v.persistent = false;
    const ai = new AIDriver(v);
    ai.mode = roadblock ? 'idle' : 'pursuit';
    ai.skill = 0.82 + g.wanted.level * 0.04;
    ai.aggressive = g.wanted.level >= 3;
    v.ai = ai;
    v.sirenOn = true;
    const u: Unit = { id: UNIT_ID++, vehicle: v, crew: [], crewSize: swat ? 3 : 2, swat, state: roadblock ? 'roadblock' : 'pursuit', t: 0 };
    this.units.push(u);
    return u;
  }

  private deploy(u: Unit) {
    const g = this.g;
    const v = u.vehicle;
    u.state = 'deployed';
    v.ai!.mode = 'idle';
    for (let i = 0; i < u.crewSize; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const lx = Math.cos(v.yaw) * side,
        lz = -Math.sin(v.yaw) * side;
      const back = (i >> 1) * -1.5;
      const o = g.peds.spawnPed(policeLook(u.swat), u.swat ? 'swat' : 'police', v.pos.x + lx * (v.spec.wid / 2 + 0.6) + Math.sin(v.yaw) * back, v.pos.z + lz * (v.spec.wid / 2 + 0.6) + Math.cos(v.yaw) * back, v.yaw);
      o.state = 'police';
      o.setWeapon(u.swat ? 'smg' : g.wanted.level >= 2 ? 'pistol' : 'fists');
      o.accuracy = clamp(0.12 + g.wanted.level * 0.07, 0, 0.6);
      o.fireCD = 1.2 + Math.random();
      o.unitId = u.id;
      u.crew.push(o);
      this.officers.push(o);
    }
    if (v.npcDriver) {
      v.npcDriver = false;
      v.rig.driverDummy.visible = false;
    }
  }

  private recall(u: Unit) {
    // crew walks back; once near (or off-screen) they get in
    let allIn = true;
    for (const o of u.crew) {
      if (!o.alive) continue;
      const d = Math.hypot(o.pos.x - u.vehicle.pos.x, o.pos.z - u.vehicle.pos.z);
      if (d < 3.5 || d > 60) {
        this.removeOfficer(o);
      } else {
        allIn = false;
        o.target = { x: u.vehicle.pos.x, z: u.vehicle.pos.z };
      }
    }
    u.crew = u.crew.filter((o) => this.officers.includes(o) && o.alive);
    if (allIn) {
      u.state = 'pursuit';
      u.vehicle.ai!.mode = 'pursuit';
      u.vehicle.npcDriver = true;
      u.vehicle.rig.driverDummy.visible = true;
      u.vehicle.driver = 'ai';
    }
  }

  private removeOfficer(o: Ped) {
    const i = this.officers.indexOf(o);
    if (i >= 0) this.officers.splice(i, 1);
    this.g.peds.remove(o);
  }

  private spawnRoadblock() {
    const g = this.g;
    const p = g.player;
    const v = p.vehicle;
    if (!v || v.speed < 8) return;
    const dirx = v.vel.x / v.speed,
      dirz = v.vel.z / v.speed;
    let best = null as null | { x: number; z: number },
      bs = -1;
    for (const n of g.layout.nodes) {
      const dx = n.x - p.pos.x,
        dz = n.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 130 || d > 240) continue;
      const align = (dx * dirx + dz * dirz) / d;
      if (align > 0.9 && align > bs) {
        bs = align;
        best = n;
      }
    }
    if (!best) return;
    // block the road the player is approaching on
    const horizontal = Math.abs(dirx) > Math.abs(dirz);
    const bx = best.x - (horizontal ? Math.sign(dirx) * (ROAD_HALF + 4) : 0);
    const bz = best.z - (horizontal ? 0 : Math.sign(dirz) * (ROAD_HALF + 4));
    const yaw = horizontal ? 0 : Math.PI / 2;
    for (const off of [-3.2, 3.2]) {
      const x = bx + (horizontal ? 0 : off),
        z = bz + (horizontal ? off : 0);
      const u = this.spawnUnit(g.wanted.level >= 4, true, { x, z, yaw: yaw + (off > 0 ? 0.25 : -0.25) });
      if (u) this.deploy(u);
    }
    g.ui.notify('Police roadblock ahead!', 'warn');
  }

  private spawnHeli() {
    const g = this.g;
    const grp = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a2a4a, roughness: 0.4, metalness: 0.5 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 10).scale(1, 0.85, 1.7), bodyMat);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 6, 8).rotateX(Math.PI / 2), bodyMat);
    tail.position.set(0, 0.3, -4.5);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.8), bodyMat);
    fin.position.set(0, 0.9, -7.2);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(1.25, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2.3), new THREE.MeshStandardMaterial({ color: 0x0a1820, roughness: 0.1, metalness: 0.6 }));
    glass.position.set(0, 0.25, 1.4);
    const rotor = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(11, 0.06, 0.35), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    const blade2 = blade.clone();
    blade2.rotation.y = Math.PI / 2;
    rotor.add(blade, blade2);
    rotor.position.y = 1.6;
    const tr = new THREE.Group();
    tr.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.6, 0.18), new THREE.MeshStandardMaterial({ color: 0x111111 })));
    tr.position.set(0.25, 0.9, -7.2);
    const skidMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    for (const s of [-1, 1]) {
      const sk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 3.2), skidMat);
      sk.position.set(s * 1.1, -1.5, 0);
      grp.add(sk);
    }
    const lightbar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.2), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }));
    lightbar.position.set(0, -1.2, 1.2);
    grp.add(body, tail, fin, glass, rotor, tr, lightbar);
    const light = this.spotPool[this.helis.length % this.spotPool.length];
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(9, 45, 16, 1, true).translate(0, -22.5, 0),
      new THREE.MeshBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    grp.add(cone);
    const p = g.player.pos;
    const a = Math.random() * Math.PI * 2;
    const pos = new THREE.Vector3(p.x + Math.cos(a) * 250, 60, p.z + Math.sin(a) * 250);
    grp.position.copy(pos);
    g.scene.add(grp);
    this.helis.push({ group: grp, rotor, tail: tr, pos, vel: new THREE.Vector3(), light, cone, fireCD: 3, leaving: false, health: 600 });
    g.ui.notify('Police helicopter inbound!', 'bad');
  }

  private updateHelis(dt: number) {
    const g = this.g;
    const p = g.player;
    const tp = p.vehicle ? p.vehicle.pos : p.pos;
    for (let i = this.helis.length - 1; i >= 0; i--) {
      const h = this.helis[i];
      h.rotor.rotation.y += dt * 28;
      h.tail.rotation.x += dt * 40;
      let goal: THREE.Vector3;
      if (h.leaving) goal = new THREE.Vector3(h.pos.x + (h.pos.x - tp.x), 120, h.pos.z + (h.pos.z - tp.z));
      else {
        const a = g.time * 0.25 + i * Math.PI;
        goal = new THREE.Vector3(tp.x + Math.cos(a) * 28, 46 + i * 8, tp.z + Math.sin(a) * 28);
      }
      const dx = goal.x - h.pos.x,
        dy = goal.y - h.pos.y,
        dz = goal.z - h.pos.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const sp = Math.min(32, d * 1.2);
      h.vel.x = damp(h.vel.x, (dx / d) * sp, 1.5, dt);
      h.vel.y = damp(h.vel.y, (dy / d) * sp, 1.5, dt);
      h.vel.z = damp(h.vel.z, (dz / d) * sp, 1.5, dt);
      h.pos.addScaledVector(h.vel, dt);
      h.group.position.copy(h.pos);
      const look = Math.atan2(tp.x - h.pos.x, tp.z - h.pos.z);
      h.group.rotation.y = dampAngle(h.group.rotation.y, look, 2, dt);
      h.group.rotation.x = clamp(Math.hypot(h.vel.x, h.vel.z) * 0.012, 0, 0.3);
      // spotlight aims at the player
      const night = g.env.night;
      h.light.intensity = night > 0.3 && !h.leaving ? 400 * night : 0;
      h.light.position.set(h.pos.x, h.pos.y - 1.6, h.pos.z);
      h.light.target.position.set(tp.x, tp.y, tp.z);
      h.cone.visible = night > 0.3 && !h.leaving;
      const toT = new THREE.Vector3(tp.x - h.pos.x, tp.y - h.pos.y, tp.z - h.pos.z);
      h.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), toT.clone().normalize());
      h.cone.quaternion.premultiply(h.group.quaternion.clone().invert());
      h.cone.scale.setScalar(toT.length() / 45);
      if (!h.leaving && g.wanted.level >= 6) {
        h.fireCD -= dt;
        if (h.fireCD <= 0 && g.col.los(h.pos.x, h.pos.y - 2, h.pos.z, tp.x, tp.y + 1, tp.z)) {
          h.fireCD = 0.25;
          const fake = { pos: h.pos.clone().setY(h.pos.y - 3.4), yaw: look } as unknown as Ped;
          g.combat.npcFire(fake, tp.x, tp.y + 1, tp.z, 0.45, 9);
        }
      }
      if (h.leaving && Math.hypot(h.pos.x - tp.x, h.pos.z - tp.z) > 400) {
        h.group.removeFromParent();
        h.light.intensity = 0;
        this.helis.splice(i, 1);
      }
    }
  }

  updateOfficer(o: Ped, dt: number, pd: number) {
    const g = this.g;
    const p = g.player;
    const level = g.wanted.level;
    const unit = this.units.find((u) => u.id === o.unitId);
    if (level === 0 || (unit && unit.state === 'pursuit')) {
      // walk back to the car or idle
      if (o.target) {
        const dx = o.target.x - o.pos.x,
          dz = o.target.z - o.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 1) {
          o.vel.x = damp(o.vel.x, (dx / d) * 3.5, 6, dt);
          o.vel.z = damp(o.vel.z, (dz / d) * 3.5, 6, dt);
          o.yaw = dampAngle(o.yaw, Math.atan2(dx, dz), 8, dt);
        }
      } else {
        o.vel.x = damp(o.vel.x, 0, 6, dt);
        o.vel.z = damp(o.vel.z, 0, 6, dt);
      }
      return;
    }
    const tp = p.vehicle ? p.vehicle.pos : p.pos;
    const dx = tp.x - o.pos.x,
      dz = tp.z - o.pos.z;
    const face = Math.atan2(dx, dz);
    const armed = o.weapon !== 'fists';
    const los = pd < 60 && g.col.los(o.pos.x, o.pos.y + 1.6, o.pos.z, tp.x, tp.y + 1.2, tp.z);
    let speed = 0;
    if (!armed || (level === 1 && !p.vehicle)) {
      // close in to arrest
      speed = pd > 1.4 ? (pd > 6 ? 5.6 : 3) : 0;
      if (pd < 1.7 && !p.vehicle && p.alive && o.action === 'none') {
        if (p.speedNow < 2.2 || p.knockT > 0) {
          this.arrestT += dt;
          if (this.arrestT > 1.8) {
            this.arrestT = 0;
            g.onBusted();
          }
        } else if (o.fireCD <= 0) {
          o.action = 'punch';
          o.actionT = 0;
          o.fireCD = 1.1;
          o.hitDone = false;
        }
      }
    } else {
      const want = o.role === 'swat' ? 12 : 10;
      if (pd > want + 6 || !los) speed = 5.4;
      else if (pd < want - 5) speed = -2.5;
      if (los && o.fireCD <= 0 && pd < 50) {
        o.fireCD = o.role === 'swat' ? 0.35 + Math.random() * 0.5 : 1.0 + Math.random() * 1.0;
        g.combat.npcFire(o, tp.x, tp.y + 1.1, tp.z, o.accuracy, o.role === 'swat' ? 6 : 7);
      }
      if (pd < 1.8 && p.knockT > 0 && !p.vehicle) {
        this.arrestT += dt;
        if (this.arrestT > 1.2) {
          this.arrestT = 0;
          g.onBusted();
        }
      }
    }
    const d = Math.hypot(dx, dz) || 1;
    o.vel.x = damp(o.vel.x, (dx / d) * speed, 6, dt);
    o.vel.z = damp(o.vel.z, (dz / d) * speed, 6, dt);
    o.yaw = dampAngle(o.yaw, face, 9, dt);
  }

  update(dt: number) {
    const g = this.g;
    const level = g.wanted.level;
    const p = g.player;
    this.seeT -= dt;
    if (this.seeT <= 0) {
      this.seeT = 0.25;
      this.playerSeen = level > 0 && this.computeSeen();
    }
    if (this.arrestT > 0) this.arrestT = Math.max(0, this.arrestT - dt * 0.5);

    // keep a few patrol cars in traffic as roaming witnesses
    this.patrolT -= dt;
    if (this.patrolT <= 0) {
      this.patrolT = 5;
      const patrols = g.vehicles.list.filter((v) => v.spec.police && v.driver === 'ai' && v.ai?.mode === 'traffic').length;
      if (level === 0 && patrols < 2) g.traffic.spawnTraffic('interceptor');
    }

    if (level > 0) {
      // patrol cars nearby join the pursuit
      for (const v of g.vehicles.list) {
        if (v.spec.police && v.driver === 'ai' && v.ai && v.ai.mode === 'traffic' && v.pos.distanceTo(p.pos) < 160 && !this.units.some((u) => u.vehicle === v)) {
          v.ai.mode = 'pursuit';
          v.ai.skill = 0.85;
          v.sirenOn = true;
          this.units.push({ id: UNIT_ID++, vehicle: v, crew: [], crewSize: 2, swat: false, state: 'pursuit', t: 0 });
        }
      }
      const active = this.units.filter((u) => u.state !== 'leave' && u.state !== 'roadblock' && !u.vehicle.destroyed).length;
      this.spawnT -= dt;
      if (active < UNITS_BY_LEVEL[level] && this.spawnT <= 0) {
        this.spawnT = level >= 4 ? 2.5 : 4;
        const swat = level >= 4 && Math.random() < (level >= 6 ? 0.6 : 0.4);
        this.spawnUnit(swat);
      }
      if (level >= 3) {
        this.roadblockT -= dt;
        if (this.roadblockT <= 0) {
          this.roadblockT = level >= 5 ? 20 : 30;
          this.spawnRoadblock();
        }
      }
      const wantHelis = level >= 6 ? 2 : level >= 5 ? 1 : 0;
      if (this.helis.filter((h) => !h.leaving).length < wantHelis) this.spawnHeli();
    }

    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      const v = u.vehicle;
      u.t += dt;
      const d = v.pos.distanceTo(p.pos);
      if (!g.vehicles.list.includes(v)) {
        this.units.splice(i, 1);
        continue;
      }
      if (v.ai) {
        v.ai.aggressive = level >= 3;
        if (u.state === 'pursuit' && level > 0) {
          if (g.wanted.searching) {
            v.ai.mode = 'goto';
            if (!v.ai.target || Math.random() < dt * 0.15 || Math.hypot(v.ai.target.x - v.pos.x, v.ai.target.z - v.pos.z) < 12) {
              const r = g.wanted.searchRadius * 0.7;
              v.ai.target = { x: g.wanted.lastKnown.x + (Math.random() - 0.5) * r, z: g.wanted.lastKnown.z + (Math.random() - 0.5) * r };
            }
          } else v.ai.mode = 'pursuit';
          if (!p.vehicle && d < 18 && v.speed < 4 && !v.destroyed) this.deploy(u);
        }
      }
      if (u.state === 'deployed') {
        if (level === 0) this.recall(u);
        else if (p.vehicle && d > 30 && u.crewSize > 0 && !v.destroyed) this.recall(u);
        if (u.crew.every((o) => !o.alive) && u.crew.length > 0 && v.driver === 'ai') {
          v.npcDriver = false;
          v.driver = null;
        }
      }
      if (u.state === 'roadblock' && (level === 0 || d > 320)) u.state = 'leave';
      if (u.state === 'leave' || v.destroyed) {
        if (u.crew.length) this.recall(u);
        if ((d > 140 || v.destroyed) && !this.onScreen(v.pos)) {
          for (const o of u.crew) this.removeOfficer(o);
          if (v.driver !== 'player') g.vehicles.remove(v);
          this.units.splice(i, 1);
        }
      }
    }
    // stray officers (dead/unit gone)
    for (const o of [...this.officers]) {
      if (!o.alive && o.deadT > 20) this.removeOfficer(o);
      else if (level === 0 && !this.units.some((u) => u.id === o.unitId) && (o.pos.distanceTo(p.pos) > 100 || !this.onScreen(o.pos))) this.removeOfficer(o);
    }
    this.updateHelis(dt);
  }

  private onScreen(pos: THREE.Vector3) {
    const v = pos.clone().project(this.g.camera);
    return Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && v.z < 1;
  }

  clearAll() {
    for (const u of this.units) {
      for (const o of u.crew) this.removeOfficer(o);
      if (u.vehicle.driver !== 'player') this.g.vehicles.remove(u.vehicle);
    }
    this.units = [];
    for (const o of [...this.officers]) this.removeOfficer(o);
    for (const h of this.helis) {
      h.group.removeFromParent();
      h.light.intensity = 0;
    }
    this.helis = [];
  }
}
