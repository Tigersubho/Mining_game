import { clamp } from '../math.js';

/**
 * Driving model for every road vehicle (pure, no rendering). Speeds in m/s.
 *   top = top speed, boost = top speed while boosting, accel = m/s^2, turn = max steering rate (rad/s),
 *   cruise = what the AI drives at when nobody is at the wheel.
 */
export const SPECS = {
  car: { name: 'Sedan', top: 33, boost: 46, accel: 9, turn: 1.7, cruise: 9, len: 4.6 },
  taxi: { name: 'Taxi', top: 30, boost: 42, accel: 8, turn: 1.7, cruise: 9, len: 4.6 },
  gmc: { name: 'GMC Sierra', top: 36, boost: 50, accel: 10, turn: 1.5, cruise: 11, len: 5.9 },
  pickup: { name: 'Mining Truck', top: 24, boost: 34, accel: 6, turn: 1.1, cruise: 7, len: 8.5 },
  jeep: { name: 'Safari Jeep', top: 25, boost: 36, accel: 9, turn: 1.9, cruise: 7, len: 3.8 },
  tractor: { name: 'Tractor', top: 14, boost: 18, accel: 2.5, turn: 1.1, cruise: 3.2, len: 4.4 },
  jcb: { name: 'JCB Backhoe', top: 12, boost: 17, accel: 4, turn: 1.2, cruise: 3.2, len: 6.5 },
};
export const BOOST_DRAIN = 0.28; // fraction of the boost tank per second
export const BOOST_REGEN = 0.12;
export const WHEELBASE_SPEED = 4; // below this speed the car can barely steer

/**
 * One physics step. s = { v (signed forward speed), h (heading), boost (0..1 tank) }.
 * ctl = { throttle -1..1, steer -1..1 (right = +), boost: bool, brake: bool }.
 * Returns the new state plus `boosting`. Steering is reversed when going backwards, like a real car.
 */
export function stepDrive(s, spec, ctl, dt) {
  const boosting = !!ctl.boost && s.boost > 0.02 && ctl.throttle > 0.1;
  const top = boosting ? spec.boost : spec.top;
  const target = ctl.throttle >= 0 ? ctl.throttle * top : ctl.throttle * spec.top * 0.3;
  let v = s.v;
  const accel = spec.accel * (boosting ? 1.7 : 1);
  if (ctl.brake) v -= Math.sign(v) * Math.min(Math.abs(v), spec.accel * 2.2 * dt);
  else if (Math.abs(ctl.throttle) < 0.05) v -= Math.sign(v) * Math.min(Math.abs(v), spec.accel * 0.45 * dt); // coast
  else if (Math.sign(v) !== 0 && Math.sign(v) !== Math.sign(target)) v -= Math.sign(v) * Math.min(Math.abs(v), spec.accel * 2 * dt); // brake before reversing
  else v += clamp(target - v, -spec.accel * 1.5 * dt, accel * dt);
  const grip = clamp(Math.abs(v) / WHEELBASE_SPEED, 0, 1) / (1 + (Math.abs(v) / spec.top) * 1.4);
  const h = s.h - ctl.steer * spec.turn * grip * Math.sign(v || 1) * dt;
  const boost = clamp(s.boost + (boosting ? -BOOST_DRAIN : BOOST_REGEN) * dt, 0, 1);
  return { v, h, boost, boosting };
}
