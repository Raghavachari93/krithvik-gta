import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VehicleSpec } from './VehicleSpecs';

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

const cache = new Map<string, { body: THREE.BufferGeometry; glass: THREE.BufferGeometry | null; head: THREE.BufferGeometry; tail: THREE.BufferGeometry; wheel: THREE.BufferGeometry; extra?: THREE.BufferGeometry }>();

const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0a1218, roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.82, envMapIntensity: 1.5 });
const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.3 });
const paintCache = new Map<number, THREE.MeshPhysicalMaterial>();
export function paintMaterial(color: number) {
  let m = paintCache.get(color);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color, vertexColors: true, roughness: 0.32, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.08 });
    paintCache.set(color, m);
  }
  return m;
}
export const burntMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1816, vertexColors: true, roughness: 1, metalness: 0.1 });

const DARK = 0x16171a;
const CHROME = 0x9aa0a8;

function wheelGeo(r: number, w: number, knobby = false, rimColor = CHROME, sporty = false) {
  const tire = colorize(new THREE.CylinderGeometry(r, r, w * 0.7, 28).rotateZ(Math.PI / 2), 0x151515);
  const shoulders = [1, -1].map((sx) => colorize(new THREE.TorusGeometry(r - w * 0.15, w * 0.16, 8, 28).rotateY(Math.PI / 2).translate((sx * w * 0.35), 0, 0), 0x1a1a1a));
  const rim = colorize(new THREE.CylinderGeometry(r * (sporty ? 0.74 : 0.62), r * (sporty ? 0.74 : 0.62), w + 0.02, 14).rotateZ(Math.PI / 2), sporty ? 0x0c0c0e : rimColor);
  const spokes = colorize(new THREE.BoxGeometry(w + 0.04, r * 1.1, 0.06), 0x55595e);
  const parts = [tire, rim, spokes, ...shoulders];
  if (sporty) {
    // thin multi-spoke alloy
    parts.splice(2, 1);
    for (let i = 0; i < 10; i++) parts.push(colorize(new THREE.BoxGeometry(w + 0.05, r * 1.42, 0.035).rotateX((i / 10) * Math.PI), rimColor));
    parts.push(colorize(new THREE.CylinderGeometry(r * 0.14, r * 0.14, w + 0.07, 8).rotateZ(Math.PI / 2), rimColor));
  }
  if (knobby) {
    // chunky off-road tread blocks
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      parts.push(colorize(new THREE.BoxGeometry(w * 0.9, 0.12, 0.2).translate(0, r + 0.02, 0).rotateX(a), 0x1c1c1c));
    }
  }
  return mergeGeometries(parts)!;
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
function buildHyperExtras(spec: VehicleSpec, rig: { body: THREE.Group; wheels: WheelRig[]; paint: THREE.Material }) {
  const sh = spec.shape;
  const L = spec.len,
    W = spec.wid,
    h = L / 2;
  const ex = new THREE.Group();
  rig.body.add(ex);
  const flames: THREE.Mesh[] = [];
  const acc = accentMat(spec.accent ?? 0x141518);
  const box = (w: number, hh: number, d: number, x: number, y: number, z: number, m: THREE.Material, rx = 0, ry = 0, rz = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m);
    b.position.set(x, y, z);
    b.rotation.set(rx, ry, rz);
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
  // body height along the bonnet (between the nose and the windscreen base)
  const hoodY = (z: number) => sh.nose + (sh.belt - sh.nose) * Math.min(1, Math.max(0, (h - z) / (h - sh.cabFront)));
  const hoodPitch = Math.atan2(sh.belt - sh.nose, h - sh.cabFront);

  // brake calipers (hang off the steering pivot so they don't spin)
  const caliper = accentMat(spec.hyper === 'wedge' ? 0xff6a00 : 0x1ea7ff);
  for (const w of rig.wheels) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.3), caliper);
    c.position.set(w.x > 0 ? -0.12 : 0.12, 0.08, 0.1);
    w.pivot.add(c);
  }
  // side skirts & rear diffuser
  for (const sx of [1, -1]) box(0.06, 0.12, L * 0.56, sx * (W / 2 + 0.01), sh.gc + 0.08, 0, acc);
  box(W * 0.82, 0.16, 0.34, 0, sh.gc + 0.1, -h - 0.04, carbonMat);
  for (let i = -2; i <= 2; i++) box(0.03, 0.2, 0.36, i * 0.3, sh.gc + 0.1, -h - 0.06, carbonMat);

  if (spec.hyper === 'wedge') {
    // sharp front splitter and corner intakes
    box(W * 1.02, 0.05, 0.42, 0, sh.gc + 0.04, h - 0.05, acc);
    for (const sx of [1, -1]) {
      box(0.55, 0.2, 0.08, sx * (W / 2 - 0.42), sh.gc + 0.22, h, carbonMat, 0, 0, sx * 0.2);
      // Y-shaped headlights: two slim bars meeting at an angle
      box(0.46, 0.05, 0.05, sx * (W / 2 - 0.36), sh.nose - 0.07, h + 0.085, lampWhite, 0, 0, sx * 0.18);
      box(0.2, 0.045, 0.05, sx * (W / 2 - 0.5), sh.nose - 0.15, h + 0.085, lampWhite, 0, 0, -sx * 0.6);
      // big side air intakes behind the doors
      box(0.05, 0.42, 0.8, sx * (W / 2 + 0.005), sh.belt - 0.28, sh.cabRear + 0.25, carbonMat);
      box(0.05, 0.12, 0.7, sx * (W / 2 - 0.02), sh.belt + 0.03, sh.cabRear - 0.1, carbonMat);
      // bonnet vents
      box(0.3, 0.02, 0.38, sx * 0.32, hoodY(h - 0.75) + 0.02, h - 0.75, carbonMat, hoodPitch);
      // Y-shaped tail lights
      box(0.46, 0.05, 0.04, sx * (W / 2 - 0.38), sh.tail - 0.14, -h - 0.08, lampRed, 0, 0, sx * 0.3);
      box(0.22, 0.05, 0.04, sx * (W / 2 - 0.5), sh.tail - 0.24, -h - 0.08, lampRed, 0, 0, -sx * 0.6);
    }
    // black roof spine and louvred engine cover
    box(0.5, 0.02, sh.roofFront - sh.roofRear + 0.2, 0, sh.roofH + 0.045, (sh.roofFront + sh.roofRear) / 2, carbonMat);
    for (let i = 0; i < 4; i++) box(W * 0.5, 0.03, 0.08, 0, sh.tail + 0.02, sh.cabRear - 0.2 - i * 0.22, carbonMat);
    // hexagonal centre exhausts (flames on nitro)
    for (const y of [sh.tail - 0.38, sh.tail - 0.56]) {
      cyl(0.09, 0.3, 0, y, -h - 0.04, chromeMat, 6);
      const f = makeFlame(0.08, 1.1);
      f.position.set(0, y, -h - 0.2);
      ex.add(f);
      flames.push(f);
    }
  } else {
    // horseshoe grille, flanked by big intakes, over an accent-coloured splitter
    const gy = sh.gc + 0.3;
    const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.04, 20).rotateX(Math.PI / 2).scale(1, 1.15, 1), carbonMat);
    fill.position.set(0, gy, h + 0.03);
    ex.add(fill);
    const arc = Math.PI * 1.65;
    const shoe = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.035, 8, 24, arc), chromeMat);
    shoe.rotation.z = Math.PI / 2 + (Math.PI * 2 - arc) / 2;
    shoe.scale.set(1, 1.15, 1);
    shoe.position.set(0, gy, h + 0.05);
    ex.add(shoe);
    box(W * 1.02, 0.05, 0.44, 0, sh.gc + 0.04, h - 0.05, acc);
    for (const sx of [1, -1]) {
      box(0.5, 0.26, 0.06, sx * 0.62, gy - 0.02, h, carbonMat);
      // slim LED headlight bars
      box(0.5, 0.05, 0.05, sx * (W / 2 - 0.38), sh.nose - 0.06, h + 0.085, lampWhite, 0, 0, sx * 0.12);
      // the signature sweeping "C" line along each side, opening to the front
      const c = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 6, 20, Math.PI * 1.1).rotateZ(Math.PI * 1.45).rotateY(Math.PI / 2), acc);
      c.position.set(sx * (W / 2 + 0.02), sh.belt - 0.22, sh.cabRear + 0.55);
      ex.add(c);
      box(0.05, 0.3, 0.5, sx * (W / 2 + 0.005), sh.belt - 0.26, sh.cabRear + 0.55, carbonMat);
    }
    // central roof fin and twin bonnet stripes in the accent colour
    box(0.05, 0.1, 1.6, 0, sh.roofH + 0.06, sh.roofRear - 0.4, acc);
    for (const sx of [1, -1]) box(0.08, 0.02, h - sh.cabFront, sx * 0.18, hoodY((h + sh.cabFront) / 2) + 0.015, (h + sh.cabFront) / 2, acc, hoodPitch);
    // full-width LED tail bar and quad exhausts
    box(W * 0.9, 0.05, 0.04, 0, sh.tail - 0.14, -h - 0.08, lampRed);
    for (const x of [-0.27, -0.09, 0.09, 0.27]) {
      cyl(0.06, 0.25, x, sh.gc + 0.3, -h - 0.06, chromeMat);
      if (Math.abs(x) < 0.1) {
        const f = makeFlame(0.07, 1.0);
        f.position.set(x, sh.gc + 0.3, -h - 0.2);
        ex.add(f);
        flames.push(f);
      }
    }
  }
  if (spec.wing) {
    const wy = sh.tail + 0.55,
      wz = -h + 0.32;
    box(W * 1.0, 0.06, 0.5, 0, wy, wz, carbonMat, -0.1);
    for (const sx of [1, -1]) {
      box(0.04, 0.22, 0.5, sx * W * 0.48, wy + 0.04, wz, carbonMat); // end plates
      box(0.06, wy - sh.tail + 0.1, 0.14, sx * 0.45, (wy + sh.tail) / 2, wz + 0.05, carbonMat, 0.2); // struts
    }
  }
  return { extras: ex, flames };
}

