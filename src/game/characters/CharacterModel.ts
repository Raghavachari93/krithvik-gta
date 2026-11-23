import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, damp } from '../core/math';
import { buildHair } from './Hair';
import { BONE, JOINTS, fabricNormal, hairTexture, humanGeometry, torsoFrontZ } from './HumanMesh';

export interface CharacterLook {
  skin: number;
  shirt: number;
  pants: number;
  shoes: number;
  hair: number;
  hairStyle: number; // 0 short, 1 long, 2 bald, 3 cap, 4 spiky, 5 ponytail, 6 curly
  hat?: number;
  height: number;
  build: number;
  jacket?: number;
  /** photo face texture (path under /public) */
  faceTex?: string;
  /** tuxedo details: white shirt, satin lapels, bow tie, pocket square */
  outfit?: 'tux';
  headScale?: number;
  /** picks eye colour, brows, lips and stubble for the painted face */
  faceSeed?: number;
  /** body shape (defaults to long hair = female figure) */
  female?: boolean;
  sleeves?: 'long' | 'short';
}

export type Action = 'none' | 'punch' | 'swing' | 'block' | 'dodge' | 'interact' | 'phone' | 'handsUp' | 'aim' | 'talk' | 'cheer' | 'hit';
export type WeaponVisual = 'none' | 'bat' | 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'rocket' | 'knife' | 'katana' | 'revolver' | 'microsmg' | 'autoshotgun' | 'minigun' | 'sniper' | 'grenade' | 'flamer' | 'laser';

export interface AnimState {
  speed: number;
  grounded: boolean;
  vy: number;
  swim: boolean;
  action: Action;
  actionT: number;
  actionSide: number;
  aimPitch: number;
  knocked: number;
  driving: boolean;
  landing: number;
  twoHanded: boolean;
}

export function defaultAnim(): AnimState {
  return { speed: 0, grounded: true, vy: 0, swim: false, action: 'none', actionT: 0, actionSide: 1, aimPitch: 0, knocked: 0, driving: false, landing: 0, twoHanded: false };
}

// joint indices
const J = {
  hipsY: 0,
  bodyRX: 1,
  torsoRX: 2,
  torsoRY: 3,
  headRX: 4,
  armLX: 5,
  armLZ: 6,
  armRX: 7,
  armRZ: 8,
  foreLX: 9,
  foreRX: 10,
  legLX: 11,
  legLZ: 12,
  legRX: 13,
  legRZ: 14,
  shinLX: 15,
  shinRX: 16,
  bodyY: 17,
  headRY: 18,
};
const NJ = 19;

const matCache = new Map<number, THREE.MeshStandardMaterial>();
function mat(c: number, rough = 0.8) {
  const k = c * 10 + Math.round(rough * 9);
  let m = matCache.get(k);
  if (!m) matCache.set(k, (m = new THREE.MeshStandardMaterial({ color: c, roughness: rough })));
  return m;
}

const lum = (c: number) => (((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11) / 255;
const clothCache = new Map<string, THREE.MeshStandardMaterial>();
/** Fabric with a woven/creased normal map. */
function clothMat(c: number, rough: number) {
  const k = `${c}-${rough}`;
  let m = clothCache.get(k);
  if (!m) clothCache.set(k, (m = new THREE.MeshStandardMaterial({ color: c, roughness: rough, normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.55, 0.55) })));
  return m;
}
const skinCache = new Map<number, THREE.MeshPhysicalMaterial>();
/** Skin: soft sheen gives a hint of subsurface glow at grazing angles. */
function skinMat(c: number) {
  let m = skinCache.get(c);
  if (!m) skinCache.set(c, (m = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.52, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.9, 0.45, 0.35) })));
  return m;
}
const hairCache = new Map<number, THREE.MeshStandardMaterial>();
function hairMat(c: number) {
  let m = hairCache.get(c);
  if (!m) hairCache.set(c, (m = new THREE.MeshStandardMaterial({ color: new THREE.Color(c).multiplyScalar(1.35), map: hairTexture(), roughness: 0.55, side: THREE.DoubleSide })));
  return m;
}

function tint(geo: THREE.BufferGeometry, c: number) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const col = new THREE.Color(c);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

/** Eyes, pupils, brows and mouth merged into one vertex-coloured mesh. */
function faceGeo() {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [1, -1]) {
    const x = 0.041 * sx;
    parts.push(tint(new THREE.SphereGeometry(0.021, 10, 8).scale(1.15, 0.85, 0.6).translate(x, 0.158, 0.108), 0xf6f6f2)); // white
    parts.push(tint(new THREE.SphereGeometry(0.0115, 8, 6).scale(1, 1, 0.5).translate(x, 0.157, 0.1205), 0x2b1a0c)); // iris
    parts.push(tint(new THREE.SphereGeometry(0.004, 6, 4).translate(x + 0.004, 0.161, 0.1255), 0xffffff)); // catchlight
    parts.push(tint(new THREE.BoxGeometry(0.048, 0.011, 0.014).rotateZ(-0.12 * sx).translate(x, 0.188, 0.11), 0x1c130c)); // brow
  }
  parts.push(tint(new THREE.BoxGeometry(0.046, 0.011, 0.012).translate(0, 0.094, 0.115), 0x8e3b35)); // mouth
  parts.push(tint(new THREE.BoxGeometry(0.03, 0.006, 0.01).translate(0, 0.087, 0.113), 0xb0645a)); // lower lip
  return mergeGeometries(parts)!;
}
const faceMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 });

/** Sculpt the head sphere: narrower jaw, chin, flatter face, fuller back of the skull. */
function sculptHead(g: THREE.BufferGeometry) {
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i),
      z = p.getZ(i);
    const ny = (p.getY(i) - 0.14) / 0.127;
    const jaw = Math.min(1, Math.max(0, (-0.05 - ny) / 0.95));
    const jk = jaw * jaw * (3 - 2 * jaw);
    x *= 1 - 0.24 * jk;
    if (z < 0) z *= 1 - 0.3 * jk + (ny > 0 ? 0.06 * ny : 0);
    else z += 0.008 * jk;
    if (z > 0.07) z = 0.07 + (z - 0.07) * 0.82;
    // cheekbones
    if (z > 0.03 && ny > -0.3 && ny < 0.15) x *= 1.03;
    p.setXYZ(i, x, p.getY(i), z);
  }
  g.computeVertexNormals();
  return g;
}

