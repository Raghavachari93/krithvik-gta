import { RNG } from '../core/math';
import {
  AIRPORT,
  BLOCKS,
  BRIDGE,
  District,
  GRID_N,
  ISLAND,
  PORT,
  ROAD_HALF,
  SPACING,
  blockInner,
  districtOf,
  roadC,
} from '../constants';

export type BuildingStyle = 'concrete' | 'glass' | 'pastel' | 'brick' | 'industrial' | 'dark' | 'white';
export type RoofType = 'flat' | 'pitched' | 'helipad' | 'antenna' | 'tank';

export interface BuildingDef {
  x: number;
  z: number;
  w: number;
  d: number;
  y0: number;
  h: number;
  style: BuildingStyle;
  color: number;
  roof: RoofType;
  neon?: number;
  awning?: number;
  sign?: string;
  collide?: boolean;
}

export type PropType = 'lamp' | 'hydrant' | 'bin' | 'bench' | 'cone' | 'mailbox' | 'barrier' | 'dumpster' | 'barrel';
export interface PropDef {
  type: PropType;
  x: number;
  z: number;
  yaw: number;
}
export interface TreeDef {
  x: number;
  z: number;
  s: number;
  palm: boolean;
}

export type POIType =
  | 'safehouse'
  | 'police'
  | 'hospital'
  | 'gas'
  | 'dealer'
  | 'club'
  | 'diner'
  | 'weapons'
  | 'repair'
  | 'marina'
  | 'garage'
  | 'property';

export interface POI {
  id: string;
  type: POIType;
  name: string;
  x: number;
  z: number;
  /** door / service point */
  ex: number;
  ez: number;
  yaw: number;
  price?: number;
  district: District;
}

export interface ParkingSpot {
  x: number;
  z: number;
  yaw: number;
  district: District;
  kind: 'lot' | 'drive' | 'dealer' | 'marina' | 'airport' | 'police';
}

export interface GNode {
  id: number;
  x: number;
  z: number;
  links: number[];
  light: boolean;
  gi: number;
  gj: number;
}

export interface StuntJumpDef {
  id: string;
  x: number;
  z: number;
  yaw: number;
}

export interface StairDef {
  x: number;
  z: number;
  yaw: number;
  len: number;
  h: number;
}

export const STREET_X = [
  'Harbor Rd',
  'Mango Ave',
  'Coral Ave',
  'Cypress Ave',
  'Biscayne Ave',
  'Grand Ave',
  'Main St',
  'Palm Ave',
  'Flamingo Ave',
  'Sunset Ave',
  'Marina Ave',
  'Lido Ave',
  'Ocean Drive',
];
export const STREET_Z = [
  'North Shore Blvd',
  'Pelican St',
  'Orchid St',
  'Coral Causeway',
  'Jasmine St',
  'Union St',
  'Neon Highway',
  'Vice St',
  'Magnolia St',
  'Foundry St',
  'Cargo St',
  'Anchor St',
  'Port Blvd',
];

const PASTELS = [0xd9c3a8, 0xc9b49a, 0xe0d2bc, 0xc8a993, 0xcfc0a8, 0xb8c2bb, 0xd6c6b2, 0xbcb7a6];
const CONCRETE = [0xb8b4ab, 0xa29d94, 0xcac5bb, 0x8e8b86, 0xd6d0c4];
const GLASS = [0x4a5f70, 0x34485a, 0x56697a, 0x3e5262, 0x5f6f7c, 0x2c3c4a];
const BRICK = [0x9c5a43, 0x8a4b36, 0xa8664c, 0x7d4a3a, 0xb87a5e];
const DARK = [0x2a2833, 0x332d3d, 0x252a33, 0x3b3340, 0x1f2730];
const INDUSTRIAL = [0x6f7a7e, 0x7f705e, 0x5f6b63, 0x8a806e, 0x69747c, 0x8c5c44];
const WHITE = [0xdcd8cf, 0xd2ccc0, 0xe2ded4, 0xcfd1d0];
const NEON = [0xff2d95, 0x29e6ff, 0xb84dff, 0xff9a1f, 0x39ff88, 0xff3355];
const HOUSE = [0xcdbfa6, 0xb3baa8, 0xc4b4a0, 0xa9b2b8, 0xc4ada6, 0xbdb592, 0xd4c7ae];

export class CityLayout {
  buildings: BuildingDef[] = [];
  props: PropDef[] = [];
  trees: TreeDef[] = [];
  pois: POI[] = [];
  parking: ParkingSpot[] = [];
  nodes: GNode[] = [];
  stunts: StuntJumpDef[] = [];
  stairs: StairDef[] = [];
  pools: { x: number; z: number; w: number; d: number }[] = [];
  grass: { x: number; z: number; w: number; d: number }[] = [];
  lots: { x: number; z: number; w: number; d: number }[] = [];
  billboards: { x: number; z: number; y: number; yaw: number; w: number; h: number; text: string; color: number }[] = [];
  containers: { x: number; z: number; y: number; yaw: number; color: number }[] = [];
  parkourBoxes: { x: number; z: number; w: number; d: number; h: number }[] = [];
  parkourCheckpoints: { x: number; y: number; z: number }[] = [];
  alleyPoints: { x: number; z: number }[] = [];
  rooftopPoints: { x: number; y: number; z: number }[] = [];
  reserved = new Set<string>();
  private rng = new RNG(1337);

