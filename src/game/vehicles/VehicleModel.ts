import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { VehicleSpec } from './VehicleSpecs';
import { Surface, buildCarBody, buildWheel } from './CarBody';

export interface WheelRig {
  pivot: THREE.Group; // steering
  mesh: THREE.Mesh; // spinning
  front: boolean;
  x: number;
  z: number;
}

export interface VehicleRig {
  group: THREE.Group;
  body: THREE.Group;
  wheels: WheelRig[];
  tailMat: THREE.MeshBasicMaterial;
  headMat: THREE.MeshBasicMaterial;
  sirenR?: THREE.MeshBasicMaterial;
  sirenB?: THREE.MeshBasicMaterial;
  paint: THREE.MeshPhysicalMaterial;
  seat: THREE.Vector3;
  driverDummy: THREE.Group;
  glass?: THREE.Mesh;
  /** crazy-car extras */
  flames: THREE.Mesh[];
  extras?: THREE.Group;
  hoverPads?: THREE.MeshBasicMaterial;
  /** aircraft propeller */
  prop?: THREE.Object3D;
}

function colorize(g: THREE.BufferGeometry, c: number) {
  const geo = g.index ? g.toNonIndexed() : g;
  const col = new THREE.Color(c);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = col.r;
    arr[i * 3 + 1] = col.g;
    arr[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo;
}

/** Side-profile extrusion: shape in (x=length, y=height), extruded across width, rotated so length -> +Z. */
function profile(points: [number, number][], width: number, bevel = 0.05, round = 0) {
  const sh = new THREE.Shape();
  if (round <= 0) {
    sh.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) sh.lineTo(points[i][0], points[i][1]);
  } else {
    // round every corner with a curve so the silhouette flows like real bodywork
    const n = points.length;
    const at = (i: number) => points[(i + n) % n];
    const cut = (a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const r = Math.min(round, len * 0.45);
      return [a[0] + (dx / len) * r, a[1] + (dy / len) * r] as [number, number];
    };
    const start = cut(at(0), at(1));
    sh.moveTo(start[0], start[1]);
    for (let i = 1; i <= n; i++) {
      const p = at(i);
      const inP = cut(p, at(i - 1));
      const outP = cut(p, at(i + 1));
      sh.lineTo(inP[0], inP[1]);
      sh.quadraticCurveTo(p[0], p[1], outP[0], outP[1]);
    }
  }
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: round > 0 ? 4 : 2, curveSegments: round > 0 ? 6 : 4 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

interface Built {
  body: THREE.BufferGeometry;
  glass: THREE.BufferGeometry | null;
  head: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
  wheel: THREE.BufferGeometry;
  rim?: number;
  trim?: THREE.BufferGeometry;
  chrome?: THREE.BufferGeometry;
  lens?: THREE.BufferGeometry;
  plate?: THREE.BufferGeometry;
  surf?: Surface;
}
const cache = new Map<string, Built>();

/** Materials that get the sky/city reflection map with their own strength (see setVehicleEnv). */
const reflective: { m: THREE.MeshStandardMaterial; k: number }[] = [];
let curEnv: THREE.Texture | null = null;
let curEnvK = 1;
function reflect<T extends THREE.MeshStandardMaterial>(m: T, k: number) {
  reflective.push({ m, k });
  if (curEnv) {
    m.envMap = curEnv;
    m.envMapIntensity = k * curEnvK;
  }
  return m;
}
/** Called by the environment whenever it re-renders the reflection probe. */
export function setVehicleEnv(tex: THREE.Texture, strength: number) {
  curEnv = tex;
  curEnvK = strength;
  for (const r of reflective) {
    r.m.envMap = tex;
    r.m.envMapIntensity = r.k * strength;
  }
}

const glassMat = reflect(new THREE.MeshPhysicalMaterial({ color: 0x0c1319, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.78, clearcoat: 1, clearcoatRoughness: 0.02 }), 2.2);
const tyreMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92, metalness: 0.0, name: 'wheel' });
const discMat = new THREE.MeshStandardMaterial({ color: 0x3c3d40, roughness: 0.55, metalness: 0.7, name: 'wheel' });
const rimCache = new Map<number, THREE.MeshStandardMaterial>();
function rimMat(c: number) {
  let m = rimCache.get(c);
  if (!m) rimCache.set(c, (m = reflect(new THREE.MeshStandardMaterial({ color: c, roughness: 0.22, metalness: 1, name: 'wheel' }), 1.4)));
  return m;
}
const trimMat = new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.55, metalness: 0.15 });
const brightMat = reflect(new THREE.MeshStandardMaterial({ color: 0xe8ecf0, roughness: 0.08, metalness: 1 }), 1.6);
const lensMat = reflect(new THREE.MeshPhysicalMaterial({ color: 0x1a1c20, roughness: 0.05, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.02 }), 1.8);
const paintCache = new Map<number, THREE.MeshPhysicalMaterial>();
export function paintMaterial(color: number) {
  let m = paintCache.get(color);
  if (!m) {
    // metallic flake base under a glossy clear coat
    m = reflect(new THREE.MeshPhysicalMaterial({ color, vertexColors: true, roughness: 0.38, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.04 }), 1.25);
    paintCache.set(color, m);
  }
  return m;
}

const PLATES = ['NB 4271', 'KRT 808', 'BAY 316', '7NXR 21', 'NEO 552', 'PLM 090', 'GTA 117', 'VCE 643'];
const plateMats: THREE.MeshStandardMaterial[] = [];
function plateMaterial() {
  if (!plateMats.length)
    for (const txt of PLATES) {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 56;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#f4f4ef';
      ctx.fillRect(0, 0, 256, 56);
      ctx.fillStyle = '#1d4fbf';
      ctx.fillRect(0, 0, 22, 56);
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, 253, 53);
      ctx.fillStyle = '#141414';
      ctx.font = 'bold 40px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, 140, 30);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      plateMats.push(new THREE.MeshStandardMaterial({ map: t, roughness: 0.4, metalness: 0.1 }));
    }
  return plateMats[Math.floor(Math.random() * plateMats.length)];
}
export const burntMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1816, vertexColors: true, roughness: 1, metalness: 0.1 });

const DARK = 0x16171a;
const CHROME = 0x9aa0a8;

function wheelGeo(r: number, w: number, knobby = false, _rimColor = CHROME, sporty = false) {
  return buildWheel(r, w, knobby ? 'offroad' : sporty ? 'multi' : 'alloy');
}

let glowTex: THREE.Texture | null = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

const flameOuter = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.9, 0.15), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const flameInner = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 1.6), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
/** Flame pointing backwards (-Z) with its base at the origin; scale.z stretches it. */
function makeFlame(r: number, len: number) {
  const outer = new THREE.Mesh(new THREE.ConeGeometry(r, len, 10, 1, true).translate(0, -len / 2, 0).rotateX(Math.PI / 2), flameOuter);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(r * 0.5, len * 0.6, 8, 1, true).translate(0, -len * 0.3, 0).rotateX(Math.PI / 2), flameInner);
  outer.add(inner);
  outer.visible = false;
  return outer;
}

const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd8dde4, roughness: 0.15, metalness: 1 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.6, metalness: 0.4 });

