import * as THREE from 'three';
import type { Game } from '../Game';
import { WEAPONS, WeaponId } from '../combat/Weapons';

export type PickupKind = 'cash' | 'health' | 'armor' | 'weapon' | 'item';

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  z: number;
  value: number;
  weapon?: WeaponId;
  mesh: THREE.Object3D;
  ttl: number;
  respawn?: number;
  hiddenUntil?: number;
  radius: number;
  vehicleOk: boolean;
  onPick?: () => void;
  tag?: string;
}

let PID = 1;
const mats = {
  cash: new THREE.MeshStandardMaterial({ color: 0x3fbf5a, emissive: 0x1a7a2a, emissiveIntensity: 0.6, roughness: 0.5 }),
  health: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, emissive: 0xff2020, emissiveIntensity: 0.6 }),
  armor: new THREE.MeshStandardMaterial({ color: 0x2a6ad0, emissive: 0x1a3a8a, emissiveIntensity: 0.8, metalness: 0.5 }),
  weapon: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffaa22, emissiveIntensity: 0.5, metalness: 0.6 }),
};

export class Pickups {
  group = new THREE.Group();
  list: Pickup[] = [];
  private t = 0;

  constructor(private g: Game) {}

  private add(kind: PickupKind, x: number, y: number, z: number, mesh: THREE.Object3D, extra: Partial<Pickup> = {}) {
    mesh.position.set(x, y + 0.6, z);
    this.group.add(mesh);
    const p: Pickup = { id: PID++, kind, x, y, z, value: 0, mesh, ttl: 60, radius: 1.2, vehicleOk: false, ...extra };
    this.list.push(p);
    return p;
  }

  spawnCash(x: number, z: number, amount: number) {
    const y = this.g.col.surfaceY(x, z, 100, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.2), mats.cash);
    return this.add('cash', x, y, z, m, { value: amount, ttl: 40 });
  }

  spawnHealth(x: number, z: number, respawn = 0) {
    const y = this.g.col.surfaceY(x, z, 100, 0);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.16), mats.health), new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), mats.health));
    return this.add('health', x, y, z, g, { value: 50, ttl: respawn ? Infinity : 60, respawn });
  }

  spawnArmor(x: number, z: number, respawn = 0) {
    const y = this.g.col.surfaceY(x, z, 100, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, 0.16), mats.armor);
    return this.add('armor', x, y, z, m, { value: 50, ttl: respawn ? Infinity : 60, respawn });
  }

  spawnWeapon(x: number, z: number, w: WeaponId, ammo: number, respawn = 0) {
    const y = this.g.col.surfaceY(x, z, 100, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w === 'shotgun' ? 0.9 : w === 'bat' ? 0.9 : 0.45, 0.12, 0.12), mats.weapon);
    return this.add('weapon', x, y, z, m, { value: ammo, weapon: w, ttl: respawn ? Infinity : 45, respawn });
  }

  spawnItem(x: number, y: number, z: number, color: number, onPick: () => void, opts: Partial<Pickup> = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.6 }));
    return this.add('item', x, y, z, m, { onPick, ttl: Infinity, radius: 1.6, ...opts });
  }

  spawnMesh(x: number, y: number, z: number, mesh: THREE.Object3D, onPick: () => void, opts: Partial<Pickup> = {}) {
    return this.add('item', x, y, z, mesh, { onPick, ttl: Infinity, radius: 1.6, ...opts });
  }

  remove(p: Pickup) {
    p.mesh.removeFromParent();
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
  }
  removeTag(tag: string) {
    for (const p of [...this.list]) if (p.tag === tag) this.remove(p);
  }

  update(dt: number) {
    const g = this.g;
    this.t += dt;
    const pl = g.player;
    for (const p of [...this.list]) {
      if (p.hiddenUntil !== undefined) {
        if (g.time < p.hiddenUntil) continue;
        p.hiddenUntil = undefined;
        p.mesh.visible = true;
      }
      p.ttl -= dt;
      if (p.ttl <= 0) {
        this.remove(p);
        continue;
      }
      p.mesh.rotation.y += dt * 2.2;
      p.mesh.position.y = p.y + 0.7 + Math.sin(this.t * 3 + p.id) * 0.12;
      if (!pl.alive) continue;
      if (pl.vehicle && !p.vehicleOk) continue;
      const r = pl.vehicle ? Math.max(p.radius, pl.vehicle.spec.len * 0.6) : p.radius;
      const dy = Math.abs(pl.pos.y - p.y);
      if (Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z) < r && dy < 2.5) this.collect(p);
    }
  }

  private collect(p: Pickup) {
    const g = this.g;
    const pl = g.player;
    switch (p.kind) {
      case 'cash':
        g.progress.addCash(p.value, `Picked up ${'$' + p.value}`);
        g.audio.cash();
        break;
      case 'health':
        if (pl.health >= pl.maxHealth) return;
        pl.health = Math.min(pl.maxHealth, pl.health + p.value);
        g.ui.notify('+Health', 'good');
        g.audio.pickup();
        break;
      case 'armor':
        if (pl.armor >= 100) return;
        pl.armor = Math.min(100, pl.armor + p.value);
        g.ui.notify('+Armor', 'good');
        g.audio.pickup();
        break;
      case 'weapon':
        pl.giveWeapon(p.weapon!, p.value);
        g.ui.notify(`Picked up ${WEAPONS[p.weapon!].name}`, 'good');
        g.audio.pickup();
        break;
      case 'item':
        g.audio.pickup();
        p.onPick?.();
        break;
    }
    g.fx.sparkleBurst(p.mesh.position, p.kind === 'cash' ? 0x3fbf5a : 0xffd27a);
    if (p.respawn) {
      p.hiddenUntil = g.time + p.respawn;
      p.mesh.visible = false;
    } else this.remove(p);
  }
}