/** Front-of-head shell with UVs projected straight on, so a photo maps onto the face. */
function photoFaceGeo() {
  const g = new THREE.SphereGeometry(0.1172, 28, 20, Math.PI / 2 - 1.3, 2.6, Math.PI * 0.12, Math.PI * 0.78).scale(0.92, 1.08, 1).translate(0, 0.14, 0.012);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const W = 0.205,
    top = 0.262,
    bot = 0.012;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + W / 2) / W, (pos.getY(i) - bot) / (top - bot));
  return sculptHead(g);
}
const photoMats = new Map<string, THREE.MeshStandardMaterial>();
function photoFaceMat(path: string) {
  let m = photoMats.get(path);
  if (!m) {
    const tex = new THREE.TextureLoader().load(import.meta.env.BASE_URL + path);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 });
    photoMats.set(path, m);
  }
  return m;
}

/** Painted realistic face texture (eyes, brows, nose shading, lips, stubble), mapped like the photo face. */
const paintedCache = new Map<string, THREE.MeshStandardMaterial>();
function paintedFaceMat(skin: number, hair: number, seed: number, female: boolean) {
  seed = seed % 8;
  const key = `${skin}-${hair}-${seed}-${female}`;
  let m = paintedCache.get(key);
  if (m) return m;
  // phones get half-size face textures to save memory; drawing stays in 256-px units
  const small = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = small ? 128 : 256;
  const ctx = c.getContext('2d')!;
  if (small) ctx.scale(0.5, 0.5);
  // keep canvas maths in sRGB so painted skin matches the 3D skin exactly
  const sc = (hex: number) => new THREE.Color().setRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
  const sk = sc(skin);
  const hr = sc(hair);
  const rgb = (col: THREE.Color, k = 1, a = 1) => `rgba(${Math.round(Math.min(1, col.r * k) * 255)},${Math.round(Math.min(1, col.g * k) * 255)},${Math.round(Math.min(1, col.b * k) * 255)},${a})`;
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  // map head-local (x, y) to canvas pixels (same projection as photoFaceGeo)
  const X = (x: number) => ((x + 0.1025) / 0.205) * S;
  const Y = (y: number) => (1 - (y - 0.012) / 0.25) * S;
  const lum = sk.r * 0.3 + sk.g * 0.59 + sk.b * 0.11;
  const feminine = female;
  // base skin with soft modelling: lighter cheeks/forehead, darker edges, jaw and eye sockets
  ctx.fillStyle = rgb(sk);
  ctx.fillRect(0, 0, S, S);
  const radial = (x: number, y: number, r: number, col: string) => {
    const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, S, S);
  };
  radial(S / 2, Y(0.17), 120, rgb(sk, 1.08, 0.5));
  const edge = ctx.createRadialGradient(S / 2, Y(0.14), 70, S / 2, Y(0.14), 150);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, rgb(sk, 0.72, 0.6));
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, S, S);
  for (const sx of [1, -1]) {
    radial(X(sx * 0.041), Y(0.16), 26, rgb(sk, 0.78, 0.45)); // eye socket
    radial(X(sx * 0.052), Y(0.115), 26, `rgba(200,80,70,${lum > 0.55 ? 0.16 : 0.08})`); // cheek warmth
  }
  radial(S / 2, Y(0.05), 60, rgb(sk, 0.8, 0.35)); // under jaw
  // stubble for some men
  if (!feminine && seed % 4 === 1) {
    for (let i = 0; i < 2600; i++) {
      const a = rnd() * Math.PI,
        r = 30 + rnd() * 40;
      const x = S / 2 + Math.cos(a) * r * 1.1,
        y = Y(0.095) + Math.sin(a) * r * 0.9 - 10;
      ctx.fillStyle = rgb(hr, 1, 0.18);
      ctx.fillRect(x, y, 1.2, 1.2);
    }
  }
  // nose: side shadows, nostrils, bridge highlight
  ctx.strokeStyle = rgb(sk, 0.7, 0.45);
  ctx.lineWidth = 3;
  for (const sx of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(S / 2 + sx * 7, Y(0.16));
    ctx.quadraticCurveTo(S / 2 + sx * 10, Y(0.135), S / 2 + sx * 12, Y(0.123));
    ctx.stroke();
    ctx.fillStyle = rgb(sk, 0.42, 0.8);
    ctx.beginPath();
    ctx.ellipse(S / 2 + sx * 6, Y(0.118), 3.5, 2, sx * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  radial(S / 2, Y(0.14), 9, rgb(sk, 1.15, 0.6));
  // lips
  const lip = sk.clone().lerp(sc(feminine ? 0xb8404c : 0x9a5048), feminine ? 0.45 : 0.3);
  const mx = S / 2,
    my = Y(0.094),
    mw = 26 + rnd() * 6;
  ctx.fillStyle = rgb(lip, 0.82);
  ctx.beginPath();
  ctx.moveTo(mx - mw, my);
  ctx.quadraticCurveTo(mx - mw * 0.4, my - 9, mx, my - 5);
  ctx.quadraticCurveTo(mx + mw * 0.4, my - 9, mx + mw, my);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgb(lip, 1.0);
  ctx.beginPath();
  ctx.moveTo(mx - mw * 0.9, my);
  ctx.quadraticCurveTo(mx, my + 12, mx + mw * 0.9, my);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgb(lip, 0.45, 0.9);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(mx - mw, my);
  ctx.quadraticCurveTo(mx, my + 2, mx + mw, my);
  ctx.stroke();
  // eyes
  const irisCols = [0x3b2414, 0x2a1a0e, 0x4a6a8a, 0x3e5a36, 0x5a3a1e, 0x1e1410];
  const iris = sc(irisCols[seed % irisCols.length]);
  for (const sx of [1, -1]) {
    const ex = X(sx * 0.041),
      ey = Y(0.158);
    const ew = 17,
      eh = 7.5;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ex - ew, ey);
    ctx.quadraticCurveTo(ex, ey - eh * 1.5, ex + ew, ey);
    ctx.quadraticCurveTo(ex, ey + eh * 1.2, ex - ew, ey);
    ctx.closePath();
    ctx.fillStyle = '#ece6de';
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = rgb(iris);
    ctx.beginPath();
    ctx.arc(ex, ey, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0a0806';
    ctx.beginPath();
    ctx.arc(ex, ey, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(ex + 2.5, ey - 2.5, 1.6, 0, Math.PI * 2);
    ctx.fill();
    // upper lid shadow on the eyeball
    ctx.fillStyle = 'rgba(40,20,10,0.25)';
    ctx.fillRect(ex - ew, ey - eh * 1.6, ew * 2, eh * 0.9);
    ctx.restore();
    // lid lines / lashes
    ctx.strokeStyle = 'rgba(25,15,10,0.95)';
    ctx.lineWidth = feminine ? 2.6 : 1.8;
    ctx.beginPath();
    ctx.moveTo(ex - ew - 1, ey + 0.5);
    ctx.quadraticCurveTo(ex, ey - eh * 1.55, ex + ew + 1, ey - 0.5);
    ctx.stroke();
    ctx.strokeStyle = rgb(sk, 0.6, 0.6);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(ex - ew + 2, ey + 1);
    ctx.quadraticCurveTo(ex, ey + eh * 1.25, ex + ew - 2, ey + 1);
    ctx.stroke();
    // crease above the eye
    ctx.strokeStyle = rgb(sk, 0.75, 0.5);
    ctx.beginPath();
    ctx.moveTo(ex - ew + 1, ey - 6);
    ctx.quadraticCurveTo(ex, ey - eh * 2.3, ex + ew, ey - 7);
    ctx.stroke();
    // eyebrow
    ctx.strokeStyle = rgb(hr, 0.9, 0.92);
    ctx.lineCap = 'round';
    ctx.lineWidth = feminine ? 3.2 : 5;
    ctx.beginPath();
    ctx.moveTo(ex - sx * 18, Y(0.183));
    ctx.quadraticCurveTo(ex + sx * 2, Y(0.196), ex + sx * 20, Y(0.186));
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 });
  paintedCache.set(key, m);
  return m;
}

/** Spiky boy's haircut: crown cap, back piece and a ring of tufts. */
function spikyHairGeo() {
  const parts: THREE.BufferGeometry[] = [
    new THREE.SphereGeometry(0.124, 16, 7, 0, Math.PI * 2, 0, Math.PI * 0.34),
    new THREE.SphereGeometry(0.123, 16, 8, Math.PI / 2 + 1.05, Math.PI * 2 - 2.1, 0, Math.PI * 0.56),
  ];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 34; i++) {
    const theta = 0.12 + rnd() * 0.95; // from the top down
    const phi = rnd() * Math.PI * 2;
    const front = Math.sin(phi) > 0.55; // over the forehead
    const th = front ? Math.min(theta, 0.75) : theta;
    const dir = new THREE.Vector3(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
    const len = 0.05 + rnd() * 0.05;
    const cone = new THREE.ConeGeometry(0.026 + rnd() * 0.012, len, 5);
    cone.translate(0, len / 2, 0);
    // tufts lean up and back like gelled hair, the fringe flicks forward
    const lean = dir.clone().lerp(new THREE.Vector3(0, 1, front ? 0.5 : -0.3), 0.45).normalize();
    cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), lean));
    cone.translate(dir.x * 0.112, dir.y * 0.112, dir.z * 0.112);
    parts.push(cone);
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)).map((p) => (p.deleteAttribute('uv'), p)))!.translate(0, 0.16, -0.005);
}