/** Bodywork and toys for the crazy cars. */
function buildCrazyExtras(spec: VehicleSpec, rig: { body: THREE.Group; group: THREE.Group; wheels: WheelRig[]; paint: THREE.Material }) {
  const sh = spec.shape;
  const L = spec.len,
    W = spec.wid,
    h = L / 2;
  const ex = new THREE.Group();
  rig.body.add(ex);
  const flames: THREE.Mesh[] = [];
  let hoverPads: THREE.MeshBasicMaterial | undefined;
  const box = (w: number, hh: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m);
    b.position.set(x, y, z);
    b.castShadow = true;
    ex.add(b);
    return b;
  };
  const cyl = (r: number, len: number, x: number, y: number, z: number, m: THREE.Material, rotX = 0, rotZ = 0) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), m);
    c.position.set(x, y, z);
    c.rotation.set(rotX, 0, rotZ);
    ex.add(c);
    return c;
  };
  // underglow: a glowing decal on the ground under the car
  if (spec.underglow) {
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 1.5, L * 1.15).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(spec.underglow).multiplyScalar(2.2), map: glowTexture(), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    glow.position.y = 0.06;
    glow.renderOrder = 2;
    rig.group.add(glow);
  }
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 1.2), toneMapped: false });
  switch (spec.crazy) {
    case 'monster': {
      // frame, suspension, light bar, exhaust stacks
      box(W * 0.45, 0.35, L * 0.85, 0, sh.wheelR, 0, darkMat);
      box(sh.track * 2 + 0.2, 0.18, 0.25, 0, sh.wheelR, sh.wheelX, darkMat);
      box(sh.track * 2 + 0.2, 0.18, 0.25, 0, sh.wheelR, -sh.wheelX, darkMat);
      for (const sx of [1, -1])
        for (const sz of [1, -1]) cyl(0.09, 1.0, sx * sh.track * 0.62, (sh.wheelR + sh.gc) / 2 + 0.15, sz * sh.wheelX, chromeMat, 0, sx * 0.55).castShadow = true;
      box(W * 0.9, 0.08, 0.08, 0, sh.roofH + 0.1, sh.roofFront - 0.05, darkMat);
      for (let i = 0; i < 5; i++) box(0.22, 0.14, 0.12, (i - 2) * 0.34, sh.roofH + 0.2, sh.roofFront - 0.05, lamp);
      for (const sx of [1, -1]) {
        cyl(0.08, 1.4, sx * (W / 2 - 0.25), sh.roofH + 0.1, sh.cabRear - 0.25, chromeMat);
        const f = makeFlame(0.12, 1.2);
        f.rotation.x = -Math.PI / 2; // shoots straight up
        f.position.set(sx * (W / 2 - 0.25), sh.roofH + 0.8, sh.cabRear - 0.25);
        ex.add(f);
        flames.push(f);
      }
      break;
    }
    case 'rocket': {
      cyl(0.42, 1.0, 0, sh.tail - 0.1, -h - 0.25, darkMat, Math.PI / 2);
      cyl(0.32, 0.25, 0, sh.tail - 0.1, -h - 0.8, chromeMat, Math.PI / 2);
      box(W * 1.15, 0.06, 0.55, 0, 0.32, h + 0.05, darkMat); // front wing
      for (const sx of [1, -1]) {
        box(0.06, 0.32, 0.6, sx * W * 0.57, 0.45, h + 0.05, darkMat);
        box(0.07, 0.9, 0.9, sx * 0.55, sh.tail + 0.45, -h + 0.45, rig.paint); // tail fins
      }
      box(1.3, 0.06, 0.55, 0, sh.tail + 0.92, -h + 0.45, darkMat);
      const f = makeFlame(0.34, 2.6);
      f.position.set(0, sh.tail - 0.1, -h - 0.92);
      ex.add(f);
      flames.push(f);
      break;
    }
    case 'hover': {
      hoverPads = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.4, 3), toneMapped: false });
      for (const w of rig.wheels) w.pivot.visible = false;
      for (const sx of [1, -1])
        for (const sz of [1, -1]) {
          cyl(0.38, 0.16, sx * (W / 2 - 0.35), sh.gc - 0.02, sz * (h - 0.9), darkMat);
          const disc = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16).rotateX(Math.PI / 2), hoverPads);
          disc.position.set(sx * (W / 2 - 0.35), sh.gc - 0.11, sz * (h - 0.9));
          ex.add(disc);
        }
      box(0.06, 0.55, 0.8, 0, sh.tail + 0.3, -h + 0.4, rig.paint);
      const f = makeFlame(0.2, 1.5);
      f.position.set(0, sh.tail - 0.2, -h - 0.05);
      ex.add(f);
      flames.push(f);
      break;
    }
    case 'limo': {
      // rooftop hot tub
      const zc = (sh.roofFront + sh.roofRear) / 2 - 0.4;
      box(W * 0.8, 0.3, 2.4, 0, sh.roofH + 0.18, zc, chromeMat);
      const water = new THREE.Mesh(new THREE.BoxGeometry(W * 0.72, 0.05, 2.25), new THREE.MeshStandardMaterial({ color: 0x29c6ff, emissive: 0x0a5a80, roughness: 0.05, metalness: 0.2 }));
      water.position.set(0, sh.roofH + 0.34, zc);
      ex.add(water);
      // extra middle axle
      for (const x of [sh.track, -sh.track]) {
        const m = new THREE.Mesh(rig.wheels[0].mesh.geometry, rig.wheels[0].mesh.material);
        m.position.set(x, sh.wheelR, 0);
        rig.group.add(m);
      }
      // chrome bull horns on the bonnet
      for (const sx of [1, -1]) cyl(0.04, 0.9, sx * 0.4, sh.nose + 0.22, h - 0.3, chromeMat, 0, sx * 1.2);
      break;
    }
    case 'rod': {
      // supercharger blower poking through the bonnet
      box(0.6, 0.35, 0.8, 0, sh.belt + 0.12, h - 1.0, chromeMat);
      box(0.5, 0.3, 0.45, 0, sh.belt + 0.45, h - 0.95, darkMat);
      for (const sx of [1, -1]) {
        cyl(0.07, 2.2, sx * (W / 2 + 0.06), sh.gc + 0.3, 0.1, chromeMat, Math.PI / 2);
        const f = makeFlame(0.11, 1.1);
        f.position.set(sx * (W / 2 + 0.06), sh.gc + 0.3, -1.0);
        ex.add(f);
        flames.push(f);
      }
      // big raked rear wheels
      for (const w of rig.wheels)
        if (!w.front) {
          w.mesh.scale.setScalar(1.28);
          w.pivot.position.y = sh.wheelR * 1.28;
        }
      break;
    }
  }
  return { extras: ex, flames, hoverPads };
}

const lampWhite = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3.2), toneMapped: false });
const lampRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.05, 0.05), toneMapped: false });
const carbonMat = new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.35, metalness: 0.5 });
const accentCache = new Map<number, THREE.MeshPhysicalMaterial>();
function accentMat(c: number) {
  let m = accentCache.get(c);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.3, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.08 });
    accentCache.set(c, m);
  }
  return m;
}

