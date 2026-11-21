import { roadC, blockCenter, WATER_Y } from '../constants';
import { formatMoney } from '../core/math';
import type { Game } from '../Game';
import type { Ped } from '../ai/Pedestrian';
import { randomLook, CharacterLook } from '../characters/CharacterModel';
import { AIDriver } from '../vehicles/AIDriver';
import type { Vehicle } from '../vehicles/Vehicle';
import { MissionDef, MissionRun, MissionStatus } from './MissionBase';
import { RaceController } from './Race';

const MARI: CharacterLook = { skin: 0xc68e64, shirt: 0xd01c2a, pants: 0x1c1c1e, shoes: 0x111111, hair: 0x1a1410, hairStyle: 1, height: 0.97, build: 0.93, jacket: 0x1c1c1e };
const DEX: CharacterLook = { skin: 0xf1d3b8, shirt: 0xf2f2f2, pants: 0x2a3a5a, shoes: 0xf0f0f0, hair: 0xd8c08a, hairStyle: 0, height: 1.02, build: 1.0, jacket: 0x29a6c6 };
const REYES: CharacterLook = { skin: 0x9c6a44, shirt: 0xe8e8e8, pants: 0x3a3a3e, shoes: 0x2a1a10, hair: 0x2a2a2a, hairStyle: 0, height: 1.04, build: 1.08, jacket: 0x6a5a48 };
const LENA: CharacterLook = { skin: 0xe0b48f, shirt: 0xa8e6cf, pants: 0xc8c0b0, shoes: 0xf0f0f0, hair: 0x6b4a2a, hairStyle: 1, height: 0.95, build: 0.9 };

const poi = (g: Game, id: string) => g.layout.pois.find((p) => p.id === id)!;

// ------------------------------------------------------------------ M1
class WelcomeMission extends MissionRun {
  car!: Vehicle;
  start() {
    const g = this.g;
    this.car = this.vehicle('vortex', roadC(10) + 30, roadC(7) + 6, Math.PI / 2, 0xd01c2a);
    this.car.fuel = this.car.spec.fuelCap;
    this.marker({ x: 0, z: 0, color: 0x29e6ff, kind: 'objective', follow: () => (this.stage === 0 ? this.car.pos : null) });
    this.blip('car', this.car.pos.x, this.car.pos.z, '🚗', '#29e6ff', 'Vortex GT', () => (this.stage === 0 ? this.car.pos : null));
    this.setStage(0, 'Get in the red Vortex GT parked on Vice St.');
    this.gps(this.car.pos.x, this.car.pos.z);
    this.say('Marisol Vega', "Red Vortex on Vice Street. The owner owes me. Bring it to my garage in Rustwater — in one piece.");
    void g;
  }
  tick(): MissionStatus {
    const g = this.g;
    const garage = poi(g, 'garage_vega');
    if (this.car.destroyed) return this.fail('The Vortex GT was destroyed.');
    if (this.stage === 0) {
      if (g.player.vehicle === this.car) {
        this.setStage(1, "Deliver the Vortex GT to Vega's Garage in Rustwater.", 'Keep the car above 30% condition.');
        this.timer = 200;
        this.marker({ x: garage.ex, z: garage.ez, color: 0xffd000, kind: 'mission', radius: 4 });
        this.blip('drop', garage.ex, garage.ez, '★', '#ffd000', "Vega's Garage");
        this.gps(garage.ex, garage.ez);
      }
    } else {
      if (this.car.healthPct < 0.3) return this.fail("The car is too damaged — Vega won't take it.");
      this.detail = `Car condition: ${Math.round(this.car.healthPct * 100)}%`;
      if (g.player.vehicle !== this.car) this.detail = 'Get back in the Vortex GT!';
      if (g.player.vehicle === this.car && Math.hypot(this.car.pos.x - garage.ex, this.car.pos.z - garage.ez) < 8 && this.car.speed < 3) return 'success';
    }
    return 'running';
  }
}

