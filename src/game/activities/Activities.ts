import * as THREE from 'three';
import { BLOCKS, ISLAND, WATER_Y, blockCenter, locateBlock, roadC, terrainY } from '../constants';
import { formatMoney, formatTime, wrapAngle } from '../core/math';
import type { Game } from '../Game';
import type { Ped } from '../ai/Pedestrian';
import { perimeterPoint } from '../ai/Pedestrian';
import { randomLook } from '../characters/CharacterModel';
import { RaceController, ordinal } from '../missions/Race';
import type { Vehicle } from '../vehicles/Vehicle';

export interface ActivityRun {
  name: string;
  objective: string;
  detail: string;
  timer: number | null;
  blocking: boolean;
  update(dt: number): 'running' | 'done' | 'fail';
  cleanup(): void;
  result?: { success: boolean; title: string; lines: string[]; reward?: string; reason?: string };
}

const G = (i: number, j: number) => ({ x: roadC(i), z: roadC(j) });

interface RaceDef {
  id: string;
  name: string;
  timeTrial: boolean;
  grid: { x: number; z: number; yaw: number };
  cps: { x: number; z: number }[];
  rivals: string[];
  reward: number;
  par?: number;
  desc: string;
}

const RACES: RaceDef[] = [
  { id: 'race_harbor', name: 'Harbor Sprint', timeTrial: false, grid: { x: roadC(1) - 25, z: roadC(12), yaw: Math.PI / 2 }, cps: [G(4, 12), G(4, 9), G(8, 9), G(8, 12), G(2, 12)], rivals: ['stallion', 'vortex', 'comet'], reward: 1000, desc: 'A sprint through Rustwater and the port. First place pays.' },
  { id: 'race_downtown', name: 'Downtown Dash', timeTrial: false, grid: { x: roadC(6), z: roadC(3) - 20, yaw: 0 }, cps: [G(6, 5), G(4, 5), G(4, 7), G(7, 7), G(7, 4), G(6, 4)], rivals: ['vortex', 'zenith', 'stallion'], reward: 1500, desc: 'Weave between the towers of Downtown against the fastest crew in the city.' },
  {
    id: 'tt_coastal',
    name: 'Coastal Run',
    timeTrial: true,
    grid: { x: roadC(12), z: roadC(1), yaw: 0 },
    cps: [G(12, 3), { x: 1050, z: -300 }, { x: 1050, z: -440 }, { x: 1250, z: -440 }, { x: 1250, z: -160 }, { x: 1050, z: -160 }, { x: 1050, z: -300 }, G(12, 3)],
    rivals: [],
    reward: 800,
    par: 112,
    desc: 'Ocean Drive, over the Coral Key Bridge, around the island and back. Beat the par time.',
  },
  {
    id: 'tt_airport',
    name: 'Airport Blitz',
    timeTrial: true,
    grid: { x: roadC(0) - 20, z: 0, yaw: -Math.PI / 2 },
    cps: [{ x: -900, z: 0 }, { x: -900, z: 255 }, { x: -830, z: 280 }, { x: -830, z: -280 }, { x: -900, z: -255 }, { x: -900, z: 0 }, { x: -640, z: 0 }],
    rivals: [],
    reward: 800,
    par: 62,
    desc: 'Tear down the expressway and the main runway of Neon Bay International.',
  },
];

// ---------------------------------------------------------------------------
class RaceActivity implements ActivityRun {
  name: string;
  objective = '';
  detail = '';
  timer: number | null = null;
  blocking = true;
  race: RaceController;
  result?: ActivityRun['result'];
  constructor(private g: Game, private d: RaceDef) {
    this.name = d.name;
    this.race = new RaceController(g, { id: d.id, checkpoints: d.cps, grid: d.grid, rivals: d.rivals, timeTrial: d.timeTrial, par: d.par });
    this.race.setup();
    this.objective = d.timeTrial ? `Time trial: ${d.name}` : `Street race: ${d.name}`;
  }
  update(dt: number) {
    const r = this.race.update(dt);
    const g = this.g;
    this.detail = this.d.timeTrial ? `${formatTime(this.race.time)}  /  par ${formatTime(this.d.par!)}` : `Checkpoint ${Math.min(this.race.cp + 1, this.d.cps.length)}/${this.d.cps.length}`;
    if (r === 'running') return 'running';
    const best = g.progress.best[this.d.id];
    const t = this.race.time;
    if (r === 'dnf') {
      this.result = { success: false, title: this.d.name, reason: 'You left your vehicle.', lines: [] };
      return 'fail';
    }
    if (!best || t < best) g.progress.best[this.d.id] = t;
    const lines = [this.race.summary(), `Best: ${formatTime(g.progress.best[this.d.id])}`];
    if (r === 'finished') {
      const beat = t <= this.d.par!;
      let reward: string | undefined;
      if (beat && !g.progress.activitiesDone.has(this.d.id)) {
        g.progress.activitiesDone.add(this.d.id);
        g.progress.addCash(this.d.reward);
        reward = formatMoney(this.d.reward);
      } else if (beat) {
        g.progress.addCash(200);
        reward = '$200';
      }
      this.result = { success: beat, title: this.d.name, reason: beat ? undefined : `Missed the par time of ${formatTime(this.d.par!)}`, lines, reward };
      return beat ? 'done' : 'fail';
    }
    if (r === 'won') {
      g.progress.stat('racesWon', 1);
      const first = !g.progress.activitiesDone.has(this.d.id);
      g.progress.activitiesDone.add(this.d.id);
      const amt = first ? this.d.reward : Math.round(this.d.reward * 0.4);
      g.progress.addCash(amt);
      this.result = { success: true, title: `${this.d.name} — 1st place`, lines, reward: formatMoney(amt) };
      return 'done';
    }
    this.result = { success: false, title: this.d.name, reason: `You finished ${ordinal(this.race.place)}.`, lines };
    return 'fail';
  }
  cleanup() {
    this.race.cleanup();
  }
}

