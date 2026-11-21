import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** Final colour grade: a little extra saturation and contrast so the city pops in daylight. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.22 }, uContrast: { value: 1.08 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat; uniform float uContrast; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.2126,0.7152,0.0722));
      vec3 col = mix(vec3(l), c.rgb, uSat); col = (col - 0.5) * uContrast + 0.5; gl_FragColor = vec4(clamp(col,0.0,1.0), c.a); }`,
};
import { DISTRICT_NAMES, districtOf, locateBlock, inRect, AIRPORT, ISLAND, PORT, BEACH, ROAD_HALF, roadC } from './constants';
import { CRAZY_IDS, PLANE_IDS, VEHICLES } from './vehicles/VehicleSpecs';
import { clamp, formatMoney } from './core/math';
import { Input } from './core/Input';
import { CollisionWorld } from './world/Collision';
import { CityLayout } from './world/CityLayout';
import { CityBuilder } from './world/CityBuilder';
import { PropSystem } from './world/Props';
import { TrafficLights } from './world/TrafficLights';
import { Environment, WEATHER_LABEL, Weather } from './systems/Environment';
import { Effects } from './fx/Effects';
import { AudioSystem } from './audio/AudioSystem';
import { Player } from './player/Player';
import { CameraRig } from './camera/CameraRig';
import { VehicleManager } from './vehicles/VehicleManager';
import { TrafficManager } from './ai/Traffic';
import { PedManager } from './ai/PedManager';
import { PoliceManager } from './ai/Police';
import { WantedSystem } from './systems/Wanted';
import { CombatSystem } from './combat/Combat';
import { MarkerSystem } from './systems/Markers';
import { Navigation } from './systems/Navigation';
import { InteractionSystem } from './systems/Interaction';
import { Pickups } from './systems/Pickups';
import { Progression } from './systems/Progression';
import { SaveSystem } from './systems/SaveSystem';
import { MissionManager } from './missions/MissionManager';
import { ActivityManager } from './activities/Activities';
import { Services } from './systems/Services';
import { ROSTER, characterById } from './characters/Roster';
import { Actor } from './characters/Actor';
import { WEAPONS, WeaponId, newInventory } from './combat/Weapons';
import type { Vehicle } from './vehicles/Vehicle';
import { MissionIntroData, MissionResultData, Settings, ShopData, UIBridge, useUI } from '../ui/store';

export type GameState = 'loading' | 'menu' | 'playing' | 'overlay' | 'cutscene' | 'dead';

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  input: Input;
  col = new CollisionWorld();
  layout!: CityLayout;
  city!: CityBuilder;
  props!: PropSystem;
  lights!: TrafficLights;
  env!: Environment;
  fx = new Effects();
  audio = new AudioSystem();
  player!: Player;
  cam!: CameraRig;
  vehicles!: VehicleManager;
  traffic!: TrafficManager;
  peds!: PedManager;
  police!: PoliceManager;
  wanted!: WantedSystem;
  combat!: CombatSystem;
  markers = new MarkerSystem();
  nav!: Navigation;
  interact!: InteractionSystem;
  pickups!: Pickups;
  progress!: Progression;
  save!: SaveSystem;
  missions!: MissionManager;
  activities!: ActivityManager;
  services!: Services;
  ui = new UIBridge();

  state: GameState = 'loading';
  time = 0;
  timeScale = 1;
  focus = new THREE.Vector3();
  freezeVehicle = false;
  cheats = { god: false, noWanted: false };
  lastSafehouse = 'sh_starter';
  garageVehicle: Vehicle | null = null;
  private clock = new THREE.Clock();
  private hudT = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 60;
  private deathT = 0;
  private deathKind: 'wasted' | 'busted' = 'wasted';
  private menuOrbit = 0;
  private ignoreUnlock = false;
  private gpsArrow: THREE.Mesh;
  private headlight: THREE.SpotLight;
  private walkerCache: Actor[] = [];
  private actorCache: Actor[] = [];
  private cacheFrame = -1;
  private frame = 0;
  settings: Settings;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Neutral tone mapping keeps paint and neon colours saturated (ACES washes them out)
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.15, 5000);
    this.input = new Input(this.renderer.domElement);
    this.settings = useUI.getState().settings;
    this.gpsArrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 1.1, 4).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffd000, toneMapped: false, transparent: true, opacity: 0.85, depthTest: false }),
    );
    this.gpsArrow.renderOrder = 10;
    this.headlight = new THREE.SpotLight(0xfff2d8, 0, 60, 0.55, 0.5, 1.2);
    window.addEventListener('resize', () => this.onResize());
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.ignoreUnlock) this.pause();
      this.ignoreUnlock = false;
    };
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state === 'playing') this.input.requestLock();
    });
    (window as unknown as { game: Game }).game = this;
  }

  // ------------------------------------------------------------------ boot
  async boot() {
    const step = async (text: string, pct: number) => {
      useUI.setState({ loadingText: text, loadingPct: pct });
      await new Promise((r) => setTimeout(r, 30));
    };
    await step('Laying out the streets of Neon Bay...', 5);
    this.layout = new CityLayout();
    await step('Raising skyscrapers...', 20);
    this.city = new CityBuilder(this.layout, this.col);
    this.scene.add(this.city.group);
    await step('Installing street lights and traffic signals...', 45);
    this.props = new PropSystem(this.layout.props);
    this.scene.add(this.props.group);
    this.props.onBreak = (p, speed) => {
      this.audio.crash(p, Math.min(1, speed / 25) * 0.5);
      if (p.type === 'hydrant') {
        let n = 0;
        const iv = setInterval(() => {
          this.fx.waterJet(new THREE.Vector3(p.homeX, p.homeY, p.homeZ));
          if (++n > 120) clearInterval(iv);
        }, 50);
      }
    };
    this.lights = new TrafficLights(this.layout);
    this.scene.add(this.lights.group);
    await step('Lighting the sky...', 60);
    this.env = new Environment(this.scene, this.renderer);
    this.env.onThunder = (d) => this.audio.thunder(d);
    this.scene.add(this.fx.group, this.markers.group, this.gpsArrow, this.headlight, this.headlight.target);
    await step('Populating the city...', 70);
    this.nav = new Navigation(this.layout);
    this.player = new Player(ROSTER[0]);
    this.cam = new CameraRig(this.camera);
    this.progress = new Progression(this);
    this.save = new SaveSystem(this);
    this.wanted = new WantedSystem(this);
    this.vehicles = new VehicleManager(this);
    this.traffic = new TrafficManager(this);
    this.peds = new PedManager(this);
    this.police = new PoliceManager(this);
    this.combat = new CombatSystem(this);
    this.interact = new InteractionSystem(this);
    this.pickups = new Pickups(this);
    this.scene.add(this.pickups.group);
    this.missions = new MissionManager(this);
    this.activities = new ActivityManager(this);
    this.services = new Services(this);
    this.services.init();
    await step('Tuning engines...', 85);
    this.applySettings(this.settings);
    // warm up shaders around the menu camera
    this.focus.set(0, 0, 0);
    this.camera.position.set(120, 90, 160);
    this.camera.lookAt(0, 20, 0);
    this.env.update(0.016, this.focus, this.camera);
    this.renderer.compile(this.scene, this.camera);
    await step('Ready', 100);
    this.state = 'menu';
    useUI.setState({ hasSave: this.save.hasSave() });
    this.ui.setScreen('menu');
    this.clock.start();
    this.loop();
  }

  // ------------------------------------------------------------------ settings
  applySettings(s: Settings) {
    this.settings = s;
    const dpr = window.devicePixelRatio || 1;
    const pr = s.quality === 'low' ? Math.min(1, dpr * 0.75) : s.quality === 'medium' ? Math.min(dpr, 1) : Math.min(dpr, 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = s.shadows;
    this.env.setShadowQuality(s.quality === 'high' ? 4096 : s.quality === 'medium' ? 2048 : 1024, s.shadows);
    this.env.drawDistance = s.drawDistance;
    this.env.forced = s.weather === 'dynamic' ? null : (s.weather as Weather);
    this.env.speed = (1 / 50) * s.timeSpeed;
    this.env.lockDay = s.timeOfDay !== 'cycle';
    this.peds.density = s.pedDensity;
    this.traffic.density = s.trafficDensity;
    this.cam.sensitivity = s.mouseSens;
    this.cam.invertY = s.invertY;
    this.cam.setFov(s.fov);
    this.audio.volumes = { master: s.master, music: s.music, sfx: s.sfx, ambient: s.ambient };
    this.audio.applyVolumes();
    if (s.bloom && !this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.55, 0.5, 0.85);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
      this.composer.addPass(new ShaderPass(GradeShader));
    } else if (!s.bloom && this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.bloom = null;
    }
    this.onResize();
    try {
      localStorage.setItem('neonbay.settings', JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }

  private onResize() {
    const w = window.innerWidth,
      h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
    this.fx.setScale(h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) * 0.5);
  }

  // ------------------------------------------------------------------ queries
  controlsEnabled() {
    return this.state === 'playing';
  }

  private refreshCaches() {
    if (this.cacheFrame === this.frame) return;
    this.cacheFrame = this.frame;
    this.actorCache.length = 0;
    this.walkerCache.length = 0;
    if (this.state !== 'menu') {
      this.actorCache.push(this.player);
      if (!this.player.vehicle) this.walkerCache.push(this.player);
    }
    for (const p of this.peds.list) {
      this.actorCache.push(p);
      if (p.alive) this.walkerCache.push(p);
    }
  }
  actors(): Actor[] {
    this.refreshCaches();
    return this.actorCache;
  }
  walkers(): Actor[] {
    this.refreshCaches();
    return this.walkerCache;
  }

  // ------------------------------------------------------------------ flow
  private resetWorld() {
    this.missions.active?.cleanup();
    this.missions.active = null;
    this.activities.abort();
    this.police.clearAll();
    this.wanted.clear(false);
    this.vehicles.clearNonPersistent();
    for (const v of [...this.vehicles.list]) this.vehicles.remove(v);
    this.peds.clearAll();
    this.timeScale = 1;
    this.freezeVehicle = false;
  }

  startNewGame(charId: string) {
    this.audio.init();
    this.resetWorld();
    this.progress.load({} as ReturnType<Progression['serialize']>);
    this.progress.cash = 500;
    this.progress.unlocked = new Set(['comet', 'cab', 'ranger', 'mule', 'viper', 'stallion', 'hauler', 'wave', 'marlin', ...CRAZY_IDS, ...PLANE_IDS]);
    const def = characterById(charId);
    this.player.inv = newInventory();
    this.player.weapon = 'fists';
    this.player.setCharacter(def, this.scene);
    this.player.health = def.health;
    this.player.armor = 0;
    this.player.medkits = 1;
    this.player.alive = true;
    this.giveStarterGuns();
    this.player.switchWeapon('pistol');
    this.lastSafehouse = 'sh_starter';
    this.env.skipTo(12.5);
    if (!this.env.forced) this.env.weather = 'clear';
    this.spawnAtSafehouse('sh_starter');
    this.afterLoad();
    this.ui.bigMessage('KRITHVIK GTA', `Welcome to Neon Bay, ${def.name.split(' ')[0]}!`, '#ffd000');
    setTimeout(() => this.ui.notify('Follow the yellow marker on your map to meet Marisol Vega.', 'info'), 2500);
    setTimeout(() => this.ui.notify('Press M for the map, TAB to pause. F enters vehicles.', 'info'), 6000);
    this.save.save('sh_starter');
  }

  continueGame() {
    const d = this.save.read();
    if (!d) return this.startNewGame('krithvik');
    this.audio.init();
    this.resetWorld();
    this.progress.load(d.progress);
    for (const id of [...CRAZY_IDS, ...PLANE_IDS]) this.progress.unlocked.add(id);
    const def = characterById(d.character);
    this.player.setCharacter(def, this.scene);
    this.player.inv = { ...newInventory(), ...d.player.inv };
    this.player.weapon = d.player.weapon ?? 'fists';
    this.player.model.setWeapon(WEAPONS[this.player.weapon].visual);
    this.player.health = Math.max(30, d.player.health);
    this.player.armor = d.player.armor ?? 0;
    this.player.medkits = d.player.medkits ?? 0;
    this.player.alive = true;
    this.giveStarterGuns();
    this.env.skipTo(d.env.hours);
    if (!this.env.forced) this.env.weather = d.env.weather;
    this.lastSafehouse = d.spawnAt ?? 'sh_starter';
    this.spawnAtSafehouse(this.lastSafehouse);
    this.afterLoad();
    this.ui.bigMessage('KRITHVIK GTA', 'Progress loaded', '#29e6ff');
  }

  private afterLoad() {
    this.missions.refresh();
    this.services.refreshBlips();
    // tokens/treasure/stunts depend on progress — rebuild activity content
    this.pickups.removeTag('token');
    this.pickups.removeTag('treasure');
    this.markers.removePrefix('act_');
    this.interact.removePrefix('act_');
    this.activities.init();
    this.state = 'playing';
    this.ui.setScreen('playing');
    this.input.requestLock();
    this.cam.yaw = this.player.yaw;
  }

  spawnAtSafehouse(id: string) {
    const p = this.layout.pois.find((x) => x.id === id) ?? this.layout.pois.find((x) => x.id === 'sh_starter')!;
    this.player.teleport(p.ex, p.ez + (p.yaw === 0 ? 1.5 : -1.5), this, p.yaw);
    this.cam.yaw = p.yaw;
    this.spawnCrazyShowcase();
  }

  /** Every gun, with plenty of ammo (topped up on new game and on load). */
  giveStarterGuns() {
    const kit: [WeaponId, number][] = [
      ['bat', 0],
      ['pistol', 120],
      ['smg', 300],
      ['shotgun', 60],
      ['rifle', 300],
      ['rocket', 12],
    ];
    const cur = this.player.weapon;
    for (const [w, ammo] of kit) {
      const s = this.player.inv[w];
      if (!s.owned) this.player.giveWeapon(w, ammo);
      else if (s.ammo + s.clip < ammo) s.ammo = ammo - s.clip;
    }
    this.player.switchWeapon(cur);
  }

  /** Line up the wild cars at the kerb of the nearest road so they are right there to try. */
  spawnCrazyShowcase() {
    for (const v of [...this.vehicles.list]) if (v.missionTag === 'showcase') this.vehicles.remove(v);
    const px = this.player.pos.x,
      pz = this.player.pos.z;
    let bi = 0,
      bj = 0;
    for (let i = 0; i < 13; i++) {
      if (Math.abs(roadC(i) - px) < Math.abs(roadC(bi) - px)) bi = i;
      if (Math.abs(roadC(i) - pz) < Math.abs(roadC(bj) - pz)) bj = i;
    }
    const alongZ = Math.abs(roadC(bi) - px) <= Math.abs(roadC(bj) - pz);
    const off = ROAD_HALF - 2.2;
    const side = alongZ ? (px > roadC(bi) ? 1 : -1) : pz > roadC(bj) ? 1 : -1;
    let cursor = (alongZ ? pz : px) - 26;
    [...CRAZY_IDS, 'skyhawk'].forEach((id) => {
      const len = VEHICLES[id].len;
      let u = cursor + len / 2;
      // keep clear of junctions
      const jc = roadC(Math.round(u / 100) + 6);
      const clear = ROAD_HALF + 4 + len / 2;
      if (Math.abs(u - jc) < clear) u = jc + clear;
      cursor = u + len / 2 + 2.5;
      let x: number, z: number, yaw: number;
      if (alongZ) {
        x = roadC(bi) + side * off;
        z = u;
        yaw = side > 0 ? 0 : Math.PI;
      } else {
        z = roadC(bj) + side * off;
        x = u;
        yaw = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      }
      const v = this.vehicles.spawn(id, x, z, yaw);
      v.persistent = true;
      v.missionTag = 'showcase';
      v.fuel = v.spec.fuelCap;
    });
    // planes lined up on the airport runway, ready for take-off
    [
      ['skyhawk', -836, -290],
      ['jetstream', -816, -290],
    ].forEach(([id, x, z]) => {
      const v = this.vehicles.spawn(id as string, x as number, z as number, 0);
      v.persistent = true;
      v.missionTag = 'showcase';
      v.fuel = v.spec.fuelCap;
    });
    this.markers.removeBlip('planes');
    this.markers.addBlip({ id: 'planes', x: -830, z: -270, glyph: '✈', color: '#29e6ff', label: 'Planes (airport runway)', kind: 'vehicle' });
  }

  quitToMenu() {
    this.resetWorld();
    this.state = 'menu';
    this.ignoreUnlock = true;
    this.input.exitLock();
    useUI.setState({ hasSave: this.save.hasSave() });
    this.ui.setScreen('menu');
    this.cam.clearCinematic();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'overlay';
    this.ignoreUnlock = true;
    this.input.exitLock();
    this.ui.setScreen('paused');
  }

  resume() {
    if (this.state === 'menu' || this.state === 'loading' || this.state === 'dead') return;
    this.state = 'playing';
    this.ui.setScreen('playing');
    this.input.requestLock();
  }

  openOverlay(screen: 'map' | 'inventory' | 'paused' | 'stats') {
    if (this.state !== 'playing' && this.state !== 'overlay') return;
    this.state = 'overlay';
    this.ignoreUnlock = true;
    this.input.exitLock();
    this.ui.setScreen(screen);
  }

  openIntro(data: MissionIntroData, x: number, z: number) {
    this.state = 'cutscene';
    this.ignoreUnlock = true;
    this.input.exitLock();
    this.cam.setOrbit(x, z, 16, this.col.surfaceY(x, z, 50, 0) + 7, 0.18);
    this.cam.cinematic!.look.set(x, this.col.surfaceY(x, z, 50, 0) + 1.5, z);
    const close = () => {
      this.cam.clearCinematic();
      this.state = 'playing';
      this.ui.setScreen('playing');
      useUI.setState({ intro: null });
      this.input.requestLock();
    };
    useUI.setState({
      intro: {
        ...data,
        accept: () => {
          close();
          data.accept();
        },
        decline: () => {
          close();
          data.decline();
        },
      },
    });
    this.ui.hud({ letterbox: true });
    this.ui.setScreen('missionIntro');
  }

  showResult(data: MissionResultData) {
    if (this.state === 'dead') return;
    this.state = 'overlay';
    this.ignoreUnlock = true;
    this.input.exitLock();
    useUI.setState({
      result: {
        ...data,
        retry: data.retry
          ? () => {
              useUI.setState({ result: null });
              this.resume();
              data.retry!();
            }
          : undefined,
      },
    });
    this.ui.setScreen('missionResult');
  }

  closeResult() {
    useUI.setState({ result: null });
    this.resume();
  }

  openShop(data: ShopData) {
    this.state = 'overlay';
    this.ignoreUnlock = true;
    this.input.exitLock();
    useUI.setState({ shop: data });
    this.ui.setScreen('shop');
  }

  closeShop() {
    useUI.setState({ shop: null });
    this.resume();
  }

  fadeFlash() {
    useUI.setState({ big: { title: '', sub: '', color: '#000', id: Math.random() } });
  }

  // ------------------------------------------------------------------ events
  onVehicleImpact(v: Vehicle, impact: number, x: number, z: number, other: Vehicle | null) {
    const p = new THREE.Vector3(x, v.pos.y + 0.6, z);
    this.audio.crash(p, Math.min(1, impact / 22));
    if (impact > 6) this.fx.sparks(p, Math.min(20, Math.floor(impact)));
    const playerCar = this.player.vehicle;
    if (playerCar && (v === playerCar || other === playerCar)) {
      this.cam.shake(Math.min(0.8, impact / 25));
      const victim = v === playerCar ? other : v;
      if (victim) {
        if (victim.spec.police && impact > 5) this.wanted.crime('ramCop', victim.pos.x, victim.pos.z);
        if (victim.ai && victim.ai.mode === 'traffic' && impact > 4) victim.ai.panicT = 10 + Math.random() * 10;
        else if (victim.ai && victim.ai.mode === 'traffic') this.audio.horn(victim.pos);
      }
      // bike crash throws the rider
      if (playerCar.spec.bike && impact > 13 && v === playerCar) {
        this.player.exitVehicle(this, true);
        this.player.knockdown(playerCar.vel.x * 0.8, playerCar.vel.z * 0.8, 4, 2);
        this.player.takeDamage(impact * 1.5, x, z, 'vehicle', null, this);
      }
    }
  }

  onVehicleDestroyed(v: Vehicle) {
    const byPlayer = v.lastHitByPlayer > 0 && this.time - v.lastHitByPlayer < 15;
    if (byPlayer || v === this.player.vehicle) {
      this.progress.stat('vehiclesDestroyed', 1);
      this.wanted.crime(v.spec.police ? 'assaultCop' : 'destroyVehicle', v.pos.x, v.pos.z);
    }
    this.missions.onVehicleDestroyed(v);
  }

  onVehicleLanded(v: Vehicle, air: number, dist: number) {
    this.activities.onLanded(v, air, dist);
  }

  onPlayerEnteredVehicle(v: Vehicle) {
    this.missions.onEnterVehicle(v);
    if (v.spec.cls === 'taxi' && !this.missions.active) this.ui.notify('Bay Cab: press T to start a taxi shift.', 'info');
    if (v.spec.crazy) this.ui.notify(`${v.spec.name}! Hold SHIFT for nitro.`, 'info');
    if (v.spec.plane) {
      this.ui.notify(`${v.spec.name}: hold W / ↑ to speed up — it lifts off by itself when fast enough.`, 'info');
      setTimeout(() => this.ui.notify('In the air: ← → turn, SPACE climb, SHIFT dive, S / ↓ slow down. Land gently on a road or the runway!', 'info'), 3500);
    }
  }
  onPlayerExitedVehicle(_v: Vehicle) {}

  onPlayerWasted() {
    if (this.state === 'dead') return;
    this.deathKind = 'wasted';
    this.beginDeath();
  }

  onBusted() {
    if (this.state === 'dead' || !this.player.alive) return;
    this.deathKind = 'busted';
    this.player.knockdown(0, 0, 0, 999);
    this.beginDeath();
  }

  private beginDeath() {
    this.state = 'dead';
    this.deathT = 0;
    this.timeScale = 0.45;
    this.ignoreUnlock = true;
    this.input.exitLock();
    this.ui.setScreen(this.deathKind);
    if (this.missions.active) this.missions.failMission(this.deathKind === 'wasted' ? 'You were wasted.' : 'You were busted.');
    this.activities.abort();
    useUI.setState({ result: null });
  }

  private respawn() {
    const busted = this.deathKind === 'busted';
    const pl = this.player;
    if (pl.vehicle) pl.exitVehicle(this, true);
    const target = busted ? this.nearestPOI('police') : this.layout.pois.find((p) => p.id === 'hospital')!;
    const fee = busted ? Math.max(100, Math.round(this.progress.cash * 0.1)) : Math.min(this.progress.cash, 100 + Math.round(this.progress.cash * 0.04));
    this.progress.cash = Math.max(0, this.progress.cash - fee);
    if (busted) {
      for (const w of ['pistol', 'smg', 'shotgun'] as const) {
        pl.inv[w].ammo = Math.floor(pl.inv[w].ammo / 2);
      }
    }
    this.wanted.clear(false);
    this.police.clearAll();
    pl.alive = true;
    pl.health = pl.maxHealth;
    pl.knockT = 0;
    pl.knockAmt = 0;
    pl.teleport(target.ex, target.ez + (target.yaw === 0 ? 2 : -2), this, target.yaw);
    this.cam.yaw = target.yaw;
    this.timeScale = 1;
    this.env.skipTo((this.env.hours + 4) % 24);
    this.state = 'playing';
    this.ui.setScreen('playing');
    this.ui.notify(busted ? `Busted! You paid a ${formatMoney(fee)} fine and lost some ammo.` : `Hospital bill: ${formatMoney(fee)}`, 'bad');
    this.input.requestLock();
  }

  private nearestPOI(type: string) {
    const p = this.player.pos;
    return this.layout.pois.filter((x) => x.type === type).sort((a, b) => Math.hypot(a.ex - p.x, a.ez - p.z) - Math.hypot(b.ex - p.x, b.ez - p.z))[0];
  }

  // ------------------------------------------------------------------ loop
  private loop = () => {
    requestAnimationFrame(this.loop);
    const raw = Math.min(this.clock.getDelta(), 0.05);
    this.frame++;
    this.fpsAcc += raw;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    try {
      this.tick(raw);
    } catch (e) {
      console.error('[NeonBay] tick error', e);
    }
    this.render();
    this.input.endFrame();
  };

  private tick(raw: number) {
    const st = this.state;
    if (st === 'loading') return;
    const dt = raw * this.timeScale;
    if (st === 'menu') {
      this.menuOrbit += raw * 0.04;
      const r = 230;
      this.camera.position.set(Math.cos(this.menuOrbit) * r + 60, 95, Math.sin(this.menuOrbit) * r + 30);
      this.camera.lookAt(30, 40, 0);
      this.focus.set(Math.cos(this.menuOrbit) * 80, 0, Math.sin(this.menuOrbit) * 80);
      this.player.pos.copy(this.focus);
      this.player.model.root.visible = false;
      this.ambientUpdate(raw);
      this.audio.update(raw, this);
      return;
    }
    this.player.model.root.visible = true;
    // global keys
    const inp = this.input;
    if (st === 'playing') {
      if (inp.hit('Tab') || inp.hit('KeyP')) return this.pause();
      if (inp.hit('KeyM')) return this.openOverlay('map');
      if (inp.hit('KeyI')) return this.openOverlay('inventory');
    } else if (st === 'overlay') {
      const scr = useUI.getState().screen;
      if ((inp.hit('Tab') || inp.hit('Escape')) && (scr === 'paused' || scr === 'map' || scr === 'inventory' || scr === 'stats')) {
        /* handled by React keyboard listeners */
      }
    }
    if (st === 'overlay') {
      // keep the world frozen but animated lights/water alive
      this.city.update(raw * 0.2, this.env.night);
      this.audio.update(raw, this);
      this.hudT -= raw;
      if (this.hudT <= 0) {
        this.hudT = 0.2;
        this.pushHud();
      }
      return;
    }
    if (st === 'dead') {
      this.deathT += raw;
      if (this.deathT > 4) this.respawn();
    }
    this.time += dt;
    const p = this.player;
    this.focus.copy(p.vehicle ? p.vehicle.pos : p.pos);
    if (st === 'cutscene') {
      this.ambientUpdate(dt);
      this.cam.update(raw, this);
      this.audio.update(raw, this);
      return;
    }
    p.update(dt, this);
    this.vehicles.update(dt);
    this.ambientUpdate(dt, true);
    this.police.update(dt);
    this.wanted.update(dt);
    this.combat.update(dt);
    this.pickups.update(dt);
    if (st === 'playing') {
      this.missions.update(dt);
      this.activities.update(dt);
      this.interact.update();
    }
    this.progress.update(dt);
    this.nav.update(dt, this.focus.x, this.focus.z);
    this.cam.update(raw, this);
    this.updateGpsArrow();
    this.updateHeadlight();
    this.audio.update(raw, this);
    this.hudT -= raw;
    if (this.hudT <= 0) {
      this.hudT = 0.08;
      this.pushHud();
    }
  }

  /** systems that keep the city alive (also used behind the menu) */
  private ambientUpdate(dt: number, skipVehicles = false) {
    this.env.update(dt, this.focus, this.camera);
    this.lights.update(dt);
    if (!skipVehicles) this.vehicles.update(dt);
    this.traffic.update(dt);
    this.peds.update(dt);
    this.props.update(dt, this.focus.x, this.focus.z);
    this.props.setNight(this.env.night);
    this.markers.update(dt, this.camera.position);
    this.fx.update(dt);
    this.city.update(dt, this.env.night);
  }

  private updateGpsArrow() {
    const n = this.nav.nextPoint();
    const p = this.player;
    if (!n || this.state !== 'playing') {
      this.gpsArrow.visible = false;
      return;
    }
    const base = p.vehicle ? p.vehicle.pos : p.pos;
    const h = p.vehicle ? p.vehicle.spec.height + 1.2 : 2.4;
    this.gpsArrow.visible = true;
    this.gpsArrow.position.set(base.x, base.y + h, base.z);
    this.gpsArrow.lookAt(n.x, base.y + h, n.z);
    const t = this.nav.target!;
    const d = Math.hypot(t.x - base.x, t.z - base.z);
    (this.gpsArrow.material as THREE.MeshBasicMaterial).color.setHex(this.nav.missionTarget ? 0xffd000 : 0xc04dff);
    this.gpsArrow.scale.setScalar(d < 30 ? 0.6 : 1);
  }

  private updateHeadlight() {
    const v = this.player.vehicle;
    const night = this.env.night;
    if (!v || night < 0.25 || v.destroyed) {
      this.headlight.intensity = 0;
      return;
    }
    const fx = Math.sin(v.yaw),
      fz = Math.cos(v.yaw);
    this.headlight.position.set(v.pos.x + fx * v.spec.len * 0.5, v.pos.y + 0.8, v.pos.z + fz * v.spec.len * 0.5);
    this.headlight.target.position.set(v.pos.x + fx * 25, v.pos.y - 1, v.pos.z + fz * 25);
    this.headlight.intensity = 60 * night;
  }

  private pushHud() {
    const p = this.player;
    const v = p.vehicle;
    const blk = locateBlock(p.pos.x, p.pos.z);
    let district = blk ? DISTRICT_NAMES[districtOf(blk.bi, blk.bj)] : '';
    if (!blk) {
      if (inRect(AIRPORT, p.pos.x, p.pos.z)) district = 'Neon Bay International';
      else if (inRect(ISLAND, p.pos.x, p.pos.z, 30)) district = 'Coral Key';
      else if (inRect(PORT, p.pos.x, p.pos.z, 20)) district = 'Port of Neon Bay';
      else if (inRect(BEACH, p.pos.x, p.pos.z)) district = 'South Beach';
      else district = 'Neon Bay Waters';
    }
    const w = p.weaponDef;
    const slot = p.inv[w.id];
    this.ui.hud({
      health: p.health,
      maxHealth: p.maxHealth,
      armor: p.armor,
      stamina: p.stamina,
      cash: this.progress.cash,
      wanted: this.wanted.level,
      searching: this.wanted.searching,
      inVehicle: !!v,
      speed: v ? Math.round(v.speed * 3.6) : 0,
      nitro: v && v.spec.crazy ? Math.round(v.nitro * 50) / 50 : null,
      altitude: v && v.spec.plane ? Math.round(v.altitude) : null,
      vehicleName: v ? v.spec.name : '',
      vehicleHealth: v ? v.healthPct : 1,
      fuel: v ? clamp(v.fuel / v.spec.fuelCap, 0, 1) : 1,
      gear: v ? (v.forwardSpeed < -0.5 ? 0 : v.gear) : 1,
      rpm: v ? v.rpm : 0,
      weapon: w.name,
      weaponId: w.id,
      clip: slot.clip,
      ammo: slot.ammo,
      melee: w.melee,
      district,
      street: this.layout.streetName(p.pos.x, p.pos.z),
      time: this.env.timeString(),
      weather: WEATHER_LABEL[this.env.weather],
      radio: v && this.audio.radio ? this.audio.radio.name : '',
      fps: this.fps,
      aiming: p.aiming,
      letterbox: this.state === 'cutscene',
      reloading: p.reloadT > 0,
      medkits: p.medkits,
      ...(this.missions.active || this.activities.current ? {} : { objective: '', objectiveDetail: '', timer: null }),
    });
  }

  private render() {
    if (this.bloom) {
      const n = this.env.night;
      this.bloom.strength = 0.2 + n * 0.4;
      this.bloom.threshold = 1.3 - n * 0.45;
    }
    if (this.composer && this.settings.bloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
