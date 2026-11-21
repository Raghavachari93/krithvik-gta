import * as THREE from 'three';
import { WATER_Y, terrainY } from '../constants';
import { clamp, damp } from '../core/math';
import type { Game } from '../Game';
import { Radio } from './Radio';

type V3 = { x: number; y: number; z: number };

/** Fully procedural WebAudio: engines, tyres, sirens, ambience, weather, SFX and in-car radio. */
export class AudioSystem {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  amb!: GainNode;
  musicBus!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private engine: { o1: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode } | null = null;
  private screech: { f: BiquadFilterNode; g: GainNode } | null = null;
  private city: GainNode | null = null;
  private ocean: GainNode | null = null;
  private rain: GainNode | null = null;
  private wind: GainNode | null = null;
  private traffic: GainNode | null = null;
  private siren: { o: OscillatorNode; g: GainNode; p: StereoPannerNode } | null = null;
  private listener = new THREE.Vector3();
  private right = new THREE.Vector3();
  radio: Radio | null = null;
  private ambT = 0;
  private oceanAmt = 0;
  private sampleT = 0;
  volumes = { master: 0.8, sfx: 0.9, music: 0.6, ambient: 0.7 };
  private sirenPhase = 0;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(this.master);
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfx.connect(comp);
    this.amb.connect(comp);
    this.musicBus.connect(comp);
    // noise buffers
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
    this.applyVolumes();
    this.setupLoops();
    this.radio = new Radio(ctx, this.musicBus, this.noise);
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.sfx.gain.value = this.volumes.sfx;
    this.musicBus.gain.value = this.volumes.music;
    this.amb.gain.value = this.volumes.ambient;
  }

  private loopNoise(buf: AudioBuffer, type: BiquadFilterType, freq: number, q = 0.7, out: AudioNode = this.amb) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(out);
    src.start();
    return { f, g };
  }

  private setupLoops() {
    const ctx = this.ctx!;
    this.city = this.loopNoise(this.brown, 'lowpass', 500).g;
    this.traffic = this.loopNoise(this.brown, 'lowpass', 180, 1).g;
    const oc = this.loopNoise(this.brown, 'lowpass', 900);
    this.ocean = oc.g;
    // ocean swell LFO
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lg = ctx.createGain();
    lg.gain.value = 350;
    lfo.connect(lg).connect(oc.f.frequency);
    lfo.start();
    this.rain = this.loopNoise(this.noise, 'highpass', 2500).g;
    this.wind = this.loopNoise(this.brown, 'bandpass', 300, 0.5).g;
    // engine
    const o1 = ctx.createOscillator(),
      o2 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'square';
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.value = 0;
    const g2 = ctx.createGain();
    g2.gain.value = 0.4;
    o1.connect(f);
    o2.connect(g2).connect(f);
    f.connect(g).connect(this.sfx);
    o1.start();
    o2.start();
    this.engine = { o1, o2, f, g };
    this.screech = this.loopNoise(this.noise, 'bandpass', 1800, 6, this.sfx);
    const so = ctx.createOscillator();
    so.type = 'sawtooth';
    const sf = ctx.createBiquadFilter();
    sf.type = 'lowpass';
    sf.frequency.value = 2200;
    const sg = ctx.createGain();
    sg.gain.value = 0;
    const sp = ctx.createStereoPanner();
    so.connect(sf).connect(sg).connect(sp).connect(this.sfx);
    so.start();
    this.siren = { o: so, g: sg, p: sp };
  }

  // ---------- spatial helper ----------
  private spatial(p: V3 | null, maxD = 120): { gain: number; pan: number } {
    if (!p) return { gain: 1, pan: 0 };
    const dx = p.x - this.listener.x,
      dy = p.y - this.listener.y,
      dz = p.z - this.listener.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const gain = clamp(1 - d / maxD, 0, 1) ** 2;
    const pan = d > 0.1 ? clamp((dx * this.right.x + dz * this.right.z) / d, -1, 1) * 0.8 : 0;
    return { gain, pan };
  }

  private out(p: V3 | null, maxD = 120, vol = 1): AudioNode | null {
    if (!this.ctx) return null;
    const s = this.spatial(p, maxD);
    if (s.gain * vol < 0.005) return null;
    const g = this.ctx.createGain();
    g.gain.value = s.gain * vol;
    const pn = this.ctx.createStereoPanner();
    pn.pan.value = s.pan;
    g.connect(pn).connect(this.sfx);
    return g;
  }

  private burst(dest: AudioNode, dur: number, type: BiquadFilterType, freq: number, vol: number, q = 1, freqEnd?: number, buf = this.noise) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private tone(dest: AudioNode, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---------- one-shots ----------
  footstep(p: V3, v = 0.5) {
    const o = this.out(p, 25, 0.25 * v);
    if (o) this.burst(o, 0.07, 'bandpass', 900 + Math.random() * 600, 1, 1.2);
  }
  whoosh(p: V3) {
    const o = this.out(p, 20, 0.3);
    if (o) this.burst(o, 0.18, 'bandpass', 500, 0.8, 1.5, 1800);
  }
  punch(p: V3, heavy = false) {
    const o = this.out(p, 40, heavy ? 0.9 : 0.6);
    if (!o) return;
    this.tone(o, 'sine', 140, 50, 0.14, 1);
    this.burst(o, 0.08, 'lowpass', 1200, 0.9);
  }
  gunshot(p: V3, kind: string) {
    const o = this.out(p, 260, kind === 'shotgun' ? 1.2 : kind === 'smg' ? 0.6 : 0.85);
    if (!o) return;
    const dur = kind === 'shotgun' ? 0.45 : kind === 'smg' ? 0.09 : 0.22;
    this.burst(o, dur, 'lowpass', kind === 'shotgun' ? 2200 : 4200, 1.2, 0.8, 300);
    this.tone(o, 'sine', kind === 'shotgun' ? 90 : 130, 40, dur * 0.8, 0.9);
  }
  impact(p: V3) {
    const o = this.out(p, 40, 0.25);
    if (o) this.burst(o, 0.05, 'highpass', 3000, 0.7);
  }
  explosion(p: V3) {
    const o = this.out(p, 600, 1.5);
    if (!o) return;
    this.burst(o, 2.2, 'lowpass', 1400, 1.4, 0.7, 120, this.brown);
    this.burst(o, 0.6, 'lowpass', 3000, 1.0, 0.7, 300);
    this.tone(o, 'sine', 70, 25, 1.5, 1.2);
  }
  crash(p: V3, k: number) {
    const o = this.out(p, 140, 0.4 + k * 0.8);
    if (!o) return;
    this.burst(o, 0.25 + k * 0.4, 'bandpass', 700, 1.1, 0.9, 200);
    this.tone(o, 'square', 320 + Math.random() * 200, 180, 0.3, 0.15);
    this.tone(o, 'sine', 90, 40, 0.25, 0.8);
  }
  thud(p: V3, k: number) {
    const o = this.out(p, 60, 0.6 * k);
    if (o) this.tone(o, 'sine', 90, 35, 0.2, 1);
  }
  horn(p: V3, player = false) {
    const o = this.out(p, 150, player ? 0.5 : 0.35);
    if (!o) return;
    const base = player ? 380 : 330 + Math.random() * 120;
    this.tone(o, 'square', base, base, 0.45, 0.25);
    this.tone(o, 'square', base * 1.26, base * 1.26, 0.45, 0.2);
  }
  splash(p: V3, k: number) {
    const o = this.out(p, 80, 0.7 * k);
    if (o) this.burst(o, 0.7, 'lowpass', 2500, 1, 0.7, 300);
  }
  door(p: V3) {
    const o = this.out(p, 30, 0.4);
    if (!o) return;
    this.tone(o, 'sine', 160, 70, 0.1, 0.8);
    this.burst(o, 0.05, 'highpass', 2000, 0.5);
  }
  click() {
    const o = this.out(null, 1, 0.4);
    if (o) this.burst(o, 0.03, 'highpass', 4000, 1);
  }
  reload() {
    const o = this.out(null, 1, 0.4);
    if (!o) return;
    this.burst(o, 0.04, 'highpass', 3000, 1);
    setTimeout(() => this.ctx && this.burst(o, 0.05, 'bandpass', 1500, 1, 2), 500);
  }
  pickup() {
    const o = this.out(null, 1, 0.35);
    if (!o) return;
    [660, 880, 1320].forEach((f, i) => this.tone(o, 'triangle', f, f, 0.18, 0.5, i * 0.06));
  }
  cash() {
    const o = this.out(null, 1, 0.35);
    if (!o) return;
    this.tone(o, 'sine', 1800, 1800, 0.08, 0.5);
    this.tone(o, 'sine', 2400, 2400, 0.25, 0.5, 0.07);
  }
  ui() {
    const o = this.out(null, 1, 0.2);
    if (o) this.tone(o, 'triangle', 900, 1200, 0.06, 0.6);
  }
  jingle(success: boolean) {
    const o = this.out(null, 1, 0.5);
    if (!o) return;
    const notes = success ? [523, 659, 784, 1047, 1319] : [440, 392, 330, 262];
    notes.forEach((f, i) => {
      this.tone(o, 'triangle', f, f, 0.5, 0.45, i * 0.12);
      this.tone(o, 'sawtooth', f / 2, f / 2, 0.4, 0.12, i * 0.12);
    });
  }
  wantedUp() {
    const o = this.out(null, 1, 0.3);
    if (!o) return;
    this.tone(o, 'square', 880, 880, 0.12, 0.3);
    this.tone(o, 'square', 660, 660, 0.18, 0.3, 0.13);
  }
  thunder(delay: number) {
    if (!this.ctx) return;
    setTimeout(() => {
      const o = this.out(null, 1, 0.9);
      if (o) this.burst(o, 3.5, 'lowpass', 600, 1.2, 0.5, 60, this.brown);
    }, delay * 1000);
  }
  babble(p: V3, pitch = 1) {
    const o = this.out(p, 18, 0.25);
    if (!o) return;
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const f = (180 + Math.random() * 160) * pitch;
      this.tone(o, 'sawtooth', f, f * (0.85 + Math.random() * 0.3), 0.09, 0.18, i * 0.11);
    }
  }
  scream(p: V3) {
    const o = this.out(p, 50, 0.3);
    if (o) this.tone(o, 'sawtooth', 700 + Math.random() * 300, 450, 0.6, 0.25);
  }

  nextStation() {
    this.radio?.next();
  }

  // ---------- continuous ----------
  update(dt: number, g: Game) {
    if (!this.ctx) return;
    const cam = g.camera;
    this.listener.copy(cam.position);
    cam.getWorldDirection(this.right);
    this.right.set(-this.right.z, 0, this.right.x).normalize();
    const t = this.ctx.currentTime;
    const v = g.player.vehicle;
    const playing = g.state === 'playing';
    // engine
    if (this.engine) {
      if (v && playing && !v.destroyed) {
        const base = v.spec.engineBase;
        const f = base * (0.55 + v.rpm * 3.4);
        this.engine.o1.frequency.setTargetAtTime(f, t, 0.05);
        this.engine.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
        this.engine.f.frequency.setTargetAtTime(300 + v.rpm * 2400 + v.input.throttle * 900, t, 0.05);
        this.engine.g.gain.setTargetAtTime(v.rpm > 0.01 ? 0.05 + v.input.throttle * 0.07 + v.rpm * 0.03 : 0, t, 0.08);
      } else this.engine.g.gain.setTargetAtTime(0, t, 0.1);
    }
    if (this.screech) {
      const k = v && playing && v.grounded && !v.spec.boat && v.speed > 4 ? clamp((v.slip - 3.5) / 7, 0, 1) : 0;
      this.screech.g.gain.setTargetAtTime(k * 0.22, t, 0.05);
      this.screech.f.frequency.setTargetAtTime(1500 + k * 900, t, 0.1);
    }
    // siren: nearest police vehicle with siren on
    if (this.siren) {
      let best: { pos: V3 } | null = null,
        bd = 1e9;
      for (const pv of g.vehicles.list) {
        if (!pv.sirenOn || pv.destroyed) continue;
        const d = pv.pos.distanceToSquared(this.listener);
        if (d < bd) {
          bd = d;
          best = pv;
        }
      }
      this.sirenPhase += dt;
      if (best && playing) {
        const s = this.spatial(best.pos, 260);
        const wail = 650 + (Math.sin(this.sirenPhase * 2.1) * 0.5 + 0.5) * 650;
        this.siren.o.frequency.setTargetAtTime(wail, t, 0.03);
        this.siren.g.gain.setTargetAtTime(s.gain * 0.12, t, 0.1);
        this.siren.p.pan.setTargetAtTime(s.pan, t, 0.1);
      } else this.siren.g.gain.setTargetAtTime(0, t, 0.2);
    }
    // ambience
    const env = g.env;
    const day = 1 - env.night;
    this.sampleT -= dt;
    if (this.sampleT <= 0) {
      this.sampleT = 0.5;
      let water = 0;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        if (terrainY(this.listener.x + Math.cos(a) * 60, this.listener.z + Math.sin(a) * 60) < WATER_Y) water++;
      }
      this.oceanAmt = water / 8;
    }
    const menuK = g.state === 'menu' ? 0.6 : 1;
    const nearTraffic = Math.min(1, g.vehicles.list.filter((x) => x.driver === 'ai' && x.pos.distanceToSquared(this.listener) < 3600).length / 8);
    this.city!.gain.setTargetAtTime((0.05 + day * 0.07) * menuK * (1 - this.oceanAmt * 0.5), t, 0.5);
    this.traffic!.gain.setTargetAtTime(nearTraffic * 0.16 * menuK, t, 0.5);
    this.ocean!.gain.setTargetAtTime(this.oceanAmt * 0.32, t, 0.5);
    this.rain!.gain.setTargetAtTime(env.rain * 0.18, t, 0.5);
    this.wind!.gain.setTargetAtTime(0.02 + (this.listener.y > 30 ? 0.12 : 0) + (env.weather === 'storm' ? 0.1 : 0) + (v ? damp(0, v.speed / 60, 1, 1) * 0.08 : 0), t, 0.5);
    // random ambient events
    this.ambT -= dt;
    if (this.ambT <= 0 && playing) {
      this.ambT = 2 + Math.random() * 5;
      const far = { x: this.listener.x + (Math.random() - 0.5) * 160, y: this.listener.y, z: this.listener.z + (Math.random() - 0.5) * 160 };
      const r = Math.random();
      if (env.night < 0.5 && r < 0.4 && this.oceanAmt < 0.7) this.bird();
      else if (env.night > 0.6 && r < 0.4) this.cricket();
      else if (r < 0.7) this.horn(far);
      else if (r < 0.8) this.distantSiren();
      else if (this.oceanAmt > 0.3) this.gull();
    }
    // radio
    if (this.radio) {
      const on = !!v && playing && !v.destroyed;
      this.radio.setActive(on);
      this.radio.tick();
    }
  }

  private bird() {
    const o = this.out(null, 1, 0.05);
    if (!o) return;
    const f = 2500 + Math.random() * 2000;
    for (let i = 0; i < 3; i++) this.tone(o, 'sine', f, f * 1.3, 0.08, 0.5, i * 0.12);
  }
  private gull() {
    const o = this.out(null, 1, 0.06);
    if (o) this.tone(o, 'sawtooth', 1400, 900, 0.4, 0.3);
  }
  private cricket() {
    const o = this.out(null, 1, 0.03);
    if (!o) return;
    for (let i = 0; i < 6; i++) this.tone(o, 'sine', 4800, 4800, 0.03, 0.5, i * 0.06);
  }
  private distantSiren() {
    const o = this.out(null, 1, 0.03);
    if (!o || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.6);
    g.gain.linearRampToValueAtTime(0, t + 3);
    for (let i = 0; i < 4; i++) {
      osc.frequency.setValueAtTime(600, t + i * 0.75);
      osc.frequency.linearRampToValueAtTime(1200, t + i * 0.75 + 0.37);
    }
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    osc.connect(f).connect(g).connect(o);
    osc.start(t);
    osc.stop(t + 3.1);
  }
}
