'use client';
import { useEffect, useRef } from 'react';
import { store, useGame } from '../ui/store';
import { engine } from '../ui/engine';
import { loadSettings } from '../ui/settings';
import Hud from './Hud';
import Touch from './Touch';
import { StartScreen, PauseMenu } from './Screens';
import { SurveyMenu, SurveyMap } from './Survey';

export default function Game() {
  const canvas = useRef(null);
  const phase = useGame('phase');
  const touch = useGame('touch');

  useEffect(() => {
    let dead = false, handle = null;
    const coarse = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    store.set({ touch: coarse, helpOpen: !coarse, settings: loadSettings() });
    import('../engine')
      .then(({ startEngine }) => startEngine({ canvas: canvas.current, store, onProgress: (progress, bootLabel) => store.set({ progress, bootLabel }) }))
      .then((h) => {
        if (dead) return h.dispose();
        handle = h;
        engine.current = h;
        window.__game = Object.assign(h, { store }); // (assign, not spread: the handle has live getters)
        store.set({ phase: 'ready' });
      })
      .catch((e) => { console.error(e); store.set({ error: String(e?.message || e) }); });
    return () => { dead = true; engine.current = null; handle?.dispose(); };
  }, []);

  return (
    <main className="app" data-phase={phase}>
      <canvas ref={canvas} className="game-canvas" tabIndex={0} aria-label="Mining Haven 3D world" />
      {phase === 'playing' && <Hud />}
      {phase === 'playing' && <><SurveyMenu /><SurveyMap /></>}
      {phase === 'playing' && touch && <Touch />}
      {phase === 'paused' && <PauseMenu />}
      {(phase === 'boot' || phase === 'ready') && <StartScreen />}
    </main>
  );
}
