'use client';
import { useEffect, useRef } from 'react';
import { store, useGame, dismiss } from '../ui/store';
import { engine } from '../ui/engine';
import { cardinal, fmtCoord, kmh, fmtElev, compassMarks } from '../ui/format';
import { MINERALS } from '../engine/gameplay/ore';
import { fmtBearing } from '../engine/gameplay/sonar';
import { SurveyStatus, AnomalyAlert, TargetNav, DroneViews } from './Survey';
import { SENSORS } from '../engine/survey/sensors';

export const Panel = ({ title, className = '', children, ...rest }) => (
  <section className={`panel ${className}`} {...rest}>
    {title && <h3 className="panel-title">{title}</h3>}
    {children}
  </section>
);

const Row = ({ k, v, accent }) => (
  <div className="row"><span className="k">{k}</span><span className={`v ${accent ? 'accent' : ''}`}>{v}</span></div>
);

// ---------------------------------------------------------------- compass tape
const MARKS = compassMarks();
const PX = 4; // px per degree
function Compass() {
  const h = useGame('heading');
  return (
    <div className="compass" role="img" aria-label={`Heading ${Math.round(h)} degrees ${cardinal(h)}`}>
      <div className="tape" style={{ transform: `translateX(${-(h + 360) * PX}px)` }}>
        {MARKS.map((m) => (
          <i key={m.deg} className={`tick ${m.label ? 'card' : m.major ? 'major' : ''}`} style={{ left: m.deg * PX }}>{m.label && <b>{m.label}</b>}</i>
        ))}
      </div>
      <span className="needle" />
      <span className="bearing">{String(Math.round(h) % 360).padStart(3, '0')} {cardinal(h)}</span>
    </div>
  );
}

// ---------------------------------------------------------------- site map
function Minimap() {
  const bg = useRef(null), fg = useRef(null);
  const open = useGame('mapOpen');
  useEffect(() => {
    engine.current?.attachMinimap(bg.current, fg.current);
    return () => engine.current?.detachMinimap();
  }, []);
  return (
    <Panel title="SITE MAP" className={`map ${open ? 'big' : ''}`}>
      <button className="map-body" onClick={() => store.set((s) => ({ mapOpen: !s.mapOpen }))} aria-label="Toggle large map">
        <canvas ref={bg} width={512} height={512} />
        <canvas ref={fg} width={512} height={512} />
        <span className="north">N</span>
      </button>
    </Panel>
  );
}

// ---------------------------------------------------------------- readouts
function Readouts() {
  const s = { region: useGame('region'), x: useGame('x'), z: useGame('z'), elev: useGame('elev'), speed: useGame('speed'), state: useGame('state') };
  const c = fmtCoord(s.x, s.z);
  return (
    <Panel title="SITE DATA" className="readouts">
      <Row k="ZONE" v={s.region.toUpperCase()} accent />
      <Row k="E" v={`${c.e} m`} />
      <Row k="N" v={`${c.n} m`} />
      <Row k="ELEV" v={`${fmtElev(s.elev)} m`} />
      <Row k="SPEED" v={`${kmh(s.speed)} km/h`} />
      <Row k="STATUS" v={s.state} />
    </Panel>
  );
}

