import { useEffect, useState } from 'react';
import type { AppState } from '@ghostpair/protocol';

export const statusLabels: Record<AppState['status'], string> = {
  idle: 'Disconnected', starting: 'Preparing session', waiting: 'Waiting for a visitor', connecting: 'Connecting devices', connected: 'Session connected', paused: 'Session paused', error: 'Connection failed',
};

export async function request(type: string, payload: Record<string, unknown> = {}): Promise<AppState> {
  const reply = await chrome.runtime.sendMessage({ target: 'background', type, ...payload });
  if (!reply?.ok) throw new Error(reply?.error ?? 'The operation could not be completed.');
  return reply.state;
}

export function useSession() {
  const [state, setState] = useState<AppState>();
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = () => { void request('ui.status').then(s => { if (alive) setState(s); }).catch(e => { if (alive) setError(String(e.message)); }); };
    refresh();
    const listener = (message: { type?: string; state?: AppState }) => {
      if (message.type === 'state' && message.state) setState(message.state);
    };
    chrome.runtime.onMessage.addListener(listener);
    const timer = window.setInterval(refresh, 1500);
    return () => { alive = false; clearInterval(timer); chrome.runtime.onMessage.removeListener(listener); };
  }, []);
  return { state, setState, error, setError };
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'compact' : ''}`}><svg viewBox="0 0 40 40" aria-hidden="true"><rect x="1" y="1" width="38" height="38" rx="12" fill="#123638"/><path d="M16 12h-2a7 7 0 0 0 0 14h7a7 7 0 0 0 0-14h-2M24 28h2a7 7 0 0 0 0-14h-7a7 7 0 0 0 0 14h2" fill="none" stroke="#9be7bf" strokeWidth="2.4" strokeLinecap="round"/></svg><span>GhostPair</span>{!compact && <small>CONNECTED, TOGETHER</small>}</div>;
}

export function Status({ state }: { state: AppState }) {
  return <span className={`status status-${state.status}`}><i/>{statusLabels[state.status]}</span>;
}

export function Notifications({ state, error, onError, floating = false }: { state?: AppState; error: string; onError: (value: string) => void; floating?: boolean }) {
  const notification = state?.notification;
  if (!error && !notification) return null;
  return <div className={floating ? 'notification-stack floating' : 'notification-stack'}>
    {error && <div className="alert" role="alert">{error}<button aria-label="Dismiss error" onClick={() => onError('')}>×</button></div>}
    {notification && <div className={notification.kind === 'error' ? 'alert' : 'notice'} role={notification.kind === 'error' ? 'alert' : 'status'}>{notification.message}<button aria-label="Dismiss notification" onClick={() => void request('ui.notification.dismiss', { id: notification.id }).catch(e => onError(e.message))}>×</button></div>}
  </div>;
}

export function formatDeviceId(value?: string) { return value ? value.match(/.{1,4}/g)?.join(' ').toUpperCase() : 'Generated when you share'; }

export async function requestSessionPermissions(signalingUrl: string, clipboard: boolean, host = false): Promise<void> {
  const origin = new URL(signalingUrl).origin;
  const origins = host ? ['http://*/*', 'https://*/*'] : [`${origin}/*`];
  const granted = await chrome.permissions.request({ origins, ...(clipboard ? { permissions: ['clipboardRead', 'clipboardWrite'] } : {}) });
  if (!granted) throw new Error('The selected permissions are required to start this session.');
}
