export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export function dampAngle(a: number, b: number, rate: number, dt: number) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt));
}

export function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  private r: () => number;
  constructor(seed: number) {
    this.r = mulberry32(seed);
  }
  next() {
    return this.r();
  }
  range(a: number, b: number) {
    return a + (b - a) * this.r();
  }
  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.r() * arr.length)];
  }
  chance(p: number) {
    return this.r() < p;
  }
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p: number) => Math.random() < p;

export function dist2(ax: number, az: number, bx: number, bz: number) {
  const dx = ax - bx,
    dz = az - bz;
  return dx * dx + dz * dz;
}
export function dist(ax: number, az: number, bx: number, bz: number) {
  return Math.sqrt(dist2(ax, az, bx, bz));
}

export function formatMoney(n: number) {
  return '$' + Math.floor(n).toLocaleString('en-US');
}
export function formatTime(s: number) {
  if (!isFinite(s)) return '--:--';
  const neg = s < 0;
  s = Math.abs(s);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const t = Math.floor((s * 10) % 10);
  return `${neg ? '-' : ''}${m}:${sec.toString().padStart(2, '0')}.${t}`;
}

/** forward vector for a yaw angle (yaw 0 => +Z) */
export const fwdX = (yaw: number) => Math.sin(yaw);
export const fwdZ = (yaw: number) => Math.cos(yaw);
/** right vector for a yaw angle */
export const rightX = (yaw: number) => -Math.cos(yaw);
export const rightZ = (yaw: number) => Math.sin(yaw);
export const yawTo = (dx: number, dz: number) => Math.atan2(dx, dz);
