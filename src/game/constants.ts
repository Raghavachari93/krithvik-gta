/** World constants for the city of Neon Bay. Units are metres. Yaw 0 faces +Z (south on the map). */
export const GRID_N = 13; // road lines per axis (0..12)
export const BLOCKS = 12; // blocks per axis
export const SPACING = 100;
export const ROAD_HALF = 8;
export const SIDEWALK = 4;
export const CURB_Y = 0.1;
export const WATER_Y = -1.0;
export const GRAVITY = 22;

export const roadC = (i: number) => (i - 6) * SPACING;

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export const LAND: Rect = { minX: -640, maxX: 640, minZ: -640, maxZ: 640 };
export const BEACH: Rect = { minX: 640, maxX: 735, minZ: -640, maxZ: 640 };
export const PORT: Rect = { minX: -640, maxX: 300, minZ: 640, maxZ: 720 };
export const AIRPORT: Rect = { minX: -1010, maxX: -640, minZ: -330, maxZ: 330 };
export const ISLAND: Rect = { minX: 1000, maxX: 1300, minZ: -480, maxZ: -120 };
export const WORLD: Rect = { minX: -1400, maxX: 1650, minZ: -1100, maxZ: 1150 };

export const BRIDGE = {
  z: -300,
  rampStartX: 640,
  deckStartX: 745,
  deckEndX: 955,
  rampEndX: 1000,
  deckY: 5,
  halfWidth: 9,
};

export type District =
  | 'downtown'
  | 'residential'
  | 'luxury'
  | 'industrial'
  | 'nightlife'
  | 'commercial'
  | 'beachfront'
  | 'park'
  | 'lot'
  | 'parkour';

export function districtOf(bi: number, bj: number): District {
  if ((bi === 2 && bj === 5) || (bi === 8 && bj === 2)) return 'park';
  if (bi === 1 && bj === 11) return 'lot';
  if (bi === 6 && bj === 9) return 'parkour';
  if (bi === 11) return 'beachfront';
  if (bi >= 4 && bi <= 7 && bj >= 3 && bj <= 7) return 'downtown';
  if (bi >= 9 && bj <= 4) return 'luxury';
  if (bi >= 8 && bj >= 5 && bj <= 8) return 'nightlife';
  if (bi <= 4 && bj >= 9) return 'industrial';
  if (bi >= 5 && bj >= 8) return 'commercial';
  return 'residential';
}

export const DISTRICT_NAMES: Record<string, string> = {
  downtown: 'Downtown',
  residential: 'Palmetto Heights',
  luxury: 'Sapphire Hills',
  industrial: 'Rustwater',
  nightlife: 'Neon Strip',
  commercial: 'Market Row',
  beachfront: 'Ocean Drive',
  park: 'Greenway Park',
  lot: 'Rustwater Lots',
  parkour: 'Market Row',
};

export function inRect(r: Rect, x: number, z: number, pad = 0) {
  return x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
}
export function rectDist(r: Rect, x: number, z: number) {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return Math.sqrt(dx * dx + dz * dz);
}

/** inner lot bounds of a block (inside the sidewalk) */
export function blockInner(bi: number, bj: number) {
  return {
    x0: roadC(bi) + ROAD_HALF + SIDEWALK,
    x1: roadC(bi + 1) - ROAD_HALF - SIDEWALK,
    z0: roadC(bj) + ROAD_HALF + SIDEWALK,
    z1: roadC(bj + 1) - ROAD_HALF - SIDEWALK,
  };
}
export function blockCenter(bi: number, bj: number) {
  return { x: roadC(bi) + SPACING / 2, z: roadC(bj) + SPACING / 2 };
}
export function locateBlock(x: number, z: number) {
  const fx = x + 600,
    fz = z + 600;
  const bi = Math.floor(fx / SPACING),
    bj = Math.floor(fz / SPACING);
  if (bi < 0 || bj < 0 || bi >= BLOCKS || bj >= BLOCKS) return null;
  const u = fx - bi * SPACING,
    v = fz - bj * SPACING;
  return { bi, bj, u, v, onPlate: u > ROAD_HALF && u < SPACING - ROAD_HALF && v > ROAD_HALF && v < SPACING - ROAD_HALF };
}

/** Terrain height (ground without buildings). */
export function terrainY(x: number, z: number): number {
  if (inRect(LAND, x, z)) {
    const b = locateBlock(x, z);
    return b && b.onPlate ? CURB_Y : 0;
  }
  if (inRect(PORT, x, z) || inRect(AIRPORT, x, z) || inRect(ISLAND, x, z)) return 0;
  // beach slopes gently into the sea
  let best = -14;
  if (inRect(BEACH, x, z)) {
    return -((x - BEACH.minX) / (BEACH.maxX - BEACH.minX)) * 0.95;
  }
  const fall = (d: number) => d * 0.035 + d * d * 0.0004;
  best = Math.max(best, -fall(rectDist(LAND, x, z)));
  best = Math.max(best, -fall(rectDist(PORT, x, z)));
  best = Math.max(best, -fall(rectDist(AIRPORT, x, z)));
  best = Math.max(best, -fall(rectDist(ISLAND, x, z)));
  const bd = rectDist(BEACH, x, z);
  const bcx = Math.min(Math.max(x, BEACH.minX), BEACH.maxX);
  const bEdge = -((bcx - BEACH.minX) / (BEACH.maxX - BEACH.minX)) * 0.95;
  best = Math.max(best, bEdge - fall(bd) * 1.4);
  return best;
}

export function isWaterAt(x: number, z: number) {
  return terrainY(x, z) < WATER_Y;
}
