import { formatMoney } from '../core/math';
import type { Game } from '../Game';
import { WEAPONS, WEAPON_ORDER, WeaponId } from '../combat/Weapons';
import { POI } from '../world/CityLayout';
import { VEHICLES } from '../vehicles/VehicleSpecs';
import { PROPERTIES } from './Progression';
import type { ShopItem } from '../../ui/store';

const BLIP: Record<string, { glyph: string; color: string; kind: 'safehouse' | 'shop' | 'police' | 'service' }> = {
  safehouse: { glyph: 'H', color: '#39ff88', kind: 'safehouse' },
  police: { glyph: 'P', color: '#4a8cff', kind: 'police' },
  hospital: { glyph: '+', color: '#ff4a4a', kind: 'service' },
  gas: { glyph: 'F', color: '#9be22a', kind: 'service' },
  dealer: { glyph: '$', color: '#29e6ff', kind: 'shop' },
  club: { glyph: '♫', color: '#b84dff', kind: 'shop' },
  diner: { glyph: 'R', color: '#ff9a1f', kind: 'shop' },
  weapons: { glyph: 'W', color: '#ff3355', kind: 'shop' },
  repair: { glyph: 'Q', color: '#f2c230', kind: 'service' },
  marina: { glyph: '⚓', color: '#29e6ff', kind: 'service' },
  garage: { glyph: 'V', color: '#ff9a1f', kind: 'service' },
};

const DEALER_STOCK: Record<string, string[]> = {
  dealer_bayside: ['comet', 'ranger', 'mule', 'viper', 'stallion', 'hauler', 'cab'],
  dealer_apex: ['furia', 'tempesta', 'azura', 'celeste', 'vortex', 'zenith', 'stallion', 'viper', 'behemoth', 'inferno', 'phantom', 'royale', 'hellrod', 'skyhawk', 'jetstream'],
};

/** Shops, properties and city services attached to points of interest. */
export class Services {
  constructor(private g: Game) {}

  init() {
    for (const p of this.g.layout.pois) this.setup(p);
  }

  private label(p: POI) {
    if (p.type === 'safehouse') return this.g.progress.properties.has(p.id) ? `Safehouse: ${p.name}` : `For sale: ${p.name} (${formatMoney(this.g.progress.price(p.id, p.price ?? 0))})`;
    return p.name;
  }

  refreshBlips() {
    for (const p of this.g.layout.pois) {
      const b = BLIP[p.type];
      if (!b) continue;
      const owned = p.type === 'safehouse' ? this.g.progress.properties.has(p.id) : true;
      this.g.markers.addBlip({ id: `poi_${p.id}`, x: p.ex, z: p.ez, glyph: b.glyph, color: owned ? b.color : '#8a8a8a', label: this.label(p), kind: b.kind });
    }
  }

  private setup(p: POI) {
    const g = this.g;
    const b = BLIP[p.type];
    if (b) g.markers.addBlip({ id: `poi_${p.id}`, x: p.ex, z: p.ez, glyph: b.glyph, color: b.color, label: this.label(p), kind: b.kind });
    const add = (suffix: string, label: string | (() => string), action: () => void, vehicle: 'allow' | 'require' | 'forbid' = 'forbid', r = 2.6, enabled?: () => boolean, dx = 0, dz = 0) =>
      g.interact.add({ id: `poi_${p.id}_${suffix}`, x: p.ex + dx, z: p.ez + dz, r, label, action, vehicle, enabled });
    switch (p.type) {
      case 'safehouse':
        add('main', () => this.label(p), () => this.safehouseMenu(p));
        break;
      case 'police':
        add('surrender', 'Turn yourself in', () => this.surrender(), 'forbid', 3, () => g.wanted.level > 0);
        break;
      case 'hospital':
        add('heal', 'Get treated ($100)', () => {
          if (g.player.health >= g.player.maxHealth) return g.ui.notify('You are already healthy.', 'info');
          if (g.progress.spend(100)) {
            g.player.health = g.player.maxHealth;
            g.ui.notify('Fully healed', 'good');
          }
        });
        break;
      case 'gas':
        add('fuel', () => {
          const v = g.player.vehicle;
          const cost = v ? Math.ceil((v.spec.fuelCap - v.fuel) * 2.2) : 0;
          return v ? `Refuel ${v.spec.name} (${formatMoney(cost)})` : 'Refuel';
        }, () => this.refuel(), 'require', 9);
        add('snack', 'Buy snacks ($15, +25 HP)', () => {
          if (g.progress.spend(15)) {
            g.player.health = Math.min(g.player.maxHealth, g.player.health + 25);
            g.ui.notify('Ate a snack (+25 HP)', 'good');
          }
        }, 'forbid', 3, undefined, 8, 0);
        break;
      case 'dealer':
        add('shop', `${p.name} — browse vehicles`, () => this.dealerMenu(p));
        break;
      case 'club':
        add('party', () => (p.id === 'club_uv' && !g.progress.properties.has('club_uv') ? `${p.name} — enter / buy` : `${p.name} — enter`), () => this.clubMenu(p));
        break;
      case 'diner':
        add('eat', `Eat at ${p.name} ($20, full health)`, () => {
          if (g.progress.spend(20)) {
            g.player.health = g.player.maxHealth;
            g.ui.notify('That hit the spot. Health restored.', 'good');
          }
        });
        break;
      case 'weapons':
        add('shop', 'Bay Arms — weapons & armor', () => this.weaponMenu());
        break;
      case 'repair':
        add('fix', () => {
          const v = g.player.vehicle;
          return v ? `Repair & respray (${formatMoney(this.repairCost())})` : 'Quick Fix Auto';
        }, () => this.repair(), 'require', 9);
        break;
      case 'marina':
        add('boats', 'Marina — boats', () => this.marinaMenu(p));
        break;
    }
  }