// ------------------------------------------------------------------ M2
class DeliveryMission extends MissionRun {
  got = 0;
  drop = { x: -420, z: 648 };
  start() {
    const spots = [
      { ...blockCenter(10, 7), n: 'Neon Strip alley' },
      { x: 700, z: -60, n: 'North beach' },
      { ...blockCenter(6, 6), n: 'Downtown alley' },
    ];
    spots.forEach((s, i) => {
      const y = this.g.col.surfaceY(s.x, s.z, 50, 0);
      const mid = this.marker({ x: s.x, z: s.z, y, color: 0xffa020, kind: 'pickup' });
      const bid = this.blip(`pkg${i}`, s.x, s.z, '📦', '#ffa020', 'Package');
      this.item(s.x, y, s.z, 0xb07a3a, () => {
        this.got++;
        this.clearMarker(mid);
        this.clearMarker(bid);
        this.g.ui.notify(`Package collected (${this.got}/3)`, 'good');
        this.nextGps();
      });
    });
    this.timer = 360;
    this.setStage(0, 'Collect the 3 packages hidden around the city.', '0/3 collected');
    this.say('Marisol Vega', 'Three packages, three drops. Pick them up and bring them to the warehouse at the docks. Clock is ticking.');
    this.nextGps();
  }
  private nextGps() {
    const remaining = this.pickups.filter((p) => this.g.pickups.list.includes(p));
    if (remaining.length) {
      const p = this.g.player.pos;
      remaining.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      this.gps(remaining[0].x, remaining[0].z);
    }
  }
  tick(): MissionStatus {
    if (this.stage === 0) {
      this.detail = `${this.got}/3 collected`;
      if (this.got >= 3) {
        this.setStage(1, 'Deliver the packages to the dockside warehouse.');
        this.marker({ x: this.drop.x, z: this.drop.z, color: 0xffd000, kind: 'mission', radius: 4 });
        this.blip('drop', this.drop.x, this.drop.z, '★', '#ffd000', 'Warehouse');
        this.gps(this.drop.x, this.drop.z);
      }
    } else if (this.dist(this.drop.x, this.drop.z) < 7 && (!this.g.player.vehicle || this.g.player.vehicle.speed < 3)) return 'success';
    return 'running';
  }
}

// ------------------------------------------------------------------ M3
const CIRCUIT = [
  [9, 4],
  [12, 4],
  [12, 8],
  [8, 8],
  [8, 6],
  [5, 6],
  [5, 2],
  [9, 2],
].map(([i, j]) => ({ x: roadC(i), z: roadC(j) }));

class CircuitMission extends MissionRun {
  race!: RaceController;
  start() {
    const g = this.g;
    g.env.skipTo(23.4);
    this.race = new RaceController(g, { id: this.def.id, checkpoints: CIRCUIT, grid: { x: roadC(9), z: roadC(1) + 22, yaw: 0 }, rivals: ['stallion', 'vortex', 'zenith'], playerSpec: 'vortex', rivalSkill: 0.9 });
    this.race.setup();
    this.setStage(0, 'Win the Midnight Circuit street race.');
    this.say('Dex Moreno', "One lap, eight checkpoints, no rules. Beat my crew and you'll have friends at Apex Exotics.");
  }
  tick(dt: number): MissionStatus {
    const r = this.race.update(dt);
    this.detail = this.race.started ? `Checkpoint ${Math.min(this.race.cp + 1, CIRCUIT.length)}/${CIRCUIT.length}` : 'Get ready...';
    if (r === 'won') {
      this.g.progress.stat('racesWon', 1);
      return 'success';
    }
    if (r === 'lost') return this.fail(`You finished ${this.race.place === 2 ? '2nd' : this.race.place === 3 ? '3rd' : 'last'}. Only first place counts.`);
    if (r === 'dnf') return this.fail('You abandoned the race.');
    return 'running';
  }
  cleanup() {
    this.race.cleanup();
    super.cleanup();
  }
}

