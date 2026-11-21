import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { terrainY } from '../constants';
import { PropDef, PropType } from './CityLayout';
import { Tex } from './Materials';

interface PropInfo {
  r: number;
  h: number;
  breakSpeed: number;
  mass: number;
}
const INFO: Record<PropType, PropInfo> = {
  lamp: { r: 0.25, h: 7, breakSpeed: 7, mass: 0.12 },
  hydrant: { r: 0.3, h: 0.8, breakSpeed: 4, mass: 0.05 },
  bin: { r: 0.35, h: 1.0, breakSpeed: 2, mass: 0.02 },
  bench: { r: 0.6, h: 0.8, breakSpeed: 3, mass: 0.04 },
  cone: { r: 0.25, h: 0.7, breakSpeed: 0.5, mass: 0.005 },
  mailbox: { r: 0.35, h: 1.3, breakSpeed: 3, mass: 0.04 },
  barrier: { r: 0.8, h: 1.0, breakSpeed: 2, mass: 0.03 },
  dumpster: { r: 1.1, h: 1.5, breakSpeed: 14, mass: 0.3 },
  barrel: { r: 0.35, h: 1.0, breakSpeed: 2.5, mass: 0.03 },
};

export interface Prop {
  type: PropType;
  idx: number; // index in its instanced mesh
  x: number;
  y: number;
  z: number;
  homeX: number;
  homeZ: number;
  homeY: number;
  yaw: number;
  broken: boolean;
  moving: boolean;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  rz: number;
  avx: number;
  avz: number;
  timer: number;
}

const CELL = 20;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