let G: Record<string, THREE.BufferGeometry> | null = null;
function geos() {
  if (G) return G;
  G = {
    pelvis: new THREE.CapsuleGeometry(0.1, 0.14, 6, 14).rotateZ(Math.PI / 2).scale(1, 1, 1.05).translate(0, 0.02, 0),
    chest: mergeGeometries([
      new THREE.LatheGeometry(
        [
          [0.0, 0.0],
          [0.13, 0.0],
          [0.145, 0.08],
          [0.15, 0.2],
          [0.175, 0.34],
          [0.19, 0.45],
          [0.17, 0.54],
          [0.11, 0.6],
          [0.06, 0.63],
          [0.0, 0.635],
        ].map(([r, y]) => new THREE.Vector2(r, y)),
        24,
      ).scale(1.15, 1, 0.62),
      // shoulder caps
      new THREE.SphereGeometry(0.07, 14, 10).scale(1, 0.85, 0.95).translate(0.2, 0.52, 0),
      new THREE.SphereGeometry(0.07, 14, 10).scale(1, 0.85, 0.95).translate(-0.2, 0.52, 0),
    ].map((g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; }))!,
    head: sculptHead(new THREE.SphereGeometry(0.115, 32, 24).scale(0.9, 1.1, 1).translate(0, 0.14, 0.01)),
    face: faceGeo(),
    photoFace: photoFaceGeo(),
    hairSpiky: spikyHairGeo(),
    ears: mergeGeometries([
      new THREE.SphereGeometry(0.026, 8, 6).scale(0.45, 1, 0.8).translate(0.104, 0.142, 0.0),
      new THREE.SphereGeometry(0.026, 8, 6).scale(0.45, 1, 0.8).translate(-0.104, 0.142, 0.0),
    ])!,
    faceSkin: mergeGeometries([
      new THREE.SphereGeometry(0.019, 12, 10).scale(0.75, 1.55, 1.05).rotateX(-0.3).translate(0, 0.134, 0.108), // nose
      new THREE.SphereGeometry(0.026, 8, 6).scale(0.45, 1, 0.8).translate(0.104, 0.142, 0.0), // ears
      new THREE.SphereGeometry(0.026, 8, 6).scale(0.45, 1, 0.8).translate(-0.104, 0.142, 0.0),
    ].map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => (g.deleteAttribute('uv'), g)))!,
    neck: new THREE.CylinderGeometry(0.05, 0.06, 0.12, 8).translate(0, 0.02, 0),
    // natural hair grown from the sculpted head (see Hair.ts)
    hairShort: buildHair('short', sculptHead),
    hairLong: buildHair('long', sculptHead),
    hairPony: buildHair('ponytail', sculptHead),
    hairCurly: buildHair('curly', sculptHead),
    hairBuzz: buildHair('buzz', sculptHead),
    // baseball cap: soft six-panel crown with a button, and a curved peak
    cap: mergeGeometries([
      new THREE.SphereGeometry(0.124, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(0.96, 0.82, 1.04),
      new THREE.CylinderGeometry(0.119, 0.121, 0.022, 24, 1, true).translate(0, -0.008, 0).scale(1, 1, 1.08),
      new THREE.SphereGeometry(0.012, 8, 4).scale(1, 0.5, 1).translate(0, 0.101, 0),
    ].map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => (g.deleteAttribute('uv'), g)))!.translate(0, 0.18, -0.004),
    brim: (() => {
      const sh = new THREE.Shape();
      sh.moveTo(-0.1, 0);
      sh.bezierCurveTo(-0.1, 0.07, -0.05, 0.11, 0, 0.115);
      sh.bezierCurveTo(0.05, 0.11, 0.1, 0.07, 0.1, 0);
      sh.quadraticCurveTo(0, 0.035, -0.1, 0);
      const b = new THREE.ExtrudeGeometry(sh, { depth: 0.007, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2, curveSegments: 12 });
      // bend the peak down at its sides
      const p = b.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + p.getX(i) * p.getX(i) * 2.2);
      b.computeVertexNormals();
      return b.rotateX(Math.PI / 2).rotateX(-0.12).translate(0, 0.182, 0.07);
    })(),
    upperArm: new THREE.CapsuleGeometry(0.055, 0.2, 6, 12).translate(0, -0.14, 0),
    foreArm: new THREE.CapsuleGeometry(0.045, 0.19, 6, 12).translate(0, -0.13, 0),
    hand: mergeGeometries([
      new THREE.SphereGeometry(0.046, 12, 8).scale(0.75, 1.15, 0.55).translate(0, -0.29, 0),
      new THREE.CapsuleGeometry(0.014, 0.04, 4, 6).rotateZ(0.5).translate(0.032, -0.28, 0.012), // thumb
    ].map((g) => g.toNonIndexed()))!,
    thigh: new THREE.CapsuleGeometry(0.078, 0.3, 6, 12).translate(0, -0.22, 0),
    shin: new THREE.CapsuleGeometry(0.062, 0.31, 6, 12).translate(0, -0.21, 0),
    foot: mergeGeometries([
      new THREE.CapsuleGeometry(0.045, 0.16, 6, 10).rotateX(Math.PI / 2).scale(1.05, 0.75, 1).translate(0, -0.445, 0.05),
      new THREE.BoxGeometry(0.1, 0.018, 0.25).translate(0, -0.475, 0.05), // sole
    ].map((g) => g.toNonIndexed()))!,
    // weapons
    bat: new THREE.CylinderGeometry(0.035, 0.022, 0.85, 8).rotateX(Math.PI / 2).translate(0, -0.3, 0.38),
    pistol: new THREE.BoxGeometry(0.04, 0.09, 0.2).translate(0, -0.27, 0.08),
    smg: new THREE.BoxGeometry(0.05, 0.12, 0.42).translate(0, -0.27, 0.16),
    shotgun: new THREE.BoxGeometry(0.05, 0.08, 0.85).translate(0, -0.27, 0.32),
    rifle: mergeGeometries([
      new THREE.BoxGeometry(0.05, 0.1, 0.62).translate(0, -0.27, 0.22), // body + barrel
      new THREE.BoxGeometry(0.04, 0.16, 0.06).translate(0, -0.37, 0.18).rotateX(0.0), // magazine
      new THREE.BoxGeometry(0.035, 0.035, 0.3).translate(0, -0.25, 0.66), // barrel tip
      new THREE.BoxGeometry(0.045, 0.06, 0.22).translate(0, -0.29, -0.15), // stock
    ].map((g) => g.toNonIndexed()))!,
    rocket: mergeGeometries([
      new THREE.CylinderGeometry(0.075, 0.075, 1.1, 10).rotateX(Math.PI / 2).translate(0, -0.2, 0.2).toNonIndexed(),
      new THREE.ConeGeometry(0.06, 0.16, 8).rotateX(Math.PI / 2).translate(0, -0.2, 0.83).toNonIndexed(),
      new THREE.BoxGeometry(0.04, 0.12, 0.06).translate(0, -0.3, 0.1).toNonIndexed(),
    ])!,
    knife: mergeGeometries([
      new THREE.BoxGeometry(0.03, 0.035, 0.1).translate(0, -0.29, 0.02),
      new THREE.BoxGeometry(0.008, 0.035, 0.2).translate(0, -0.29, 0.17),
    ].map((g) => g.toNonIndexed()))!,
    katana: mergeGeometries([
      new THREE.CylinderGeometry(0.018, 0.018, 0.24, 6).rotateX(Math.PI / 2).translate(0, -0.29, 0.0),
      new THREE.BoxGeometry(0.09, 0.02, 0.03).translate(0, -0.29, 0.13),
      new THREE.BoxGeometry(0.008, 0.04, 0.85).translate(0, -0.29, 0.57),
    ].map((g) => g.toNonIndexed()))!,
    revolver: mergeGeometries([
      new THREE.BoxGeometry(0.04, 0.1, 0.07).translate(0, -0.29, 0.03),
      new THREE.CylinderGeometry(0.035, 0.035, 0.07, 8).rotateX(Math.PI / 2).translate(0, -0.25, 0.1),
      new THREE.CylinderGeometry(0.016, 0.016, 0.22, 8).rotateX(Math.PI / 2).translate(0, -0.24, 0.24),
    ].map((g) => g.toNonIndexed()))!,
    microsmg: mergeGeometries([
      new THREE.BoxGeometry(0.045, 0.09, 0.26).translate(0, -0.26, 0.1),
      new THREE.BoxGeometry(0.03, 0.18, 0.04).translate(0, -0.36, 0.04),
    ].map((g) => g.toNonIndexed()))!,
    autoshotgun: mergeGeometries([
      new THREE.BoxGeometry(0.06, 0.12, 0.6).translate(0, -0.27, 0.2),
      new THREE.CylinderGeometry(0.075, 0.075, 0.06, 12).rotateX(Math.PI / 2).translate(0, -0.37, 0.18), // drum
      new THREE.CylinderGeometry(0.022, 0.022, 0.35, 8).rotateX(Math.PI / 2).translate(0, -0.24, 0.66),
    ].map((g) => g.toNonIndexed()))!,
    minigun: mergeGeometries([
      new THREE.BoxGeometry(0.14, 0.16, 0.36).translate(0, -0.3, 0.12),
      ...[0, 1, 2, 3, 4, 5].map((i) => new THREE.CylinderGeometry(0.018, 0.018, 0.75, 6).rotateX(Math.PI / 2).translate(Math.cos((i / 6) * Math.PI * 2) * 0.045, -0.3 + Math.sin((i / 6) * Math.PI * 2) * 0.045, 0.6)),
      new THREE.CylinderGeometry(0.07, 0.07, 0.04, 12).rotateX(Math.PI / 2).translate(0, -0.3, 0.9),
      new THREE.BoxGeometry(0.16, 0.2, 0.18).translate(0.12, -0.36, -0.02), // ammo box
    ].map((g) => g.toNonIndexed()))!,
    sniper: mergeGeometries([
      new THREE.BoxGeometry(0.05, 0.09, 0.7).translate(0, -0.27, 0.22),
      new THREE.CylinderGeometry(0.016, 0.016, 0.6, 8).rotateX(Math.PI / 2).translate(0, -0.25, 0.86),
      new THREE.CylinderGeometry(0.03, 0.03, 0.3, 10).rotateX(Math.PI / 2).translate(0, -0.18, 0.25), // scope
      new THREE.BoxGeometry(0.045, 0.08, 0.25).translate(0, -0.3, -0.22),
    ].map((g) => g.toNonIndexed()))!,
    grenade: mergeGeometries([
      new THREE.CylinderGeometry(0.06, 0.06, 0.45, 10).rotateX(Math.PI / 2).translate(0, -0.24, 0.35),
      new THREE.CylinderGeometry(0.085, 0.085, 0.15, 6).rotateX(Math.PI / 2).translate(0, -0.27, 0.12), // revolving drum
      new THREE.BoxGeometry(0.045, 0.08, 0.25).translate(0, -0.29, -0.12),
    ].map((g) => g.toNonIndexed()))!,
    flamer: mergeGeometries([
      new THREE.BoxGeometry(0.06, 0.08, 0.55).translate(0, -0.27, 0.25),
      new THREE.CylinderGeometry(0.03, 0.04, 0.18, 8).rotateX(Math.PI / 2).translate(0, -0.27, 0.6),
      new THREE.CylinderGeometry(0.07, 0.07, 0.3, 10).translate(0.1, -0.33, 0.1), // fuel tank
    ].map((g) => g.toNonIndexed()))!,
    laser: mergeGeometries([
      new THREE.BoxGeometry(0.07, 0.11, 0.42).translate(0, -0.27, 0.16),
      new THREE.CylinderGeometry(0.035, 0.02, 0.22, 10).rotateX(Math.PI / 2).translate(0, -0.25, 0.48),
      new THREE.TorusGeometry(0.045, 0.012, 6, 14).translate(0, -0.25, 0.36),
      new THREE.TorusGeometry(0.045, 0.012, 6, 14).translate(0, -0.25, 0.42),
    ].map((g) => g.toNonIndexed()))!,
  };
  return G;
}

