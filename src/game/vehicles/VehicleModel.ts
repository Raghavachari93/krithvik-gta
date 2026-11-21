import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
function profile(points: [number, number][], width: number, bevel = 0.05) {
  const sh = new THREE.Shape();
  sh.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) sh.lineTo(points[i][0], points[i][1]);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
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

function wheelGeo(r: number, w: number, knobby = false) {
  const tire = colorize(new THREE.CylinderGeometry(r, r, w, 18).rotateZ(Math.PI / 2), 0x151515);
  const rim = colorize(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 10).rotateZ(Math.PI / 2), CHROME);
  const spokes = colorize(new THREE.BoxGeometry(w + 0.04, r * 1.1, 0.06), 0x55595e);
  const parts = [tire, rim, spokes];
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
      0.06,
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
      0.03,
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
          0.02,
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
  const body = mergeGeometries(parts)!;
  body.computeVertexNormals();
  const lx = W / 2 - 0.3;
  const headY = spec.cls === 'truck' ? 0.9 : sh.nose - 0.12;
  const head = mergeGeometries([new THREE.BoxGeometry(0.42, 0.12, 0.06).translate(lx, headY, h + 0.01), new THREE.BoxGeometry(0.42, 0.12, 0.06).translate(-lx, headY, h + 0.01)])!;
  const tailY = spec.cls === 'truck' ? 0.9 : sh.tail - 0.15;
  const tail = mergeGeometries([new THREE.BoxGeometry(0.42, 0.12, 0.06).translate(lx, tailY, -h - 0.01), new THREE.BoxGeometry(0.42, 0.12, 0.06).translate(-lx, tailY, -h - 0.01)])!;
  const ww = spec.crazy === 'monster' ? 0.78 : spec.crazy === 'rocket' ? 0.42 : spec.crazy === 'rod' ? 0.36 : spec.cls === 'truck' ? 0.38 : 0.26;
  return { body, glass, head, tail, wheel: wheelGeo(sh.wheelR, ww, spec.crazy === 'monster') };
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

const driverSkin = new THREE.MeshStandardMaterial({ color: 0xc89070, roughness: 0.8 });
const driverShirt = new THREE.MeshStandardMaterial({ color: 0x3a4a6a, roughness: 0.8 });

export function buildVehicleRig(spec: VehicleSpec, color: number): VehicleRig {
  let g = cache.get(spec.id);
  if (!g) {
    g = spec.bike ? buildBike(spec) : spec.boat ? buildBoat(spec) : buildCar(spec);
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
  if (spec.bike) seat = new THREE.Vector3(0, 0.0, -0.3);
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
  return { group, body, wheels, tailMat, headMat, sirenR, sirenB, paint, seat, driverDummy, glass: glassMesh, flames, extras, hoverPads };
}