  constructor() {
    this.definePOIs();
    for (let bi = 0; bi < BLOCKS; bi++) for (let bj = 0; bj < BLOCKS; bj++) this.genBlock(bi, bj);
    this.genStreetFurniture();
    this.genSpecialAreas();
    this.genGraph();
    this.genStunts();
  }

  // ---------- POIs ----------
  private quad(bi: number, bj: number, q: number) {
    const inn = blockInner(bi, bj);
    const qx = q % 2,
      qz = Math.floor(q / 2);
    const half = (inn.x1 - inn.x0) / 2;
    const x0 = inn.x0 + qx * half,
      z0 = inn.z0 + qz * half;
    return { x0, z0, x1: x0 + half, z1: z0 + half, cx: x0 + half / 2, cz: z0 + half / 2, size: half, qz };
  }

  private addPOI(id: string, type: POIType, name: string, bi: number, bj: number, q: number, price?: number) {
    const Q = this.quad(bi, bj, q);
    this.reserved.add(`${bi},${bj},${q}`);
    const outZ = Q.qz === 0 ? Q.z0 - 2 : Q.z1 + 2;
    const yaw = Q.qz === 0 ? Math.PI : 0; // door facing out (north => -z => yaw PI)
    const poi: POI = { id, type, name, x: Q.cx, z: Q.cz, ex: Q.cx, ez: outZ, yaw, price, district: districtOf(bi, bj) };
    this.pois.push(poi);
    this.buildPOI(poi, Q);
    return poi;
  }

  private definePOIs() {
    this.addPOI('sh_starter', 'safehouse', 'Palmetto Apartments', 1, 1, 3, 0);
    this.addPOI('sh_docks', 'safehouse', 'Dockside Loft', 2, 10, 1, 15000);
    this.addPOI('sh_beach', 'safehouse', 'Seabreeze Condo', 11, 3, 0, 35000);
    this.addPOI('club_uv', 'club', 'Club Ultraviolet', 9, 6, 0, 60000);
    this.addPOI('club_pulse', 'club', 'Pulse Nightclub', 10, 7, 2);
    this.addPOI('pd_central', 'police', 'NBPD Central', 5, 4, 0);
    this.addPOI('pd_north', 'police', 'NBPD Palmetto', 2, 2, 1);
    this.addPOI('pd_harbor', 'police', 'NBPD Harbor', 4, 10, 3);
    this.addPOI('hospital', 'hospital', 'St. Marisa Hospital', 7, 2, 2);
    this.addPOI('gas_1', 'gas', 'Bayfuel', 3, 6, 1);
    this.addPOI('gas_2', 'gas', 'Bayfuel', 8, 1, 2);
    this.addPOI('gas_3', 'gas', 'Bayfuel', 6, 10, 0);
    this.addPOI('gas_4', 'gas', 'Bayfuel', 10, 9, 1);
    this.addPOI('dealer_bayside', 'dealer', 'Bayside Motors', 7, 9, 3);
    this.addPOI('dealer_apex', 'dealer', 'Apex Exotics', 10, 1, 1);
    this.addPOI('diner_sunset', 'diner', 'Sunset Diner', 11, 6, 2);
    this.addPOI('diner_taco', 'diner', 'Taco Loco', 1, 7, 0);
    this.addPOI('ammo_market', 'weapons', 'Bay Arms', 5, 9, 1);
    this.addPOI('ammo_north', 'weapons', 'Bay Arms', 2, 4, 2);
    this.addPOI('repair_1', 'repair', 'Quick Fix Auto', 3, 8, 3);
    this.addPOI('repair_2', 'repair', 'Quick Fix Auto', 8, 4, 1);
    this.addPOI('garage_vega', 'garage', "Vega's Garage", 1, 10, 2);
    // island villa + marina are custom placed
    const villa: POI = {
      id: 'sh_villa',
      type: 'safehouse',
      name: 'Coral Key Villa',
      x: 1180,
      z: -380,
      ex: 1180,
      ez: -360,
      yaw: 0,
      price: 90000,
      district: 'luxury',
    };
    this.pois.push(villa);
    this.buildings.push({ x: 1180, z: -385, w: 26, d: 18, y0: 0, h: 9, style: 'white', color: 0xf6f3ea, roof: 'flat' });
    this.pools.push({ x: 1180, z: -366, w: 12, d: 6 });
    const marina: POI = {
      id: 'marina',
      type: 'marina',
      name: 'Neon Bay Marina',
      x: 740,
      z: 160,
      ex: 734,
      ez: 160,
      yaw: Math.PI / 2,
      district: 'beachfront',
    };
    this.pois.push(marina);
  }