const weaponMat = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.4, metalness: 0.7 });
const rocketMat = new THREE.MeshStandardMaterial({ color: 0x4a5a2a, roughness: 0.6, metalness: 0.3 });
const batMat = new THREE.MeshStandardMaterial({ color: 0x9a7448, roughness: 0.6 });
const bladeMat = new THREE.MeshStandardMaterial({ color: 0xe6ebf0, roughness: 0.18, metalness: 1 });
const flamerMat = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.45, metalness: 0.5 });
const laserMat = new THREE.MeshStandardMaterial({ color: 0xeef3f6, roughness: 0.3, metalness: 0.4, emissive: 0x39ff88, emissiveIntensity: 0.6 });
const goldMat = new THREE.MeshStandardMaterial({ color: 0xc9a23a, roughness: 0.25, metalness: 1 });
const WEAPON_MATS: Partial<Record<WeaponVisual, THREE.Material>> = { bat: batMat, rocket: rocketMat, knife: bladeMat, katana: bladeMat, flamer: flamerMat, laser: laserMat, revolver: goldMat, grenade: rocketMat };

/** Procedural humanoid with blended procedural animation. Root sits at the feet. */
export class CharacterModel {
  root = new THREE.Group();
  body = new THREE.Bone();
  hips = new THREE.Bone();
  torso = new THREE.Bone();
  head = new THREE.Bone();
  armL = new THREE.Bone();
  armR = new THREE.Bone();
  foreL = new THREE.Bone();
  foreR = new THREE.Bone();
  legL = new THREE.Bone();
  legR = new THREE.Bone();
  shinL = new THREE.Bone();
  shinR = new THREE.Bone();
  handR = new THREE.Group();
  private weaponMesh: THREE.Mesh | null = null;
  private cur = new Float32Array(NJ);
  private tgt = new Float32Array(NJ);
  phase = 0;
  private time = Math.random() * 10;
  private meshes: THREE.Mesh[] = [];
  private shadowOn = true;
  headMeshes: THREE.Object3D[] = [];

