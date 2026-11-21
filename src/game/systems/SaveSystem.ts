import type { Game } from '../Game';
import type { Weather } from './Environment';
import type { Inventory, WeaponId } from '../combat/Weapons';
import type { Progression } from './Progression';

const KEY = 'neonbay.save.v1';

export interface SaveData {
  version: 1;
  savedAt: number;
  character: string;
  player: { x: number; z: number; yaw: number; health: number; armor: number; inv: Inventory; weapon: WeaponId; medkits: number };
  progress: ReturnType<Progression['serialize']>;
  env: { hours: number; weather: Weather };
  spawnAt: string;
}

export class SaveSystem {
  constructor(private g: Game) {}

  hasSave() {
    try {
      return !!localStorage.getItem(KEY);
    } catch {
      return false;
    }
  }

  read(): SaveData | null {
    try {
      const s = localStorage.getItem(KEY);
      if (!s) return null;
      const d = JSON.parse(s) as SaveData;
      return d.version === 1 ? d : null;
    } catch {
      return null;
    }
  }

  save(spawnAt?: string) {
    const g = this.g;
    const p = g.player;
    const d: SaveData = {
      version: 1,
      savedAt: Date.now(),
      character: p.def.id,
      player: { x: p.pos.x, z: p.pos.z, yaw: p.yaw, health: p.health, armor: p.armor, inv: p.inv, weapon: p.weapon, medkits: p.medkits },
      progress: g.progress.serialize(),
      env: { hours: g.env.hours, weather: g.env.weather },
      spawnAt: spawnAt ?? g.lastSafehouse,
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
      return true;
    } catch {
      g.ui.notify('Could not save (storage unavailable)', 'bad');
      return false;
    }
  }

  wipe() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
}