/** Hypercar bodywork: splitters, wings, intakes, signature lights, exhausts and brake calipers. */
function buildHyperExtras(spec: VehicleSpec, rig: { body: THREE.Group; wheels: WheelRig[]; paint: THREE.Material; surf?: Surface; headMat: THREE.Material; tailMat: THREE.Material }) {
  const sh = spec.shape;
  const L = spec.len,
    W = spec.wid,
    h = L / 2;
  const ex = new THREE.Group();
  rig.body.add(ex);
  const flames: THREE.Mesh[] = [];
  const acc = accentMat(spec.accent ?? 0x141518);
  const lampW = rig.headMat,
    lampR = rig.tailMat;
  // surface probes (fall back to the old box extents when no surface is available)
  const fz = (x: number, y: number) => rig.surf?.front(x, y).p.z ?? h;
  const rz = (x: number, y: number) => rig.surf?.rear(x, y).p.z ?? -h;
  const sx_ = (sx: number, y: number, z: number) => rig.surf?.side(sx, y, z).p.x ?? (sx * W) / 2;
  const ty = (x: number, z: number) => rig.surf?.top(x, z).p.y ?? sh.belt;
  // yaw that turns a part to follow the curve of the nose / tail at (x, y)
  const fyaw = (x: number, y: number) => {
    const n = rig.surf?.front(x, y).n;
    return n ? Math.atan2(n.x, Math.max(0.2, n.z)) : 0;
  };
  const ryaw = (x: number, y: number) => {
    const n = rig.surf?.rear(x, y).n;
    return n ? -Math.atan2(n.x, Math.max(0.2, -n.z)) : 0;
  };
  const box = (w: number, hh: number, d: number, x: number, y: number, z: number, m: THREE.Material, rx = 0, ry = 0, rz2 = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m);
    b.position.set(x, y, z);
    b.rotation.set(rx, ry, rz2);
    b.castShadow = true;
    ex.add(b);
    return b;
  };
  const cyl = (r: number, len: number, x: number, y: number, z: number, m: THREE.Material, seg = 12) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2), m);
    c.position.set(x, y, z);
    ex.add(c);
    return c;
  };
  /** a flat ribbon following the bonnet surface between two z values */
  const hoodStrip = (x: number, z0: number, z1: number, w: number, m: THREE.Material) => {
    const pos: number[] = [],
      idx: number[] = [];
    const N = 12;
    for (let k = 0; k <= N; k++) {
      const z = z0 + ((z1 - z0) * k) / N;
      for (const dx of [-w / 2, w / 2]) pos.push(x + dx, ty(x + dx, z) + 0.005, z);
      if (k < N) {
        const a0 = k * 2;
        idx.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const t = new THREE.Mesh(g, m);
    ex.add(t);
    return t;
  };

  // brake calipers (hang off the steering pivot so they don't spin)
  const caliper = accentMat(spec.hyper === 'wedge' ? 0xff6a00 : 0x1ea7ff);
  for (const w of rig.wheels) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.26), caliper);
    c.position.set(w.x > 0 ? -0.06 : 0.06, 0.1, 0.1);
    w.pivot.add(c);
  }
  // side skirts & rear diffuser
  for (const sx of [1, -1]) box(0.05, 0.08, L * 0.42, sx_(sx, sh.gc + 0.08, 0) - sx * 0.015, sh.gc + 0.05, 0, acc);
  box(W * 0.7, 0.1, 0.2, 0, sh.gc + 0.07, rz(0, sh.gc + 0.12) + 0.06, carbonMat);
  for (let i = -2; i <= 2; i++) box(0.025, 0.14, 0.22, i * 0.26, sh.gc + 0.09, rz(i * 0.26, sh.gc + 0.12) + 0.05, carbonMat);
  // front splitter tucked under the nose
  const splitZ = fz(0, sh.gc + 0.08);
  box(W * 0.84, 0.03, 0.22, 0, sh.gc + 0.02, splitZ - 0.1, acc);

  if (spec.hyper === 'wedge') {
    for (const sx of [1, -1]) {
      const ix = sx * (W / 2 - 0.42);
      box(0.34, 0.15, 0.06, ix, sh.gc + 0.2, fz(ix, sh.gc + 0.2) - 0.012, carbonMat, 0, fyaw(ix, sh.gc + 0.2), sx * 0.2);
      // Y-shaped headlights: two slim bars meeting at an angle
      const lx = sx * (W / 2 - 0.4),
        ly = sh.nose - 0.06;
      box(0.34, 0.04, 0.05, lx, ly, fz(lx, ly) - 0.006, lampW, 0, fyaw(lx, ly), sx * 0.18);
      const lx2 = sx * (W / 2 - 0.52),
        ly2 = sh.nose - 0.13;
      box(0.15, 0.04, 0.05, lx2, ly2, fz(lx2, ly2) - 0.006, lampW, 0, fyaw(lx2, ly2), -sx * 0.6);
      // big side air intakes behind the doors
      const iz = sh.cabRear + 0.25,
        iy = sh.belt - 0.28;
      box(0.05, 0.36, 0.75, sx_(sx, iy, iz) - sx * 0.01, iy, iz, carbonMat);
      // bonnet vents
      const vz = h - 0.75;
      box(0.3, 0.02, 0.36, sx * 0.32, ty(sx * 0.32, vz) + 0.004, vz, carbonMat, Math.atan2(sh.belt - sh.nose, h - sh.cabFront));
      // Y-shaped tail lights
      const tx = sx * (W / 2 - 0.4),
        tyy = sh.tail - 0.14;
      box(0.34, 0.045, 0.04, tx, tyy, rz(tx, tyy) + 0.006, lampR, 0, ryaw(tx, tyy), sx * 0.3);
      const tx2 = sx * (W / 2 - 0.52),
        ty2 = sh.tail - 0.24;
      box(0.16, 0.045, 0.04, tx2, ty2, rz(tx2, ty2) + 0.006, lampR, 0, ryaw(tx2, ty2), -sx * 0.6);
    }
    // black roof spine and louvred engine cover
    box(0.5, 0.02, sh.roofFront - sh.roofRear + 0.2, 0, sh.roofH + 0.03, (sh.roofFront + sh.roofRear) / 2, carbonMat);
    for (let i = 0; i < 4; i++) {
      const z = sh.cabRear - 0.2 - i * 0.22;
      box(W * 0.46, 0.025, 0.07, 0, ty(0, z) + 0.01, z, carbonMat);
    }
    // hexagonal centre exhausts (flames on nitro)
    for (const y of [sh.tail - 0.38, sh.tail - 0.52]) {
      const z = rz(0, y);
      cyl(0.08, 0.2, 0, y, z - 0.02, chromeMat, 6);
      const f = makeFlame(0.08, 1.1);
      f.position.set(0, y, z - 0.12);
      ex.add(f);
      flames.push(f);
    }
  } else {
    // horseshoe grille flanked by big intakes
    const gy = sh.gc + 0.3;
    const gz = fz(0, gy);
    const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.04, 20).rotateX(Math.PI / 2).scale(1, 1.15, 1), carbonMat);
    fill.position.set(0, gy, gz - 0.005);
    ex.add(fill);
    const arc = Math.PI * 1.65;
    const shoe = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.032, 8, 24, arc), chromeMat);
    shoe.rotation.z = Math.PI / 2 + (Math.PI * 2 - arc) / 2;
    shoe.scale.set(1, 1.15, 1);
    shoe.position.set(0, gy, gz + 0.012);
    ex.add(shoe);
    for (const sx of [1, -1]) {
      box(0.36, 0.2, 0.06, sx * 0.6, gy - 0.04, fz(sx * 0.6, gy - 0.04) - 0.012, carbonMat, 0, fyaw(sx * 0.6, gy - 0.04));
      // slim LED headlight bars
      const lx = sx * (W / 2 - 0.4),
        ly = sh.nose - 0.06;
      box(0.36, 0.045, 0.05, lx, ly, fz(lx, ly) - 0.006, lampW, 0, fyaw(lx, ly), sx * 0.12);
      // the signature sweeping "C" line along each side, opening to the front
      const cz = sh.cabRear + 0.55,
        cy = sh.belt - 0.22;
      const c = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.03, 6, 20, Math.PI * 1.1).rotateZ(Math.PI * 1.45).rotateY(Math.PI / 2), acc);
      c.position.set(sx_(sx, cy, cz) + sx * 0.012, cy, cz);
      ex.add(c);
      box(0.04, 0.26, 0.46, sx_(sx, cy - 0.04, cz) - sx * 0.005, cy - 0.04, cz, carbonMat);
    }
    // central roof fin and twin bonnet stripes in the accent colour
    box(0.05, 0.08, 1.4, 0, sh.roofH + 0.03, sh.roofRear - 0.35, acc);
    for (const sx of [1, -1]) hoodStrip(sx * 0.18, sh.cabFront + 0.05, h - 0.2, 0.09, acc);
    // full-width LED tail bar and quad exhausts
    box(W * 0.84, 0.045, 0.04, 0, sh.tail - 0.14, rz(0, sh.tail - 0.14), lampR);
    for (const x of [-0.27, -0.09, 0.09, 0.27]) {
      const y = sh.gc + 0.3;
      const z = rz(x, y);
      cyl(0.055, 0.2, x, y, z - 0.03, chromeMat);
      if (Math.abs(x) < 0.1) {
        const f = makeFlame(0.07, 1.0);
        f.position.set(x, y, z - 0.15);
        ex.add(f);
        flames.push(f);
      }
    }
  }
  if (spec.wing) {
    const wz = -h + 0.4;
    const base = ty(0, wz);
    const wy = base + 0.32;
    box(W * 0.94, 0.05, 0.42, 0, wy, wz, carbonMat, -0.1);
    for (const sx of [1, -1]) {
      box(0.035, 0.2, 0.44, sx * W * 0.46, wy + 0.04, wz, carbonMat); // end plates
      box(0.05, wy - base, 0.12, sx * 0.42, (wy + base) / 2, wz + 0.04, carbonMat, 0.15); // struts
    }
  }
  return { extras: ex, flames };
}

