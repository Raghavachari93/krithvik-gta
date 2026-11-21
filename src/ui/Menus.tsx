import { useState } from 'react';
import { G } from '../gameRef';
import { ROSTER, CharacterDef } from '../game/characters/Roster';
import { WEAPONS, WEAPON_ORDER } from '../game/combat/Weapons';
import { formatMoney, formatTime } from '../game/core/math';
import { ACHIEVEMENTS, PROPERTIES } from '../game/systems/Progression';
import { VEHICLES } from '../game/vehicles/VehicleSpecs';
import { MISSIONS } from '../game/missions/Missions';
import { DEFAULT_SETTINGS, Settings, useUI } from './store';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export function Loading() {
  const text = useUI((s) => s.loadingText);
  const pct = useUI((s) => s.loadingPct);
  return (
    <div className="screen loading">
      <div className="logo">NEON BAY</div>
      <div className="load-bar">
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="load-text">{text}</div>
    </div>
  );
}

export function MainMenu() {
  const hasSave = useUI((s) => s.hasSave);
  const set = useUI((s) => s.set);
  return (
    <div className="screen mainmenu">
      <div className="menu-left">
        <div className="logo">NEON BAY</div>
        <div className="tagline">An open-world crime story on the neon coast</div>
        <div className="menu-buttons">
          {hasSave && (
            <button className="btn primary" onClick={() => G().continueGame()}>
              Continue
            </button>
          )}
          <button className={`btn ${hasSave ? '' : 'primary'}`} onClick={() => set({ screen: 'charselect' })}>
            New Game
          </button>
          <button className="btn" onClick={() => set({ screen: 'settings', prevScreen: 'menu' })}>
            Settings
          </button>
          <button className="btn" onClick={() => set({ screen: 'controls', prevScreen: 'menu' })}>
            Controls
          </button>
        </div>
        <div className="menu-foot">Click inside the game to capture the mouse • TAB pauses</div>
      </div>
    </div>
  );
}

function Figure({ c }: { c: CharacterDef }) {
  const l = c.look;
  const jacket = hex(l.jacket ?? l.shirt);
  return (
    <svg viewBox="0 0 100 200" className="figure">
      <ellipse cx="50" cy="194" rx="28" ry="5" fill="rgba(0,0,0,0.4)" />
      <rect x="36" y="112" width="12" height="72" rx="5" fill={hex(l.pants)} />
      <rect x="52" y="112" width="12" height="72" rx="5" fill={hex(l.pants)} />
      <rect x="34" y="182" width="15" height="7" rx="3" fill={hex(l.shoes)} />
      <rect x="51" y="182" width="15" height="7" rx="3" fill={hex(l.shoes)} />
      <rect x={34 - (l.build - 1) * 20} y="56" width={32 + (l.build - 1) * 40} height="62" rx="12" fill={jacket} />
      <rect x="44" y="58" width="12" height="40" fill={hex(l.shirt)} opacity={l.jacket ? 1 : 0} />
      <rect x="22" y="60" width="11" height="52" rx="5" fill={jacket} />
      <rect x="67" y="60" width="11" height="52" rx="5" fill={jacket} />
      <circle cx="27" cy="116" r="5" fill={hex(l.skin)} />
      <circle cx="73" cy="116" r="5" fill={hex(l.skin)} />
      <rect x="45" y="44" width="10" height="12" fill={hex(l.skin)} />
      <ellipse cx="50" cy="32" rx="14" ry="16" fill={hex(l.skin)} />
      {l.hairStyle === 0 && <path d="M36 30 Q38 12 50 14 Q63 12 64 30 Q58 20 50 21 Q42 20 36 30Z" fill={hex(l.hair)} />}
      {l.hairStyle === 1 && <path d="M35 34 Q34 12 50 13 Q66 12 65 34 L66 58 Q60 40 60 26 Q50 20 40 26 Q40 40 34 58Z" fill={hex(l.hair)} />}
    </svg>
  );
}

