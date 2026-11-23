import { useEffect, useRef, useState } from 'react';
import { G } from '../gameRef';
import { WORLD } from '../game/constants';
import { getMapImage, mapToWorld, worldToMap, MAP_SCALE } from './mapImage';
import { drawBlipGlyph } from './Minimap';
import { TOUCH } from './device';
import type { Blip } from '../game/systems/Markers';

const LEGEND: { kind: Blip['kind']; label: string; glyph: string; color: string }[] = [
  { kind: 'mission', label: 'Story mission', glyph: '!', color: '#ffd000' },
  { kind: 'safehouse', label: 'Safehouse / property', glyph: 'H', color: '#39ff88' },
  { kind: 'shop', label: 'Shops & dealers', glyph: '$', color: '#29e6ff' },
  { kind: 'service', label: 'Services', glyph: 'F', color: '#9be22a' },
  { kind: 'police', label: 'Police station', glyph: 'P', color: '#4a8cff' },
  { kind: 'activity', label: 'Races, stunts & challenges', glyph: '⚑', color: '#ff2d95' },
  { kind: 'collectible', label: 'Treasure', glyph: '✉', color: '#f2e2b0' },
  { kind: 'objective', label: 'Objective', glyph: '★', color: '#ffd000' },
];

export function MapScreen() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState(() => {
    const g = G();
    const p = g.player.pos;
    return { cx: p.x, cz: p.z, zoom: 1.1 };
  });
  const [hover, setHover] = useState<Blip | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const drag = useRef<{ x: number; y: number; cx: number; cz: number; moved: boolean } | null>(null);
  // active touches / mouse for pan + pinch zoom
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; zoom: number } | null>(null);
  const [legend, setLegend] = useState(!TOUCH);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = ref.current;
      if (!c) return;
      const g = G();
      const W = (c.width = c.clientWidth),
        H = (c.height = c.clientHeight);
      const ctx = c.getContext('2d')!;
      const img = getMapImage(g.layout);
      const center = worldToMap(view.cx, view.cz);
      ctx.fillStyle = '#061420';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(view.zoom, view.zoom);
      ctx.translate(-center.x, -center.y);
      ctx.drawImage(img, 0, 0);
      const route = g.nav.route;
      if (route.length > 1) {
        ctx.strokeStyle = g.nav.missionTarget ? '#ffd000' : '#c04dff';
        ctx.lineWidth = 5 / view.zoom;
        ctx.beginPath();
        route.forEach((r, i) => {
          const m = worldToMap(r.x, r.z);
          if (i === 0) ctx.moveTo(m.x, m.y);
          else ctx.lineTo(m.x, m.y);
        });
        ctx.stroke();
      }
      for (const b of g.markers.blips.values()) {
        if (!b.radius || b.hidden) continue;
        const m = worldToMap(b.x, b.z);
        ctx.beginPath();
        ctx.arc(m.x, m.y, b.radius * MAP_SCALE, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(242,194,48,0.2)';
        ctx.fill();
      }
      ctx.restore();
      const toScreen = (x: number, z: number) => {
        const m = worldToMap(x, z);
        return { x: W / 2 + (m.x - center.x) * view.zoom, y: H / 2 + (m.y - center.y) * view.zoom };
      };
      for (const b of g.markers.blips.values()) {
        if (b.hidden || b.minimapOnly || hidden.has(b.kind)) continue;
        const s = toScreen(b.x, b.z);
        drawBlipGlyph(ctx, s.x, s.y, b, b === hover ? 12 : 9);
      }
      if (g.nav.waypoint) {
        const s = toScreen(g.nav.waypoint.x, g.nav.waypoint.z);
        drawBlipGlyph(ctx, s.x, s.y, { id: 'wp', x: 0, z: 0, glyph: '◈', color: '#c04dff', label: '', kind: 'waypoint' }, 11);
      }
      const p = g.player;
      const base = p.vehicle ? p.vehicle.pos : p.pos;
      const s = toScreen(base.x, base.z);
      const yaw = p.vehicle ? p.vehicle.yaw : p.yaw;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(Math.atan2(Math.cos(yaw), Math.sin(yaw)) + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(9, 10);
      ctx.lineTo(0, 5);
      ctx.lineTo(-9, 10);
      ctx.closePath();
      ctx.fillStyle = '#fff';
      ctx.shadowColor = '#29e6ff';
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.restore();
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [view, hover, hidden]);

  const screenToWorld = (sx: number, sy: number) => {
    const c = ref.current!;
    const center = worldToMap(view.cx, view.cz);
    const mx = center.x + (sx - c.clientWidth / 2) / view.zoom,
      my = center.y + (sy - c.clientHeight / 2) / view.zoom;
    return mapToWorld(mx, my);
  };

  const findBlip = (sx: number, sy: number) => {
    const g = G();
    const c = ref.current!;
    const center = worldToMap(view.cx, view.cz);
    let best: Blip | null = null,
      bd = 14;
    for (const b of g.markers.blips.values()) {
      if (b.hidden || b.minimapOnly || hidden.has(b.kind)) continue;
      const m = worldToMap(b.x, b.z);
      const x = c.clientWidth / 2 + (m.x - center.x) * view.zoom,
        y = c.clientHeight / 2 + (m.y - center.y) * view.zoom;
      const d = Math.hypot(x - sx, y - sy);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  };

  return (
    <div className="mapscreen">
      <canvas
        ref={ref}
        className="bigmap"
        onWheel={(e) => setView((v) => ({ ...v, zoom: Math.max(0.35, Math.min(5, v.zoom * (e.deltaY < 0 ? 1.15 : 0.87))) }))}
        onPointerDown={(e) => {
          (e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
          pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pts.current.size === 1) drag.current = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz, moved: false };
          else if (pts.current.size === 2) {
            const [p, q] = [...pts.current.values()];
            pinch.current = { d: Math.hypot(p.x - q.x, p.y - q.y), zoom: view.zoom };
            if (drag.current) drag.current.moved = true; // a pinch is never a tap
          }
        }}
        onPointerMove={(e) => {
          const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
          if (e.pointerType === 'mouse') setHover(findBlip(e.clientX - r.left, e.clientY - r.top));
          if (!pts.current.has(e.pointerId)) return;
          pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pinch.current && pts.current.size >= 2) {
            const [p, q] = [...pts.current.values()];
            const k = Math.hypot(p.x - q.x, p.y - q.y) / Math.max(1, pinch.current.d);
            const z0 = pinch.current.zoom;
            setView((v) => ({ ...v, zoom: Math.max(0.35, Math.min(5, z0 * k)) }));
            return;
          }
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x,
            dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > (e.pointerType === 'mouse' ? 4 : 10)) d.moved = true;
          if (!d.moved) return;
          const k = 1 / (view.zoom * MAP_SCALE);
          setView((v) => ({ ...v, cx: Math.max(WORLD.minX, Math.min(WORLD.maxX, d.cx - dx * k)), cz: Math.max(WORLD.minZ, Math.min(WORLD.maxZ, d.cz - dy * k)) }));
        }}
        onPointerUp={(e) => {
          pts.current.delete(e.pointerId);
          if (pts.current.size < 2) pinch.current = null;
          if (pts.current.size > 0) {
            // keep panning with the remaining finger from where it is now
            const [p] = [...pts.current.values()];
            drag.current = { x: p.x, y: p.y, cx: view.cx, cz: view.cz, moved: true };
            return;
          }
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved && e.button === 0) {
            const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
            const sx = e.clientX - r.left,
              sy = e.clientY - r.top;
            if (e.pointerType !== 'mouse') setHover(findBlip(sx, sy));
            const w = screenToWorld(sx, sy);
            G().nav.setWaypoint(w.x, w.z);
            G().audio.ui();
          }
        }}
        onPointerCancel={(e) => {
          pts.current.delete(e.pointerId);
          pinch.current = null;
          drag.current = null;
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          G().nav.clearWaypoint();
        }}
      />
      <div className="map-panel">
        <h2>NEON BAY</h2>
        <p className="hint">{TOUCH ? 'Tap to set a GPS waypoint • Drag to move • Pinch to zoom' : 'Click to set a GPS waypoint • Right-click to clear • Drag to pan • Scroll to zoom'}</p>
        {TOUCH && (
          <button className="btn small" onClick={() => setLegend((l) => !l)}>
            {legend ? 'Hide legend' : 'Show legend'}
          </button>
        )}
        {legend && <div className="legend">
          {LEGEND.map((l) => (
            <label key={l.kind} className={hidden.has(l.kind) ? 'off' : ''}>
              <input
                type="checkbox"
                checked={!hidden.has(l.kind)}
                onChange={() =>
                  setHidden((h) => {
                    const n = new Set(h);
                    if (n.has(l.kind)) n.delete(l.kind);
                    else n.add(l.kind);
                    return n;
                  })
                }
              />
              <span className="lg" style={{ borderColor: l.color, color: l.color }}>
                {l.glyph}
              </span>
              {l.label}
            </label>
          ))}
        </div>}
        {hover && <div className="hoverinfo">{hover.label}</div>}
        <button
          className="btn small"
          onClick={() => {
            const p = G().player.pos;
            setView((v) => ({ ...v, cx: p.x, cz: p.z }));
          }}
        >
          Center on me
        </button>
        {TOUCH && (
          <button className="btn small" onClick={() => G().nav.clearWaypoint()}>
            Clear GPS
          </button>
        )}
        <button className="btn small" onClick={() => G().resume()}>
          {TOUCH ? 'Close map' : 'Close map (M)'}
        </button>
      </div>
    </div>
  );
}
