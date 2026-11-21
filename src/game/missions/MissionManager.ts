import { formatMoney } from '../core/math';
import type { Game } from '../Game';
import type { Ped } from '../ai/Pedestrian';
import type { Vehicle } from '../vehicles/Vehicle';
import { MissionDef, MissionRun } from './MissionBase';
import { MISSIONS, missionRewardText, placeMissionStarts } from './Missions';

export class MissionManager {
  active: MissionRun | null = null;
  private givers = new Map<string, Ped>();
  private startTime = 0;

  constructor(private g: Game) {
    placeMissionStarts(g);
  }

  get defs() {
    return MISSIONS;
  }

  available(): MissionDef[] {
    const done = this.g.progress.missions;
    return MISSIONS.filter((m) => !done.has(m.id) && m.requires.every((r) => done.has(r)));
  }

  refresh() {
    const g = this.g;
    g.markers.removePrefix('ms_');
    g.interact.removePrefix('ms_');
    if (this.active) return;
    for (const m of this.available()) {
      g.markers.add(`ms_${m.id}`, { x: m.start.x, z: m.start.z, y: g.col.surfaceY(m.start.x, m.start.z, 50, 0), color: 0xffd000, kind: 'mission', radius: 1.6 });
      g.markers.addBlip({ id: `ms_${m.id}`, x: m.start.x, z: m.start.z, glyph: m.giver[0], color: '#ffd000', label: `Mission: ${m.title}`, kind: 'mission' });
      g.interact.add({
        id: `ms_${m.id}`,
        x: m.start.x,
        z: m.start.z,
        r: 2.6,
        label: `Start mission: ${m.title}`,
        enabled: () => !this.active && !g.activities.current && g.wanted.level === 0,
        action: () => this.offer(m),
      });
    }
  }

  offer(m: MissionDef) {
    const g = this.g;
    g.openIntro(
      {
        title: m.title,
        type: m.type,
        giver: m.giver,
        intro: m.intro,
        objective: m.objective,
        instructions: m.instructions,
        reward: missionRewardText(m),
        accept: () => this.begin(m),
        decline: () => {},
      },
      m.start.x,
      m.start.z,
    );
  }

  begin(m: MissionDef) {
    const g = this.g;
    this.clearGivers();
    g.markers.removePrefix('ms_');
    g.interact.removePrefix('ms_');
    this.active = m.create(g, m);
    this.startTime = g.time;
    this.active.start();
    g.ui.bigMessage(m.title.toUpperCase(), m.type, '#ffd000');
    g.audio.jingle(true);
  }

  update(dt: number) {
    const g = this.g;
    const a = this.active;
    if (a) {
      const st = a.update(dt);
      g.ui.hud({ objective: a.objective, objectiveDetail: a.detail, timer: a.timer, missionActive: true });
      if (st === 'success') this.complete();
      else if (st === 'fail') this.failMission(a.failReason);
    } else {
      // giver NPCs near their markers
      for (const m of this.available()) {
        const d = Math.hypot(g.player.pos.x - m.start.x, g.player.pos.z - m.start.z);
        const ped = this.givers.get(m.id);
        if (d < 120 && !ped) {
          const yaw = m.start.yaw;
          const p = g.peds.spawnMissionPed(m.giverLook, m.start.x + Math.sin(yaw) * 1.5, m.start.z + Math.cos(yaw) * 1.5, yaw + Math.PI, m.giver);
          p.dialogue = ["You ready to work?", 'Step into the marker when you are ready.', 'Time is money in this city.'];
          this.givers.set(m.id, p);
        } else if (ped && (d > 160 || !ped.alive)) {
          if (!ped.alive && ped.deadT < 15) continue;
          g.peds.remove(ped);
          this.givers.delete(m.id);
        }
      }
    }
  }

  private clearGivers() {
    for (const p of this.givers.values()) if (this.g.peds.list.includes(p)) this.g.peds.remove(p);
    this.givers.clear();
  }

  private complete() {
    const g = this.g;
    const a = this.active!;
    const m = a.def;
    const time = g.time - this.startTime;
    a.cleanup();
    this.active = null;
    g.progress.missions.add(m.id);
    g.progress.addCash(m.reward);
    g.progress.stat('missionsPassed', 1);
    if (m.id === 'm1') {
      g.progress.unlocked.add('vortex');
      g.progress.discounts.vortex = 0.25;
    }
    if (m.id === 'm3') {
      g.progress.unlocked.add('zenith');
      g.progress.discounts.zenith = 0.25;
    }
    if (m.id === 'm6') g.progress.discounts.sh_villa = 0.5;
    if (MISSIONS.filter((x) => x.story).every((x) => g.progress.missions.has(x.id))) g.progress.achieve('story_done');
    const next = this.available().map((x) => x.title);
    g.ui.hud({ objective: '', objectiveDetail: '', timer: null, missionActive: false });
    g.showResult({
      success: true,
      title: m.title,
      reward: missionRewardText(m),
      lines: [`Time: ${Math.floor(time / 60)}m ${Math.floor(time % 60)}s`, `Cash: ${formatMoney(g.progress.cash)}`, next.length ? `New missions: ${next.join(', ')}` : 'All available missions complete!'],
    });
    g.audio.jingle(true);
    g.save.save();
    this.refresh();
  }

  failMission(reason: string) {
    const g = this.g;
    const a = this.active;
    if (!a) return;
    const m = a.def;
    a.cleanup();
    this.active = null;
    g.ui.hud({ objective: '', objectiveDetail: '', timer: null, missionActive: false });
    g.showResult({
      success: false,
      title: m.title,
      reason,
      lines: ['Return to the yellow marker to try again.'],
      retry: () => {
        if (g.player.alive) this.begin(m);
      },
    });
    g.audio.jingle(false);
    this.refresh();
  }

  abort() {
    const a = this.active;
    if (!a) return;
    a.cleanup();
    this.active = null;
    this.g.ui.hud({ objective: '', objectiveDetail: '', timer: null, missionActive: false });
    this.g.ui.notify('Mission abandoned', 'warn');
    this.refresh();
  }

  onPedKilled(p: Ped, _src: unknown) {
    this.active?.onPedKilled(p);
  }
  onVehicleDestroyed(v: Vehicle) {
    this.active?.onVehicleDestroyed(v);
  }
  onWantedCleared() {
    this.active?.onWantedCleared();
  }
  onTalk(p: Ped) {
    return this.active ? this.active.onTalk(p) : false;
  }
  onEnterVehicle(v: Vehicle) {
    this.active?.onEnterVehicle(v);
  }
}
