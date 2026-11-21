import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  AIRPORT,
  BLOCKS,
  BRIDGE,
  GRID_N,
  ISLAND,
  LAND,
  PORT,
  ROAD_HALF,
  SPACING,
  WATER_Y,
  WORLD,
  inRect,
  roadC,
  terrainY,
} from '../constants';
import { BoxKind, CollisionWorld } from './Collision';
import { BuildingDef, BuildingStyle, CityLayout } from './CityLayout';
import { Tex, buildingMaterial, sharedMats, wetGroundMaterial, worldUniforms } from './Materials';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

export interface InstItem {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  ry?: number;
  rx?: number;
  rz?: number;
  color?: number;
}

export function makeInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: InstItem[], cast = true, receive = true) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  mesh.count = items.length;
  let hasColor = false;
  items.forEach((it, i) => {
    _e.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0);
    _q.setFromEuler(_e);
    _p.set(it.x, it.y, it.z);
    _s.set(it.sx, it.sy, it.sz);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
    if (it.color !== undefined) {
      hasColor = true;
      mesh.setColorAt(i, _c.setHex(it.color));
    }
  });
  if (hasColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.computeBoundingSphere();
  mesh.frustumCulled = true;
  return mesh;
}

/** Split a list of items spatially into chunks so frustum culling works per chunk. */
function chunked(geo: THREE.BufferGeometry, mat: THREE.Material, items: InstItem[], group: THREE.Object3D, cast = true, receive = true, chunk = 400) {
  const buckets = new Map<string, InstItem[]>();
  for (const it of items) {
    const k = `${Math.floor(it.x / chunk)},${Math.floor(it.z / chunk)}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(it);
  }
  const meshes: THREE.InstancedMesh[] = [];
  for (const b of buckets.values()) {
    const m = makeInstanced(geo, mat, b, cast, receive);
    group.add(m);
    meshes.push(m);
  }
  return meshes;
}

export class CityBuilder {
  group = new THREE.Group();
  neonMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  signMats: THREE.MeshBasicMaterial[] = [];
  lampGlowMat: THREE.MeshBasicMaterial;
  waterMat: THREE.MeshStandardMaterial;
  groundMats: THREE.MeshStandardMaterial[] = [];
  beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false });
  bridgeLightMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, toneMapped: false });

  constructor(private layout: CityLayout, private col: CollisionWorld) {
    this.lampGlowMat = new THREE.MeshBasicMaterial({
      map: Tex.glow(),
      color: 0xffc27a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.waterMat = new THREE.MeshStandardMaterial({
      color: 0x0c4a5e,
      roughness: 0.06,
      metalness: 0.2,
      normalMap: Tex.waterNormal(),
      normalScale: new THREE.Vector2(0.35, 0.35),
      transparent: true,
      opacity: 0.9,
    });
    this.waterMat.normalMap!.repeat.set(60, 60);
    this.buildTerrain();
    this.buildGround();
    this.buildRoadMarkings();
    this.buildBuildings();
    this.buildTrees();
    this.buildContainers();
    this.buildStairs();
    this.buildBridge();
    this.buildAirport();
    this.buildPort();
    this.buildPOIDetails();
    this.buildStuntRamps();
    this.buildBillboards();
    this.buildWater();
  }

  // ---------------- terrain & water ----------------
  private buildTerrain() {
    const W = WORLD.maxX - WORLD.minX,
      D = WORLD.maxZ - WORLD.minZ;
    const seg = 10;
    const geo = new THREE.PlaneGeometry(W, D, Math.floor(W / seg), Math.floor(D / seg));
    geo.rotateX(-Math.PI / 2);
    geo.translate((WORLD.minX + WORLD.maxX) / 2, 0, (WORLD.minZ + WORLD.maxZ) / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const sand = new THREE.Color(0xe8d3a3),
      wetSand = new THREE.Color(0xb59a6c),
      seabed = new THREE.Color(0x1d4a52),
      grass = new THREE.Color(0x5d8a45),
      under = new THREE.Color(0x444444);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        z = pos.getZ(i);
      let y = terrainY(x, z);
      let c: THREE.Color;
      if (inRect(LAND, x, z) || inRect(PORT, x, z)) {
        y = -0.3;
        c = under;
      } else if (inRect(AIRPORT, x, z) || inRect(ISLAND, x, z, -6)) {
        c = grass.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.04);
        y = -0.02;
      } else if (y > WATER_Y + 0.25) {
        c = sand.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.05);
      } else if (y > WATER_Y - 1.2) {
        c = wetSand;
      } else c = seabed.clone().lerp(new THREE.Color(0x0b2630), Math.min(1, (-y - 2) / 10));
      pos.setY(i, y);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildWater() {
    const W = WORLD.maxX - WORLD.minX + 4000,
      D = WORLD.maxZ - WORLD.minZ + 4000;
    const geo = new THREE.PlaneGeometry(W, D, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.waterMat);
    mesh.position.set((WORLD.minX + WORLD.maxX) / 2, WATER_Y, (WORLD.minZ + WORLD.maxZ) / 2);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    this.group.add(mesh);
  }

  // ---------------- ground ----------------
  private buildGround() {
    const asphalt = wetGroundMaterial(Tex.asphalt(), 0xffffff, 0.92);
    asphalt.map = Tex.asphalt().clone();
    asphalt.map.repeat.set(1, 1);
    asphalt.map.needsUpdate = true;
    this.groundMats.push(asphalt);
    const plane = (r: { minX: number; maxX: number; minZ: number; maxZ: number }, mat: THREE.Material, y = 0) => {
      const w = r.maxX - r.minX,
        d = r.maxZ - r.minZ;
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 12), uv.getY(i) * (d / 12));
      const m = new THREE.Mesh(g, mat);
      m.position.set((r.minX + r.maxX) / 2, y, (r.minZ + r.maxZ) / 2);
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    plane(LAND, asphalt);
    plane(PORT, asphalt);
    // island + airport road strips
    const strips: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [
      { minX: -908, maxX: -640, minZ: -8, maxZ: 8 },
      { minX: -908, maxX: -892, minZ: -268, maxZ: 268 },
      { minX: 1000, maxX: 1058, minZ: -308, maxZ: -292 },
      { minX: 1042, maxX: 1058, minZ: -448, maxZ: -152 },
      { minX: 1242, maxX: 1258, minZ: -448, maxZ: -152 },
      { minX: 1042, maxX: 1258, minZ: -448, maxZ: -432 },
      { minX: 1042, maxX: 1258, minZ: -168, maxZ: -152 },
    ];
    for (const s of strips) plane(s, asphalt, 0.03);

    // block plates (sidewalk + curb)
    const sw = wetGroundMaterial(Tex.sidewalk(), 0xffffff, 0.9);
    sw.map = Tex.sidewalk().clone();
    sw.map.repeat.set(21, 21);
    sw.map.needsUpdate = true;
    this.groundMats.push(sw);
    const plateGeo = new THREE.BoxGeometry(SPACING - ROAD_HALF * 2, 0.1, SPACING - ROAD_HALF * 2);
    plateGeo.translate(0, 0.05, 0);
    const plates: InstItem[] = [];
    for (let bi = 0; bi < BLOCKS; bi++)
      for (let bj = 0; bj < BLOCKS; bj++) plates.push({ x: roadC(bi) + SPACING / 2, y: 0, z: roadC(bj) + SPACING / 2, sx: 1, sy: 1, sz: 1 });
    chunked(plateGeo, sw, plates, this.group, false, true);

    // overlays
    const flat = new THREE.PlaneGeometry(1, 1);
    flat.rotateX(-Math.PI / 2);
    const grassMat = new THREE.MeshStandardMaterial({ map: Tex.grass(), roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    grassMat.map!.repeat.set(6, 6);
    const lotMat = wetGroundMaterial(Tex.lot(), 0xffffff, 0.9);
    lotMat.polygonOffset = true;
    lotMat.polygonOffsetFactor = -1;
    lotMat.polygonOffsetUnits = -2;
    this.groundMats.push(lotMat);
    const poolMat = new THREE.MeshStandardMaterial({ color: 0x3fd0e8, roughness: 0.05, metalness: 0.1, emissive: 0x0a4a66, emissiveIntensity: 0.5, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    chunked(flat, lotMat, this.layout.lots.map((l) => ({ x: l.x, y: 0.112, z: l.z, sx: l.w, sy: 1, sz: l.d })), this.group, false, true);
    chunked(
      flat,
      grassMat,
      this.layout.grass.map((l) => ({ x: l.x, y: inRect(ISLAND, l.x, l.z) ? 0.01 : 0.114, z: l.z, sx: l.w, sy: 1, sz: l.d })),
      this.group,
      false,
      true,
    );
    chunked(flat, poolMat, this.layout.pools.map((l) => ({ x: l.x, y: 0.12, z: l.z, sx: l.w, sy: 1, sz: l.d })), this.group, false, true);
  }

  private buildRoadMarkings() {
    const flat = new THREE.PlaneGeometry(1, 1);
    flat.rotateX(-Math.PI / 2);
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const W: InstItem[] = [],
      Y: InstItem[] = [];
    const segLen = SPACING - 2 * (ROAD_HALF + 2);
    for (let i = 0; i < GRID_N; i++)
      for (let j = 0; j < GRID_N - 1; j++) {
        const c = roadC(i);
        const mid = roadC(j) + SPACING / 2;
        // vertical road segment (along z) at x=c
        Y.push({ x: c - 0.2, y: 0.02, z: mid, sx: 0.15, sy: 1, sz: segLen });
        Y.push({ x: c + 0.2, y: 0.02, z: mid, sx: 0.15, sy: 1, sz: segLen });
        Y.push({ z: c - 0.2, y: 0.02, x: mid, sz: 0.15, sy: 1, sx: segLen });
        Y.push({ z: c + 0.2, y: 0.02, x: mid, sz: 0.15, sy: 1, sx: segLen });
        for (let t = -segLen / 2 + 2; t < segLen / 2 - 2; t += 7) {
          W.push({ x: c - 4, y: 0.02, z: mid + t, sx: 0.15, sy: 1, sz: 3 });
          W.push({ x: c + 4, y: 0.02, z: mid + t, sx: 0.15, sy: 1, sz: 3 });
          W.push({ z: c - 4, y: 0.02, x: mid + t, sz: 0.15, sy: 1, sx: 3 });
          W.push({ z: c + 4, y: 0.02, x: mid + t, sz: 0.15, sy: 1, sx: 3 });
        }
      }
    // crosswalks + stop lines
    for (let i = 0; i < GRID_N; i++)
      for (let j = 0; j < GRID_N; j++) {
        const x = roadC(i),
          z = roadC(j);
        for (let k = -3; k <= 3; k++) {
          const o = k * 2.2;
          if (j > 0) W.push({ x: x + o, y: 0.02, z: z - ROAD_HALF - 1, sx: 1.1, sy: 1, sz: 2.4 });
          if (j < GRID_N - 1) W.push({ x: x + o, y: 0.02, z: z + ROAD_HALF + 1, sx: 1.1, sy: 1, sz: 2.4 });
          if (i > 0) W.push({ x: x - ROAD_HALF - 1, y: 0.02, z: z + o, sx: 2.4, sy: 1, sz: 1.1 });
          if (i < GRID_N - 1) W.push({ x: x + ROAD_HALF + 1, y: 0.02, z: z + o, sx: 2.4, sy: 1, sz: 1.1 });
        }
        // stop lines (right-hand lanes)
        if (j > 0) W.push({ x: x - 4, y: 0.02, z: z - ROAD_HALF - 2.7, sx: 7.6, sy: 1, sz: 0.4 });
        if (j < GRID_N - 1) W.push({ x: x + 4, y: 0.02, z: z + ROAD_HALF + 2.7, sx: 7.6, sy: 1, sz: 0.4 });
        if (i > 0) W.push({ x: x - ROAD_HALF - 2.7, y: 0.02, z: z + 4, sx: 0.4, sy: 1, sz: 7.6 });
        if (i < GRID_N - 1) W.push({ x: x + ROAD_HALF + 2.7, y: 0.02, z: z - 4, sx: 0.4, sy: 1, sz: 7.6 });
      }
    // expressway dashes
    for (let x = -890; x < -640; x += 7) W.push({ x, y: 0.05, z: 0, sx: 3, sy: 1, sz: 0.15 });
    chunked(flat, white, W, this.group, false, true, 300);
    chunked(flat, yellow, Y, this.group, false, true, 300);
  }

  // ---------------- buildings ----------------
  private styleMats: Record<BuildingStyle, THREE.MeshStandardMaterial> = {
    glass: buildingMaterial({ cellW: 2.2, cellH: 3.6, frameX: 0.05, frameY: 0.08, glass: 1, lit: 0.45, cool: 0.6 }, 0.25, 0.55),
    concrete: buildingMaterial({ cellW: 3.2, cellH: 3.6, frameX: 0.18, frameY: 0.22, glass: 0.95, lit: 0.4, cool: 0.35 }),
    pastel: buildingMaterial({ cellW: 3.4, cellH: 3.4, frameX: 0.24, frameY: 0.25, glass: 0.9, lit: 0.45, cool: 0.2 }),
    brick: buildingMaterial({ cellW: 2.8, cellH: 3.3, frameX: 0.22, frameY: 0.24, glass: 0.92, lit: 0.5, cool: 0.1, brick: true }),
    industrial: buildingMaterial({ cellW: 5.5, cellH: 5.0, frameX: 0.12, frameY: 0.3, glass: 0.8, lit: 0.25, cool: 0.7, bandOnly: true }, 0.7, 0.3),
    dark: buildingMaterial({ cellW: 2.6, cellH: 3.4, frameX: 0.2, frameY: 0.22, glass: 1, lit: 0.55, cool: 0.8 }, 0.6, 0.2),
    white: buildingMaterial({ cellW: 3.6, cellH: 3.4, frameX: 0.2, frameY: 0.24, glass: 0.9, lit: 0.4, cool: 0.3 }, 0.7),
  };

  private buildBuildings() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const byStyle: Record<string, InstItem[]> = {};
    const roofs: InstItem[] = [],
      tanks: InstItem[] = [],
      antennas: InstItem[] = [],
      beacons: InstItem[] = [],
      helipads: InstItem[] = [],
      ac: InstItem[] = [],
      neon: InstItem[] = [],
      awnings: InstItem[] = [],
      ledges: InstItem[] = [];
    const B = this.layout.buildings;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const b of B) {
      (byStyle[b.style] ??= []).push({ x: b.x, y: b.y0, z: b.z, sx: b.w, sy: b.h, sz: b.d, color: b.color });
      if (b.collide !== false) this.col.addBoxCentered(b.x, b.z, b.w, b.d, b.y0, b.h, BoxKind.Building);
      const top = b.y0 + b.h;
      if (b.roof === 'pitched') {
        const alongX = b.w > b.d;
        roofs.push({ x: b.x, y: top, z: b.z, sx: (alongX ? b.d : b.w) + 0.8, sy: Math.min(b.w, b.d) * 0.35, sz: (alongX ? b.w : b.d) + 0.8, ry: alongX ? Math.PI / 2 : 0, color: [0x9b4a3a, 0x5a5d66, 0x7a4a3a, 0x4a5560][Math.floor(rnd() * 4)] });
      } else if (b.h > 6 && b.w > 8) {
        // parapet ledge
        ledges.push({ x: b.x, y: top, z: b.z, sx: b.w + 0.4, sy: 0.6, sz: b.d + 0.4, color: b.color });
        if (b.roof === 'tank') tanks.push({ x: b.x + b.w * 0.2, y: top, z: b.z - b.d * 0.15, sx: 1, sy: 1, sz: 1 });
        if (b.roof === 'antenna') {
          const h = Math.min(30, b.h * 0.25 + 6);
          antennas.push({ x: b.x, y: top, z: b.z, sx: 1, sy: h, sz: 1 });
          beacons.push({ x: b.x, y: top + h, z: b.z, sx: 1, sy: 1, sz: 1 });
        }
        if (b.roof === 'helipad') helipads.push({ x: b.x, y: top + 0.62, z: b.z, sx: Math.min(b.w, b.d) * 0.4, sy: 1, sz: Math.min(b.w, b.d) * 0.4 });
        const n = Math.floor(rnd() * 3);
        for (let i = 0; i < n; i++) ac.push({ x: b.x + (rnd() - 0.5) * b.w * 0.6, y: top, z: b.z + (rnd() - 0.5) * b.d * 0.6, sx: 2 + rnd() * 2, sy: 1.2 + rnd(), sz: 2 + rnd() * 1.5, color: 0x9aa0a6 });
      }
      if (b.neon !== undefined) {
        const y = top - 0.8;
        const t = 0.25;
        neon.push({ x: b.x, y, z: b.z - b.d / 2 - 0.15, sx: b.w, sy: t, sz: t, color: b.neon });
        neon.push({ x: b.x, y, z: b.z + b.d / 2 + 0.15, sx: b.w, sy: t, sz: t, color: b.neon });
        neon.push({ x: b.x - b.w / 2 - 0.15, y, z: b.z, sx: t, sy: t, sz: b.d, color: b.neon });
        neon.push({ x: b.x + b.w / 2 + 0.15, y, z: b.z, sx: t, sy: t, sz: b.d, color: b.neon });
        if (b.h < 45 && b.y0 === 0) {
          // vertical corner strips
          for (const [sx, sz] of [
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
          ])
            neon.push({ x: b.x + (sx * (b.w + 0.3)) / 2, y: 1 + (b.h - 1.8) / 2, z: b.z + (sz * (b.d + 0.3)) / 2, sx: t, sy: b.h - 1.8, sz: t, color: b.neon });
        }
      }
      if (b.awning !== undefined || b.sign) this.addFacadeDetails(b, awnings);
    }
    const shadowStyles = new Set(['glass', 'concrete', 'pastel', 'brick', 'industrial', 'dark', 'white']);
    for (const style of Object.keys(byStyle) as BuildingStyle[]) chunked(box, this.styleMats[style], byStyle[style], this.group, shadowStyles.has(style), true, 300);

    // roofs
    const tri = new THREE.Shape();
    tri.moveTo(-0.5, 0);
    tri.lineTo(0.5, 0);
    tri.lineTo(0, 1);
    tri.closePath();
    const prism = new THREE.ExtrudeGeometry(tri, { depth: 1, bevelEnabled: false });
    prism.translate(0, 0, -0.5);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    chunked(prism, roofMat, roofs, this.group);
    const ledgeGeo = new THREE.BoxGeometry(1, 1, 1);
    ledgeGeo.translate(0, 0.5, 0);
    chunked(ledgeGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), ledges, this.group, false, true, 300);
    chunked(ledgeGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.4 }), ac, this.group);
    // water tanks
    const tankGeo = mergeGeometries([
      new THREE.CylinderGeometry(1.8, 1.8, 3, 12).translate(0, 3.5, 0),
      new THREE.ConeGeometry(1.9, 1, 12).translate(0, 5.5, 0),
      new THREE.BoxGeometry(0.2, 2, 0.2).translate(1.2, 1, 1.2),
      new THREE.BoxGeometry(0.2, 2, 0.2).translate(-1.2, 1, 1.2),
      new THREE.BoxGeometry(0.2, 2, 0.2).translate(1.2, 1, -1.2),
      new THREE.BoxGeometry(0.2, 2, 0.2).translate(-1.2, 1, -1.2),
    ])!;
    chunked(tankGeo, sharedMats.wood, tanks, this.group);
    const antGeo = new THREE.CylinderGeometry(0.12, 0.3, 1, 6);
    antGeo.translate(0, 0.5, 0);
    chunked(antGeo, sharedMats.metal, antennas, this.group);
    chunked(new THREE.SphereGeometry(0.5, 8, 6), this.beaconMat, beacons, this.group, false, false);
    const padGeo = mergeGeometries([new THREE.CylinderGeometry(1, 1, 0.08, 24), new THREE.TorusGeometry(0.8, 0.04, 4, 32).rotateX(Math.PI / 2).translate(0, 0.06, 0)])!;
    chunked(padGeo, new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.8, emissive: 0x806010, emissiveIntensity: 0.4 }), helipads, this.group, false, true);
    chunked(ledgeGeo.clone().translate(0, -0.5, 0), this.neonMat, neon, this.group, false, false, 300);
    const awnGeo = new THREE.BoxGeometry(1, 0.12, 1);
    chunked(awnGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), awnings, this.group);
  }

  private addFacadeDetails(b: BuildingDef, awnings: InstItem[]) {
    // facade toward nearest road
    const fx = ((b.x + 600) % SPACING + SPACING) % SPACING;
    const fz = ((b.z + 600) % SPACING + SPACING) % SPACING;
    const dxEdge = Math.min(fx, SPACING - fx),
      dzEdge = Math.min(fz, SPACING - fz);
    let nx = 0,
      nz = 0;
    if (dzEdge <= dxEdge) nz = fz < SPACING / 2 ? -1 : 1;
    else nx = fx < SPACING / 2 ? -1 : 1;
    // special-case non-grid buildings
    if (!inRect(LAND, b.x, b.z)) {
      nx = b.x < -640 ? 1 : 0;
      nz = b.x < -640 ? 0 : 1;
    }
    const faceW = nz !== 0 ? b.w : b.d;
    const yaw = Math.atan2(nx, nz);
    if (b.awning !== undefined) {
      awnings.push({
        x: b.x + nx * ((b.w / 2) + 0.9),
        y: 3.2,
        z: b.z + nz * ((b.d / 2) + 0.9),
        sx: nz !== 0 ? faceW * 0.9 : 1.8,
        sy: 1,
        sz: nz !== 0 ? 1.8 : faceW * 0.9,
        rx: nz !== 0 ? -0.25 * nz : 0,
        rz: nx !== 0 ? 0.25 * nx : 0,
        color: b.awning,
      });
    }
    if (b.sign) {
      const sw = Math.min(faceW * 0.8, 14);
      const sh = sw / 4;
      const mat = new THREE.MeshBasicMaterial({ map: Tex.sign(b.sign, b.neon ?? 0xffd27a), toneMapped: false });
      this.signMats.push(mat);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), mat);
      const y = Math.min(b.y0 + b.h - sh / 2 - 0.6, Math.max(4.2 + sh / 2, b.y0 + b.h * 0.6));
      m.position.set(b.x + nx * (b.w / 2 + 0.08), y, b.z + nz * (b.d / 2 + 0.08));
      m.rotation.y = yaw;
      this.group.add(m);
    }
  }

  // ---------------- trees ----------------
  private buildTrees() {
    const trunk: InstItem[] = [],
      crown: InstItem[] = [],
      palmTrunk: InstItem[] = [],
      fronds: InstItem[] = [];
    for (const t of this.layout.trees) {
      const gy = terrainY(t.x, t.z);
      if (gy < WATER_Y + 0.3) continue;
      if (t.palm) {
        const h = 6.5 * t.s;
        palmTrunk.push({ x: t.x, y: gy, z: t.z, sx: t.s, sy: h, sz: t.s, rz: (Math.sin(t.x * 3.1) * 0.12) });
        fronds.push({ x: t.x + Math.sin(t.x * 3.1) * -0.12 * h * 0.5, y: gy + h - 0.2, z: t.z, sx: t.s, sy: t.s, sz: t.s, ry: t.x * 1.7 });
      } else {
        trunk.push({ x: t.x, y: gy, z: t.z, sx: t.s, sy: t.s * 3, sz: t.s });
        crown.push({ x: t.x, y: gy + t.s * 3 + 1.2 * t.s, z: t.z, sx: t.s * 2.2, sy: t.s * 2.0, sz: t.s * 2.2, ry: t.z, color: [0x4f7a3a, 0x5d8040, 0x466e33, 0x6b8a45][Math.abs(Math.floor(t.x * 7 + t.z)) % 4] });
      }
      this.col.addBoxCentered(t.x, t.z, 0.6, 0.6, gy, 5, BoxKind.Tree);
    }
    const bark = new THREE.MeshStandardMaterial({ color: 0x5a4434, roughness: 1, map: Tex.bark() });
    // trunk with a few forking branches (unit height, scaled per tree)
    const tparts = [new THREE.CylinderGeometry(0.13, 0.24, 1, 8).translate(0, 0.5, 0)];
    for (let k = 0; k < 3; k++) {
      const br = new THREE.CylinderGeometry(0.04, 0.08, 0.7, 5).translate(0, 0.35, 0).rotateZ(0.7).rotateY((k / 3) * Math.PI * 2 + 0.4).translate(0, 0.75 + k * 0.08, 0);
      tparts.push(br);
    }
    const tg = mergeGeometries(tparts.map((g) => g.toNonIndexed()))!;
    chunked(tg, bark, trunk, this.group);
    // leafy crown: several overlapping noisy lumps, darker underneath
    const lumps: THREE.BufferGeometry[] = [];
    const lumpAt: [number, number, number, number][] = [
      [0, 0.1, 0, 0.78],
      [0.45, -0.1, 0.2, 0.55],
      [-0.4, -0.05, -0.25, 0.58],
      [0.1, 0.45, -0.1, 0.5],
      [-0.2, -0.25, 0.42, 0.5],
      [0.25, -0.3, -0.45, 0.45],
    ];
    for (const [x, y, z, r] of lumpAt) {
      const g = new THREE.IcosahedronGeometry(r, 3);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i),
          vy = pos.getY(i),
          vz = pos.getZ(i);
        const n = 1 + 0.16 * Math.sin(vx * 9.1 + vz * 4.3) * Math.cos(vy * 8.7 - vx * 3.1) + 0.08 * Math.sin(vz * 17 + vy * 13);
        pos.setXYZ(i, vx * n + x, vy * n + y, vz * n + z);
      }
      lumps.push(g.toNonIndexed());
    }
    const cg = mergeGeometries(lumps)!;
    cg.computeVertexNormals();
    {
      const pos = cg.attributes.position;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const k = 0.55 + 0.45 * THREE.MathUtils.smoothstep(pos.getY(i), -0.8, 0.9);
        col.set([k, k, k], i * 3);
      }
      cg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, map: Tex.foliage(), vertexColors: true });
    chunked(cg, leafMat, crown, this.group);
    const ptg = new THREE.CylinderGeometry(0.13, 0.24, 1, 6);
    ptg.translate(0, 0.5, 0);
    chunked(ptg, new THREE.MeshStandardMaterial({ color: 0x8a7354, roughness: 1 }), palmTrunk, this.group);
    const leaves: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 8; k++) {
      const leaf = new THREE.ConeGeometry(0.45, 3.4, 4, 1);
      leaf.scale(1, 1, 0.18);
      leaf.translate(0, 1.7, 0);
      leaf.rotateX(1.25 + (k % 2) * 0.25);
      leaf.rotateY((k / 8) * Math.PI * 2);
      leaves.push(leaf);
    }
    const frondGeo = mergeGeometries(leaves.map((g) => g.toNonIndexed()))!;
    frondGeo.computeVertexNormals();
    chunked(frondGeo, new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 0.9, side: THREE.DoubleSide, flatShading: true }), fronds, this.group);
  }

  private buildContainers() {
    const items: InstItem[] = [];
    for (const c of this.layout.containers) {
      const alongX = Math.abs(Math.sin(c.yaw)) > 0.5;
      const w = alongX ? 2.5 : 6.1,
        d = alongX ? 6.1 : 2.5;
      items.push({ x: c.x, y: c.y, z: c.z, sx: 2.5, sy: 2.6, sz: 6.1, ry: c.yaw, color: c.color });
      this.col.addBoxCentered(c.x, c.z, alongX ? 6.1 : 2.5, alongX ? 2.5 : 6.1, c.y, 2.6, BoxKind.Building);
      void w;
      void d;
    }
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    const tex = Tex.corrugated();
    const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.7, metalness: 0.3 });
    chunked(g, mat, items, this.group);
  }

  private buildStairs() {
    const steps: InstItem[] = [];
    for (const s of this.layout.stairs) {
      this.col.addRamp(s.x, s.z, s.yaw, s.len, 1.6, 0, s.h);
      const n = Math.ceil(s.h / 0.4);
      const fx = Math.sin(s.yaw),
        fz = Math.cos(s.yaw);
      for (let k = 0; k < n; k++) {
        const u = -s.len / 2 + ((k + 0.5) / n) * s.len;
        const h = ((k + 1) / n) * s.h;
        steps.push({ x: s.x + fx * u, y: h - 0.35, z: s.z + fz * u, sx: 1.6, sy: 0.35, sz: s.len / n + 0.02, ry: s.yaw });
      }
      // landing at the top
      steps.push({ x: s.x + (fx * s.len) / 2, y: s.h - 0.3, z: s.z + (fz * s.len) / 2, sx: 1.6, sy: 0.3, sz: 1.6, ry: s.yaw });
    }
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    chunked(g, new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.6, metalness: 0.6 }), steps, this.group);
  }

  // ---------------- bridge ----------------
  private buildBridge() {
    const { z, rampStartX, deckStartX, deckEndX, rampEndX, deckY, halfWidth } = BRIDGE;
    const W = halfWidth * 2;
    const concrete = new THREE.MeshStandardMaterial({ color: 0x9c9a95, roughness: 0.85 });
    const asphalt = this.groundMats[0];
    // ramps (wedges)
    const wedge = (x0: number, x1: number, h0: number, h1: number) => {
      const shape = new THREE.Shape();
      shape.moveTo(x0, -2.5);
      shape.lineTo(x1, -2.5);
      shape.lineTo(x1, h1);
      shape.lineTo(x0, h0);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false });
      g.translate(0, 0, -halfWidth);
      // map XY-shape to world: shape x -> world x, shape y -> y, extrude -> z
      const m = new THREE.Mesh(g, concrete);
      m.position.z = z;
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      const len = Math.abs(x1 - x0);
      this.col.addRamp((x0 + x1) / 2, z, Math.PI / 2, len, W, h0, h1);
      // asphalt top
      const top = new THREE.PlaneGeometry(len, W - 2);
      top.rotateX(-Math.PI / 2);
      const tm = new THREE.Mesh(top, asphalt);
      tm.position.set((x0 + x1) / 2, (h0 + h1) / 2 + 0.04, z);
      tm.rotation.z = Math.atan2(h1 - h0, x1 - x0);
      tm.receiveShadow = true;
      this.group.add(tm);
    };
    wedge(rampStartX, deckStartX, 0.0, deckY);
    wedge(deckEndX, rampEndX, deckY, 0.0);
    // deck
    const deckLen = deckEndX - deckStartX;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(deckLen, 1, W), concrete);
    deck.position.set((deckStartX + deckEndX) / 2, deckY - 0.5, z);
    deck.castShadow = deck.receiveShadow = true;
    this.group.add(deck);
    const dtop = new THREE.Mesh(new THREE.PlaneGeometry(deckLen, W - 2).rotateX(-Math.PI / 2), asphalt);
    dtop.position.set((deckStartX + deckEndX) / 2, deckY + 0.02, z);
    this.group.add(dtop);
    this.col.addBox(deckStartX, deckY - 1, z - halfWidth, deckEndX, deckY, z + halfWidth, BoxKind.Surface);
    // rails
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(deckLen, 1.1, 0.4), concrete);
      rail.position.set((deckStartX + deckEndX) / 2, deckY + 0.55, z + s * (halfWidth - 0.2));
      this.group.add(rail);
      this.col.addBox(deckStartX, deckY, z + s * (halfWidth - 0.2) - 0.2, deckEndX, deckY + 1.1, z + s * (halfWidth - 0.2) + 0.2, BoxKind.Rail);
    }
    // pillars
    for (let x = deckStartX + 20; x < deckEndX; x += 45) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(3, deckY + 14, 12), concrete);
      p.position.set(x, (deckY - 1 - 14) / 2, z);
      this.group.add(p);
      this.col.addBox(x - 1.5, -15, z - 6, x + 1.5, deckY - 1, z + 6, BoxKind.Building);
    }
    // pylons & cables
    const cableVerts: number[] = [];
    for (const px of [800, 900]) {
      for (const s of [-1, 1]) {
        const py = new THREE.Mesh(new THREE.BoxGeometry(2, 34, 2), concrete);
        py.position.set(px, deckY + 17, z + s * (halfWidth + 1));
        py.castShadow = true;
        this.group.add(py);
        this.col.addBoxCentered(px, z + s * (halfWidth + 1), 2, 2, deckY, 34, BoxKind.Building);
        for (let k = 1; k <= 6; k++) {
          for (const dir of [-1, 1]) {
            cableVerts.push(px, deckY + 33, z + s * (halfWidth + 0.5));
            cableVerts.push(px + dir * k * 8, deckY + 1, z + s * (halfWidth - 0.3));
          }
        }
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(2, 2, W + 4), concrete);
      beam.position.set(px, deckY + 33, z);
      this.group.add(beam);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cableVerts, 3));
    this.group.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0xdddddd })));
    // bridge lights
    const lights: InstItem[] = [];
    for (let x = deckStartX; x <= deckEndX; x += 15) for (const s of [-1, 1]) lights.push({ x, y: deckY + 1.2, z: z + s * (halfWidth - 0.2), sx: 0.5, sy: 0.25, sz: 0.5 });
    chunked(new THREE.SphereGeometry(1, 8, 6), this.bridgeLightMat, lights, this.group, false, false);
    // beach road slab to the bridge
  }

  // ---------------- airport ----------------
  private buildAirport() {
    const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const runway = new THREE.Mesh(flat, this.groundMats[0]);
    runway.scale.set(46, 1, 620);
    runway.position.set(-830, 0.02, 0);
    runway.receiveShadow = true;
    this.group.add(runway);
    const apron = new THREE.Mesh(flat, this.groundMats[0]);
    apron.scale.set(60, 1, 240);
    apron.position.set(-785, 0.025, -110);
    apron.receiveShadow = true;
    this.group.add(apron);
    const marks: InstItem[] = [];
    for (let z = -290; z < 290; z += 30) marks.push({ x: -830, y: 0.04, z, sx: 1, sy: 1, sz: 14 });
    for (let k = -4; k <= 4; k++) {
      marks.push({ x: -830 + k * 4, y: 0.04, z: -295, sx: 1.6, sy: 1, sz: 10 });
      marks.push({ x: -830 + k * 4, y: 0.04, z: 295, sx: 1.6, sy: 1, sz: 10 });
    }
    chunked(flat, new THREE.MeshStandardMaterial({ color: 0xf0f0f0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), marks, this.group, false, true);
    // planes
    const fuselage = new THREE.CylinderGeometry(2, 2, 32, 12).rotateZ(Math.PI / 2);
    const nose = new THREE.SphereGeometry(2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-Math.PI / 2).translate(16, 0, 0);
    const wing = new THREE.BoxGeometry(6, 0.35, 30).translate(1, -0.6, 0);
    const tailF = new THREE.BoxGeometry(4, 6, 0.35).translate(-14, 3.5, 0);
    const tailW = new THREE.BoxGeometry(3, 0.3, 10).translate(-14.5, 1, 0);
    const engine = new THREE.CylinderGeometry(0.9, 0.9, 3.5, 10).rotateZ(Math.PI / 2);
    const planeGeo = mergeGeometries([fuselage, nose, wing, tailF, tailW, engine.clone().translate(2, -1.6, 7), engine.clone().translate(2, -1.6, -7)].map((g) => (g.index ? g.toNonIndexed() : g)))!;
    const planeMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.4, metalness: 0.3 });
    for (const [x, z, yaw] of [
      [-785, -170, Math.PI],
      [-785, -80, Math.PI],
      [-830, 230, Math.PI / 2],
    ]) {
      const m = new THREE.Mesh(planeGeo, planeMat);
      m.position.set(x, 3.2, z);
      m.rotation.y = yaw;
      m.castShadow = true;
      this.group.add(m);
      const along = Math.abs(Math.cos(yaw)) > 0.5;
      this.col.addBoxCentered(x, z, along ? 34 : 4.4, along ? 4.4 : 34, 1.2, 4.2, BoxKind.Building);
    }
  }

  private buildPort() {
    const orange = new THREE.MeshStandardMaterial({ color: 0xd8642a, roughness: 0.6, metalness: 0.4 });
    for (const x of [-180, -40, 100]) {
      const g = new THREE.Group();
      for (const [dx, dz] of [
        [-8, 0],
        [8, 0],
        [-8, 14],
        [8, 14],
      ]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(1.4, 32, 1.4), orange);
        leg.position.set(x + dx, 16, 706 + dz);
        leg.castShadow = true;
        g.add(leg);
        this.col.addBoxCentered(x + dx, 706 + dz, 1.4, 1.4, 0, 32, BoxKind.Building);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(18, 2.5, 3), orange);
      beam.position.set(x, 32, 713);
      const boom = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 90), orange);
      boom.position.set(x, 33, 740);
      boom.castShadow = true;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4), sharedMats.white);
      cab.position.set(x, 30, 726);
      g.add(beam, boom, cab);
      this.group.add(g);
    }
    // bollards & dock edge
    const edge = new THREE.Mesh(new THREE.BoxGeometry(PORT.maxX - PORT.minX, 0.5, 1), new THREE.MeshStandardMaterial({ color: 0xd4b13a, roughness: 0.7 }));
    edge.position.set((PORT.minX + PORT.maxX) / 2, 0.25, PORT.maxZ - 0.5);
    this.group.add(edge);
  }

  private buildPOIDetails() {
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.5, emissive: 0x39ff88, emissiveIntensity: 0.15 });
    for (const p of this.layout.pois) {
      if (p.type === 'gas') {
        const c = new THREE.Mesh(new THREE.BoxGeometry(18, 0.7, 11), canopyMat);
        c.position.set(p.ex, 5.3, p.ez);
        c.castShadow = true;
        this.group.add(c);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(18.1, 0.25, 11.1), this.neonMat);
        stripe.position.set(p.ex, 5.0, p.ez);
        this.group.add(stripe);
        for (const [dx, dz] of [
          [-7, -4],
          [7, -4],
          [-7, 4],
          [7, 4],
        ]) {
          const pil = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 0.5), sharedMats.white);
          pil.position.set(p.ex + dx, 2.5, p.ez + dz);
          this.group.add(pil);
          this.col.addBoxCentered(p.ex + dx, p.ez + dz, 0.5, 0.5, 0, 5, BoxKind.Prop);
        }
        for (const dx of [-3, 3]) {
          const pump = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.7, 0.6), new THREE.MeshStandardMaterial({ color: 0x2a9a5a, roughness: 0.5 }));
          pump.position.set(p.ex + dx, 0.95, p.ez);
          pump.castShadow = true;
          this.group.add(pump);
          this.col.addBoxCentered(p.ex + dx, p.ez, 0.9, 0.6, 0.1, 1.7, BoxKind.Prop);
        }
      }
      if (p.type === 'police' || p.type === 'hospital') {
        const sign = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.3), this.neonMat);
        sign.position.set(p.ex, 3, p.ez + (p.yaw === 0 ? -0.6 : 0.6));
        this.group.add(sign);
      }
    }
  }

  private buildStuntRamps() {
    const shape = new THREE.Shape();
    shape.moveTo(-7, 0);
    shape.lineTo(7, 0);
    shape.lineTo(7, 3.2);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 6, bevelEnabled: false });
    g.translate(0, 0, -3);
    g.rotateY(-Math.PI / 2); // shape x -> world z (forward)
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    for (let i = -4; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#111' : '#f2c230';
      ctx.beginPath();
      ctx.moveTo(i * 24, 0);
      ctx.lineTo(i * 24 + 24, 0);
      ctx.lineTo(i * 24 + 24 + 128, 128);
      ctx.lineTo(i * 24 + 128, 128);
      ctx.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 });
    for (const s of this.layout.stunts) {
      const gy = Math.max(terrainY(s.x - Math.sin(s.yaw) * 7, s.z - Math.cos(s.yaw) * 7), WATER_Y + 0.2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(s.x, gy, s.z);
      m.rotation.y = s.yaw;
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      this.col.addRamp(s.x, s.z, s.yaw, 14, 6, gy, gy + 3.2, true);
    }
  }

  private buildBillboards() {
    for (const b of this.layout.billboards) {
      const mat = new THREE.MeshBasicMaterial({ map: Tex.billboard(b.text, b.color), toneMapped: false });
      this.signMats.push(mat);
      const g = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), mat);
      panel.position.y = b.h / 2 + 2;
      const back = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.4, b.h + 0.4, 0.3), sharedMats.dark);
      back.position.set(0, b.h / 2 + 2, -0.2);
      const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.2, 0.3), sharedMats.metal);
      leg1.position.set(-b.w / 3, 1.1, -0.2);
      const leg2 = leg1.clone();
      leg2.position.x = b.w / 3;
      g.add(panel, back, leg1, leg2);
      g.position.set(b.x, b.y, b.z);
      g.rotation.y = b.yaw;
      this.group.add(g);
    }
  }

  /** Per-frame: animate water + night intensities. */
  update(dt: number, night: number) {
    const n = this.waterMat.normalMap!;
    n.offset.x += dt * 0.004;
    n.offset.y += dt * 0.0025;
    this.neonMat.color.setScalar(0.55 + night * 2.2);
    const s = 0.75 + night * 1.6;
    for (const m of this.signMats) m.color.setScalar(s);
    this.beaconMat.color.setRGB(0.4 + 2 * night * (Math.sin(worldUniforms.uTime.value * 3) > 0 ? 1 : 0.2), 0.05, 0.05);
    this.bridgeLightMat.color.setScalar(0.4 + night * 2.5);
  }
}
