import { useEffect, useRef, useState } from 'react';
import { gameRef } from '../gameRef';
import { useUI } from './store';

/** true on phones / tablets (touch-first screens) */
export const isTouchDevice = () => typeof window !== 'undefined' && (new URLSearchParams(location.search).has('touch') || window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0);

// Touch controls feed the same keyboard codes the game already understands.
const press = (code: string) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code }));
const release = (code: string) => window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code }));

const capture = (e: React.PointerEvent) => {
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    /* pointer already gone */
  }
};

function Btn({ code, label, className = '', hold = true }: { code: string; label: string; className?: string; hold?: boolean }) {
  const down = useRef(false);
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    capture(e);
    down.current = true;
    press(code);
    if (!hold) setTimeout(() => release(code), 60);
    navigator.vibrate?.(8);
  };
  const end = (e: React.PointerEvent) => {
    e.preventDefault();
    if (!down.current) return;
    down.current = false;
    if (hold) release(code);
  };
  return (
    <button className={`tc-btn ${className}`} onPointerDown={start} onPointerUp={end} onPointerCancel={end} onContextMenu={(e) => e.preventDefault()}>
      {label}
    </button>
  );
}

/** Left thumb-stick: maps to W/A/S/D (walk & strafe, or throttle/brake & steer). */
function Stick() {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const id = useRef<number | null>(null);
  const held = useRef(new Set<string>());
  const sprint = useRef(false);

  const setKeys = (want: Set<string>) => {
    for (const k of held.current) if (!want.has(k)) release(k);
    for (const k of want) if (!held.current.has(k)) press(k);
    held.current = want;
  };
  const move = (cx: number, cy: number) => {
    const r = base.current!.getBoundingClientRect();
    const R = r.width / 2;
    let dx = cx - (r.left + R),
      dy = cy - (r.top + R);
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx = (dx / d) * R;
      dy = (dy / d) * R;
    }
    setKnob({ x: dx, y: dy });
    const nx = dx / R,
      ny = dy / R;
    const want = new Set<string>();
    if (ny < -0.3) want.add('KeyW');
    if (ny > 0.3) want.add('KeyS');
    if (nx < -0.35) want.add('KeyA');
    if (nx > 0.35) want.add('KeyD');
    // push the stick all the way forward on foot to sprint
    const inVehicle = useUI.getState().hud.inVehicle;
    const wantSprint = !inVehicle && ny < -0.92;
    if (wantSprint !== sprint.current) {
      sprint.current = wantSprint;
      if (wantSprint) press('ShiftRight');
      else release('ShiftRight');
    }
    setKeys(want);
  };
  const end = () => {
    id.current = null;
    setKnob({ x: 0, y: 0 });
    setKeys(new Set());
    if (sprint.current) release('ShiftRight');
    sprint.current = false;
  };
  return (
    <div
      className="tc-stick"
      ref={base}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        id.current = e.pointerId;
        capture(e);
        move(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => id.current === e.pointerId && move(e.clientX, e.clientY)}
      onPointerUp={(e) => id.current === e.pointerId && end()}
      onPointerCancel={end}
    >
      <div className="tc-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

export function TouchControls() {
  const screen = useUI((s) => s.screen);
  const inVehicle = useUI((s) => s.hud.inVehicle);
  const isPlane = useUI((s) => s.hud.altitude !== null && s.hud.altitude !== undefined);
  const look = useRef<{ id: number; x: number; y: number } | null>(null);

  // drag anywhere on the right side of the screen to look around
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || look.current) return;
      if ((e.target as HTMLElement).closest('.tc-btn, .tc-stick, button, .panel, .minimap')) return;
      if (e.clientX < window.innerWidth * 0.4) return;
      look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    };
    const mv = (e: PointerEvent) => {
      const l = look.current;
      const g = gameRef.g;
      if (!l || l.id !== e.pointerId || !g) return;
      g.input.mouseDX += (e.clientX - l.x) * 1.8;
      g.input.mouseDY += (e.clientY - l.y) * 1.8;
      l.x = e.clientX;
      l.y = e.clientY;
    };
    const up = (e: PointerEvent) => {
      if (look.current?.id === e.pointerId) look.current = null;
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  if (screen !== 'playing') return null;
  return (
    <div className="touch-controls">
      <div className="tc-top">
        <Btn code="KeyP" label="❚❚" hold={false} className="small" />
        <Btn code="KeyM" label="MAP" hold={false} className="small" />
        <Btn code="KeyE" label="E" hold={false} className="small" />
      </div>
      <Stick />
      <div className="tc-right">
        {!inVehicle && (
          <>
            <Btn code="KeyK" label="FIRE" className="fire" />
            <Btn code="Space" label="JUMP" />
            <Btn code="KeyG" label="GUN" hold={false} />
            <Btn code="KeyR" label="RELOAD" hold={false} className="small" />
            <Btn code="KeyQ" label="ROLL" hold={false} className="small" />
          </>
        )}
        {inVehicle && !isPlane && (
          <>
            <Btn code="ShiftLeft" label="NITRO" className="fire" />
            <Btn code="Space" label="DRIFT" />
            <Btn code="KeyH" label="HORN" className="small" />
          </>
        )}
        {inVehicle && isPlane && (
          <>
            <Btn code="Space" label="▲ UP" className="fire" />
            <Btn code="ShiftLeft" label="▼ DOWN" />
          </>
        )}
        <Btn code="KeyF" label={inVehicle ? 'EXIT' : 'CAR'} hold={false} className="enter" />
      </div>
    </div>
  );
}

/** Ask phone players to turn the phone sideways. */
export function RotateHint() {
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    const f = () => setPortrait(window.innerHeight > window.innerWidth * 1.1);
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  if (!portrait) return null;
  return (
    <div className="rotate-hint">
      <div className="rotate-icon">📱↻</div>
      <div>Turn your phone sideways to play</div>
    </div>
  );
}
