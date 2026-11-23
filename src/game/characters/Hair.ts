import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Natural hairstyles grown from the head shape itself: a scalp shell that hugs the skull with a real
 * hairline (forehead, temples, sideburns, around the ears, nape), extra volume on top, a side parting,
 * and per-style pieces (falling lengths, ponytail, curls). Coordinates are head-local, like the head mesh.
 */

export type HairKind = 'short' | 'long' | 'ponytail' | 'curly' | 'buzz';

const C = new THREE.Vector3(0, 0.14, 0.01); // head centre

/** Minimum height of hair at angle a around the head (0 = forehead, +-PI = nape). */
function hairline(kind: HairKind, a: number) {
  const t = Math.abs(a);
  const pts: [number, number][] =
    kind === 'long' || kind === 'ponytail'
      ? [
          [0, 0.222],
          [0.5, 0.218],
          [0.95, 0.19],
          [1.25, 0.16],
          [1.45, 0.14],
          [1.6, 0.17],
          [1.8, 0.15],
          [2.2, 0.075],
          [Math.PI, 0.05],
        ]
      : [
          [0, 0.214],
          [0.45, 0.212],
          [0.85, 0.2],
          [1.12, 0.175],
          [1.32, 0.15],
          [1.42, 0.118], // sideburn
          [1.5, 0.118],
          [1.58, 0.168], // over the ear
          [1.85, 0.168],
          [2.15, 0.095],
          [Math.PI, 0.058],
        ];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a0, y0] = pts[i],
      [a1, y1] = pts[i + 1];
    if (t <= a1) return y0 + ((y1 - y0) * (t - a0)) / (a1 - a0);
  }
  return pts[pts.length - 1][1];
}

/** Scalp shell: head sphere (same sculpt as the head), trimmed at the hairline and pushed out for volume. */
function scalp(kind: HairKind, sculpt: (g: THREE.BufferGeometry) => THREE.BufferGeometry) {
  const g = sculpt(new THREE.SphereGeometry(0.115, 64, 40).scale(0.9, 1.1, 1).translate(0, 0.14, 0.01));
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = p.count;
  const orig = new Float32Array(p.array as Float32Array);
  const keepV = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = orig[i * 3],
      y = orig[i * 3 + 1],
      z = orig[i * 3 + 2];
    const a = Math.atan2(x, z - 0.01);
    keepV[i] = y >= hairline(kind, a) ? 1 : 0;
  }
  // volume: thin at the edges, fuller toward the crown; style texture on top
  const base = kind === 'curly' ? 0.012 : kind === 'buzz' ? 0.0025 : 0.005;
  const crown = kind === 'curly' ? 0.03 : kind === 'buzz' ? 0.002 : kind === 'short' ? 0.016 : 0.012;
  const d = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const x = orig[i * 3],
      y = orig[i * 3 + 1],
      z = orig[i * 3 + 2];
    const a = Math.atan2(x, z - 0.01);
    const edge = Math.min(1, Math.max(0, (y - hairline(kind, a)) / 0.035)); // 0 at hairline -> 1 inside
    const up = Math.max(0, (y - 0.14) / 0.13);
    let off = base * (0.35 + 0.65 * edge) + crown * up * up * edge;
    if (kind === 'short') {
      // swept up and slightly forward at the front, side parting on the left
      if (Math.cos(a) > 0.3) off += 0.008 * up * Math.cos(a) * edge;
      off -= 0.004 * Math.exp(-(((a - 0.45) / 0.07) ** 2)) * up;
      // clumpy texture
      off += 0.0025 * Math.sin(a * 23 + y * 140) * Math.sin(y * 90 - a * 7) * edge;
    } else if (kind === 'long' || kind === 'ponytail') {
      off -= 0.005 * Math.exp(-(((a - 0.3) / 0.06) ** 2)) * up; // centre-ish parting
      if (kind === 'ponytail') off *= 0.75; // pulled back tight
    } else if (kind === 'curly') {
      off += 0.009 * Math.abs(Math.sin(a * 17 + y * 120) * Math.sin(y * 150 + a * 5)) * edge;
    }
    off = Math.max(off, 0.0065); // always sit just outside the face/skin shells
    d.set(x, y, z).sub(C).normalize();
    p.setXYZ(i, x + d.x * off, y + d.y * off, z + d.z * off);
  }
  // keep only triangles fully inside the hairline
  const src = g.index!;
  const idx: number[] = [];
  for (let t = 0; t < src.count; t += 3) {
    const a = src.getX(t),
      b = src.getX(t + 1),
      c = src.getX(t + 2);
    if (keepV[a] && keepV[b] && keepV[c]) idx.push(a, b, c);
  }
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** Long hair falling behind the shoulders and framing the face, with waves and a layered hem. */
function curtain() {
  const g = new THREE.CylinderGeometry(0.118, 0.13, 0.26, 40, 10, true, 1.12, Math.PI * 2 - 2.24).translate(0, 0.03, -0.006);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const a = Math.atan2(x, z);
    const down = Math.min(1, Math.max(0, (0.16 - y) / 0.26));
    // strands bunch into soft waves lower down; the sides tuck in behind the ears
    const wave = 1 + Math.sin(a * 11 + y * 46) * 0.03 * down + Math.sin(a * 29) * 0.008;
    const tuck = 1 - 0.1 * Math.max(0, Math.cos(a)) * down;
    // layered, longer at the back, shorter toward the face
    const hem = y < -0.06 ? (Math.sin(a * 15) * 0.012 + (1 - Math.abs(a) / Math.PI) * 0.05) : 0;
    p.setXYZ(i, x * wave * tuck, y + hem, z * wave);
  }
  g.computeVertexNormals();
  return g.toNonIndexed();
}

function ponytail() {
  // tapered, slightly curved tail from the crown-back, plus a hair tie
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    pts.push(new THREE.Vector3(Math.sin(t * 2.2) * 0.012, 0.2 - t * 0.27, -0.118 - Math.sin(t * Math.PI * 0.6) * 0.06));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.TubeGeometry(curve, 24, 0.04, 12, false);
  const p = tube.attributes.position as THREE.BufferAttribute;
  // taper toward the tip: shrink each ring toward the curve
  const segs = 24,
    rad = 12;
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const c = curve.getPointAt(t);
    const k = t < 0.12 ? 0.75 + t * 2 : 1 - (t - 0.12) * 0.95;
    for (let r = 0; r <= rad; r++) {
      const i = s * (rad + 1) + r;
      p.setXYZ(i, c.x + (p.getX(i) - c.x) * k, c.y + (p.getY(i) - c.y) * k, c.z + (p.getZ(i) - c.z) * k);
    }
  }
  tube.computeVertexNormals();
  const tie = new THREE.TorusGeometry(0.03, 0.008, 6, 14).rotateX(Math.PI / 2 - 0.5).translate(pts[1].x, pts[1].y, pts[1].z);
  return [tube.toNonIndexed(), tie.toNonIndexed()];
}

export function buildHair(kind: HairKind, sculpt: (g: THREE.BufferGeometry) => THREE.BufferGeometry) {
  const parts: THREE.BufferGeometry[] = [scalp(kind, sculpt)];
  if (kind === 'long') parts.push(curtain());
  if (kind === 'ponytail') parts.push(...ponytail());
  return mergeGeometries(parts.map((g) => {
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    return g;
  }))!;
}