// ------------------------------------------------------------------ M4
class ChaseMission extends MissionRun {
  target!: Vehicle;
  informant: Ped | null = null;
  airport = { x: -900, z: 0 };
  start() {
    this.target = this.vehicle('comet', roadC(9) + 20, roadC(7) - 2, -Math.PI / 2, 0x8a8f96);
    this.target.npcDriver = true;
    this.target.locked = true;
    this.target.rig.driverDummy.visible = true;
    this.setStage(0, 'Find the informant at Vice St & Flamingo Ave.');
    this.marker({ x: 0, z: 0, color: 0xff3355, kind: 'enemy', follow: () => (this.target.destroyed || this.stage > 1 ? null : this.target.pos) });
    this.blip('t', 0, 0, '◆', '#ff3355', 'Informant', () => (this.stage <= 1 && !this.target.destroyed ? this.target.pos : null));
    this.gps(this.target.pos.x, this.target.pos.z);
    this.say('Marisol Vega', "Rat Ruiz has been talking to the cops about us. He's parked on Vice Street. Make sure he never testifies.");
  }
  private bail() {
    const g = this.g;
    const t = this.target;
    t.npcDriver = false;
    t.rig.driverDummy.visible = false;
    t.driver = null;
    t.ai = null;
    t.locked = false;
    const p = this.ped(randomLook(), t.pos.x + Math.cos(t.yaw) * 2, t.pos.z - Math.sin(t.yaw) * 2, t.yaw, 'Rat Ruiz', 'civ');
    p.persistent = true;
    p.startFlee(g.player.pos.x, g.player.pos.z, 999);
    p.walkSpeed = 2;
    this.informant = p;
    this.marker({ x: 0, z: 0, color: 0xff3355, kind: 'enemy', follow: () => (p.alive && p.knockT <= 0 ? p.pos : p.alive ? p.pos : null) });
    this.blip('inf', 0, 0, '◆', '#ff3355', 'Rat Ruiz', () => (p.alive ? p.pos : null));
    this.setStage(2, 'Rat bailed out of the car! Take him down.');
  }
  tick(): MissionStatus {
    const g = this.g;
    const t = this.target;
    if (this.stage === 0) {
      if (this.dist(t.pos.x, t.pos.z) < 75) {
        t.driver = 'ai';
        const ai = new AIDriver(t);
        ai.mode = 'goto';
        ai.target = this.airport;
        ai.skill = 0.78;
        t.ai = ai;
        this.setStage(1, 'He spotted you! Stop the informant before he reaches the airport.', 'Wreck his car');
        g.audio.horn(t.pos);
      }
      return 'running';
    }
    if (this.stage === 1) {
      this.gps(t.pos.x, t.pos.z);
      const d = this.dist(t.pos.x, t.pos.z);
      this.detail = `Car condition: ${Math.round(t.healthPct * 100)}%  •  Distance: ${Math.round(d)}m`;
      if (t.destroyed) {
        this.setStage(3, 'The informant is dealt with. The cops are onto you — lose them!');
        g.wanted.setLevel(3);
        return 'running';
      }
      if (t.healthPct < 0.3 || (t.submerged && t.ai)) {
        this.bail();
        return 'running';
      }
      if (Math.hypot(t.pos.x - this.airport.x, t.pos.z - this.airport.z) < 60) return this.fail('The informant escaped at the airport.');
      if (d > 380) return this.fail('You lost the informant.');
      return 'running';
    }
    if (this.stage === 2) {
      const p = this.informant!;
      this.gps(p.pos.x, p.pos.z);
      if (!p.alive || p.knockT > 0) {
        this.setStage(3, 'Rat Ruiz is down. The cops are onto you — lose them!');
        g.wanted.setLevel(3);
      } else if (this.dist(p.pos.x, p.pos.z) > 250) return this.fail('Rat Ruiz got away.');
      return 'running';
    }
    if (this.stage === 3) {
      g.nav.missionTarget = null;
      this.detail = g.wanted.searching ? 'Stay out of sight...' : 'Break line of sight with the police';
      if (g.wanted.level === 0) return 'success';
    }
    return 'running';
  }
  onWantedCleared() {
    /* handled in tick */
  }
}