/** Box truck: rounded cab with glass, grille, lamps, mirrors and fuel tanks, plus a ribbed cargo body with rear doors. */
function buildTruck(spec: VehicleSpec): Built {
  const sh = spec.shape;
  const L = spec.len,
    W = spec.wid,
    h = L / 2;
  const P = (g: THREE.BufferGeometry) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n.attributes.uv) n.deleteAttribute('uv');
    return n;
  };
  const rbox = (w: number, hh: number, d: number, r: number, x: number, y: number, z: number) => P(new RoundedBoxGeometry(w, hh, d, 3, r).translate(x, y, z));
  const bx = (w: number, hh: number, d: number, x: number, y: number, z: number, rx = 0) => P(new THREE.BoxGeometry(w, hh, d).rotateX(rx).translate(x, y, z));
  const cabD = 2.2,
    cabZ = h - cabD / 2,
    cabBot = 0.8,
    cabTop = 3.05;
  const boxFront = h - cabD - 0.15,
    boxLen = boxFront + h - 0.05,
    boxZ = boxFront - boxLen / 2,
    boxBot = 1.0,
    boxTop = 3.55;
  const paint: THREE.BufferGeometry[] = [
    colorize(rbox(W, cabTop - cabBot, cabD, 0.16, 0, (cabTop + cabBot) / 2, cabZ), 0xffffff),
    // roof deflector up to the box height
    colorize(P(new THREE.CylinderGeometry(0.01, 1, 1, 4, 1).rotateY(Math.PI / 4).scale(W * 0.64, boxTop - cabTop, 1.4).translate(0, (boxTop + cabTop) / 2 - 0.02, cabZ - 0.3)), 0xffffff),
    colorize(rbox(W + 0.06, boxTop - boxBot, boxLen, 0.06, 0, (boxTop + boxBot) / 2, boxZ), 0xe9e9e6),
  ];
  // vertical ribs along the cargo sides
  for (let z = boxFront - 0.4; z > -h + 0.3; z -= 0.6)
    for (const sx of [1, -1]) paint.push(colorize(bx(0.03, boxTop - boxBot - 0.1, 0.07, sx * (W / 2 + 0.04), (boxTop + boxBot) / 2, z), 0xd8d8d4));
  const glass = mergeGeometries([
    bx(W * 0.86, 0.9, 0.04, 0, 2.42, h + 0.005, -0.06),
    ...[1, -1].map((sx) => bx(0.04, 0.7, 0.95, sx * (W / 2 + 0.003), 2.45, h - 0.65)),
  ])!;
  const trim: THREE.BufferGeometry[] = [
    // chassis rails, bumper, under-run bar, mudguards
    bx(0.18, 0.22, L - 0.4, 0.5, 0.78, -0.1),
    bx(0.18, 0.22, L - 0.4, -0.5, 0.78, -0.1),
    rbox(W + 0.04, 0.34, 0.26, 0.05, 0, 0.72, h - 0.02),
    bx(W * 0.9, 0.14, 0.12, 0, 0.62, -h + 0.06),
    bx(W * 0.64, 0.62, 0.04, 0, 1.4, h + 0.012), // grille surround
    // window seals
    bx(W * 0.88, 0.05, 0.05, 0, 1.95, h + 0.01),
    ...[1, -1].map((sx) => bx(0.06, 0.06, 1.0, sx * (W / 2 + 0.01), 2.08, h - 0.65)),
    // rear door seam
    bx(0.03, boxTop - boxBot - 0.1, 0.02, 0, (boxTop + boxBot) / 2, -h - 0.01),
  ];
  for (const z of [sh.wheelX, -sh.wheelX, -sh.wheelX + 1.1])
    for (const sx of [1, -1]) trim.push(P(new THREE.CylinderGeometry(sh.wheelR + 0.1, sh.wheelR + 0.1, 0.38, 16, 1, true, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2).translate(sx * sh.track, sh.wheelR, z)));
  // mirrors on long arms
  for (const sx of [1, -1]) {
    trim.push(bx(0.4, 0.04, 0.04, sx * (W / 2 + 0.18), 2.35, h - 0.35));
    trim.push(rbox(0.1, 0.42, 0.18, 0.03, sx * (W / 2 + 0.38), 2.3, h - 0.35));
    // cab steps
    trim.push(bx(0.2, 0.05, 0.45, sx * (W / 2 - 0.05), 0.55, h - 1.4));
  }
  const chrome: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) chrome.push(bx(W * 0.6, 0.035, 0.03, 0, 1.18 + i * 0.11, h + 0.03));
  for (const sx of [1, -1]) {
    chrome.push(P(new THREE.CylinderGeometry(0.28, 0.28, 1.1, 18).rotateX(Math.PI / 2).translate(sx * (W / 2 - 0.3), 0.75, h - cabD - 0.75))); // fuel tanks
    chrome.push(P(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6).translate(sx * 0.12, 2.0, -h - 0.03))); // door handles
    chrome.push(P(new THREE.CircleGeometry(0.16, 12).scale(0.45, 1.2, 1).translate(sx * (W / 2 + 0.38), 2.3, h - 0.45).rotateY(0))); // mirror glass (approx.)
  }
  const lens: THREE.BufferGeometry[] = [];
  const head: THREE.BufferGeometry[] = [];
  const tail: THREE.BufferGeometry[] = [];
  for (const sx of [1, -1]) {
    lens.push(rbox(0.42, 0.22, 0.05, 0.04, sx * (W / 2 - 0.33), 1.05, h + 0.01));
    head.push(P(new THREE.CylinderGeometry(0.065, 0.065, 0.02, 14).rotateX(Math.PI / 2).translate(sx * (W / 2 - 0.42), 1.05, h + 0.04)));
    head.push(P(new THREE.CylinderGeometry(0.065, 0.065, 0.02, 14).rotateX(Math.PI / 2).translate(sx * (W / 2 - 0.24), 1.05, h + 0.04)));
    // cab marker lamps on the roof
    head.push(bx(0.1, 0.05, 0.05, sx * 0.3, cabTop + 0.02, h - 0.1));
    tail.push(bx(0.36, 0.14, 0.04, sx * (W / 2 - 0.3), 1.12, -h - 0.04));
  }
  // number plates keep their UVs for the plate texture
  const plates = [new THREE.PlaneGeometry(0.5, 0.11).rotateY(Math.PI).translate(0, 0.78, -h - 0.02).toNonIndexed(), new THREE.PlaneGeometry(0.5, 0.11).translate(0, 0.72, h + 0.12).toNonIndexed()];
  return {
    body: toCreasedNormals(mergeGeometries(paint)!, 0.62),
    glass,
    head: mergeGeometries(head)!,
    tail: mergeGeometries(tail)!,
    trim: mergeGeometries(trim)!,
    chrome: mergeGeometries(chrome)!,
    lens: mergeGeometries(lens)!,
    plate: mergeGeometries(plates)!,
    wheel: buildWheel(sh.wheelR, 0.38, 'steel'),
    rim: 0x6a6e74,
  };
}

