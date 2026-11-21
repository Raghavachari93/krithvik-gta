import { useEffect, useState } from 'react';
import { formatMoney, formatTime } from '../game/core/math';
import { Minimap } from './Minimap';
import { useUI } from './store';

function Stars({ n, searching }: { n: number; searching: boolean }) {
  return (
    <div className={`wanted ${searching ? 'searching' : ''} ${n > 0 ? 'active' : ''}`}>
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={i < n ? 'on' : ''}>
          ★
        </span>
      ))}
    </div>
  );
}

function Bar({ v, max, cls }: { v: number; max: number; cls: string }) {
  return (
    <div className={`bar ${cls}`}>
      <div style={{ width: `${Math.max(0, Math.min(100, (v / max) * 100))}%` }} />
    </div>
  );
}

function Speedo() {
  const h = useUI((s) => s.hud);
  const max = 300;
  const a = Math.min(1, h.speed / max);
  const r = 62;
  const c = 2 * Math.PI * r;
  const arc = 0.75;
  return (
    <div className="speedo">
      <svg width="170" height="170" viewBox="0 0 170 170">
        <circle cx="85" cy="85" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="9" strokeDasharray={`${c * arc} ${c}`} transform="rotate(135 85 85)" strokeLinecap="round" />
        <circle cx="85" cy="85" r={r} fill="none" stroke="url(#spg)" strokeWidth="9" strokeDasharray={`${c * arc * a} ${c}`} transform="rotate(135 85 85)" strokeLinecap="round" />
        <circle cx="85" cy="85" r={r - 14} fill="none" stroke="rgba(255,45,149,0.7)" strokeWidth="3" strokeDasharray={`${c * 0.75 * arc * h.rpm} ${c}`} transform="rotate(135 85 85)" />
        <defs>
          <linearGradient id="spg" x1="0" x2="1">
            <stop offset="0" stopColor="#29e6ff" />
            <stop offset="1" stopColor="#ff2d95" />
          </linearGradient>
        </defs>
      </svg>
      <div className="speed-num">{h.speed}</div>
      <div className="speed-unit">KM/H</div>
      <div className="gear">{h.gear === 0 ? 'R' : h.gear}</div>
      <div className="veh-info">
        <div className="veh-name">{h.vehicleName}</div>
        <div className="mini-bars">
          <span>⛽</span>
          <Bar v={h.fuel} max={1} cls={h.fuel < 0.15 ? 'fuel low' : 'fuel'} />
          <span>⚙</span>
          <Bar v={h.vehicleHealth} max={1} cls={h.vehicleHealth < 0.3 ? 'vhp low' : 'vhp'} />
        </div>
        {h.radio && <div className="radio">♪ {h.radio}</div>}
      </div>
    </div>
  );
}

function Notes() {
  const notes = useUI((s) => s.notes);
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((x) => x + 1), 500);
    return () => clearInterval(iv);
  }, []);
  const now = performance.now();
  return (
    <div className="notes">
      {notes
        .filter((n) => now - n.t < 6000)
        .map((n) => (
          <div key={n.id} className={`note ${n.kind}`}>
            {n.text}
          </div>
        ))}
    </div>
  );
}

function Subtitle() {
  const s = useUI((st) => st.subtitle);
  const [show, setShow] = useState<typeof s>(null);
  useEffect(() => {
    if (!s) return;
    setShow(s);
    const t = setTimeout(() => setShow(null), 4800);
    return () => clearTimeout(t);
  }, [s?.id]);
  if (!show) return null;
  return (
    <div className="subtitle">
      <b>{show.speaker}:</b> {show.text}
    </div>
  );
}

function BigMessage() {
  const b = useUI((s) => s.big);
  const [show, setShow] = useState<typeof b>(null);
  useEffect(() => {
    if (!b) return;
    setShow(b);
    const t = setTimeout(() => setShow(null), b.title ? 3200 : 900);
    return () => clearTimeout(t);
  }, [b?.id]);
  if (!show) return null;
  if (!show.title) return <div className="fade-flash" />;
  return (
    <div className="bigmsg" key={show.id}>
      <div className="big-title" style={{ color: show.color, textShadow: `0 0 24px ${show.color}` }}>
        {show.title}
      </div>
      {show.sub && <div className="big-sub">{show.sub}</div>}
    </div>
  );
}