export function CharSelect() {
  const [sel, setSel] = useState(0);
  const set = useUI((s) => s.set);
  const c = ROSTER[sel];
  const stat = (label: string, v: number, max: number) => (
    <div className="stat">
      <span>{label}</span>
      <div className="bar">
        <div style={{ width: `${(v / max) * 100}%`, background: c.accent }} />
      </div>
    </div>
  );
  return (
    <div className="screen charselect">
      <h1>CHOOSE YOUR CHARACTER</h1>
      <div className="cards">
        {ROSTER.map((r, i) => (
          <div key={r.id} className={`card ${i === sel ? 'sel' : ''}`} style={{ ['--accent' as string]: r.accent }} onClick={() => setSel(i)}>
            <Figure c={r} />
            <div className="card-name">{r.name}</div>
            <div className="card-tag">{r.tagline}</div>
          </div>
        ))}
      </div>
      <div className="char-detail" style={{ borderColor: c.accent }}>
        <p>{c.bio}</p>
        {stat('Health', c.health, 140)}
        {stat('Speed', c.speed, 1.15)}
        {stat('Stamina', c.stamina, 1.4)}
        {stat('Melee', c.melee, 1.45)}
      </div>
      <div className="row">
        <button className="btn" onClick={() => set({ screen: 'menu' })}>
          Back
        </button>
        <button className="btn primary" onClick={() => G().startNewGame(c.id)}>
          Play as {c.name.split(' ')[0]}
        </button>
      </div>
    </div>
  );
}

export function SettingsScreen() {
  const settings = useUI((s) => s.settings);
  const prev = useUI((s) => s.prevScreen);
  const set = useUI((s) => s.set);
  const [s, setS] = useState<Settings>(settings);
  const upd = (p: Partial<Settings>) => setS((x) => ({ ...x, ...p }));
  const apply = () => {
    set({ settings: s });
    G().applySettings(s);
  };
  const back = () => {
    apply();
    set({ screen: prev === 'settings' ? 'menu' : prev });
  };
  const slider = (label: string, key: keyof Settings, min: number, max: number, step: number, fmt = (v: number) => v.toFixed(2)) => (
    <label className="setting">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={s[key] as number} onChange={(e) => upd({ [key]: Number(e.target.value) } as Partial<Settings>)} />
      <em>{fmt(s[key] as number)}</em>
    </label>
  );
  const toggle = (label: string, key: keyof Settings) => (
    <label className="setting">
      <span>{label}</span>
      <input type="checkbox" checked={s[key] as boolean} onChange={(e) => upd({ [key]: e.target.checked } as Partial<Settings>)} />
    </label>
  );
  return (
    <div className="screen panel-screen">
      <div className="panel wide">
        <h1>SETTINGS</h1>
        <div className="settings-grid">
          <div>
            <h3>Graphics</h3>
            <label className="setting">
              <span>Quality preset</span>
              <select
                value={s.quality}
                onChange={(e) => {
                  const q = e.target.value as Settings['quality'];
                  upd({ quality: q, shadows: q !== 'low', bloom: q !== 'low', drawDistance: q === 'low' ? 900 : q === 'medium' ? 1400 : 2000, pedDensity: q === 'low' ? 0.6 : 1, trafficDensity: q === 'low' ? 0.6 : 1 });
                }}
              >
                <option value="low">Low (fast)</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            {toggle('Dynamic shadows', 'shadows')}
            {toggle('Bloom / neon glow', 'bloom')}
            {slider('Draw distance', 'drawDistance', 600, 2400, 100, (v) => `${v} m`)}
            {slider('Pedestrian density', 'pedDensity', 0.2, 1.6, 0.1)}
            {slider('Traffic density', 'trafficDensity', 0.2, 1.6, 0.1)}
            {slider('Field of view', 'fov', 55, 95, 1, (v) => `${v}°`)}
            {toggle('Show FPS', 'showFps')}
          </div>
          <div>
            <h3>Controls</h3>
            {slider('Mouse sensitivity', 'mouseSens', 0.2, 3, 0.05)}
            {toggle('Invert Y axis', 'invertY')}
            <h3>Audio</h3>
            {slider('Master volume', 'master', 0, 1, 0.05)}
            {slider('Music / radio', 'music', 0, 1, 0.05)}
            {slider('Effects', 'sfx', 0, 1, 0.05)}
            {slider('Ambience', 'ambient', 0, 1, 0.05)}
            <h3>World</h3>
            <label className="setting">
              <span>Weather</span>
              <select value={s.weather} onChange={(e) => upd({ weather: e.target.value as Settings['weather'] })}>
                <option value="dynamic">Dynamic</option>
                <option value="clear">Always clear</option>
                <option value="cloudy">Overcast</option>
                <option value="rain">Rain</option>
                <option value="storm">Thunderstorm</option>
                <option value="fog">Fog</option>
              </select>
            </label>
            <label className="setting">
              <span>Time of day</span>
              <select value={s.timeOfDay} onChange={(e) => upd({ timeOfDay: e.target.value as Settings['timeOfDay'] })}>
                <option value="day">Always daylight</option>
                <option value="cycle">Day / night cycle</option>
              </select>
            </label>
            {slider('Day length speed', 'timeSpeed', 0.25, 4, 0.25, (v) => `${v}×`)}
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setS({ ...DEFAULT_SETTINGS })}>
            Reset defaults
          </button>
          <button className="btn" onClick={apply}>
            Apply
          </button>
          <button className="btn primary" onClick={back}>
            Save & back
          </button>
        </div>
      </div>
    </div>
  );
}

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move / drive'],
  ['Mouse', 'Look / aim camera'],
  ['Shift', 'Sprint'],
  ['Space', 'Jump & climb ledges / handbrake'],
  ['X', 'Toggle walk'],
  ['E', 'Interact, talk, shop, start missions'],
  ['F', 'Enter / exit vehicle (steal cars)'],
  ['C', 'Camera mode (near / far / first person)'],
  ['Mouse wheel', 'Camera distance'],
  ['Left click', 'Punch / swing / shoot'],
  ['Right click', 'Block (melee) / aim (guns)'],
  ['Q', 'Dodge roll'],
  ['1 – 5', 'Select weapon'],
  ['R', 'Reload / next radio station'],
  ['H', 'Use med kit / horn in vehicle'],
  ['L', 'Police siren (police vehicles)'],
  ['T', 'Start / stop taxi shift (in a Bay Cab)'],
  ['M', 'Map & GPS'],
  ['I', 'Inventory'],
  ['Tab / P', 'Pause menu'],
];