function buildCar(spec: VehicleSpec): Built {
  const sh = spec.shape;
  const L = spec.len,
    W = spec.wid;
  const h = L / 2;
  if (spec.cls !== 'truck') {
    const c = buildCarBody(spec, spec.cls === 'police' ? spec.colors[0] : undefined);
    const extra: THREE.BufferGeometry[] = [c.trim];
    if (sh.spoiler) {
      extra.push(new THREE.BoxGeometry(W * 0.86, 0.04, 0.28).translate(0, sh.tail + 0.22, -h + 0.25).toNonIndexed());
      for (const sx of [1, -1]) extra.push(new THREE.BoxGeometry(0.05, 0.22, 0.1).translate(sx * W * 0.3, sh.tail + 0.11, -h + 0.25).toNonIndexed());
    }
    const style = spec.crazy === 'monster' ? 'offroad' : spec.hyper || spec.cls === 'sports' || spec.cls === 'super' || spec.crazy ? 'multi' : sh.boxy && spec.cls !== 'suv' ? 'steel' : 'alloy';
    const ww = spec.crazy === 'monster' ? 0.78 : spec.crazy === 'rocket' ? 0.42 : spec.crazy === 'rod' ? 0.36 : spec.hyper ? 0.32 : 0.26;
    const rim = spec.hyper === 'wedge' ? 0x232428 : spec.hyper ? 0x9aa0a8 : style === 'steel' ? 0x5c6066 : spec.cls === 'muscle' || spec.crazy === 'rod' ? 0xd8dce2 : 0xb4b8be;
    return {
      body: c.body,
      glass: c.glass.attributes.position ? c.glass : null,
      head: c.head,
      tail: c.tail,
      trim: mergeGeometries(extra.map((g) => { if (g.attributes.uv) g.deleteAttribute('uv'); return g; }))!,
      chrome: c.chrome,
      lens: c.lens,
      plate: c.plate,
      surf: c.surf,
      wheel: buildWheel(sh.wheelR, ww, style),
      rim,
    };
  }
  if (spec.cls === 'truck') return buildTruck(spec);
  const lower = colorize(
    profile(
      [
        [-h, sh.gc + 0.06],
        [-h + 0.12, sh.gc],
        [h - 0.12, sh.gc],
        [h, sh.gc + 0.08],
        [h, sh.nose],
        [h - 0.35, sh.nose + (sh.belt - sh.nose) * 0.6],
        [sh.cabFront, sh.belt],
        [sh.cabRear, sh.belt],
        [-h + 0.25, sh.tail],
        [-h, sh.tail - 0.12],
      ],
      W,
      spec.cls === 'truck' || sh.boxy ? 0.06 : 0.12,
      spec.cls === 'truck' ? 0 : 0.22,
    ),
    0xffffff,
  );
  const parts: THREE.BufferGeometry[] = [lower];
  // cabin glass + roof
  let glass: THREE.BufferGeometry | null = null;
  if (spec.cls !== 'truck') {
    glass = profile(
      [
        [sh.cabRear, sh.belt - 0.02],
        [sh.cabFront, sh.belt - 0.02],
        [sh.roofFront, sh.roofH - 0.02],
        [sh.roofRear, sh.roofH - 0.02],
      ],
      W * 0.86,
      0.05,
      0.1,
    );
    parts.push(
      colorize(
        profile(
          [
            [sh.roofRear - 0.04, sh.roofH - 0.05],
            [sh.roofFront + 0.04, sh.roofH - 0.05],
            [sh.roofFront, sh.roofH + 0.03],
            [sh.roofRear, sh.roofH + 0.03],
          ],
          W * 0.88,
          0.04,
          0.06,
        ),
        0xffffff,
      ),
    );
    if (sh.boxy) {
      // rear cargo box for vans/SUV roof continues as body color
      if (sh.cabRear > 0) {
        parts.push(colorize(new THREE.BoxGeometry(W * 0.98, sh.roofH - sh.belt + 0.05, sh.cabRear + h - 0.05).translate(0, (sh.roofH + sh.belt) / 2, (sh.cabRear - h) / 2 + 0.02), 0xffffff));
      }
    }
  }
  // bumpers & sills
  parts.push(colorize(new THREE.BoxGeometry(W * 0.96, 0.22, 0.16).translate(0, sh.gc + 0.14, h - 0.02), DARK));
  parts.push(colorize(new THREE.BoxGeometry(W * 0.96, 0.22, 0.16).translate(0, sh.gc + 0.14, -h + 0.02), DARK));
  parts.push(colorize(new THREE.BoxGeometry(W + 0.02, 0.12, L * 0.55).translate(0, sh.gc + 0.06, 0), DARK));
  // grille
  parts.push(colorize(new THREE.BoxGeometry(W * 0.5, 0.14, 0.04).translate(0, sh.gc + 0.32, h + 0.02), 0x0a0a0a));
  // mirrors
  parts.push(colorize(new THREE.BoxGeometry(0.18, 0.1, 0.12).translate(W / 2 + 0.06, sh.belt + 0.08, sh.cabFront - 0.1), DARK));
  parts.push(colorize(new THREE.BoxGeometry(0.18, 0.1, 0.12).translate(-W / 2 - 0.06, sh.belt + 0.08, sh.cabFront - 0.1), DARK));
  if (sh.spoiler) {
    parts.push(colorize(new THREE.BoxGeometry(W * 0.9, 0.05, 0.3).translate(0, sh.tail + 0.25, -h + 0.25), DARK));
    parts.push(colorize(new THREE.BoxGeometry(0.06, 0.25, 0.12).translate(W * 0.3, sh.tail + 0.12, -h + 0.25), DARK));
    parts.push(colorize(new THREE.BoxGeometry(0.06, 0.25, 0.12).translate(-W * 0.3, sh.tail + 0.12, -h + 0.25), DARK));
  }
  if (spec.cls === 'truck') {
    // cab + cargo box
    parts.length = 0;
    parts.push(colorize(new THREE.BoxGeometry(W, 1.5, 2.2).translate(0, 1.25, h - 1.1), 0xffffff));
    parts.push(colorize(new THREE.BoxGeometry(W * 0.96, 0.9, 1.6).translate(0, 2.45, h - 1.3), 0xffffff));
    parts.push(colorize(new THREE.BoxGeometry(W + 0.1, 2.8, L - 2.5).translate(0, 2.0, -1.25), 0xe8e8e8));
    parts.push(colorize(new THREE.BoxGeometry(W * 0.96, 0.22, 0.16).translate(0, 0.55, h), DARK));
    parts.push(colorize(new THREE.BoxGeometry(W * 0.7, 0.35, 0.04).translate(0, 1.0, h + 0.01), 0x0a0a0a));
    glass = new THREE.BoxGeometry(W * 0.9, 0.7, 0.1).translate(0, 2.45, h - 0.48);
  }
  // smooth shading across curved panels, crisp creases at sharp edges
  const body = toCreasedNormals(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!, 0.62);
  if (glass) glass = toCreasedNormals(glass.index ? glass.toNonIndexed() : glass, 0.62);
  const lx = W / 2 - 0.3;
  const headY = spec.cls === 'truck' ? 0.9 : sh.nose - 0.12;
  const head = mergeGeometries([new THREE.BoxGeometry(0.42, 0.12, 0.06).translate(lx, headY, h + 0.01), new THREE.BoxGeometry(0.42, 0.12, 0.06).translate(-lx, headY, h + 0.01)])!;
  const tailY = spec.cls === 'truck' ? 0.9 : sh.tail - 0.15;
  const tail = mergeGeometries([new THREE.BoxGeometry(0.42, 0.12, 0.06).translate(lx, tailY, -h - 0.01), new THREE.BoxGeometry(0.42, 0.12, 0.06).translate(-lx, tailY, -h - 0.01)])!;
  const ww = spec.crazy === 'monster' ? 0.78 : spec.crazy === 'rocket' ? 0.42 : spec.crazy === 'rod' ? 0.36 : spec.cls === 'truck' ? 0.38 : 0.26;
  const wheel = spec.hyper ? wheelGeo(sh.wheelR, 0.32, false, spec.hyper === 'wedge' ? 0x232428 : 0x8a9099, true) : wheelGeo(sh.wheelR, ww, spec.crazy === 'monster');
  return { body, glass, head, tail, wheel };
}

