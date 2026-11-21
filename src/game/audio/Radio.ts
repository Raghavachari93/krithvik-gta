/** Procedural in-car radio: a tiny step sequencer with drums, bass, pads and an arpeggiated lead. */

interface Station {
  name: string;
  bpm: number;
  root: number; // midi
  prog: number[][]; // chord tones (semitones from root)
  kick: number[];
  snare: number[];
  hat: number[];
  bassPat: number[];
  arp: number[];
  leadType: OscillatorType;
  swing: number;
}

const STATIONS: Station[] = [
  {
    name: 'NEON FM 88.4 — Synthwave',
    bpm: 98,
    root: 45,
    prog: [
      [0, 3, 7],
      [-4, 0, 3],
      [3, 7, 10],
      [-2, 2, 5],
    ],
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1],
    bassPat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
    arp: [0, 1, 2, 1, 0, 1, 2, 3],
    leadType: 'sawtooth',
    swing: 0,
  },
  {
    name: 'BAY BEATS 101.7 — House',
    bpm: 122,
    root: 41,
    prog: [
      [0, 4, 7],
      [5, 9, 12],
      [-3, 0, 4],
      [7, 11, 14],
    ],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
    hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    bassPat: [0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0],
    arp: [2, 1, 0, 1, 2, 3, 2, 1],
    leadType: 'square',
    swing: 0.08,
  },
  {
    name: 'LOWTIDE 94.1 — Chill',
    bpm: 84,
    root: 48,
    prog: [
      [0, 4, 11],
      [-3, 0, 7],
      [2, 5, 9],
      [-5, -1, 2],
    ],
    kick: [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    bassPat: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    arp: [0, 2, 1, 2, 0, 2, 1, 3],
    leadType: 'triangle',
    swing: 0.12,
  },
];

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Radio {
  station = 0; // -1 = off
  private active = false;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  private out: GainNode;
  onStation: ((name: string) => void) | null = null;

  constructor(private ctx: AudioContext, dest: AudioNode, private noise: AudioBuffer) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
  }

  get name() {
    return this.station < 0 ? 'Radio Off' : STATIONS[this.station].name;
  }

  next() {
    this.station = this.station + 1 >= STATIONS.length ? -1 : this.station + 1;
    this.step = 0;
    this.bar = 0;
    this.onStation?.(this.name);
  }

  setActive(on: boolean) {
    const want = on && this.station >= 0;
    if (want !== this.active) {
      this.active = want;
      const t = this.ctx.currentTime;
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setTargetAtTime(want ? 0.5 : 0, t, 0.3);
      if (want) {
        this.nextTime = t + 0.1;
        this.onStation?.(this.name);
      }
    }
  }

  tick() {
    if (!this.active) return;
    const st = STATIONS[this.station];
    const stepDur = 60 / st.bpm / 4;
    const ahead = this.ctx.currentTime + 0.15;
    while (this.nextTime < ahead) {
      const swing = this.step % 2 === 1 ? st.swing * stepDur : 0;
      this.playStep(st, this.step, this.nextTime + swing);
      this.nextTime += stepDur;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar = (this.bar + 1) % (st.prog.length * 2);
    }
  }

  private env(t: number, a: number, d: number, vol: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    g.connect(this.out);
    return g;
  }

  private playStep(st: Station, s: number, t: number) {
    const ctx = this.ctx;
    const chord = st.prog[Math.floor(this.bar / 2) % st.prog.length];
    if (st.kick[s]) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
      o.connect(this.env(t, 0.002, 0.3, 0.9));
      o.start(t);
      o.stop(t + 0.35);
    }
    if (st.snare[s]) {
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1800;
      n.connect(f).connect(this.env(t, 0.002, 0.18, 0.35));
      n.start(t, Math.random());
      n.stop(t + 0.22);
    }
    if (st.hat[s]) {
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 7000;
      n.connect(f).connect(this.env(t, 0.001, 0.05, 0.12));
      n.start(t, Math.random());
      n.stop(t + 0.07);
    }
    if (st.bassPat[s]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(st.root + chord[0] - 12 + (s % 8 === 6 ? 12 : 0));
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(900, t);
      f.frequency.exponentialRampToValueAtTime(200, t + 0.2);
      o.connect(f).connect(this.env(t, 0.005, 0.22, 0.28));
      o.start(t);
      o.stop(t + 0.3);
    }
    // pad on bar start
    if (s === 0 && this.bar % 2 === 0) {
      for (const n of chord) {
        for (const det of [-6, 6]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = mtof(st.root + 12 + n);
          o.detune.value = det;
          const f = ctx.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.value = 1100;
          const g = ctx.createGain();
          const dur = (60 / st.bpm) * 8;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.035, t + 0.6);
          g.gain.linearRampToValueAtTime(0.0001, t + dur);
          o.connect(f).connect(g).connect(this.out);
          o.start(t);
          o.stop(t + dur + 0.1);
        }
      }
    }
    // arp lead on 8ths in second half of each 2 bars
    if (s % 2 === 0 && this.bar % 2 === 1) {
      const idx = st.arp[(s / 2) % st.arp.length];
      const note = idx < 3 ? chord[idx] : chord[0] + 12;
      const o = ctx.createOscillator();
      o.type = st.leadType;
      o.frequency.value = mtof(st.root + 24 + note);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2600;
      o.connect(f).connect(this.env(t, 0.005, 0.25, 0.07));
      o.start(t);
      o.stop(t + 0.3);
    }
  }
}
