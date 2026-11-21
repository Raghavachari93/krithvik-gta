import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, wrapAngle } from '../core/math';
import type { Game } from '../Game';

export type CamMode = 'near' | 'far' | 'first';

/** Third-person orbit camera with collision, vehicle chase mode, first-person and cinematic shots. */
export class CameraRig {
  yaw = Math.PI;
  pitch = -0.18;
  mode: CamMode = 'near';
  dist = 4.2;
  private curDist = 4.2;
  private target = new THREE.Vector3();
  private smoothTarget = new THREE.Vector3();
  lastMouseT = 0;
  private shakeAmt = 0;
  private fovBase = 70;
  private fov = 70;
  zoomOffset = 0;
  cinematic: { pos: THREE.Vector3; look: THREE.Vector3; orbit?: { cx: number; cz: number; r: number; h: number; speed: number; a: number } } | null = null;
  slowmo = 0;
  sensitivity = 1;
  invertY = false;
  private transition = 0;

  constructor(public camera: THREE.PerspectiveCamera) {}

  setFov(f: number) {
    this.fovBase = f;
  }

  shake(a: number) {
    this.shakeAmt = Math.min(1, this.shakeAmt + a);
  }

  cycleMode() {
    this.mode = this.mode === 'near' ? 'far' : this.mode === 'far' ? 'first' : 'near';
  }

  onEnterVehicle() {
    this.transition = 1;
    if (this.mode === 'first') this.mode = 'near';
  }
  onExitVehicle() {
    this.transition = 1;
  }

  setOrbit(cx: number, cz: number, r: number, h: number, speed = 0.15) {
    this.cinematic = { pos: new THREE.Vector3(), look: new THREE.Vector3(cx, 2, cz), orbit: { cx, cz, r, h, speed, a: Math.random() * 6 } };
  }
  clearCinematic() {
    this.cinematic = null;
    this.transition = 1;
  }