// ---------------------------------------------------------------- field kit
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function FieldKit() {
  const lamp = useGame('lamp'), spread = useGame('spread');
  const equipped = useGame('equipped'), ore = useGame('ore'), samples = useGame('samples'), tool = useGame('tool'), survey = useGame('survey');
  const sensor = survey?.sensor && SENSORS[survey.sensor];
  const sensorInHand = equipped && tool === 'sensor';
  return (
    <Panel title="FIELD KIT" className="kit">
      <Row k="PICKAXE" v={<span className={`pill ${equipped && !sensorInHand ? 'on' : ''}`}>{equipped && !sensorInHand ? 'READY' : 'STOWED'}</span>} />
      {sensor && <Row k={sensor.short} v={<span className={`pill ${sensorInHand || survey.mode !== 'hand' ? 'on' : ''}`}>{survey.mode !== 'hand' ? survey.mode.toUpperCase() : sensorInHand ? 'IN HAND' : 'STOWED'}</span>} />}
      <Row k="HEADLAMP [L]" v={<span className={`pill ${lamp.on ? 'on' : ''}`}>{lamp.on ? 'ON' : 'OFF'} {Math.round(lamp.battery)}%</span>} />
      {spread && <Row k="MINERALS SHIFT" v={mmss(spread.left)} />}
      <Row k="SAMPLES" v={ore} accent />
      <div className="minerals">
        {Object.entries(MINERALS).filter(([key]) => samples[key]).map(([key, m]) => (
          <div key={key} className={`mineral ${samples[key] ? 'has' : ''}`}>
            <i style={{ background: `#${m.color.toString(16).padStart(6, '0')}` }} />
            <span>{m.name}</span><b>{samples[key] || 0}</b>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- sonar pop-up (submarine)
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
function paintSonar(cv, s, now) {
  const g = cv.getContext('2d'), W = cv.width, c = W / 2, R = c - 6;
  g.clearRect(0, 0, W, W);
  g.fillStyle = 'rgba(6,20,26,0.92)'; g.beginPath(); g.arc(c, c, R + 4, 0, 7); g.fill();
  g.strokeStyle = 'rgba(95,201,180,0.35)'; g.lineWidth = 1;
  for (const f of [0.25, 0.5, 0.75, 1]) { g.beginPath(); g.arc(c, c, R * f, 0, 7); g.stroke(); }
  g.beginPath(); g.moveTo(c, c - R); g.lineTo(c, c + R); g.moveTo(c - R, c); g.lineTo(c + R, c); g.stroke();
  const sweep = ((now / 2600) % 1) * Math.PI * 2 - Math.PI / 2; // clockwise sweep, bow at the top
  for (let k = 0; k < 24; k++) { g.strokeStyle = `rgba(95,201,180,${0.28 * (1 - k / 24)})`; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(sweep - k * 0.03) * R, c + Math.sin(sweep - k * 0.03) * R); g.stroke(); }
  for (const [i, k] of s.contacts.entries()) {
    const r = R * Math.min(1, k.flat / s.range), x = c + Math.sin(k.bearing) * r, y = c - Math.cos(k.bearing) * r;
    const a = Math.atan2(y - c, x - c), lag = (((sweep - a) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), glow = Math.max(0.35, 1 - lag / (Math.PI * 2));
    g.globalAlpha = glow; g.fillStyle = hex(k.color); g.beginPath(); g.arc(x, y, i === 0 ? 5 : 3.5, 0, 7); g.fill();
    if (i === 0) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 8, 0, 7); g.stroke(); }
    g.globalAlpha = 1;
  }
  g.fillStyle = '#e0a526'; g.beginPath(); g.moveTo(c, c - 7); g.lineTo(c - 5, c + 6); g.lineTo(c + 5, c + 6); g.closePath(); g.fill(); // own boat
}
function SonarPanel() {
  const s = useGame('sonar'), cv = useRef(null), latest = useRef(s);
  latest.current = s;
  useEffect(() => {
    if (!s) return undefined;
    let raf;
    const loop = (t) => { if (cv.current && latest.current) paintSonar(cv.current, latest.current, t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [!!s]);
  if (!s) return null;
  return (
    <section className="sonar panel" aria-label="Sonar">
      <h3 className="panel-title">SONAR <small>RANGE {s.range} m - BOW UP - N TO CLOSE</small></h3>
      <canvas ref={cv} width={300} height={300} aria-label="Sonar scope" />
      {s.contacts.length ? (
        <table>
          <thead><tr><th>CONTACT</th><th>DIST</th><th>BRG</th><th>DEPTH</th></tr></thead>
          <tbody>
            {s.contacts.slice(0, 5).map((k, i) => (
              <tr key={i} className={i === 0 ? 'near' : ''}>
                <td><i style={{ background: hex(k.color) }} />{k.name}</td>
                <td>{Math.round(k.dist)} m</td><td>{fmtBearing(k.bearing)}</td><td>{Math.abs(k.dy) < 1 ? 'level' : `${Math.round(Math.abs(k.dy))} m ${k.dy < 0 ? 'below' : 'above'}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="none">No rock outcrops in range</p>}
    </section>
  );
}
// ---------------------------------------------------------------- dive / submersible gauges
const Bar = ({ value, warn }) => <div className={`bar-gauge ${warn ? 'warn' : ''}`}><i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></div>;
function DriveGauge() {
  const d = useGame('drive');
  if (!d) return null;
  return (
    <Panel title="VEHICLE" className="dive">
      <Row k="MODEL" v={d.name.toUpperCase()} accent />
      <Row k="SPEED" v={`${kmh(d.speed)} km/h`} />
      <Row k="TOP / BOOST" v={`${kmh(d.top)} / ${kmh(d.boostTop)}`} />
      <Row k="BOOST" v={d.boosting ? 'ACTIVE' : `${Math.round(d.boost * 100)} %`} />
      <Bar value={d.boost} warn={d.boost < 0.2} />
    </Panel>
  );
}function DiveGauge() {
  const d = useGame('dive');
  if (!d) return null;
  const sub = d.mode === 'sub', scuba = d.mode === 'scuba';
  const supply = scuba ? d.tank / 100 : d.air;
  return (
    <Panel title={sub ? 'SUBMERSIBLE' : 'DIVE'} className="dive">
      <Row k="DEPTH" v={`${d.depth.toFixed(1)} m`} accent />
      <Row k="PRESSURE" v={`${d.atm.toFixed(1)} atm`} />
      {sub ? (
        <>
          <Row k="SPEED" v={`${(d.speed * 1.944).toFixed(1)} kn`} />
          <Row k="BATTERY" v={`${Math.round(d.battery)} %`} />
          <Bar value={d.battery / 100} warn={d.battery < 20} />
          <Row k="STATUS" v={d.status} accent />
          <Row k="HEADING" v={` `} />
          <Row k="BALLAST" v={{ surface: 'BLOWN', trim: 'TRIM', dive: 'FLOODING' }[d.ballastMode]} />
          <Bar value={d.tank} />
          <Row k="LIGHTS" v={d.lights ? 'ON' : 'OFF'} />
        </>
      ) : (
        <>
          <Row k={scuba ? 'TANK' : 'BREATH'} v={scuba ? `${Math.round(d.tank)} %` : `${Math.ceil(d.airSec)} s`} />
          <Bar value={supply} warn={supply < 0.25} />
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- notices + prompt
function Notice({ n }) {
  useEffect(() => { const t = setTimeout(() => dismiss(store, n.id), n.kind === 'zone' ? 3200 : 2800); return () => clearTimeout(t); }, [n.id, n.kind]);
  return <div className={`notice ${n.kind}`} role="status">{n.kind === 'zone' && <small>ENTERING</small>}{n.text}</div>;
}
const Notices = () => <div className="notices">{useGame('notices').map((n) => <Notice key={n.id} n={n} />)}</div>;
const Prompt = () => { const h = useGame('hint'); return <div className={`prompt ${h ? 'show' : ''}`} aria-live="polite">{h}</div>; };

// ---------------------------------------------------------------- controls reference (desktop)
const KEYS = [['W A S D', 'Move'], ['SHIFT', 'Sprint'], ['SPACE', 'Jump / swim up'], ['C', 'Dive / swim down'], ['G', 'Scuba gear'], ['V', 'Board / exit sub'], ['K', 'Drive car / rover, launch drone'], ['SHIFT', 'Boost (in a car)'], ['B', 'Sub ballast: surface / dive / trim'], ['L', 'Headlamp (sub lights in the sub)'], ['N', 'Sonar'], ['F', 'Equip / stow tool'], ['E  /  CLICK', 'Use pickaxe (dig) / mark'], ['U', 'Geophysical equipment'], ['Z', 'Geophysical map'], ['Q', 'Swap pickaxe / sensor'], ['X', 'Save anomaly location'], ['Y', 'Call an excavator (deep ore)'], ['T', 'Continue survey (dismiss)'], ['O', 'Drone off'], ['MOUSE', 'Look'], ['M', 'Large map'], ['R', 'Return to hub'], ['H', 'Hide this panel'], ['ESC', 'Pause']];
function Help() {
  const open = useGame('helpOpen'), touch = useGame('touch');
  if (!open || touch) return null;
  return <Panel title="CONTROLS" className="help">{KEYS.map(([k, v]) => <Row key={k} k={k} v={v} />)}</Panel>;
}

export default function Hud() {
  const flying = !!useGame('survey')?.drone?.active;
  return (
    <div className="hud">
      <Compass />
      <TargetNav />
      <Notices />
      <div className="col tl"><Minimap /><SurveyStatus /><DiveGauge /><DriveGauge /></div>
      <SonarPanel />
      <div className="col tr">{flying ? <DroneViews /> : <><Readouts /><FieldKit /></>}</div>
      {!flying && <Help />}
      <AnomalyAlert />
      <Prompt />
    </div>
  );
}


