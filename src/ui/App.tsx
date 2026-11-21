import { useEffect } from 'react';
import { gameRef } from '../gameRef';
import { HUD } from './HUD';
import { MapScreen } from './MapScreen';
import { CharSelect, ControlsScreen, Death, Inventory, Loading, MainMenu, MissionIntro, MissionResult, PauseMenu, SettingsScreen, Shop, StatsScreen } from './Menus';
import { useUI } from './store';
import { RotateHint, TouchControls, isTouchDevice } from './TouchControls';

const TOUCH = isTouchDevice();
if (TOUCH) document.body.classList.add('touch');

export function App() {
  const screen = useUI((s) => s.screen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = gameRef.g;
      if (!g) return;
      const s = useUI.getState();
      const code = e.code;
      if (s.screen === 'paused' && (code === 'Tab' || code === 'Escape' || code === 'KeyP')) {
        e.preventDefault();
        g.resume();
      } else if (s.screen === 'map' && (code === 'KeyM' || code === 'Escape' || code === 'Tab')) {
        e.preventDefault();
        g.resume();
      } else if ((s.screen === 'inventory' || s.screen === 'stats') && (code === 'KeyI' || code === 'Escape' || code === 'Tab')) {
        e.preventDefault();
        g.resume();
      } else if (s.screen === 'missionIntro' && s.intro) {
        if (code === 'Enter') s.intro.accept();
        if (code === 'Escape') s.intro.decline();
      } else if (s.screen === 'missionResult' && (code === 'Enter' || code === 'Escape' || code === 'Space')) {
        e.preventDefault();
        g.closeResult();
      } else if (s.screen === 'shop' && (code === 'Escape' || code === 'Tab')) {
        e.preventDefault();
        g.closeShop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const inGame = !['loading', 'menu', 'charselect'].includes(screen) && !(screen === 'settings' && useUI.getState().prevScreen === 'menu') && !(screen === 'controls' && useUI.getState().prevScreen === 'menu');

  return (
    <>
      {inGame && <HUD />}
      {TOUCH && inGame && <TouchControls />}
      {TOUCH && <RotateHint />}
      {screen === 'loading' && <Loading />}
      {screen === 'menu' && <MainMenu />}
      {screen === 'charselect' && <CharSelect />}
      {screen === 'settings' && <SettingsScreen />}
      {screen === 'controls' && <ControlsScreen />}
      {screen === 'paused' && <PauseMenu />}
      {screen === 'map' && <MapScreen />}
      {screen === 'inventory' && <Inventory />}
      {screen === 'stats' && <StatsScreen />}
      {screen === 'missionIntro' && <MissionIntro />}
      {screen === 'missionResult' && <MissionResult />}
      {screen === 'shop' && <Shop />}
      {screen === 'wasted' && <Death kind="wasted" />}
      {screen === 'busted' && <Death kind="busted" />}
      {screen === 'playing' && <ClickToPlay />}
    </>
  );
}

function ClickToPlay() {
  return null;
}
