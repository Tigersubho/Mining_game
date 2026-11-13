'use client';
import { store, useGame } from '../ui/store';
import { engine } from '../ui/engine';
import { saveSettings } from '../ui/settings';

function begin() {
  store.set({ phase: 'playing' });
  if (!store.get().touch) engine.current?.lock();
}

export function StartScreen() {
  const phase = useGame('phase'), progress = useGame('progress'), label = useGame('bootLabel'), error = useGame('error'), touch = useGame('touch');
  const ready = phase === 'ready';
  return (
    <div className="screen start">
      <div className="brand">
        <span className="eyebrow">INTEGRATED MINING &amp; CONSTRUCTION</span>
        <h1>MINING HAVEN</h1>
        <p>A working mining district: open-pit operations, jungle exploration, a legacy mine and the city that supplies them. Explore on foot.</p>
      </div>
      {error ? (
        <div className="panel err" role="alert"><h3 className="panel-title">STARTUP FAILED</h3><p>{error}</p><p>WebGL is required. Try a current Chrome, Edge, Firefox or Safari.</p></div>
      ) : (
        <>
          <div className="bar" aria-label="Loading" role="progressbar" aria-valuenow={Math.round(progress * 100)}><i style={{ width: `${progress * 100}%` }} /></div>
          <button className="btn primary" disabled={!ready} onClick={begin}>{ready ? 'ENTER SITE' : label.toUpperCase()}</button>
          <p className="fine">{touch ? 'Left thumb: move. Right side: look. Buttons: actions.' : 'The mouse is captured while playing. Press ESC to pause.'}</p>
        </>
      )}
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange }) {
  return (
    <label className="field"><span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      <b>{value.toFixed(1)}</b>
    </label>
  );
}

export function PauseMenu() {
  const settings = useGame('settings'), touch = useGame('touch');
  const update = (patch) => {
    const s = { ...settings, ...patch };
    store.set({ settings: s });
    saveSettings(s);
    if (patch.quality) engine.current?.applyQuality(patch.quality);
  };
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {}));
  return (
    <div className="screen pause" role="dialog" aria-label="Paused">
      <div className="panel menu">
        <h3 className="panel-title">PAUSED</h3>
        <button className="btn primary" onClick={begin}>RESUME</button>
        <div className="settings">
          <Slider label="LOOK SENSITIVITY" value={settings.sensitivity} min={0.2} max={2.5} step={0.1} onChange={(v) => update({ sensitivity: v })} />
          <label className="field"><span>GRAPHICS</span>
            <select value={settings.quality} onChange={(e) => update({ quality: e.target.value })}>
              <option value="low">LOW - best battery</option><option value="medium">MEDIUM</option><option value="high">HIGH</option>
            </select>
          </label>
          <label className="field check"><span>INVERT LOOK (Y)</span><input type="checkbox" checked={settings.invertY} onChange={(e) => update({ invertY: e.target.checked })} /></label>
        </div>
        <div className="menu-row">
          <button className="btn" onClick={fullscreen}>FULLSCREEN</button>
          <button className="btn" onClick={() => { engine.current?.player.respawn(); begin(); }}>RETURN TO HUB</button>
        </div>
        {!touch && <p className="fine">W A S D move - SHIFT sprint - SPACE jump - F pickaxe - E / click use - M map</p>}
      </div>
    </div>
  );
}
