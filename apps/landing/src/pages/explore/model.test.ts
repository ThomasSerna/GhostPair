import { describe, expect, it } from 'vitest';
import { activeTab, canInteract, canManage, initialState, PREVIEW_DURATION, previewFor, reducer, tourStepFromHash, type DemoState, type Field } from './model';

const input = (state: DemoState, field: Field, value: string | boolean, now = 1000) => reducer(state, { type: 'field', field, value, now });

describe('local Explore session', () => {
  it('opens one approved, connected tab in Preview changes with the compact sample', () => {
    const state = initialState();
    expect(state.status).toBe('connected');
    expect(state.mode).toBe('preview');
    expect(state.tabs).toHaveLength(1);
    expect(activeTab(state).approved).toBe(true);
    expect(activeTab(state).form).toEqual({ notes: 'Find a quiet place by the water.', notify: false, submit: false });
    expect(canInteract(state)).toBe(true);
  });

  it('keeps original note, checkbox and save state intact during half-second previews', () => {
    const original = initialState();
    let state = input(original, 'notes', 'A guest idea');
    state = input(state, 'notify', true, 1100);
    state = input(state, 'submit', true, 1200);
    expect(activeTab(state).form).toEqual(activeTab(original).form);
    expect(previewFor(state, 'notes')?.value).toBe('A guest idea');
    expect(previewFor(state, 'notify')?.value).toBe(true);
    expect(previewFor(state, 'submit')?.value).toBe(true);
    expect(PREVIEW_DURATION).toBe(500);
    expect(previewFor(state, 'notes')?.expiresAt).toBe(1500);
    expect(previewFor(state, 'notify')?.expiresAt).toBe(1700);
    expect(previewFor(state, 'submit')?.expiresAt).toBe(1700);
    expect(reducer(state, { type: 'expire', now: 1499 }).previews).toHaveLength(3);
    state = reducer(state, { type: 'expire', now: 1500 });
    expect(previewFor(state, 'notes')).toBeUndefined();
    expect(previewFor(state, 'notify')).toBeDefined();
    expect(reducer(state, { type: 'expire', now: 1700 }).previews).toEqual([]);
  });

  it('refreshes a note preview while typing without extending a checkbox proposal', () => {
    let state = input(initialState(), 'notes', 'First', 1000);
    state = input(state, 'notify', true, 1100);
    state = input(state, 'notes', 'Second', 1200);
    expect(previewFor(state, 'notes')?.expiresAt).toBe(1700);
    expect(previewFor(state, 'notify')?.expiresAt).toBe(1600);
    state = reducer(state, { type: 'expire', now: 1600 });
    expect(previewFor(state, 'notes')?.value).toBe('Second');
    expect(previewFor(state, 'notify')).toBeUndefined();
  });

  it('discards proposals on mode changes and commits the compact form in Full control', () => {
    let state = input(initialState(), 'notes', 'An uncommitted idea');
    const original = activeTab(state).form.notes;
    state = reducer(state, { type: 'mode', mode: 'full' });
    expect(state.previews).toEqual([]);
    expect(activeTab(state).form.notes).toBe(original);
    state = input(input(state, 'notes', ''), 'notify', true);
    state = input(state, 'submit', true);
    expect(activeTab(state).form).toEqual({ notes: '', notify: true, submit: true });
    expect(state.error).toBe('');
    expect(state.notice).toContain('local demo');
    expect(activeTab(input(state, 'notes', 'A final plan')).form.submit).toBe(false);
    expect(activeTab(reducer(state, { type: 'mode', mode: 'preview' })).form.submit).toBe(true);
  });

  it('navigates, scrolls, traverses history and reloads the sample in either mode', () => {
    let state = input(initialState(), 'notes', 'A preview');
    state = reducer(state, { type: 'scroll', position: 75, actor: 'guest' });
    expect(activeTab(state).scroll).toBe(75);
    expect(activeTab(reducer(state, { type: 'scroll', position: 110, actor: 'host' })).scroll).toBe(100);
    state = reducer(state, { type: 'navigate', page: 'notes', actor: 'guest' });
    expect(activeTab(state).history).toEqual(['trip', 'notes']);
    expect(activeTab(state).scroll).toBe(0);
    expect(state.previews).toEqual([]);
    state = reducer(state, { type: 'history', direction: -1, actor: 'guest' });
    expect(activeTab(state).index).toBe(0);
    state = reducer(state, { type: 'navigate', page: 'checklist', actor: 'guest' });
    expect(activeTab(state).history).toEqual(['trip', 'checklist']);
    state = reducer(state, { type: 'history', direction: -1, actor: 'guest' });
    state = reducer(state, { type: 'history', direction: 1, actor: 'guest' });
    expect(activeTab(state).index).toBe(1);
    state = input(reducer(state, { type: 'mode', mode: 'full' }), 'notes', 'Committed');
    expect(activeTab(reducer(state, { type: 'reload', actor: 'guest' })).form.notes).toBe(initialState().tabs[0]!.form.notes);
  });

  it('requires individual host approval and shares only the active approved tab', () => {
    let state = reducer(initialState(), { type: 'open', page: 'notes', actor: 'guest' });
    expect(activeTab(state).approved).toBe(false);
    expect(canInteract(state)).toBe(false);
    expect(canManage(state)).toBe(true);
    expect(activeTab(reducer(state, { type: 'navigate', page: 'checklist', actor: 'guest' })).history).toEqual(['notes']);
    state = reducer(state, { type: 'approve', id: state.activeId });
    expect(canInteract(state)).toBe(true);
    state = reducer(state, { type: 'release', id: state.activeId });
    expect(canInteract(state)).toBe(false);
    state = reducer(state, { type: 'activate', id: 1, actor: 'guest' });
    expect(canInteract(state)).toBe(true);
    state = reducer(state, { type: 'close', id: 1, actor: 'guest' });
    expect(activeTab(state).id).toBe(2);
    expect(canInteract(state)).toBe(false);
    state = reducer(state, { type: 'open', page: 'trip', actor: 'host' });
    expect(activeTab(state).approved).toBe(false);
  });

  it('enforces five approved tabs and permits releasing one to approve another', () => {
    let state = initialState();
    for (let index = 0; index < 4; index++) {
      state = reducer(state, { type: 'open', page: 'notes', actor: 'guest' });
      state = reducer(state, { type: 'approve', id: state.activeId });
    }
    state = reducer(state, { type: 'open', page: 'checklist', actor: 'guest' });
    state = reducer(state, { type: 'approve', id: state.activeId });
    expect(state.error).toContain('Five tabs');
    expect(activeTab(state).approved).toBe(false);
    expect(state.tabs.filter(tab => tab.approved)).toHaveLength(5);
    state = reducer(state, { type: 'release', id: 1 });
    state = reducer(state, { type: 'approve', id: state.activeId });
    expect(canInteract(state)).toBe(true);
    expect(state.error).toBe('');
  });

  it('replaces the final closed tab with an unapproved tab', () => {
    const state = reducer(initialState(), { type: 'close', id: 1, actor: 'guest' });
    expect(state.tabs).toHaveLength(1);
    expect(activeTab(state).id).toBe(2);
    expect(activeTab(state).approved).toBe(false);
    expect(canInteract(state)).toBe(false);
  });

  it('clears previews and blocks guest actions while paused, retaining host navigation', () => {
    let state = reducer(input(initialState(), 'notes', 'An idea'), { type: 'pause' });
    expect(state.previews).toEqual([]);
    expect(canInteract(state)).toBe(false);
    expect(canManage(state)).toBe(false);
    expect(input(state, 'notes', 'Blocked').tabs).toEqual(state.tabs);
    expect(reducer(state, { type: 'open', page: 'notes', actor: 'guest' }).tabs).toEqual(state.tabs);
    state = reducer(state, { type: 'navigate', page: 'notes', actor: 'host' });
    expect(activeTab(state).history).toEqual(['trip', 'notes']);
    state = reducer(state, { type: 'scroll', position: 85, actor: 'host' });
    state = reducer(state, { type: 'pause' });
    expect(activeTab(state).scroll).toBe(85);
    expect(canInteract(state)).toBe(true);
  });

  it('withdraws interaction without releasing the view and restores it explicitly', () => {
    let state = reducer(input(initialState(), 'notes', 'An idea'), { type: 'control' });
    expect(state.previews).toEqual([]);
    expect(activeTab(state).approved).toBe(true);
    expect(canInteract(state)).toBe(false);
    expect(canManage(state)).toBe(false);
    expect(input(state, 'notify', true).tabs).toEqual(state.tabs);
    expect(reducer(state, { type: 'scroll', position: 75, actor: 'guest' }).tabs).toEqual(state.tabs);
    state = reducer(state, { type: 'control' });
    expect(canInteract(state)).toBe(true);
  });

  it('ends interaction and resets all session data to the initial connected sample', () => {
    const state = reducer(input(initialState(), 'notes', 'An idea'), { type: 'end' });
    expect(state.status).toBe('ended');
    expect(state.previews).toEqual([]);
    expect(canInteract(state)).toBe(false);
    expect(canManage(state)).toBe(false);
    expect(input(state, 'notes', 'Blocked').tabs).toEqual(state.tabs);
    for (const action of [{ type: 'pause' }, { type: 'control' }, { type: 'mode', mode: 'full' }, { type: 'approve', id: 1 }] as const) expect(reducer(state, action)).toBe(state);
    expect(reducer(state, { type: 'reset' })).toEqual({ ...initialState(), revision: 1 });
  });
});

describe('compact tour deep links', () => {
  it('maps modes and tabs to their moments and preserves other legacy destinations', () => {
    expect(tourStepFromHash('#modes')).toBe(2);
    expect(tourStepFromHash('#tabs')).toBe(3);
    for (const hash of ['', '#free', '#connect', '#feedback', '#editing', '#clipboard', '#controls', '#limits', '#unknown']) expect(tourStepFromHash(hash)).toBe(1);
  });
});