  private buildPOI(p: POI, Q: ReturnType<CityLayout['quad']>) {
    const B = this.buildings;
    const north = Q.qz === 0;
    const back = (depth: number) => (north ? Q.z1 - 2 - depth / 2 : Q.z0 + 2 + depth / 2);
    const front = (depth: number) => (north ? Q.z0 + 2 + depth / 2 : Q.z1 - 2 - depth / 2);
    switch (p.type) {
      case 'safehouse':
        B.push({ x: Q.cx, z: back(22), w: 30, d: 22, y0: 0, h: 18, style: 'pastel', color: 0xcdb3a0, roof: 'tank', sign: p.name });
        this.parking.push({ x: Q.cx - 8, z: front(6), yaw: Math.PI / 2, district: p.district, kind: 'lot' });
        break;
      case 'police':
        B.push({ x: Q.cx, z: back(22), w: 32, d: 22, y0: 0, h: 13, style: 'concrete', color: 0xd8dde4, roof: 'antenna', sign: 'POLICE' });
        for (let i = 0; i < 3; i++) this.parking.push({ x: Q.x0 + 7 + i * 6, z: front(6), yaw: 0, district: p.district, kind: 'police' });
        break;
      case 'hospital':
        B.push({ x: Q.cx, z: back(26), w: 34, d: 26, y0: 0, h: 24, style: 'white', color: 0xf4f6f7, roof: 'helipad', sign: 'HOSPITAL' });
        break;
      case 'gas':
        B.push({ x: Q.cx + 8, z: back(9), w: 14, d: 9, y0: 0, h: 4.5, style: 'white', color: 0xf0f0f0, roof: 'flat', sign: 'BAYFUEL', neon: 0x39ff88 });
        break;
      case 'dealer':
        B.push({ x: Q.cx, z: back(16), w: 30, d: 16, y0: 0, h: 8, style: 'glass', color: 0x9fc4d8, roof: 'flat', sign: p.name.toUpperCase(), neon: 0x29e6ff });
        for (let i = 0; i < 4; i++) this.parking.push({ x: Q.x0 + 6 + i * 8, z: front(8), yaw: 0.4, district: p.district, kind: 'dealer' });
        break;
      case 'club':
        B.push({ x: Q.cx, z: back(26), w: 32, d: 26, y0: 0, h: 11, style: 'dark', color: 0x1c1a24, roof: 'flat', sign: p.name.toUpperCase(), neon: p.id === 'club_uv' ? 0xb84dff : 0xff2d95 });
        break;
      case 'diner':
        B.push({ x: Q.cx, z: back(12), w: 20, d: 12, y0: 0, h: 5, style: 'pastel', color: p.id === 'diner_taco' ? 0xd9b878 : 0x9fbfae, roof: 'flat', sign: p.name.toUpperCase(), neon: 0xff3355, awning: 0xd94a5a });
        this.parking.push({ x: Q.cx - 10, z: front(6), yaw: Math.PI / 2, district: p.district, kind: 'lot' });
        break;
      case 'weapons':
        B.push({ x: Q.cx, z: back(14), w: 16, d: 14, y0: 0, h: 6, style: 'brick', color: 0x6e5a4e, roof: 'flat', sign: 'BAY ARMS', neon: 0xff9a1f });
        break;
      case 'repair':
        B.push({ x: Q.cx, z: back(16), w: 24, d: 16, y0: 0, h: 7, style: 'industrial', color: 0x5c7a8a, roof: 'flat', sign: 'QUICK FIX', neon: 0x29e6ff });
        break;
      case 'garage':
        B.push({ x: Q.cx, z: back(20), w: 28, d: 20, y0: 0, h: 9, style: 'industrial', color: 0x8a6a4a, roof: 'flat', sign: 'VEGA', neon: 0xff9a1f });
        break;
    }
    // service point for drive-in POIs is in the front yard
    if (p.type === 'gas' || p.type === 'repair' || p.type === 'garage' || p.type === 'dealer') {
      p.ex = Q.cx - (p.type === 'gas' ? 6 : 0);
      p.ez = front(10);
    }
    if (p.type === 'safehouse') {
      p.ex = Q.cx + 6;
      p.ez = front(4);
    }
    this.lots.push({ x: Q.cx, z: Q.cz, w: Q.size - 2, d: Q.size - 2 });
  }

