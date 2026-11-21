import { AIRPORT, BEACH, BLOCKS, BRIDGE, ISLAND, LAND, PORT, ROAD_HALF, SPACING, WORLD, districtOf, roadC } from '../game/constants';
import type { CityLayout } from '../game/world/CityLayout';

export const MAP_SCALE = 0.6; // px per metre
let cached: HTMLCanvasElement | null = null;

export const worldToMap = (x: number, z: number) => ({ x: (x - WORLD.minX) * MAP_SCALE, y: (z - WORLD.minZ) * MAP_SCALE });
export const mapToWorld = (x: number, y: number) => ({ x: x / MAP_SCALE + WORLD.minX, z: y / MAP_SCALE + WORLD.minZ });

const DISTRICT_TINT: Record<string, string> = {
  downtown: '#2b2f45',
  residential: '#2c3a33',
  luxury: '#3a3346',
  industrial: '#3a352c',
  nightlife: '#3a2840',
  commercial: '#33323d',
  beachfront: '#45382f',
  park: '#2c4a2c',
  lot: '#33302a',
  parkour: '#33323d',
};

/** Render the whole city into an offscreen canvas once (used by minimap and full map). */
export function getMapImage(layout: CityLayout) {
  if (cached) return cached;
  const W = (WORLD.maxX - WORLD.minX) * MAP_SCALE,
    H = (WORLD.maxZ - WORLD.minZ) * MAP_SCALE;
  const c = document.createElement('canvas');
  c.width = Math.ceil(W);
  c.height = Math.ceil(H);
  const ctx = c.getContext('2d')!;
  // sea
  const sea = ctx.createLinearGradient(0, 0, W, H);
  sea.addColorStop(0, '#08243a');
  sea.addColorStop(1, '#0a3046');
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, W, H);
  const rect = (r: { minX: number; maxX: number; minZ: number; maxZ: number }, col: string, pad = 0) => {
    const a = worldToMap(r.minX - pad, r.minZ - pad),
      b = worldToMap(r.maxX + pad, r.maxZ + pad);
    ctx.fillStyle = col;
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
  };
  // shallow water glow
  ctx.save();
  ctx.filter = 'blur(14px)';
  for (const r of [LAND, PORT, AIRPORT, ISLAND, BEACH]) rect(r, '#14506a', 18);
  ctx.restore();
  rect(BEACH, '#c9b27c');
  rect(LAND, '#1f2128');
  rect(PORT, '#26262c');
  rect(AIRPORT, '#2f4a2c');
  rect(ISLAND, '#3c6a38');
  // blocks
  for (let bi = 0; bi < BLOCKS; bi++)
    for (let bj = 0; bj < BLOCKS; bj++) {
      const x0 = roadC(bi) + ROAD_HALF,
        z0 = roadC(bj) + ROAD_HALF;
      rect({ minX: x0, maxX: x0 + SPACING - ROAD_HALF * 2, minZ: z0, maxZ: z0 + SPACING - ROAD_HALF * 2 }, DISTRICT_TINT[districtOf(bi, bj)] ?? '#333');
    }
  for (const g of layout.grass) rect({ minX: g.x - g.w / 2, maxX: g.x + g.w / 2, minZ: g.z - g.d / 2, maxZ: g.z + g.d / 2 }, '#2f5a30');
  // buildings
  for (const b of layout.buildings) {
    if (b.y0 > 0.5) continue;
    const t = Math.min(1, b.h / 120);
    const l = Math.round(70 + t * 70);
    rect({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2 }, `rgb(${l},${l},${l + 12})`);
  }
  // roads
  ctx.strokeStyle = '#5d6070';
  ctx.lineCap = 'square';
  ctx.lineWidth = ROAD_HALF * 2 * MAP_SCALE;
  const line = (x0: number, z0: number, x1: number, z1: number) => {
    const a = worldToMap(x0, z0),
      b = worldToMap(x1, z1);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  for (let i = 0; i <= BLOCKS; i++) {
    line(roadC(i), roadC(0), roadC(i), roadC(BLOCKS));
    line(roadC(0), roadC(i), roadC(BLOCKS), roadC(i));
  }
  for (const n of layout.nodes) for (const l of n.links) if (l > n.id && (n.gi < 0 || layout.nodes[l].gi < 0)) line(n.x, n.z, layout.nodes[l].x, layout.nodes[l].z);
  // highway accent
  ctx.strokeStyle = '#8a7a40';
  ctx.lineWidth = 3;
  line(roadC(0), 0, roadC(BLOCKS), 0);
  line(-900, 0, roadC(0), 0);
  ctx.strokeStyle = '#a09060';
  ctx.lineWidth = ROAD_HALF * 2 * MAP_SCALE;
  line(BRIDGE.rampStartX, BRIDGE.z, BRIDGE.rampEndX, BRIDGE.z);
  // runway
  ctx.fillStyle = '#3a3d44';
  const ra = worldToMap(-853, -310),
    rb = worldToMap(-807, 310);
  ctx.fillRect(ra.x, ra.y, rb.x - ra.x, rb.y - ra.y);
  // labels
  ctx.font = 'bold 15px Rajdhani, Arial';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.textAlign = 'center';
  const label = (t: string, x: number, z: number) => {
    const p = worldToMap(x, z);
    ctx.fillText(t, p.x, p.y);
  };
  label('DOWNTOWN', 50, 0);
  label('SAPPHIRE HILLS', 450, -470);
  label('NEON STRIP', 450, 150);
  label('PALMETTO HEIGHTS', -350, -400);
  label('RUSTWATER', -350, 480);
  label('MARKET ROW', 250, 470);
  label('OCEAN DRIVE', 690, 0);
  label('NEON BAY INTL', -830, -350);
  label('PORT', -150, 700);
  label('CORAL KEY', 1150, -500);
  return (cached = c);
}
