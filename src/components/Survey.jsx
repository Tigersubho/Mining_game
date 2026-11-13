'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { store, useGame } from '../ui/store';
import { engine } from '../ui/engine';
import { fmtCoord } from '../ui/format';
import { SENSORS, SENSOR_IDS, MODES, footprint } from '../engine/survey/sensors';
import { paintMap, paintProfile, paintScanner, paint25D, legend, paintWorld, layerView } from '../engine/survey/render';
import { drawMinimapBg } from '../engine/minimap';
import { interpret } from '../engine/survey/analysis';
import { createHandSensor, createRover, createDrone, mountOn } from '../engine/survey/models';
import { DEPOSIT_MINERALS } from '../engine/survey/minerals';

const S_ = () => engine.current?.survey;
const Row = ({ k, v, accent, style }) => <div className="row" style={style}><span className="k">{k}</span><span className={`v ${accent ? 'accent' : ''}`}>{v}</span></div>;
const Bar = ({ value, warn, color }) => <div className={`bar-gauge ${warn ? 'warn' : ''}`}><i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} /></div>;
const sigColor = (p) => `hsl(${Math.round(120 - Math.min(1, p) * 120)}, 85%, 55%)`;
const LAYER_NAME = { surface: 'SURFACE', cave0: 'RIDGE MINE (UNDERGROUND)', cave1: 'SUNKEN GROTTO (FLOODED)', water: 'LAKE / RIVER / PIT BED' };
const mineralName = (k) => DEPOSIT_MINERALS[k]?.name.replace(/ \(.*\)$/, '') ?? k;

function useRaf(fn, on, every = 0) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => {
    if (!on) return undefined;
    let id, last = 0;
    const loop = (t) => { if (t - last >= every) { last = t; ref.current(t); } id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [on, every]);
}

// ---------------------------------------------------------------- HUD: status panel + quick buttons
export function SurveyStatus() {
  const s = useGame('survey');
  const dock = (
    <div className="sv-dock">
      <button className="live" onClick={() => store.set((st) => ({ surveyMenu: !st.surveyMenu, surveyMap: false }))}>U EQUIP</button>
      <button className="live" onClick={() => store.set((st) => ({ surveyMap: !st.surveyMap, surveyMenu: false }))}>Z MAP</button>
      <button className="live" onClick={() => S_()?.saveAlert()}>X SAVE</button>
      <button className="live" onClick={() => S_()?.callExcavator()}>Y DIG</button>
    </div>
  );
  if (!s?.sensor) return <section className="panel survey-status"><h3 className="panel-title">GEOPHYSICS</h3><Row k="SENSOR" v="NONE FITTED" />{dock}</section>;
  const sd = SENSORS[s.sensor], d = s.drone;
  return (
    <section className="panel survey-status">
      <h3 className="panel-title">GEOPHYSICS <small style={{ color: sd.css }}>{sd.short}</small></h3>
      <Row k="MODE" v={MODES[s.mode].short} />
      <Row k="STATUS" v={s.status} accent={s.collecting} />
      <Row k="SIGNAL" v={`${Math.round(s.signal * 100)}%`} />
      <Bar value={s.signal} color={sigColor(s.signal)} />
      {s.value && <Row k="READ" v={s.value} />}
      <Row k="COVERAGE" v={`${Math.round(s.coverage * 100)}% / ${Math.round(s.area)} m2`} />
      <Row k="ANOMALIES" v={s.anomalies} accent />
      <Row k="SENSOR BAT" v={`${Math.round(s.battery)}%`} />
      <Bar value={s.battery / 100} warn={s.battery < 20} />
      {d?.active && (
        <>
          <Row k="DRONE BAT" v={`${Math.round(d.battery)}%`} />
          <Bar value={d.battery / 100} warn={d.battery < 20} />
          <Row k="ALT / SPD" v={`${d.alt.toFixed(0)} m / ${(d.speed * 3.6).toFixed(0)} km/h`} />
        </>
      )}
      {s.excavator && <Row k="EXCAVATOR" v={s.excavator.state === 'digging' ? `DIGGING ${Math.round(s.excavator.progress * 100)}%` : s.excavator.state === 'done' ? 'ORE EXPOSED' : s.excavator.state === 'leaving' ? 'LEAVING' : `ETA ${Math.round(s.excavator.eta)} s`} accent />}
      {s.excavator?.state === 'digging' && <Bar value={s.excavator.progress} color="#f2b21c" />}
      {s.rover?.driving && <Row k="TERRAIN" v={`${s.rover.terrain} ${Math.round(s.rover.factor * 100)}%`} accent={s.rover.factor < 0.6} />}
      {d?.active && <button className="live drone-off" onClick={() => engine.current?.player.exitDrone()}>DRONE OFF / RETURN [O]</button>}
      {dock}
    </section>
  );
}

