import * as THREE from 'three';

/**
 * Builds one continuous, skinned human body (torso, arms, hands, legs, shoes) from lofted
 * cross-sections, so joints bend smoothly instead of showing separate capsules.
 * Coordinates are the bind pose in character-root space: feet at y=0, facing +Z, left = +X.
 */

export const BONE = { body: 0, hips: 1, torso: 2, head: 3, armL: 4, foreL: 5, armR: 6, foreR: 7, legL: 8, shinL: 9, legR: 10, shinR: 11 } as const;
/** material groups */
export const MG = { skin: 0, top: 1, bottom: 2, shoes: 3, dark: 4 } as const;
const NG = 5;

/** bind-pose joint positions (world/root space) */
export const JOINTS = {
  hips: 0.95,
  torso: 1.01,
  head: 1.61,
  shoulderX: 0.222,
  shoulderY: 1.53,
  elbow: 0.29,
  hipX: 0.1,
  hipY: 0.93,
  knee: 0.45,
};

/** [y, half-width, front depth, back depth, centre z offset] */
type Ring = [number, number, number, number, number?];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

class Builder {
  pos: number[] = [];
  uv: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[][] = Array.from({ length: NG }, () => []);

  vert(x: number, y: number, z: number, u: number, v: number, b0: number, b1: number, w1: number) {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    this.si.push(b0, b1, 0, 0);
    this.sw.push(1 - w1, w1, 0, 0);
    return this.pos.length / 3 - 1;
  }

  /**
   * Loft closed elliptical rings along local +Y. `rotX` turns the loft (e.g. +PI/2 lays it along +Z
   * for shoes, mapping ring "front" to down). Weights and groups are evaluated per ring height.
   */
  loft(
    ringsIn: Ring[],
    o: {
      at: [number, number, number];
      seg: number;
      weight: (ly: number) => [number, number, number];
      group: (ly: number, th: number) => number;
      pow?: number;
      rotX?: number;
      capTop?: boolean;
      capBottom?: boolean;
      vScale?: number;
    },
  ) {
    const rings = [...ringsIn].sort((a, b) => a[0] - b[0]);
    const seg = o.seg;
    const p = o.pow ?? 2;
    const cr = Math.cos(o.rotX ?? 0),
      sr = Math.sin(o.rotX ?? 0);
    const place = (x: number, y: number, z: number, u: number, v: number, w: [number, number, number]) => {
      const yy = y * cr - z * sr,
        zz = y * sr + z * cr;
      return this.vert(o.at[0] + x, o.at[1] + yy, o.at[2] + zz, u, v, w[0], w[1], w[2]);
    };
    const se = (c: number) => Math.sign(c) * Math.pow(Math.abs(c), 2 / p);
    const base: number[] = [];
    for (const [y, rx, zf, zb, cz = 0] of rings) {
      const w = o.weight(y);
      base.push(this.pos.length / 3);
      for (let j = 0; j < seg; j++) {
        const th = (j / seg) * Math.PI * 2;
        const c = Math.cos(th),
          s = Math.sin(th);
        const x = rx * se(s);
        const z = cz + (c >= 0 ? zf : zb) * se(c);
        place(x, y, z, 1 - Math.abs(th / Math.PI - 1), y * (o.vScale ?? 4), w);
      }
    }
    for (let i = 0; i < rings.length - 1; i++) {
      const ym = (rings[i][0] + rings[i + 1][0]) / 2;
      for (let j = 0; j < seg; j++) {
        const j2 = (j + 1) % seg;
        const a = base[i] + j,
          b = base[i] + j2,
          c = base[i + 1] + j2,
          d = base[i + 1] + j;
        const g = o.group(ym, ((j + 0.5) / seg) * Math.PI * 2);
        this.idx[g].push(a, b, c, a, c, d);
      }
    }
    const cap = (ri: number, top: boolean) => {
      const [y, , , , cz = 0] = rings[ri];
      const ctr = place(0, y + (top ? 0.004 : -0.004), cz, 0.5, y * (o.vScale ?? 4), o.weight(y));
      for (let j = 0; j < seg; j++) {
        const a = base[ri] + j,
          b = base[ri] + ((j + 1) % seg);
        const g = o.group(y, ((j + 0.5) / seg) * Math.PI * 2);
        if (top) this.idx[g].push(ctr, a, b);
        else this.idx[g].push(ctr, b, a);
      }
    };
    if (o.capTop) cap(rings.length - 1, true);
    if (o.capBottom) cap(0, false);
  }

