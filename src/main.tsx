import { createRoot } from 'react-dom/client';
import { Game } from './game/Game';
import { gameRef } from './gameRef';
import { App } from './ui/App';
import './ui/styles.css';

const container = document.getElementById('game-root')!;
const game = new Game(container);
gameRef.g = game;

createRoot(document.getElementById('ui-root')!).render(<App />);

game.boot().catch((e) => {
  console.error(e);
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;inset:20px;color:#ff6688;background:#000c;padding:20px;z-index:99;white-space:pre-wrap';
  el.textContent = 'Neon Bay failed to start:\n' + (e?.stack ?? e);
  document.body.appendChild(el);
});
