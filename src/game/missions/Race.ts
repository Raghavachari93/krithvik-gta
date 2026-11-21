import { formatTime } from '../core/math';
import type { Game } from '../Game';
import { AIDriver } from '../vehicles/AIDriver';
import type { Vehicle } from '../vehicles/Vehicle';

export interface RaceOpts {
  id: string;
  checkpoints: { x: number; z: number }[];
  grid: { x: number; z: number; yaw: number };
  rivals: string[];
  playerSpec?: string;
  timeTrial?: boolean;
  par?: number;
  rivalSkill?: number;
}

/** Shared checkpoint race / time-trial controller used by missions and activities. */
export class RaceController {
  rivals: Vehicle[] = [];
  playerCar: Vehicle | null = null;
  cp = 0;
  countdown = 4;
  started = false;
  time = 0;
  finished = false;
  place = 0;
  outOfCarT = 0;
  private finishOrder: (Vehicle | 'player')[] = [];
  private lastShownCp = -1;
  private ownCar = false;

  constructor(
    private g: Game,
    public o: RaceOpts,
  ) {}

  setup() {
    const g = this.g;
    const { grid } = this.o;
    const rx = -Math.cos(grid.yaw),
      rz = Math.sin(grid.yaw);
    const fx = Math.sin(grid.yaw),
      fz = Math.cos(grid.yaw);
    const slots = [-5.5, -1.8, 1.8, 5.5];
    // player car
    let pc = g.player.vehicle;
    if (this.o.playerSpec || !pc) {
      pc = g.vehicles.spawn(this.o.playerSpec ?? 'vortex', grid.x + rx * slots[1], grid.z + rz * slots[1], grid.yaw);
      pc.persistent = true;
      pc.missionTag = this.o.id;
      this.ownCar = true;
      g.player.teleport(pc.pos.x + 3, pc.pos.z, g);
      g.player.enterVehicle(pc, g);
    } else {
      pc.place(grid.x + rx * slots[1], grid.z + rz * slots[1], grid.yaw, g.col);
    }
    pc.fuel = pc.spec.fuelCap;
    this.playerCar = pc;
    this.o.rivals.forEach((spec, i) => {
      const slot = [slots[2], slots[0], slots[3]][i] ?? slots[3] + i * 3;
      const back = i >= 2 ? -7 : 0;
      const v = g.vehicles.spawn(spec, grid.x + rx * slot + fx * back, grid.z + rz * slot + fz * back, grid.yaw);
      v.persistent = true;
      v.missionTag = this.o.id;
      v.health = v.spec.health * 2.5;
      v.driver = 'ai';
      v.npcDriver = true;
      v.locked = true;
      v.rig.driverDummy.visible = true;
      const ai = new AIDriver(v);
      ai.mode = 'idle';
      ai.checkpoints = this.o.checkpoints;
      ai.raceStart = { x: grid.x, z: grid.z };
      ai.skill = (this.o.rivalSkill ?? 0.92) + Math.random() * 0.05;
      v.ai = ai;
      this.rivals.push(v);
    });
    g.freezeVehicle = true;
    g.traffic.density = Math.min(g.traffic.density, 0.35);
    // clear traffic off the start grid and route
    for (const v of [...g.vehicles.list]) {
      if (v === pc || this.rivals.includes(v) || v.persistent || v.driver === 'player') continue;
      const near = Math.hypot(v.pos.x - grid.x, v.pos.z - grid.z) < 60 || this.o.checkpoints.some((c) => Math.hypot(v.pos.x - c.x, v.pos.z - c.z) < 30);
      if (near) g.vehicles.remove(v);
    }
    this.showCheckpoint();
  }

  private showCheckpoint() {
    const g = this.g;
    const cps = this.o.checkpoints;
    g.markers.remove('race_cp');
    g.markers.remove('race_cp2');
    g.markers.removeBlip('race_cp');
    g.markers.removeBlip('race_cp2');
    if (this.cp >= cps.length) return;
    const c = cps[this.cp];
    const n = cps[this.cp + 1];
    const last = this.cp === cps.length - 1;
    const facing = n ? Math.atan2(n.x - c.x, n.z - c.z) + Math.PI / 2 : 0;
    g.markers.add('race_cp', { x: c.x, z: c.z, y: g.col.surfaceY(c.x, c.z, 20, 0), color: last ? 0xffffff : 0xffd000, kind: 'checkpoint', radius: 7, facing });
    g.markers.addBlip({ id: 'race_cp', x: c.x, z: c.z, glyph: last ? '⚑' : '●', color: '#ffd000', label: 'Checkpoint', kind: 'objective' });
    if (n) {
      g.markers.add('race_cp2', { x: n.x, z: n.z, y: g.col.surfaceY(n.x, n.z, 20, 0), color: 0x886600, kind: 'checkpoint', radius: 5, height: 15 });
      g.markers.addBlip({ id: 'race_cp2', x: n.x, z: n.z, glyph: '○', color: '#a08020', label: 'Next', kind: 'objective', minimapOnly: true });
    }
    g.nav.missionTarget = { x: c.x, z: c.z };
    this.lastShownCp = this.cp;
  }

