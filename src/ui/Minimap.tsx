import { useEffect, useRef } from 'react';
import { gameRef } from '../gameRef';
import { getMapImage, worldToMap, MAP_SCALE } from './mapImage';
import type { Blip } from '../game/systems/Markers';

const SIZE = 230;

export function drawBlipGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, b: Blip, r = 8) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8,8,16,0.85)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = b.color;
  ctx.stroke();
  ctx.fillStyle = b.color;
  ctx.font = `bold ${Math.round(r * 1.25)}px Rajdhani, Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(b.glyph, x, y + 1);
}

export function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const g = gameRef.g;
      const c = ref.current;
      if (!g || !c || !g.layout) return;
      const ctx = c.getContext('2d')!;
      const img = getMapImage(g.layout);
      const p = g.player;
      const base = p.vehicle ? p.vehicle.pos : p.pos;
      const speed = p.vehicle ? p.vehicle.speed : 0;
      const zoom = (p.vehicle ? 1.25 - Math.min(0.55, speed / 80) : 1.8) / MAP_SCALE * 0.6;
      const yaw = g.cam.yaw;
      const rot = -Math.PI / 2 - Math.atan2(Math.cos(yaw), Math.sin(yaw));
      const pm = worldToMap(base.x, base.z);
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.save();
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 3, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#071c2a';
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.translate(SIZE / 2, SIZE / 2);
      ctx.rotate(rot);
      ctx.scale(zoom, zoom);
      ctx.translate(-pm.x, -pm.y);
      ctx.drawImage(img, 0, 0);
      // search radius when wanted
      if (g.wanted.level > 0 && g.wanted.searching) {
        const lk = worldToMap(g.wanted.lastKnown.x, g.wanted.lastKnown.z);
        ctx.beginPath();
        ctx.arc(lk.x, lk.y, g.wanted.searchRadius * MAP_SCALE, 0, Math.PI * 2);
        const t = (performance.now() / 300) % 2 < 1;
        ctx.fillStyle = t ? 'rgba(255,40,60,0.18)' : 'rgba(40,80,255,0.18)';
        ctx.fill();
      }
      // GPS route
      const route = g.nav.route;
      if (route.length > 1) {
        ctx.strokeStyle = g.nav.missionTarget ? '#ffd000' : '#c04dff';
        ctx.lineWidth = 7 / zoom;
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        route.forEach((r, i) => {
          const m = worldToMap(r.x, r.z);
          if (i === 0) ctx.moveTo(m.x, m.y);
          else ctx.lineTo(m.x, m.y);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // radius blips (treasure areas)
      for (const b of g.markers.blips.values()) {
        if (!b.radius || b.hidden) continue;
        const m = worldToMap(b.x, b.z);
        ctx.beginPath();
        ctx.arc(m.x, m.y, b.radius * MAP_SCALE, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(242,194,48,0.18)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(242,194,48,0.6)';
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();
      }
      ctx.restore();
      // blips in screen space (so they don't rotate)
      const cr = Math.cos(rot),
        sr = Math.sin(rot);
      const toScreen = (x: number, z: number) => {
        const m = worldToMap(x, z);
        const dx = (m.x - pm.x) * zoom,
          dy = (m.y - pm.y) * zoom;
        return { x: SIZE / 2 + dx * cr - dy * sr, y: SIZE / 2 + dx * sr + dy * cr };
      };
      const R = SIZE / 2 - 12;
      const important = new Set(['mission', 'objective', 'enemy', 'waypoint']);
      const list = [...g.markers.blips.values()].filter((b) => !b.hidden);
      list.sort((a, b) => (important.has(a.kind) ? 1 : 0) - (important.has(b.kind) ? 1 : 0));
      for (const b of list) {
        let s = toScreen(b.x, b.z);
        const dx = s.x - SIZE / 2,
          dy = s.y - SIZE / 2;
        const d = Math.hypot(dx, dy);
        if (d > R) {
          if (!important.has(b.kind)) continue;
          s = { x: SIZE / 2 + (dx / d) * R, y: SIZE / 2 + (dy / d) * R };
        }
        drawBlipGlyph(ctx, s.x, s.y, b, important.has(b.kind) ? 8 : 6.5);
      }
      // police units
      const flash = (performance.now() / 250) % 2 < 1;
      for (const v of g.vehicles.list) {
        if (!v.spec.police || v.destroyed || v.driver === 'player') continue;
        const s = toScreen(v.pos.x, v.pos.z);
        if (Math.hypot(s.x - SIZE / 2, s.y - SIZE / 2) > R + 6) continue;
        ctx.fillStyle = g.wanted.level > 0 ? (flash ? '#ff3040' : '#3070ff') : '#5a7aff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const o of g.police.officers) {
        if (!o.alive) continue;
        const s = toScreen(o.pos.x, o.pos.z);
        if (Math.hypot(s.x - SIZE / 2, s.y - SIZE / 2) > R + 6) continue;
        ctx.fillStyle = flash ? '#ff6070' : '#6090ff';
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
      }
      for (const h of g.police.helis) {
        const s = toScreen(h.pos.x, h.pos.z);
        ctx.strokeStyle = flash ? '#ff3040' : '#3070ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
      // waypoint
      if (g.nav.waypoint) {
        let s = toScreen(g.nav.waypoint.x, g.nav.waypoint.z);
        const d = Math.hypot(s.x - SIZE / 2, s.y - SIZE / 2);
        if (d > R) s = { x: SIZE / 2 + ((s.x - SIZE / 2) / d) * R, y: SIZE / 2 + ((s.y - SIZE / 2) / d) * R };
        drawBlipGlyph(ctx, s.x, s.y, { id: 'wp', x: 0, z: 0, glyph: '◈', color: '#c04dff', label: '', kind: 'waypoint' }, 8);
      }
      // player arrow
      const py = p.vehicle ? p.vehicle.yaw : p.yaw;
      const pa = Math.atan2(Math.cos(py), Math.sin(py)) + rot;
      ctx.save();
      ctx.translate(SIZE / 2, SIZE / 2);
      ctx.rotate(pa + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(7, 8);
      ctx.lineTo(0, 4);
      ctx.lineTo(-7, 8);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#29e6ff';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.restore();
      // north marker
      const n = toScreen(base.x, base.z - 10000);
      const nd = Math.hypot(n.x - SIZE / 2, n.y - SIZE / 2);
      const nx = SIZE / 2 + ((n.x - SIZE / 2) / nd) * (SIZE / 2 - 10),
        ny = SIZE / 2 + ((n.y - SIZE / 2) / nd) * (SIZE / 2 - 10);
      ctx.fillStyle = '#ff2d95';
      ctx.font = 'bold 13px Rajdhani, Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', nx, ny);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} width={SIZE} height={SIZE} className="minimap" />;
}
