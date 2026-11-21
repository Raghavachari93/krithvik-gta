import type { Game } from '../Game';
import type { Ped, PedRole } from '../ai/Pedestrian';
import type { CharacterLook } from '../characters/CharacterModel';
import type { Pickup } from '../systems/Pickups';
import type { MarkerOpts } from '../systems/Markers';
import type { Vehicle } from '../vehicles/Vehicle';

export type MissionStatus = 'running' | 'success' | 'fail';

export interface MissionDef {
  id: string;
  title: string;
  type: string;
  giver: string;
  giverLook: CharacterLook;
  start: { x: number; z: number; yaw: number };
  intro: string;
  objective: string;
  instructions: string[];
  reward: number;
  rewardText?: string;
  requires: string[];
  story: boolean;
  create: (g: Game, def: MissionDef) => MissionRun;
}

/** Base class with helpers that track everything a mission spawns so it can be cleaned up. */
export abstract class MissionRun {
  objective = '';
  detail = '';
  timer: number | null = null;
  failReason = '';
  stage = 0;
  stageT = 0;
  protected vehicles: Vehicle[] = [];
  protected peds: Ped[] = [];
  protected markerIds: string[] = [];
  protected interactIds: string[] = [];
  protected pickups: Pickup[] = [];
  private uid = 0;

  constructor(
    public g: Game,
    public def: MissionDef,
  ) {}

  abstract start(): void;
  abstract tick(dt: number): MissionStatus;

  update(dt: number): MissionStatus {
    this.stageT += dt;
    if (this.timer !== null) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 0;
        return this.fail("You ran out of time.");
      }
    }
    if (!this.g.player.alive) return this.fail('You were wasted.');
    return this.tick(dt);
  }

  protected setStage(n: number, objective: string, detail = '') {
    this.stage = n;
    this.stageT = 0;
    this.objective = objective;
    this.detail = detail;
    this.g.ui.notify(objective, 'info');
  }

  fail(reason: string): MissionStatus {
    this.failReason = reason;
    return 'fail';
  }

  protected vehicle(spec: string, x: number, z: number, yaw: number, color?: number) {
    const v = this.g.vehicles.spawn(spec, x, z, yaw, color);
    v.persistent = true;
    v.missionTag = this.def.id;
    v.driver = null;
    this.vehicles.push(v);
    return v;
  }

  protected ped(look: CharacterLook, x: number, z: number, yaw: number, name: string, role: PedRole = 'mission') {
    const p = this.g.peds.spawnMissionPed(look, x, z, yaw, name, role);
    this.peds.push(p);
    return p;
  }

  protected marker(opts: MarkerOpts, id?: string) {
    const mid = id ?? `m_${this.def.id}_${this.uid++}`;
    this.g.markers.add(mid, opts);
    this.markerIds.push(mid);
    return mid;
  }

  protected blip(id: string, x: number, z: number, glyph: string, color: string, label: string, follow?: () => { x: number; z: number } | null) {
    const bid = `m_${this.def.id}_b_${id}`;
    this.g.markers.addBlip({ id: bid, x, z, glyph, color, label, kind: 'objective', follow });
    this.markerIds.push(bid);
    return bid;
  }

  protected clearMarker(id: string) {
    this.g.markers.remove(id);
    this.g.markers.removeBlip(id);
  }

  protected interact(id: string, x: number, z: number, label: string, action: () => void, r = 2.5, vehicle: 'allow' | 'require' | 'forbid' = 'forbid') {
    const iid = `m_${this.def.id}_i_${id}`;
    this.g.interact.add({ id: iid, x, z, r, label, action, vehicle });
    this.interactIds.push(iid);
    return iid;
  }

  protected item(x: number, y: number, z: number, color: number, onPick: () => void, vehicleOk = true) {
    const p = this.g.pickups.spawnItem(x, y, z, color, onPick, { vehicleOk, radius: vehicleOk ? 3 : 1.6, tag: this.def.id });
    this.pickups.push(p);
    return p;
  }

  protected gps(x: number, z: number) {
    this.g.nav.missionTarget = { x, z };
  }

  protected say(speaker: string, text: string) {
    this.g.ui.subtitle(speaker, text);
  }

  protected dist(x: number, z: number) {
    const p = this.g.player.pos;
    return Math.hypot(p.x - x, p.z - z);
  }

  onPedKilled(_p: Ped) {}
  onVehicleDestroyed(_v: Vehicle) {}
  onWantedCleared() {}
  onTalk(_p: Ped): boolean {
    return false;
  }
  onEnterVehicle(_v: Vehicle) {}

  cleanup() {
    const g = this.g;
    for (const v of this.vehicles) {
      if (g.player.vehicle === v) g.player.exitVehicle(g, true);
      if (g.vehicles.list.includes(v)) g.vehicles.remove(v);
    }
    for (const p of this.peds) if (g.peds.list.includes(p)) g.peds.remove(p);
    for (const id of this.markerIds) {
      g.markers.remove(id);
      g.markers.removeBlip(id);
    }
    for (const id of this.interactIds) g.interact.remove(id);
    for (const p of this.pickups) g.pickups.remove(p);
    g.nav.missionTarget = null;
    g.wanted.suppressed = false;
    g.freezeVehicle = false;
  }
}