// ---------------------------------------------------------------------------
class DriftActivity implements ActivityRun {
  name = 'Rustwater Drift Challenge';
  objective = 'Drift! Score 15,000 points in 60 seconds.';
  detail = '';
  timer: number | null = 60;
  blocking = true;
  score = 0;
  combo = 1;
  comboT = 0;
  result?: ActivityRun['result'];
  constructor(private g: Game) {}
  update(dt: number) {
    const g = this.g;
    const v = g.player.vehicle;
    this.timer! -= dt;
    if (v && v.grounded && v.speed > 7) {
      const slipAng = Math.abs(wrapAngle(Math.atan2(v.vel.x, v.vel.z) - v.yaw));
      const ang = Math.min(slipAng, Math.PI - slipAng);
      if (ang > 0.25 && ang < 1.5) {
        this.score += v.speed * ang * dt * 60 * this.combo;
        this.comboT += dt;
        if (this.comboT > 1.5) {
          this.comboT = 0;
          this.combo = Math.min(5, this.combo + 1);
        }
      } else {
        this.comboT = Math.max(0, this.comboT - dt * 2);
        if (this.comboT <= 0) this.combo = 1;
      }
    }
    if (v && v.lastImpact > 4 && g.time - v.bornAt > 0) {
      this.combo = 1;
      v.lastImpact = 0;
    }
    g.ui.hud({ drift: { score: Math.floor(this.score), combo: this.combo, goal: 15000 } });
    this.detail = `Score ${Math.floor(this.score).toLocaleString()}  x${this.combo}`;
    if (!v) return this.finish(false, 'You left the vehicle.');
    if (this.timer! <= 0) return this.finish(this.score >= 15000);
    return 'running';
  }
  private finish(ok: boolean, reason?: string): 'done' | 'fail' {
    const g = this.g;
    const best = g.progress.best.drift ?? 0;
    if (this.score > best) g.progress.best.drift = Math.floor(this.score);
    let reward: string | undefined;
    if (ok) {
      if (!g.progress.activitiesDone.has('drift')) {
        g.progress.activitiesDone.add('drift');
        g.progress.addCash(1200);
        reward = '$1,200';
        g.progress.achieve('drifter');
      } else {
        g.progress.addCash(300);
        reward = '$300';
      }
    }
    this.result = { success: ok, title: this.name, reason: ok ? undefined : reason ?? 'Not enough points.', lines: [`Score: ${Math.floor(this.score).toLocaleString()}`, `Best: ${(g.progress.best.drift ?? 0).toLocaleString()}`], reward };
    return ok ? 'done' : 'fail';
  }
  cleanup() {
    this.g.ui.hud({ drift: null });
  }
}

// ---------------------------------------------------------------------------
class ParkourActivity implements ActivityRun {
  name = 'Market Row Rooftops';
  objective = 'Reach every rooftop checkpoint.';
  detail = '';
  timer: number | null = 150;
  blocking = true;
  cp = 0;
  t = 0;
  result?: ActivityRun['result'];
  constructor(private g: Game) {
    this.show();
  }
  private show() {
    const g = this.g;
    g.markers.remove('pk_cp');
    g.markers.removeBlip('pk_cp');
    const c = g.layout.parkourCheckpoints[this.cp];
    if (!c) return;
    g.markers.add('pk_cp', { x: c.x, z: c.z, y: c.y, color: 0x39ff88, kind: 'checkpoint', radius: 2.2, height: 12 });
    g.markers.addBlip({ id: 'pk_cp', x: c.x, z: c.z, glyph: '●', color: '#39ff88', label: 'Rooftop checkpoint', kind: 'objective' });
  }
  update(dt: number) {
    const g = this.g;
    this.t += dt;
    this.timer! -= dt;
    const cps = g.layout.parkourCheckpoints;
    const c = cps[this.cp];
    const p = g.player;
    this.detail = `Checkpoint ${this.cp + 1}/${cps.length}  •  Mantle ledges by jumping into them`;
    if (p.vehicle) {
      this.result = { success: false, title: this.name, reason: 'No vehicles on the rooftops!', lines: [] };
      return 'fail';
    }
    if (Math.hypot(p.pos.x - c.x, p.pos.z - c.z) < 3 && Math.abs(p.pos.y - c.y) < 1.5) {
      this.cp++;
      g.audio.pickup();
      if (this.cp >= cps.length) {
        const first = !g.progress.activitiesDone.has('parkour');
        g.progress.activitiesDone.add('parkour');
        const best = g.progress.best.parkour;
        if (!best || this.t < best) g.progress.best.parkour = this.t;
        g.progress.addCash(first ? 1000 : 250);
        g.progress.achieve('parkour');
        this.result = { success: true, title: this.name, reward: first ? '$1,000' : '$250', lines: [`Time: ${formatTime(this.t)}`, `Best: ${formatTime(g.progress.best.parkour)}`] };
        return 'done';
      }
      this.show();
    }
    if (this.timer! <= 0) {
      this.result = { success: false, title: this.name, reason: 'Out of time.', lines: [] };
      return 'fail';
    }
    return 'running';
  }
  cleanup() {
    this.g.markers.remove('pk_cp');
    this.g.markers.removeBlip('pk_cp');
  }
}