  update(dt: number, g: Game) {
    const cam = this.camera;
    if (this.cinematic) {
      const c = this.cinematic;
      if (c.orbit) {
        c.orbit.a += dt * c.orbit.speed;
        c.pos.set(c.orbit.cx + Math.cos(c.orbit.a) * c.orbit.r, c.orbit.h, c.orbit.cz + Math.sin(c.orbit.a) * c.orbit.r);
      }
      cam.position.lerp(c.pos, this.transition > 0 ? 1 : 1 - Math.exp(-dt * 3));
      cam.lookAt(c.look);
      this.transition = 0;
      this.applyFov(dt, this.fovBase);
      return;
    }
    const p = g.player;
    const inp = g.input;
    const v = p.vehicle;
    const sens = 0.0024 * this.sensitivity;
    if (g.controlsEnabled()) {
      if (inp.mouseDX !== 0 || inp.mouseDY !== 0) this.lastMouseT = g.time;
      this.yaw -= inp.mouseDX * sens * (p.aiming ? 0.6 : 1);
      this.pitch -= inp.mouseDY * sens * (this.invertY ? -1 : 1) * (p.aiming ? 0.6 : 1);
      if (inp.wheel !== 0 && this.mode !== 'first') this.zoomOffset = clamp(this.zoomOffset + inp.wheel * 0.8, -2, 9);
      if (inp.hit('KeyC')) this.cycleMode();
    }
    const first = this.mode === 'first';
    this.pitch = clamp(this.pitch, first ? -1.4 : -1.2, first ? 1.3 : 0.75);
    this.yaw = wrapAngle(this.yaw);

    // targets
    let desiredDist: number;
    const tgt = this.target;
    if (v) {
      const big = Math.max(v.spec.len, 3.5);
      desiredDist = (v.spec.plane ? (this.mode === 'far' ? 20 : 11) : this.mode === 'far' ? big * 2.4 + 4 : big * 1.45 + 2.2) + this.zoomOffset;
      tgt.set(v.pos.x, v.pos.y + v.spec.height * 0.75 + 0.6, v.pos.z);
      // auto-align behind vehicle when not using mouse
      if (g.time - this.lastMouseT > 1.2 && v.speed > 3) {
        const behind = v.forwardSpeed >= -1 ? v.yaw : v.yaw + Math.PI;
        this.yaw = dampAngle(this.yaw, behind, 2.2, dt);
        this.pitch = damp(this.pitch, -0.16, 1.5, dt);
      }
      if (this.mode === 'first') this.mode = 'near';
    } else {
      desiredDist = (this.mode === 'far' ? 7.5 : 3.6) + this.zoomOffset;
      if (p.aiming) desiredDist = 2.0;
      tgt.set(p.pos.x, p.pos.y + (p.swimming ? 0.3 : p.knockT > 0 ? 0.6 : 1.55), p.pos.z);
    }
    desiredDist = Math.max(first ? 0 : 1.6, desiredDist);
    const k = this.transition > 0 ? 1 - Math.exp(-dt * 4) : 1 - Math.exp(-dt * (v ? 10 : 18));
    this.transition = Math.max(0, this.transition - dt * 1.5);
    this.smoothTarget.lerp(tgt, k);
    if (this.smoothTarget.distanceToSquared(tgt) > 400) this.smoothTarget.copy(tgt);

    const cp = Math.cos(this.pitch),
      sp = Math.sin(this.pitch);
    const fx = Math.sin(this.yaw) * cp,
      fy = sp,
      fz = Math.cos(this.yaw) * cp;
    if (first && !v) {
      const head = this.smoothTarget;
      cam.position.set(p.pos.x + Math.sin(p.yaw) * 0.15, p.pos.y + 1.62 * p.def.look.height, p.pos.z + Math.cos(p.yaw) * 0.15);
      cam.lookAt(cam.position.x + fx, cam.position.y + fy, cam.position.z + fz);
      void head;
      p.model.setHeadVisible(false);
    } else {
      p.model.setHeadVisible(true);
      // over-the-shoulder offset
      const shoulder = v ? 0 : p.aiming ? 0.65 : 0.35;
      const rx = -Math.cos(this.yaw) * shoulder,
        rz = Math.sin(this.yaw) * shoulder;
      const ox = this.smoothTarget.x + rx,
        oy = this.smoothTarget.y,
        oz = this.smoothTarget.z + rz;
      // camera collision
      let d = desiredDist;
      const hit = g.col.raycast(ox, oy, oz, -fx, -fy, -fz, desiredDist + 0.3, true);
      if (hit) d = Math.max(0.6, hit.t - 0.35);
      this.curDist = d < this.curDist ? d : damp(this.curDist, d, 4, dt);
      let px = ox - fx * this.curDist,
        py = oy - fy * this.curDist,
        pz = oz - fz * this.curDist;
      const gy = g.col.surfaceY(px, pz, py, 0) + 0.3;
      if (py < gy) py = gy;
      if (py < -0.6 && !p.swimming) py = Math.max(py, -0.6);
      cam.position.set(px, py, pz);
      cam.lookAt(ox + fx * 3, oy + fy * 3, oz + fz * 3);
    }
    if (this.shakeAmt > 0) {
      const s = this.shakeAmt * 0.08;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2);
    }
    let fov = this.fovBase;
    if (v) fov += clamp(v.speed / v.spec.maxSpeed, 0, 1) * 14;
    if (p.aiming) fov -= p.weapon === 'sniper' ? 48 : 18;
    this.applyFov(dt, fov);
    p.syncAimPitch(this.pitch);
  }

  private applyFov(dt: number, fov: number) {
    this.fov = damp(this.fov, fov, 6, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** world-space forward ray from the camera (for aiming) */
  aimRay(out: { o: THREE.Vector3; d: THREE.Vector3 }) {
    out.o.copy(this.camera.position);
    this.camera.getWorldDirection(out.d);
    return out;
  }

  lerpYawTo(y: number) {
    this.yaw = y;
    void lerp;
  }
}
