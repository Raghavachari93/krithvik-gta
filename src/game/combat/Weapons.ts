import type { WeaponVisual } from '../characters/CharacterModel';

export type WeaponId = 'fists' | 'bat' | 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'rocket';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  slot: number;
  melee: boolean;
  damage: number;
  range: number;
  rate: number;
  clip: number;
  pellets: number;
  spread: number;
  price: number;
  ammoPrice: number;
  ammoPack: number;
  visual: WeaponVisual;
  twoHanded: boolean;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  fists: { id: 'fists', name: 'Fists', slot: 1, melee: true, damage: 14, range: 1.6, rate: 0.36, clip: 0, pellets: 1, spread: 0, price: 0, ammoPrice: 0, ammoPack: 0, visual: 'none', twoHanded: false },
  bat: { id: 'bat', name: 'Baseball Bat', slot: 2, melee: true, damage: 34, range: 2.1, rate: 0.62, clip: 0, pellets: 1, spread: 0, price: 250, ammoPrice: 0, ammoPack: 0, visual: 'bat', twoHanded: true },
  pistol: { id: 'pistol', name: 'Pistol', slot: 3, melee: false, damage: 26, range: 70, rate: 0.28, clip: 12, pellets: 1, spread: 0.018, price: 1200, ammoPrice: 150, ammoPack: 36, visual: 'pistol', twoHanded: false },
  smg: { id: 'smg', name: 'SMG', slot: 4, melee: false, damage: 15, range: 55, rate: 0.085, clip: 30, pellets: 1, spread: 0.045, price: 3500, ammoPrice: 300, ammoPack: 90, visual: 'smg', twoHanded: true },
  shotgun: { id: 'shotgun', name: 'Pump Shotgun', slot: 5, melee: false, damage: 13, range: 28, rate: 0.9, clip: 6, pellets: 8, spread: 0.11, price: 5000, ammoPrice: 250, ammoPack: 18, visual: 'shotgun', twoHanded: true },
  rifle: { id: 'rifle', name: 'Assault Rifle', slot: 6, melee: false, damage: 24, range: 90, rate: 0.11, clip: 30, pellets: 1, spread: 0.022, price: 8000, ammoPrice: 400, ammoPack: 120, visual: 'rifle', twoHanded: true },
  rocket: { id: 'rocket', name: 'Rocket Launcher', slot: 7, melee: false, damage: 0, range: 160, rate: 1.1, clip: 1, pellets: 1, spread: 0.004, price: 20000, ammoPrice: 1500, ammoPack: 5, visual: 'rocket', twoHanded: true },
};

export const WEAPON_ORDER: WeaponId[] = ['fists', 'bat', 'pistol', 'smg', 'shotgun', 'rifle', 'rocket'];

export interface WeaponSlot {
  owned: boolean;
  ammo: number;
  clip: number;
}

export type Inventory = Record<WeaponId, WeaponSlot>;

export function newInventory(): Inventory {
  return {
    fists: { owned: true, ammo: 0, clip: 0 },
    bat: { owned: false, ammo: 0, clip: 0 },
    pistol: { owned: false, ammo: 0, clip: 0 },
    smg: { owned: false, ammo: 0, clip: 0 },
    shotgun: { owned: false, ammo: 0, clip: 0 },
    rifle: { owned: false, ammo: 0, clip: 0 },
    rocket: { owned: false, ammo: 0, clip: 0 },
  };
}