  private progressOf(v: Vehicle | 'player') {
    const cps = this.o.checkpoints;
    const idx = v === 'player' ? this.cp : v.ai!.cpIndex;
    const pos = v === 'player' ? this.playerCar!.pos : v.pos;
    const c = cps[Math.min(idx, cps.length - 1)];
    return idx * 10000 - Math.hypot(c.x - pos.x, c.z - pos.z);
  }

  /** returns 'running' | 'won' | 'lost' | 'finished' | 'dnf' */
  update(dt: number): 'running' | 'won' | 'lost' | 'finished' | 'dnf' {
    const g = this.g;
    const cps = this.o.checkpoints;
    if (!this.started) {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const now = Math.ceil(this.countdown);
      if (now !== before && now > 0) {
        g.audio.wantedUp();
      }
      g.ui.hud({ countdown: this.countdown > 0 ? Math.ceil(this.countdown) : null });
      if (this.countdown <= 0) {
        this.started = true;
        g.freezeVehicle = false;
        g.ui.hud({ countdown: null });
        g.ui.bigMessage('GO!', '', '#39ff88');
        g.audio.jingle(true);
        for (const r of this.rivals) r.ai!.mode = 'race';
      }
      return 'running';
    }
    this.time += dt;
    const p = g.player;
    if (p.vehicle !== this.playerCar) {
      this.outOfCarT += dt;
      if (this.outOfCarT > 15 || (this.playerCar && this.playerCar.destroyed)) return 'dnf';
    } else this.outOfCarT = 0;
    // player checkpoints
    if (this.cp < cps.length) {
      const c = cps[this.cp];
      const car = this.playerCar!;
      if (Math.hypot(car.pos.x - c.x, car.pos.z - c.z) < 14 && p.vehicle === car) {
        this.cp++;
        g.audio.pickup();
        if (this.cp >= cps.length) {
          this.finishOrder.push('player');
          this.finished = true;
          this.place = this.finishOrder.indexOf('player') + 1;
          g.markers.remove('race_cp');
          g.markers.remove('race_cp2');
          g.markers.removeBlip('race_cp');
          g.markers.removeBlip('race_cp2');
          if (this.o.timeTrial) return 'finished';
          return this.place === 1 ? 'won' : 'lost';
        }
        this.showCheckpoint();
      }
    }
    // rivals
    const playerProg = this.progressOf('player');
    for (const r of this.rivals) {
      const ai = r.ai!;
      if (ai.finished) continue;
      const c = cps[ai.cpIndex];
      if (Math.hypot(r.pos.x - c.x, r.pos.z - c.z) < 16) {
        ai.cpIndex++;
        if (ai.cpIndex >= cps.length) {
          ai.finished = true;
          ai.mode = 'idle';
          this.finishOrder.push(r);
        }
      }
      // rubber band
      const diff = this.progressOf(r) - playerProg;
      const base = this.o.rivalSkill ?? 0.92;
      ai.skill = Math.min(0.85, diff > 15000 ? base * 0.8 : diff < -15000 ? base * 1.08 : base);
      if (r.destroyed && !this.finishOrder.includes(r)) ai.finished = true;
    }
    if (this.lastShownCp !== this.cp) this.showCheckpoint();
    // standings
    const all: (Vehicle | 'player')[] = ['player', ...this.rivals.filter((r) => !r.destroyed)];
    const unfinished = all.filter((x) => !this.finishOrder.includes(x)).sort((a, b) => this.progressOf(b) - this.progressOf(a));
    const order = [...this.finishOrder, ...unfinished];
    const pos = order.indexOf('player') + 1;
    g.ui.hud({ race: this.o.timeTrial ? null : { pos, total: all.length, cp: this.cp, cps: cps.length } });
    return 'running';
  }

  summary() {
    return this.o.timeTrial ? `Time: ${formatTime(this.time)}` : `Finished ${ordinal(this.place)} — ${formatTime(this.time)}`;
  }

  cleanup() {
    const g = this.g;
    for (const r of this.rivals) if (g.vehicles.list.includes(r)) g.vehicles.remove(r);
    this.rivals = [];
    if (this.ownCar && this.playerCar) {
      this.playerCar.missionTag = null;
      this.playerCar.persistent = g.player.vehicle === this.playerCar;
    }
    g.markers.remove('race_cp');
    g.markers.remove('race_cp2');
    g.markers.removeBlip('race_cp');
    g.markers.removeBlip('race_cp2');
    g.nav.missionTarget = null;
    g.freezeVehicle = false;
    g.traffic.density = g.settings.trafficDensity;
    g.ui.hud({ race: null, countdown: null });
  }
}

export const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');