// ------------------------------------------------------------------ M5
class InvestigationMission extends MissionRun {
  reyes!: Ped;
  lena!: Ped;
  clues = 0;
  thugs: Ped[] = [];
  hideout = { x: -262, z: 652 };
  talked = false;
  start() {
    const g = this.g;
    const st = poi(g, 'pd_central');
    this.reyes = this.ped(REYES, st.ex + 3, st.ez - 1, 0, 'Det. Owen Reyes');
    const taco = poi(g, 'diner_taco');
    const clueSpots = [
      { x: taco.x + 14, z: taco.z, text: 'A torn shipping manifest stuffed in the dumpster: "HARBOR — CRATES 12-16 — R.M."' },
      { ...blockCenter(7, 10), text: 'Tyre marks and a dropped business card: "Rustwater Freight — ask for Lena on Ocean Drive."' },
      { x: blockCenter(2, 5).x + 9, z: blockCenter(2, 5).z, text: 'Under the bench: a burner phone with one number saved — "LENA".' },
    ];
    clueSpots.forEach((c, i) => {
      const mid = this.marker({ x: c.x, z: c.z, y: g.col.surfaceY(c.x, c.z, 50, 0), color: 0x9a6aff, kind: 'objective' });
      const bid = this.blip(`clue${i}`, c.x, c.z, '?', '#9a6aff', 'Clue');
      const iid = this.interact(`clue${i}`, c.x, c.z, 'Search for clues', () => {
        this.say('Clue', c.text);
        this.clues++;
        this.clearMarker(mid);
        this.clearMarker(bid);
        g.interact.remove(iid);
        g.player.action = 'interact';
        g.player.actionT = 0;
        if (this.clues >= 3) this.toWitness();
        else this.detail = `${this.clues}/3 clues found`;
      });
    });
    this.setStage(0, 'Search the three marked locations for clues.', '0/3 clues found');
    this.say('Det. Owen Reyes', "Somebody's running guns through my harbor. Find me the ledger and I'll make your record disappear.");
  }
  private toWitness() {
    const g = this.g;
    this.lena = this.ped(LENA, 627, -110, Math.PI / 2, 'Lena Park');
    this.marker({ x: 0, z: 0, color: 0x9a6aff, kind: 'objective', follow: () => (this.stage === 1 ? this.lena.pos : null) });
    this.blip('lena', 627, -110, 'L', '#9a6aff', 'Lena Park', () => (this.stage === 1 ? this.lena.pos : null));
    this.gps(627, -110);
    this.setStage(1, 'Talk to Lena Park on the Ocean Drive promenade.');
    void g;
  }
  onTalk(p: Ped) {
    if (this.stage === 1 && p === this.lena && !this.talked) {
      this.talked = true;
      const lines = [
        "Who sent you? ...Reyes? Fine. I keep the books for Rustwater Freight.",
        'They moved the ledger to the docks, behind the container stacks. Three of their guys guard it.',
        "Get it before tonight's shipment. And you never saw me.",
      ];
      lines.forEach((l, i) => setTimeout(() => this.g.ui.subtitle('Lena Park', l), i * 3200));
      setTimeout(() => this.toHideout(), 3200 * 2 + 500);
      return true;
    }
    if (this.stage === 4 && p === this.reyes) {
      this.stage = 5;
      return true;
    }
    return false;
  }
  private toHideout() {
    const g = this.g;
    if (this.stage !== 1) return;
    this.setStage(2, 'Go to the hideout at the docks and take out the guards.');
    this.marker({ x: this.hideout.x, z: this.hideout.z, color: 0xff3355, kind: 'mission', radius: 3 });
    this.blip('hide', this.hideout.x, this.hideout.z, '☠', '#ff3355', 'Hideout');
    this.gps(this.hideout.x, this.hideout.z);
    const weapons = ['bat', 'pistol', 'fists'] as const;
    for (let i = 0; i < 3; i++) {
      const t = this.ped(randomLook(true), this.hideout.x - 6 + i * 5, this.hideout.z + (i === 1 ? 6 : 0), 0, 'Freight Guard', 'gang');
      t.setWeapon(weapons[i]);
      t.state = 'stand';
      t.accuracy = 0.35;
      this.thugs.push(t);
      this.marker({ x: 0, z: 0, color: 0xff3355, kind: 'enemy', follow: () => (t.alive && this.stage === 2 ? t.pos : null) });
    }
    void g;
  }
  tick(): MissionStatus {
    const g = this.g;
    if (!this.reyes.alive) return this.fail('Detective Reyes was killed.');
    if (this.stage === 2) {
      const d = this.dist(this.hideout.x, this.hideout.z);
      for (const t of this.thugs) {
        if (t.alive && d < 40 && t.state === 'stand') {
          t.hostile = true;
          t.state = 'fight';
          t.aggroT = 999;
        }
      }
      const left = this.thugs.filter((t) => t.alive && !(t.knockT > 0 && t.health < 15)).length;
      this.detail = `Guards remaining: ${left}`;
      if (this.thugs.every((t) => !t.alive)) {
        this.setStage(3, 'Grab the ledger.');
        const y = g.col.surfaceY(this.hideout.x, this.hideout.z, 20, 0);
        this.item(this.hideout.x, y, this.hideout.z, 0x7a3aff, () => {
          this.setStage(4, 'Bring the ledger to Detective Reyes at NBPD Central.');
          this.gps(this.reyes.pos.x, this.reyes.pos.z);
          this.marker({ x: 0, z: 0, color: 0xffd000, kind: 'objective', follow: () => this.reyes.pos });
          this.blip('reyes', 0, 0, 'R', '#ffd000', 'Det. Reyes', () => this.reyes.pos);
        }, false);
        this.gps(this.hideout.x, this.hideout.z);
      }
    }
    if (this.stage === 4) {
      this.detail = 'Talk to Reyes (E)';
    }
    if (this.stage === 5) {
      this.say('Det. Owen Reyes', "Good work. As far as NBPD is concerned, you're a model citizen. For now.");
      return 'success';
    }
    return 'running';
  }
}

