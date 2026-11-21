import * as THREE from 'three';
import { BLOCKS, districtOf, locateBlock } from '../constants';
import type { Game } from '../Game';
import { Actor } from '../characters/Actor';
import { CharacterLook, randomLook } from '../characters/CharacterModel';
import type { Vehicle } from '../vehicles/Vehicle';
import { Ped, PedRole, ejectPosition, perimeterPoint } from './Pedestrian';

const _v = new THREE.Vector3();

export class PedManager {
  list: Ped[] = [];
  density = 1;
  private spawnT = 0;
  private frustum = new THREE.Frustum();
  private mat = new THREE.Matrix4();

  constructor(private g: Game) {}

  get targetCount() {
    const g = this.g;
    const n = g.env.night;
    let base = 62 * this.density;
    if (n > 0.6) base *= 0.6;
    if (g.env.rain > 0.5) base *= 0.6;
    const b = locateBlock(g.focus.x, g.focus.z);
    if (b) {
      const d = districtOf(b.bi, b.bj);
      if (d === 'downtown' || d === 'nightlife' || d === 'beachfront' || d === 'commercial') base *= 1.25;
      if (d === 'industrial' || d === 'lot') base *= 0.5;
      if (d === 'nightlife' && n > 0.5) base *= 1.8;
    } else base *= 0.3;
    return Math.round(base);
  }

  spawnPed(look: CharacterLook, role: PedRole, x: number, z: number, yaw = 0): Ped {
    const p = new Ped(look, role);
    p.pos.set(x, this.g.col.surfaceY(x, z, 100, 0), z);
    p.yaw = yaw;
    p.homeX = x;
    p.homeZ = z;
    this.g.scene.add(p.model.root);
    this.list.push(p);
    return p;
  }

  spawnMissionPed(look: CharacterLook, x: number, z: number, yaw: number, name: string, role: PedRole = 'mission') {
    const p = this.spawnPed(look, role, x, z, yaw);
    p.persistent = true;
    p.name = name;
    p.state = 'stand';
    p.timer = 1e9;
    if (role === 'mission') p.maxHealth = p.health = 200;
    return p;
  }

  remove(p: Ped) {
    p.dispose();
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
  }

  private trySpawnAmbient() {
    const g = this.g;
    const f = g.focus;
    for (let attempt = 0; attempt < 6; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 45 + Math.random() * 80;
      const x = f.x + Math.cos(ang) * dist,
        z = f.z + Math.sin(ang) * dist;
      const b = locateBlock(x, z);
      if (!b || b.bi < 0 || b.bj < 0 || b.bi >= BLOCKS || b.bj >= BLOCKS) continue;
      const s = Math.random() * 320;
      const pt = perimeterPoint(b.bi, b.bj, s);
      const dd = Math.hypot(pt.x - f.x, pt.z - f.z);
      if (dd < 40 || dd > 140) continue;
      _v.set(pt.x, 1, pt.z);
      if (this.frustum.containsPoint(_v) && dd < 80) continue;
      const district = districtOf(b.bi, b.bj);
      const gang = (district === 'industrial' || district === 'nightlife') && g.env.night > 0.5 && Math.random() < 0.2;
      const p = this.spawnPed(randomLook(gang), gang ? 'gang' : 'civ', pt.x, pt.z);
      p.bi = b.bi;
      p.bj = b.bj;
      p.s = s;
      p.dir = Math.random() < 0.5 ? 1 : -1;
      p.state = 'walk';
      if (gang && Math.random() < 0.4) p.setWeapon(Math.random() < 0.5 ? 'bat' : 'pistol');
      return;
    }
  }

  ejectDriver(v: Vehicle, by: Actor) {
    const e = ejectPosition(v);
    const p = this.spawnPed(randomLook(), 'civ', e.x, e.z, v.yaw + Math.PI / 2);
    p.knockdown(Math.cos(v.yaw) * 2, -Math.sin(v.yaw) * 2, 1.5, 1.4);
    p.threat.x = by.pos.x;
    p.threat.z = by.pos.z;
    p.aggroT = 20;
    if (Math.random() < 0.25) p.hostile = true;
    this.g.audio.scream(p.pos);
  }

