import type { WeaponVisual } from '../characters/CharacterModel';

export type WeaponId =
  | 'fists'
  | 'bat'
  | 'knife'
  | 'katana'
  | 'pistol'
  | 'revolver'
  | 'smg'
  | 'microsmg'
  | 'shotgun'
  | 'autoshotgun'
  | 'rifle'
  | 'minigun'
  | 'sniper'
  | 'rocket'
  | 'grenade'
  | 'flamer'
  | 'laser';

/** How the shot travels: plain bullet, slow explosive rocket, arcing grenade, short-lived flame, or a bright laser bolt. */
export type ProjKind = 'bullet' | 'rocket' | 'grenade' | 'flame' | 'laser';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** number key (1-8). Pressing it again cycles the weapons sharing that key. */
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
  /** keeps firing while the trigger is held */
  auto?: boolean;
  proj?: ProjKind;
  /** explosion radius for rockets / grenades */
  blast?: number;
  reload?: number;
  /** camera shake per shot */
  kick?: number;
}

const W = (o: Omit<WeaponDef, 'pellets' | 'spread' | 'ammoPrice' | 'ammoPack' | 'twoHanded' | 'clip'> & Partial<WeaponDef>): WeaponDef => ({
  pellets: 1,
  spread: 0,
  ammoPrice: 0,
  ammoPack: 0,
  twoHanded: true,
  clip: 0,
  ...o,
});

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  // 1 — melee
  fists: W({ id: 'fists', name: 'Fists', slot: 1, melee: true, damage: 14, range: 1.6, rate: 0.36, price: 0, visual: 'none', twoHanded: false }),
  bat: W({ id: 'bat', name: 'Baseball Bat', slot: 1, melee: true, damage: 34, range: 2.1, rate: 0.62, price: 250, visual: 'bat' }),
  knife: W({ id: 'knife', name: 'Combat Knife', slot: 1, melee: true, damage: 40, range: 1.7, rate: 0.4, price: 400, visual: 'knife', twoHanded: false }),
  katana: W({ id: 'katana', name: 'Katana', slot: 1, melee: true, damage: 70, range: 2.4, rate: 0.6, price: 2500, visual: 'katana' }),
  // 2 — handguns
  pistol: W({ id: 'pistol', name: 'Pistol', slot: 2, melee: false, damage: 26, range: 70, rate: 0.28, clip: 12, spread: 0.018, price: 1200, ammoPrice: 150, ammoPack: 36, visual: 'pistol', twoHanded: false }),
  revolver: W({ id: 'revolver', name: 'Heavy Revolver', slot: 2, melee: false, damage: 70, range: 85, rate: 0.6, clip: 6, spread: 0.01, price: 3000, ammoPrice: 200, ammoPack: 24, visual: 'revolver', twoHanded: false, kick: 0.2, reload: 1.5 }),
  // 3 — SMGs
  smg: W({ id: 'smg', name: 'SMG', slot: 3, melee: false, damage: 15, range: 55, rate: 0.085, clip: 30, spread: 0.045, price: 3500, ammoPrice: 300, ammoPack: 90, visual: 'smg', auto: true }),
  microsmg: W({ id: 'microsmg', name: 'Micro SMG', slot: 3, melee: false, damage: 12, range: 45, rate: 0.055, clip: 40, spread: 0.06, price: 2800, ammoPrice: 250, ammoPack: 120, visual: 'microsmg', twoHanded: false, auto: true }),
  // 4 — shotguns
  shotgun: W({ id: 'shotgun', name: 'Pump Shotgun', slot: 4, melee: false, damage: 13, range: 28, rate: 0.9, clip: 6, pellets: 8, spread: 0.11, price: 5000, ammoPrice: 250, ammoPack: 18, visual: 'shotgun', kick: 0.25, reload: 1.6 }),
  autoshotgun: W({ id: 'autoshotgun', name: 'Auto Shotgun', slot: 4, melee: false, damage: 11, range: 26, rate: 0.26, clip: 12, pellets: 7, spread: 0.13, price: 9000, ammoPrice: 400, ammoPack: 36, visual: 'autoshotgun', auto: true, kick: 0.22, reload: 1.8 }),
  // 5 — rifles
  rifle: W({ id: 'rifle', name: 'Assault Rifle', slot: 5, melee: false, damage: 24, range: 90, rate: 0.11, clip: 30, spread: 0.022, price: 8000, ammoPrice: 400, ammoPack: 120, visual: 'rifle', auto: true }),
  minigun: W({ id: 'minigun', name: 'Minigun', slot: 5, melee: false, damage: 18, range: 80, rate: 0.04, clip: 250, spread: 0.05, price: 40000, ammoPrice: 1200, ammoPack: 500, visual: 'minigun', auto: true, kick: 0.09, reload: 2.6 }),
  // 6 — sniper
  sniper: W({ id: 'sniper', name: 'Sniper Rifle', slot: 6, melee: false, damage: 150, range: 260, rate: 1.2, clip: 5, spread: 0.002, price: 15000, ammoPrice: 500, ammoPack: 20, visual: 'sniper', kick: 0.3, reload: 2 }),
  // 7 — explosives
  rocket: W({ id: 'rocket', name: 'Rocket Launcher', slot: 7, melee: false, damage: 0, range: 160, rate: 1.1, clip: 1, spread: 0.004, price: 20000, ammoPrice: 1500, ammoPack: 5, visual: 'rocket', proj: 'rocket', blast: 8, kick: 0.4 }),
  grenade: W({ id: 'grenade', name: 'Grenade Launcher', slot: 7, melee: false, damage: 0, range: 90, rate: 0.7, clip: 6, spread: 0.01, price: 18000, ammoPrice: 1000, ammoPack: 12, visual: 'grenade', proj: 'grenade', blast: 6.5, kick: 0.3, reload: 2 }),
  // 8 — special
  flamer: W({ id: 'flamer', name: 'Flamethrower', slot: 8, melee: false, damage: 5, range: 16, rate: 0.05, clip: 150, pellets: 2, spread: 0.07, price: 25000, ammoPrice: 800, ammoPack: 300, visual: 'flamer', auto: true, proj: 'flame', kick: 0.03, reload: 2 }),
  laser: W({ id: 'laser', name: 'Laser Blaster', slot: 8, melee: false, damage: 45, range: 140, rate: 0.16, clip: 24, spread: 0.006, price: 30000, ammoPrice: 900, ammoPack: 96, visual: 'laser', auto: true, proj: 'laser', kick: 0.05, reload: 1.2 }),
};

export const WEAPON_ORDER: WeaponId[] = ['fists', 'bat', 'knife', 'katana', 'pistol', 'revolver', 'smg', 'microsmg', 'shotgun', 'autoshotgun', 'rifle', 'minigun', 'sniper', 'rocket', 'grenade', 'flamer', 'laser'];

export interface WeaponSlot {
  owned: boolean;
  ammo: number;
  clip: number;
}

export type Inventory = Record<WeaponId, WeaponSlot>;

export function newInventory(): Inventory {
  const inv = {} as Inventory;
  for (const w of WEAPON_ORDER) inv[w] = { owned: w === 'fists', ammo: 0, clip: 0 };
  return inv;
}