  private surrender() {
    const g = this.g;
    const fine = Math.max(100, Math.round(g.progress.cash * 0.1));
    g.progress.cash = Math.max(0, g.progress.cash - fine);
    g.wanted.clear(false);
    g.ui.notify(`You turned yourself in and paid a ${formatMoney(fine)} fine.`, 'warn');
  }

  private refuel() {
    const g = this.g;
    const v = g.player.vehicle;
    if (!v) return;
    const need = v.spec.fuelCap - v.fuel;
    if (need < 0.5) return g.ui.notify('Tank is already full.', 'info');
    const cost = Math.ceil(need * 2.2);
    if (g.progress.spend(cost)) {
      v.fuel = v.spec.fuelCap;
      g.ui.notify('Tank filled', 'good');
    }
  }

  private repairCost() {
    const v = this.g.player.vehicle;
    if (!v) return 0;
    return 150 + Math.round((1 - v.healthPct) * 600);
  }

  private repair() {
    const g = this.g;
    const v = g.player.vehicle;
    if (!v) return;
    if (v.spec.boat) return g.ui.notify("We don't fix boats here.", 'warn');
    if (!g.progress.spend(this.repairCost())) return;
    v.repair();
    const c = v.spec.colors.filter((x) => x !== v.color);
    v.repaint(c.length ? c[Math.floor(Math.random() * c.length)] : (Math.random() * 0xffffff) | 0);
    g.ui.notify('Repaired and resprayed!', 'good');
    if (g.wanted.level > 0) {
      if (g.wanted.seenT > 2.5 || g.wanted.level <= 2) {
        g.wanted.clear(true);
        g.ui.notify('New paint job — the cops lost track of you.', 'good');
      } else g.ui.notify('The cops saw you go in — the respray did not fool them!', 'bad');
    }
  }

  // ---------------- menus ----------------
  private safehouseMenu(p: POI) {
    const g = this.g;
    const owned = g.progress.properties.has(p.id);
    if (!owned) {
      const price = g.progress.price(p.id, p.price ?? 0);
      const prop = PROPERTIES.find((x) => x.id === p.id);
      g.openShop({
        title: p.name,
        subtitle: 'Property for sale',
        accent: '#39ff88',
        items: [
          { id: 'buy', name: `Buy ${p.name}`, desc: `Safehouse: save point, respawn point, vehicle garage. Earns ${formatMoney(prop?.income ?? 0)} per day.`, price },
          { id: 'close', name: 'Leave' },
        ],
        onSelect: (id) => {
          if (id === 'buy' && g.progress.spend(price)) {
            g.progress.ownProperty(p.id);
            g.ui.notify(`You now own ${p.name}!`, 'achievement');
            this.refreshBlips();
            g.save.save(p.id);
            g.closeShop();
            this.safehouseMenu(p);
            return;
          }
          g.closeShop();
        },
      });
      return;
    }
    const items: ShopItem[] = [
      { id: 'save', name: 'Save game', desc: 'Save your progress. You will respawn here.' },
      { id: 'sleep8', name: 'Sleep until morning (08:00)', desc: 'Restores health. Saves your game.' },
      { id: 'sleep20', name: 'Sleep until evening (20:00)', desc: 'Restores health. Saves your game.' },
    ];
    const owned_v = g.progress.ownedVehicles;
    owned_v.forEach((id, i) => items.push({ id: `veh_${i}`, name: `Garage: ${VEHICLES[id]?.name ?? id}`, desc: 'Take this vehicle out of your garage.', tag: VEHICLES[id]?.boat ? 'boat — launches at the marina' : undefined }));
    if (!owned_v.length) items.push({ id: 'none', name: 'Garage is empty', desc: 'Buy vehicles at a dealership to store them here.', disabled: true });
    items.push({ id: 'close', name: 'Leave' });
    g.openShop({
      title: p.name,
      subtitle: 'Your safehouse',
      accent: '#39ff88',
      items,
      onSelect: (id) => {
        g.closeShop();
        if (id === 'save') {
          g.lastSafehouse = p.id;
          if (g.save.save(p.id)) g.ui.notify('Game saved', 'good');
        } else if (id.startsWith('sleep')) {
          g.env.skipTo(id === 'sleep8' ? 8 : 20);
          g.player.health = g.player.maxHealth;
          g.lastSafehouse = p.id;
          g.save.save(p.id);
          g.fadeFlash();
          g.ui.notify('You slept. Game saved.', 'good');
        } else if (id.startsWith('veh_')) {
          const specId = owned_v[Number(id.slice(4))];
          this.spawnOwned(specId, p);
        }
      },
    });
  }

