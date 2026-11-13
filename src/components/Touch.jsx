'use client';
import { useRef, useState } from 'react';
import { store, useGame } from '../ui/store';
import { engine } from '../ui/engine';

const R = 56; // joystick travel radius (px)

/** left-thumb virtual joystick -> input.setStick */
function Joystick() {
  const knob = useRef(null), base = useRef(null), id = useRef(null);
  const set = (e) => {
    const b = base.current.getBoundingClientRect();
    let dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
    knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
    engine.current?.input.setStick(dx / R, -dy / R);
  };
  const end = () => { id.current = null; knob.current.style.transform = ''; engine.current?.input.setStick(0, 0); };
  return (
    <div
      ref={base} className="stick" role="application" aria-label="Movement joystick"
      onPointerDown={(e) => { id.current = e.pointerId; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } set(e); }}
      onPointerMove={(e) => id.current === e.pointerId && set(e)}
      onPointerUp={end} onPointerCancel={end}
    >
      <span ref={knob} className="knob" />
    </div>
  );
}

/** full-screen layer behind the buttons: dragging anywhere turns the camera */
function LookPad() {
  const last = useRef(null);
  return (
    <div
      className="lookpad"
      onPointerDown={(e) => { last.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } }}
      onPointerMove={(e) => {
        const l = last.current;
        if (!l || l.id !== e.pointerId) return;
        engine.current?.input.addLook((e.clientX - l.x) * 1.4, (e.clientY - l.y) * 1.4);
        l.x = e.clientX; l.y = e.clientY;
      }}
      onPointerUp={() => (last.current = null)} onPointerCancel={() => (last.current = null)}
    />
  );
}

/** tap = one-shot action; hold = a held state while the finger is down (swim up / down) */
const Btn = ({ label, action, className = '', onTap, hold }) => (
  <button
    className={`tbtn ${className}`} aria-label={label}
    onPointerDown={(e) => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not an active pointer */ } if (hold) engine.current?.input.setHeld(hold, true); if (action) engine.current?.input.press(action); onTap?.(); }}
    onPointerUp={() => hold && engine.current?.input.setHeld(hold, false)}
    onPointerCancel={() => hold && engine.current?.input.setHeld(hold, false)}
  >{label}</button>
);

export default function Touch() {
  const equipped = useGame('equipped'), dive = useGame('dive'), scuba = useGame('scuba');
  const [sprint, setSprint] = useState(false);
  return (
    <div className="touch">
      <LookPad />
      <Joystick />
      <div className="tbtns">
        <Btn label={dive ? 'UP' : 'JUMP'} action="jump" hold="ascend" className="big" />
        {dive && <Btn label="DOWN" hold="descend" />}
        <Btn label={equipped ? 'SWING' : 'PICK'} action="swing" className={equipped ? 'on' : ''} />
        <Btn label="EQUIP" action="equip" className={equipped ? 'on' : ''} />
        <Btn label="SCUBA" action="scuba" className={scuba ? 'on' : ''} />
        <Btn label="BOARD" action="board" />
        <Btn label="DRIVE" action="drive" />
        {dive?.mode === 'sub' && <><Btn label="BALLAST" action="ballast" /><Btn label="LIGHTS" action="lights" /><Btn label="SONAR" action="sonar" /></>}
        <Btn label="RUN" className={sprint ? 'on' : ''} onTap={() => setSprint(engine.current?.input.toggleSprint() ?? false)} />
      </div>
      <button className="tpause" aria-label="Pause" onClick={() => store.set({ phase: 'paused' })}>II</button>
    </div>
  );
}