function DamageVignette() {
  const d = useUI((s) => s.damage);
  const [k, setK] = useState(0);
  useEffect(() => {
    if (!d) return;
    setK(d.k);
    const t = setTimeout(() => setK(0), 260);
    return () => clearTimeout(t);
  }, [d?.id]);
  return <div className="damage" style={{ opacity: k ? 0.35 + k * 0.6 : 0 }} />;
}

function Crosshair() {
  const hud = useUI((s) => s.hud);
  const hitId = useUI((s) => s.hitId);
  const [hit, setHit] = useState(false);
  useEffect(() => {
    if (!hitId) return;
    setHit(true);
    const t = setTimeout(() => setHit(false), 140);
    return () => clearTimeout(t);
  }, [hitId]);
  if (hud.inVehicle || hud.melee) return null;
  return (
    <div className={`crosshair ${hud.aiming ? 'aim' : ''}`}>
      <i />
      <i />
      <i />
      <i />
      {hit && <b className="hitmark">✕</b>}
    </div>
  );
}

export function HUD() {
  const h = useUI((s) => s.hud);
  const screen = useUI((s) => s.screen);
  const settings = useUI((s) => s.settings);
  const hideCore = screen === 'missionIntro' || screen === 'menu' || screen === 'charselect' || screen === 'loading';
  if (hideCore) return <>{h.letterbox && <div className="letterbox" />}</>;
  return (
    <div className="hud">
      <DamageVignette />
      {h.letterbox && <div className="letterbox" />}
      <div className="hud-tr">
        <div className="cash">{formatMoney(h.cash)}</div>
        <Stars n={h.wanted} searching={h.searching} />
        <div className="clock">
          {h.time} <span>• {h.weather}</span>
        </div>
      </div>
      {(h.objective || h.activityName) && (
        <div className="objective">
          {h.activityName && !h.objective && <div className="obj-hint">{h.activityName}</div>}
          {h.objective && (
            <>
              <div className="obj-label">{h.missionActive ? 'MISSION' : h.activityName || 'ACTIVITY'}</div>
              <div className="obj-text">{h.objective}</div>
              {h.objectiveDetail && <div className="obj-detail">{h.objectiveDetail}</div>}
            </>
          )}
          {h.timer !== null && <div className={`obj-timer ${h.timer < 15 ? 'low' : ''}`}>{formatTime(h.timer)}</div>}
        </div>
      )}
      {h.race && (
        <div className="race-pos">
          <span>{h.race.pos}</span>/{h.race.total}
          <small>POSITION</small>
        </div>
      )}
      {h.drift && (
        <div className="drift">
          <div className="drift-score">{h.drift.score.toLocaleString()}</div>
          <div className="drift-combo">x{h.drift.combo} COMBO</div>
          <div className="bar drift-bar">
            <div style={{ width: `${Math.min(100, (h.drift.score / h.drift.goal) * 100)}%` }} />
          </div>
        </div>
      )}
      {h.countdown !== null && <div className="countdown">{h.countdown}</div>}
      <div className="hud-bl">
        <Minimap />
        <div className="vitals">
          <Bar v={h.health} max={h.maxHealth} cls={h.health < h.maxHealth * 0.25 ? 'hp low' : 'hp'} />
          <Bar v={h.armor} max={100} cls="armor" />
          <Bar v={h.stamina} max={100} cls="stamina" />
        </div>
        <div className="location">
          <b>{h.district}</b>
          {h.street && <span>{h.street}</span>}
        </div>
      </div>
      <div className="hud-br">
        {h.inVehicle ? (
          <Speedo />
        ) : (
          <div className="weapon">
            <div className="weapon-name">{h.weapon}</div>
            {!h.melee && (
              <div className="ammo">
                {h.reloading ? 'RELOADING' : h.clip}
                <span> / {h.ammo}</span>
              </div>
            )}
            <div className="medkits">✚ {h.medkits} med kits (H)</div>
          </div>
        )}
      </div>
      <Crosshair />
      {h.prompt && screen === 'playing' && (
        <div className="prompt">
          <kbd>E</kbd> {h.prompt}
        </div>
      )}
      <Notes />
      <Subtitle />
      <BigMessage />
      {settings.showFps && <div className="fps">{h.fps} FPS</div>}
    </div>
  );
}