// ------------------------------------------------------------------ M6
class HarborMission extends MissionRun {
  boat!: Vehicle;
  crates = 0;
  enemies: Vehicle[] = [];
  drop = { x: 1150, z: -70 };
  shootT = 0;
  outT = 0;
  start() {
    this.boat = this.vehicle('marlin', 792, 174, Math.PI / 2, 0x111111);
    this.boat.fuel = this.boat.spec.fuelCap;
    this.marker({ x: 0, z: 0, color: 0x29e6ff, kind: 'objective', follow: () => (this.stage === 0 ? this.boat.pos : null) });
    this.blip('boat', 792, 174, '⛵', '#29e6ff', 'Speedboat', () => (this.stage === 0 ? this.boat.pos : null));
    this.gps(792, 174);
    this.setStage(0, 'Take the black Marlin speedboat at the marina.');
    this.say('Marisol Vega', "Last job. Four crates dropped off the coast tonight. Collect them all and run them to Coral Key. Then we're rich.");
  }
  tick(dt: number): MissionStatus {
    const g = this.g;
    if (this.boat.destroyed) return this.fail('The speedboat was destroyed.');
    if (this.stage === 0) {
      if (g.player.vehicle === this.boat) {
        this.setStage(1, 'Collect the 4 floating crates.', '0/4 crates');
        this.timer = 330;
        const spots = [
          { x: 880, z: -330 },
          { x: 830, z: 420 },
          { x: 320, z: 830 },
          { x: -300, z: 800 },
        ];
        spots.forEach((s, i) => {
          const mid = this.marker({ x: s.x, z: s.z, y: WATER_Y, color: 0xffa020, kind: 'mission', radius: 4 });
          const bid = this.blip(`c${i}`, s.x, s.z, '▣', '#ffa020', 'Crate');
          const it = this.item(s.x, WATER_Y - 0.3, s.z, 0x8a5a2a, () => {
            this.crates++;
            this.clearMarker(mid);
            this.clearMarker(bid);
            g.ui.notify(`Crate secured (${this.crates}/4)`, 'good');
            if (this.crates === 2) this.spawnEnemies();
            this.nextGps();
          });
          it.radius = 6;
        });
        this.nextGps();
      }
      return 'running';
    }
    if (g.player.vehicle !== this.boat) {
      this.outT += dt;
      this.detail = 'Get back in the boat!';
      if (this.outT > 30) return this.fail('You abandoned the boat.');
    } else this.outT = 0;
    // enemy boats shoot
    this.shootT -= dt;
    for (const e of this.enemies) {
      if (e.destroyed) continue;
      const d = this.dist(e.pos.x, e.pos.z);
      if (d < 45 && this.shootT <= 0) {
        const shooter = { pos: e.pos.clone().setY(e.pos.y + 0.5), yaw: Math.atan2(g.player.pos.x - e.pos.x, g.player.pos.z - e.pos.z) } as unknown as Ped;
        g.combat.npcFire(shooter, g.player.pos.x, g.player.pos.y + 0.6, g.player.pos.z, 0.45, 7);
      }
    }
    if (this.shootT <= 0) this.shootT = 0.7;
    if (this.stage === 1) {
      if (this.outT === 0) this.detail = `${this.crates}/4 crates${this.enemies.some((e) => !e.destroyed) ? '  •  Smugglers are hunting you!' : ''}`;
      if (this.crates >= 4) {
        this.setStage(2, 'Deliver the crates to the Coral Key jetty.');
        this.marker({ x: this.drop.x, z: this.drop.z, y: WATER_Y, color: 0xffd000, kind: 'mission', radius: 6 });
        this.blip('drop', this.drop.x, this.drop.z, '★', '#ffd000', 'Coral Key jetty');
        this.gps(this.drop.x, this.drop.z);
      }
    } else if (this.stage === 2) {
      if (g.player.vehicle === this.boat && Math.hypot(this.boat.pos.x - this.drop.x, this.boat.pos.z - this.drop.z) < 12) return 'success';
    }
    return 'running';
  }
  private nextGps() {
    const remaining = this.pickups.filter((p) => this.g.pickups.list.includes(p));
    const p = this.g.player.pos;
    remaining.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    if (remaining[0]) this.gps(remaining[0].x, remaining[0].z);
  }
  private spawnEnemies() {
    const g = this.g;
    const p = g.player.pos;
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      let x = p.x + Math.cos(a) * 160,
        z = p.z + Math.sin(a) * 160;
      for (let k = 0; k < 12 && g.col.surfaceY(x, z, 0, 0) > WATER_Y - 1.5; k++) {
        const b = Math.random() * Math.PI * 2;
        x = p.x + Math.cos(b) * 160;
        z = p.z + Math.sin(b) * 160;
      }
      const e = this.vehicle('wave', x, z, 0, 0x7a1ab8);
      e.driver = 'ai';
      e.npcDriver = true;
      e.rig.driverDummy.visible = true;
      e.locked = true;
      const ai = new AIDriver(e);
      ai.mode = 'pursuit';
      ai.aggressive = true;
      ai.skill = 0.9;
      e.ai = ai;
      this.enemies.push(e);
      this.marker({ x: 0, z: 0, color: 0xff3355, kind: 'enemy', follow: () => (e.destroyed ? null : e.pos) });
      this.blip(`e${i}`, 0, 0, '◆', '#ff3355', 'Smuggler', () => (e.destroyed ? null : e.pos));
    }
    g.ui.notify('Rival smugglers are coming for the cargo!', 'bad');
  }
}