// ---------------------------------------------------------------------------
class TaxiActivity implements ActivityRun {
  name = 'Bay Cab';
  objective = 'Pick up the fare.';
  detail = 'Press T to end your shift';
  timer: number | null = null;
  blocking = false;
  fare: Ped | null = null;
  dest: { x: number; z: number } | null = null;
  stage: 'find' | 'board' | 'drive' = 'find';
  earned = 0;
  fares = 0;
  boardT = 0;
  constructor(private g: Game, private cab: Vehicle, private fixedPed?: Ped, fixedDest?: { x: number; z: number }) {
    if (fixedPed) {
      this.fare = fixedPed;
      this.stage = 'board';
      this.dest = fixedDest ?? null;
      this.name = 'Give a lift';
    } else this.newFare();
  }
  private sidewalkPoint(minD: number, maxD: number) {
    const p = this.g.player.pos;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2,
        d = minD + Math.random() * (maxD - minD);
      const b = locateBlock(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d);
      if (!b || b.bi < 0 || b.bj < 0 || b.bi >= BLOCKS || b.bj >= BLOCKS) continue;
      return perimeterPoint(b.bi, b.bj, Math.random() * 320);
    }
    return perimeterPoint(5, 5, 10);
  }
  private newFare() {
    const g = this.g;
    const pt = this.sidewalkPoint(120, 350);
    this.fare = g.peds.spawnMissionPed(randomLook(), pt.x, pt.z, 0, 'Passenger', 'mission');
    this.fare.state = 'stand';
    this.stage = 'find';
    this.objective = 'Pick up the passenger waiting by the curb.';
    g.markers.add('taxi_fare', { x: 0, z: 0, color: 0x39ff88, kind: 'objective', follow: () => (this.fare && this.stage !== 'drive' ? this.fare.pos : null) });
    g.markers.addBlip({ id: 'taxi_fare', x: pt.x, z: pt.z, glyph: '☺', color: '#39ff88', label: 'Fare', kind: 'objective', follow: () => (this.fare && this.stage !== 'drive' ? this.fare.pos : null) });
    g.nav.missionTarget = { x: pt.x, z: pt.z };
  }
  update(dt: number) {
    const g = this.g;
    const v = g.player.vehicle;
    if (!this.fixedPed && v !== this.cab) {
      this.endShift();
      return 'done';
    }
    if (this.fixedPed && !v && this.stage === 'drive') {
      g.ui.notify('You abandoned your passenger.', 'warn');
      return 'fail';
    }
    if (!this.fare || !this.fare.alive) {
      g.ui.notify('Your passenger is gone.', 'warn');
      this.cleanupFare();
      if (this.fixedPed) return 'fail';
      this.newFare();
      return 'running';
    }
    const car = v ?? this.cab;
    if (this.stage === 'find' || this.stage === 'board') {
      const d = Math.hypot(car.pos.x - this.fare.pos.x, car.pos.z - this.fare.pos.z);
      this.detail = d < 15 ? 'Stop next to the passenger' : `${Math.round(d)}m away`;
      if (d < 11 && car.speed < 2 && v) {
        this.stage = 'board';
        this.boardT += dt;
        this.fare.state = 'goto';
        this.fare.target = { x: car.pos.x, z: car.pos.z };
        if (this.boardT > 1.4 || d < 3) {
          // passenger gets in
          g.peds.remove(this.fare);
          this.fare = null;
          if (!this.dest) {
            const pt = this.sidewalkPoint(300, 900);
            this.dest = pt;
          }
          const dist = Math.hypot(this.dest.x - car.pos.x, this.dest.z - car.pos.z);
          this.timer = 25 + dist / 11;
          this.stage = 'drive';
          this.objective = 'Drive the passenger to their destination.';
          g.markers.remove('taxi_fare');
          g.markers.removeBlip('taxi_fare');
          g.markers.add('taxi_dest', { x: this.dest.x, z: this.dest.z, color: 0xffd000, kind: 'mission', radius: 3 });
          g.markers.addBlip({ id: 'taxi_dest', x: this.dest.x, z: this.dest.z, glyph: '★', color: '#ffd000', label: 'Drop-off', kind: 'objective' });
          g.nav.missionTarget = { ...this.dest };
          g.ui.subtitle('Passenger', ['Take me there, and step on it!', "Hi! I'm running late, can you hurry?", 'Nice cab. Let us go.'][Math.floor(Math.random() * 3)]);
        }
      } else this.boardT = 0;
      return 'running';
    }
    // driving
    this.timer = (this.timer ?? 0) - dt;
    const d = Math.hypot(car.pos.x - this.dest!.x, car.pos.z - this.dest!.z);
    this.detail = `${Math.round(d)}m to destination`;
    if (d < 10 && car.speed < 2.5) {
      const base = 40 + Math.round(Math.max(0, this.timer!) * 3) + Math.round(Math.hypot(this.dest!.x, this.dest!.z) * 0.02);
      g.progress.addCash(base, this.fixedPed ? 'Thanks for the lift' : 'Fare paid');
      this.earned += base;
      this.fares++;
      g.progress.stat(this.fixedPed ? 'encounters' : 'fares', 1);
      g.markers.remove('taxi_dest');
      g.markers.removeBlip('taxi_dest');
      this.timer = null;
      this.dest = null;
      if (this.fixedPed) return 'done';
      this.newFare();
    } else if (this.timer! <= 0) {
      g.ui.notify('The passenger got fed up and left.', 'bad');
      g.markers.remove('taxi_dest');
      g.markers.removeBlip('taxi_dest');
      this.timer = null;
      this.dest = null;
      if (this.fixedPed) return 'fail';
      this.newFare();
    }
    return 'running';
  }
  private cleanupFare() {
    const g = this.g;
    if (this.fare && g.peds.list.includes(this.fare) && !this.fixedPed) g.peds.remove(this.fare);
    this.fare = null;
    g.markers.remove('taxi_fare');
    g.markers.removeBlip('taxi_fare');
    g.markers.remove('taxi_dest');
    g.markers.removeBlip('taxi_dest');
  }
  endShift() {
    if (!this.fixedPed) this.g.ui.notify(`Shift over: ${this.fares} fares, ${formatMoney(this.earned)}`, 'money');
  }
  cleanup() {
    this.cleanupFare();
    this.g.nav.missionTarget = null;
  }
}

