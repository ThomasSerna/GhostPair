import { describe, expect, it } from 'vitest';
import { activeTab, canInteract, canManage, clipboardActive, DEMO_CODE, DEMO_PASSWORD, initialState, previewFor, reducer, type DemoState, type Field } from './model';

const type = (state: DemoState, field: Field, value: string | boolean, now = 1000) => reducer(state, { type: 'field', field, value, now });
const persist = (state: DemoState) => reducer(state, { type: 'preference', preferences: { ...state.preferences, text: { ...state.preferences.text, persistent: true } }, now: 0 });

describe('local GhostPair teaching session', () => {
  it('starts ready to use in Preview changes with genuine independent lifetime defaults', () => {
    const state = initialState();
    expect(canInteract(state)).toBe(true);
    expect(state.mode).toBe('preview');
    expect(state.preferences.text).toEqual({ persistent: false, seconds: .5 });
    expect(state.preferences.other).toEqual({ persistent: false, seconds: .5 });
    expect(clipboardActive(state)).toBe(false);
  });

  it('requires consent, password length, and capture authorization before inviting a guest', () => {
    const state = initialState('connect');
    expect(reducer(state, { type: 'start', password: DEMO_PASSWORD, consent: false }).status).toBe('idle');
    for (const password of ['short', 'x'.repeat(257)]) expect(reducer(state, { type: 'start', password, consent: true }).status).toBe('idle');
    const capture = reducer(state, { type: 'start', password: DEMO_PASSWORD, consent: true });
    expect(capture.status).toBe('capture');
    expect(reducer(capture, { type: 'capture', granted: false }).status).toBe('idle');
    const waiting = reducer(capture, { type: 'capture', granted: true });
    expect(waiting.status).toBe('waiting');
    expect(activeTab(waiting).approved).toBe(true);
    expect(reducer(waiting, { type: 'cancel' }).tabs.every(tab => !tab.approved)).toBe(true);
  });

  it('rejects malformed, unknown, or incorrect credentials and permits correction', () => {
    let state = reducer(initialState('connect'), { type: 'start', password: DEMO_PASSWORD, consent: true });
    state = reducer(state, { type: 'capture', granted: true });
    expect(reducer(state, { type: 'join', code: 'wrong', password: DEMO_PASSWORD }).error).toContain('32-character');
    expect(reducer(state, { type: 'join', code: 'a'.repeat(32), password: DEMO_PASSWORD }).error).toContain('does not match');
    expect(reducer(state, { type: 'join', code: DEMO_CODE, password: 'incorrect' }).error).toContain('password');
    expect(reducer(state, { type: 'join', code: DEMO_CODE, password: DEMO_PASSWORD, networkFailure: true }).error).toContain('no direct network route');
    const connected = reducer(state, { type: 'join', code: DEMO_CODE.toUpperCase().match(/.{4}/g)!.join('-'), password: DEMO_PASSWORD });
    expect(connected.status).toBe('connected');
    expect(connected.error).toBe('');
    expect(connected.mode).toBe('preview');
  });

  it('keeps text, checkboxes, radio choices, and buttons as overlays over immutable originals', () => {
    let state = initialState();
    const original = { ...activeTab(state).form };
    state = type(state, 'name', 'Sam');
    state = type(state, 'notify', true);
    state = type(state, 'pace', 'explore');
    state = type(state, 'submit', true);
    expect(activeTab(state).form).toEqual(original);
    expect(previewFor(state, 'name')?.value).toBe('Sam');
    expect(previewFor(state, 'notify')?.value).toBe(true);
    expect(previewFor(state, 'pace')?.value).toBe('explore');
    expect(previewFor(state, 'submit')?.value).toBe(true);
    expect(reducer(state, { type: 'clear' }).previews).toEqual([]);
  });

  it('refreshes all text previews on text activity and expires categories independently', () => {
    let state = type(initialState(), 'name', 'Sam', 1000);
    state = type(state, 'notify', true, 1100);
    state = type(state, 'notes', 'A new idea', 1200);
    expect(previewFor(state, 'name')?.expiresAt).toBe(1700);
    expect(previewFor(state, 'notes')?.expiresAt).toBe(1700);
    expect(previewFor(state, 'notify')?.expiresAt).toBe(1600);
    state = reducer(state, { type: 'expire', now: 1601 });
    expect(previewFor(state, 'notify')).toBeUndefined();
    expect(previewFor(state, 'name')).toBeDefined();
    expect(reducer(state, { type: 'expire', now: 1700 }).previews).toEqual([]);
  });

  it('retains Until cleared values and enforces the supported duration range', () => {
    let state = type(persist(initialState()), 'name', 'Sam');
    expect(reducer(state, { type: 'expire', now: 1e9 }).previews).toHaveLength(1);
    state = reducer(state, { type: 'preference', preferences: { ...state.preferences, text: { persistent: false, seconds: 20 }, other: { persistent: false, seconds: .01 } }, now: 2000 });
    expect(state.preferences.text.seconds).toBe(10);
    expect(state.preferences.other.seconds).toBe(.1);
    expect(previewFor(state, 'name')?.expiresAt).toBe(12000);
  });

  it('hides feedback without losing overlays and restores it without resetting their deadlines', () => {
    let state = type(initialState(), 'name', 'Sam');
    state = reducer(state, { type: 'preference', preferences: { ...state.preferences, showActions: false, color: '#3b82f6', clicks: false, notices: true }, now: 1200 });
    expect(previewFor(state, 'name')?.value).toBe('Sam');
    expect(previewFor(state, 'name')?.expiresAt).toBe(1500);
    state = type(state, 'notes', 'Hidden idea', 1300);
    expect(previewFor(state, 'notes')?.value).toBe('Hidden idea');
    state = reducer(state, { type: 'preference', preferences: { ...state.preferences, showActions: true }, now: 1400 });
    expect(previewFor(state, 'name')?.expiresAt).toBe(1800);
    expect(previewFor(state, 'notes')?.expiresAt).toBe(1800);
  });

  it('changing only one category lifetime leaves the other deadline intact', () => {
    let state = type(type(initialState(), 'name', 'Sam'), 'notify', true);
    state = reducer(state, { type: 'preference', preferences: { ...state.preferences, text: { persistent: true, seconds: .5 } }, now: 1300 });
    expect(previewFor(state, 'name')?.expiresAt).toBeNull();
    expect(previewFor(state, 'notify')?.expiresAt).toBe(1500);
  });

  it('Full control changes real values, validates the example form, and submits locally', () => {
    let state = type(initialState(), 'name', 'Sam');
    state = reducer(state, { type: 'mode', mode: 'full' });
    expect(state.previews).toEqual([]);
    state = type(type(state, 'name', 'Sam'), 'email', 'invalid');
    expect(type(state, 'submit', true).error).toContain('valid email');
    expect(activeTab(state).form.submit).toBe(false);
    state = type(type(state, 'email', 'sam@example.com'), 'notify', true);
    state = type(type(state, 'pace', 'explore'), 'submit', true);
    expect(activeTab(state).form).toMatchObject({ name: 'Sam', email: 'sam@example.com', notify: true, pace: 'explore', submit: true });
    expect(state.notice).toContain('No data was sent');
  });

  it('navigates, scrolls, traverses history, and reloads the real sample page even in preview mode', () => {
    let state = type(initialState(), 'name', 'Sam');
    state = reducer(state, { type: 'scroll', position: 75 });
    expect(activeTab(state).scroll).toBe(75);
    state = reducer(state, { type: 'navigate', page: 'notes' });
    expect(activeTab(state).history).toEqual(['trip', 'notes']);
    expect(state.previews).toEqual([]);
    state = reducer(state, { type: 'history', direction: -1 });
    expect(activeTab(state).index).toBe(0);
    state = reducer(state, { type: 'history', direction: 1 });
    expect(activeTab(state).index).toBe(1);
    state = reducer(state, { type: 'mode', mode: 'full' });
    state = type(state, 'name', 'Sam');
    expect(activeTab(reducer(state, { type: 'reload' })).form.name).toBe('Alex');
  });

  it('requires separate approval for new tabs and transmits only the active approved tab', () => {
    let state = reducer(initialState(), { type: 'open', page: 'notes' });
    expect(activeTab(state).approved).toBe(false);
    expect(canInteract(state)).toBe(false);
    expect(canManage(state)).toBe(true);
    const unapproved = state;
    expect(activeTab(reducer(state, { type: 'navigate', page: 'checklist' })).history).toEqual(activeTab(unapproved).history);
    state = reducer(state, { type: 'approve', id: state.activeId });
    expect(canInteract(state)).toBe(true);
    state = reducer(state, { type: 'release', id: state.activeId });
    expect(canInteract(state)).toBe(false);
    state = reducer(state, { type: 'activate', id: 1 });
    expect(canInteract(state)).toBe(true);
    state = reducer(state, { type: 'close', id: 1 });
    expect(canInteract(state)).toBe(false);
    expect(activeTab(state).id).toBe(2);
  });

  it('enforces the five approved tab limit and allows releasing to make room', () => {
    let state = initialState();
    for (let i = 0; i < 4; i++) { state = reducer(state, { type: 'open', page: 'notes' }); state = reducer(state, { type: 'approve', id: state.activeId }); }
    state = reducer(state, { type: 'open', page: 'checklist' });
    state = reducer(state, { type: 'approve', id: state.activeId });
    expect(state.error).toContain('Five tabs');
    expect(state.tabs.filter(tab => tab.approved)).toHaveLength(5);
    state = reducer(state, { type: 'release', id: 1 });
    state = reducer(state, { type: 'approve', id: state.activeId });
    expect(canInteract(state)).toBe(true);
    expect(state.error).toBe('');
  });

  it('blocks internal pages and replaces the final closed tab with an unapproved tab', () => {
    let state = reducer(initialState(), { type: 'open', page: 'trip', actor: 'host', supported: false });
    expect(canInteract(state)).toBe(false);
    expect(reducer(state, { type: 'approve', id: state.activeId }).error).toContain('cannot be shared');
    state = reducer(state, { type: 'close', id: 1 });
    state = reducer(state, { type: 'close', id: state.activeId });
    expect(state.tabs).toHaveLength(1);
    expect(activeTab(state).approved).toBe(false);
  });

  it('clears overlays when paused or control is withdrawn; host browsing remains available', () => {
    let state = type(initialState(), 'name', 'Sam');
    state = reducer(state, { type: 'pause' });
    expect(state.previews).toEqual([]);
    expect(canInteract(state)).toBe(false);
    expect(type(state, 'name', 'Other').tabs).toEqual(state.tabs);
    state = reducer(state, { type: 'navigate', page: 'notes', actor: 'host' });
    state = reducer(state, { type: 'history', direction: -1, actor: 'host' });
    expect(activeTab(state).index).toBe(0);
    state = reducer(state, { type: 'pause' });
    state = type(state, 'notes', 'A preview');
    state = reducer(state, { type: 'control' });
    expect(state.previews).toEqual([]);
    expect(canManage(state)).toBe(false);
    expect(canInteract(state)).toBe(false);
    expect(activeTab(reducer(state, { type: 'reload', actor: 'host' })).form.name).toBe('Alex');
  });

  it('edits, copies, and moves preview text without altering originals or exposing passwords', () => {
    let state = persist(initialState('editing'));
    state = reducer(state, { type: 'edit-preview', field: 'name', value: 'Morgan', now: 1000 });
    state = reducer(state, { type: 'transfer', source: 'name', target: 'notes', copy: true, now: 1100 });
    expect(previewFor(state, 'name')?.value).toBe('Morgan');
    expect(String(previewFor(state, 'notes')?.value)).toContain('Morgan');
    state = reducer(state, { type: 'transfer', source: 'name', target: 'email', copy: false, now: 1200 });
    expect(previewFor(state, 'name')?.value).toBe('');
    expect(activeTab(state).form.name).toBe('Alex');
    state = type(state, 'password', 'Hidden-42');
    const before = state.previews;
    state = reducer(state, { type: 'transfer', source: 'password', target: 'notes', copy: true, now: 1300 });
    expect(state.previews).toEqual(before);
    expect(state.notice).toContain('cannot be copied');
  });

  it('shares only newly copied synthetic text after both participants opt in', () => {
    let state = initialState();
    const oldGuest = state.guestBuffer;
    state = reducer(state, { type: 'clipboard-switch', side: 'host', enabled: true });
    state = reducer(state, { type: 'copy-text', side: 'host', text: 'One yes' });
    expect(state.guestBuffer).toBe(oldGuest);
    state = reducer(state, { type: 'clipboard-switch', side: 'guest', enabled: true });
    expect(clipboardActive(state)).toBe(true);
    expect(state.guestBuffer).toBe(oldGuest);
    state = reducer(state, { type: 'copy-text', side: 'guest', text: 'New shared text' });
    expect(state.hostBuffer).toBe('New shared text');
    expect(state.guestBuffer).toBe('New shared text');
    state = reducer(state, { type: 'pause' });
    state = reducer(state, { type: 'copy-text', side: 'guest', text: 'Only local while paused' });
    expect(state.hostBuffer).toBe('New shared text');
    state = reducer(state, { type: 'pause' });
    expect(state.hostBuffer).toBe('New shared text');
    state = reducer(state, { type: 'clipboard-switch', side: 'host', enabled: false });
    expect(clipboardActive(state)).toBe(false);
  });

  it('enforces the clipboard UTF-8 byte limit rather than a character count', () => {
    const state = initialState();
    const oversized = reducer(state, { type: 'copy-text', side: 'host', text: '😀'.repeat(65537) });
    expect(oversized.error).toContain('256 KiB');
    expect(oversized.hostBuffer).toBe(state.hostBuffer);
    const bounded = reducer(state, { type: 'copy-text', side: 'host', text: '😀'.repeat(65536) });
    expect(bounded.error).toBe('');
    expect(bounded.hostBuffer.length).toBe(131072);
  });

  it('ending or leaving disconnects control and clipboard and reset restores a clean session', () => {
    let state = type(initialState(), 'name', 'Sam');
    state = reducer(state, { type: 'clipboard-switch', side: 'host', enabled: true });
    state = reducer(state, { type: 'clipboard-switch', side: 'guest', enabled: true });
    for (const type of ['end', 'leave'] as const) {
      const ended = reducer(state, { type });
      expect(ended.status).toBe('ended');
      expect(ended.previews).toEqual([]);
      expect(clipboardActive(ended)).toBe(false);
      expect(canManage(ended)).toBe(false);
      const reset = reducer(ended, { type: 'reset' });
      expect(reset).toEqual({ ...initialState(), revision: 1 });
    }
  });
});
