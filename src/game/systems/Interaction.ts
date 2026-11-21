import type { Game } from '../Game';
import type { Ped } from '../ai/Pedestrian';

export interface Interactable {
  id: string;
  x: number;
  z: number;
  y?: number;
  r: number;
  label: string | (() => string);
  enabled?: () => boolean;
  action: () => void;
  vehicle?: 'allow' | 'require' | 'forbid';
}

/** Context-sensitive "Press E" interactions: places, mission markers, pedestrians. */
export class InteractionSystem {
  list = new Map<string, Interactable>();
  current: Interactable | null = null;
  talkPed: Ped | null = null;

  constructor(private g: Game) {}

  add(i: Interactable) {
    this.list.set(i.id, i);
  }
  remove(id: string) {
    this.list.delete(id);
  }
  removePrefix(p: string) {
    for (const k of [...this.list.keys()]) if (k.startsWith(p)) this.list.delete(k);
  }

  update() {
    const g = this.g;
    const p = g.player;
    const inV = !!p.vehicle;
    let best: Interactable | null = null,
      bd = Infinity;
    for (const it of this.list.values()) {
      if (it.enabled && !it.enabled()) continue;
      const mode = it.vehicle ?? 'forbid';
      if (inV && mode === 'forbid') continue;
      if (!inV && mode === 'require') continue;
      const d = Math.hypot(p.pos.x - it.x, p.pos.z - it.z);
      if (d > it.r * (inV ? 1.5 : 1)) continue;
      if (it.y !== undefined && Math.abs(p.pos.y - it.y) > 3) continue;
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    this.current = best;
    this.talkPed = null;
    if (!best && !inV && p.alive) {
      // talk to a calm pedestrian
      let bp: Ped | null = null,
        pd = 2.4;
      for (const ped of g.peds.list) {
        if (!ped.alive || ped.knockT > 0 || ped.hostile) continue;
        if (ped.role === 'police' || ped.role === 'swat') continue;
        if (ped.state === 'flee' || ped.state === 'fight' || ped.state === 'cower') continue;
        const d = Math.hypot(ped.pos.x - p.pos.x, ped.pos.z - p.pos.z);
        if (d < pd) {
          pd = d;
          bp = ped;
        }
      }
      this.talkPed = bp;
    }
    const label = best ? (typeof best.label === 'string' ? best.label : best.label()) : this.talkPed ? (p.aiming && !p.weaponDef.melee ? 'Rob' : `Talk${this.talkPed.name ? ' to ' + this.talkPed.name : ''}`) : null;
    g.ui.setPrompt(label);
    if (g.controlsEnabled() && g.input.hit('KeyE')) {
      if (best) {
        best.action();
        g.audio.ui();
      } else if (this.talkPed) this.talk(this.talkPed);
    }
  }

  private talk(ped: Ped) {
    const g = this.g;
    const p = g.player;
    ped.yaw = Math.atan2(p.pos.x - ped.pos.x, p.pos.z - ped.pos.z);
    p.action = 'interact';
    p.actionT = 0;
    if (p.aiming && !p.weaponDef.melee && ped.role !== 'mission') {
      ped.state = 'cower';
      ped.timer = 5;
      const amt = 20 + Math.floor(Math.random() * 100);
      g.pickups.spawnCash(ped.pos.x + Math.sin(ped.yaw) * 0.8, ped.pos.z + Math.cos(ped.yaw) * 0.8, amt);
      ped.say(g, "Okay, okay! Take it, just don't hurt me!");
      g.wanted.crime('mugging', ped.pos.x, ped.pos.z);
      g.progress.stat('muggings', 1);
      return;
    }
    if (g.missions.onTalk(ped)) return;
    if (ped.role === 'gang') {
      ped.say(g, pickLine(["You lost? This is our turf.", "Walk away while you still can.", "You got a problem with me?"]));
      if (Math.random() < 0.3) {
        ped.hostile = true;
        ped.state = 'fight';
        ped.aggroT = 20;
      }
      return;
    }
    ped.say(g);
    if (ped.state === 'walk') {
      ped.state = 'idle';
      ped.timer = 3;
    }
  }
}

const pickLine = (a: string[]) => a[Math.floor(Math.random() * a.length)];