// ---------------------------------------------------------------------------
class EncounterThief implements ActivityRun {
  name = 'Stop, thief!';
  objective = 'A thief snatched a purse! Knock him down.';
  detail = '';
  timer: number | null = 60;
  blocking = false;
  thief: Ped;
  victim: Ped;
  constructor(private g: Game, x: number, z: number) {
    this.victim = g.peds.spawnMissionPed(randomLook(), x, z, 0, 'Victim', 'mission');
    this.thief = g.peds.spawnPed(randomLook(true), 'civ', x + 2, z + 1);
    this.thief.persistent = true;
    this.thief.startFlee(x, z, 999);
    this.thief.name = 'Thief';
    this.victim.say(g, 'Stop! Thief! Somebody stop him!');
    this.victim.state = 'stand';
    g.markers.add('enc_t', { x: 0, z: 0, color: 0xff3355, kind: 'enemy', follow: () => (this.thief.alive && this.thief.knockT <= 0 ? this.thief.pos : null) });
    g.markers.addBlip({ id: 'enc_t', x, z, glyph: '◆', color: '#ff3355', label: 'Thief', kind: 'enemy', follow: () => (this.thief.alive ? this.thief.pos : null) });
  }
  update(dt: number) {
    const g = this.g;
    this.timer! -= dt;
    this.thief.threat.x = g.player.pos.x;
    this.thief.threat.z = g.player.pos.z;
    this.thief.timer = 99;
    if (this.thief.knockT > 0 || !this.thief.alive) {
      g.progress.addCash(300, 'Returned the purse');
      g.progress.stat('encounters', 1);
      this.victim.say(g, 'Thank you so much! Here, take this.');
      return 'done';
    }
    if (this.timer! <= 0 || this.thief.pos.distanceTo(g.player.pos) > 180) {
      g.ui.notify('The thief got away.', 'warn');
      return 'fail';
    }
    this.detail = `${Math.round(this.thief.pos.distanceTo(g.player.pos))}m away`;
    return 'running';
  }
  cleanup() {
    const g = this.g;
    g.markers.remove('enc_t');
    g.markers.removeBlip('enc_t');
    this.thief.persistent = false;
    setTimeout(() => {
      if (g.peds.list.includes(this.victim)) g.peds.remove(this.victim);
    }, 6000);
  }
}

class EncounterBrawl implements ActivityRun {
  name = 'Street fight';
  objective = 'A local tough wants to fight. Knock him out!';
  detail = 'Use fists: LMB punch, RMB block, Q dodge';
  timer: number | null = 90;
  blocking = false;
  thug: Ped;
  constructor(private g: Game, x: number, z: number) {
    this.thug = g.peds.spawnMissionPed(randomLook(true), x, z, 0, 'Tough Guy', 'gang');
    this.thug.say(g, "Hey! You. Yeah, you. Let's see what you've got.");
    this.thug.hostile = true;
    this.thug.state = 'fight';
    this.thug.aggroT = 999;
    g.wanted.suppressed = true;
    g.markers.add('enc_b', { x: 0, z: 0, color: 0xff3355, kind: 'enemy', follow: () => (this.thug.alive && this.thug.knockT <= 0 ? this.thug.pos : null) });
  }
  update(dt: number) {
    const g = this.g;
    this.timer! -= dt;
    if (!this.thug.alive || (this.thug.knockT > 0 && this.thug.health < 30)) {
      g.progress.addCash(400, 'Won the street fight');
      g.progress.stat('encounters', 1);
      return 'done';
    }
    if (this.timer! <= 0 || this.thug.pos.distanceTo(g.player.pos) > 120) return 'fail';
    return 'running';
  }
  cleanup() {
    const g = this.g;
    g.wanted.suppressed = false;
    g.markers.remove('enc_b');
    this.thug.persistent = false;
    this.thug.hostile = false;
  }
}

