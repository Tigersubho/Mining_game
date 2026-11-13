import { describe, it, expect, vi } from 'vitest';
import { createStore, notify, dismiss, initialState } from '../../src/ui/store.js';

describe('store', () => {
  it('get / set merge a patch and notify subscribers', () => {
    const s = createStore({ a: 1, b: 2 });
    const fn = vi.fn(); s.subscribe(fn);
    s.set({ a: 5 });
    expect(s.get()).toEqual({ a: 5, b: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('does not notify when nothing actually changed (no wasted renders)', () => {
    const s = createStore({ a: 1 });
    const fn = vi.fn(); s.subscribe(fn);
    s.set({ a: 1 });
    expect(fn).not.toHaveBeenCalled();
  });
  it('accepts an updater function', () => {
    const s = createStore({ n: 1 });
    s.set((st) => ({ n: st.n + 1 }));
    expect(s.get().n).toBe(2);
  });
  it('unsubscribe works', () => {
    const s = createStore({ a: 1 }); const fn = vi.fn();
    const off = s.subscribe(fn); off(); s.set({ a: 2 });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('notices', () => {
  it('notify queues a notice with an id, keeping only the latest few', () => {
    const s = createStore({ ...initialState });
    for (let i = 0; i < 6; i++) notify(s, `msg ${i}`);
    const n = s.get().notices;
    expect(n.length).toBeLessThanOrEqual(4);
    expect(n.at(-1).text).toBe('msg 5');
    expect(new Set(n.map((x) => x.id)).size).toBe(n.length);
  });
  it('dismiss removes by id', () => {
    const s = createStore({ ...initialState });
    notify(s, 'a'); const id = s.get().notices[0].id;
    dismiss(s, id);
    expect(s.get().notices).toHaveLength(0);
  });
});
