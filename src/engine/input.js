const ACTIONS = {
  jump: ['Space', 'jump'],
  equip: ['KeyF', 'equip'],
  swing: ['KeyE', 'swing'],
  respawn: ['KeyR', 'respawn'],
  map: ['KeyM', 'map'],
  help: ['KeyH', 'help'],
  scuba: ['KeyG', 'scuba'],
  board: ['KeyV', 'board'],
  drive: ['KeyK', 'drive'],
  sonar: ['KeyN', 'sonar'],
  ballast: ['KeyB', 'ballast'],
  lights: ['KeyL', 'lights'],
  // geophysical survey
  tool: ['KeyQ', 'tool'],             // swap pickaxe <-> hand sensor
  surveyMenu: ['KeyU', 'surveyMenu'], // GEOPHYSICAL EQUIPMENT menu
  surveyMap: ['KeyZ', 'surveyMap'],   // GEOPHYSICAL MAP
  saveAnom: ['KeyX', 'saveAnom'],     // SAVE LOCATION
  skipAnom: ['KeyT', 'skipAnom'],     // CONTINUE SURVEY
  droneOff: ['KeyO', 'droneOff'],     // DRONE OFF / RETURN TO CHARACTER
  callExc: ['KeyY', 'callExc'],       // call an excavator to the selected target
  closeUi: ['Escape', 'closeUi'],
};
const HELD = { descend: ['KeyC', 'ControlLeft', 'ControlRight'], ascend: ['Space'] };
const PAD_BUTTONS = { 0: 'jump', 2: 'swing', 3: 'equip' };
const dead = (v) => (Math.abs(v) < 0.15 ? 0 : v);
const limit = (x, y) => { const l = Math.hypot(x, y); return l > 1 ? { x: x / l, y: y / l } : { x, y }; };

/**
 * One input model for every device. Keyboard, on-screen touch controls and gamepads all
 * write into it; the player reads `move() / takeLook() / take(action) / sprint()`.
 * DOM-free on purpose (unit-testable); `attach()` wires the real keyboard.
 */
export class Input {
  constructor() {
    this.down = new Set();
    this.edge = new Set();
    this.stickV = { x: 0, y: 0 };
    this.padMove = { x: 0, y: 0 };
    this.padLook = { x: 0, y: 0 };
    this.padSprint = false;
    this.padHeld = new Set();
    this.lookAcc = { x: 0, y: 0 };
    this.sprintLatch = false;
    this.latched = new Set(); // held states set by touch buttons / gamepad
  }

  // --- keyboard / buttons
  keyDown(code) { if (!this.down.has(code)) this.edge.add(code); this.down.add(code); }
  keyUp(code) { this.down.delete(code); }
  press(action) { this.edge.add(action); }
  clear() { this.down.clear(); this.edge.clear(); this.stickV = { x: 0, y: 0 }; this.padMove = { x: 0, y: 0 }; this.lookAcc = { x: 0, y: 0 }; }

  attach(target = window) {
    const kd = (e) => {
      if (e.target?.tagName && /input|textarea|select/i.test(e.target.tagName)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.keyDown(e.code);
    };
    const ku = (e) => this.keyUp(e.code);
    const blur = () => this.clear();
    target.addEventListener('keydown', kd);
    target.addEventListener('keyup', ku);
    target.addEventListener('blur', blur);
    return () => { target.removeEventListener('keydown', kd); target.removeEventListener('keyup', ku); target.removeEventListener('blur', blur); };
  }

  // --- touch
  setStick(x, y) { this.stickV = { x, y }; }
  setHeld(name, on) { on ? this.latched.add(name) : this.latched.delete(name); }
  toggleSprint() { this.sprintLatch = !this.sprintLatch; return this.sprintLatch; }
  addLook(dx, dy) { this.lookAcc.x += dx; this.lookAcc.y += dy; }

  // --- queries
  move() {
    const k = (c) => (this.down.has(c) ? 1 : 0);
    const x = k('KeyD') - k('KeyA') + this.stickV.x + this.padMove.x;
    const y = k('KeyW') - k('KeyS') + this.stickV.y + this.padMove.y;
    return limit(x, y);
  }
  /** is descend / scend currently held? (keyboard, touch or gamepad) */
  held(name) { return this.latched.has(name) || HELD[name].some((c) => this.down.has(c)); }
  sprint() { return this.down.has('ShiftLeft') || this.down.has('ShiftRight') || this.sprintLatch || this.padSprint; }

  /** true once per press */
  take(action) {
    let hit = false;
    for (const c of ACTIONS[action]) if (this.edge.delete(c)) hit = true;
    return hit;
  }

  /** accumulated look delta in pixels (pointer) + arrows/right-stick scaled by dt */
  takeLook(dt) {
    const arrow = (this.down.has('ArrowRight') ? 1 : 0) - (this.down.has('ArrowLeft') ? 1 : 0);
    const arrowY = (this.down.has('ArrowDown') ? 1 : 0) - (this.down.has('ArrowUp') ? 1 : 0);
    const r = {
      x: this.lookAcc.x + (arrow * 420 + this.padLook.x * 700) * dt,
      y: this.lookAcc.y + (arrowY * 260 + this.padLook.y * 450) * dt,
    };
    this.lookAcc = { x: 0, y: 0 };
    return r;
  }

  // --- gamepad
  pollPad(gp) {
    if (!gp) { this.padMove = { x: 0, y: 0 }; this.padLook = { x: 0, y: 0 }; this.padSprint = false; return; }
    this.padMove = { x: dead(gp.axes[0] || 0), y: -dead(gp.axes[1] || 0) };
    this.padLook = { x: dead(gp.axes[2] || 0), y: dead(gp.axes[3] || 0) };
    this.padSprint = !!gp.buttons[1]?.pressed || !!gp.buttons[10]?.pressed;
    this.padHeldNow = { descend: !!gp.buttons[4]?.pressed, ascend: !!gp.buttons[5]?.pressed };
    for (const [k, v] of Object.entries(this.padHeldNow)) this.setHeld(k, v || this.touchHeld?.has(k));
    for (const [b, action] of Object.entries(PAD_BUTTONS)) {
      const on = !!gp.buttons[b]?.pressed;
      if (on && !this.padHeld.has(b)) this.press(action);
      on ? this.padHeld.add(b) : this.padHeld.delete(b);
    }
  }
  poll() { this.pollPad(typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null); }
}