export function ControlsScreen() {
  const prev = useUI((s) => s.prevScreen);
  const set = useUI((s) => s.set);
  return (
    <div className="screen panel-screen">
      <div className="panel">
        <h1>CONTROLS</h1>
        <div className="controls-list">
          {CONTROLS.map(([k, d]) => (
            <div key={k} className="ctrl">
              <kbd>{k}</kbd>
              <span>{d}</span>
            </div>
          ))}
        </div>
        <button className="btn primary" onClick={() => set({ screen: prev === 'controls' ? 'menu' : prev })}>
          Back
        </button>
      </div>
    </div>
  );
}

export function PauseMenu() {
  const set = useUI((s) => s.set);
  const g = G();
  const mission = g.missions.active;
  const canSave = !mission && g.wanted.level === 0 && !g.activities.current;
  return (
    <div className="screen pause">
      <div className="panel pause-panel">
        <h1>PAUSED</h1>
        {mission && <div className="pause-mission">Current mission: {mission.def.title}</div>}
        <div className="menu-buttons">
          <button className="btn primary" onClick={() => g.resume()}>
            Resume
          </button>
          <button className="btn" onClick={() => g.openOverlay('map')}>
            Map
          </button>
          <button className="btn" onClick={() => g.openOverlay('inventory')}>
            Inventory
          </button>
          <button className="btn" onClick={() => g.openOverlay('stats')}>
            Stats & Achievements
          </button>
          <button className="btn" onClick={() => set({ screen: 'settings', prevScreen: 'paused' })}>
            Settings
          </button>
          <button className="btn" onClick={() => set({ screen: 'controls', prevScreen: 'paused' })}>
            Controls
          </button>
          <button
            className="btn"
            disabled={!canSave}
            title={canSave ? '' : 'Cannot save during missions or while wanted'}
            onClick={() => {
              if (g.save.save()) g.ui.notify('Game saved', 'good');
              g.resume();
            }}
          >
            Quick save
          </button>
          {mission && (
            <button
              className="btn danger"
              onClick={() => {
                g.missions.abort();
                g.resume();
              }}
            >
              Abandon mission
            </button>
          )}
          {g.activities.current && (
            <button
              className="btn danger"
              onClick={() => {
                g.activities.abort();
                g.resume();
              }}
            >
              Quit activity
            </button>
          )}
          <button className="btn" onClick={() => g.continueGame()}>
            Load last save
          </button>
          <button className="btn danger" onClick={() => g.quitToMenu()}>
            Quit to main menu
          </button>
        </div>
      </div>
    </div>
  );
}

