import * as THREE from 'three';
import { districtOf, locateBlock } from '../constants';
import type { Game } from '../Game';
import { AIDriver } from '../vehicles/AIDriver';
import { TRAFFIC_POOL } from '../vehicles/VehicleSpecs';

const _v = new THREE.Vector3();

/** Spawns and recycles AI traffic around the player. */
export class TrafficManager {
  density = 1;
  private spawnT = 0;

  constructor(private g: Game) {}

  get target() {
    const g = this.g;
    let n = 20 * this.density;
    if (g.env.night > 0.6) n *= 0.7;
    if (Math.hypot(g.focus.x, g.focus.z) > 900) n *= 0.4;
    return Math.round(n);
  }

  spawnTraffic(forceSpec?: string): boolean {
    const g = this.g;
    const nodes = g.layout.nodes;
    const f = g.focus;
    for (let attempt = 0; attempt < 10; attempt++) {
      const a = nodes[Math.floor(Math.random() * nodes.length)];
      if (!a.links.length) continue;
      const b = nodes[a.links[Math.floor(Math.random() * a.links.length)]];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const s = 14 + Math.random() * Math.max(1, len - 34);
      const dx = (b.x - a.x) / len,
        dz = (b.z - a.z) / len;
      const lane = Math.random() < 0.5 ? 2 : 6;
      const x = a.x + dx * s - dz * lane,
        z = a.z + dz * s + dx * lane;
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < 85 || d > 230) continue;
      _v.set(x, 1, z).project(g.camera);
      if (Math.abs(_v.x) < 1 && Math.abs(_v.y) < 1 && _v.z < 1 && d < 150) continue;
      if (g.vehicles.list.some((v) => Math.hypot(v.pos.x - x, v.pos.z - z) < 12)) continue;
      const blk = locateBlock(x + 20, z + 20);
      const pool = TRAFFIC_POOL[blk ? districtOf(blk.bi, blk.bj) : 'commercial'] ?? TRAFFIC_POOL.commercial;
      const spec = forceSpec ?? pool[Math.floor(Math.random() * pool.length)];
      const v = g.vehicles.spawn(spec, x, z, Math.atan2(dx, dz));
      v.driver = 'ai';
      v.npcDriver = true;
      v.rig.driverDummy.visible = true;
      const ai = new AIDriver(v);
      ai.startTraffic(a, b, lane);
      v.ai = ai;
      v.vel.set(dx * 9, 0, dz * 9);
      return true;
    }
    return false;
  }

  update(dt: number) {
    const g = this.g;
    const f = g.focus;
    const traffic = g.vehicles.list.filter((v) => v.driver === 'ai' && v.ai && v.ai.mode === 'traffic');
    this.spawnT -= dt;
    if (this.spawnT <= 0 && traffic.filter((v) => !v.spec.police).length < this.target) {
      this.spawnT = 0.3;
      this.spawnTraffic();
    }
    for (const v of g.vehicles.list) {
      if (v.persistent || v.driver === 'player' || v.missionTag) continue;
      const isTraffic = v.ai && (v.ai.mode === 'traffic' || v.ai.mode === 'goto') && !g.police.units.some((u) => u.vehicle === v);
      const abandoned = v.driver === null && !v.ai && v.wasStolen;
      if (!isTraffic && !abandoned) continue;
      const d = Math.hypot(v.pos.x - f.x, v.pos.z - f.z);
      const stuck = v.ai ? v.ai.stuckT > 0 && v.speed < 0.5 && g.time - v.bornAt > 30 : false;
      if (d > 270 || (stuck && d > 90) || (abandoned && d > 200)) {
        _v.copy(v.pos).project(g.camera);
        const onScreen = Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1 && _v.z < 1;
        if (!onScreen || d > 270) g.vehicles.remove(v);
      }
    }
  }
}