  /** frighten civilians near a point */
  panic(x: number, z: number, r: number, source: Actor | null) {
    for (const p of this.list) {
      if (!p.alive || p.role === 'police' || p.role === 'swat') continue;
      const d = Math.hypot(p.pos.x - x, p.pos.z - z);
      if (d > r) continue;
      if (p.role === 'gang' && source && source.isPlayer && d < 20) {
        p.hostile = true;
        p.aggroT = 25;
        p.state = 'fight';
        continue;
      }
      if (p.state !== 'flee' && p.state !== 'knocked' && p.state !== 'phone' && p.state !== 'fight') p.startFlee(x, z);
    }
  }

  /** choose civilians who can see a crime to phone it in */
  findWitness(x: number, z: number, r: number): Ped | null {
    const g = this.g;
    let best: Ped | null = null,
      bd = r;
    for (const p of this.list) {
      if (!p.alive || p.role !== 'civ' || p.knockT > 0 || p.witnessT > 0) continue;
      const d = Math.hypot(p.pos.x - x, p.pos.z - z);
      if (d > bd || d < 1.5) continue;
      if (!g.col.los(p.pos.x, p.pos.y + 1.6, p.pos.z, x, 1.2 + g.player.pos.y, z)) continue;
      bd = d;
      best = p;
    }
    return best;
  }

  onPedKilled(p: Ped, source: Actor | null) {
    const g = this.g;
    if (Math.random() < 0.6 && p.role !== 'mission') g.pickups.spawnCash(p.pos.x, p.pos.z, 5 + Math.floor(Math.random() * (p.role === 'gang' ? 120 : 40)));
    if (p.role === 'police' && Math.random() < 0.5) g.pickups.spawnWeapon(p.pos.x + 0.5, p.pos.z, 'pistol', 12);
    if (p.role === 'gang' && p.weapon !== 'fists') g.pickups.spawnWeapon(p.pos.x + 0.5, p.pos.z, p.weapon, p.weapon === 'pistol' ? 12 : 0);
    g.missions.onPedKilled(p, source);
  }

  update(dt: number) {
    const g = this.g;
    this.mat.multiplyMatrices(g.camera.projectionMatrix, g.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.mat);
    this.spawnT -= dt;
    const ambient = this.list.filter((p) => !p.persistent && p.role !== 'police' && p.role !== 'swat').length;
    if (this.spawnT <= 0 && ambient < this.targetCount) {
      this.spawnT = 0.12;
      this.trySpawnAmbient();
    }
    const f = g.focus;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const d2 = (p.pos.x - f.x) ** 2 + (p.pos.z - f.z) ** 2;
      // LOD: far peds update at low rate and hide
      p.visibleNow = d2 < 150 * 150;
      p.model.root.visible = p.visibleNow;
      p.model.setShadows(d2 < 30 * 30);
      if (d2 < 160 * 160 || p.persistent) p.update(dt, g);
      const despawn = !p.persistent && (d2 > 170 * 170 || (!p.alive && p.deadT > 25) || p.removeMe);
      if (despawn && p.role !== 'police' && p.role !== 'swat') this.remove(p);
      else if (p.removeMe) this.remove(p);
    }
    // gentle separation between peds
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      if (!a.alive || a.knockT > 0) continue;
      for (let j = i + 1; j < this.list.length; j++) {
        const b = this.list[j];
        if (!b.alive || b.knockT > 0) continue;
        const dx = a.pos.x - b.pos.x,
          dz = a.pos.z - b.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.5 && d2 > 1e-5) {
          const d = Math.sqrt(d2);
          const push = (0.71 - d) * 0.5;
          a.pos.x += (dx / d) * push;
          a.pos.z += (dz / d) * push;
          b.pos.x -= (dx / d) * push;
          b.pos.z -= (dz / d) * push;
        }
      }
    }
  }

  clearAll() {
    for (const p of [...this.list]) this.remove(p);
  }

  clearAmbient() {
    for (const p of [...this.list]) if (!p.persistent) this.remove(p);
  }
}