// ---------------------------------------------------------------- HUD: anomaly alert (SAVE LOCATION / CONTINUE SURVEY)
export function AnomalyAlert() {
  const s = useGame('survey'), a = s?.alert;
  if (!a) return null;
  const c = fmtCoord(a.x, a.z), p = a.intensity / 100;
  return (
    <div className="anomaly-alert" role="alert" style={{ '--sig': sigColor(p) }}>
      <div className="aa-head"><span className="aa-dot" /> <b>{a.title}</b><em>{a.intensity}%</em></div>
      <div className="aa-bar"><i style={{ width: `${a.intensity}%` }} /></div>
      <p>{a.text}</p>
      <div className="aa-meta">{SENSORS[a.sensor].short} - E {c.e} N {c.n} - est. depth ~{a.depth.toFixed(1)} m - {Math.round(a.dist)} m from sensor</div>
      <div className="aa-btns">
        <button className="live" onClick={() => S_()?.saveAlert()}>[X] SAVE LOCATION</button>
        <button className="live" onClick={() => S_()?.skipAlert()}>[T] CONTINUE SURVEY</button>
      </div>
      <div className="aa-time"><i style={{ width: `${(a.t / 16) * 100}%` }} /></div>
    </div>
  );
}

// ---------------------------------------------------------------- HUD: navigation to the selected saved location
export function TargetNav() {
  const s = useGame('survey'), heading = useGame('heading'), t = s?.target;
  if (!t) return null;
  const rel = t.bearing - heading, here = t.dist < 6;
  return (
    <div className={`target-nav ${here ? 'here' : ''}`}>
      <i className="tn-arrow" style={{ transform: `rotate(${rel}deg)` }} />
      <div>
        <b>{here ? 'AT TARGET - DIG HERE' : `${Math.round(t.dist)} m`}</b> <span>{t.title}</span>
        <small>{t.sensor ? SENSORS[t.sensor].short : 'MARK'} - signal {t.intensity}%{t.depth != null ? ` - est. ${t.depth.toFixed(1)} m deep (${t.machine ? 'EXCAVATOR [Y]' : 'PICKAXE'})` : ''}{t.confirmed ? ` - ${t.confirmed === 'barren' ? 'BARREN' : `CONFIRMED ${mineralName(t.confirmed).toUpperCase()}`}` : ''}</small>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- drone views (upper right while flying)
export function DroneViews() {
  const s = useGame('survey'), on = !!s?.drone?.active, sc = useRef(null), iso = useRef(null);
  useRaf((t) => { const S = S_(); if (S && sc.current) paintScanner(sc.current, S, t); }, on);
  useRaf((t) => { const S = S_(); if (S && iso.current) paint25D(iso.current, S, t); }, on, 110);
  if (!on) return null;
  const sd = SENSORS[s.drone.sensor];
  return (
    <>
      <section className="panel scanner-panel" aria-label="Live survey scanner">
        <h3 className="panel-title">LIVE SCAN <small style={{ color: sd.css }}>{sd.short} - BELOW DRONE</small></h3>
        <canvas ref={sc} width={260} height={260} />
      </section>
      <section className="panel iso-panel" aria-label="2.5D subsurface view">
        <h3 className="panel-title">SUBSURFACE 2.5D <small>{sd.product}</small></h3>
        <canvas ref={iso} width={340} height={290} />
      </section>
    </>
  );
}

// ---------------------------------------------------------------- 3D model preview (equipment menu)
function ModelPreview({ sensor, mode }) {
  const ref = useRef(null), gl = useRef(null);
  // one renderer for the life of the canvas (a canvas whose WebGL context was force-lost cannot get a new one) ...
  useEffect(() => {
    const cv = ref.current;
    let r;
    try { r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); } catch { return undefined; }
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.setSize(cv.clientWidth || 260, cv.clientHeight || 200, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x3a3020, 1.8));
    const dl = new THREE.DirectionalLight(0xffffff, 2.4); dl.position.set(3, 5, 4); scene.add(dl);
    const cam = new THREE.PerspectiveCamera(32, (cv.clientWidth || 260) / (cv.clientHeight || 200), 0.05, 200);
    const pivot = new THREE.Group(); scene.add(pivot);
    gl.current = { pivot, cam, obj: null };
    let id;
    const loop = (t) => { pivot.rotation.y = t * 0.0007; r.render(scene, cam); id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(id); r.dispose(); gl.current = null; };
  }, []);
  // ... and the model is swapped inside it
  useEffect(() => {
    const g = gl.current; if (!g) return;
    if (g.obj) g.pivot.remove(g.obj);
    const obj = mode === 'hand' ? createHandSensor(sensor) : mode === 'rover' ? createRover() : createDrone();
    if (mode !== 'hand') mountOn(obj.userData.mount, sensor, SENSORS[sensor].color);
    const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()).length(), centre = box.getCenter(new THREE.Vector3());
    obj.position.sub(centre);
    g.pivot.add(obj); g.obj = obj;
    g.cam.position.set(size * 0.8, size * 0.45, size * 0.8); g.cam.lookAt(0, 0, 0);
  }, [sensor, mode]);
  return <canvas ref={ref} className="preview" aria-label={`${SENSORS[sensor].name}, ${MODES[mode].label}`} />;
}

