import * as THREE from 'three';

const VERT = `
attribute float size;
attribute vec4 pcolor;
uniform float uScale;
varying vec4 vC;
void main() {
  vC = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / max(0.5, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec4 vC;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.05, d);
  gl_FragColor = vec4(vC.rgb, vC.a * a);
}`;

class ParticlePool {
  n: number;
  pos: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  max: Float32Array;
  s0: Float32Array;
  s1: Float32Array;
  col: Float32Array; // r,g,b,a0
  drag: Float32Array;
  grav: Float32Array;
  sizeAttr: Float32Array;
  colAttr: Float32Array;
  points: THREE.Points;
  private cursor = 0;
  mat: THREE.ShaderMaterial;

  constructor(n: number, additive: boolean) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.col = new Float32Array(n * 4);
    this.drag = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.sizeAttr = new Float32Array(n);
    this.colAttr = new Float32Array(n * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.sizeAttr, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.colAttr, 4).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, r: number, gg: number, b: number, a: number, drag = 1, grav = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.max[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = gg;
    this.col[i * 4 + 2] = b;
    this.col[i * 4 + 3] = a;
    this.drag[i] = drag;
    this.grav[i] = grav;
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        this.colAttr[i * 4 + 3] = 0;
        this.sizeAttr[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.max[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.sizeAttr[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.colAttr[i * 4] = this.col[i * 4];
      this.colAttr[i * 4 + 1] = this.col[i * 4 + 1];
      this.colAttr[i * 4 + 2] = this.col[i * 4 + 2];
      this.colAttr[i * 4 + 3] = this.col[i * 4 + 3] * (1 - t) * Math.min(1, t * 8 + 0.2);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.pcolor.needsUpdate = true;
  }
}

const R = () => Math.random() - 0.5;

export class Effects {
  group = new THREE.Group();
  private smokeP = new ParticlePool(1400, false);
  private glowP = new ParticlePool(1400, true);
  private skids: THREE.InstancedMesh;
  private skidIdx = 0;
  private tracerGeo: THREE.BufferGeometry;
  private tracerPos: Float32Array;
  private tracers: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t: number }[] = [];
  flash = new THREE.PointLight(0xffaa55, 0, 30, 1.6);
  private flashT = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor() {
    this.group.add(this.smokeP.points, this.glowP.points);
    const sg = new THREE.PlaneGeometry(0.28, 0.6).rotateX(-Math.PI / 2);
    this.skids = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -10 }), 1500);
    this.skids.count = 1500;
    this.skids.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < 1500; i++) this.skids.setMatrixAt(i, zero);
    this.group.add(this.skids);
    this.tracerPos = new Float32Array(64 * 6);
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    const tl = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9, toneMapped: false }));
    tl.frustumCulled = false;
    this.group.add(tl);
    this.group.add(this.flash);
  }

  setScale(px: number) {
    this.smokeP.mat.uniforms.uScale.value = px;
    this.glowP.mat.uniforms.uScale.value = px;
  }

  smoke(p: THREE.Vector3, a = 0.5, size = 1.2) {
    const c = 0.2 + Math.random() * 0.15;
    this.smokeP.emit(p.x + R() * 0.3, p.y, p.z + R() * 0.3, R() * 0.6, 1.2 + Math.random(), R() * 0.6, 2.2 + Math.random(), size, size * 3.5, c, c, c, a, 0.6, -0.3);
  }
  tireSmoke(x: number, y: number, z: number, a = 0.4) {
    const c = 0.75;
    this.smokeP.emit(x + R() * 0.3, y + 0.2, z + R() * 0.3, R() * 1.2, 0.6 + Math.random() * 0.5, R() * 1.2, 1.4 + Math.random() * 0.6, 0.6, 3.2, c, c, c, a, 1.2, -0.2);
  }
  dust(p: THREE.Vector3, n = 6) {
    for (let i = 0; i < n; i++) this.smokeP.emit(p.x, p.y + 0.1, p.z, R() * 3, Math.random() * 1.5, R() * 3, 0.8 + Math.random() * 0.5, 0.3, 1.5, 0.6, 0.55, 0.48, 0.5, 2.5, 0.5);
  }
  fire(p: THREE.Vector3, scale = 1) {
    for (let i = 0; i < 2; i++) this.glowP.emit(p.x + R() * 0.6 * scale, p.y, p.z + R() * 0.6 * scale, R() * 0.4, 1.8 + Math.random() * 1.5, R() * 0.4, 0.5 + Math.random() * 0.3, 1.0 * scale, 0.2, 1.6, 0.6 + Math.random() * 0.3, 0.12, 0.9, 1, -1);
  }
  sparks(p: THREE.Vector3, n = 10, dirX = 0, dirZ = 0) {
    for (let i = 0; i < n; i++) this.glowP.emit(p.x, p.y, p.z, dirX * 3 + R() * 7, Math.random() * 4 + 1, dirZ * 3 + R() * 7, 0.25 + Math.random() * 0.3, 0.18, 0.05, 2.2, 1.6, 0.6, 1, 0.5, 14);
  }
  hitPuff(p: THREE.Vector3, flesh: boolean) {
    for (let i = 0; i < 5; i++) {
      if (flesh) this.smokeP.emit(p.x, p.y, p.z, R() * 2, Math.random() * 1.5, R() * 2, 0.35, 0.15, 0.5, 0.55, 0.08, 0.08, 0.8, 3, 4);
      else this.smokeP.emit(p.x, p.y, p.z, R() * 2, Math.random() * 1.5, R() * 2, 0.5, 0.15, 0.7, 0.6, 0.58, 0.52, 0.6, 3, 1);
    }
    if (!flesh) this.sparks(p, 3);
  }
  /** glowing green laser bolt drawn along a segment */
  laser(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const n = Math.min(14, Math.ceil(len / 0.7));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      this.glowP.emit(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t, 0, 0, 0, 0.2, 0.4, 0.1, 0.3, 2.6, 0.9, 1, 0, 0);
    }
  }
  zap(p: THREE.Vector3) {
    for (let i = 0; i < 8; i++) this.glowP.emit(p.x, p.y, p.z, R() * 6, Math.random() * 4, R() * 6, 0.3, 0.25, 0.05, 0.4, 2.6, 1, 1, 1, 6);
    this.light(p, 4, 0.08, 0x39ff88);
  }
  /** one puff of flamethrower fire; k = 0 at the nozzle .. 1 at max range */
  flame(p: THREE.Vector3, vx: number, vy: number, vz: number, k: number) {
    this.glowP.emit(p.x + R() * 0.2, p.y + R() * 0.2, p.z + R() * 0.2, vx * 0.15 + R(), vy * 0.15 + 0.8, vz * 0.15 + R(), 0.25 + Math.random() * 0.15, 0.3 + k * 1.6, 0.9 + k * 1.6, 2.4, 0.9 + Math.random() * 0.5, 0.15, 0.9, 1, -2);
    if (k > 0.6 && Math.random() < 0.3) this.smoke(p, 0.25, 0.8);
  }
  blood(p: THREE.Vector3) {
    for (let i = 0; i < 6; i++) this.smokeP.emit(p.x, p.y, p.z, R() * 2.5, Math.random() * 2, R() * 2.5, 0.4, 0.12, 0.4, 0.6, 0.04, 0.04, 0.9, 3, 8);
  }
  muzzle(p: THREE.Vector3) {
    this.glowP.emit(p.x, p.y, p.z, 0, 0, 0, 0.05, 0.9, 0.3, 2.5, 1.8, 0.8, 1, 0, 0);
    this.light(p, 2, 0.05, 0xffc070);
  }
  splash(p: THREE.Vector3, scale = 1) {
    for (let i = 0; i < 26 * scale; i++) this.smokeP.emit(p.x + R() * scale, -0.95, p.z + R() * scale, R() * 4 * scale, 3 + Math.random() * 4 * scale, R() * 4 * scale, 0.9 + Math.random() * 0.5, 0.3, 0.9, 0.85, 0.92, 1.0, 0.75, 0.5, 9);
  }
  spray(p: THREE.Vector3, k: number) {
    this.smokeP.emit(p.x + R(), p.y, p.z + R(), R() * 2, 1 + Math.random() * 2 * k, R() * 2, 0.7, 0.4, 1.6, 0.9, 0.95, 1, 0.45 * k, 1, 6);
  }
  waterJet(p: THREE.Vector3) {
    for (let i = 0; i < 3; i++) this.smokeP.emit(p.x + R() * 0.1, p.y + 0.6, p.z + R() * 0.1, R() * 1, 8 + Math.random() * 2, R() * 1, 1.2, 0.2, 0.8, 0.8, 0.9, 1, 0.7, 0.2, 12);
  }
  explosion(p: THREE.Vector3, scale = 1) {
    for (let i = 0; i < 60 * scale; i++) {
      const a = Math.random() * Math.PI * 2,
        u = Math.random(),
        sp = 4 + Math.random() * 10 * scale;
      this.glowP.emit(p.x, p.y, p.z, Math.cos(a) * sp * (1 - u * 0.5), Math.random() * 9 * scale, Math.sin(a) * sp * (1 - u * 0.5), 0.5 + Math.random() * 0.6, 2.5 * scale, 0.4, 2.4, 0.9 + Math.random() * 0.5, 0.25, 1, 2.2, -1);
    }
    for (let i = 0; i < 30 * scale; i++) this.smokeP.emit(p.x + R() * 2, p.y + Math.random() * 2, p.z + R() * 2, R() * 5, 2 + Math.random() * 4, R() * 5, 3 + Math.random() * 2, 2 * scale, 7 * scale, 0.12, 0.11, 0.1, 0.8, 0.8, -0.4);
    this.sparks(p, 25);
    this.light(p, 40 * scale, 0.5, 0xff8a3a);
  }
  light(p: THREE.Vector3, intensity: number, dur: number, color: number) {
    if (intensity < this.flash.intensity) return;
    this.flash.position.copy(p);
    this.flash.color.setHex(color);
    this.flash.intensity = intensity;
    this.flashT = dur;
  }
  sparkleBurst(p: THREE.Vector3, color: number) {
    const c = new THREE.Color(color);
    for (let i = 0; i < 30; i++) this.glowP.emit(p.x, p.y, p.z, R() * 6, Math.random() * 6, R() * 6, 0.7 + Math.random() * 0.4, 0.5, 0.05, c.r * 2, c.g * 2, c.b * 2, 1, 1.5, 3);
  }

  skid(x: number, y: number, z: number, yaw: number) {
    this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.m.compose(this.v.set(x, y + 0.03, z), this.q, this.s.set(1, 1, 1));
    this.skids.setMatrixAt(this.skidIdx, this.m);
    this.skidIdx = (this.skidIdx + 1) % 1500;
    this.skids.instanceMatrix.needsUpdate = true;
  }

  tracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    if (this.tracers.length >= 64) this.tracers.shift();
    this.tracers.push({ x0, y0, z0, x1, y1, z1, t: 0.06 });
  }

  update(dt: number) {
    this.smokeP.update(dt);
    this.glowP.update(dt);
    this.flashT -= dt;
    if (this.flashT <= 0) this.flash.intensity = Math.max(0, this.flash.intensity - dt * 120);
    this.tracerPos.fill(0);
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t -= dt;
      if (t.t <= 0) {
        this.tracers.splice(i, 1);
        continue;
      }
    }
    this.tracers.forEach((t, i) => this.tracerPos.set([t.x0, t.y0, t.z0, t.x1, t.y1, t.z1], i * 6));
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerGeo.setDrawRange(0, this.tracers.length * 2);
  }
}