export class PropSystem {
  group = new THREE.Group();
  props: Prop[] = [];
  private meshes: Partial<Record<PropType, THREE.InstancedMesh>> = {};
  private lampHeads!: THREE.InstancedMesh;
  private lampPools!: THREE.InstancedMesh;
  lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false });
  poolMat: THREE.MeshBasicMaterial;
  private grid = new Map<number, number[]>();
  private dirty = new Set<PropType>();
  onBreak: ((p: Prop, speed: number) => void) | null = null;

  constructor(defs: PropDef[]) {
    this.poolMat = new THREE.MeshBasicMaterial({
      map: Tex.glow(),
      color: 0xffb468,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    });
    const geos = this.makeGeometries();
    const counts: Partial<Record<PropType, number>> = {};
    for (const d of defs) counts[d.type] = (counts[d.type] ?? 0) + 1;
    for (const t of Object.keys(counts) as PropType[]) {
      const g = geos[t];
      const m = new THREE.InstancedMesh(g.geo, g.mat, counts[t]!);
      m.castShadow = t === 'dumpster';
      m.receiveShadow = true;
      m.count = 0;
      this.meshes[t] = m;
      this.group.add(m);
    }
    const nLamps = counts.lamp ?? 0;
    const headGeo = new THREE.BoxGeometry(0.5, 0.18, 0.9);
    this.lampHeads = new THREE.InstancedMesh(headGeo, this.lampHeadMat, Math.max(1, nLamps));
    this.lampHeads.count = 0;
    const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.lampPools = new THREE.InstancedMesh(poolGeo, this.poolMat, Math.max(1, nLamps));
    this.lampPools.count = 0;
    this.lampPools.renderOrder = 2;
    this.group.add(this.lampHeads, this.lampPools);

    for (const d of defs) {
      const mesh = this.meshes[d.type]!;
      const gy = terrainY(d.x, d.z);
      const p: Prop = {
        type: d.type,
        idx: mesh.count++,
        x: d.x,
        y: gy,
        z: d.z,
        homeX: d.x,
        homeZ: d.z,
        homeY: gy,
        yaw: d.yaw,
        broken: false,
        moving: false,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        rz: 0,
        avx: 0,
        avz: 0,
        timer: 0,
      };
      const id = this.props.length;
      this.props.push(p);
      const k = this.key(Math.floor(d.x / CELL), Math.floor(d.z / CELL));
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(id);
      this.writeMatrix(p);
      if (d.type === 'lamp') {
        this.lampHeads.count++;
        this.lampPools.count++;
      }
    }
    for (const m of Object.values(this.meshes)) {
      m!.instanceMatrix.needsUpdate = true;
      m!.computeBoundingSphere();
    }
    this.lampHeads.instanceMatrix.needsUpdate = true;
    this.lampPools.instanceMatrix.needsUpdate = true;
    this.lampHeads.computeBoundingSphere();
    this.lampPools.computeBoundingSphere();
  }

  private key(ix: number, iz: number) {
    return (ix + 1000) * 4096 + iz + 1000;
  }

  private makeGeometries(): Record<PropType, { geo: THREE.BufferGeometry; mat: THREE.Material }> {
    const metal = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.5, metalness: 0.7 });
    const ni = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
    const merge = (...g: THREE.BufferGeometry[]) => mergeGeometries(g.map(ni))!;
    return {
      lamp: {
        geo: merge(new THREE.CylinderGeometry(0.1, 0.16, 7, 5, 1, true).translate(0, 3.5, 0), new THREE.BoxGeometry(0.12, 0.12, 2.6).translate(0, 6.9, 1.2), new THREE.CylinderGeometry(0.25, 0.3, 0.5, 5, 1, true).translate(0, 0.25, 0)),
        mat: metal,
      },
      hydrant: {
        geo: merge(new THREE.CylinderGeometry(0.17, 0.2, 0.7, 8).translate(0, 0.35, 0), new THREE.SphereGeometry(0.17, 8, 6).translate(0, 0.72, 0), new THREE.CylinderGeometry(0.07, 0.07, 0.5, 6).rotateZ(Math.PI / 2).translate(0, 0.45, 0)),
        mat: new THREE.MeshStandardMaterial({ color: 0xc8241c, roughness: 0.5 }),
      },
      bin: { geo: new THREE.CylinderGeometry(0.32, 0.28, 1, 10).translate(0, 0.5, 0), mat: new THREE.MeshStandardMaterial({ color: 0x2f6b3c, roughness: 0.6 }) },
      bench: {
        geo: merge(new THREE.BoxGeometry(1.8, 0.08, 0.5).translate(0, 0.45, 0), new THREE.BoxGeometry(1.8, 0.45, 0.08).translate(0, 0.75, -0.22), new THREE.BoxGeometry(0.08, 0.45, 0.45).translate(-0.8, 0.22, 0), new THREE.BoxGeometry(0.08, 0.45, 0.45).translate(0.8, 0.22, 0)),
        mat: new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.8 }),
      },
      cone: { geo: new THREE.ConeGeometry(0.22, 0.7, 10).translate(0, 0.35, 0), mat: new THREE.MeshStandardMaterial({ color: 0xff6a10, roughness: 0.6 }) },
      mailbox: { geo: merge(new THREE.BoxGeometry(0.5, 0.9, 0.45).translate(0, 0.85, 0), new THREE.BoxGeometry(0.1, 0.4, 0.1).translate(0, 0.2, 0)), mat: new THREE.MeshStandardMaterial({ color: 0x2a4f9a, roughness: 0.5 }) },
      barrier: { geo: new THREE.BoxGeometry(1.6, 1, 0.5).translate(0, 0.5, 0), mat: new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.7 }) },
      dumpster: { geo: new THREE.BoxGeometry(2.2, 1.5, 1.3).translate(0, 0.75, 0), mat: new THREE.MeshStandardMaterial({ color: 0x2f5a3a, roughness: 0.7, metalness: 0.3 }) },
      barrel: { geo: new THREE.CylinderGeometry(0.32, 0.32, 1, 10).translate(0, 0.5, 0), mat: new THREE.MeshStandardMaterial({ color: 0x2a5d9a, roughness: 0.5, metalness: 0.4 }) },
    };
  }

  private writeMatrix(p: Prop) {
    const mesh = this.meshes[p.type]!;
    _e.set(p.rx, p.yaw, p.rz, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(p.x, p.y, p.z);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(p.idx, _m);
    if (p.type === 'lamp') {
      // head at arm tip, pool on the ground
      const local = new THREE.Vector3(0, 6.85, 2.4).applyQuaternion(_q);
      _m.compose(_p.set(p.x + local.x, p.y + local.y, p.z + local.z), _q, _s);
      this.lampHeads.setMatrixAt(p.idx, _m);
      const poolS = p.broken ? 0.0001 : 13;
      _q.identity();
      _m.compose(_p.set(p.homeX + Math.sin(p.yaw) * 2.4, p.homeY + 0.13, p.homeZ + Math.cos(p.yaw) * 2.4), _q, new THREE.Vector3(poolS, 1, poolS));
      this.lampPools.setMatrixAt(p.idx, _m);
      this.lampHeads.instanceMatrix.needsUpdate = true;
      this.lampPools.instanceMatrix.needsUpdate = true;
    }
    this.dirty.add(p.type);
  }

  nearby(x: number, z: number, r: number, out: Prop[]) {
    out.length = 0;
    for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++)
      for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
        const arr = this.grid.get(this.key(ix, iz));
        if (arr) for (const id of arr) out.push(this.props[id]);
      }
    return out;
  }

  private tmp: Prop[] = [];
  /** Characters are blocked by intact props. */
  pushCharacter(pos: { x: number; z: number }, r: number, feetY: number) {
    for (const p of this.nearby(pos.x, pos.z, 2, this.tmp)) {
      if (p.broken) continue;
      const info = INFO[p.type];
      if (feetY > p.y + info.h - 0.3) continue;
      const dx = pos.x - p.x,
        dz = pos.z - p.z;
      const rr = r + info.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = p.x + (dx / d) * rr;
        pos.z = p.z + (dz / d) * rr;
      }
    }
  }

  /** Vehicle vs props. Returns speed factor to apply (1 = no loss) or -1 when blocked. */
  vehicleHit(cx: number, cz: number, r: number, vx: number, vz: number, y: number, mass: number, cb: (p: Prop, nx: number, nz: number, blocked: boolean) => void) {
    const speed = Math.hypot(vx, vz);
    for (const p of this.nearby(cx, cz, r + 1.5, this.tmp)) {
      if (p.broken) continue;
      const info = INFO[p.type];
      if (y > p.y + info.h) continue;
      const dx = cx - p.x,
        dz = cz - p.z;
      const rr = r + info.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 0.01;
      const nx = dx / d,
        nz = dz / d;
      if (speed * Math.min(1, mass / 1200) * 1.3 + speed * 0.5 > info.breakSpeed) {
        this.breakProp(p, vx, vz, speed);
        cb(p, nx, nz, false);
      } else cb(p, nx, nz, true);
    }
  }

  breakProp(p: Prop, vx: number, vz: number, speed: number) {
    p.broken = true;
    p.moving = true;
    const k = p.type === 'lamp' ? 0.35 : 0.9;
    p.vx = vx * k + (Math.random() - 0.5) * 2;
    p.vz = vz * k + (Math.random() - 0.5) * 2;
    p.vy = p.type === 'lamp' ? 1 : 2 + speed * 0.25;
    p.avx = (Math.random() - 0.5) * 6 + vz * 0.15;
    p.avz = (Math.random() - 0.5) * 6 - vx * 0.15;
    p.timer = 0;
    this.onBreak?.(p, speed);
  }

  update(dt: number, focusX: number, focusZ: number) {
    for (const p of this.props) {
      if (!p.broken) continue;
      p.timer += dt;
      if (p.moving) {
        p.vy -= 20 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.type === 'lamp') {
          // topple around the base
          p.rx = Math.min(Math.PI / 2, p.rx + dt * (1 + p.timer * 4));
          p.x = p.homeX + p.vx * 0.1 * Math.min(1, p.timer);
          p.z = p.homeZ + p.vz * 0.1 * Math.min(1, p.timer);
          p.y = p.homeY;
          if (p.rx >= Math.PI / 2) p.moving = false;
        } else {
          p.rx += p.avx * dt;
          p.rz += p.avz * dt;
          const gy = terrainY(p.x, p.z);
          if (p.y < gy) {
            p.y = gy;
            p.vy = -p.vy * 0.3;
            p.vx *= 0.6;
            p.vz *= 0.6;
            p.avx *= 0.5;
            p.avz *= 0.5;
            if (Math.abs(p.vy) < 0.8 && Math.hypot(p.vx, p.vz) < 0.4) {
              p.moving = false;
              p.rx = Math.round(p.rx / (Math.PI / 2)) * (Math.PI / 2);
              p.rz = Math.round(p.rz / (Math.PI / 2)) * (Math.PI / 2);
            }
          }
        }
        this.writeMatrix(p);
      } else if (p.timer > 90) {
        const d2 = (p.homeX - focusX) ** 2 + (p.homeZ - focusZ) ** 2;
        if (d2 > 120 * 120) {
          p.broken = false;
          p.x = p.homeX;
          p.y = p.homeY;
          p.z = p.homeZ;
          p.rx = p.rz = 0;
          this.writeMatrix(p);
        }
      }
    }
    for (const t of this.dirty) this.meshes[t]!.instanceMatrix.needsUpdate = true;
    this.dirty.clear();
  }

  setNight(night: number) {
    this.lampHeadMat.color.setRGB(0.6 + night * 2.4, 0.55 + night * 1.9, 0.45 + night * 1.2);
    this.poolMat.opacity = night * 0.42;
    this.lampPools.visible = night > 0.05;
  }
}