function buildBike(spec: VehicleSpec) {
  const sh = spec.shape;
  const parts = [
    colorize(new THREE.BoxGeometry(0.28, 0.32, 0.7).translate(0, 0.78, 0.12), 0xffffff), // tank
    colorize(new THREE.BoxGeometry(0.3, 0.42, 0.45).translate(0, 0.72, 0.62).rotateX(-0.35), 0xffffff), // fairing
    colorize(new THREE.BoxGeometry(0.24, 0.1, 0.55).translate(0, 0.86, -0.38), 0x111111), // seat
    colorize(new THREE.BoxGeometry(0.22, 0.25, 0.5).translate(0, 0.7, -0.62), 0xffffff), // tail
    colorize(new THREE.BoxGeometry(0.2, 0.3, 0.6).translate(0, 0.45, 0.0), 0x2a2a2a), // engine
    colorize(new THREE.BoxGeometry(0.06, 0.06, 0.9).translate(0, 0.5, -0.35).rotateX(0.25), CHROME), // swingarm
    colorize(new THREE.BoxGeometry(0.05, 0.55, 0.05).translate(0.09, 0.62, 0.78).rotateX(-0.3), CHROME), // forks
    colorize(new THREE.BoxGeometry(0.05, 0.55, 0.05).translate(-0.09, 0.62, 0.78).rotateX(-0.3), CHROME),
    colorize(new THREE.BoxGeometry(0.62, 0.04, 0.04).translate(0, 1.02, 0.5), 0x111111), // bars
  ];
  const body = mergeGeometries(parts)!;
  const head = new THREE.BoxGeometry(0.16, 0.1, 0.05).translate(0, 0.82, 0.88);
  const tail = new THREE.BoxGeometry(0.14, 0.06, 0.04).translate(0, 0.78, -0.88);
  const glass = new THREE.BoxGeometry(0.26, 0.18, 0.03).translate(0, 1.02, 0.72).rotateX(-0.5);
  return { body, glass, head, tail, wheel: wheelGeo(sh.wheelR, 0.14) };
}

function buildBoat(spec: VehicleSpec) {
  const L = spec.len,
    W = spec.wid,
    h = L / 2;
  const hull = profile(
    [
      [-h, 0.15],
      [h * 0.55, 0.0],
      [h, 0.75],
      [h * 0.9, 1.0],
      [-h, 1.0],
    ],
    W,
    0.05,
  );
  // taper the bow
  const pos = hull.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const f = z > h * 0.1 ? 1 - ((z - h * 0.1) / (h * 0.9)) * 0.92 : 1;
    pos.setX(i, pos.getX(i) * Math.max(0.05, f));
    // V-hull
    const y = pos.getY(i);
    if (y < 0.4) pos.setX(i, pos.getX(i) * (0.55 + y));
  }
  hull.computeVertexNormals();
  const parts = [colorize(hull, 0xffffff)];
  parts.push(colorize(new THREE.BoxGeometry(W * 0.86, 0.05, L * 0.62).translate(0, 1.0, -h * 0.25), 0x8a6a4a)); // deck
  parts.push(colorize(new THREE.BoxGeometry(W * 0.5, 0.5, 0.5).translate(0, 1.25, -h * 0.05), 0x222222)); // console
  parts.push(colorize(new THREE.BoxGeometry(0.5, 0.7, 0.6).translate(0, 0.85, -h - 0.15), 0x1a1a1a)); // outboard
  parts.push(colorize(new THREE.BoxGeometry(W * 0.7, 0.35, 0.5).translate(0, 1.2, -h * 0.65), 0xf0f0f0)); // seat
  const body = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
  const glass = new THREE.BoxGeometry(W * 0.6, 0.35, 0.06).translate(0, 1.55, h * 0.08).rotateX(-0.4);
  const head = new THREE.BoxGeometry(0.2, 0.1, 0.1).translate(0, 1.05, h * 0.85);
  const tail = new THREE.BoxGeometry(0.2, 0.1, 0.1).translate(0, 1.2, -h + 0.1);
  return { body, glass, head, tail, wheel: new THREE.BufferGeometry() };
}

