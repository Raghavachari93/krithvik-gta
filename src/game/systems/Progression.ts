import { formatMoney } from '../core/math';
import type { Game } from '../Game';

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  reward: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_wheels', name: 'First Wheels', desc: 'Get behind the wheel of any vehicle.', reward: 100 },
  { id: 'grand_theft', name: 'Grand Theft', desc: 'Steal 10 vehicles.', reward: 500 },
  { id: 'most_wanted', name: 'Most Wanted', desc: 'Reach a 5-star wanted level.', reward: 1000 },
  { id: 'public_enemy', name: 'Public Enemy', desc: 'Reach the maximum 6-star wanted level.', reward: 2500 },
  { id: 'escape_artist', name: 'Escape Artist', desc: 'Lose a wanted level of 3 stars or more.', reward: 1500 },
  { id: 'speed_demon', name: 'Speed Demon', desc: 'Reach 220 km/h.', reward: 750 },
  { id: 'daredevil', name: 'Daredevil', desc: 'Complete 4 unique stunt jumps.', reward: 1500 },
  { id: 'stuntmaster', name: 'Stunt Master', desc: 'Complete all 8 unique stunt jumps.', reward: 5000 },
  { id: 'collector', name: 'Collector', desc: 'Find 15 Neon Tokens.', reward: 2000 },
  { id: 'completionist', name: 'Neon Hoarder', desc: 'Find all 30 Neon Tokens.', reward: 10000 },
  { id: 'story_done', name: 'Kingpin of Neon Bay', desc: 'Complete every story mission.', reward: 10000 },
  { id: 'mogul', name: 'Property Mogul', desc: 'Own 3 properties.', reward: 3000 },
  { id: 'cabbie', name: 'Cabbie', desc: 'Complete 10 taxi fares.', reward: 1500 },
  { id: 'road_warrior', name: 'Road Warrior', desc: 'Destroy 10 vehicles.', reward: 1000 },
  { id: 'swimmer', name: 'Deep End', desc: 'Swim 200 metres.', reward: 300 },
  { id: 'brawler', name: 'Brawler', desc: 'Knock out 25 people.', reward: 1000 },
  { id: 'racer', name: 'Street King', desc: 'Win 3 street races.', reward: 2000 },
  { id: 'treasure', name: 'Treasure Hunter', desc: 'Complete all 3 treasure hunts.', reward: 3000 },
  { id: 'parkour', name: 'Rooftop Runner', desc: 'Complete the Market Row rooftop course.', reward: 1000 },
  { id: 'drifter', name: 'Sideways', desc: 'Pass the Rustwater drift challenge.', reward: 1000 },
  { id: 'good_samaritan', name: 'Good Samaritan', desc: 'Help out in 3 street encounters.', reward: 750 },
  { id: 'night_owl', name: 'Night Owl', desc: 'Party at a nightclub.', reward: 200 },
];

export const PROPERTIES: { id: string; name: string; price: number; income: number }[] = [
  { id: 'sh_starter', name: 'Palmetto Apartments', price: 0, income: 0 },
  { id: 'sh_docks', name: 'Dockside Loft', price: 15000, income: 300 },
  { id: 'sh_beach', name: 'Seabreeze Condo', price: 35000, income: 800 },
  { id: 'sh_villa', name: 'Coral Key Villa', price: 90000, income: 2000 },
  { id: 'club_uv', name: 'Club Ultraviolet', price: 60000, income: 2500 },
];

export class Progression {
  cash = 500;
  stats: Record<string, number> = {};
  achievements = new Set<string>();
  properties = new Set<string>(['sh_starter']);
  ownedVehicles: string[] = [];
  unlocked = new Set<string>(['comet', 'cab', 'ranger', 'mule', 'viper', 'stallion', 'hauler', 'wave', 'marlin']);
  tokens = new Set<string>();
  stunts = new Set<string>();
  missions = new Set<string>();
  treasures = new Set<string>();
  activitiesDone = new Set<string>();
  best: Record<string, number> = {};
  discounts: Record<string, number> = {};
  lastIncomeDay = 0;
  private dayCounter = 0;
  private lastHour = 0;

  constructor(private g: Game) {}

  addCash(n: number, reason?: string) {
    n = Math.round(n);
    this.cash += n;
    if (n > 0) this.stat('moneyEarned', n);
    if (reason) this.g.ui.notify(`${reason}  +${formatMoney(n)}`, 'money');
  }