  spawnOwned(specId: string, p: POI) {
    const g = this.g;
    const spec = VEHICLES[specId];
    if (!spec) return;
    let x = p.ex - 7,
      z = p.ez + (p.yaw === 0 ? 6 : -6),
      yaw = Math.PI / 2;
    if (spec.boat) {
      x = 790;
      z = 148;
      yaw = Math.PI / 2;
    }
    if (g.garageVehicle && g.vehicles.list.includes(g.garageVehicle) && g.player.vehicle !== g.garageVehicle) g.vehicles.remove(g.garageVehicle);
    const v = g.vehicles.spawn(specId, x, z, yaw);
    v.persistent = true;
    v.ownedByPlayer = true;
    v.fuel = spec.fuelCap;
    g.garageVehicle = v;
    g.ui.notify(spec.boat ? `${spec.name} is waiting at the marina.` : `${spec.name} is parked outside.`, 'good');
  }

  private dealerMenu(p: POI) {
    const g = this.g;
    const stock = DEALER_STOCK[p.id] ?? [];
    const items: ShopItem[] = stock.map((id) => {
      const s = VEHICLES[id];
      const unlocked = g.progress.unlocked.has(id);
      const price = g.progress.price(id, s.price);
      const n = g.progress.ownedVehicles.filter((x) => x === id).length;
      return {
        id,
        name: s.name,
        desc: `${s.cls.toUpperCase()} • top speed ${Math.round(s.maxSpeed * 3.6)} km/h • ${unlocked ? (n ? `owned ×${n}` : 'available') : 'LOCKED — progress the story to unlock'}`,
        price: unlocked ? price : undefined,
        disabled: !unlocked,
        tag: g.progress.discounts[id] ? `${Math.round(g.progress.discounts[id] * 100)}% off` : undefined,
      };
    });
    items.push({ id: 'close', name: 'Leave' });
    g.openShop({
      title: p.name,
      subtitle: 'Vehicle dealership — purchases are stored in your safehouse garages',
      accent: '#29e6ff',
      items,
      onSelect: (id) => {
        if (id === 'close') return g.closeShop();
        const s = VEHICLES[id];
        const price = g.progress.price(id, s.price);
        if (g.progress.spend(price)) {
          g.progress.ownedVehicles.push(id);
          g.ui.notify(`Purchased ${s.name}! It's parked out front and stored in your garage.`, 'achievement');
          const v = g.vehicles.spawn(id, p.ex + 6, p.ez + (p.yaw === 0 ? 4 : -4), Math.PI / 2);
          v.persistent = true;
          v.ownedByPlayer = true;
          v.fuel = s.fuelCap;
          g.save.save();
          g.closeShop();
        }
      },
    });
  }

  private clubMenu(p: POI) {
    const g = this.g;
    const items: ShopItem[] = [{ id: 'party', name: 'Party until late (+3 hours)', desc: 'Dance, unwind, restore your health.', price: 50 }];
    if (p.id === 'club_uv' && !g.progress.properties.has('club_uv')) items.push({ id: 'buy', name: 'Buy Club Ultraviolet', desc: 'Owning the club earns $2,500 every in-game day.', price: g.progress.price('club_uv', 60000) });
    else if (p.id === 'club_uv') items.push({ id: 'own', name: 'You own this club', desc: 'Income is paid every morning at 08:00.', disabled: true });
    items.push({ id: 'close', name: 'Leave' });
    g.openShop({
      title: p.name,
      subtitle: 'Nightclub',
      accent: '#b84dff',
      items,
      onSelect: (id) => {
        g.closeShop();
        if (id === 'party' && g.progress.spend(50)) {
          g.env.skipTo((g.env.hours + 3) % 24);
          g.player.health = g.player.maxHealth;
          g.fadeFlash();
          g.progress.achieve('night_owl');
          g.ui.notify('What a night. Health restored.', 'good');
        } else if (id === 'buy') {
          const price = g.progress.price('club_uv', 60000);
          if (g.progress.spend(price)) {
            g.progress.ownProperty('club_uv');
            g.ui.notify('You now own Club Ultraviolet!', 'achievement');
            g.save.save();
          }
        }
      },
    });
  }

