import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VehicleSpec } from './VehicleSpecs';

/**
 * Realistic car bodywork built from lofted cross-sections: a rounded lower body with real wheel arches,
 * a tapered glasshouse split into painted pillars/roof and glass, and surface-hugging details
 * (lights, grille, plates, door shut lines, handles, mirrors, interior), all placed by ray-casting
 * onto the body so they sit on its curves.
 */

export interface CarParts {
  body: THREE.BufferGeometry; // paint (vertex coloured: dark under arches / sills)
  glass: THREE.BufferGeometry;
  head: THREE.BufferGeometry; // emissive headlamps
  tail: THREE.BufferGeometry; // emissive tail/brake lamps
  trim: THREE.BufferGeometry; // black plastic / rubber / shut lines / interior
  chrome: THREE.BufferGeometry;
  lens: THREE.BufferGeometry; // clear lamp housings
  plate: THREE.BufferGeometry; // UV-mapped number plates
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const se = (c: number, n: number) => Math.sign(c) * Math.pow(Math.abs(c), 2 / n);

/** y(z) lookup from control points (z descending or ascending), Catmull-Rom smoothed or linear. */
function profileFn(pts: [number, number][], sharp = false) {
  const sorted = [...pts].sort((a, b) => a[0] - b[0]);
  if (sharp) {
    return (z: number) => {
      if (z <= sorted[0][0]) return sorted[0][1];
      for (let i = 0; i < sorted.length - 1; i++) {
        const [z0, y0] = sorted[i],
          [z1, y1] = sorted[i + 1];
        if (z <= z1) return y0 + ((y1 - y0) * (z - z0)) / Math.max(1e-6, z1 - z0);
      }
      return sorted[sorted.length - 1][1];
    };
  }
  const curve = new THREE.CatmullRomCurve3(sorted.map(([z, y]) => new THREE.Vector3(z, y, 0)), false, 'centripetal');
  const S = curve.getSpacedPoints(400);
  return (z: number) => {
    if (z <= S[0].x) return S[0].y;
    for (let i = 0; i < S.length - 1; i++) {
      if (z <= S[i + 1].x) {
        const t = (z - S[i].x) / Math.max(1e-6, S[i + 1].x - S[i].x);
        return S[i].y + (S[i + 1].y - S[i].y) * t;
      }
    }
    return S[S.length - 1].y;
  };
}

/** Grid loft: rings[i][j] vertices, quads between consecutive rings, wrapping around j. Smooth normals via index. */
function gridGeometry(rings: THREE.Vector3[][], colors: THREE.Color[][], keep: (i: number, j: number) => boolean = () => true, capEnds = true) {
  const NI = rings.length,
    NJ = rings[0].length;
  const pos: number[] = [],
    col: number[] = [],
    idx: number[] = [];
  for (let i = 0; i < NI; i++)
    for (let j = 0; j < NJ; j++) {
      const v = rings[i][j];
      pos.push(v.x, v.y, v.z);
      const c = colors[i][j];
      col.push(c.r, c.g, c.b);
    }
  for (let i = 0; i < NI - 1; i++)
    for (let j = 0; j < NJ; j++) {
      if (!keep(i, j)) continue;
      const j2 = (j + 1) % NJ;
      const a = i * NJ + j,
        b = i * NJ + j2,
        c = (i + 1) * NJ + j2,
        d = (i + 1) * NJ + j;
      idx.push(a, c, b, a, d, c);
    }
  if (capEnds) {
    for (const [i, flip] of [
      [0, false],
      [NI - 1, true],
    ] as [number, boolean][]) {
      const ctr = new THREE.Vector3();
      for (const v of rings[i]) ctr.add(v);
      ctr.divideScalar(NJ);
      const ci = pos.length / 3;
      pos.push(ctr.x, ctr.y, ctr.z);
      const c0 = colors[i][0];
      col.push(c0.r, c0.g, c0.b);
      for (let j = 0; j < NJ; j++) {
        const a = i * NJ + j,
          b = i * NJ + ((j + 1) % NJ);
        if (flip) idx.push(ci, b, a);
        else idx.push(ci, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const WHITE = new THREE.Color(1, 1, 1);
const UNDER = new THREE.Color(0.035, 0.035, 0.04);
const SILL = new THREE.Color(0.06, 0.06, 0.065);
const LIV = new THREE.Color();

/** `livery`: bake this dark colour into the body with white doors/roof (paint material must then be white). */
export function buildCarBody(spec: VehicleSpec, livery?: number): CarParts & { surf: Surface } {
  const sh = spec.shape;
  const L = spec.len,
    W = spec.wid,
    h = L / 2;
  const boxy = !!sh.boxy;
  const sports = spec.cls === 'sports' || spec.cls === 'super' || !!spec.hyper || spec.crazy === 'rocket';
  const cargo = boxy && sh.cabRear > 0; // cab-over vans: tall box behind a short cab
  const n = boxy ? 5 : sports ? 3.0 : 3.4; // section squareness

  // ---------- profiles
  const topPts: [number, number][] = cargo
    ? [
        [h, sh.nose],
        [h - 0.3, sh.nose + (sh.belt - sh.nose) * 0.7],
        [sh.cabFront, sh.belt],
        [sh.cabRear + 0.04, sh.belt],
        [sh.cabRear - 0.02, sh.roofH],
        [-h + 0.06, sh.roofH],
        [-h, sh.roofH - 0.06],
      ]
    : [
        [h, sh.nose],
        [h - 0.32, sh.nose + (sh.belt - sh.nose) * 0.62],
        [(h + sh.cabFront) / 2 - 0.1, sh.nose + (sh.belt - sh.nose) * 0.86],
        [sh.cabFront, sh.belt],
        [sh.cabRear, sh.belt + 0.01],
        [(sh.cabRear - h + 0.25) / 2, (sh.belt + sh.tail) / 2 + 0.03],
        [-h + 0.22, sh.tail],
        [-h, sh.tail - 0.1],
      ];
  const topY = profileFn(topPts, cargo);
  const rcF = Math.min(boxy ? 0.28 : 0.42, W * 0.24),
    rcR = Math.min(boxy ? 0.2 : 0.34, W * 0.2);
  const halfW = (z: number) => {
    let w = W / 2;
    const df = z - (h - rcF),
      dr = -h + rcR - z;
    if (df > 0) w = W / 2 - rcF + Math.sqrt(Math.max(0, rcF * rcF - df * df));
    if (dr > 0) w = W / 2 - rcR + Math.sqrt(Math.max(0, rcR * rcR - dr * dr));
    // sports cars pinch slightly at the nose and flare over the rear haunches
    if (sports) w *= 1 - 0.05 * smooth(0, h, z) + 0.02 * smooth(-0.2, -h * 0.5, z) * smooth(-h, -h * 0.6, z);
    return Math.max(0.05, w);
  };
  const hoverOrHigh = spec.crazy === 'hover' || sh.gc > sh.wheelR * 1.4;
  const axles: { z: number; r: number; c: number }[] = [];
  if (!hoverOrHigh) {
    const rearScale = spec.crazy === 'rod' ? 1.28 : 1;
    axles.push({ z: sh.wheelX, r: sh.wheelR + 0.07, c: sh.wheelR });
    axles.push({ z: -sh.wheelX, r: sh.wheelR * rearScale + 0.07, c: sh.wheelR * rearScale });
    if (spec.crazy === 'limo') axles.push({ z: 0, r: sh.wheelR + 0.07, c: sh.wheelR });
  }
  const wheelW = spec.cls === 'truck' ? 0.38 : spec.hyper ? 0.32 : 0.26;
  const archInner = Math.max(0.2, sh.track - wheelW / 2 - 0.05);
  const archY = (z: number, top: number) => {
    let y = -1;
    for (const a of axles) {
      const d = Math.abs(z - a.z);
      if (d < a.r) y = Math.max(y, Math.min(top - 0.1, a.c + Math.sqrt(a.r * a.r - d * d)));
    }
    return y;
  };

  // ---------- lower body loft
  const NZ = 64,
    NA = 44;
  const zs: number[] = [];
  for (let i = 0; i <= NZ; i++) zs.push(-h + ((1 - Math.cos((Math.PI * i) / NZ)) / 2) * L);
  const rings: THREE.Vector3[][] = [],
    cols: THREE.Color[][] = [];
  const endR = boxy ? 0.06 : 0.11;
  for (const z of zs) {
    let yt = topY(z);
    let yb = sh.gc + 0.07 * smooth(h - 0.35, h, z) + 0.1 * smooth(-h + 0.3, -h, z);
    let a = halfW(z);
    // round the very ends so the bumpers curve under
    const ef = Math.max(z - (h - endR), -h + endR - z);
    if (ef > 0) {
      const k = Math.sqrt(Math.max(0, 1 - (ef / endR) ** 2));
      const yc0 = (yt + yb) / 2;
      yt = yc0 + (yt - yc0) * (0.82 + 0.18 * k);
      yb = yc0 + (yb - yc0) * (0.75 + 0.25 * k);
      a *= 0.9 + 0.1 * k;
    }
    const yc = (yt + yb) / 2,
      b = (yt - yb) / 2;
    const ay = archY(z, yt);
    const ring: THREE.Vector3[] = [],
      cr: THREE.Color[] = [];
    for (let j = 0; j < NA; j++) {
      const th = (j / NA) * Math.PI * 2; // 0 = top, PI/2 = +x side
      const u = se(Math.sin(th), n),
        v = se(Math.cos(th), n);
      let y = yc + b * v;
      // body tucks in toward the top (tumblehome) and slightly at the sill
      let x = a * u * (1 - 0.07 * Math.max(0, v) ** 2 - 0.035 * Math.max(0, -v) ** 3);
      let c = WHITE;
      if (ay > 0 && Math.abs(x) > archInner && y < ay) {
        y = ay;
        c = UNDER;
      } else if (v < -0.92) c = UNDER;
      else if (y < sh.gc + 0.06 && !sports) c = SILL;
      else if (livery !== undefined && !(z < sh.cabFront - 0.02 && z > sh.cabRear + 0.12 && y > sh.gc + 0.14 && y < sh.belt - 0.03)) c = LIV.setHex(livery).clone();
      ring.push(new THREE.Vector3(x, y, z));
      cr.push(c);
    }
    rings.push(ring);
    cols.push(cr);
  }
  const lower = gridGeometry(rings, cols);

  // ---------- glasshouse
  const bodyHalfAt = (z: number, y: number) => {
    // half-width of the lower body at height y (same section maths, solved numerically)
    const yt = topY(z),
      yb = sh.gc;
    const a = halfW(z);
    // clamp below the very top, where the rounded shoulder still has real width
    const v = Math.max(-1, Math.min(0.8, ((y - (yt + yb) / 2) / ((yt - yb) / 2)) || 0));
    const u = Math.pow(Math.max(0, 1 - Math.abs(v) ** n), 1 / n);
    return a * u * (1 - 0.07 * Math.max(0, v) ** 2);
  };
  const glassParts: THREE.BufferGeometry[] = [];
  const paintParts: THREE.BufferGeometry[] = [lower];
  const trimParts: THREE.BufferGeometry[] = [];
  const chromeParts: THREE.BufferGeometry[] = [];
  const lensParts: THREE.BufferGeometry[] = [];
  const headParts: THREE.BufferGeometry[] = [];
  const tailParts: THREE.BufferGeometry[] = [];
  const plateParts: THREE.BufferGeometry[] = [];
  const fourDoor = !sports && spec.cls !== 'muscle' && !cargo;
  const bz = fourDoor ? (sh.roofFront + sh.roofRear) / 2 + 0.08 : sh.roofRear + 0.1;
  let roofAt = (_z: number) => sh.roofH;
  if (spec.cls !== 'truck') {
    const zF = sh.cabFront,
      zR = cargo ? sh.cabRear - 0.04 : sh.cabRear;
    const crown = boxy ? 0.01 : 0.025;
    const roofPts: [number, number][] = cargo
      ? [
          [zF, sh.belt],
          [sh.roofFront, sh.roofH],
          [zR + 0.02, sh.roofH],
          [zR, sh.roofH],
        ]
      : [
          [zF, sh.belt],
          [zF + (sh.roofFront - zF) * 0.55, sh.belt + (sh.roofH - sh.belt) * 0.6],
          [sh.roofFront, sh.roofH - 0.012],
          [(sh.roofFront + sh.roofRear) / 2, sh.roofH + crown],
          [sh.roofRear, sh.roofH - 0.012],
          [sh.roofRear + (zR - sh.roofRear) * (boxy ? 0.3 : 0.5), sh.belt + (sh.roofH - sh.belt) * (boxy ? 0.75 : 0.55)],
          [zR, sh.belt + (boxy ? 0.3 : 0)],
        ];
    const roofY = profileFn(roofPts, cargo);
    roofAt = (z: number) => (z > zF || z < zR ? sh.belt : roofY(z));
    const GZ = 40,
      GA = 40;
    const gr: THREE.Vector3[][] = [],
      gc: THREE.Color[][] = [],
      gu: number[][] = [],
      gv: number[][] = [];
    const gn = boxy ? 7 : 5;
    for (let i = 0; i <= GZ; i++) {
      const z = zR + ((1 - Math.cos((Math.PI * i) / GZ)) / 2) * (zF - zR);
      const yb = sh.belt - 0.05,
        yt = Math.max(yb + 0.005, roofY(z));
      const a0 = bodyHalfAt(z, sh.belt) - 0.03;
      const taper = boxy ? 0.08 : sports ? 0.24 : 0.2;
      const ring: THREE.Vector3[] = [],
        cr: THREE.Color[] = [],
        ru: number[] = [],
        rv: number[] = [];
      for (let j = 0; j < GA; j++) {
        const th = (j / GA) * Math.PI * 2;
        const u = se(Math.sin(th), gn),
          v = se(Math.cos(th), gn);
        const t = (v + 1) / 2; // 0 bottom .. 1 top
        const y = yb + (yt - yb) * t;
        const x = a0 * u * (1 - taper * t);
        ring.push(new THREE.Vector3(x, y, z));
        cr.push(livery !== undefined && v < 0.6 ? new THREE.Color(livery) : WHITE);
        ru.push(u);
        rv.push(v);
      }
      gr.push(ring);
      gc.push(cr);
      gu.push(ru);
      gv.push(rv);
    }
    const isPaint = (i: number, j: number) => {
      const j2 = (j + 1) % GA;
      const z = (gr[i][j].z + gr[i + 1][j].z) / 2;
      const au = (Math.abs(gu[i][j]) + Math.abs(gu[i][j2]) + Math.abs(gu[i + 1][j]) + Math.abs(gu[i + 1][j2])) / 4;
      const av = (gv[i][j] + gv[i][j2] + gv[i + 1][j] + gv[i + 1][j2]) / 4;
      if (av < -0.55) return true; // window base seam
      if (z <= sh.roofFront + 0.01 && z >= sh.roofRear - 0.01 && av > 0.62) return true; // roof panel
      if (av > 0.55 && au > 0.62) return true; // roof rails / drip
      if (z > sh.roofFront && au > 0.86) return true; // A-pillars
      if (z < sh.roofRear && au > (boxy ? 0.86 : fourDoor ? 0.66 : 0.78)) return true; // C-pillars
      if (z < sh.roofRear && cargo) return true;
      if (Math.abs(z - bz) < 0.055 && au > 0.82) return true; // B-pillar
      return false;
    };
    paintParts.push(gridGeometry(gr, gc, isPaint, true));
    glassParts.push(gridGeometry(gr, gc, (i, j) => !isPaint(i, j), false));
  }

  // ---------- surface helper (ray-cast onto the lower body)
  const probe = new THREE.Mesh(lower, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  probe.updateMatrixWorld();
  const rc = new THREE.Raycaster();
  const hit = (o: THREE.Vector3, d: THREE.Vector3) => {
    rc.set(o, d);
    const r = rc.intersectObject(probe, false)[0];
    if (!r) return null;
    const nrm = r.face!.normal.clone();
    if (nrm.dot(d) > 0) nrm.negate();
    return { p: r.point, n: nrm };
  };
  const surf: Surface = {
    front: (x, y) => hit(new THREE.Vector3(x, y, h + 2), new THREE.Vector3(0, 0, -1)) ?? { p: new THREE.Vector3(x, y, h), n: new THREE.Vector3(0, 0, 1) },
    rear: (x, y) => hit(new THREE.Vector3(x, y, -h - 2), new THREE.Vector3(0, 0, 1)) ?? { p: new THREE.Vector3(x, y, -h), n: new THREE.Vector3(0, 0, -1) },
    side: (sx, y, z) => hit(new THREE.Vector3(sx * (W + 2), y, z), new THREE.Vector3(-sx, 0, 0)) ?? { p: new THREE.Vector3(sx * W * 0.5, y, z), n: new THREE.Vector3(sx, 0, 0) },
    top: (x, z) => hit(new THREE.Vector3(x, 6, z), new THREE.Vector3(0, -1, 0)) ?? { p: new THREE.Vector3(x, topY(z), z), n: new THREE.Vector3(0, 1, 0) },
  };
  /** orient geometry (built facing +Z) onto a surface hit, `out` metres proud of it */
  const onSurf = (g: THREE.BufferGeometry, s: { p: THREE.Vector3; n: THREE.Vector3 }, out = 0.004, upright = true) => {
    const n2 = s.n.clone();
    if (upright) {
      n2.y *= 0.35; // keep lamps facing mostly forward/back even on raked noses
      n2.normalize();
    }
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3().copy(n2), new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    m.setPosition(s.p.clone().addScaledVector(s.n, out));
    return g.applyMatrix4(m);
  };
  const rrect = (w: number, hh: number, r: number) => {
    const s = new THREE.Shape();
    const x0 = -w / 2,
      y0 = -hh / 2;
    r = Math.min(r, w / 2, hh / 2);
    s.moveTo(x0 + r, y0);
    s.lineTo(x0 + w - r, y0);
    s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
    s.lineTo(x0 + w, y0 + hh - r);
    s.quadraticCurveTo(x0 + w, y0 + hh, x0 + w - r, y0 + hh);
    s.lineTo(x0 + r, y0 + hh);
    s.quadraticCurveTo(x0, y0 + hh, x0, y0 + hh - r);
    s.lineTo(x0, y0 + r);
    s.quadraticCurveTo(x0, y0, x0 + r, y0);
    return s;
  };
  const slab = (w: number, hh: number, d: number, r = 0.02, bevel = 0.006) => {
    const g = new THREE.ExtrudeGeometry(rrect(w, hh, r), { depth: d, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 4 });
    g.translate(0, 0, -d / 2);
    g.deleteAttribute('uv');
    return g.toNonIndexed();
  };

  const isHyper = !!spec.hyper;
  const lampScale = W / 1.85;
  // ---------- headlights
  if (!isHyper) {
    const hw = (sports ? 0.4 : boxy ? 0.3 : 0.36) * lampScale,
      hh = sports ? 0.085 : boxy ? 0.17 : 0.12;
    const hy = cargo ? sh.nose - 0.25 : Math.max(sh.gc + 0.25, sh.nose - (sports ? 0.07 : 0.11));
    for (const sx of [1, -1]) {
      const x = sx * (W / 2 - hw / 2 - 0.08);
      const s = surf.front(x, hy);
      lensParts.push(onSurf(slab(hw, hh, 0.03, hh * 0.45), s, 0.006));
      // twin projector lamps + LED strip
      for (const k of [-0.25, 0.18]) {
        const lamp = new THREE.CylinderGeometry(hh * 0.3, hh * 0.3, 0.02, 14).rotateX(Math.PI / 2).translate(k * hw, 0, 0).toNonIndexed();
        lamp.deleteAttribute('uv');
        headParts.push(onSurf(lamp, s, 0.032));
      }
      const strip = slab(hw * 0.9, 0.012, 0.01, 0.005, 0);
      strip.translate(0, -hh * 0.38, 0);
      headParts.push(onSurf(strip, s, 0.032));
      // chrome reflector backing
      chromeParts.push(onSurf(slab(hw * 0.92, hh * 0.8, 0.01, hh * 0.35, 0), s, 0.0));
    }
    // ---------- grille & intakes
    const gw = W * (boxy ? 0.5 : sports ? 0.34 : 0.4),
      gh = boxy ? 0.22 : sports ? 0.08 : 0.13;
    const gy = cargo ? sh.nose - 0.25 : hy - (sports ? 0.06 : 0.02);
    const gs = surf.front(0, gy);
    trimParts.push(onSurf(slab(gw, gh, 0.03, gh * 0.3), gs, 0.002));
    const bars = boxy ? 4 : 3;
    for (let i = 0; i < bars; i++) chromeParts.push(onSurf(slab(gw * 0.94, 0.008, 0.01, 0.003, 0).translate(0, (i - (bars - 1) / 2) * (gh / bars), 0), gs, 0.016));
    const iy = sh.gc + 0.17;
    trimParts.push(onSurf(slab(W * 0.62, 0.11, 0.03, 0.04), surf.front(0, iy), 0.0));
    for (const sx of [1, -1]) {
      // fog lamps in the bumper corners
      const fs = surf.front(sx * W * 0.36, iy + 0.02);
      trimParts.push(onSurf(slab(0.16, 0.08, 0.02, 0.03), fs, 0.0));
      const fog = new THREE.CylinderGeometry(0.026, 0.026, 0.02, 12).rotateX(Math.PI / 2).toNonIndexed();
      fog.deleteAttribute('uv');
      headParts.push(onSurf(fog, fs, 0.024));
    }
  }
  // ---------- tail lights
  if (!isHyper) {
    const tw = (sports ? 0.46 : boxy ? 0.18 : 0.42) * lampScale,
      th = sports ? 0.07 : boxy ? 0.3 : 0.11;
    const ty = cargo ? sh.gc + 0.5 : sh.tail - (boxy ? 0.35 : 0.13);
    for (const sx of [1, -1]) {
      const s = surf.rear(sx * (W / 2 - tw / 2 - 0.06), ty);
      lensParts.push(onSurf(slab(tw, th, 0.025, th * 0.3), s, 0.004));
      tailParts.push(onSurf(slab(tw * 0.86, th * 0.62, 0.01, th * 0.2, 0), s, 0.03));
    }
    if (!boxy && !cargo) {
      // light bar joining the lamps across the boot lid
      const s = surf.rear(0, ty + 0.01);
      tailParts.push(onSurf(slab(W * 0.38, 0.016, 0.01, 0.006, 0), s, 0.012));
    }
    // rear bumper diffuser / valance + exhausts
    const ry = sh.gc + 0.13;
    trimParts.push(onSurf(slab(W * 0.7, 0.1, 0.03, 0.03), surf.rear(0, ry), 0.0));
    if (!spec.crazy) {
      for (const sx of sports ? [1, -1] : [1]) {
        const s = surf.rear(sx * W * 0.3, ry);
        const pipe = new THREE.CylinderGeometry(0.038, 0.038, 0.12, 14, 1, true).rotateX(Math.PI / 2).toNonIndexed();
        pipe.deleteAttribute('uv');
        chromeParts.push(onSurf(pipe, s, 0.02, true));
        const inner = new THREE.CircleGeometry(0.032, 12).toNonIndexed();
        inner.deleteAttribute('uv');
        trimParts.push(onSurf(inner, s, 0.03));
      }
    }
  }
  // ---------- number plates (UV mapped)
  if (!spec.crazy || spec.crazy === 'limo' || spec.crazy === 'rod') {
    const pw = 0.5,
      ph = 0.11;
    const mk = () => {
      const g = new THREE.PlaneGeometry(pw, ph);
      return g.toNonIndexed();
    };
    const fy = isHyper ? sh.gc + 0.14 : sh.gc + 0.3;
    if (!isHyper) plateParts.push(onSurf(mk(), surf.front(0, cargo ? sh.gc + 0.35 : fy), 0.035));
    plateParts.push(onSurf(mk(), surf.rear(0, cargo ? sh.gc + 0.45 : boxy ? sh.gc + 0.45 : (sh.gc + sh.tail) / 2 - 0.02), 0.03));
  }
  // ---------- door shut lines, handles, mirrors
  if (spec.cls !== 'truck') {
    const seamZ: number[] = [sh.cabFront - 0.04];
    if (fourDoor) seamZ.push(bz, sh.cabRear + 0.18);
    else seamZ.push(cargo ? sh.cabRear + 0.02 : sh.roofRear + 0.12);
    const y0 = sh.gc + 0.13,
      y1 = sh.belt - 0.025;
    for (const sx of [1, -1]) {
      for (const z of seamZ) {
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 8; k++) {
          const y = y0 + ((y1 - y0) * k) / 8;
          if (archY(z, 9) > y - 0.02) continue;
          const s = surf.side(sx, y, z);
          pts.push(s.p.clone().addScaledVector(s.n, 0.001));
        }
        if (pts.length >= 2) {
          const t = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.0045, 4, false).toNonIndexed();
          t.deleteAttribute('uv');
          trimParts.push(t);
        }
      }
      // door handles just behind each front seam
      const handleZ = fourDoor ? [bz - 0.16, sh.cabRear + 0.02] : [seamZ[1] - 0.16];
      for (const z of handleZ) {
        const s = surf.side(sx, sh.belt - 0.09, z);
        const hnd = new THREE.CapsuleGeometry(0.014, 0.1, 3, 8).rotateZ(Math.PI / 2).toNonIndexed();
        hnd.deleteAttribute('uv');
        // capsule axis along x before orientation -> along the car after facing outward
        chromeParts.push(onSurf(hnd, s, 0.008, false));
      }
      // wing mirror: body-coloured cap on a short arm, mirror glass facing back
      if (!spec.crazy || spec.crazy === 'limo') {
        const mz = sh.cabFront - 0.12,
          my = sh.belt + 0.06;
        const bx = bodyHalfAt(mz, sh.belt);
        const cap = new THREE.SphereGeometry(1, 14, 10).scale(0.1, 0.06, 0.055).toNonIndexed();
        cap.deleteAttribute('uv');
        cap.deleteAttribute('normal');
        cap.computeVertexNormals();
        cap.translate(sx * (bx + 0.12), my, mz);
        const cc = new Float32Array(cap.attributes.position.count * 3).fill(1);
        cap.setAttribute('color', new THREE.BufferAttribute(cc, 3));
        paintParts.push(cap);
        const arm = new THREE.BoxGeometry(0.1, 0.03, 0.05).toNonIndexed();
        arm.deleteAttribute('uv');
        arm.translate(sx * (bx + 0.04), my - 0.02, mz + 0.01);
        trimParts.push(arm);
        const mir = new THREE.CircleGeometry(1, 14).scale(0.085, 0.045, 1).rotateY(Math.PI).toNonIndexed();
        mir.deleteAttribute('uv');
        mir.translate(sx * (bx + 0.12), my, mz - 0.056);
        chromeParts.push(mir);
      }
    }
    // hood shut lines along the wings
    if (!cargo) {
      for (const sx of [1, -1]) {
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 10; k++) {
          const z = sh.cabFront - 0.02 + ((h - 0.1 - (sh.cabFront - 0.02)) * k) / 10;
          const x = sx * Math.min(halfW(z) - 0.16, W / 2 - 0.2);
          const s = surf.top(x, z);
          pts.push(s.p.clone().addScaledVector(s.n, 0.001));
        }
        const t = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.004, 4, false).toNonIndexed();
        t.deleteAttribute('uv');
        trimParts.push(t);
      }
    }
    // interior: dash and four seats, visible through the glass
    const iz = (sh.cabFront + sh.cabRear) / 2;
    const box = (w: number, hh: number, d: number, x: number, y: number, z: number, rx = 0) => {
      const b = new THREE.BoxGeometry(w, hh, d).toNonIndexed();
      b.deleteAttribute('uv');
      b.rotateX(rx);
      b.translate(x, y, z);
      trimParts.push(b);
    };
    const floor = sh.gc + 0.15;
    box(W * 0.82, 0.14, 0.3, 0, sh.belt - 0.02, sh.cabFront - 0.2); // dashboard
    const rows = cargo ? [sh.cabRear + 0.35] : sports ? [iz + 0.05] : [iz + 0.25, iz - 0.55];
    for (const z of rows)
      for (const sx of [1, -1]) {
        // keep seats under the (possibly sloping) roof line
        const room = roofAt(z - 0.3) - 0.1 - (floor + 0.26);
        if (room < 0.25) continue;
        const bh = Math.min(0.55, room - 0.18);
        box(0.46, 0.12, 0.48, sx * W * 0.22, floor + 0.2, z, 0); // cushion
        box(0.46, bh, 0.12, sx * W * 0.22, floor + 0.26 + bh / 2, z - 0.26, -0.2); // backrest
        if (room > bh + 0.16) box(0.24, 0.14, 0.08, sx * W * 0.22, floor + 0.26 + bh + 0.08, z - 0.31, -0.2); // headrest
      }
    // steering wheel (left-hand drive seat is +x)
    const sw = new THREE.TorusGeometry(0.17, 0.018, 6, 20).toNonIndexed();
    sw.deleteAttribute('uv');
    sw.rotateX(-0.45).translate(W * 0.22, sh.belt + 0.04, sh.cabFront - 0.42);
    trimParts.push(sw);
  }

  const merge = (parts: THREE.BufferGeometry[], keepColor = false) => {
    const list = parts
      .map((g) => (g.index ? g.toNonIndexed() : g))
      .map((g) => {
        if (g.attributes.uv) g.deleteAttribute('uv');
        if (!keepColor && g.attributes.color) g.deleteAttribute('color');
        if (!g.attributes.normal) g.computeVertexNormals();
        return g;
      });
    return list.length ? mergeGeometries(list)! : new THREE.BufferGeometry();
  };
  const plate = plateParts.length
    ? mergeGeometries(
        plateParts.map((g) => {
          if (g.attributes.color) g.deleteAttribute('color');
          return g;
        }),
      )!
    : new THREE.BufferGeometry();
  return {
    body: merge(paintParts, true),
    glass: merge(glassParts),
    head: merge(headParts),
    tail: merge(tailParts),
    trim: merge(trimParts),
    chrome: merge(chromeParts.filter((g) => g.attributes.position.count > 0)),
    lens: merge(lensParts),
    plate,
    surf,
  };
}

export interface Surface {
  front(x: number, y: number): { p: THREE.Vector3; n: THREE.Vector3 };
  rear(x: number, y: number): { p: THREE.Vector3; n: THREE.Vector3 };
  side(sx: number, y: number, z: number): { p: THREE.Vector3; n: THREE.Vector3 };
  top(x: number, z: number): { p: THREE.Vector3; n: THREE.Vector3 };
}

// ------------------------------------------------------------------ wheels

/**
 * Tyre (rounded sidewalls, optional tread blocks) + alloy rim face on both sides + brake disc.
 * Groups: 0 tyre, 1 rim, 2 disc/barrel.
 */
export function buildWheel(r: number, w: number, style: 'alloy' | 'multi' | 'steel' | 'offroad' = 'alloy') {
  const tyre: THREE.BufferGeometry[] = [],
    rim: THREE.BufferGeometry[] = [],
    disc: THREE.BufferGeometry[] = [];
  const rr = r * (style === 'offroad' ? 0.56 : style === 'multi' ? 0.72 : 0.66);
  const hw = w / 2;
  const prof = [
    [rr * 0.98, -hw * 0.86],
    [rr + (r - rr) * 0.45, -hw * 1.0],
    [r * 0.975, -hw * 0.9],
    [r, -hw * 0.62],
    [r, hw * 0.62],
    [r * 0.975, hw * 0.9],
    [rr + (r - rr) * 0.45, hw * 1.0],
    [rr * 0.98, hw * 0.86],
  ].map(([a, b]) => new THREE.Vector2(a, b));
  // lathe around Y, then lay the axle along X
  tyre.push(new THREE.LatheGeometry(prof.reverse(), 40).rotateZ(Math.PI / 2));
  if (style === 'offroad') {
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      for (const sx of [1, -1])
        tyre.push(
          new THREE.BoxGeometry(w * 0.42, 0.05, 0.11)
            .translate(sx * w * 0.24, r + 0.012, 0)
            .rotateX(a + (sx > 0 ? 0 : Math.PI / 22)),
        );
    }
  }
  // rim barrel (dark inside) and brake disc
  disc.push(new THREE.CylinderGeometry(rr * 0.97, rr * 0.97, w * 0.84, 28, 1, true).rotateZ(Math.PI / 2));
  disc.push(new THREE.CylinderGeometry(rr * 0.78, rr * 0.78, 0.025, 28).rotateZ(Math.PI / 2));
  for (const sx of [1, -1]) {
    const fx = sx * hw * 0.7;
    // outer lip
    rim.push(new THREE.TorusGeometry(rr * 0.99, r * 0.022, 6, 36).rotateY(Math.PI / 2).translate(fx, 0, 0));
    // hub
    rim.push(new THREE.CylinderGeometry(rr * 0.2, rr * 0.24, 0.05, 16).rotateZ(Math.PI / 2).translate(fx - sx * 0.02, 0, 0));
    rim.push(new THREE.CylinderGeometry(rr * 0.09, rr * 0.09, 0.02, 10).rotateZ(Math.PI / 2).translate(fx + sx * 0.01, 0, 0));
    // spokes
    const nS = style === 'multi' ? 10 : style === 'steel' ? 0 : style === 'offroad' ? 6 : 5;
    for (let i = 0; i < nS; i++) {
      const a = (i / nS) * Math.PI * 2;
      const len = rr * 0.78;
      const wide = style === 'multi' ? rr * 0.08 : rr * 0.2;
      const sp = new THREE.CylinderGeometry(wide * 0.55, wide, len, 4, 1).rotateY(Math.PI / 4).scale(0.35, 1, 1);
      sp.translate(0, rr * 0.2 + len / 2, 0);
      // dish the spoke slightly (outer end further out)
      sp.rotateZ(-sx * 0.12);
      sp.rotateX(a);
      sp.translate(fx - sx * 0.025, 0, 0);
      rim.push(sp);
    }
    if (style === 'steel') {
      rim.push(new THREE.CylinderGeometry(rr * 0.92, rr * 0.92, 0.02, 28).rotateZ(Math.PI / 2).translate(fx - sx * 0.01, 0, 0));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        disc.push(new THREE.CylinderGeometry(rr * 0.09, rr * 0.09, 0.03, 8).rotateZ(Math.PI / 2).translate(fx, Math.cos(a) * rr * 0.62, Math.sin(a) * rr * 0.62));
      }
    }
    // lug nuts
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      rim.push(new THREE.CylinderGeometry(rr * 0.035, rr * 0.035, 0.03, 6).rotateZ(Math.PI / 2).translate(fx + sx * 0.005, Math.cos(a) * rr * 0.13, Math.sin(a) * rr * 0.13));
    }
  }
  const prep = (list: THREE.BufferGeometry[]) =>
    mergeGeometries(
      list.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        n.deleteAttribute('uv');
        return n;
      }),
    )!;
  return mergeGeometries([prep(tyre), prep(rim), prep(disc)], true)!;
}
