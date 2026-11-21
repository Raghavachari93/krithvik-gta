import { create } from 'zustand';

export type Screen =
  | 'loading'
  | 'menu'
  | 'charselect'
  | 'settings'
  | 'controls'
  | 'playing'
  | 'paused'
  | 'map'
  | 'inventory'
  | 'missionIntro'
  | 'missionResult'
  | 'shop'
  | 'busted'
  | 'wasted'
  | 'stats';

export type NoteKind = 'info' | 'good' | 'bad' | 'warn' | 'money' | 'achievement';
export interface Note {
  id: number;
  text: string;
  kind: NoteKind;
  t: number;
}

export interface Settings {
  quality: 'low' | 'medium' | 'high';
  shadows: boolean;
  bloom: boolean;
  drawDistance: number;
  pedDensity: number;
  trafficDensity: number;
  mouseSens: number;
  invertY: boolean;
  fov: number;
  master: number;
  music: number;
  sfx: number;
  ambient: number;
  showFps: boolean;
  weather: 'dynamic' | 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';
  timeSpeed: number;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'medium',
  shadows: true,
  bloom: true,
  drawDistance: 1400,
  pedDensity: 1,
  trafficDensity: 1,
  mouseSens: 1,
  invertY: false,
  fov: 70,
  master: 0.8,
  music: 0.6,
  sfx: 0.9,
  ambient: 0.7,
  showFps: false,
  weather: 'dynamic',
  timeSpeed: 1,
};

export interface Hud {
  health: number;
  maxHealth: number;
  armor: number;
  stamina: number;
  cash: number;
  wanted: number;
  searching: boolean;
  inVehicle: boolean;
  speed: number;
  vehicleName: string;
  vehicleHealth: number;
  fuel: number;
  gear: number;
  rpm: number;
  weapon: string;
  weaponId: string;
  clip: number;
  ammo: number;
  melee: boolean;
  objective: string;
  objectiveDetail: string;
  timer: number | null;
  prompt: string | null;
  district: string;
  street: string;
  time: string;
  weather: string;
  radio: string;
  missionActive: boolean;
  activityName: string;
  fps: number;
  aiming: boolean;
  letterbox: boolean;
  countdown: number | null;
  race: { pos: number; total: number; cp: number; cps: number } | null;
  drift: { score: number; combo: number; goal: number } | null;
  reloading: boolean;
  medkits: number;
}

export interface ShopItem {
  id: string;
  name: string;
  desc?: string;
  price?: number;
  disabled?: boolean;
  tag?: string;
}
export interface ShopData {
  title: string;
  subtitle: string;
  accent: string;
  items: ShopItem[];
  onSelect: (id: string) => void;
}

export interface MissionIntroData {
  title: string;
  type: string;
  giver: string;
  intro: string;
  objective: string;
  instructions: string[];
  reward: string;
  accept: () => void;
  decline: () => void;
  isActivity?: boolean;
}

export interface MissionResultData {
  success: boolean;
  title: string;
  reason?: string;
  reward?: string;
  lines: string[];
  retry?: () => void;
}

export interface UIState {
  screen: Screen;
  prevScreen: Screen;
  hud: Hud;
  notes: Note[];
  subtitle: { speaker: string; text: string; id: number } | null;
  big: { title: string; sub: string; color: string; id: number } | null;
  damage: { angle: number; k: number; id: number } | null;
  hitId: number;
  intro: MissionIntroData | null;
  result: MissionResultData | null;
  shop: ShopData | null;
  settings: Settings;
  hasSave: boolean;
  loadingText: string;
  loadingPct: number;
  set: (p: Partial<UIState>) => void;
  setHud: (p: Partial<Hud>) => void;
}

const emptyHud: Hud = {
  health: 100,
  maxHealth: 100,
  armor: 0,
  stamina: 100,
  cash: 0,
  wanted: 0,
  searching: false,
  inVehicle: false,
  speed: 0,
  vehicleName: '',
  vehicleHealth: 1,
  fuel: 1,
  gear: 1,
  rpm: 0,
  weapon: 'Fists',
  weaponId: 'fists',
  clip: 0,
  ammo: 0,
  melee: true,
  objective: '',
  objectiveDetail: '',
  timer: null,
  prompt: null,
  district: '',
  street: '',
  time: '',
  weather: '',
  radio: '',
  missionActive: false,
  activityName: '',
  fps: 0,
  aiming: false,
  letterbox: false,
  countdown: null,
  race: null,
  drift: null,
  reloading: false,
  medkits: 0,
};

function loadSettings(): Settings {
  try {
    const s = localStorage.getItem('neonbay.settings');
    if (s) return { ...DEFAULT_SETTINGS, ...JSON.parse(s) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

export const useUI = create<UIState>((set) => ({
  screen: 'loading',
  prevScreen: 'menu',
  hud: emptyHud,
  notes: [],
  subtitle: null,
  big: null,
  damage: null,
  hitId: 0,
  intro: null,
  result: null,
  shop: null,
  settings: loadSettings(),
  hasSave: false,
  loadingText: 'Building Neon Bay...',
  loadingPct: 0,
  set: (p) => set(p),
  setHud: (p) => set((s) => ({ hud: { ...s.hud, ...p } })),
}));

let NID = 1;

/** Imperative bridge the game uses to talk to React. */
export class UIBridge {
  get state() {
    return useUI.getState();
  }
  setScreen(screen: Screen) {
    const s = useUI.getState();
    if (s.screen === screen) return;
    useUI.setState({ prevScreen: s.screen, screen });
  }
  notify(text: string, kind: NoteKind = 'info') {
    const notes = [...useUI.getState().notes, { id: NID++, text, kind, t: performance.now() }].slice(-5);
    useUI.setState({ notes });
  }
  private lastPrompt: string | null = null;
  setPrompt(label: string | null) {
    if (label === this.lastPrompt) return;
    this.lastPrompt = label;
    useUI.getState().setHud({ prompt: label });
  }
  subtitle(speaker: string, text: string) {
    useUI.setState({ subtitle: { speaker, text, id: NID++ } });
  }
  bigMessage(title: string, sub = '', color = '#ffd27a') {
    useUI.setState({ big: { title, sub, color, id: NID++ } });
  }
  damageFlash(angle: number, k: number) {
    useUI.setState({ damage: { angle, k, id: NID++ } });
  }
  hitMarker() {
    useUI.setState({ hitId: NID++ });
  }
  hud(p: Partial<Hud>) {
    useUI.getState().setHud(p);
  }
}