  /** Append a three.js geometry, rigidly skinned to one bone. */
  add(geo: THREE.BufferGeometry, group: number, bone: number, m?: THREE.Matrix4) {
    const g = geo;
    if (m) g.applyMatrix4(m);
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    const off = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) this.vert(p.getX(i), p.getY(i), p.getZ(i), uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, bone, bone, 0);
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx[group].push(off + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx[group].push(off + i);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    const all: number[] = [];
    for (let k = 0; k < NG; k++) {
      g.addGroup(all.length, this.idx[k].length, k);
      for (const i of this.idx[k]) all.push(i);
    }
    g.setIndex(all);
    g.computeVertexNormals();
    return g;
  }
}

function torsoRings(female: boolean): Ring[] {
  if (female)
    return [
      [0.8, 0.05, 0.04, 0.05],
      [0.85, 0.15, 0.09, 0.11],
      [0.9, 0.185, 0.1, 0.13],
      [0.97, 0.185, 0.095, 0.125],
      [1.05, 0.155, 0.085, 0.095],
      [1.12, 0.135, 0.085, 0.085],
      [1.2, 0.14, 0.09, 0.085],
      [1.27, 0.15, 0.11, 0.09],
      [1.33, 0.16, 0.135, 0.095],
      [1.38, 0.165, 0.135, 0.095],
      [1.43, 0.172, 0.105, 0.095],
      [1.49, 0.185, 0.092, 0.092],
      [1.53, 0.172, 0.08, 0.084],
      [1.565, 0.12, 0.066, 0.07],
      [1.595, 0.07, 0.054, 0.056],
      [1.62, 0.052, 0.05, 0.052],
      [1.69, 0.049, 0.048, 0.05],
      [1.74, 0.042, 0.042, 0.042],
    ];
  return [
    [0.8, 0.05, 0.04, 0.05],
    [0.85, 0.14, 0.09, 0.1],
    [0.9, 0.172, 0.1, 0.12],
    [0.98, 0.175, 0.1, 0.122],
    [1.06, 0.162, 0.096, 0.1],
    [1.14, 0.158, 0.102, 0.095],
    [1.24, 0.168, 0.115, 0.1],
    [1.33, 0.182, 0.125, 0.105],
    [1.42, 0.196, 0.122, 0.106],
    [1.48, 0.204, 0.11, 0.103],
    [1.525, 0.186, 0.092, 0.094],
    [1.56, 0.15, 0.076, 0.082],
    [1.59, 0.09, 0.064, 0.066],
    [1.615, 0.064, 0.058, 0.06],
    [1.69, 0.06, 0.056, 0.06],
    [1.74, 0.05, 0.048, 0.05],
  ];
}

function lerpRing(rings: Ring[], y: number): Ring {
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i],
      b = rings[i + 1];
    if (y >= a[0] && y <= b[0]) {
      const t = (y - a[0]) / (b[0] - a[0]);
      return [y, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
  }
  return rings[y < rings[0][0] ? 0 : rings.length - 1];
}

/** Depth of the chest/torso front surface at a world height (used to seat lapels, buttons, etc.). */
export function torsoFrontZ(y: number, female = false) {
  return lerpRing(torsoRings(female), y)[2];
}

export type Sleeve = 'long' | 'short';

const geoCache = new Map<string, THREE.BufferGeometry>();

