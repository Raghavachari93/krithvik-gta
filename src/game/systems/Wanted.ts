import type { Game } from '../Game';

export type CrimeType =
  | 'assault'
  | 'kill'
  | 'hitPed'
  | 'carjack'
  | 'policeCar'
  | 'assaultCop'
  | 'killCop'
  | 'shooting'
  | 'explosion'
  | 'destroyVehicle'
  | 'mugging'
  | 'ramCop';

const HEAT: Record<CrimeType, number> = {
  assault: 70,
  kill: 170,
  hitPed: 60,
  carjack: 90,
  policeCar: 160,
  assaultCop: 220,
  killCop: 400,
  shooting: 30,
  explosion: 140,
  destroyVehicle: 90,
  mugging: 70,
  ramCop: 120,
};
const MIN_LEVEL: Partial<Record<CrimeType, number>> = { killCop: 3, assaultCop: 2, policeCar: 1, explosion: 2, kill: 1 };
export const THRESH = [0, 1, 160, 430, 860, 1450, 2300];
export const LEVEL_DESC = ['', 'Local police investigate', 'More units respond', 'Roadblocks & aggressive pursuit', 'Tactical response', 'City-wide pursuit', 'Maximum law enforcement'];

export class WantedSystem {
  level = 0;
  heat = 0;
  lastKnown = { x: 0, z: 0 };
  seenT = 0;
  seen = false;
  searching = false;
  maxThisChase = 0;
  suppressed = false; // missions can disable wanted gain
  private cooldown = new Map<string, number>();
  private witnessNoteT = -99;
  playerVehicleWhenSeen: number | null = null;

  constructor(private g: Game) {}

  get searchRadius() {
    return 90 + this.level * 45;
  }
  get evadeTime() {
    return 7 + this.level * 3.5;
  }

  crime(type: CrimeType, x: number, z: number) {
    const g = this.g;
    if (this.suppressed || g.cheats.noWanted) return;
    const now = g.time;
    const cd = this.cooldown.get(type) ?? -99;
    if (type === 'shooting' && now - cd < 1.2) return;
    if (now - cd < 0.25) return;
    this.cooldown.set(type, now);
    // police witnesses report immediately; already-wanted crimes add heat if police are on you
    if (g.police.canWitness(x, z) || (this.level > 0 && this.seenT < 6)) {
      this.report(type, x, z, true);
      return;
    }
    if (type === 'shooting' && Math.random() < 0.5) return;
    const w = g.peds.findWitness(x, z, 42);
    if (w) {
      w.witnessT = 3.6;
      w.witnessCrime = type;
      w.threat.x = x;
      w.threat.z = z;
      if (now - this.witnessNoteT > 8) {
        this.witnessNoteT = now;
        g.ui.notify('A witness is calling the police! Stop them!', 'warn');
      }
    }
  }

  witnessReport(type: string, x: number, z: number) {
    if (this.suppressed || this.g.cheats.noWanted) return;
    this.report(type as CrimeType, x, z, false);
    this.g.ui.notify('A witness reported you to the police', 'bad');
  }

  report(type: CrimeType, x: number, z: number, direct: boolean) {
    const g = this.g;
    const before = this.level;
    this.heat += HEAT[type] ?? 50;
    const min = MIN_LEVEL[type] ?? 1;
    if (this.heat < THRESH[min]) this.heat = THRESH[min];
    this.recompute();
    if (direct) {
      this.lastKnown.x = g.player.pos.x;
      this.lastKnown.z = g.player.pos.z;
      this.seenT = 0;
    } else {
      this.lastKnown.x = x;
      this.lastKnown.z = z;
      this.seenT = Math.max(this.seenT, 3);
    }
    if (this.level > before) this.onLevelUp(before);
  }

  setLevel(n: number) {
    const before = this.level;
    this.heat = Math.max(this.heat, THRESH[n]);
    this.recompute();
    this.lastKnown.x = this.g.player.pos.x;
    this.lastKnown.z = this.g.player.pos.z;
    this.seenT = 0;
    if (this.level > before) this.onLevelUp(before);
  }

  private onLevelUp(before: number) {
    const g = this.g;
    g.audio.wantedUp();
    g.ui.notify(`Wanted level ${this.level}: ${LEVEL_DESC[this.level]}`, 'bad');
    this.maxThisChase = Math.max(this.maxThisChase, this.level);
    g.progress.highestWanted(this.level);
    if (before === 0) g.progress.stat('chases', 1);
  }

  private recompute() {
    let l = 0;
    for (let i = 1; i < THRESH.length; i++) if (this.heat >= THRESH[i]) l = i;
    this.level = Math.min(6, l);
  }

  clear(evaded = true) {
    const g = this.g;
    if (this.level === 0) return;
    if (evaded) {
      g.ui.notify('You lost the cops!', 'good');
      g.progress.stat('evaded', 1);
      if (this.maxThisChase >= 3) g.progress.achieve('escape_artist');
      g.missions.onWantedCleared();
    }
    this.level = 0;
    this.heat = 0;
    this.seenT = 0;
    this.maxThisChase = 0;
    this.searching = false;
    g.police.standDown();
  }

  update(dt: number) {
    const g = this.g;
    if (this.level === 0) return;
    const p = g.player;
    this.seen = g.police.playerSeen;
    if (this.seen) {
      this.lastKnown.x = p.pos.x;
      this.lastKnown.z = p.pos.z;
      this.seenT = 0;
      this.playerVehicleWhenSeen = p.vehicle ? p.vehicle.id : null;
      // sustained pursuit escalates slowly (up to level 4)
      if (this.heat < THRESH[4] + 1) {
        this.heat += dt * (this.level < 3 ? 2.2 : 1.6);
        const before = this.level;
        this.recompute();
        if (this.level > before) this.onLevelUp(before);
      }
    } else this.seenT += dt;
    this.searching = this.seenT > 3;
    const d = Math.hypot(p.pos.x - this.lastKnown.x, p.pos.z - this.lastKnown.z);
    if (this.seenT > this.evadeTime && (d > this.searchRadius || this.seenT > 35 + this.level * 8)) this.clear(true);
  }
}