function buildCar(spec: VehicleSpec) {
  const sh = spec.shape;
  const L = spec.len,
    W = spec.wid;
  const h = L / 2;
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

const driverSkin = new THREE.MeshStandardMaterial({ color: 0xc89070, roughness: 0.8 });
const driverShirt = new THREE.MeshStandardMaterial({ color: 0x3a4a6a, roughness: 0.8 });

export function buildVehicleRig(spec: VehicleSpec, color: number): VehicleRig {
  let g = cache.get(spec.id);
  if (!g) {
    g = spec.plane ? buildPlane(spec) : spec.bike ? buildBike(spec) : spec.boat ? buildBoat(spec) : buildCar(spec);
    cache.set(spec.id, g);
  }
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const paint = paintMaterial(color);
  const bodyMesh = new THREE.Mesh(g.body, paint);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  body.add(bodyMesh);
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
      const mesh = new THREE.Mesh(g.wheel, wheelMat);
      mesh.castShadow = true;
      pivot.add(mesh);
      group.add(pivot);
      wheels.push({ pivot, mesh, front, x, z });
    }
    if (spec.cls === 'truck') {
      for (const x of [sh.track, -sh.track]) {
        const m = new THREE.Mesh(g.wheel, wheelMat);
        m.position.set(x, sh.wheelR, -sh.wheelX + 1.1);
        group.add(m);
      }
    }
  }
  let sirenR: THREE.MeshBasicMaterial | undefined, sirenB: THREE.MeshBasicMaterial | undefined;
  if (spec.police) {
    sirenR = new THREE.MeshBasicMaterial({ color: 0x440000, toneMapped: false });
    sirenB = new THREE.MeshBasicMaterial({ color: 0x000044, toneMapped: false });
    const y = sh.roofH + 0.1;
    const zc = spec.cls === 'swat' ? sh.roofFront - 0.1 : (sh.roofFront + sh.roofRear) / 2;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(spec.wid * 0.4, 0.12, 0.25), sirenR);
    bar.position.set(spec.wid * 0.2, y, zc);
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(spec.wid * 0.4, 0.12, 0.25), sirenB);
    bar2.position.set(-spec.wid * 0.2, y, zc);
    body.add(bar, bar2);
    if (spec.cls === 'police') {
      // white doors
      const doors = new THREE.Mesh(new THREE.BoxGeometry(spec.wid + 0.03, 0.42, 1.9), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 }));
      doors.position.set(0, sh.belt - 0.28, -0.15);
      body.add(doors);
    }
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
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.45, 0.22), driverShirt);
  torso.position.y = 0.85;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), driverSkin);
  head.position.y = 1.22;
  driverDummy.add(torso, head);
  driverDummy.position.copy(seat);
  driverDummy.visible = false;
  body.add(driverDummy);
  let flames: THREE.Mesh[] = [];
  let extras: THREE.Group | undefined, hoverPads: THREE.MeshBasicMaterial | undefined;
  if (spec.crazy) ({ extras, flames, hoverPads } = buildCrazyExtras(spec, { body, group, wheels, paint }));
  if (spec.hyper) ({ extras, flames } = buildHyperExtras(spec, { body, wheels, paint }));
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