// ---------------------------------------------------------------------------
export class ActivityManager {
  current: ActivityRun | null = null;
  private encounterT = 120;
  private slowmo = 0;
  private tokenPositions: { id: string; x: number; y: number; z: number }[] = [];
  private stranded: { ped: Ped; car: Vehicle; dest: { x: number; z: number } } | null = null;

  constructor(private g: Game) {}

  init() {
    const g = this.g;
    // activity start points
    for (const r of RACES) {
      g.markers.add(`act_${r.id}`, { x: r.grid.x, z: r.grid.z, color: r.timeTrial ? 0x29e6ff : 0xff2d95, kind: 'activity', radius: 3 });
      g.markers.addBlip({ id: `act_${r.id}`, x: r.grid.x, z: r.grid.z, glyph: r.timeTrial ? '⏱' : '⚑', color: r.timeTrial ? '#29e6ff' : '#ff2d95', label: r.timeTrial ? `Time Trial: ${r.name}` : `Street Race: ${r.name}`, kind: 'activity' });
      g.interact.add({
        id: `act_${r.id}`,
        x: r.grid.x,
        z: r.grid.z,
        r: 5,
        vehicle: 'require',
        label: `${r.timeTrial ? 'Time Trial' : 'Street Race'}: ${r.name}`,
        enabled: () => this.canStart() && !!g.player.vehicle && !g.player.vehicle.spec.boat,
        action: () =>
          g.openIntro(
            {
              title: r.name,
              type: r.timeTrial ? 'Time Trial' : 'Street Race',
              giver: 'Open-world activity',
              intro: r.desc,
              objective: r.timeTrial ? `Finish under ${formatTime(r.par!)}` : 'Finish in 1st place',
              instructions: ['Pass through every checkpoint in order.', r.timeTrial ? `Best: ${g.progress.best[r.id] ? formatTime(g.progress.best[r.id]) : '—'}` : `Rivals: ${r.rivals.length}`],
              reward: formatMoney(r.reward) + (g.progress.activitiesDone.has(r.id) ? ' (repeat bonus reduced)' : ''),
              accept: () => this.begin(new RaceActivity(g, r)),
              decline: () => {},
              isActivity: true,
            },
            r.grid.x,
            r.grid.z,
          ),
      });
    }
    // drift
    const lot = blockCenter(1, 11);
    g.markers.add('act_drift', { x: lot.x, z: lot.z, color: 0xff9a1f, kind: 'activity', radius: 3 });
    g.markers.addBlip({ id: 'act_drift', x: lot.x, z: lot.z, glyph: '≈', color: '#ff9a1f', label: 'Drift Challenge', kind: 'activity' });
    g.interact.add({
      id: 'act_drift',
      x: lot.x,
      z: lot.z,
      r: 6,
      vehicle: 'require',
      label: 'Drift Challenge',
      enabled: () => this.canStart() && !!g.player.vehicle && !g.player.vehicle.spec.boat && !g.player.vehicle.spec.bike,
      action: () =>
        g.openIntro(
          {
            title: 'Rustwater Drift Challenge',
            type: 'Vehicle Challenge',
            giver: 'Open-world activity',
            intro: 'Throw your car sideways around the Rustwater lots. Hold the angle to build a combo multiplier — hitting anything resets it.',
            objective: 'Score 15,000 drift points in 60 seconds.',
            instructions: ['Hold SPACE (handbrake) while steering to start a slide.', 'Feather the throttle to hold the angle.', `Best: ${(g.progress.best.drift ?? 0).toLocaleString()}`],
            reward: '$1,200',
            accept: () => this.begin(new DriftActivity(g)),
            decline: () => {},
            isActivity: true,
          },
          lot.x,
          lot.z,
        ),
    });
    // parkour
    const b0 = g.layout.parkourBoxes[0];
    const px = b0.x - 4,
      pz = b0.z - 6;
    g.markers.add('act_parkour', { x: px, z: pz, y: 0.1, color: 0x39ff88, kind: 'activity', radius: 1.5 });
    g.markers.addBlip({ id: 'act_parkour', x: px, z: pz, glyph: '⇧', color: '#39ff88', label: 'Rooftop Challenge', kind: 'activity' });
    g.interact.add({
      id: 'act_parkour',
      x: px,
      z: pz,
      r: 2.5,
      label: 'Rooftop Challenge',
      enabled: () => this.canStart(),
      action: () =>
        g.openIntro(
          {
            title: 'Market Row Rooftops',
            type: 'Parkour Challenge',
            giver: 'Open-world activity',
            intro: 'A free-running route across the rooftops of Market Row. Climb crates, mantle ledges and leap the gaps.',
            objective: 'Reach all 7 rooftop checkpoints in 2:30.',
            instructions: ['SPACE to jump. Jump into a ledge to climb it.', 'Hold SHIFT to sprint for longer jumps.', 'Falls over 4.5m hurt.'],
            reward: '$1,000',
            accept: () => this.begin(new ParkourActivity(g)),
            decline: () => {},
            isActivity: true,
          },
          px,
          pz,
        ),
    });
    this.placeTokens();
    this.placeTreasure();
    this.placeStaticPickups();
    // stunt blips
    for (const s of g.layout.stunts) {
      g.markers.addBlip({ id: `stunt_${s.id}`, x: s.x, z: s.z, glyph: '↗', color: g.progress.stunts.has(s.id) ? '#777' : '#f2c230', label: 'Stunt Jump', kind: 'activity' });
    }
  }