export function Inventory() {
  const g = G();
  const p = g.player;
  const pr = g.progress;
  return (
    <div className="screen panel-screen">
      <div className="panel wide">
        <h1>INVENTORY</h1>
        <div className="inv-grid">
          <div>
            <h3>Weapons</h3>
            {WEAPON_ORDER.map((w) => {
              const s = p.inv[w];
              const d = WEAPONS[w];
              return (
                <div key={w} className={`inv-item ${s.owned ? '' : 'locked'} ${p.weapon === w ? 'equipped' : ''}`} onClick={() => s.owned && p.switchWeapon(w)}>
                  <kbd>{d.slot}</kbd> {d.name}
                  <span>{s.owned ? (d.melee ? 'melee' : `${s.clip} / ${s.ammo}`) : 'not owned'}</span>
                </div>
              );
            })}
            <h3>Items</h3>
            <div className="inv-item">
              Med kits <span>{p.medkits}</span>
            </div>
            <div className="inv-item">
              Body armor <span>{Math.round(p.armor)}%</span>
            </div>
            <div className="inv-item">
              Cash <span>{formatMoney(pr.cash)}</span>
            </div>
          </div>
          <div>
            <h3>Collectibles</h3>
            <div className="inv-item">
              Neon Tokens <span>{pr.tokens.size} / 30</span>
            </div>
            <div className="inv-item">
              Unique stunt jumps <span>{pr.stunts.size} / 8</span>
            </div>
            <div className="inv-item">
              Treasure hunts <span>{pr.treasures.size} / 3</span>
            </div>
            <h3>Properties</h3>
            {PROPERTIES.map((x) => (
              <div key={x.id} className={`inv-item ${pr.properties.has(x.id) ? '' : 'locked'}`}>
                {x.name}
                <span>{pr.properties.has(x.id) ? (x.income ? `+${formatMoney(x.income)}/day` : 'owned') : formatMoney(pr.price(x.id, x.price))}</span>
              </div>
            ))}
          </div>
          <div>
            <h3>Garage</h3>
            {pr.ownedVehicles.length === 0 && <div className="inv-item locked">No vehicles yet — visit a dealership</div>}
            {pr.ownedVehicles.map((v, i) => (
              <div key={i} className="inv-item">
                {VEHICLES[v]?.name ?? v}
                <span>{VEHICLES[v]?.cls}</span>
              </div>
            ))}
            <h3>Story</h3>
            {MISSIONS.map((m) => (
              <div key={m.id} className={`inv-item ${pr.missions.has(m.id) ? 'done' : 'locked'}`}>
                {m.title}
                <span>{pr.missions.has(m.id) ? '✔ passed' : m.requires.every((r) => pr.missions.has(r)) ? 'available' : 'locked'}</span>
              </div>
            ))}
          </div>
        </div>
        <button className="btn primary" onClick={() => g.resume()}>
          Close (I)
        </button>
      </div>
    </div>
  );
}