const Spec = ({ k, v, f }) => <div className="spec"><span>{k}</span><i><b style={{ width: `${Math.max(4, Math.min(1, f) * 100)}%` }} /></i><em>{v}</em></div>;

// ---------------------------------------------------------------- GEOPHYSICAL EQUIPMENT menu
export function SurveyMenu() {
  const open = useGame('surveyMenu'), s = useGame('survey');
  const [sel, setSel] = useState('mag'), [mode, setMode] = useState('hand');
  useEffect(() => { if (open && s?.sensor) { setSel(s.sensor); setMode(s.mode); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const sd = SENSORS[sel], ok = !(mode === 'drone' && sd.noDrone), close = () => store.set({ surveyMenu: false });
  const deploy = () => { if (S_()?.deploy(sel, mode)) close(); };
  return (
    <div className="survey-modal" role="dialog" aria-label="Geophysical equipment">
      <div className="panel sm-wrap">
        <h3 className="panel-title">GEOPHYSICAL EQUIPMENT <small>SELECT INSTRUMENT - MOUNTING - DEPLOY</small><button className="x" onClick={close} aria-label="Close">U / ESC</button></h3>
        <div className="sm-body">
          <ul className="sm-list">
            {SENSOR_IDS.map((id) => {
              const d = SENSORS[id];
              return (
                <li key={id}>
                  <button className={`sm-item ${sel === id ? 'on' : ''}`} onClick={() => setSel(id)}>
                    <i style={{ background: d.css }} /><b>{d.short}</b><span>{d.name}</span>
                    {s?.sensor === id && <em>FITTED</em>}
                    <small>{Math.round(s?.batteries?.[id] ?? 100)}%</small>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="sm-detail">
            <div className="sm-top">
              <ModelPreview sensor={sel} mode={ok ? mode : 'hand'} />
              <div>
                <h2 style={{ color: sd.css }}>{sd.name}</h2>
                <p>{sd.desc}</p>
                <div className="sm-detects">{sd.detects.map((t) => <span key={t}>{t}</span>)}</div>
              </div>
            </div>
            <div className="sm-specs">
              <Spec k="INVESTIGATION DEPTH" v={`${sd.depth} m`} f={sd.depth / 30} />
              <Spec k="FOOTPRINT (HAND / DRONE @12 m)" v={`${footprint(sel, 'hand').toFixed(1)} / ${sd.noDrone ? '--' : footprint(sel, 'drone', 12).toFixed(1)} m`} f={footprint(sel, 'hand') / 5} />
              <Spec k="SURVEY SPEED (ON FOOT)" v={`${sd.speed} m/s`} f={sd.speed / 2} />
              <Spec k="ACCURACY" v={`${Math.round(sd.accuracy * 100)}%`} f={sd.accuracy} />
              <Spec k="SENSITIVITY" v={`${Math.round(sd.sensitivity * 100)}%`} f={sd.sensitivity} />
              <Spec k="DATA RATE" v={`${sd.rate} Hz`} f={sd.rate / 10} />
              <Spec k="POWER DRAW" v={`${sd.drain} %/min`} f={sd.drain / 6} />
              <Spec k="OUTPUT" v={sd.product} f={1} />
            </div>
            <div className="sm-modes">
              {Object.values(MODES).map((m) => {
                const dis = m.id === 'drone' && sd.noDrone;
                return (
                  <button key={m.id} className={`sm-mode ${mode === m.id ? 'on' : ''}`} disabled={dis} onClick={() => setMode(m.id)}>
                    <b>{m.label}</b><span>{dis ? 'Needs ground contact: electrodes / geophones cannot fly.' : m.desc}</span>
                  </button>
                );
              })}
            </div>
            <div className="sm-actions">
              <button className="btn primary" disabled={!ok} onClick={deploy}>DEPLOY {sd.short} - {MODES[mode].short}</button>
              {s?.drone && <button className="btn" onClick={() => { S_()?.recallDrone(); }}>RECALL DRONE ({Math.round(s.drone.dist)} m)</button>}
            </div>
            <p className="fine">Rover and drone appear next to you; walk up and press K to drive / launch. Readings are saved per instrument and kept when you switch platforms.</p>
          </div>
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------- WORLD COVERAGE: the complete 2D map of what is mapped, per sensor
const LAYERS_UI = [['surface', 'ISLAND SURFACE'], ['cave0', 'RIDGE MINE'], ['cave1', 'SUNKEN GROTTO'], ['water', 'LAKE / RIVER / PIT BEDS']];
let islandBase = null;
/** the island picture (terrain, water, roads, bridges, farms) for the map background, drawn once */
function islandImage() {
  if (islandBase) return islandBase;
  const world = engine.current?.world;
  if (!world) return null;
  islandBase = document.createElement('canvas'); islandBase.width = islandBase.height = 1024;
  drawMinimapBg(islandBase, world.terrain);
  return islandBase;
}

function WorldCoverage({ S, s }) {
  const [layer, setLayer] = useState(S.layerNow()), [on, setOn] = useState(() => new Set(SENSOR_IDS)), [zoom, setZoom] = useState(1), [pan, setPan] = useState([0, 0]);
  const cv = useRef(null), drag = useRef(null), viewRef = useRef(null);
  const base = layerView(S, layer), ext = base.extent / zoom, cx = base.cx + pan[0], cz = base.cz + pan[1];
  useRaf(() => {
    const Sx = S_(); if (!Sx || !cv.current) return;
    viewRef.current = { cx, cz, extent: ext };
    paintWorld(cv.current, Sx, { layer, sensors: on, cx, cz, extent: ext, base: islandImage(), pose: Sx.pose() });
  }, true);
  const cov = S.coverage(layer), toggle = (id) => setOn((q) => { const n = new Set(q); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pickLayer = (l) => { setLayer(l); setZoom(1); setPan([0, 0]); };
  const onDown = (e) => { drag.current = { x: e.clientX, y: e.clientY, pan: [...pan] }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onMove = (e) => {
    const d = drag.current; if (!d || !cv.current) return;
    const k = ext / cv.current.getBoundingClientRect().width;
    setPan([d.pan[0] - (e.clientX - d.x) * k, d.pan[1] - (e.clientY - d.y) * k]);
  };
  const onUp = () => { drag.current = null; };
  const onWheel = (e) => setZoom((z) => Math.max(1, Math.min(14, z * (e.deltaY > 0 ? 1 / 1.25 : 1.25))));
  const km2 = (m2) => (m2 >= 1e6 ? `${(m2 / 1e6).toFixed(2)} km2` : `${Math.round(m2).toLocaleString()} m2`);
  const unmapped = Math.max(0, cov.area - cov.union.m2);
  return (
    <div className="smap-body">
      <div className="smap-view">
        <canvas ref={cv} width={760} height={760} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel} aria-label="World coverage map" />
      </div>
      <aside className="smap-side">
        <div className="seg wrap">{LAYERS_UI.map(([k, l]) => <button key={k} className={layer === k ? 'on' : ''} onClick={() => pickLayer(k)}>{l}</button>)}</div>
        <div className="lg-title">MAPPED BY SENSOR <em>{km2(cov.area)} surveyable</em></div>
        <div className="cov-list">
          {SENSOR_IDS.map((id) => {
            const c = cov.sensors[id], d = SENSORS[id];
            return (
              <button key={id} className={`cov-row ${on.has(id) ? 'on' : ''}`} onClick={() => toggle(id)} aria-pressed={on.has(id)}>
                <i style={{ background: d.css }} /><b>{d.short}</b><span className="cov-bar"><u style={{ width: `${Math.min(100, c.pct * 4)}%`, background: d.css }} /></span><em>{c.pct < 10 ? c.pct.toFixed(2) : c.pct.toFixed(1)}%</em>
                <small>{km2(c.m2)}</small>
              </button>
            );
          })}
        </div>
        <div className="stats">
          <Row k="ANY SENSOR" v={`${cov.union.pct.toFixed(2)}%  (${km2(cov.union.m2)})`} accent />
          <Row k="NOT YET MAPPED" v={`${(100 - cov.union.pct).toFixed(2)}%  (${km2(unmapped)})`} />
        </div>
        <div className="legend">
          <div className="lg-title">HOW TO READ IT</div>
          <p className="none"><b style={{ color: '#fff' }}>Dim ground</b> has never been measured by the sensors you have switched on. <b style={{ color: '#fff' }}>Bright, tinted ground</b> is mapped: the tint is the colour of the instrument. Click a sensor to show or hide it.</p>
          <p className="none">Surveyed lines are only 1-4 m wide on a 1.7 km map: zoom in (wheel) to see them; drag to pan. Yellow rings are anomalies, diamonds are saved locations, green stars are confirmed ore.</p>
        </div>
        <div className="row-btns"><button onClick={() => setOn(new Set(SENSOR_IDS))}>ALL SENSORS</button><button onClick={() => setOn(new Set())}>NONE</button><button onClick={() => { setZoom(1); setPan([0, 0]); }}>RESET VIEW</button></div>
        <div className="lst"><div className="lg-title">THIS LAYER NOW</div><p className="none">You are in: {s?.layer === layer ? 'this layer' : LAYERS_UI.find(([k]) => k === (s?.layer ?? 'surface'))?.[1]}. The map shows the layer you pick; your position appears only on your own layer.</p></div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- GEOPHYSICAL MAP (MAG_MAP)
export function SurveyMap() {
  const open = useGame('surveyMap'), s = useGame('survey');
  const [sensor, setSensor] = useState(null), [ch, setCh] = useState(null), [tab, setTab] = useState('plan');
  const [ext, setExt] = useState(220), [follow, setFollow] = useState(true), [centre, setCentre] = useState(null);
  const [opts, setOpts] = useState({ contours: true, shade: true, points: true }), [mark, setMark] = useState(false), [sel, setSel] = useState(null);
  const cv = useRef(null), pf = useRef(null), view = useRef(null), drag = useRef(null);
  const sens = sensor ?? s?.sensor ?? 'mag', sd = SENSORS[sens];
  const chan = ch === 'ternary' && sens === 'gamma' ? 'ternary' : ch && sd.channels.some((c) => c.id === ch) ? ch : sens === 'gamma' ? 'ternary' : sd.channels[0].id;
  useRaf(() => {
    const S = S_(); if (!S) return;
    const pose = S.pose(), c = follow || !centre ? pose : centre;
    view.current = { sensor: sens, ch: chan, cx: c.x, cz: c.z, extent: ext, ...opts };
    if (tab === 'plan' && cv.current) paintMap(cv.current, S, view.current, pose);
    if (tab === 'profile' && pf.current) paintProfile(pf.current, S, sens);
  }, open);
  if (!open) return null;
  const S = S_();
  const close = () => store.set({ surveyMap: false });
  const toWorld = (e) => { const r = cv.current.getBoundingClientRect(), v = view.current; return [v.cx - v.extent / 2 + ((e.clientX - r.left) / r.width) * v.extent, v.cz - v.extent / 2 + ((e.clientY - r.top) / r.height) * v.extent, r.width]; };
  const onDown = (e) => { drag.current = { x: e.clientX, y: e.clientY, cx: view.current?.cx, cz: view.current?.cz, moved: false }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    const r = cv.current.getBoundingClientRect(), k = view.current.extent / r.width, dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) > 4) { d.moved = true; setFollow(false); setCentre({ x: d.cx - dx * k, z: d.cz - dy * k }); }
  };
  const onUp = (e) => {
    const d = drag.current; drag.current = null;
    if (!d || d.moved || !S) return;
    const [x, z, w] = toWorld(e), tol = (14 / w) * view.current.extent;
    if (mark) { S.addMarker(x, z); setMark(false); return; }
    const near = [...S.waypoints.map((q) => ({ kind: 'w', id: q.id, x: q.x, z: q.z })), ...S.anomalies.filter((a) => a.sensor === sens).map((a) => ({ kind: 'a', id: a.id, x: a.x, z: a.z }))]
      .map((q) => ({ ...q, d: Math.hypot(q.x - x, q.z - z) })).filter((q) => q.d < tol).sort((a, b) => a.d - b.d)[0];
    setSel(near ? { kind: near.kind, id: near.id, x: near.x, z: near.z } : { kind: 'p', x, z });
  };
  const onWheel = (e) => setExt((v) => Math.max(40, Math.min(1400, v * (e.deltaY > 0 ? 1.2 : 1 / 1.2))));
  const lg = S ? legend(S, sens, chan) : null, st = S && chan !== 'ternary' ? S.chan(sens, chan).stats : null, chanObj = S && S.chan(sens, chan === 'ternary' ? 'Th' : chan);
  const surveyed = SENSOR_IDS.filter((id) => id === s?.sensor || (S && SENSORS[id].channels.some((c) => S.channels.get(`${S.layer === 'surface' ? '' : S.layer + ':'}${id}.${c.id}`)?.count)));
  const it = sel && S ? interpret(S.anomalies, sel.x, sel.z, 28, S.layer) : null;
  const selA = sel?.kind === 'a' ? S?.anomalies.find((a) => a.id === sel.id) : null;
  const list = (s?.list ?? []).filter((a) => a.sensor === sens && a.layer === S?.layer);
  const saved = (s?.waypoints ?? []).filter((w) => w.layer === S?.layer);
  const navigate = (a) => { const w = a.saved ? S.waypoints.find((q) => q.anomalyId === a.id) : S.saveAnomaly(a.id); if (w && S.target !== w.id) S.setTarget(w.id); };
  return (
    <div className="survey-modal" role="dialog" aria-label="Geophysical map">
      <div className="panel smap">
        <h3 className="panel-title">GEOPHYSICAL MAP <small>{sd.short === 'MAG' ? 'MAG_MAP' : `${sd.short}_MAP`} - {sd.product} - {LAYER_NAME[s?.layer] ?? 'SURFACE'}</small><button className="x" onClick={close} aria-label="Close">Z / ESC</button></h3>
        <div className="smap-bar">
          {tab !== 'world' && <div className="seg">{(surveyed.length ? surveyed : [sens]).map((id) => <button key={id} className={id === sens ? 'on' : ''} style={{ '--c': SENSORS[id].css }} onClick={() => { setSensor(id); setCh(null); }}>{SENSORS[id].short}</button>)}</div>}
          {tab !== 'world' && sens === 'gamma' && <div className="seg">{['ternary', 'K', 'U', 'Th'].map((c) => <button key={c} className={chan === c ? 'on' : ''} onClick={() => setCh(c)}>{c === 'ternary' ? 'K-Th-U' : c}</button>)}</div>}
          <div className="seg">{[['plan', 'PLAN MAP'], ['profile', 'LINE PROFILE'], ['world', 'WORLD COVERAGE']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
          {tab === 'plan' && (
            <div className="seg">
              {[['contours', 'CONTOURS'], ['shade', 'SUN-SHADE'], ['points', 'STATIONS']].map(([k, l]) => <button key={k} className={opts[k] ? 'on' : ''} onClick={() => setOpts((o) => ({ ...o, [k]: !o[k] }))}>{l}</button>)}
              <button className={follow ? 'on' : ''} onClick={() => { setFollow(true); setCentre(null); }}>FOLLOW</button>
              <button onClick={() => setExt((v) => Math.max(40, v / 1.4))}>+</button><button onClick={() => setExt((v) => Math.min(1400, v * 1.4))}>-</button>
              <button className={mark ? 'on' : ''} onClick={() => setMark((m) => !m)}>PLACE MARKER</button>
            </div>
          )}
        </div>
        {tab === 'world' ? <WorldCoverage S={S} s={s} /> : (
        <div className="smap-body">
          <div className="smap-view">
            {tab === 'plan'
              ? <canvas ref={cv} width={600} height={600} className={mark ? 'marking' : ''} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel} aria-label="Geophysical plan map" />
              : <canvas ref={pf} width={760} height={460} aria-label="Line profile" />}
          </div>
          <aside className="smap-side">
            {lg && (
              <div className="legend">
                <div className="lg-title">{chan === 'ternary' ? 'RADIOMETRIC TERNARY (R=K G=Th B=U)' : `${lg.label} (${lg.unit})`}</div>
                <div className="lg-ramp" style={{ background: lg.css }} />
                <div className="lg-ticks">{lg.ticks.map((t) => <span key={t.t} style={{ left: `${t.t * 100}%` }}>{t.label}</span>)}</div>
              </div>
            )}
            <div className="stats">
              <Row k="READINGS" v={chanObj?.count ?? 0} />
              <Row k="AREA" v={`${Math.round(chanObj?.measuredArea() ?? 0)} m2`} />
              {st?.n ? <Row k="BACKGROUND" v={`${(sd.channels.find((c) => c.id === chan)?.mode === 'log' ? Math.pow(10, st.bg) : st.bg).toFixed(sd.channels[0].digits)} ${sd.channels.find((c) => c.id === chan)?.unit}`} /> : <Row k="BACKGROUND" v="need more data" />}
              <Row k="ANOMALIES" v={list.length} accent />
            </div>
            {it && (
              <div className="interp">
                <div className="lg-title">{selA ? `A${selA.id} ` : ''}INTERPRETATION <em>{it.confidence ? `${it.confidence}% conf.` : ''}</em></div>
                <b>{it.title ?? 'NO ANOMALY HERE'}</b>
                <p>{it.text || 'No anomalous readings near this point. Survey more lines or try another instrument.'}</p>
                {it.targets?.length > 0 && <p className="tg">Possible: {it.targets.map(mineralName).join(', ')}. <i>Unconfirmed until excavated.</i></p>}
                {it.sensors?.length > 0 && <p className="tg">Evidence: {it.sensors.map((x) => SENSORS[x].short).join(' + ')}</p>}
                <div className="row-btns">
                  {selA && <button onClick={() => S.saveAnomaly(selA.id)} disabled={selA.saved}>{selA.saved ? 'SAVED' : 'SAVE LOCATION'}</button>}
                  {sel.kind === 'p' && <button onClick={() => { S.addMarker(sel.x, sel.z); setSel(null); }}>MARK HERE</button>}
                </div>
              </div>
            )}
            <div className="lst">
              <div className="lg-title">ANOMALIES ({sd.short})</div>
              {list.length ? list.slice(0, 14).map((a) => (
                <div key={a.id} className={`li ${sel?.id === a.id && sel.kind === 'a' ? 'on' : ''}`} onClick={() => { setSel({ kind: 'a', id: a.id, x: a.x, z: a.z }); setFollow(false); setCentre({ x: a.x, z: a.z }); }}>
                  <i style={{ background: sigColor(a.intensity / 100) }} /><span><b>A{a.id}</b> {a.title}</span><em>{a.intensity}% ~{a.depth.toFixed(1)}m {Math.round(a.dist)}m</em>
                  <button onClick={(e) => { e.stopPropagation(); navigate(a); }}>GO</button>
                </div>
              )) : <p className="none">None yet. Walk / drive / fly parallel lines over the area.</p>}
            </div>
            <div className="lst">
              <div className="lg-title">SAVED LOCATIONS ({saved.length})</div>
              {saved.map((w) => (
                <div key={w.id} className={`li ${s.target?.id === w.id ? 'on' : ''}`}>
                  <i style={{ background: w.sensor ? SENSORS[w.sensor].css : '#fff' }} />
                  <span><b>W{w.id}</b> {w.title}</span>
                  <em>{w.confirmed ? (w.confirmed === 'barren' ? 'BARREN' : mineralName(w.confirmed)) : `${w.confidence}%`} {Math.round(w.dist)}m</em>
                  <button onClick={() => S.setTarget(w.id)}>{s.target?.id === w.id ? 'ON' : 'NAV'}</button>
                  {w.layer === 'surface' && <button title={w.machine ? 'Estimated too deep for a pickaxe: send the excavator' : 'Estimated within pickaxe reach (1.5 m); the excavator works too'} className={w.machine ? 'need' : ''} onClick={() => S.callExcavator(S.waypoints.find((q) => q.id === w.id))}>EXCAVATE</button>}
                  <button onClick={() => S.removeWaypoint(w.id)} aria-label="Delete">x</button>
                </div>
              ))}
            </div>
          </aside>
        </div>)}
        <p className="fine smap-foot">Drag to pan - wheel to zoom - click an anomaly to interpret it - X saves the alerted anomaly - Z closes. The WORLD COVERAGE tab shows everything you have mapped, per sensor.</p>
      </div>
    </div>
  );
}
