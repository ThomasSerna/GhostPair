import { expect, it } from 'vitest';
import type { AppState } from '@ghostpair/protocol';
import { dismissNotification, patchState } from './notifications';

it('dismisses the current occurrence without changing status or hiding a later identical message', () => {
  const first = patchState({ status: 'error' } as AppState, { error: 'Connection failed' });
  const dismissed = dismissNotification(first, first.notification!.id);
  expect(dismissed.status).toBe('error');
  expect(patchState(dismissed, { generation: 3 }).notification).toBeUndefined();
  const second = patchState(dismissed, { error: 'Connection failed' });
  expect(second.notification!.id).not.toBe(first.notification!.id);
  expect(dismissNotification(second, first.notification!.id)).toEqual(second);
  const notice = patchState(dismissed, { notice: 'Signaling disconnected' });
  expect(dismissNotification(notice, notice.notification!.id).notification).toBeUndefined();
});