  constructor(public look: CharacterLook) {
    const g = geos();
    const female = look.female ?? (look.hairStyle === 1 || look.hairStyle === 5);
    const seed = look.faceSeed ?? Math.abs(Math.floor(look.skin * 0.37 + look.hair * 0.11 + look.shirt * 0.07));
    const sleeve = look.sleeves ?? (look.jacket !== undefined || look.outfit === 'tux' ? 'long' : seed % 3 === 0 ? 'long' : 'short');
    const skin = skinMat(look.skin),
      top = clothMat(look.jacket ?? look.shirt, look.jacket !== undefined ? 0.7 : 0.88),
      bottom = clothMat(look.pants, 0.9),
      shoes = mat(look.shoes, 0.38),
      dark = mat(0x18181a, 0.7),
      hair = hairMat(look.hair);
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = true;
      parent.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };
    // skeleton in the bind pose (all rotations zero)
    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = JOINTS.hips;
    this.hips.add(this.torso);
    this.torso.position.y = JOINTS.torso - JOINTS.hips;
    this.torso.add(this.head);
    this.head.position.y = JOINTS.head - JOINTS.torso;
    for (const [arm, fore, side] of [
      [this.armL, this.foreL, 1],
      [this.armR, this.foreR, -1],
    ] as [THREE.Bone, THREE.Bone, number][]) {
      this.torso.add(arm);
      arm.position.set(JOINTS.shoulderX * side, JOINTS.shoulderY - JOINTS.torso, 0);
      arm.add(fore);
      fore.position.y = -JOINTS.elbow;
    }
    this.foreR.add(this.handR);
    for (const [leg, shin, side] of [
      [this.legL, this.shinL, 1],
      [this.legR, this.shinR, -1],
    ] as [THREE.Bone, THREE.Bone, number][]) {
      this.hips.add(leg);
      leg.position.set(JOINTS.hipX * side, JOINTS.hipY - JOINTS.hips, 0);
      leg.add(shin);
      shin.position.y = -JOINTS.knee;
    }
    const bones: THREE.Bone[] = [];
    bones[BONE.body] = this.body;
    bones[BONE.hips] = this.hips;
    bones[BONE.torso] = this.torso;
    bones[BONE.head] = this.head;
    bones[BONE.armL] = this.armL;
    bones[BONE.foreL] = this.foreL;
    bones[BONE.armR] = this.armR;
    bones[BONE.foreR] = this.foreR;
    bones[BONE.legL] = this.legL;
    bones[BONE.shinL] = this.shinL;
    bones[BONE.legR] = this.legR;
    bones[BONE.shinR] = this.shinR;
    const bodyMesh = new THREE.SkinnedMesh(humanGeometry(female, sleeve), [skin, top, bottom, shoes, dark]);
    bodyMesh.castShadow = true;
    this.root.add(bodyMesh);
    this.root.updateMatrixWorld(true);
    bodyMesh.bind(new THREE.Skeleton(bones));
    // generous bounds so dives, knock-downs and driving poses are never culled
    bodyMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.7);
    this.meshes.push(bodyMesh);

    // head: sculpted skull, face, ears/nose, hair (sat a little lower onto the neck)
    const hg = new THREE.Group();
    hg.position.y = -0.025;
    this.head.add(hg);
    this.headMeshes.push(add(hg, g.head, skin));
    if (look.faceTex) {
      const face = new THREE.Mesh(g.photoFace, photoFaceMat(look.faceTex));
      hg.add(face);
      this.headMeshes.push(face, add(hg, g.ears, skin));
      this.head.scale.setScalar(look.headScale ?? 1);
    } else {
      const face = new THREE.Mesh(g.photoFace, paintedFaceMat(look.skin, look.hair, seed, female));
      hg.add(face);
      this.headMeshes.push(face, add(hg, g.faceSkin, skin));
    }
    if (look.hairStyle === 4) this.headMeshes.push(add(hg, g.hairSpiky, mat(look.hair, 0.6)));
    if (look.hairStyle === 0) this.headMeshes.push(add(hg, g.hairShort, hair));
    if (look.hairStyle === 1) this.headMeshes.push(add(hg, g.hairLong, hair));
    if (look.hairStyle === 5) this.headMeshes.push(add(hg, g.hairPony, hair));
    if (look.hairStyle === 6) this.headMeshes.push(add(hg, g.hairCurly, hair));
    // "bald" men mostly keep a close buzz cut; a few are properly bald
    if (look.hairStyle === 2 && seed % 3 !== 0) this.headMeshes.push(add(hg, g.hairBuzz, hair));
    if (look.hairStyle === 3) {
      this.headMeshes.push(add(hg, g.hairShort, hair));
      this.headMeshes.push(add(hg, g.cap, mat(look.hat ?? 0x223355)));
      this.headMeshes.push(add(hg, g.brim, mat(look.hat ?? 0x223355)));
    }

    // chest details sit on the torso surface (torso-local y = world - torso joint)
    const T = JOINTS.torso;
    const fz = (yw: number) => torsoFrontZ(yw, female);
    const deco = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, yw: number, dz: number, rz = 0, ry = 0, rx = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, yw - T, fz(yw) + dz);
      mesh.rotation.set(rx, ry, rz);
      this.torso.add(mesh);
      return mesh;
    };
    if (look.outfit === 'tux') {
      const white = mat(0xf4f4f6, 0.6),
        satin = new THREE.MeshStandardMaterial({ color: 0x1d2440, roughness: 0.25, metalness: 0.15 }),
        black = mat(0x0c0e18, 0.4);
      // white shirt V and collar
      deco(new THREE.BoxGeometry(0.1, 0.16, 0.012), white, 0, 1.5, 0.002, 0, 0, -0.35);
      deco(new THREE.CylinderGeometry(0.062, 0.066, 0.045, 14, 1, true), white, 0, 1.6, -fz(1.6));
      // satin shawl lapels framing the V
      for (const sx of [1, -1]) deco(new THREE.BoxGeometry(0.04, 0.24, 0.014), satin, sx * 0.068, 1.46, 0.004, sx * 0.3, sx * 0.3, -0.2);
      // bow tie
      for (const sx of [1, -1]) deco(new THREE.ConeGeometry(0.026, 0.045, 4).rotateZ((sx * Math.PI) / 2), satin, sx * 0.024, 1.585, 0.008);
      deco(new THREE.BoxGeometry(0.02, 0.022, 0.018), satin, 0, 1.585, 0.01);
      // buttons + pocket square
      for (let i = 0; i < 3; i++) deco(new THREE.SphereGeometry(0.008, 6, 4), black, 0.0, 1.4 - i * 0.07, 0.002);
      deco(new THREE.BoxGeometry(0.045, 0.02, 0.01), white, -0.1, 1.44, 0.0, 0, -0.35);
    } else if (look.jacket !== undefined) {
      // shirt showing in the open jacket front
      deco(new THREE.BoxGeometry(0.11, 0.2, 0.01), clothMat(look.shirt, 0.85), 0, 1.47, 0.002, 0, 0, -0.25);
      for (const sx of [1, -1]) deco(new THREE.BoxGeometry(0.035, 0.26, 0.016), top, sx * 0.07, 1.44, 0.006, sx * 0.28, sx * 0.3, -0.2);
    } else {
      // crew-neck collar
      deco(new THREE.TorusGeometry(0.058, 0.009, 6, 18).rotateX(Math.PI / 2), top, 0, 1.6, -fz(1.6));
    }
    this.root.scale.set(look.build, look.height, look.build);
  }

  /** lean back and sink into the seat so the head clears a roof `room` metres above the seat */
  private recline = 0;
  private sink = 0;
  fitToCabin(room: number) {
    const k = this.look.height,
      torsoLen = (0.9 + 0.12 * ((this.look.headScale ?? 1) - 1)) * k;
    const need = 0.59 * k + torsoLen - (room - 0.05);
    this.recline = 0;
    this.sink = 0;
    if (need <= 0) return;
    this.recline = Math.min(0.55, Math.acos(Math.max(0, Math.min(1, (torsoLen - need * 0.6) / torsoLen))));
    const left = 0.59 * k + torsoLen * Math.cos(this.recline) - (room - 0.05);
    this.sink = Math.min(0.32, Math.max(0, left));
  }

  setWeapon(w: WeaponVisual) {
    if (this.weaponMesh) {
      this.foreR.remove(this.weaponMesh);
      this.weaponMesh = null;
    }
    if (w === 'none') return;
    const g = geos();
    this.weaponMesh = new THREE.Mesh(g[w], WEAPON_MATS[w] ?? weaponMat);
    this.weaponMesh.castShadow = true;
    this.foreR.add(this.weaponMesh);
  }

  setShadows(on: boolean) {
    if (on === this.shadowOn) return;
    this.shadowOn = on;
    for (const m of this.meshes) m.castShadow = on;
  }

  setHeadVisible(v: boolean) {
    for (const m of this.headMeshes) m.visible = v;
  }

  update(dt: number, s: AnimState) {
    this.time += dt;
    const t = this.tgt;
    t.fill(0);
    const sp = s.speed;
    let rate = 14;

    if (s.driving) {
      t[J.hipsY] = -0.42 - this.sink;
      t[J.bodyRX] = -this.recline;
      t[J.headRX] = this.recline * 0.75;
      t[J.legLX] = -1.45;
      t[J.legRX] = -1.45;
      t[J.shinLX] = 1.35;
      t[J.shinRX] = 1.35;
      t[J.armLX] = -0.95;
      t[J.armRX] = -0.95;
      t[J.armLZ] = -0.15;
      t[J.armRZ] = 0.15;
      t[J.foreLX] = -0.5;
      t[J.foreRX] = -0.5;
      t[J.torsoRX] = -0.1;
    } else if (s.swim) {
      const strokeRate = 1.4 + sp * 0.5;
      this.phase += dt * strokeRate * Math.PI;
      const p = this.phase;
      if (sp > 0.6) {
        t[J.bodyRX] = 1.3;
        t[J.bodyY] = -0.5;
        t[J.armLX] = -(p % (Math.PI * 2));
        t[J.armRX] = -((p + Math.PI) % (Math.PI * 2));
        t[J.foreLX] = -0.3;
        t[J.foreRX] = -0.3;
        t[J.legLX] = Math.sin(p * 3) * 0.35;
        t[J.legRX] = -Math.sin(p * 3) * 0.35;
        t[J.headRX] = -0.9;
        rate = 30;
      } else {
        t[J.bodyRX] = 0.25;
        t[J.bodyY] = -1.5;
        t[J.armLZ] = 0.9 + Math.sin(p) * 0.5;
        t[J.armRZ] = -0.9 - Math.sin(p) * 0.5;
        t[J.armLX] = -0.6;
        t[J.armRX] = -0.6;
        t[J.legLX] = Math.sin(p * 1.3) * 0.4;
        t[J.legRX] = -Math.sin(p * 1.3) * 0.4;
        t[J.shinLX] = 0.4;
        t[J.shinRX] = 0.4;
      }
    } else if (!s.grounded) {
      if (s.vy > -3) {
        // jump
        t[J.legLX] = -0.75;
        t[J.shinLX] = 1.1;
        t[J.legRX] = 0.25;
        t[J.shinRX] = 0.6;
        t[J.armLX] = 0.4;
        t[J.armRX] = -1.3;
        t[J.armLZ] = 0.3;
        t[J.armRZ] = -0.3;
        t[J.torsoRX] = 0.15;
      } else {
        // falling: flail
        const f = Math.sin(this.time * 12);
        t[J.armLZ] = 1.6 + f * 0.3;
        t[J.armRZ] = -1.6 + f * 0.3;
        t[J.armLX] = -0.4;
        t[J.armRX] = -0.4;
        t[J.legLX] = -0.4 + f * 0.25;
        t[J.legRX] = 0.1 - f * 0.25;
        t[J.shinLX] = 0.7;
        t[J.shinRX] = 0.5;
        t[J.torsoRX] = -0.15;
      }
    } else {
      if (sp > 0.15) {
        const stride = 1.15 + sp * 0.17;
        this.phase += ((Math.PI * 2 * sp) / (stride * 2)) * dt * 2;
        const p = this.phase;
        const A = Math.min(1.0, 0.25 + sp * 0.085);
        const run = clamp((sp - 2.5) / 3, 0, 1);
        t[J.legLX] = -Math.sin(p) * A;
        t[J.legRX] = Math.sin(p) * A;
        t[J.shinLX] = 0.1 + Math.max(0, Math.cos(p)) * A * (1.0 + run * 0.9);
        t[J.shinRX] = 0.1 + Math.max(0, -Math.cos(p)) * A * (1.0 + run * 0.9);
        t[J.armLX] = Math.sin(p) * A * 0.85;
        t[J.armRX] = -Math.sin(p) * A * 0.85;
        t[J.foreLX] = -0.25 - run * 1.1;
        t[J.foreRX] = -0.25 - run * 1.1;
        t[J.armLZ] = 0.08;
        t[J.armRZ] = -0.08;
        t[J.torsoRX] = 0.04 + run * 0.22;
        t[J.torsoRY] = Math.sin(p) * 0.12 * A;
        t[J.hipsY] = -Math.abs(Math.cos(p)) * 0.05 * A + 0.02 * A;
        rate = 18;
      } else {
        const b = Math.sin(this.time * 1.8);
        t[J.torsoRX] = b * 0.015;
        t[J.armLZ] = 0.1 + b * 0.02;
        t[J.armRZ] = -0.1 - b * 0.02;
        t[J.foreLX] = -0.12;
        t[J.foreRX] = -0.12;
        t[J.headRY] = Math.sin(this.time * 0.4) * 0.25;
      }
      if (s.landing > 0) {
        const l = s.landing;
        t[J.hipsY] -= 0.22 * l;
        t[J.legLX] -= 0.7 * l;
        t[J.legRX] -= 0.7 * l;
        t[J.shinLX] += 1.2 * l;
        t[J.shinRX] += 1.2 * l;
        t[J.torsoRX] += 0.35 * l;
        rate = 25;
      }
    }

    // upper-body actions (layered)
    const a = s.action,
      at = s.actionT;
    if (a === 'punch') {
      const k = at < 0.1 ? at / 0.1 : Math.max(0, 1 - (at - 0.1) / 0.25);
      const side = s.actionSide;
      if (side > 0) {
        t[J.armRX] = -1.55 * k - 0.6 * (1 - k);
        t[J.foreRX] = -1.6 * (1 - k) - 0.05;
        t[J.armLX] = -0.9;
        t[J.foreLX] = -1.9;
        t[J.torsoRY] = 0.45 * k;
      } else {
        t[J.armLX] = -1.55 * k - 0.6 * (1 - k);
        t[J.foreLX] = -1.6 * (1 - k) - 0.05;
        t[J.armRX] = -0.9;
        t[J.foreRX] = -1.9;
        t[J.torsoRY] = -0.45 * k;
      }
      rate = 40;
    } else if (a === 'swing') {
      const k = Math.min(1, at / 0.32);
      t[J.armRX] = -2.6 + k * 2.2;
      t[J.armRZ] = 0.3;
      t[J.foreRX] = -0.5;
      t[J.armLX] = -2.4 + k * 2.0;
      t[J.foreLX] = -0.6;
      t[J.torsoRY] = -0.6 + k * 1.2;
      rate = 30;
    } else if (a === 'block') {
      t[J.armLX] = -1.25;
      t[J.armRX] = -1.25;
      t[J.armLZ] = -0.35;
      t[J.armRZ] = 0.35;
      t[J.foreLX] = -2.0;
      t[J.foreRX] = -2.0;
      t[J.torsoRX] += 0.15;
      rate = 30;
    } else if (a === 'dodge') {
      const k = Math.min(1, at / 0.55);
      t[J.bodyRX] = k * Math.PI * 2;
      t[J.hipsY] = -0.4 * Math.sin(k * Math.PI);
      t[J.legLX] = -1.6;
      t[J.legRX] = -1.6;
      t[J.shinLX] = 2.0;
      t[J.shinRX] = 2.0;
      t[J.armLX] = -1.2;
      t[J.armRX] = -1.2;
      rate = 60;
    } else if (a === 'interact') {
      t[J.armRX] = -1.2;
      t[J.foreRX] = -0.3;
      t[J.torsoRX] = 0.2;
    } else if (a === 'phone') {
      t[J.armRX] = -0.4;
      t[J.armRZ] = -0.5;
      t[J.foreRX] = -2.5;
      t[J.headRX] = 0.1;
    } else if (a === 'handsUp') {
      t[J.armLX] = -2.9;
      t[J.armRX] = -2.9;
      t[J.armLZ] = 0.2;
      t[J.armRZ] = -0.2;
      t[J.foreLX] = -0.5;
      t[J.foreRX] = -0.5;
    } else if (a === 'aim') {
      t[J.armRX] = -Math.PI / 2 - s.aimPitch;
      t[J.armRZ] = 0.1;
      t[J.foreRX] = 0;
      if (s.twoHanded) {
        t[J.armLX] = -Math.PI / 2 - s.aimPitch + 0.15;
        t[J.armLZ] = -0.55;
        t[J.foreLX] = -0.5;
      } else {
        t[J.armLX] = -1.3 - s.aimPitch;
        t[J.armLZ] = -0.5;
        t[J.foreLX] = -0.4;
      }
      t[J.headRX] = -s.aimPitch * 0.6;
      t[J.torsoRY] = 0;
      rate = 30;
    } else if (a === 'talk') {
      const g = Math.sin(this.time * 3.1);
      t[J.armRX] = -0.5 + g * 0.3;
      t[J.foreRX] = -1.2 + Math.sin(this.time * 4.3) * 0.3;
      t[J.armLX] = -0.2;
      t[J.foreLX] = -0.6;
      t[J.headRY] = Math.sin(this.time * 0.9) * 0.2;
    } else if (a === 'cheer') {
      t[J.armLX] = -2.8 + Math.sin(this.time * 8) * 0.2;
      t[J.armRX] = -2.8 - Math.sin(this.time * 8) * 0.2;
      t[J.hipsY] += Math.abs(Math.sin(this.time * 8)) * 0.06;
    } else if (a === 'hit') {
      t[J.torsoRX] -= 0.45 * Math.max(0, 1 - at / 0.3);
      t[J.headRX] -= 0.4 * Math.max(0, 1 - at / 0.3);
      rate = 40;
    }

    // knock-down overrides
    if (s.knocked > 0) {
      const k = s.knocked;
      t[J.armLZ] = t[J.armLZ] * (1 - k) + 1.3 * k;
      t[J.armRZ] = t[J.armRZ] * (1 - k) - 1.3 * k;
      t[J.legLZ] = 0.15 * k;
      t[J.legRZ] = -0.15 * k;
      t[J.shinLX] = 0.3 * k;
      t[J.legLX] = -0.3 * k;
    }

    const c = this.cur;
    for (let i = 0; i < NJ; i++) {
      if (i === J.bodyRX && (a === 'dodge' || (s.swim && sp > 0.6))) c[i] = damp(c[i], t[i], 60, dt);
      else if ((i === J.armLX || i === J.armRX) && s.swim && sp > 0.6) c[i] = t[i];
      else c[i] = damp(c[i], t[i], rate, dt);
    }
    if (a !== 'dodge' && Math.abs(c[J.bodyRX]) > Math.PI * 1.5 && !s.swim) c[J.bodyRX] = 0;

    this.hips.position.y = 0.95 + c[J.hipsY];
    this.body.rotation.x = c[J.bodyRX] - (Math.PI / 2) * s.knocked;
    this.body.position.y = c[J.bodyY] + (s.knocked > 0 ? 0.12 * s.knocked : 0) + (a === 'dodge' ? 0.45 * Math.sin(Math.min(1, at / 0.55) * Math.PI) : 0);
    this.torso.rotation.x = c[J.torsoRX];
    this.torso.rotation.y = c[J.torsoRY];
    this.head.rotation.x = c[J.headRX];
    this.head.rotation.y = c[J.headRY];
    this.armL.rotation.x = c[J.armLX];
    this.armL.rotation.z = c[J.armLZ];
    this.armR.rotation.x = c[J.armRX];
    this.armR.rotation.z = c[J.armRZ];
    this.foreL.rotation.x = c[J.foreLX];
    this.foreR.rotation.x = c[J.foreRX];
    this.legL.rotation.x = c[J.legLX];
    this.legL.rotation.z = c[J.legLZ];
    this.legR.rotation.x = c[J.legRX];
    this.legR.rotation.z = c[J.legRZ];
    this.shinL.rotation.x = c[J.shinLX];
    this.shinR.rotation.x = c[J.shinRX];
  }

  dispose() {
    this.root.removeFromParent();
  }
}

