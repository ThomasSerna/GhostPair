import type { AppState } from '@ghostpair/protocol';

export function patchState(state: AppState, patch: Partial<AppState>): AppState {
  const next = { ...state, ...patch };
  const message = patch.error || patch.notice;
  if (message) next.notification = { id: crypto.randomUUID(), kind: patch.error ? 'error' : 'notice', message };
  return next;
}
export function dismissNotification(state: AppState, id: string): AppState {
  return state.notification?.id === id ? { ...state, notification: undefined, error: undefined, notice: undefined } : state;
}