/** Light aircraft / jet: fuselage, wings, tail, canopy. Length along +Z, wheels on the ground at y=0. */
function buildPlane(spec: VehicleSpec) {
  const L = spec.len,
    h = L / 2;
  const jet = spec.plane === 'jet';
  const cy = 1.25; // fuselage centre height
  const span = jet ? 8.2 : 10.5;
  const along = (g: THREE.BufferGeometry) => g.rotateX(Math.PI / 2); // cylinder axis Y -> Z
  const parts: THREE.BufferGeometry[] = [];
  // fuselage: main tube, nose, tapering tail boom
  parts.push(colorize(along(new THREE.CylinderGeometry(0.62, 0.66, L * 0.5, 16)).translate(0, cy, h * 0.15), 0xffffff));
  parts.push(colorize(along(new THREE.CylinderGeometry(jet ? 0.08 : 0.42, 0.62, L * 0.18, 16)).translate(0, cy - (jet ? 0.05 : 0), h * 0.15 + L * 0.34), jet ? 0x2a2c30 : 0xffffff));
  parts.push(colorize(along(new THREE.CylinderGeometry(0.66, 0.22, L * 0.34, 14)).translate(0, cy + 0.12, h * 0.15 - L * 0.42), 0xffffff));
  // wings (jet: swept delta), with dark wingtips
  if (jet) {
    const sh = new THREE.Shape();
    sh.moveTo(0, 1.6);
    sh.lineTo(span / 2, -1.6);
    sh.lineTo(span / 2, -2.3);
    sh.lineTo(-span / 2, -2.3);
    sh.lineTo(-span / 2, -1.6);
    sh.closePath();
    const w = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, cy - 0.1, 0.2);
    parts.push(colorize(w, 0xffffff));
  } else {
    parts.push(colorize(new THREE.BoxGeometry(span, 0.13, 1.6).translate(0, cy + 0.45, h * 0.25), 0xffffff));
    for (const sx of [1, -1]) parts.push(colorize(new THREE.BoxGeometry(0.5, 0.14, 1.62).translate(sx * (span / 2 - 0.25), cy + 0.45, h * 0.25), DARK));
  }
  // tail: horizontal stabiliser + fin
  parts.push(colorize(new THREE.BoxGeometry(jet ? 3.4 : 3.8, 0.08, 1.0).translate(0, cy + 0.2, -h + 0.7), 0xffffff));
  parts.push(colorize(new THREE.BoxGeometry(0.1, jet ? 1.7 : 1.4, 1.2).translate(0, cy + 0.95, -h + 0.75), 0xffffff));
  // landing gear struts
  for (const [x, z] of [
    [spec.shape.track, spec.shape.wheelX],
    [-spec.shape.track, spec.shape.wheelX],
    [spec.shape.track, -spec.shape.wheelX],
    [-spec.shape.track, -spec.shape.wheelX],
  ])
    parts.push(colorize(new THREE.BoxGeometry(0.08, cy - 0.3, 0.08).translate(x * 0.8, (cy - 0.3) / 2 + 0.3, z), DARK));
  if (jet) for (const sx of [1, -1]) parts.push(colorize(new THREE.BoxGeometry(0.4, 0.5, 1.6).translate(sx * 0.72, cy - 0.1, 0.4), DARK)); // intakes
  const body = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
  body.computeVertexNormals();
  const glass = new THREE.SphereGeometry(0.5, 14, 10).scale(0.85, 0.75, jet ? 2.4 : 1.8).translate(0, cy + 0.5, h * 0.2 + (jet ? 0.9 : 0.4));
  const head = mergeGeometries([new THREE.BoxGeometry(0.2, 0.12, 0.06).translate(span / 2 - 0.4, cy + (jet ? -0.1 : 0.45), h * 0.25 + 0.82), new THREE.BoxGeometry(0.2, 0.12, 0.06).translate(-span / 2 + 0.4, cy + (jet ? -0.1 : 0.45), h * 0.25 + 0.82)])!;
  const tail = new THREE.BoxGeometry(0.12, 0.2, 0.12).translate(0, cy + 1.7, -h + 0.2);
  return { body, glass, head, tail, wheel: wheelGeo(spec.shape.wheelR, 0.2) };
}

const driverSkins = [0xe8c4a6, 0xc08860, 0x9a6a46, 0x74503a, 0xd9a983].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
const driverShirts = [0x3a4a6a, 0xe6e4de, 0x7a2e2e, 0x1c1c1e, 0x3d5a46, 0x8a8f96].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
const driverHair = new THREE.MeshStandardMaterial({ color: 0x1e1610, roughness: 0.7 });
let driverG: { shirt: THREE.BufferGeometry; skin: THREE.BufferGeometry; hair: THREE.BufferGeometry } | null = null;
/** Seated NPC driver seen through the glass: shoulders, arms reaching for the wheel, head and hair. */
function driverGeos() {
  if (driverG) return driverG;
  const prep = (g: THREE.BufferGeometry) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute('uv');
    return n;
  };
  const torso = new THREE.LatheGeometry(
    [
      [0.0, 0.55],
      [0.15, 0.56],
      [0.16, 0.7],
      [0.19, 0.9],
      [0.2, 1.02],
      [0.15, 1.1],
      [0.06, 1.14],
      [0.0, 1.145],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    16,
  ).scale(1.05, 1, 0.6);
  const arms: THREE.BufferGeometry[] = [];
  for (const sx of [1, -1]) {
    arms.push(new THREE.CapsuleGeometry(0.052, 0.26, 4, 8).translate(0, -0.15, 0).rotateX(-0.9).translate(sx * 0.21, 1.03, 0));
  }
  const fore: THREE.BufferGeometry[] = [];
  for (const sx of [1, -1]) fore.push(new THREE.CapsuleGeometry(0.042, 0.24, 4, 8).translate(0, -0.13, 0).rotateX(-1.5).rotateY(-sx * 0.35).translate(sx * 0.2, 0.83, 0.2));
  const head = new THREE.SphereGeometry(0.105, 16, 12).scale(0.92, 1.12, 1).translate(0, 1.29, 0.01);
  const neck = new THREE.CylinderGeometry(0.05, 0.055, 0.12, 10).translate(0, 1.16, 0);
  const hands = [1, -1].map((sx) => new THREE.SphereGeometry(0.04, 8, 6).scale(1, 0.8, 1.2).translate(sx * 0.16, 0.88, 0.43));
  const hair = new THREE.SphereGeometry(0.112, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.42).scale(0.94, 1.1, 1.02).translate(0, 1.3, -0.005);
  driverG = {
    shirt: mergeGeometries([torso, ...arms, ...fore].map(prep))!,
    skin: mergeGeometries([head, neck, ...hands].map(prep))!,
    hair: prep(hair),
  };
  return driverG;
}

