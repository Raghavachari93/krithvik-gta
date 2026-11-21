import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, damp } from '../core/math';

export interface CharacterLook {
  skin: number;
  shirt: number;
  pants: number;
  shoes: number;
  hair: number;
  hairStyle: number; // 0 short, 1 long, 2 bald, 3 cap, 4 spiky
  hat?: number;
  height: number;
  build: number;
  jacket?: number;
  /** photo face texture (path under /public) */
  faceTex?: string;
  /** tuxedo details: white shirt, satin lapels, bow tie, pocket square */
  outfit?: 'tux';
  headScale?: number;
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

/** Front-of-head shell with UVs projected straight on, so a photo maps onto the face. */
function photoFaceGeo() {
  const g = new THREE.SphereGeometry(0.1172, 28, 20, Math.PI / 2 - 1.3, 2.6, Math.PI * 0.12, Math.PI * 0.78).scale(0.92, 1.08, 1).translate(0, 0.14, 0.012);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const W = 0.205,
    top = 0.262,
    bot = 0.012;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + W / 2) / W, (pos.getY(i) - bot) / (top - bot));
  return g;
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
    pelvis: new THREE.BoxGeometry(0.34, 0.18, 0.21).translate(0, 0.02, 0),
    chest: new THREE.CapsuleGeometry(0.17, 0.3, 4, 10).scale(1.15, 1, 0.7).translate(0, 0.32, 0),
    head: new THREE.SphereGeometry(0.115, 14, 10).scale(0.92, 1.08, 1).translate(0, 0.14, 0.01),
    face: faceGeo(),
    photoFace: photoFaceGeo(),
    hairSpiky: spikyHairGeo(),
    ears: mergeGeometries([
      new THREE.SphereGeometry(0.026, 8, 6).scale(0.45, 1, 0.8).translate(0.104, 0.142, 0.0),
      new THREE.SphereGeometry(0.026, 8, 6).scale(0.45, 1, 0.8).translate(-0.104, 0.142, 0.0),
    ])!,
    faceSkin: mergeGeometries([
      new THREE.BoxGeometry(0.024, 0.045, 0.034).rotateX(-0.2).translate(0, 0.132, 0.122), // nose
      new THREE.SphereGeometry(0.026, 8, 6).scale(0.45, 1, 0.8).translate(0.104, 0.142, 0.0), // ears
      new THREE.SphereGeometry(0.026, 8, 6).scale(0.45, 1, 0.8).translate(-0.104, 0.142, 0.0),
    ].map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => (g.deleteAttribute('uv'), g)))!,
    neck: new THREE.CylinderGeometry(0.05, 0.06, 0.12, 8).translate(0, 0.02, 0),
    // hair: a crown cap plus a back/side piece that leaves the face open
    hairShort: mergeGeometries([
      new THREE.SphereGeometry(0.122, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.3),
      new THREE.SphereGeometry(0.122, 14, 8, Math.PI / 2 + 1.0, Math.PI * 2 - 2.0, 0, Math.PI * 0.55),
    ])!.translate(0, 0.16, -0.005),
    hairLong: mergeGeometries([
      new THREE.SphereGeometry(0.128, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.3),
      new THREE.SphereGeometry(0.128, 14, 10, Math.PI / 2 + 0.85, Math.PI * 2 - 1.7, 0, Math.PI * 0.78),
    ])!.scale(1, 1.15, 1).translate(0, 0.13, -0.02),
    cap: new THREE.CylinderGeometry(0.125, 0.125, 0.08, 12).translate(0, 0.22, 0),
    brim: new THREE.BoxGeometry(0.2, 0.02, 0.12).translate(0, 0.19, 0.12),
    upperArm: new THREE.CapsuleGeometry(0.055, 0.2, 4, 8).translate(0, -0.14, 0),
    foreArm: new THREE.CapsuleGeometry(0.047, 0.19, 4, 8).translate(0, -0.13, 0),
    hand: new THREE.SphereGeometry(0.052, 8, 6).scale(0.8, 1.1, 0.7).translate(0, -0.29, 0),
    thigh: new THREE.CapsuleGeometry(0.08, 0.3, 4, 8).translate(0, -0.22, 0),
    shin: new THREE.CapsuleGeometry(0.065, 0.31, 4, 8).translate(0, -0.21, 0),
    foot: new THREE.BoxGeometry(0.1, 0.07, 0.24).translate(0, -0.44, 0.05),
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
  body = new THREE.Group();
  hips = new THREE.Group();
  torso = new THREE.Group();
  head = new THREE.Group();
  armL = new THREE.Group();
  armR = new THREE.Group();
  foreL = new THREE.Group();
  foreR = new THREE.Group();
  legL = new THREE.Group();
  legR = new THREE.Group();
  shinL = new THREE.Group();
  shinR = new THREE.Group();
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
    const skin = mat(look.skin, 0.7),
      shirt = mat(look.shirt),
      pants = mat(look.pants),
      shoes = mat(look.shoes, 0.5),
      hair = mat(look.hair, 0.9);
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = true;
      parent.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };
    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = 0.95;
    add(this.hips, g.pelvis, pants);
    this.hips.add(this.torso);
    this.torso.position.y = 0.06;
    add(this.torso, g.chest, look.jacket !== undefined ? mat(look.jacket) : shirt);
    this.torso.add(this.head);
    this.head.position.y = 0.6;
    add(this.head, g.neck, skin);
    this.headMeshes.push(add(this.head, g.head, skin));
    if (look.faceTex) {
      const face = new THREE.Mesh(g.photoFace, photoFaceMat(look.faceTex));
      this.head.add(face);
      this.headMeshes.push(face, add(this.head, g.ears, skin));
      this.head.scale.setScalar(look.headScale ?? 1);
    } else {
      const face = new THREE.Mesh(g.face, faceMat);
      this.head.add(face);
      this.headMeshes.push(face, add(this.head, g.faceSkin, skin));
    }
    if (look.hairStyle === 4) this.headMeshes.push(add(this.head, g.hairSpiky, hair));
    if (look.outfit === 'tux') {
      const white = mat(0xf4f4f6, 0.6),
        satin = new THREE.MeshStandardMaterial({ color: 0x1d2440, roughness: 0.25, metalness: 0.15 }),
        dark = mat(0x0c0e18, 0.4);
      const deco = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rz = 0, ry = 0) => {
        const mesh = new THREE.Mesh(geo, m);
        mesh.position.set(x, y, z);
        mesh.rotation.set(0, ry, rz);
        this.torso.add(mesh);
        return mesh;
      };
      // white shirt V and collar
      deco(new THREE.BoxGeometry(0.11, 0.17, 0.02), white, 0, 0.53, 0.118);
      deco(new THREE.CylinderGeometry(0.068, 0.072, 0.05, 12, 1, true), white, 0, 0.6, 0.0);
      // satin shawl lapels framing the V
      for (const sx of [1, -1]) deco(new THREE.BoxGeometry(0.045, 0.26, 0.022), satin, sx * 0.075, 0.46, 0.121, sx * 0.32, sx * 0.25);
      // bow tie
      for (const sx of [1, -1]) deco(new THREE.ConeGeometry(0.03, 0.05, 4).rotateZ((sx * Math.PI) / 2), satin, sx * 0.026, 0.595, 0.128);
      deco(new THREE.BoxGeometry(0.022, 0.024, 0.02), satin, 0, 0.595, 0.13);
      // waistcoat buttons + pocket square
      for (let i = 0; i < 3; i++) deco(new THREE.SphereGeometry(0.009, 6, 4), dark, 0.0, 0.42 - i * 0.07, 0.123);
      deco(new THREE.BoxGeometry(0.045, 0.02, 0.012), satin, -0.11, 0.49, 0.112);
    }
    if (look.hairStyle === 0) this.headMeshes.push(add(this.head, g.hairShort, hair));
    if (look.hairStyle === 1) this.headMeshes.push(add(this.head, g.hairLong, hair));
    if (look.hairStyle === 3) {
      this.headMeshes.push(add(this.head, g.cap, mat(look.hat ?? 0x223355)));
      this.headMeshes.push(add(this.head, g.brim, mat(look.hat ?? 0x223355)));
    }
    for (const [arm, fore, side] of [
      [this.armL, this.foreL, 1],
      [this.armR, this.foreR, -1],
    ] as [THREE.Group, THREE.Group, number][]) {
      this.torso.add(arm);
      arm.position.set(0.235 * side, 0.52, 0);
      add(arm, g.upperArm, look.jacket !== undefined ? mat(look.jacket) : shirt);
      arm.add(fore);
      fore.position.y = -0.29;
      add(fore, g.foreArm, look.outfit === 'tux' && look.jacket !== undefined ? mat(look.jacket) : skin);
      add(fore, g.hand, skin);
    }
    this.foreR.add(this.handR);
    for (const [leg, shin, side] of [
      [this.legL, this.shinL, 1],
      [this.legR, this.shinR, -1],
    ] as [THREE.Group, THREE.Group, number][]) {
      this.hips.add(leg);
      leg.position.set(0.1 * side, -0.02, 0);
      add(leg, g.thigh, pants);
      leg.add(shin);
      shin.position.y = -0.45;
      add(shin, g.shin, pants);
      add(shin, g.foot, shoes);
    }
    this.root.scale.set(look.build, look.height, look.build);
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
      t[J.hipsY] = -0.42;
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

