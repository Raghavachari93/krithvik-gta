import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { clamp, lerp, smoothstep } from '../core/math';
import { worldUniforms } from '../world/Materials';

export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';

const WEATHER_PARAMS: Record<Weather, { cloud: number; rain: number; fog: number }> = {
  clear: { cloud: 0.05, rain: 0, fog: 0 },
  cloudy: { cloud: 0.6, rain: 0, fog: 0.15 },
  rain: { cloud: 0.85, rain: 0.7, fog: 0.35 },
  storm: { cloud: 1, rain: 1, fog: 0.45 },
  fog: { cloud: 0.5, rain: 0, fog: 1 },
};

export const WEATHER_LABEL: Record<Weather, string> = {
  clear: 'Clear',
  cloudy: 'Overcast',
  rain: 'Rain',
  storm: 'Thunderstorm',
  fog: 'Fog',
};

/** Day/night cycle, sky, sun/moon lighting, weather, rain and fog. */
export class Environment {
  hours = 16.3;
  /** hold the sun at midday */
  lockDay = true;
  /** in-game hours per real second */
  speed = 1 / 50;
  weather: Weather = 'clear';
  forced: Weather | null = null;
  cloud = 0.05;
  rain = 0;
  fogAmt = 0;
  wet = 0;
  night = 0;
  sunElev = 0;
  lightning = 0;
  private nextWeatherAt = 0;
  private elapsedHours = 0;
  sky: Sky;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  private envScene = new THREE.Scene();
  private envSky: Sky;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envTimer = 0;
  private rainMesh: THREE.LineSegments;
  private rainPos: Float32Array;
  private stars: THREE.Points;
  private clouds: THREE.Mesh;
  private cloudMat: THREE.MeshBasicMaterial;
  sunDir = new THREE.Vector3();
  onThunder: ((delay: number) => void) | null = null;
  private lightningTimer = 5;
  private fog: THREE.Fog;
  drawDistance = 1500;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {
    this.sky = new Sky();
    this.sky.scale.setScalar(4500);
    scene.add(this.sky);
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera as THREE.OrthographicCamera;
    s.left = -90;
    s.right = 90;
    s.top = 90;
    s.bottom = -90;
    s.near = 1;
    s.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a4a3a, 0.7);
    scene.add(this.hemi);

    this.fog = new THREE.Fog(0xaabbcc, 200, 1500);
    scene.fog = this.fog;