  private weaponMenu() {
    const g = this.g;
    const pl = g.player;
    const ids: WeaponId[] = WEAPON_ORDER.filter((w) => w !== 'fists');
    const items: ShopItem[] = [];
    for (const id of ids) {
      const w = WEAPONS[id];
      const owned = pl.inv[id].owned;
      if (!owned) items.push({ id: `buy_${id}`, name: w.name, desc: w.melee ? `Melee • damage ${w.damage}` : `Damage ${w.damage}${w.pellets > 1 ? '×' + w.pellets : ''} • clip ${w.clip} • includes ${w.ammoPack} rounds`, price: w.price });
      else if (!w.melee) items.push({ id: `ammo_${id}`, name: `${w.name} ammo (+${w.ammoPack})`, desc: `You have ${pl.inv[id].clip + pl.inv[id].ammo} rounds`, price: w.ammoPrice });
      else items.push({ id: `own_${id}`, name: `${w.name}`, desc: 'Owned', disabled: true });
    }
    items.push({ id: 'armor', name: 'Body armor', desc: `Absorbs most incoming damage (current ${Math.round(pl.armor)}%)`, price: 500, disabled: pl.armor >= 100 });
    items.push({ id: 'medkit', name: 'Med Kit', desc: `Press H to heal 60 HP (carrying ${pl.medkits})`, price: 150 });
    items.push({ id: 'close', name: 'Leave' });
    g.openShop({
      title: 'Bay Arms',
      subtitle: 'Licensed firearms dealer. No questions asked.',
      accent: '#ff3355',
      items,
      onSelect: (id) => {
        if (id === 'close') return g.closeShop();
        const [kind, wid] = id.split('_') as [string, WeaponId];
        if (kind === 'buy' && g.progress.spend(WEAPONS[wid].price)) {
          pl.giveWeapon(wid, WEAPONS[wid].ammoPack);
          g.ui.notify(`Bought ${WEAPONS[wid].name} (press ${WEAPONS[wid].slot})`, 'good');
        } else if (kind === 'ammo' && g.progress.spend(WEAPONS[wid].ammoPrice)) {
          pl.inv[wid].ammo += WEAPONS[wid].ammoPack;
        } else if (id === 'armor' && g.progress.spend(500)) {
          pl.armor = 100;
        } else if (id === 'medkit' && g.progress.spend(150)) {
          pl.medkits++;
        }
        this.weaponMenu();
      },
    });
  }

  private marinaMenu(p: POI) {
    const g = this.g;
    const boats = g.progress.ownedVehicles.filter((id) => VEHICLES[id]?.boat);
    const items: ShopItem[] = [
      { id: 'rent', name: 'Rent a Wave Runner', desc: 'A nimble jet ski, delivered to the end of the pier.', price: 200 },
      { id: 'buy_marlin', name: 'Buy Marlin Speedboat', desc: 'Fast speedboat, stored in your garage.', price: VEHICLES.marlin.price },
      { id: 'buy_wave', name: 'Buy Wave Runner', desc: 'Own a jet ski.', price: VEHICLES.wave.price },
      ...boats.map((b, i) => ({ id: `launch_${i}`, name: `Launch your ${VEHICLES[b].name}` })),
      { id: 'close', name: 'Leave' },
    ];
    g.openShop({
      title: p.name,
      subtitle: 'Boats & jet skis',
      accent: '#29e6ff',
      items,
      onSelect: (id) => {
        g.closeShop();
        if (id === 'rent' && g.progress.spend(200)) this.spawnBoat('wave');
        else if (id.startsWith('buy_')) {
          const b = id.slice(4);
          if (g.progress.spend(VEHICLES[b].price)) {
            g.progress.ownedVehicles.push(b);
            this.spawnBoat(b);
            g.save.save();
          }
        } else if (id.startsWith('launch_')) this.spawnBoat(boats[Number(id.slice(7))]);
      },
    });
  }

  private spawnBoat(id: string) {
    const g = this.g;
    const v = g.vehicles.spawn(id, 792, 148, Math.PI / 2);
    v.persistent = true;
    v.ownedByPlayer = true;
    v.fuel = v.spec.fuelCap;
    g.ui.notify(`${v.spec.name} is waiting at the end of the pier.`, 'good');
  }
}