export function humanGeometry(female: boolean, sleeve: Sleeve) {
  const key = `${female ? 'f' : 'm'}-${sleeve}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const B = new Builder();
  const J = JOINTS;

  // ---- torso, pelvis and neck
  const tr = torsoRings(female);
  B.loft(tr, {
    at: [0, 0, 0],
    seg: 28,
    pow: 2.15,
    capBottom: true,
    weight: (y) => {
      if (y < 1.56) return [BONE.hips, BONE.torso, smooth(0.96, 1.08, y)];
      return [BONE.torso, BONE.head, smooth(1.58, 1.68, y)];
    },
    group: (y) => (y > 1.6 ? MG.skin : y < 0.985 ? MG.bottom : MG.top),
  });
  // belt over the waistband
  const belt: Ring[] = [0.965, 0.995].map((y) => {
    const r = lerpRing(tr, y);
    return [y, r[1] * 1.035 + 0.003, r[2] * 1.05 + 0.003, r[3] * 1.05 + 0.003];
  });
  B.loft(belt, { at: [0, 0, 0], seg: 28, pow: 2.15, weight: () => [BONE.hips, BONE.hips, 0], group: () => MG.dark });
  // shirt hem sits just over the trousers
  const hem: Ring[] = [1.0, 1.04].map((y, i) => {
    const r = lerpRing(tr, y);
    const k = i === 0 ? 1.04 : 1.012;
    return [y, r[1] * k, r[2] * k, r[3] * k];
  });
  B.loft(hem, { at: [0, 0, 0], seg: 28, pow: 2.15, weight: (y) => [BONE.hips, BONE.torso, smooth(0.96, 1.08, y)], group: () => MG.top });

  // ---- arms (rings in shoulder-local y, hanging straight down)
  const arm: Ring[] = female
    ? [
        [0.03, 0.026, 0.028, 0.028],
        [0.012, 0.043, 0.046, 0.046],
        [-0.01, 0.048, 0.05, 0.05],
        [-0.06, 0.047, 0.048, 0.05],
        [-0.14, 0.045, 0.046, 0.048],
        [-0.22, 0.041, 0.043, 0.043],
        [-0.29, 0.036, 0.038, 0.04],
        [-0.34, 0.039, 0.041, 0.042],
        [-0.41, 0.036, 0.038, 0.036],
        [-0.5, 0.027, 0.032, 0.03],
        [-0.555, 0.024, 0.028, 0.027],
        [-0.58, 0.02, 0.022, 0.022],
      ]
    : [
        [0.03, 0.03, 0.032, 0.032],
        [0.012, 0.05, 0.054, 0.054],
        [-0.012, 0.057, 0.06, 0.06],
        [-0.06, 0.057, 0.058, 0.06],
        [-0.13, 0.054, 0.058, 0.056],
        [-0.21, 0.05, 0.055, 0.05],
        [-0.29, 0.043, 0.045, 0.047],
        [-0.34, 0.047, 0.05, 0.05],
        [-0.41, 0.044, 0.046, 0.043],
        [-0.5, 0.033, 0.038, 0.034],
        [-0.555, 0.029, 0.033, 0.031],
        [-0.58, 0.024, 0.026, 0.026],
      ];
  const sleeveEnd = sleeve === 'long' ? -0.535 : -0.2;
  for (const side of [1, -1]) {
    const up = side > 0 ? BONE.armL : BONE.armR,
      lo = side > 0 ? BONE.foreL : BONE.foreR;
    B.loft(arm, {
      at: [side * J.shoulderX, J.shoulderY, 0],
      seg: 16,
      weight: (y) => (y > 0 ? [up, BONE.torso, 0.55 * smooth(0, 0.05, y)] : [up, lo, smooth(-0.25, -0.33, y)]),
      group: (y) => (y > sleeveEnd ? MG.top : MG.skin),
    });
    // cuff / sleeve edge
    const cr = lerpRing(arm, sleeveEnd);
    B.loft(
      [
        [sleeveEnd - 0.012, cr[1] * 1.06, cr[2] * 1.06, cr[3] * 1.06],
        [sleeveEnd + 0.02, cr[1] * 1.04, cr[2] * 1.04, cr[3] * 1.04],
      ],
      { at: [side * J.shoulderX, J.shoulderY, 0], seg: 16, weight: (y) => [up, lo, smooth(-0.25, -0.33, y)], group: () => MG.top },
    );
    // hand: palm + fingers + thumb, rigid to the forearm
    const hx = side * J.shoulderX,
      hy = J.shoulderY - 0.6;
    const palm = new THREE.SphereGeometry(1, 12, 10).scale(female ? 0.02 : 0.023, female ? 0.045 : 0.05, female ? 0.04 : 0.045);
    B.add(palm, MG.skin, lo, new THREE.Matrix4().makeTranslation(hx, hy, 0.004));
    for (let f = 0; f < 4; f++) {
      const fz = (f - 1.5) * (female ? 0.017 : 0.019) + 0.004;
      const len = [0.062, 0.07, 0.066, 0.052][f] * (female ? 0.92 : 1);
      const finger = new THREE.CapsuleGeometry(female ? 0.0075 : 0.0088, len, 3, 6).translate(0, -len / 2, 0);
      // gentle curl toward the palm
      const m = new THREE.Matrix4()
        .makeTranslation(hx - side * 0.002, hy - (female ? 0.04 : 0.045), fz)
        .multiply(new THREE.Matrix4().makeRotationZ(-side * 0.32));
      B.add(finger, MG.skin, lo, m);
    }
    const thumb = new THREE.CapsuleGeometry(female ? 0.009 : 0.0105, 0.045, 3, 6).translate(0, -0.022, 0);
    B.add(thumb, MG.skin, lo, new THREE.Matrix4().makeTranslation(hx - side * 0.006, hy + 0.012, 0.035).multiply(new THREE.Matrix4().makeRotationX(-0.75)));
  }

  // ---- legs (hip-local y)
  const leg: Ring[] = female
    ? [
        [0.07, 0.06, 0.06, 0.065],
        [0.0, 0.098, 0.092, 0.1],
        [-0.1, 0.09, 0.085, 0.09],
        [-0.22, 0.077, 0.074, 0.075],
        [-0.34, 0.064, 0.064, 0.062],
        [-0.43, 0.054, 0.058, 0.054],
        [-0.48, 0.054, 0.054, 0.06],
        [-0.58, 0.053, 0.05, 0.068, -0.004],
        [-0.68, 0.045, 0.045, 0.054, -0.004],
        [-0.8, 0.034, 0.036, 0.036],
        [-0.88, 0.031, 0.033, 0.034],
      ]
    : [
        [0.07, 0.06, 0.06, 0.065],
        [0.0, 0.096, 0.09, 0.098],
        [-0.1, 0.092, 0.088, 0.09],
        [-0.22, 0.082, 0.08, 0.078],
        [-0.34, 0.07, 0.07, 0.066],
        [-0.43, 0.058, 0.062, 0.057],
        [-0.48, 0.057, 0.058, 0.062],
        [-0.58, 0.058, 0.055, 0.072, -0.004],
        [-0.68, 0.05, 0.05, 0.058, -0.004],
        [-0.8, 0.039, 0.04, 0.04],
        [-0.88, 0.035, 0.037, 0.038],
      ];
  for (const side of [1, -1]) {
    const up = side > 0 ? BONE.legL : BONE.legR,
      lo = side > 0 ? BONE.shinL : BONE.shinR;
    B.loft(leg, {
      at: [side * J.hipX, J.hipY, 0],
      seg: 18,
      weight: (y) => (y > -0.02 ? [up, BONE.hips, 0.35 * smooth(-0.02, 0.06, y)] : [up, lo, smooth(-0.39, -0.5, y)]),
      group: (y) => (y > -0.8 ? MG.bottom : MG.dark),
    });
    // trouser hem breaking over the shoe
    B.loft(
      [
        [-0.84, 0.05, 0.052, 0.054],
        [-0.79, 0.044, 0.046, 0.046],
      ],
      { at: [side * J.hipX, J.hipY, 0], seg: 18, weight: () => [lo, lo, 0], group: () => MG.bottom },
    );
    // shoe: lofted along +Z (ring front = sole side)
    const shoe: Ring[] = [
      [-0.07, 0.03, 0.03, 0.03],
      [-0.055, 0.042, 0.042, 0.052],
      [-0.02, 0.047, 0.045, 0.068],
      [0.03, 0.049, 0.045, 0.06],
      [0.08, 0.052, 0.045, 0.042],
      [0.13, 0.052, 0.044, 0.031],
      [0.175, 0.046, 0.042, 0.025],
      [0.205, 0.032, 0.036, 0.018],
      [0.218, 0.014, 0.02, 0.01],
    ];
    B.loft(shoe, {
      at: [side * (J.hipX + 0.006), 0.05, 0],
      seg: 18,
      pow: 2.8,
      rotX: Math.PI / 2,
      capTop: true,
      capBottom: true,
      vScale: 6,
      weight: () => [lo, lo, 0],
      group: (_y, th) => (Math.cos(th) > 0.55 ? MG.dark : MG.shoes),
    });
  }
  const geo = B.build();
  geoCache.set(key, geo);
  return geo;
}

// ---------------------------------------------------------------- textures

let fabricTex: THREE.Texture | null = null;
/** Tileable fabric normal map: fine weave plus soft creases. */
export function fabricNormal() {
  if (fabricTex) return fabricTex;
  const S = 128;
  const h = new Float32Array(S * S);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // soft creases: a few smooth sine bands
  const waves = Array.from({ length: 6 }, () => ({ fx: Math.floor(rnd() * 3) + 1, fy: Math.floor(rnd() * 4) + 1, ph: rnd() * 6.28, a: 0.5 + rnd() }));
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let v = 0;
      for (const w of waves) v += Math.sin(((x * w.fx + y * w.fy) / S) * Math.PI * 2 + w.ph) * w.a;
      // weave
      v += (((x >> 1) + (y >> 1)) % 2 ? 0.35 : -0.35) * (((x + y) & 1) ? 1 : 0.6);
      v += (rnd() - 0.5) * 0.5;
      h[y * S + x] = v;
    }
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const at = (x: number, y: number) => h[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.25,
        dy = (at(x, y + 1) - at(x, y - 1)) * 0.25;
      const n = new THREE.Vector3(-dx, -dy, 1).normalize();
      const o = (y * S + x) * 4;
      img.data[o] = (n.x * 0.5 + 0.5) * 255;
      img.data[o + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[o + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  fabricTex = new THREE.CanvasTexture(c);
  fabricTex.wrapS = fabricTex.wrapT = THREE.RepeatWrapping;
  fabricTex.repeat.set(3, 1);
  return fabricTex;
}

let hairTex: THREE.Texture | null = null;
/** Grey strand streaks (tinted by the material colour) for hair. */
export function hairTexture() {
  if (hairTex) return hairTex;
  const W = 256,
    H = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#9a9a9a';
  ctx.fillRect(0, 0, W, H);
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * W;
    const v = Math.floor(90 + rnd() * 165);
    ctx.strokeStyle = `rgba(${v},${v},${v},${0.35 + rnd() * 0.5})`;
    ctx.lineWidth = 0.6 + rnd() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + (rnd() - 0.5) * 6, H * 0.33, x + (rnd() - 0.5) * 6, H * 0.66, x + (rnd() - 0.5) * 8, H);
    ctx.stroke();
  }
  hairTex = new THREE.CanvasTexture(c);
  hairTex.colorSpace = THREE.SRGBColorSpace;
  hairTex.wrapS = hairTex.wrapT = THREE.RepeatWrapping;
  return hairTex;
}