  spend(n: number) {
    if (this.cash < n) {
      this.g.ui.notify('Not enough cash', 'bad');
      return false;
    }
    this.cash -= n;
    this.stat('moneySpent', n);
    this.g.audio.cash();
    return true;
  }

  stat(k: string, d: number) {
    this.stats[k] = (this.stats[k] ?? 0) + d;
    const s = this.stats;
    if (k === 'carsStolen' && s.carsStolen >= 10) this.achieve('grand_theft');
    if (k === 'knockouts' && s.knockouts >= 25) this.achieve('brawler');
    if (k === 'vehiclesDestroyed' && s.vehiclesDestroyed >= 10) this.achieve('road_warrior');
    if (k === 'fares' && s.fares >= 10) this.achieve('cabbie');
    if (k === 'racesWon' && s.racesWon >= 3) this.achieve('racer');
    if (k === 'encounters' && s.encounters >= 3) this.achieve('good_samaritan');
  }

  addDistance(kind: 'walk' | 'drive' | 'swim', m: number) {
    this.stat(`dist_${kind}`, m);
    if (kind === 'swim' && (this.stats.dist_swim ?? 0) >= 200) this.achieve('swimmer');
  }

  maxSpeed(kmh: number) {
    if (kmh > (this.stats.topSpeed ?? 0)) this.stats.topSpeed = kmh;
    if (kmh >= 220) this.achieve('speed_demon');
  }

  highestWanted(l: number) {
    if (l > (this.stats.highestWanted ?? 0)) this.stats.highestWanted = l;
    if (l >= 5) this.achieve('most_wanted');
    if (l >= 6) this.achieve('public_enemy');
  }

  achieve(id: string) {
    if (this.achievements.has(id)) return;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    this.achievements.add(id);
    this.g.ui.notify(`🏆 Achievement unlocked: ${a.name}`, 'achievement');
    if (a.reward) this.addCash(a.reward);
    this.g.audio.jingle(true);
  }

  ownProperty(id: string) {
    this.properties.add(id);
    if (this.properties.size >= 4) this.achieve('mogul');
  }

  price(id: string, base: number) {
    const d = this.discounts[id] ?? 0;
    return Math.round(base * (1 - d));
  }

  update(dt: number) {
    this.stats.playTime = (this.stats.playTime ?? 0) + dt;
    // property income every in-game morning
    const h = this.g.env.hours;
    if (this.lastHour < 8 && h >= 8) {
      this.dayCounter++;
      let income = 0;
      for (const p of PROPERTIES) if (this.properties.has(p.id)) income += p.income;
      if (income > 0) this.addCash(income, 'Property income');
    }
    this.lastHour = h;
    if (this.tokens.size >= 15) this.achieve('collector');
    if (this.tokens.size >= 30) this.achieve('completionist');
    if (this.stunts.size >= 4) this.achieve('daredevil');
    if (this.stunts.size >= 8) this.achieve('stuntmaster');
    if (this.treasures.size >= 3) this.achieve('treasure');
  }

  serialize() {
    return {
      cash: this.cash,
      stats: this.stats,
      achievements: [...this.achievements],
      properties: [...this.properties],
      ownedVehicles: this.ownedVehicles,
      unlocked: [...this.unlocked],
      tokens: [...this.tokens],
      stunts: [...this.stunts],
      missions: [...this.missions],
      treasures: [...this.treasures],
      activitiesDone: [...this.activitiesDone],
      best: this.best,
      discounts: this.discounts,
    };
  }

  load(d: ReturnType<Progression['serialize']>) {
    this.cash = d.cash ?? 500;
    this.stats = d.stats ?? {};
    this.achievements = new Set(d.achievements ?? []);
    this.properties = new Set(d.properties ?? ['sh_starter']);
    this.ownedVehicles = d.ownedVehicles ?? [];
    this.unlocked = new Set(d.unlocked ?? []);
    this.tokens = new Set(d.tokens ?? []);
    this.stunts = new Set(d.stunts ?? []);
    this.missions = new Set(d.missions ?? []);
    this.treasures = new Set(d.treasures ?? []);
    this.activitiesDone = new Set(d.activitiesDone ?? []);
    this.best = d.best ?? {};
    this.discounts = d.discounts ?? {};
  }
}