export function buildVehicleRig(spec: VehicleSpec, color: number): VehicleRig {
  let g = cache.get(spec.id);
  if (!g) {
    g = spec.plane ? buildPlane(spec) : spec.bike ? buildBike(spec) : spec.boat ? buildBoat(spec) : buildCar(spec);
    cache.set(spec.id, g);
  }
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const paint = paintMaterial(spec.cls === 'police' ? 0xffffff : color);
  const bodyMesh = new THREE.Mesh(g.body, paint);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  body.add(bodyMesh);
  const part = (geo: THREE.BufferGeometry | undefined, m: THREE.Material, shadow = false) => {
    if (!geo || !geo.attributes.position) return;
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = shadow;
    body.add(mesh);
  };
  part(g.trim, trimMat, true);
  part(g.chrome, brightMat);
  part(g.lens, lensMat);
  part(g.plate, plateMaterial());
  let glassMesh: THREE.Mesh | undefined;
  if (g.glass) {
    glassMesh = new THREE.Mesh(g.glass, glassMat);
    body.add(glassMesh);
  }
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff4d8, toneMapped: false });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x880000, toneMapped: false });
  body.add(new THREE.Mesh(g.head, headMat), new THREE.Mesh(g.tail, tailMat));

  const wheels: WheelRig[] = [];
  const sh = spec.shape;
  const wheelMats = [tyreMat, rimMat(g.rim ?? 0xb4b8be), discMat];
  if (!spec.boat) {
    const positions: [number, number, boolean][] = spec.bike
      ? [
          [0, sh.wheelX, true],
          [0, -sh.wheelX, false],
        ]
      : [
          [sh.track, sh.wheelX, true],
          [-sh.track, sh.wheelX, true],
          [sh.track, -sh.wheelX, false],
          [-sh.track, -sh.wheelX, false],
        ];
    for (const [x, z, front] of positions) {
      const pivot = new THREE.Group();
      pivot.position.set(x, sh.wheelR, z);
      const mesh = new THREE.Mesh(g.wheel, wheelMats);
      mesh.castShadow = true;
      pivot.add(mesh);
      group.add(pivot);
      wheels.push({ pivot, mesh, front, x, z });
    }
    if (spec.cls === 'truck') {
      for (const x of [sh.track, -sh.track]) {
        const m = new THREE.Mesh(g.wheel, wheelMats);
        m.position.set(x, sh.wheelR, -sh.wheelX + 1.1);
        group.add(m);
      }
    }
  }
  let sirenR: THREE.MeshBasicMaterial | undefined, sirenB: THREE.MeshBasicMaterial | undefined;
  if (spec.police) {
    sirenR = new THREE.MeshBasicMaterial({ color: 0x440000, toneMapped: false });
    sirenB = new THREE.MeshBasicMaterial({ color: 0x000044, toneMapped: false });
    const zc = spec.cls === 'swat' ? sh.roofFront - 0.1 : (sh.roofFront + sh.roofRear) / 2;
    const y0 = (g.surf ? sh.roofH : sh.roofH + 0.04) + 0.03;
    // modern low light bar: black base, two rounded lens halves, chrome end caps
    const base = new THREE.Mesh(new THREE.BoxGeometry(spec.wid * 0.84, 0.05, 0.3), trimMat);
    base.position.set(0, y0, zc);
    const lens = new THREE.CapsuleGeometry(0.075, spec.wid * 0.34, 4, 10).rotateZ(Math.PI / 2).scale(1, 0.75, 1.5);
    const bar = new THREE.Mesh(lens, sirenR);
    bar.position.set(spec.wid * 0.2, y0 + 0.07, zc);
    const bar2 = new THREE.Mesh(lens, sirenB);
    bar2.position.set(-spec.wid * 0.2, y0 + 0.07, zc);
    body.add(base, bar, bar2);
  }
  if (spec.cls === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.3), new THREE.MeshBasicMaterial({ color: 0xfff2a0, toneMapped: false }));
    sign.position.set(0, sh.roofH + 0.13, (sh.roofFront + sh.roofRear) / 2);
    body.add(sign);
  }
  // seat position (driver on the left: +x local)
  let seat: THREE.Vector3;
  if (spec.plane) seat = new THREE.Vector3(0, 0.78, spec.len * 0.1 + (spec.plane === 'jet' ? 0.7 : 0.25));
  else if (spec.bike) seat = new THREE.Vector3(0, 0.0, -0.3);
  else if (spec.boat) seat = new THREE.Vector3(0.0, 0.6, -spec.len * 0.12);
  else if (spec.cls === 'truck') seat = new THREE.Vector3(0.5, 0.75, spec.len / 2 - 1.3);
  else seat = new THREE.Vector3(spec.wid * 0.22, sh.gc - 0.05, (sh.cabFront + sh.cabRear) / 2 + 0.1);
  // NPC driver dummy (cheap)
  const driverDummy = new THREE.Group();
  const dg = driverGeos();
  const shirtM = driverShirts[Math.floor(Math.random() * driverShirts.length)];
  const skinM = driverSkins[Math.floor(Math.random() * driverSkins.length)];
  driverDummy.add(new THREE.Mesh(dg.shirt, shirtM), new THREE.Mesh(dg.skin, skinM), new THREE.Mesh(dg.hair, driverHair));
  driverDummy.position.copy(seat);
  // sink the figure into the seat on low cars so the head stays under the roof
  if (!spec.bike && !spec.boat && !spec.plane && spec.cls !== 'truck') driverDummy.position.y -= Math.max(0, seat.y + 1.41 - (sh.roofH - 0.07));
  driverDummy.visible = false;
  body.add(driverDummy);
  let flames: THREE.Mesh[] = [];
  let extras: THREE.Group | undefined, hoverPads: THREE.MeshBasicMaterial | undefined;
  if (spec.crazy) ({ extras, flames, hoverPads } = buildCrazyExtras(spec, { body, group, wheels, paint }));
  if (spec.hyper) ({ extras, flames } = buildHyperExtras(spec, { body, wheels, paint, surf: g.surf, headMat, tailMat }));
  let prop: THREE.Object3D | undefined;
  if (spec.plane) {
    const h = spec.len / 2;
    if (spec.plane === 'prop') {
      prop = new THREE.Group();
      prop.position.set(0, 1.25, h * 0.15 + spec.len * 0.43 + 0.05);
      const hub = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.45, 12).rotateX(Math.PI / 2), chromeMat);
      const blades = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.18, 0.05), darkMat);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1.15, 24), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
      prop.add(hub, blades, disc);
      body.add(prop);
    } else {
      const f = makeFlame(0.32, 3.2);
      f.position.set(0, 1.37, -h + 0.0);
      body.add(f);
      flames.push(f);
    }
    // wingtip navigation lights
    const span = spec.plane === 'jet' ? 8.2 : 10.5;
    const navR = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.1, 0.1), toneMapped: false }));
    const navG = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 3, 0.4), toneMapped: false }));
    const wy = spec.plane === 'jet' ? 1.2 : 1.7;
    const wz = spec.plane === 'jet' ? -1.6 + 0.2 : h * 0.25;
    navR.position.set(span / 2, wy, wz);
    navG.position.set(-span / 2, wy, wz);
    body.add(navR, navG);
  }
  return { group, body, wheels, tailMat, headMat, sirenR, sirenB, paint, seat, driverDummy, glass: glassMesh, flames, extras, hoverPads, prop };
}
