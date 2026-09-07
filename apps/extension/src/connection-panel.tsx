import { useEffect, useRef, useState } from 'react';
import { MIN_PASSWORD_LENGTH, PasswordSchema, SettingsSchema, validateSignalingUrl, type AppState } from '@ghostpair/protocol';
import { request, requestSessionPermissions, Status } from './ui';

export function ConnectionPanel({ state, onState, onError }: { state: AppState; onState: (state: AppState) => void; onError: (error: string) => void }) {
  const [deviceId, setDeviceId] = useState(() => sessionStorage.getItem('guest.address') ?? '');
  const [password, setPassword] = useState('');
  const [clipboard, setClipboard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [url, setUrl] = useState(state.settings.signalingUrl);
  const [stun, setStun] = useState(state.settings.stunUrls.join('\n'));
  const attempt = useRef(0);
  const active = !['idle', 'error'].includes(state.status);
  useEffect(() => { setUrl(state.settings.signalingUrl); setStun(state.settings.stunUrls.join('\n')); }, [state.settings]);
  useEffect(() => () => { ++attempt.current; }, []);

  async function connect() {
    const current = ++attempt.current;
    onError('');
    try {
      PasswordSchema.parse(password);
      const address = deviceId.replace(/[\s-]/g, '').toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(address)) throw new Error('Enter the host’s 32-character GhostPair address.');
      setBusy(true);
      const permissions = requestSessionPermissions(state.settings.signalingUrl, clipboard);
      await permissions;
      if (attempt.current !== current) return;
      sessionStorage.setItem('guest.address', address);
      onState(await request('ui.guest.start', { deviceId: address, password, clipboard }));
    } catch (error) { if (attempt.current === current) onError(error instanceof Error ? error.message : 'Could not connect.'); }
    finally { setPassword(''); if (attempt.current === current) setBusy(false); }
  }
  async function cancel() {
    ++attempt.current; setPassword(''); setBusy(false);
    try { onState(await request('ui.stop')); } catch (error) { onError((error as Error).message); }
  }
  async function settings(reset = false) {
    try {
      if (reset) { onState(await request('ui.settings.reset')); setSettingsOpen(false); return; }
      const value = SettingsSchema.parse({ signalingUrl: url.trim().replace(/\/$/, ''), stunUrls: stun.split(/[\n,]/).map(s => s.trim()).filter(Boolean) });
      if (!validateSignalingUrl(value.signalingUrl)) throw new Error('Use HTTPS for signaling, or HTTP on localhost.');
      await requestSessionPermissions(value.signalingUrl, false);
      onState(await request('ui.settings.save', { settings: value })); setSettingsOpen(false);
    } catch (error) { onError((error as Error).message); }
  }

  return <section className="connection-panel"><Status state={state}/><p className="eyebrow">YOUR SHARED SPACE</p><h1>Connect with your host.</h1><p className="muted">Enter the address and session password your host shared with you.</p>
    {active || busy ? <><p className="notice">{state.role === 'host' ? 'This browser is hosting a session. End it before joining another host.' : 'Preparing your direct connection…'}</p><button className="danger" onClick={() => void cancel()}>Cancel connection</button></> : <>
      <form onSubmit={e => { e.preventDefault(); void connect(); }}><label>Host address<input required autoComplete="off" maxLength={64} value={deviceId} onChange={e => setDeviceId(e.target.value)} placeholder="GhostPair address"/></label><label>Session password<input required type="password" autoComplete="off" minLength={MIN_PASSWORD_LENGTH} maxLength={256} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters"/></label><label className="check"><input type="checkbox" checked={clipboard} onChange={e => setClipboard(e.target.checked)}/><span>Synchronize Windows clipboard<small>Continuously share text copied in any application. Both participants must enable it.</small></span></label><button className="primary" type="submit">Connect →</button></form>
      <button className="text-button" onClick={() => setSettingsOpen(!settingsOpen)}>Connection settings</button>
      {settingsOpen && <form className="settings" onSubmit={e => { e.preventDefault(); void settings(); }}><label>Signaling server<input required type="url" value={url} onChange={e => setUrl(e.target.value)}/></label><label>STUN servers<textarea value={stun} onChange={e => setStun(e.target.value)}/></label><button className="primary" type="submit">Save settings</button><button className="secondary" type="button" onClick={() => void settings(true)}>Use build defaults</button></form>}
    </>}
  </section>;
}
