import * as THREE from 'three';

/** Uniforms shared by every world material (night factor, wetness, time). */
export const worldUniforms = {
  uNight: { value: 0 },
  uWet: { value: 0 },
  uTime: { value: 0 },
};

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function noiseFill(ctx: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amp: number, count: number, size = 2) {
  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    const v = (Math.random() - 0.5) * amp;
    ctx.fillStyle = `rgba(${base[0] + v},${base[1] + v},${base[2] + v},0.55)`;
    ctx.fillRect(Math.random() * w, Math.random() * h, size * Math.random() + 1, size * Math.random() + 1);
  }
}

function tex(c: HTMLCanvasElement, repeat = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const cache: Record<string, THREE.Texture> = {};

export const Tex = {
  asphalt() {
    if (cache.asphalt) return cache.asphalt;
    const c = canvas(512, 512);
    const ctx = c.getContext('2d')!;
    noiseFill(ctx, 512, 512, [58, 60, 64], 26, 26000, 2);
    // cracks & patches
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(30,30,34,${0.15 + Math.random() * 0.15})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * 512, Math.random() * 512, 20 + Math.random() * 60, 10 + Math.random() * 30, Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    return (cache.asphalt = tex(c));
  },
  sidewalk() {
    if (cache.sidewalk) return cache.sidewalk;
    const c = canvas(256, 256);
    const ctx = c.getContext('2d')!;
    noiseFill(ctx, 256, 256, [160, 156, 148], 18, 6000, 2);
    ctx.strokeStyle = 'rgba(90,88,84,0.6)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 256; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(256, i);
      ctx.stroke();
    }
    return (cache.sidewalk = tex(c));
  },
  grass() {
    if (cache.grass) return cache.grass;
    const c = canvas(256, 256);
    const ctx = c.getContext('2d')!;
    noiseFill(ctx, 256, 256, [74, 120, 58], 40, 12000, 2);
    return (cache.grass = tex(c));
  },
  lot() {
    if (cache.lot) return cache.lot;
    const c = canvas(256, 256);
    const ctx = c.getContext('2d')!;
    noiseFill(ctx, 256, 256, [92, 92, 94], 22, 9000, 2);
    return (cache.lot = tex(c));
  },
  corrugated() {
    if (cache.corr) return cache.corr;
    const c = canvas(64, 64);
    const ctx = c.getContext('2d')!;
    for (let x = 0; x < 64; x++) {
      const v = 200 + Math.sin(x / 2) * 40;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, 0, 1, 64);
    }
    return (cache.corr = tex(c));
  },
  waterNormal() {
    if (cache.waterN) return cache.waterN;
    const N = 256;
    const h = new Float32Array(N * N);
    const waves: [number, number, number, number][] = [];
    for (let i = 0; i < 24; i++) waves.push([Math.round(Math.random() * 8 + 1), Math.round(Math.random() * 8 - 4), Math.random() * 6.28, 1 / (1 + i * 0.3)]);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        let v = 0;
        for (const [kx, ky, ph, a] of waves) v += Math.sin(((x * kx + y * ky) / N) * Math.PI * 2 + ph) * a;
        h[y * N + x] = v;
      }
    const c = canvas(N, N);
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x - 1 + N) % N)];
        const dy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
        const nx = -dx * 0.6,
          ny = -dy * 0.6,
          nz = 1;
        const l = Math.hypot(nx, ny, nz);
        const i = (y * N + x) * 4;
        img.data[i] = ((nx / l) * 0.5 + 0.5) * 255;
        img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
        img.data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return (cache.waterN = tex(c, 1, false));
  },
  glow() {
    if (cache.glow) return cache.glow;
    const c = canvas(128, 128);
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    return (cache.glow = t);
  },
  beam() {
    if (cache.beam) return cache.beam;
    const c = canvas(4, 128);
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 128);
    return (cache.beam = new THREE.CanvasTexture(c));
  },
  sign(text: string, color: number, w = 512, h = 128): THREE.Texture {
    const k = `sign:${text}:${color}:${w}x${h}`;
    if (cache[k]) return cache[k];
    const c = canvas(w, h);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#0b0b12';
    ctx.fillRect(0, 0, w, h);
    const col = '#' + color.toString(16).padStart(6, '0');
    ctx.font = `bold ${Math.floor(h * 0.62)}px Rajdhani, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = col;
    ctx.shadowBlur = h * 0.18;
    ctx.fillStyle = col;
    let size = Math.floor(h * 0.62);
    while (ctx.measureText(text).width > w * 0.92 && size > 10) {
      size -= 2;
      ctx.font = `bold ${size}px Rajdhani, Arial, sans-serif`;
    }
    ctx.fillText(text, w / 2, h / 2 + 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.6;
    ctx.fillText(text, w / 2, h / 2 + 2);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return (cache[k] = t);
  },
  billboard(text: string, color: number): THREE.Texture {
    const k = `bb:${text}:${color}`;
    if (cache[k]) return cache[k];
    const c = canvas(512, 220);
    const ctx = c.getContext('2d')!;
    const col = '#' + color.toString(16).padStart(6, '0');
    const g = ctx.createLinearGradient(0, 0, 512, 220);
    g.addColorStop(0, '#14102a');
    g.addColorStop(1, col);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 220);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 8; i++) ctx.fillRect(0, i * 28, 512, 2);
    ctx.font = 'bold 78px Rajdhani, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = col;
    ctx.shadowBlur = 20;
    let size = 78;
    while (ctx.measureText(text).width > 470 && size > 20) {
      size -= 4;
      ctx.font = `bold ${size}px Rajdhani, Arial, sans-serif`;
    }
    ctx.fillText(text, 256, 100);
    ctx.font = '600 26px Rajdhani, Arial, sans-serif';
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('NEON BAY • LIVE LOUD', 256, 175);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return (cache[k] = t);
  },
};

export interface WindowParams {
  cellW: number;
  cellH: number;
  frameX: number;
  frameY: number;
  glass: number;
  lit: number;
  cool: number;
  bandOnly?: boolean;
}

/** MeshStandardMaterial with procedural world-space windows that glow at night. */
export function buildingMaterial(p: WindowParams, rough = 0.85, metal = 0.05) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: metal });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = worldUniforms.uNight;
    shader.uniforms.uWet = worldUniforms.uWet;
    shader.uniforms.uWinA = { value: new THREE.Vector4(p.cellW, p.cellH, p.frameX, p.frameY) };
    shader.uniforms.uWinB = { value: new THREE.Vector4(p.glass, p.lit, p.cool, p.bandOnly ? 1 : 0) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vNbPos;\nvarying vec3 vNbN;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 nbW = vec4(transformed, 1.0);
        vec3 nbN = objectNormal;
        #ifdef USE_INSTANCING
          nbW = instanceMatrix * nbW;
          nbN = mat3(instanceMatrix) * nbN;
        #endif
        nbW = modelMatrix * nbW;
        vNbPos = nbW.xyz;
        vNbN = normalize(mat3(modelMatrix) * nbN);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vNbPos; varying vec3 vNbN;
        uniform float uNight; uniform float uWet; uniform vec4 uWinA; uniform vec4 uWinB;
        float nbHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 nbn = normalize(vNbN);
        float nbSide = 1.0 - step(0.5, abs(nbn.y));
        bool nbAxisX = abs(nbn.x) > 0.5;
        vec2 nbUV = vec2(nbAxisX ? vNbPos.z : vNbPos.x, vNbPos.y);
        float nbPlane = nbAxisX ? vNbPos.x : vNbPos.z;
        vec2 nbCell = nbUV / uWinA.xy;
        vec2 nbF = fract(nbCell);
        vec2 nbId = floor(nbCell);
        float nbWin = step(uWinA.z, nbF.x) * step(nbF.x, 1.0 - uWinA.z) * step(uWinA.w, nbF.y) * step(nbF.y, 1.0 - uWinA.w * 0.6);
        nbWin *= nbSide * step(1.4, vNbPos.y);
        if (uWinB.w > 0.5) nbWin *= step(0.55, nbF.y);
        float nbR = nbHash(nbId + vec2(floor(nbPlane * 0.37) * 7.13, nbn.x * 3.0 + nbn.z * 5.0));
        float nbR2 = nbHash(nbId * 1.7 + 3.1);
        vec3 nbGlass = mix(vec3(0.05, 0.07, 0.1), vec3(0.12, 0.18, 0.24), nbR2);
        diffuseColor.rgb = mix(diffuseColor.rgb, nbGlass, nbWin * uWinB.x);
        diffuseColor.rgb *= 1.0 - uWet * 0.25 * (1.0 - nbSide);
        float nbLit = step(1.0 - uWinB.y, nbR) * uNight;
        vec3 nbWarm = mix(vec3(1.0, 0.72, 0.4), vec3(0.65, 0.82, 1.0), step(1.0 - uWinB.z, nbR2));
        nbWarm = mix(nbWarm, vec3(1.0, 0.35, 0.8), step(0.93, nbR2) * uWinB.z);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, nbWin * uWinB.x);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += nbWin * nbLit * nbWarm * (0.9 + nbR2 * 0.9);`,
      );
  };
  mat.customProgramCacheKey = () => `bld-${p.cellW}-${p.cellH}-${p.frameX}-${p.frameY}-${p.glass}-${p.lit}-${p.cool}-${p.bandOnly}`;
  return mat;
}

/** Ground material that darkens and gets glossy in the rain. */
export function wetGroundMaterial(map: THREE.Texture, color = 0xffffff, rough = 0.95) {
  const m = new THREE.MeshStandardMaterial({ map, color, roughness: rough, metalness: 0.0 });
  m.userData.baseRough = rough;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = worldUniforms.uWet;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= 1.0 - uWet * 0.35;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.18, uWet);');
  };
  m.customProgramCacheKey = () => 'wetground';
  return m;
}

export const sharedMats = {
  dark: new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.8 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.4, metalness: 0.7 }),
  white: new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0xa8a49c, roughness: 0.9 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6e4a2f, roughness: 0.9 }),
};