  canStart() {
    return !this.current?.blocking && !this.g.missions.active && this.g.wanted.level === 0;
  }

  begin(a: ActivityRun) {
    if (this.current) this.current.cleanup();
    this.current = a;
    this.g.ui.bigMessage(a.name.toUpperCase(), '', '#29e6ff');
  }

  private end(status: 'done' | 'fail') {
    const g = this.g;
    const a = this.current!;
    a.cleanup();
    this.current = null;
    g.ui.hud({ objective: '', objectiveDetail: '', timer: null, activityName: '' });
    if (a.result) {
      g.showResult({ success: a.result.success, title: a.result.title, reason: a.result.reason, reward: a.result.reward, lines: a.result.lines });
      g.audio.jingle(a.result.success);
    } else if (status === 'done') g.audio.jingle(true);
  }

  abort() {
    if (!this.current) return;
    this.current.cleanup();
    this.current = null;
    this.g.ui.hud({ objective: '', objectiveDetail: '', timer: null, activityName: '' });
  }

  // ---------- collectibles ----------
  private placeTokens() {
    const g = this.g;
    const L = g.layout;
    const pts: { x: number; y: number; z: number }[] = [];
    const alleys = L.alleyPoints;
    for (let i = 0; i < alleys.length && pts.length < 11; i += Math.max(1, Math.floor(alleys.length / 11))) pts.push({ x: alleys[i].x, y: 0.1, z: alleys[i].z });
    for (const r of L.rooftopPoints.slice(0, 6)) pts.push({ x: r.x, y: r.y, z: r.z });
    for (const z of [-560, -380, -120, 260, 520]) pts.push({ x: 670, y: terrainY(670, z), z });
    pts.push({ x: 1265, y: 0, z: -175 }, { x: 1120, y: 0, z: -450 }, { x: 1280, y: 0, z: -460 });
    pts.push({ x: -985, y: 0, z: -110 }, { x: -720, y: 0, z: 250 });
    pts.push({ x: -100, y: 0.4, z: 795 }, { x: 20, y: 0.4, z: 795 }, { x: 140, y: 0.4, z: 795 });
    pts.push({ x: 790, y: WATER_Y + 0.3, z: -312 });
    let k = 1;
    while (pts.length < 30 && k < alleys.length) {
      const a = alleys[(k * 7) % alleys.length];
      if (!pts.some((p) => Math.hypot(p.x - a.x, p.z - a.z) < 5)) pts.push({ x: a.x, y: 0.1, z: a.z });
      k++;
    }
    const coin = new THREE.CylinderGeometry(0.42, 0.42, 0.08, 20).rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x29e6ff, emissive: 0x29e6ff, emissiveIntensity: 1.2, metalness: 0.8, roughness: 0.2 });
    pts.slice(0, 30).forEach((p, i) => {
      const id = `tok_${i}`;
      this.tokenPositions.push({ id, ...p });
      if (g.progress.tokens.has(id)) return;
      const m = new THREE.Mesh(coin, mat);
      const y = Math.max(p.y, g.col.surfaceY(p.x, p.z, p.y + 0.5, 0.6));
      const pk = g.pickups.spawnMesh(p.x, y, p.z, m, () => {
        g.progress.tokens.add(id);
        const n = g.progress.tokens.size;
        g.progress.addCash(100, `Neon Token ${n}/30`);
        if (n % 10 === 0) g.progress.addCash(1000, `${n} tokens bonus`);
        if (n === 30) {
          g.progress.unlocked.add('zenith');
          g.progress.ownedVehicles.push('zenith');
          g.ui.notify('All tokens found! A Zenith R has been delivered to your garage.', 'achievement');
        }
        g.markers.removeBlip(`tokb_${i}`);
      }, { vehicleOk: true, radius: 1.8, tag: 'token' });
      void pk;
    });
  }

  tokensAll() {
    return this.tokenPositions;
  }

  private placeTreasure() {
    const g = this.g;
    const hunts = [
      { id: 'tr_a', clue: { x: 655, z: 500 }, chest: { x: 1262, z: -168 }, text: '"Where the light turns but never moves, the sea keeps my gold." — Captain V.', reward: 4000 },
      { id: 'tr_b', clue: { x: blockCenter(2, 5).x - 9, z: blockCenter(2, 5).z }, chest: { x: -985, z: -200 }, text: '"Behind the hangars where the big birds sleep." — J.', reward: 3500 },
      { id: 'tr_c', clue: { x: blockCenter(9, 6).x, z: blockCenter(9, 6).z }, chest: { x: 140, z: 797 }, text: '"At the end of the middle pier, past the last bollard." — anonymous', reward: 5000 },
    ];
    const scrollMat = new THREE.MeshStandardMaterial({ color: 0xf2e2b0, emissive: 0xa08040, emissiveIntensity: 0.4 });
    const chestMat = new THREE.MeshStandardMaterial({ color: 0x7a4a20, emissive: 0x402000, emissiveIntensity: 0.3, roughness: 0.7 });
    for (const h of hunts) {
      if (g.progress.treasures.has(h.id)) continue;
      const scroll = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 10).rotateZ(Math.PI / 2), scrollMat);
      const y = g.col.surfaceY(h.clue.x, h.clue.z, 20, 0);
      g.markers.addBlip({ id: `trc_${h.id}`, x: h.clue.x, z: h.clue.z, glyph: '✉', color: '#f2e2b0', label: 'Treasure clue', kind: 'collectible' });
      g.pickups.spawnMesh(h.clue.x, y, h.clue.z, scroll, () => {
        g.markers.removeBlip(`trc_${h.id}`);
        g.ui.subtitle('Treasure Map', h.text);
        g.ui.notify('A treasure search area has been marked on your map.', 'info');
        const cx = h.chest.x + (Math.random() - 0.5) * 60,
          cz = h.chest.z + (Math.random() - 0.5) * 60;
        g.markers.addBlip({ id: `tra_${h.id}`, x: cx, z: cz, glyph: '?', color: '#f2c230', label: 'Treasure search area', kind: 'collectible', radius: 55 });
        // chest
        const cy = g.col.surfaceY(h.chest.x, h.chest.z, 20, 0);
        const chest = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.6), chestMat);
        box.position.y = 0.27;
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), chestMat);
        lid.position.y = 0.55;
        chest.add(box, lid);
        chest.position.set(h.chest.x, cy, h.chest.z);
        g.scene.add(chest);
        g.interact.add({
          id: `chest_${h.id}`,
          x: h.chest.x,
          z: h.chest.z,
          r: 2.2,
          label: 'Open treasure chest',
          action: () => {
            g.progress.treasures.add(h.id);
            g.progress.addCash(h.reward, 'Treasure found!');
            g.player.giveWeapon('pistol', 24);
            g.interact.remove(`chest_${h.id}`);
            g.markers.removeBlip(`tra_${h.id}`);
            g.fx.sparkleBurst(chest.position, 0xffd27a);
            chest.removeFromParent();
            g.audio.jingle(true);
          },
        });
      }, { radius: 1.6, tag: 'treasure' });
    }
  }

  private placeStaticPickups() {
    const g = this.g;
    const hosp = g.layout.pois.find((p) => p.id === 'hospital')!;
    g.pickups.spawnHealth(hosp.ex + 3, hosp.ez, 60);
    for (const id of ['pd_central', 'pd_north', 'pd_harbor']) {
      const p = g.layout.pois.find((x) => x.id === id)!;
      g.pickups.spawnArmor(p.ex - 8, p.ez, 120);
    }
    const alleys = g.layout.alleyPoints;
    for (let i = 3; i < alleys.length; i += 9) g.pickups.spawnHealth(alleys[i].x + 1.2, alleys[i].z + 1.2, 90);
    const park = blockCenter(2, 5);
    g.pickups.spawnWeapon(park.x + 12, park.z + 12, 'bat', 0, 120);
    const ind = blockCenter(3, 10);
    g.pickups.spawnWeapon(ind.x + 1, ind.z - 1, 'pistol', 24, 180);
    g.pickups.spawnArmor(ISLAND.minX + 60, ISLAND.minZ + 40, 120);
    g.pickups.spawnHealth(-760, 80, 90);
  }

  // ---------- stunts ----------
  onAirborne(v: Vehicle) {
    if (v.driver !== 'player' || v.takeoffRamp === null) return;
    const ramp = this.g.col.ramps[v.takeoffRamp];
    if (!ramp?.stunt) return;
    if (v.airTime > 0.35 && this.slowmo === 0) {
      this.slowmo = 1;
      this.g.timeScale = 0.45;
    }
  }

  onLanded(v: Vehicle, air: number, dist: number) {
    const g = this.g;
    if (this.slowmo) {
      this.slowmo = 0;
      g.timeScale = 1;
    }
    if (v.driver !== 'player' || v.takeoffRamp === null) return;
    const ramp = g.col.ramps[v.takeoffRamp];
    if (!ramp?.stunt || air < 0.9) return;
    const s = g.layout.stunts.reduce((best, st) => (Math.hypot(st.x - ramp.cx, st.z - ramp.cz) < Math.hypot(best.x - ramp.cx, best.z - ramp.cz) ? st : best));
    const first = !g.progress.stunts.has(s.id);
    g.progress.stunts.add(s.id);
    g.progress.stat('stunts', 1);
    const bonus = first ? 500 + Math.round(dist * 10) : 0;
    g.ui.bigMessage(first ? 'UNIQUE STUNT BONUS!' : 'STUNT JUMP', `${dist.toFixed(1)} m  •  ${air.toFixed(2)} s air${bonus ? `  •  +${formatMoney(bonus)}` : ''}`, '#f2c230');
    if (bonus) g.progress.addCash(bonus);
    const b = g.markers.blips.get(`stunt_${s.id}`);
    if (b) b.color = '#777';
    g.audio.jingle(true);
  }

  // ---------- random encounters ----------
  private spawnEncounter() {
    const g = this.g;
    const p = g.player.pos;
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2,
        d = 35 + Math.random() * 35;
      const b = locateBlock(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d);
      if (!b || b.bi < 0 || b.bj < 0 || b.bi >= BLOCKS || b.bj >= BLOCKS) continue;
      const pt = perimeterPoint(b.bi, b.bj, Math.random() * 320);
      const r = Math.random();
      if (r < 0.4 && !g.player.vehicle) {
        this.begin(new EncounterThief(g, pt.x, pt.z));
        g.ui.notify('Random encounter: a purse snatcher!', 'warn');
      } else if (r < 0.7 && !g.player.vehicle) {
        this.begin(new EncounterBrawl(g, pt.x, pt.z));
        g.ui.notify('Random encounter: street fight!', 'warn');
      } else if (!this.stranded) {
        // stranded motorist with a smoking car
        const car = g.vehicles.spawn('comet', pt.x + (pt.x % 2 > 1 ? 2 : -2), pt.z, Math.random() * 6);
        car.health = car.spec.health * 0.2;
        car.persistent = true;
        car.locked = true;
        const ped = g.peds.spawnMissionPed(randomLook(), pt.x + 2.5, pt.z + 2.5, 0, 'Stranded Driver', 'mission');
        ped.dialogue = ['My car died! Can you give me a lift?'];
        ped.state = 'stand';
        const dest = perimeterPoint(Math.floor(Math.random() * BLOCKS), Math.floor(Math.random() * BLOCKS), Math.random() * 320);
        this.stranded = { ped, car, dest };
        g.markers.add('enc_s', { x: 0, z: 0, color: 0x39ff88, kind: 'objective', follow: () => (this.stranded ? this.stranded.ped.pos : null) });
        g.markers.addBlip({ id: 'enc_s', x: pt.x, z: pt.z, glyph: '!', color: '#39ff88', label: 'Stranded driver', kind: 'objective' });
        g.interact.add({
          id: 'enc_s',
          x: ped.pos.x,
          z: ped.pos.z,
          r: 12,
          vehicle: 'require',
          label: 'Offer the stranded driver a lift',
          enabled: () => !!this.stranded && !this.current,
          action: () => {
            const s = this.stranded!;
            g.interact.remove('enc_s');
            g.markers.remove('enc_s');
            g.markers.removeBlip('enc_s');
            s.ped.say(g, 'Thank you! Take me to the marked spot, please.');
            this.begin(new TaxiActivity(g, g.player.vehicle!, s.ped, s.dest));
            setTimeout(() => {
              if (g.vehicles.list.includes(s.car) && g.player.vehicle !== s.car) {
                s.car.persistent = false;
                s.car.locked = false;
              }
            }, 1000);
            this.stranded = null;
          },
        });
        g.ui.notify('Random encounter: a stranded driver needs a lift.', 'info');
      }
      return;
    }
  }

  update(dt: number) {
    const g = this.g;
    const p = g.player;
    // taxi job toggle
    if (g.controlsEnabled() && g.input.hit('KeyT') && p.vehicle && p.vehicle.spec.cls === 'taxi') {
      if (this.current instanceof TaxiActivity) {
        (this.current as TaxiActivity).endShift();
        this.abort();
      } else if (this.canStart()) {
        this.begin(new TaxiActivity(g, p.vehicle));
      }
    }
    if (p.vehicle && p.vehicle.spec.cls === 'taxi' && !this.current && !g.missions.active) g.ui.hud({ activityName: 'Press T to start a taxi shift' });
    else if (!this.current) g.ui.hud({ activityName: '' });
    if (this.current) {
      const st = this.current.update(dt);
      if (!g.missions.active) g.ui.hud({ objective: this.current.objective, objectiveDetail: this.current.detail, timer: this.current.timer, activityName: this.current.name });
      if (st !== 'running') this.end(st);
    }
    // vehicle airborne slow-mo for stunts
    if (p.vehicle && !p.vehicle.grounded) this.onAirborne(p.vehicle);
    else if (this.slowmo && (!p.vehicle || p.vehicle.grounded)) {
      this.slowmo = 0;
      g.timeScale = 1;
    }
    // random encounters
    if (!this.current && !g.missions.active && g.wanted.level === 0) {
      this.encounterT -= dt;
      if (this.encounterT <= 0) {
        this.encounterT = 100 + Math.random() * 120;
        this.spawnEncounter();
      }
    }
    if (this.stranded && this.stranded.ped.pos.distanceTo(p.pos) > 220) {
      const s = this.stranded;
      g.interact.remove('enc_s');
      g.markers.remove('enc_s');
      g.markers.removeBlip('enc_s');
      if (g.peds.list.includes(s.ped)) g.peds.remove(s.ped);
      if (g.vehicles.list.includes(s.car) && g.player.vehicle !== s.car) g.vehicles.remove(s.car);
      this.stranded = null;
    }
    if (this.stranded) {
      const it = g.interact.list.get('enc_s');
      if (it) {
        it.x = this.stranded.ped.pos.x;
        it.z = this.stranded.ped.pos.z;
      }
    }
  }
}
