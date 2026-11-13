import { describe, it, expect, beforeEach } from 'vitest';
import { Input } from '../../src/engine/input.js';

let i;
beforeEach(() => { i = new Input(); });

describe('Input - movement', () => {
  it('W moves forward, D moves right', () => {
    i.keyDown('KeyW'); expect(i.move()).toEqual({ x: 0, y: 1 });
    i.keyDown('KeyD'); const m = i.move();
    expect(m.x).toBeGreaterThan(0.7); expect(m.y).toBeGreaterThan(0.7);
  });
  it('diagonals are normalised (no faster than straight)', () => {
    i.keyDown('KeyW'); i.keyDown('KeyD');
    const m = i.move(); expect(Math.hypot(m.x, m.y)).toBeCloseTo(1, 5);
  });
  it('opposite keys cancel', () => {
    i.keyDown('KeyA'); i.keyDown('KeyD'); expect(i.move()).toEqual({ x: 0, y: 0 });
  });
  it('touch joystick provides analog input and is clamped to unit length', () => {
    i.setStick(0.3, 0.4); expect(i.move()).toEqual({ x: 0.3, y: 0.4 });
    i.setStick(3, 4); expect(Math.hypot(i.move().x, i.move().y)).toBeCloseTo(1, 5);
  });
  it('key release stops movement', () => {
    i.keyDown('KeyW'); i.keyUp('KeyW'); expect(i.move()).toEqual({ x: 0, y: 0 });
  });
  it('clear() drops everything (window blur)', () => {
    i.keyDown('KeyW'); i.setStick(1, 0); i.clear(); expect(i.move()).toEqual({ x: 0, y: 0 });
  });
});

describe('Input - actions', () => {
  it('a key press is a one-shot edge', () => {
    i.keyDown('Space');
    expect(i.take('jump')).toBe(true);
    expect(i.take('jump')).toBe(false);
  });
  it('holding a key does not re-trigger', () => {
    i.keyDown('KeyF'); i.take('equip'); i.keyDown('KeyF'); // OS key-repeat
    expect(i.take('equip')).toBe(false);
  });
  it('touch buttons trigger the same actions', () => {
    i.press('swing'); expect(i.take('swing')).toBe(true);
  });
  it('sprint: shift held, or latched by touch, or gamepad', () => {
    expect(i.sprint()).toBe(false);
    i.keyDown('ShiftLeft'); expect(i.sprint()).toBe(true); i.keyUp('ShiftLeft');
    i.toggleSprint(); expect(i.sprint()).toBe(true); i.toggleSprint(); expect(i.sprint()).toBe(false);
  });
});

describe('Input - look', () => {
  it('accumulates pointer deltas and resets when consumed', () => {
    i.addLook(3, 1); i.addLook(2, 2);
    expect(i.takeLook(0)).toEqual({ x: 5, y: 3 });
    expect(i.takeLook(0)).toEqual({ x: 0, y: 0 });
  });
  it('arrow keys turn the camera at a constant rate', () => {
    i.keyDown('ArrowRight');
    expect(i.takeLook(0.5).x).toBeGreaterThan(0);
    i.keyUp('ArrowRight'); i.keyDown('ArrowLeft');
    expect(i.takeLook(0.5).x).toBeLessThan(0);
  });
});

describe('Input - gamepad', () => {
  const pad = (axes, buttons = []) => ({ axes, buttons: Array.from({ length: 16 }, (_, k) => ({ pressed: buttons.includes(k) })) });
  it('left stick moves with a dead zone', () => {
    i.pollPad(pad([0.05, -0.04, 0, 0])); expect(i.move()).toEqual({ x: 0, y: 0 });
    i.pollPad(pad([0.8, -0.8, 0, 0])); const m = i.move();
    expect(m.x).toBeGreaterThan(0); expect(m.y).toBeGreaterThan(0); // stick up = forward
  });
  it('face buttons map to jump / equip / swing, once per press', () => {
    i.pollPad(pad([0, 0, 0, 0], [0])); expect(i.take('jump')).toBe(true);
    i.pollPad(pad([0, 0, 0, 0], [0])); expect(i.take('jump')).toBe(false); // still held
    i.pollPad(pad([0, 0, 0, 0], [])); i.pollPad(pad([0, 0, 0, 0], [2])); expect(i.take('swing')).toBe(true);
    i.pollPad(pad([0, 0, 0, 0], [])); i.pollPad(pad([0, 0, 0, 0], [3])); expect(i.take('equip')).toBe(true);
  });
  it('right stick looks', () => {
    i.pollPad(pad([0, 0, 1, 0]));
    expect(i.takeLook(0.1).x).toBeGreaterThan(0);
  });
});

describe('Input - diving & vehicles', () => {
  it('held() reports a key that is currently down (descend = C / Ctrl, ascend = Space)', () => {
    expect(i.held('descend')).toBe(false);
    i.keyDown('KeyC'); expect(i.held('descend')).toBe(true); i.keyUp('KeyC'); expect(i.held('descend')).toBe(false);
    i.keyDown('ControlLeft'); expect(i.held('descend')).toBe(true); i.keyUp('ControlLeft');
    i.keyDown('Space'); expect(i.held('ascend')).toBe(true);
  });
  it('touch buttons can hold descend / ascend', () => {
    i.setHeld('descend', true); expect(i.held('descend')).toBe(true);
    i.setHeld('descend', false); expect(i.held('descend')).toBe(false);
  });
  it('G toggles scuba, V boards / exits a vehicle, B trims ballast, L toggles lights (one-shot edges)', () => {
    i.keyDown('KeyG'); expect(i.take('scuba')).toBe(true);
    i.keyDown('KeyV'); expect(i.take('board')).toBe(true);
    i.keyDown('KeyB'); expect(i.take('ballast')).toBe(true);
    i.keyDown('KeyL'); expect(i.take('lights')).toBe(true);
    expect(i.take('scuba')).toBe(false);
  });
  it('gamepad: Y-up/LB descend, RB ascend are held states', () => {
    const pad = (b) => ({ axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, (_, k) => ({ pressed: b.includes(k) })) });
    i.pollPad(pad([4])); expect(i.held('descend')).toBe(true);
    i.pollPad(pad([5])); expect(i.held('ascend')).toBe(true);
    i.pollPad(pad([])); expect(i.held('ascend')).toBe(false);
  });
});
