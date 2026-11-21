import * as THREE from 'three';
import { Tex } from '../world/Materials';

export type MarkerKind = 'mission' | 'objective' | 'checkpoint' | 'activity' | 'shop' | 'pickup' | 'enemy';

export interface MarkerOpts {
  x: number;
  y?: number;
  z: number;
  color: number;
  kind: MarkerKind;
  radius?: number;
  height?: number;
  follow?: () => THREE.Vector3 | null;
  facing?: number;
}

export interface Marker extends MarkerOpts {
  id: string;
  group: THREE.Group;
  icon: THREE.Object3D | null;
}

export interface Blip {
  id: string;
  x: number;
  z: number;
  glyph: string;
  color: string;
  label: string;
  kind: 'mission' | 'safehouse' | 'shop' | 'police' | 'activity' | 'objective' | 'waypoint' | 'enemy' | 'collectible' | 'service' | 'vehicle';
  follow?: () => { x: number; z: number } | null;
  flash?: boolean;
  radius?: number;
  minimapOnly?: boolean;
  hidden?: boolean;
}

const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0);
const ringGeo = new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2);
const iconGeo = new THREE.OctahedronGeometry(0.5, 0);
const torusGeo = new THREE.TorusGeometry(1, 0.06, 8, 40);
const arrowGeo = new THREE.ConeGeometry(0.45, 0.9, 4).rotateX(Math.PI);

export class MarkerSystem {
  group = new THREE.Group();
  markers = new Map<string, Marker>();
  blips = new Map<string, Blip>();
  private t = 0;

  add(id: string, o: MarkerOpts): Marker {
    this.remove(id);
    const g = new THREE.Group();
    const col = new THREE.Color(o.color);
    const r = o.radius ?? (o.kind === 'checkpoint' ? 6 : o.kind === 'pickup' ? 0.6 : 1.4);
    let icon: THREE.Object3D | null = null;
    const beamMat = new THREE.MeshBasicMaterial({ color: col, map: Tex.beam(), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });
    if (o.kind !== 'pickup' && o.kind !== 'enemy') {
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.scale.set(r * (o.kind === 'checkpoint' ? 0.6 : 0.9), o.height ?? (o.kind === 'checkpoint' ? 40 : 25), r * (o.kind === 'checkpoint' ? 0.6 : 0.9));
      beam.rotation.x = Math.PI;
      beam.position.y = o.height ?? (o.kind === 'checkpoint' ? 40 : 25);
      g.add(beam);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      ring.scale.setScalar(r);
      ring.position.y = 0.15;
      g.add(ring);
    }
    if (o.kind === 'checkpoint') {
      const t = new THREE.Mesh(torusGeo, new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2), toneMapped: false, transparent: true, opacity: 0.8 }));
      t.scale.setScalar(r);
      t.position.y = r;
      t.rotation.y = o.facing ?? 0;
      g.add(t);
      icon = t;
    } else if (o.kind === 'enemy') {
      const a = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2), toneMapped: false }));
      a.position.y = 2.8;
      g.add(a);
      icon = a;
    } else {
      const d = new THREE.Mesh(o.kind === 'objective' ? arrowGeo : iconGeo, new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.8), toneMapped: false }));
      d.position.y = o.kind === 'pickup' ? 1 : 2.2;
      if (o.kind === 'objective') d.scale.setScalar(1.6);
      g.add(d);
      icon = d;
    }
    g.position.set(o.x, o.y ?? 0, o.z);
    this.group.add(g);
    const m: Marker = { ...o, id, group: g, icon };
    this.markers.set(id, m);
    return m;
  }

  remove(id: string) {
    const m = this.markers.get(id);
    if (m) {
      m.group.removeFromParent();
      this.markers.delete(id);
    }
  }

  removePrefix(prefix: string) {
    for (const id of [...this.markers.keys()]) if (id.startsWith(prefix)) this.remove(id);
    for (const id of [...this.blips.keys()]) if (id.startsWith(prefix)) this.blips.delete(id);
  }

  addBlip(b: Blip) {
    this.blips.set(b.id, b);
  }
  removeBlip(id: string) {
    this.blips.delete(id);
  }

  update(dt: number, cam: THREE.Vector3) {
    this.t += dt;
    for (const m of this.markers.values()) {
      if (m.follow) {
        const p = m.follow();
        if (p) m.group.position.set(p.x, p.y + (m.kind === 'objective' || m.kind === 'enemy' ? 1.2 : 0), p.z);
        m.group.visible = !!p;
      }
      const d = m.group.position.distanceTo(cam);
      const maxD = m.kind === 'checkpoint' ? 900 : m.kind === 'mission' || m.kind === 'objective' ? 600 : m.kind === 'pickup' ? 90 : 220;
      if (!m.follow) m.group.visible = d < maxD;
      if (m.icon && m.kind !== 'checkpoint') {
        m.icon.rotation.y += dt * 2;
        m.icon.position.y = (m.kind === 'pickup' ? 1 : m.kind === 'enemy' ? 2.8 : 2.2) + Math.sin(this.t * 3) * 0.15;
      }
    }
    for (const b of this.blips.values()) {
      if (b.follow) {
        const p = b.follow();
        if (p) {
          b.x = p.x;
          b.z = p.z;
          b.hidden = false;
        } else b.hidden = true;
      }
    }
  }
}