export function StatsScreen() {
  const g = G();
  const st = g.progress.stats;
  const n = (k: string) => Math.floor(st[k] ?? 0).toLocaleString();
  const km = (k: string) => ((st[k] ?? 0) / 1000).toFixed(2) + ' km';
  const rows: [string, string][] = [
    ['Time played', formatTime(st.playTime ?? 0)],
    ['Missions passed', n('missionsPassed')],
    ['Money earned', formatMoney(st.moneyEarned ?? 0)],
    ['Money spent', formatMoney(st.moneySpent ?? 0)],
    ['Distance on foot', km('dist_walk')],
    ['Distance driven', km('dist_drive')],
    ['Distance swum', km('dist_swim')],
    ['Top speed', `${Math.round(st.topSpeed ?? 0)} km/h`],
    ['Vehicles stolen', n('carsStolen')],
    ['Vehicles destroyed', n('vehiclesDestroyed')],
    ['People knocked out', n('knockouts')],
    ['Shots fired', n('shotsFired')],
    ['Accuracy', st.shotsFired ? `${Math.round(((st.shotsHit ?? 0) / st.shotsFired) * 100)}%` : '—'],
    ['Highest wanted level', `${st.highestWanted ?? 0} ★`],
    ['Police chases escaped', n('evaded')],
    ['Stunt jumps', n('stunts')],
    ['Street races won', n('racesWon')],
    ['Taxi fares', n('fares')],
    ['Encounters helped', n('encounters')],
  ];
  return (
    <div className="screen panel-screen">
      <div className="panel wide">
        <h1>STATS & ACHIEVEMENTS</h1>
        <div className="inv-grid two">
          <div>
            <h3>Statistics</h3>
            {rows.map(([a, b]) => (
              <div key={a} className="inv-item">
                {a}
                <span>{b}</span>
              </div>
            ))}
          </div>
          <div>
            <h3>
              Achievements ({g.progress.achievements.size}/{ACHIEVEMENTS.length})
            </h3>
            <div className="achievements">
              {ACHIEVEMENTS.map((a) => (
                <div key={a.id} className={`ach ${g.progress.achievements.has(a.id) ? 'got' : ''}`}>
                  <b>{g.progress.achievements.has(a.id) ? '🏆' : '🔒'} {a.name}</b>
                  <span>{a.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <button className="btn primary" onClick={() => g.resume()}>
          Close
        </button>
      </div>
    </div>
  );
}

export function MissionIntro() {
  const intro = useUI((s) => s.intro);
  if (!intro) return null;
  return (
    <div className="screen intro">
      <div className="intro-card">
        <div className="intro-type">{intro.type}</div>
        <h1>{intro.title}</h1>
        <div className="intro-giver">{intro.giver}</div>
        <p className="intro-text">{intro.intro}</p>
        <div className="intro-obj">
          <b>Objective:</b> {intro.objective}
        </div>
        <ul>
          {intro.instructions.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
        <div className="intro-reward">
          Reward: <b>{intro.reward}</b>
        </div>
        <div className="row">
          <button className="btn" onClick={intro.decline}>
            Not now (Esc)
          </button>
          <button className="btn primary" onClick={intro.accept}>
            {intro.isActivity ? 'Start' : 'Start mission'} (Enter)
          </button>
        </div>
      </div>
    </div>
  );
}

export function MissionResult() {
  const r = useUI((s) => s.result);
  if (!r) return null;
  return (
    <div className="screen result">
      <div className={`result-banner ${r.success ? 'win' : 'lose'}`}>
        <div className="result-big">{r.success ? 'MISSION PASSED' : 'MISSION FAILED'}</div>
        <div className="result-title">{r.title}</div>
        {r.reason && <div className="result-reason">{r.reason}</div>}
        {r.reward && <div className="result-reward">+ {r.reward}</div>}
        {r.lines.map((l) => (
          <div key={l} className="result-line">
            {l}
          </div>
        ))}
        <div className="row">
          {r.retry && (
            <button className="btn" onClick={r.retry}>
              Retry
            </button>
          )}
          <button className="btn primary" onClick={() => G().closeResult()}>
            Continue (Enter)
          </button>
        </div>
      </div>
    </div>
  );
}

export function Shop() {
  const shop = useUI((s) => s.shop);
  const cash = useUI((s) => s.hud.cash);
  if (!shop) return null;
  return (
    <div className="screen shop">
      <div className="panel shop-panel" style={{ borderColor: shop.accent }}>
        <h1 style={{ color: shop.accent }}>{shop.title}</h1>
        <div className="shop-sub">{shop.subtitle}</div>
        <div className="shop-cash">Cash: {formatMoney(G().progress.cash ?? cash)}</div>
        <div className="shop-items">
          {shop.items.map((it) => (
            <button key={it.id} className="shop-item" disabled={it.disabled} onClick={() => shop.onSelect(it.id)}>
              <div className="si-main">
                <b>{it.name}</b>
                {it.tag && <i>{it.tag}</i>}
                {it.desc && <span>{it.desc}</span>}
              </div>
              {it.price !== undefined && <div className={`si-price ${G().progress.cash < it.price ? 'cant' : ''}`}>{it.price === 0 ? 'FREE' : formatMoney(it.price)}</div>}
            </button>
          ))}
        </div>
        <div className="hint">Esc to close</div>
      </div>
    </div>
  );
}

export function Death({ kind }: { kind: 'wasted' | 'busted' }) {
  return (
    <div className={`screen death ${kind}`}>
      <div className="death-text">{kind === 'wasted' ? 'WASTED' : 'BUSTED'}</div>
    </div>
  );
}
