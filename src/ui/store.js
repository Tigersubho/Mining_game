import { useSyncExternalStore } from 'react';

/** Tiny external store: the engine writes, React reads. No dependencies. */
export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      if (Object.keys(p).every((k) => Object.is(state[k], p[k]))) return;
      state = { ...state, ...p };
      subs.forEach((f) => f());
    },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
}

export const initialState = {
  phase: 'boot', // boot | ready | playing | paused
  progress: 0,
  bootLabel: 'Initialising',
  error: null,
  touch: false,
  locked: false,
  // live readouts
  region: '',
  heading: 0,
  x: 0, z: 0, elev: 0, speed: 0,
  state: 'ON FOOT', // ON FOOT | SPRINTING | AIRBORNE | WADING | SWIMMING
  equipped: false, scuba: false,
  sonar: null, // {range, heading, contacts:[{name,color,dist,bearing,dy}]} while a submarine's sonar is on
  drive: null, // {name, speed, top, boostTop, boost, boosting} while at the wheel of a car
  dive: null, // water gauges: {mode:'breath'|'scuba'|'sub', depth, atm, air, tank, ...} or null
  hint: '',
  // sampling
  ore: 0, oreTotal: 0, samples: {},
  notices: [],
  // ui
  mapOpen: false, helpOpen: true,
  // geophysical survey
  survey: null, // snapshot pushed by engine/survey/survey.js
  tool: 'pick', surveyMenu: false, surveyMap: false,
  lamp: { on: false, battery: 100 }, spread: null, // headlamp, roaming-mineral clock
  settings: { sensitivity: 1, quality: 'high', invertY: false },
};

export const store = createStore(initialState);

let nid = 1;
export function notify(s, text, kind = 'info') {
  const id = nid++;
  s.set((st) => ({ notices: [...st.notices.slice(-3), { id, text, kind }] }));
  return id;
}
export function dismiss(s, id) { s.set((st) => ({ notices: st.notices.filter((n) => n.id !== id) })); }

export function useGame(key) {
  return useSyncExternalStore(store.subscribe, () => store.get()[key], () => initialState[key]);
}

