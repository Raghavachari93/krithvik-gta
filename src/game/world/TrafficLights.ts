import * as THREE from 'three';
import { ROAD_HALF } from '../constants';
import { CityLayout } from './CityLayout';
import { makeInstanced, InstItem } from './CityBuilder';

export type Axis = 'ns' | 'ew';
export type LightColor = 'green' | 'yellow' | 'red';

const CYCLE = 28;

/** Global synchronised traffic signal controller with visual signal heads at every junction. */
export class TrafficLights {
  group = new THREE.Group();
  t = 0;
  private mats: Record<string, THREE.MeshBasicMaterial> = {};

  constructor(layout: CityLayout) {
    const poles: InstItem[] = [],
      heads: InstItem[] = [];
    const lamps: Record<string, InstItem[]> = {};
    for (const ax of ['ns', 'ew'])
      for (const c of ['red', 'yellow', 'green']) {
        lamps[`${ax}-${c}`] = [];
        this.mats[`${ax}-${c}`] = new THREE.MeshBasicMaterial({ color: 0x111111, toneMapped: false });
      }
    for (const n of layout.nodes) {
      if (!n.light) continue;
      for (const lid of n.links) {
        const o = layout.nodes[lid];
        // approach direction: from o toward n
        let dx = n.x - o.x,
          dz = n.z - o.z;
        const l = Math.hypot(dx, dz);
        dx /= l;
        dz /= l;
        const rx = -dz,
          rz = dx;
        const px = n.x - dx * (ROAD_HALF + 2) + rx * (ROAD_HALF + 1.2);
        const pz = n.z - dz * (ROAD_HALF + 2) + rz * (ROAD_HALF + 1.2);
        const yaw = Math.atan2(-dx, -dz); // facing oncoming traffic
        poles.push({ x: px, y: 0, z: pz, sx: 1, sy: 1, sz: 1, ry: yaw });
        // head hangs over the lane on an arm
        const hx = px - rx * 3.5,
          hz = pz - rz * 3.5;
        heads.push({ x: hx, y: 5.2, z: hz, sx: 1, sy: 1, sz: 1, ry: yaw });
        const ax: Axis = Math.abs(dz) > Math.abs(dx) ? 'ns' : 'ew';
        const fx = Math.sin(yaw) * 0.22,
          fz = Math.cos(yaw) * 0.22;
        lamps[`${ax}-red`].push({ x: hx + fx, y: 5.62, z: hz + fz, sx: 1, sy: 1, sz: 1, ry: yaw });
        lamps[`${ax}-yellow`].push({ x: hx + fx, y: 5.2, z: hz + fz, sx: 1, sy: 1, sz: 1, ry: yaw });
        lamps[`${ax}-green`].push({ x: hx + fx, y: 4.78, z: hz + fz, sx: 1, sy: 1, sz: 1, ry: yaw });
      }
    }
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.5, metalness: 0.6 });
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.15, 5.6, 5, 1, true).translate(0, 2.8, 0);
    const armGeo = new THREE.BoxGeometry(3.6, 0.12, 0.12);
    // arm geometry: rotated with pole; we build combined geometry per pole using local offsets
    const combined = new THREE.BufferGeometry();
    void combined;
    void armGeo;
    const poleMeshes = this.chunks(poleGeo, metal, poles, false);
    const armItems: InstItem[] = poles.map((p, i) => {
      const h = heads[i];
      return { x: (p.x + h.x) / 2, y: 5.5, z: (p.z + h.z) / 2, sx: 1, sy: 1, sz: 1, ry: (p.ry ?? 0) + Math.PI / 2 };
    });
    this.chunks(new THREE.BoxGeometry(0.1, 0.1, 3.6), metal, armItems, false);
    this.chunks(new THREE.BoxGeometry(0.4, 1.35, 0.35), new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.6 }), heads, true);
    const lampGeo = new THREE.CircleGeometry(0.14, 8);
    for (const k of Object.keys(lamps)) this.chunks(lampGeo, this.mats[k], lamps[k], false);
    void poleMeshes;
  }

  private chunks(geo: THREE.BufferGeometry, mat: THREE.Material, items: InstItem[], cast: boolean) {
    const buckets = new Map<string, InstItem[]>();
    for (const it of items) {
      const k = `${Math.floor(it.x / 300)},${Math.floor(it.z / 300)}`;
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(it);
    }
    for (const b of buckets.values()) this.group.add(makeInstanced(geo, mat, b, cast, false));
  }

  state(axis: Axis): LightColor {
    const t = this.t % CYCLE;
    if (axis === 'ns') return t < 11 ? 'green' : t < 13.5 ? 'yellow' : 'red';
    return t < 14 ? 'red' : t < 25 ? 'green' : t < 27.5 ? 'yellow' : 'red';
  }

  /** Can pedestrians cross a road whose traffic runs along `roadAxis`? */
  canCross(roadAxis: Axis) {
    const t = this.t % CYCLE;
    if (roadAxis === 'ns') return t > 14.5 && t < 22;
    return t > 0.5 && t < 8;
  }

  update(dt: number) {
    this.t += dt;
    const on = (c: LightColor) => (c === 'red' ? [3, 0.1, 0.1] : c === 'yellow' ? [3, 1.8, 0.1] : [0.1, 3, 0.6]);
    for (const ax of ['ns', 'ew'] as Axis[]) {
      const s = this.state(ax);
      for (const c of ['red', 'yellow', 'green'] as LightColor[]) {
        const m = this.mats[`${ax}-${c}`];
        if (c === s) m.color.setRGB(on(c)[0], on(c)[1], on(c)[2]);
        else m.color.setRGB(0.08, 0.08, 0.08);
      }
    }
  }
}