    // rain
    const N = 5000;
    this.rainPos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 70,
        y = Math.random() * 40,
        z = (Math.random() - 0.5) * 70;
      this.rainPos.set([x, y, z, x + 0.1, y - 0.9, z], i * 6);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rainMesh = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaac4dd, transparent: true, opacity: 0.0, depthWrite: false }));
    this.rainMesh.frustumCulled = false;
    scene.add(this.rainMesh);

    // stars
    const sp = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) {
      const v = new THREE.Vector3().randomDirection();
      v.y = Math.abs(v.y) * 0.9 + 0.05;
      v.normalize().multiplyScalar(3800);
      sp.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // cloud layer
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * 256,
        y = Math.random() * 256,
        r = 15 + Math.random() * 45;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.5)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
        ctx.save();
        ctx.translate(ox, oy);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    const ct = new THREE.CanvasTexture(c);
    ct.wrapS = ct.wrapT = THREE.RepeatWrapping;
    ct.repeat.set(6, 6);
    this.cloudMat = new THREE.MeshBasicMaterial({ map: ct, transparent: true, opacity: 0.3, depthWrite: false, fog: false, color: 0xffffff });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(Math.PI / 2), this.cloudMat);
    this.clouds.position.y = 600;
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);
  }

  setShadowQuality(size: number, enabled: boolean) {
    this.sun.castShadow = enabled;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
  }

  setWeather(w: Weather) {
    this.weather = w;
  }

  timeString() {
    const h = Math.floor(this.hours) % 24;
    const m = Math.floor((this.hours % 1) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  skipTo(hours: number) {
    this.hours = hours % 24;
    this.envTimer = 99;
  }

  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera) {
    const dh = dt * this.speed;
    if (this.lockDay) this.hours = 16.3;
    else this.hours = (this.hours + dh) % 24;
    this.elapsedHours += dh;
    worldUniforms.uTime.value += dt;

    // weather schedule
    if (this.forced) this.weather = this.forced;
    else if (this.elapsedHours > this.nextWeatherAt) {
      this.nextWeatherAt = this.elapsedHours + 3 + Math.random() * 5;
      const r = Math.random();
      this.weather = r < 0.7 ? 'clear' : r < 0.85 ? 'cloudy' : r < 0.95 ? 'rain' : r < 0.98 ? 'storm' : 'fog';
    }
    const target = WEATHER_PARAMS[this.weather];
    const k = 1 - Math.exp(-dt / 12);
    this.cloud = lerp(this.cloud, target.cloud, k);
    this.rain = lerp(this.rain, target.rain, k);
    this.fogAmt = lerp(this.fogAmt, target.fog, k);
    this.wet = this.rain > this.wet ? lerp(this.wet, this.rain, 1 - Math.exp(-dt / 6)) : lerp(this.wet, this.rain, 1 - Math.exp(-dt / 60));
    worldUniforms.uWet.value = clamp(this.wet, 0, 1);

    // sun
    const ang = ((this.hours - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(ang), Math.sin(ang) * 0.92, 0.38).normalize();
    this.sunElev = this.sunDir.y;
    const day = smoothstep(-0.12, 0.18, this.sunElev);
    this.night = 1 - day;
    worldUniforms.uNight.value = smoothstep(0.25, 0.85, this.night) * 0.9 + this.cloud * 0.08;

    const u = this.sky.material.uniforms;
    const elevClamp = Math.max(this.sunElev, -0.3);
    const sunPos = new THREE.Vector3(this.sunDir.x, elevClamp, this.sunDir.z).normalize();
    u.sunPosition.value.copy(sunPos);
    u.turbidity.value = 1.8 + this.cloud * 12;
    u.rayleigh.value = lerp(1.2, 3.2, smoothstep(0.35, 0.0, this.sunElev)) * (1 - this.cloud * 0.5);
    u.mieCoefficient.value = 0.004 + this.cloud * 0.02;
    u.mieDirectionalG.value = 0.82;
    const eu = this.envSky.material.uniforms;
    for (const key of ['sunPosition', 'turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) {
      const v = u[key].value;
      if (v instanceof THREE.Vector3) eu[key].value.copy(v);
      else eu[key].value = v;
    }

    // lighting
    const low = smoothstep(0.45, 0.02, this.sunElev);
    const sunCol = new THREE.Color(1, 0.96, 0.9).lerp(new THREE.Color(1, 0.55, 0.28), low);
    const lightDir = this.sunElev > -0.05 ? this.sunDir : new THREE.Vector3(-this.sunDir.x, -this.sunDir.y, -0.3).normalize();
    if (this.sunElev > -0.05) {
      this.sun.color.copy(sunCol);
      this.sun.intensity = 4.5 * smoothstep(-0.05, 0.12, this.sunElev) * (1 - this.cloud * 0.65);
    } else {
      this.sun.color.setRGB(0.55, 0.65, 1.0);
      this.sun.intensity = 0.35 * (1 - this.cloud * 0.6);
    }
    this.lightningTimer -= dt;
    if (this.weather === 'storm' && this.lightningTimer < 0) {
      this.lightningTimer = 4 + Math.random() * 10;
      this.lightning = 1;
      this.onThunder?.(0.4 + Math.random() * 2);
    }
    this.lightning = Math.max(0, this.lightning - dt * 3.5);
    const flash = this.lightning > 0.5 || (this.lightning > 0.2 && this.lightning < 0.3) ? this.lightning * 3 : 0;

    this.hemi.intensity = lerp(0.26, 0.5, day) * (1 - this.cloud * 0.25) + flash;
    this.hemi.color.setRGB(lerp(0.32, 0.75, day), lerp(0.38, 0.85, day), lerp(0.7, 1.0, day));
    this.hemi.groundColor.setRGB(lerp(0.12, 0.4, day), lerp(0.1, 0.34, day), lerp(0.16, 0.28, day));

    this.sun.position.copy(focus).addScaledVector(lightDir, 300);
    this.sun.target.position.copy(focus);
    // snap shadow camera to texels to reduce shimmering
    this.sun.target.updateMatrixWorld();

    // fog
    const horizonDay = new THREE.Color(0xc4dcf2).lerp(new THREE.Color(0xf0a070), low * day);
    const horizonNight = new THREE.Color(0x0b1024);
    const fogCol = horizonNight.clone().lerp(horizonDay, day).lerp(new THREE.Color(0x8a9298).multiplyScalar(lerp(0.25, 1, day)), this.cloud * 0.6);
    this.fog.color.copy(fogCol);
    const far = this.drawDistance;
    this.fog.far = lerp(far, 180, this.fogAmt);
    this.fog.near = lerp(Math.min(lerp(250, 550, day), far * 0.4), 5, this.fogAmt);
    this.renderer.toneMappingExposure = lerp(0.95, 0.7, day) + flash * 0.3;
    (this.scene as THREE.Scene).environmentIntensity = lerp(0.15, 0.45, day);

    // stars & clouds
    (this.stars.material as THREE.PointsMaterial).opacity = smoothstep(0.5, 0.95, this.night) * (1 - this.cloud);
    this.stars.position.copy(camera.position);
    this.cloudMat.opacity = 0.05 + this.cloud * 0.6;
    this.cloudMat.color.setRGB(lerp(0.12, 1, day), lerp(0.13, 0.95, day), lerp(0.2, 0.95, day));
    this.clouds.position.x = camera.position.x;
    this.clouds.position.z = camera.position.z;
    (this.cloudMat.map as THREE.Texture).offset.x += dt * 0.0015;
    this.sky.position.copy(camera.position);

    // rain particles follow the camera
    const rm = this.rainMesh.material as THREE.LineBasicMaterial;
    rm.opacity = this.rain * 0.55;
    this.rainMesh.visible = this.rain > 0.02;
    if (this.rainMesh.visible) {
      const p = this.rainPos;
      const fall = 32 * dt;
      const wind = 3 * dt;
      const n = Math.floor((p.length / 6) * clamp(this.rain, 0.2, 1));
      for (let i = 0; i < p.length / 6; i++) {
        const o = i * 6;
        if (i > n) {
          p[o + 1] = -1000;
          p[o + 4] = -1000;
          continue;
        }
        let y = p[o + 1] - fall;
        let x = p[o] + wind;
        let z = p[o + 2];
        if (y < -2 || y > 60) {
          y = 38 + Math.random() * 4;
          x = (Math.random() - 0.5) * 70;
          z = (Math.random() - 0.5) * 70;
        }
        p[o] = x;
        p[o + 1] = y;
        p[o + 2] = z;
        p[o + 3] = x + 0.08;
        p[o + 4] = y - 0.9;
        p[o + 5] = z;
      }
      this.rainMesh.geometry.attributes.position.needsUpdate = true;
      this.rainMesh.position.set(camera.position.x, camera.position.y - 15, camera.position.z);
    }

    // environment map refresh
    this.envTimer += dt;
    if (this.envTimer > 4) {
      this.envTimer = 0;
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
      this.scene.environment = rt.texture;
      this.envRT?.dispose();
      this.envRT = rt;
    }
  }
}