export const MISSIONS: MissionDef[] = [
  {
    id: 'm1',
    title: 'Welcome to Neon Bay',
    type: 'Vehicle Delivery',
    giver: 'Marisol Vega',
    giverLook: MARI,
    start: { x: 0, z: 0, yaw: 0 },
    intro: "Marisol \"Mari\" Vega runs the best chop shop in Rustwater and she remembers you owe her. First job: lift a red Vortex GT off Vice Street and bring it to her garage without scratching the paint.",
    objective: "Steal the Vortex GT and deliver it to Vega's Garage.",
    instructions: ['Press F near a vehicle to get in.', 'W/S accelerate and brake, A/D steer, SPACE for the handbrake.', 'Follow the GPS route on the mini-map.', 'Keep the car above 30% condition.'],
    reward: 1500,
    rewardText: 'Vortex GT unlocked at dealerships (25% off)',
    requires: [],
    story: true,
    create: (g, d) => new WelcomeMission(g, d),
  },
  {
    id: 'm2',
    title: 'Special Delivery',
    type: 'Package Collection',
    giver: 'Marisol Vega',
    giverLook: MARI,
    start: { x: 0, z: 0, yaw: 0 },
    intro: 'Three packages have been stashed around the city by a nervous courier. Mari needs them at the dockside warehouse before her buyer gets impatient.',
    objective: 'Collect 3 packages and deliver them to the docks.',
    instructions: ['Packages are marked in orange on the map.', 'Drive or walk through a package to collect it.', 'You have 6 minutes.'],
    reward: 2500,
    requires: ['m1'],
    story: true,
    create: (g, d) => new DeliveryMission(g, d),
  },
  {
    id: 'm3',
    title: 'Midnight Circuit',
    type: 'Street Race',
    giver: 'Dex Moreno',
    giverLook: DEX,
    start: { x: 0, z: 0, yaw: 0 },
    intro: "Dex Moreno runs the illegal midnight races through Sapphire Hills. Win his race and the Apex Exotics crew will treat you like family.",
    objective: 'Finish 1st in the Midnight Circuit.',
    instructions: ['Drive through the yellow checkpoint rings in order.', 'The next checkpoint is shown in dim yellow.', 'Use SPACE to drift through tight corners.', 'Only first place wins.'],
    reward: 4000,
    rewardText: 'Zenith R 25% off at Apex Exotics',
    requires: ['m1'],
    story: true,
    create: (g, d) => new CircuitMission(g, d),
  },
  {
    id: 'm4',
    title: 'Loose Lips',
    type: 'Chase & Escape',
    giver: 'Marisol Vega',
    giverLook: MARI,
    start: { x: 0, z: 0, yaw: 0 },
    intro: "Rat Ruiz, a small-time fence, has been feeding names to the NBPD. He is about to leave town through the airport. Stop him — then shake the police heat that follows.",
    objective: 'Stop the informant and escape a 3-star wanted level.',
    instructions: ['Ram his car until it breaks down.', 'If he runs on foot, knock him down.', 'Break line of sight and leave the search area to lose the cops.', 'A Quick Fix Auto respray also loses the cops.'],
    reward: 5000,
    requires: ['m2', 'm3'],
    story: true,
    create: (g, d) => new ChaseMission(g, d),
  },
  {
    id: 'm5',
    title: 'Paper Trail',
    type: 'Investigation',
    giver: 'Det. Owen Reyes',
    giverLook: REYES,
    start: { x: 0, z: 0, yaw: 0 },
    intro: "Detective Owen Reyes isn't the cleanest cop in Neon Bay. He wants a smuggling ledger before Internal Affairs gets to it, and he's offering to make your record vanish.",
    objective: 'Follow the clues, find the ledger and return it to Reyes.',
    instructions: ['Press E at each purple marker to search it.', 'Talk to the witness with E.', 'Weapons are sold at Bay Arms — the guards are armed.', 'Return the ledger to Reyes.'],
    reward: 7500,
    requires: ['m2'],
    story: true,
    create: (g, d) => new InvestigationMission(g, d),
  },
  {
    id: 'm6',
    title: 'Harbor Lights',
    type: 'Story Finale',
    giver: 'Marisol Vega',
    giverLook: MARI,
    start: { x: 0, z: 0, yaw: 0 },
    intro: "Everything has led to this: a cargo drop off the coast worth more than the whole of Rustwater. Mari's rivals know about it too.",
    objective: 'Collect 4 crates by speedboat and deliver them to Coral Key.',
    instructions: ['Boats steer like cars but drift more. They only work on water.', 'Rival smugglers on jet skis will shoot at you — ram them.', 'Deliver to the Coral Key jetty north of the island.'],
    reward: 15000,
    rewardText: 'Coral Key Villa 50% off + the city is yours',
    requires: ['m4', 'm5'],
    story: true,
    create: (g, d) => new HarborMission(g, d),
  },
];

/** Where each mission giver stands (computed from city POIs). */
export function placeMissionStarts(g: Game) {
  const at = (id: string, dx = 0, dz = 0) => {
    const p = poi(g, id);
    return { x: p.ex + dx, z: p.ez + dz, yaw: p.yaw };
  };
  const set = (id: string, s: { x: number; z: number; yaw: number }) => {
    const m = MISSIONS.find((m) => m.id === id)!;
    m.start = s;
  };
  set('m1', at('diner_sunset', -5, 0));
  set('m2', at('garage_vega', 6, 0));
  set('m3', at('dealer_apex', 0, 3));
  set('m4', at('garage_vega', -6, 0));
  set('m5', at('pd_central', -4, -1));
  set('m6', at('garage_vega', 0, 3));
}

export const missionRewardText = (d: MissionDef) => formatMoney(d.reward) + (d.rewardText ? ` + ${d.rewardText}` : '');
