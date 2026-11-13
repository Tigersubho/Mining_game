import { notify } from '../../ui/store.js';

/**
 * The minerals shift every 15 minutes of play. There are no loose outcrops to find by eye: all ore is hidden in the geology
 * (survey/geology.js) - on the surface, in the rock of the two caves, and in the lake / river / pit beds - and is found with the survey
 * sensors. Every shift re-rolls that whole geology to new places across the map, and the survey readings, anomalies and saved
 * locations that described the old ground are cleared (they would point at nothing).
 */
export const SPREAD_INTERVAL = 15 * 60;

export function createMineralSpread({ geo, survey, store, interval = SPREAD_INTERVAL }) {
  let clock = 0, pub = 0, warned = -1;
  const epochOf = (t) => Math.floor(t / interval);
  const api = {
    interval,
    get epoch() { return geo.epoch; },
    /** seconds of play until the next shift */
    get left() { return Math.max(0, interval - (clock - geo.epoch * interval)); },
    /** advance the clock by `dt` seconds of play time */
    update(dt) {
      clock += dt;
      const e = epochOf(clock);
      if (e !== geo.epoch) {
        geo.reshuffle(e);
        survey.onReshuffle();
        notify(store, 'The minerals have shifted: new deposits across the island, in the caves and under the lake. Your old survey data is out of date', 'info');
      }
      if (api.left <= 60 && warned !== geo.epoch) { warned = geo.epoch; notify(store, 'The minerals shift in one minute: dig what you have found', 'warn'); }
      if ((pub -= dt) <= 0) { pub = 1; store.set({ spread: { left: api.left, epoch: geo.epoch, deposits: geo.deposits.length } }); }
    },
    /** jump the clock to the next shift (tests / debug) */
    skip() { clock = (geo.epoch + 1) * interval; },
  };
  api.update(0);
  return api;
}