  // ---------- blocks ----------
  private genBlock(bi: number, bj: number) {
    const dist = districtOf(bi, bj);
    const inn = blockInner(bi, bj);
    const r = this.rng;
    if (dist === 'park') {
      this.grass.push({ x: (inn.x0 + inn.x1) / 2, z: (inn.z0 + inn.z1) / 2, w: inn.x1 - inn.x0, d: inn.z1 - inn.z0 });
      for (let i = 0; i < 26; i++) {
        const x = r.range(inn.x0 + 3, inn.x1 - 3),
          z = r.range(inn.z0 + 3, inn.z1 - 3);
        const cx = (inn.x0 + inn.x1) / 2,
          cz = (inn.z0 + inn.z1) / 2;
        if (Math.abs(x - cx) < 6 || Math.abs(z - cz) < 6) continue;
        this.trees.push({ x, z, s: r.range(0.9, 1.5), palm: r.chance(0.25) });
      }
      const cx = (inn.x0 + inn.x1) / 2,
        cz = (inn.z0 + inn.z1) / 2;
      this.buildings.push({ x: cx, z: cz, w: 6, d: 6, y0: 0, h: 0.9, style: 'white', color: 0xd8d8d0, roof: 'flat' });
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        this.props.push({ type: 'bench', x: cx + Math.cos(a) * 9, z: cz + Math.sin(a) * 9, yaw: -a + Math.PI / 2 });
      }
      return;
    }
    if (dist === 'lot') {
      this.lots.push({ x: (inn.x0 + inn.x1) / 2, z: (inn.z0 + inn.z1) / 2, w: inn.x1 - inn.x0, d: inn.z1 - inn.z0 });
      for (let i = 0; i < 6; i++) this.props.push({ type: 'barrel', x: inn.x0 + 3 + i * 1.2, z: inn.z1 - 3, yaw: 0 });
      for (let i = 0; i < 8; i++) this.props.push({ type: 'cone', x: r.range(inn.x0 + 10, inn.x1 - 10), z: r.range(inn.z0 + 10, inn.z1 - 10), yaw: 0 });
      return;
    }
    if (dist === 'parkour') {
      this.genParkour(inn);
      return;
    }
    for (let q = 0; q < 4; q++) {
      if (this.reserved.has(`${bi},${bj},${q}`)) continue;
      this.genQuad(bi, bj, q, dist);
    }
    // the alley crossing in the block centre is a hidden spot
    if (bi % 3 === 1 || bj % 4 === 2) this.alleyPoints.push({ x: (inn.x0 + inn.x1) / 2, z: (inn.z0 + inn.z1) / 2 });
  }

  private genQuad(bi: number, bj: number, q: number, dist: District) {
    const Q = this.quad(bi, bj, q);
    const r = this.rng;
    const B = this.buildings;
    const m = 2;
    const W = Q.size - m * 2; // 34
    const cx = Q.cx,
      cz = Q.cz;
    const parkingChance = dist === 'downtown' ? 0.12 : dist === 'commercial' || dist === 'nightlife' ? 0.15 : dist === 'residential' ? 0.06 : 0;
    if (r.chance(parkingChance)) {
      this.lots.push({ x: cx, z: cz, w: Q.size - 2, d: Q.size - 2 });
      for (let row = 0; row < 2; row++)
        for (let c = 0; c < 5; c++) {
          if (r.chance(0.35)) continue;
          this.parking.push({ x: Q.x0 + 5 + c * 6.5, z: cz + (row === 0 ? -7 : 7), yaw: row === 0 ? 0 : Math.PI, district: dist, kind: 'lot' });
        }
      this.props.push({ type: 'lamp', x: cx, z: cz, yaw: 0 });
      return;
    }
    const dCenter = Math.hypot(cx, cz);
    switch (dist) {
      case 'downtown': {
        if (r.chance(0.12)) {
          // plaza
          this.grass.push({ x: cx, z: cz, w: 20, d: 20 });
          for (let i = 0; i < 4; i++) this.trees.push({ x: cx + (i % 2 ? 7 : -7), z: cz + (i < 2 ? 7 : -7), s: 1.1, palm: true });
          this.props.push({ type: 'bench', x: cx, z: cz + 11, yaw: 0 });
          break;
        }
        const isSpire = bi === 5 && bj === 5 && q === 3;
        const w = isSpire ? 30 : r.range(20, W),
          d = isSpire ? 30 : r.range(20, W);
        const tall = isSpire ? 260 : r.range(45, 120) + Math.max(0, 300 - dCenter) * 0.35;
        const style = r.pick<BuildingStyle>(['glass', 'glass', 'concrete', 'dark']);
        const col = style === 'glass' ? r.pick(GLASS) : style === 'dark' ? r.pick(DARK) : r.pick(CONCRETE);
        if (tall > 85) {
          B.push({ x: cx, z: cz, w, d, y0: 0, h: tall * 0.55, style, color: col, roof: 'flat' });
          B.push({ x: cx, z: cz, w: w * 0.78, d: d * 0.78, y0: tall * 0.55, h: tall * 0.3, style, color: col, roof: 'flat' });
          B.push({ x: cx, z: cz, w: w * 0.55, d: d * 0.55, y0: tall * 0.85, h: tall * 0.15, style, color: col, roof: isSpire || r.chance(0.5) ? 'antenna' : 'helipad', neon: isSpire ? 0x29e6ff : r.chance(0.3) ? r.pick(NEON) : undefined });
        } else {
          B.push({ x: cx, z: cz, w, d, y0: 0, h: tall, style, color: col, roof: r.chance(0.3) ? 'helipad' : 'flat', neon: r.chance(0.2) ? r.pick(NEON) : undefined });
        }
        if (r.chance(0.35)) {
          this.billboards.push({ x: cx, z: cz, y: tall > 85 ? tall * 0.55 + 2 : tall + 2, yaw: r.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]), w: 14, h: 6, text: r.pick(ADS), color: r.pick(NEON) });
        }
        break;
      }
      case 'residential': {
        if (r.chance(0.32)) {
          const w = r.range(24, W),
            d = r.range(18, 26),
            h = r.range(12, 26);
          const style = r.pick<BuildingStyle>(['brick', 'concrete', 'pastel']);
          const col = style === 'brick' ? r.pick(BRICK) : style === 'pastel' ? r.pick(PASTELS) : r.pick(CONCRETE);
          B.push({ x: cx, z: cz, w, d, y0: 0, h, style, color: col, roof: r.chance(0.5) ? 'tank' : 'flat' });
          this.maybeStairs(cx, cz, w, d, h, 0.55);
        } else {
          for (let k = 0; k < 4; k++) {
            const sx = Q.x0 + (k % 2) * 19 + 9.5,
              sz = Q.z0 + Math.floor(k / 2) * 19 + 9.5;
            const hw = r.range(8, 11),
              hd = r.range(8, 10);
            B.push({ x: sx, z: sz, w: hw, d: hd, y0: 0, h: r.range(3.6, 6.5), style: 'pastel', color: r.pick(HOUSE), roof: 'pitched' });
            if (r.chance(0.6)) this.trees.push({ x: sx + (k % 2 ? 6.5 : -6.5), z: sz + r.range(-4, 4), s: r.range(0.8, 1.2), palm: r.chance(0.2) });
            if (r.chance(0.35)) this.parking.push({ x: sx + (k % 2 ? -6.5 : 6.5), z: sz, yaw: 0, district: dist, kind: 'drive' });
          }
          this.grass.push({ x: cx, z: cz, w: Q.size - 2, d: Q.size - 2 });
        }
        break;
      }
      case 'luxury': {
        if (r.chance(0.3)) {
          const h = r.range(25, 45);
          B.push({ x: cx, z: cz, w: r.range(22, 30), d: r.range(20, 28), y0: 0, h, style: 'white', color: r.pick(WHITE), roof: 'flat', neon: r.chance(0.4) ? r.pick(NEON) : undefined });
        } else {
          const w = r.range(18, 24),
            d = r.range(13, 18);
          B.push({ x: cx - 3, z: cz - 4, w, d, y0: 0, h: r.range(6, 9), style: 'white', color: r.pick(WHITE), roof: 'flat' });
          B.push({ x: cx - 3 + w * 0.2, z: cz - 4, w: w * 0.5, d: d * 0.7, y0: 0, h: r.range(9, 12), style: 'white', color: r.pick(WHITE), roof: 'flat' });
          this.pools.push({ x: cx + 4, z: cz + 9, w: 10, d: 5 });
          this.grass.push({ x: cx, z: cz, w: Q.size - 2, d: Q.size - 2 });
          for (let i = 0; i < 3; i++) this.trees.push({ x: Q.x0 + 4 + i * 14, z: Q.z1 - 4, s: r.range(1, 1.4), palm: true });
          this.parking.push({ x: cx + 12, z: cz - 6, yaw: 0, district: dist, kind: 'drive' });
        }
        break;
      }
      case 'beachfront': {
        const w = r.range(24, W),
          d = r.range(20, 30),
          h = r.range(14, 46);
        B.push({ x: cx, z: cz, w, d, y0: 0, h, style: 'pastel', color: r.pick(PASTELS), roof: r.chance(0.4) ? 'tank' : 'flat', neon: r.pick(NEON), sign: r.chance(0.6) ? r.pick(HOTELS) : undefined });
        break;
      }
      case 'nightlife': {
        const w = r.range(18, W),
          d = r.range(18, W),
          h = r.range(9, 38);
        const style = r.pick<BuildingStyle>(['dark', 'dark', 'brick', 'concrete']);
        const col = style === 'dark' ? r.pick(DARK) : style === 'brick' ? r.pick(BRICK) : r.pick(CONCRETE);
        B.push({ x: cx, z: cz, w, d, y0: 0, h, style, color: col, roof: 'flat', neon: r.pick(NEON), sign: r.chance(0.5) ? r.pick(BARS) : undefined });
        this.maybeStairs(cx, cz, w, d, h, 0.3);
        if (r.chance(0.4)) this.billboards.push({ x: cx, z: cz, y: h + 1.5, yaw: r.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]), w: 10, h: 4.5, text: r.pick(ADS), color: r.pick(NEON) });
        break;
      }
      case 'commercial': {
        if (r.chance(0.55)) {
          for (let k = 0; k < 2; k++) {
            const sx = Q.x0 + 2 + k * 17 + 7.5;
            const h = r.range(6, 13);
            const style = r.pick<BuildingStyle>(['brick', 'pastel', 'concrete']);
            const col = style === 'brick' ? r.pick(BRICK) : style === 'pastel' ? r.pick(PASTELS) : r.pick(CONCRETE);
            B.push({ x: sx, z: cz, w: 15, d: r.range(16, 26), y0: 0, h, style, color: col, roof: 'flat', awning: r.pick(NEON), sign: r.chance(0.7) ? r.pick(SHOPS) : undefined });
          }
        } else {
          const w = r.range(22, W),
            d = r.range(22, W),
            h = r.range(20, 55);
          const style = r.pick<BuildingStyle>(['concrete', 'glass']);
          B.push({ x: cx, z: cz, w, d, y0: 0, h, style, color: style === 'glass' ? r.pick(GLASS) : r.pick(CONCRETE), roof: r.chance(0.3) ? 'tank' : 'flat' });
        }
        break;
      }
      case 'industrial': {
        const roll = r.next();
        if (roll < 0.55) {
          const w = r.range(26, W),
            d = r.range(22, W),
            h = r.range(8, 14);
          B.push({ x: cx, z: cz, w, d, y0: 0, h, style: 'industrial', color: r.pick(INDUSTRIAL), roof: 'flat' });
          this.maybeStairs(cx, cz, w, d, h, 0.4);
          this.props.push({ type: 'dumpster', x: cx + w / 2 + 1.5, z: cz + r.range(-6, 6), yaw: Math.PI / 2 });
        } else if (roll < 0.8) {
          // container yard
          this.lots.push({ x: cx, z: cz, w: Q.size - 2, d: Q.size - 2 });
          for (let i = 0; i < 6; i++) {
            const stack = r.int(1, 3);
            for (let s = 0; s < stack; s++)
              this.containers.push({ x: Q.x0 + 6 + (i % 3) * 11, z: cz + (i < 3 ? -7 : 7), y: s * 2.6, yaw: 0, color: r.pick(CONTAINER_COLORS) });
          }
        } else {
          // fuel tanks
          this.lots.push({ x: cx, z: cz, w: Q.size - 2, d: Q.size - 2 });
          for (let i = 0; i < 2; i++) B.push({ x: cx + (i ? 8 : -8), z: cz, w: 12, d: 12, y0: 0, h: 10, style: 'white', color: 0xdcdcd4, roof: 'tank' });
          for (let i = 0; i < 5; i++) this.props.push({ type: 'barrel', x: cx - 6 + i * 2, z: cz + 12, yaw: 0 });
        }
        break;
      }
    }
  }

  private maybeStairs(cx: number, cz: number, w: number, d: number, h: number, p: number) {
    if (h > 18 || !this.rng.chance(p)) return;
    const len = h / 0.62;
    if (len > w - 1) return;
    // stairs run along the north (-z) wall, climbing toward +x
    const sz = cz - d / 2 - 1.0;
    const sx = cx - w / 2 + len / 2 + 0.5;
    this.stairs.push({ x: sx, z: sz, yaw: Math.PI / 2, len, h });
    this.rooftopPoints.push({ x: cx, y: h, z: cz });
  }

  private genParkour(inn: { x0: number; z0: number; x1: number; z1: number }) {
    const X = (u: number) => inn.x0 + u,
      Z = (v: number) => inn.z0 + v;
    const boxes: [number, number, number, number, number][] = [
      // u, v, w, d, h
      [6, 4, 2, 2, 1.0],
      [9.5, 4, 3, 2.4, 1.9],
      [14.5, 5, 6, 6, 3.6],
      [24, 8, 12, 12, 5.4],
      [36, 9, 10, 10, 7.2],
      [50, 12, 12, 14, 7.4],
      [62, 22, 10, 10, 9.3],
      [60, 37, 14, 14, 9.3],
      [44, 40, 12, 12, 11.2],
      [28, 44, 16, 16, 13.0],
      [12, 60, 14, 22, 6.0],
      [60, 62, 20, 20, 22],
    ];
    boxes.forEach(([u, v, w, d, h], i) => {
      this.parkourBoxes.push({ x: X(u), z: Z(v), w, d, h });
      this.buildings.push({
        x: X(u),
        z: Z(v),
        w,
        d,
        y0: 0,
        h,
        style: i < 2 ? 'industrial' : i % 2 ? 'brick' : 'concrete',
        color: i < 2 ? 0x4a6b5a : i % 2 ? BRICK[i % BRICK.length] : CONCRETE[i % CONCRETE.length],
        roof: 'flat',
      });
    });
    [3, 4, 5, 6, 7, 8, 9].forEach((i) => {
      const [u, v, , , h] = boxes[i];
      this.parkourCheckpoints.push({ x: X(u), y: h, z: Z(v) });
    });
    this.rooftopPoints.push({ x: X(28), y: 13, z: Z(44) });
  }

  // ---------- street furniture ----------
  private genStreetFurniture() {
    const r = this.rng;
    const lo = roadC(0),
      hi = roadC(GRID_N - 1);
    const off = ROAD_HALF + 1.2;
    for (let i = 0; i < GRID_N; i++) {
      const c = roadC(i);
      for (let t = lo + 25; t < hi; t += 50) {
        // skip near intersections
        const local = ((t + 600) % SPACING + SPACING) % SPACING;
        if (local < 14 || local > SPACING - 14) continue;
        // vertical road at x=c
        if (i > 0) this.props.push({ type: 'lamp', x: c - off, z: t, yaw: Math.PI / 2 });
        if (i < GRID_N - 1) this.props.push({ type: 'lamp', x: c + off, z: t, yaw: -Math.PI / 2 });
        if (i > 0) this.props.push({ type: 'lamp', x: t, z: c - off, yaw: 0 });
        if (i < GRID_N - 1) this.props.push({ type: 'lamp', x: t, z: c + off, yaw: Math.PI });
      }
    }
    // smaller props along sidewalks
    for (let bi = 0; bi < BLOCKS; bi++)
      for (let bj = 0; bj < BLOCKS; bj++) {
        const d = districtOf(bi, bj);
        const x0 = roadC(bi) + ROAD_HALF + 1.4,
          x1 = roadC(bi + 1) - ROAD_HALF - 1.4;
        const z0 = roadC(bj) + ROAD_HALF + 1.4,
          z1 = roadC(bj + 1) - ROAD_HALF - 1.4;
        const n = d === 'park' ? 2 : 5;
        for (let k = 0; k < n; k++) {
          const side = r.int(0, 3);
          const t = r.range(18, 66);
          let x = 0,
            z = 0,
            yaw = 0;
          if (side === 0) {
            x = x0 + t;
            z = z0;
            yaw = 0;
          } else if (side === 1) {
            x = x0 + t;
            z = z1;
            yaw = Math.PI;
          } else if (side === 2) {
            x = x0;
            z = z0 + t;
            yaw = Math.PI / 2;
          } else {
            x = x1;
            z = z0 + t;
            yaw = -Math.PI / 2;
          }
          const type = r.pick<PropType>(['hydrant', 'bin', 'bin', 'bench', 'mailbox']);
          this.props.push({ type, x, z, yaw });
        }
        // street trees
        if (d === 'residential' || d === 'luxury' || d === 'commercial' || d === 'beachfront') {
          for (let t = 22; t < 80; t += 28) {
            const palm = d !== 'residential' && d !== 'commercial';
            this.trees.push({ x: x0 + t, z: z0 + 0.6, s: r.range(0.8, 1.1), palm });
            this.trees.push({ x: x0 + t + 6, z: z1 - 0.6, s: r.range(0.8, 1.1), palm });
          }
        }
      }
    // Ocean Drive promenade palms
    for (let z = -620; z < 620; z += 18) {
      if (Math.abs(z - BRIDGE.z) < 16) continue;
      this.trees.push({ x: 626, z, s: r.range(1.1, 1.5), palm: true });
    }
    // beach palms
    for (let i = 0; i < 40; i++) {
      const z = r.range(-600, 600);
      if (Math.abs(z - BRIDGE.z) < 20 || Math.abs(z - 160) < 30) continue;
      this.trees.push({ x: r.range(645, 680), z, s: r.range(1.0, 1.6), palm: true });
    }
  }

  // ---------- special areas: airport, port, island, marina ----------
  private genSpecialAreas() {
    const B = this.buildings;
    const r = this.rng;
    // Airport
    B.push({ x: -740, z: -130, w: 40, d: 140, y0: 0, h: 16, style: 'glass', color: 0x8fb3c9, roof: 'flat', sign: 'NEON BAY INTL', neon: 0x29e6ff });
    B.push({ x: -700, z: 70, w: 10, d: 10, y0: 0, h: 34, style: 'concrete', color: 0xd0d0cc, roof: 'antenna' });
    B.push({ x: -700, z: 70, w: 16, d: 16, y0: 34, h: 6, style: 'glass', color: 0x4b7a95, roof: 'flat' });
    for (let i = 0; i < 3; i++) B.push({ x: -960, z: -240 + i * 60, w: 40, d: 44, y0: 0, h: 16, style: 'industrial', color: 0xa9b2b6, roof: 'flat' });
    for (let i = 0; i < 6; i++) this.parking.push({ x: -800, z: 120 + i * 7, yaw: Math.PI / 2, district: 'commercial', kind: 'airport' });
    // Port: cranes, containers, warehouses, ship
    for (let i = 0; i < 4; i++) B.push({ x: -560 + i * 70, z: 670, w: 44, d: 28, y0: 0, h: 12, style: 'industrial', color: r.pick(INDUSTRIAL), roof: 'flat' });
    for (let i = 0; i < 40; i++) {
      const cx = -250 + (i % 10) * 7,
        cz = 660 + Math.floor(i / 10) * 13;
      const stack = r.int(1, 3);
      for (let s = 0; s < stack; s++) this.containers.push({ x: cx, z: cz, y: s * 2.6, yaw: Math.PI / 2, color: r.pick(CONTAINER_COLORS) });
    }
    // piers (walkable deck boxes over water)
    for (let i = 0; i < 3; i++) B.push({ x: -100 + i * 120, z: 760, w: 14, d: 80, y0: -3, h: 3.4, style: 'industrial', color: 0x6b5a48, roof: 'flat' });
    // docked cargo ship
    B.push({ x: 160, z: 790, w: 110, d: 22, y0: -4, h: 12, style: 'industrial', color: 0x9b2f2f, roof: 'flat' });
    B.push({ x: 200, z: 790, w: 18, d: 18, y0: 8, h: 10, style: 'white', color: 0xeeeeee, roof: 'antenna' });
    // Island
    this.grass.push({ x: (ISLAND.minX + ISLAND.maxX) / 2, z: (ISLAND.minZ + ISLAND.maxZ) / 2, w: ISLAND.maxX - ISLAND.minX - 10, d: ISLAND.maxZ - ISLAND.minZ - 10 });
    B.push({ x: 1270, z: -150, w: 7, d: 7, y0: 0, h: 26, style: 'white', color: 0xf4f0ea, roof: 'antenna', neon: 0xffe680 });
    for (let i = 0; i < 4; i++) {
      const vx = 1080 + (i % 2) * 140,
        vz = -440 + Math.floor(i / 2) * 230;
      if (i === 0) continue;
      B.push({ x: vx, z: vz, w: 22, d: 16, y0: 0, h: 8, style: 'white', color: r.pick(WHITE), roof: 'flat' });
      this.pools.push({ x: vx, z: vz + 13, w: 9, d: 5 });
    }
    for (let i = 0; i < 40; i++) this.trees.push({ x: r.range(ISLAND.minX + 8, ISLAND.maxX - 8), z: r.range(ISLAND.minZ + 8, ISLAND.maxZ - 8), s: r.range(1, 1.5), palm: true });
    // Marina pier
    B.push({ x: 760, z: 160, w: 76, d: 6, y0: -3, h: 3.15, style: 'industrial', color: 0x7a6650, roof: 'flat', collide: true });
    for (let i = 0; i < 4; i++) this.parking.push({ x: 752 + i * 12, z: 168, yaw: Math.PI / 2, district: 'beachfront', kind: 'marina' });
    this.parking.push({ x: 758, z: 152, yaw: Math.PI / 2, district: 'beachfront', kind: 'marina' });
    this.parking.push({ x: 782, z: 152, yaw: Math.PI / 2, district: 'beachfront', kind: 'marina' });
  }

  // ---------- road graph ----------
  nodeAt(i: number, j: number) {
    return this.nodes[j * GRID_N + i];
  }
  private link(a: GNode, b: GNode) {
    if (!a.links.includes(b.id)) a.links.push(b.id);
    if (!b.links.includes(a.id)) b.links.push(a.id);
  }
  private addNode(x: number, z: number, light = false, gi = -1, gj = -1) {
    const n: GNode = { id: this.nodes.length, x, z, links: [], light, gi, gj };
    this.nodes.push(n);
    return n;
  }
  private genGraph() {
    for (let j = 0; j < GRID_N; j++) for (let i = 0; i < GRID_N; i++) this.addNode(roadC(i), roadC(j), true, i, j);
    for (let j = 0; j < GRID_N; j++)
      for (let i = 0; i < GRID_N; i++) {
        if (i < GRID_N - 1) this.link(this.nodeAt(i, j), this.nodeAt(i + 1, j));
        if (j < GRID_N - 1) this.link(this.nodeAt(i, j), this.nodeAt(i, j + 1));
      }
    for (const n of this.nodes) n.light = n.links.length >= 3;
    // airport expressway
    const a1 = this.addNode(-900, 0);
    this.link(this.nodeAt(0, 6), a1);
    const a2 = this.addNode(-900, 260);
    const a3 = this.addNode(-900, -260);
    this.link(a1, a2);
    this.link(a1, a3);
    // causeway + island loop
    const i0 = this.addNode(1050, BRIDGE.z);
    this.link(this.nodeAt(12, 3), i0);
    const i1 = this.addNode(1050, -440),
      i2 = this.addNode(1250, -440),
      i3 = this.addNode(1250, -160),
      i4 = this.addNode(1050, -160);
    this.link(i0, i1);
    this.link(i1, i2);
    this.link(i2, i3);
    this.link(i3, i4);
    this.link(i4, i0);
  }

  private genStunts() {
    const s = (id: string, x: number, z: number, yaw: number) => this.stunts.push({ id, x, z, yaw });
    s('sj_beach_n', 690, -520, 0);
    s('sj_beach_s', 690, 420, Math.PI);
    s('sj_port_a', -380, 655, Math.PI / 2);
    s('sj_port_b', 40, 700, -Math.PI / 2);
    s('sj_airport_a', -860, -150, 0);
    s('sj_airport_b', -850, 160, Math.PI);
    s('sj_lot', roadC(1) + 30, roadC(11) + 50, Math.PI / 2);
    s('sj_island', 1150, -300, Math.PI / 2);
  }

  streetName(x: number, z: number) {
    let bestD = 1e9,
      name = '';
    for (let i = 0; i < GRID_N; i++) {
      const dx = Math.abs(x - roadC(i));
      if (dx < bestD && z >= roadC(0) - 10 && z <= roadC(12) + 10) {
        bestD = dx;
        name = STREET_X[i];
      }
      const dz = Math.abs(z - roadC(i));
      if (dz < bestD && x >= roadC(0) - 10 && x <= roadC(12) + 10) {
        bestD = dz;
        name = STREET_Z[i];
      }
    }
    if (Math.abs(z - BRIDGE.z) < 12 && x > 640 && x < 1000) return 'Coral Key Bridge';
    if (x < AIRPORT.maxX && x > AIRPORT.minX && Math.abs(z) < 15) return 'Airport Expressway';
    return bestD < 14 ? name : '';
  }
}

const CONTAINER_COLORS = [0xb03a2e, 0x2e6fb0, 0x2e8b57, 0xd4a017, 0x7a3fb0, 0xe0673a, 0x3a9ea5];
const ADS = ['NEON COLA', 'BAYWAVE 101.7', 'SUNNY SIDE AUTO', 'GLOW ENERGY', 'PALM AIR', 'CRUISE SODA', 'VELVET VODKA', 'SHORE BANK', 'TIDE TECH'];
const HOTELS = ['HOTEL FLAMINGO', 'THE CORAL', 'SEABREEZE', 'PALM ROYALE', 'THE LIDO', 'AQUA INN'];
const BARS = ['MOJO', 'NOVA', 'LUXE', 'RIFF', 'ECHO', 'AFTERGLOW', 'VOLT'];
const SHOPS = ['DELI', 'PHARMACY', 'CAFE', 'PIZZA', 'BOUTIQUE', 'ELECTRO', 'SURF SHOP', 'BOOKS', 'NAILS', 'NOODLES'];