const SKINS = [0xf1d3b8, 0xe0b48f, 0xc68e64, 0x9c6a44, 0x6e4a2e, 0x4a3020, 0xf6dcc8];
const HAIRS = [0x1a1410, 0x3a2516, 0x6b4a2a, 0xa8834a, 0xd8c08a, 0x2a2a2a, 0x8a3a20];
const SHIRTS = [0xe8e8e8, 0x2b4a8a, 0xb83a3a, 0x3a8a5a, 0xf2c230, 0x8a3ab8, 0x1a1a1a, 0x58b8d8, 0xf28ab0, 0xe86a2a, 0x6a7a8a, 0xf5e6c8];
const PANTS = [0x2a3a5a, 0x1c1c1e, 0x4a4a4e, 0x8a7a5a, 0x5a3a2a, 0x3a4a3a, 0xc8c0b0];
const SHOES = [0x111111, 0xf0f0f0, 0x5a3a20, 0x2a2a3a];

export function randomLook(gang = false): CharacterLook {
  const r = (a: number[]) => a[Math.floor(Math.random() * a.length)];
  const style = Math.random() < 0.15 ? 3 : Math.random() < 0.3 ? 1 : Math.random() < 0.12 ? 2 : 0;
  return {
    skin: r(SKINS),
    shirt: gang ? r([0x5a1a7a, 0x3a0a4a, 0x1a1a1a]) : r(SHIRTS),
    pants: r(PANTS),
    shoes: r(SHOES),
    hair: r(HAIRS),
    hairStyle: gang ? 3 : style,
    hat: gang ? 0x7a1ab8 : r([0x223355, 0xb83a3a, 0x1a1a1a, 0xf2f2f2]),
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