const SKINS = [0xe8c4a6, 0xd9a983, 0xc08860, 0x9a6a46, 0x74503a, 0x543a2a, 0xf0d2bc, 0xc99a74];
const HAIRS = [0x1a1410, 0x3a2516, 0x6b4a2a, 0xa8834a, 0xd8c08a, 0x2a2a2a, 0x8a3a20];
const SHIRTS = [0xe6e4de, 0x2c3e5c, 0x7a2e2e, 0x3d5a46, 0xc9a85a, 0x4a4a52, 0x1c1c1e, 0x6f8aa0, 0xb89a86, 0x8a5a3a, 0x9aa3ab, 0xd9cdb5, 0x5a4a6a, 0xa8b8a0];
const PANTS = [0x2f3f5c, 0x34496a, 0x1c1c1e, 0x4a4a4e, 0x8a7a5a, 0x5a4232, 0x4a5240, 0xb8b0a0];
const SHOES = [0x161616, 0xe8e8e6, 0x4a3220, 0x2a2a32, 0x6a5a48];

export function randomLook(gang = false): CharacterLook {
  const r = (a: number[]) => a[Math.floor(Math.random() * a.length)];
  const female = !gang && Math.random() < 0.45;
  const q = Math.random();
  const style = female ? (q < 0.62 ? 1 : 5) : q < 0.15 ? 3 : q < 0.3 ? 6 : q < 0.4 ? 2 : 0;
  return {
    skin: r(SKINS),
    shirt: gang ? r([0x3a2a4a, 0x2a2030, 0x1a1a1a]) : r(SHIRTS),
    pants: r(PANTS),
    shoes: r(SHOES),
    hair: r(HAIRS),
    hairStyle: gang ? 3 : style,
    female,
    hat: gang ? 0x3a2a4a : r([0x263046, 0x6a2a2a, 0x1a1a1a, 0xd8d6d0]),
    faceSeed: Math.floor(Math.random() * 1000),
    height: 0.92 + Math.random() * 0.16,
    build: 0.9 + Math.random() * 0.22,
    jacket: gang ? 0x241a2e : Math.random() < 0.15 ? r([0x2a2a2a, 0x5a3a20, 0x2a3a5a]) : undefined,
  };
}

export function policeLook(swat = false): CharacterLook {
  return {
    skin: SKINS[Math.floor(Math.random() * SKINS.length)],
    shirt: swat ? 0x1e232b : 0x1f3a6e,
    pants: swat ? 0x1a1d22 : 0x14223e,
    shoes: 0x0c0c0c,
    hair: 0x1a1410,
    hairStyle: 3,
    hat: swat ? 0x15181c : 0x14223e,
    height: 1.0 + Math.random() * 0.06,
    build: swat ? 1.15 : 1.05,
    jacket: swat ? 0x2a2f38 : undefined,
  };
}
