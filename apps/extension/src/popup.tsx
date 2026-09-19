import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MIN_PASSWORD_LENGTH, PasswordSchema, SettingsSchema, validateSignalingUrl, type VisualPreferences } from '@ghostpair/protocol';
import { SimulationPreferences } from './simulation-preferences';
import { Brand, Status, Notifications, formatDeviceId, request, requestSessionPermissions, useSession } from './ui';
import './styles.css';

function Popup() {
  const { state, setState, error, setError } = useSession();
  const [password, setPassword] = useState('');
  const [clipboard, setClipboard] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [stun, setStun] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (state?.settings && !settingsOpen) {
      setUrl(state.settings.signalingUrl);
      setStun(state.settings.stunUrls.join('\n'));
    }
  }, [state?.settings, settingsOpen]);

  const active = state && !['idle', 'error'].includes(state.status);
  const connected = state && ['connected', 'paused'].includes(state.status);
  const sharedTabs = state?.tabs.filter(tab => tab.authorized) ?? [];
  const activeTab = state?.tabs.find(tab => tab.id === state.activeTabId);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : 'The operation could not be completed.'); }
    finally { setBusy(false); }
  }

  async function start() {
    if (!state || busy) return;
    if (!consent) { setError('Confirm what you want to share before continuing.'); return; }
    const parsed = PasswordSchema.safeParse(password);
    if (!parsed.success) { setError(parsed.error.issues[0]!.message); return; }
    // Request optional permissions in the original user gesture.
    const permissions = requestSessionPermissions(state.settings.signalingUrl, clipboard, true);
    const sessionPassword = parsed.data;
    setPassword('');
    await run(async () => {
      await permissions;
      setState(await request('ui.host.start', { password: sessionPassword, clipboard }));
    });
  }

  function shareCurrentTab() {
    if (!state || busy) return;
    const permissions = requestSessionPermissions(state.settings.signalingUrl, state.clipboardEnabled, true);
    void run(async () => {
      await permissions;
      setState(await request('ui.host.authorize'));
    });
  }

  async function saveSettings() {
    const signalingUrl = url.trim().replace(/\/$/, '');
    const settings = SettingsSchema.safeParse({ signalingUrl, stunUrls: stun.split(/[\n,]/).map(value => value.trim()).filter(Boolean) });
    if (!settings.success || !validateSignalingUrl(signalingUrl)) {
      setError('Use HTTPS for signaling and valid stun: addresses. HTTP is allowed only on localhost.');
      return;
    }
    const permissions = requestSessionPermissions(signalingUrl, false);
    await run(async () => {
      await permissions;
      setState(await request('ui.settings.save', { settings: settings.data }));
      setSettingsOpen(false);
    });
  }

  function openViewer() {
    void run(async () => { await request('ui.viewer.open'); });
  }

  function saveVisualPreferences(preferences: VisualPreferences) {
    void run(async () => setState(await request('ui.visual.preferences', { preferences })));
  }

  return <main className="popup">
    <header className="popup-header">
      <Brand/>
      <button className="icon-button" aria-label={settingsOpen ? 'Close settings' : 'Open settings'} title="Settings" onClick={() => { setSettingsOpen(!settingsOpen); setError(''); }} disabled={Boolean(active) || busy}>⚙</button>
    </header>
    {settingsOpen ? <section className="settings">
      <p className="eyebrow">CONNECTION</p>
      <h1>Your meeting point.</h1>
      <p className="muted">The signaling server connects your devices. Video and control travel directly between them.</p>
      <label>Signaling server<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://connect.example.com" disabled={busy}/></label>
      <label>STUN servers<textarea rows={3} value={stun} onChange={e => setStun(e.target.value)} placeholder="stun:stun.example.com:3478" disabled={busy}/></label>
      <p className="helper">Each signaling server uses a separate device identity. Saved settings override the build defaults.</p>
      <button className="primary" disabled={busy} onClick={() => void saveSettings()}>Save settings</button>
      <button className="secondary" disabled={busy} onClick={() => void run(async () => { setState(await request('ui.settings.reset')); setSettingsOpen(false); })}>Use build defaults</button>
      {state && <section className="simulation-settings" aria-label="Simulation settings">
        <h2>Simulation</h2>
        <p className="helper">Saved automatically for your next hosted session.</p>
        <SimulationPreferences preferences={state.visualPreferences} busy={busy} onChange={saveVisualPreferences}/>
      </section>}
    </section> : active ? <section className="session-panel">
      <Status state={state}/>
      <h1>{state.role === 'host' ? 'A space for two.' : 'Your remote session.'}</h1>
      <p className="muted">{state.role === 'host' ? 'Share individual tabs in this window. Your visitor sees the active tab only when you have approved it.' : 'Open the viewer to manage your connection and interact with the host.'}</p>
      {state.role === 'host' ? <>
        <div className="address-card">
          <span className="eyebrow">YOUR PERMANENT ADDRESS</span>
          <code>{formatDeviceId(state.deviceId)}</code>
          <button className="text-button" disabled={!state.deviceId} onClick={() => {
            void navigator.clipboard.writeText(state.deviceId ?? '').then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }).catch(() => setError('Select and copy the address manually.'));
          }}>{copied ? 'Copied ✓' : 'Copy address ↗'}</button>
        </div>
        <section className="shared-tabs" aria-label="Shared tabs">
          <p className="eyebrow">SHARED TABS · {sharedTabs.length}/5</p>
          {sharedTabs.length ? <ul>{sharedTabs.map(tab => <li key={tab.id}>
            <div><strong title={tab.title}>{tab.title || 'Untitled tab'}</strong><span className="helper">{tab.active ? 'Active · ' : ''}{tab.captureState === 'ready' ? 'Shared' : tab.captureState === 'pending' ? 'Preparing capture' : 'Capture unavailable'}</span></div>
            <button className="text-button" disabled={busy} aria-label={`Release ${tab.title || 'untitled tab'}`} onClick={() => void run(async () => setState(await request('ui.host.release', { tabId: tab.id })))}>Release</button>
          </li>)}</ul> : <p className="helper">No tabs are shared. Open a web page and share it here.</p>}
          {activeTab && !activeTab.authorized && <p className="helper">{activeTab.supported ? 'Current tab: Awaiting host approval.' : 'The current page cannot be shared.'}</p>}
          <button className="secondary" disabled={busy || sharedTabs.length >= 5 || activeTab?.authorized === true || activeTab?.supported === false} onClick={shareCurrentTab}>Share current tab</button>
          <p className="helper">To share another tab, open it and invoke GhostPair there. Release a tab to free one of the five slots.</p>
        </section>
        {connected && <button className="secondary" disabled={busy} onClick={() => void run(async () => setState(await request('ui.pause', { paused: !state.paused })))}>{state.paused ? 'Resume session' : 'Pause session'}</button>}
        <label className="check"><input type="checkbox" checked={state.controlEnabled} disabled={busy} onChange={e => void run(async () => setState(await request('ui.control', { enabled: e.target.checked })))}/><span>Allow remote control</span></label>
        <section className="simulation-settings" aria-label="Simulation settings">
          <label>Interaction mode<select value={state.controlMode} disabled={busy} onChange={e => void run(async () => setState(await request('ui.control.mode', { mode: e.target.value })))}><option value="visual">Visual only</option><option value="live">Live control</option></select></label>
          <p className="helper">Visual only previews clicks and typing. Scrolling, navigation and tab management remain live.</p>
          <SimulationPreferences preferences={state.visualPreferences} busy={busy} onChange={saveVisualPreferences}/>
          <button className="secondary" disabled={busy || state.controlMode !== 'visual'} onClick={() => void run(async () => setState(await request('ui.visual.clear')))}>Clear simulation</button>
        </section>
      </> : <button className="primary" disabled={busy} onClick={openViewer}>Open remote viewer ↗</button>}
      <label className="check"><input type="checkbox" checked={state.clipboardEnabled} disabled={busy} onChange={e => {
        const enabled = e.target.checked;
        const permissions = enabled ? requestSessionPermissions(state.settings.signalingUrl, true) : Promise.resolve();
        void run(async () => { await permissions; setState(await request('ui.clipboard', { enabled })); });
      }}/><span>Sync system clipboard<small>Text copied in any application. Both participants must enable it.</small></span></label>
      <button className="danger" disabled={busy} onClick={() => void run(async () => setState(await request('ui.stop')))}>{state.role === 'host' ? 'End session' : 'Disconnect'}</button>
      <p className="shortcut">You can also use <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>9</kbd></p>
    </section> : <section>
      <div className="intro"><p className="eyebrow">TWO DEVICES. ONE SHARED SPACE.</p><h1>Browse together.</h1><p className="muted">Share a tab. Work through something together.</p></div>
      <button className="secondary" disabled={busy || !state} onClick={openViewer}>Connect to a host ↗</button>
      <form onSubmit={e => { e.preventDefault(); void start(); }}>
        <label>Session password<input required type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={256} value={password} onChange={e => setPassword(e.target.value)} placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} disabled={busy}/></label>
        <p className="helper">Your address is permanent. Your password lasts for this session only.</p>
        <label className="check"><input type="checkbox" checked={clipboard} onChange={e => setClipboard(e.target.checked)} disabled={busy}/><span>Sync clipboard<small>Continuously share text copied in any application.</small></span></label>
        <label className="check consent"><input required type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy}/><span>I authorize sharing and control of this tab with the person who has my address and password, and tab management in this window. Each additional tab requires my approval before its content is shared.</span></label>
        <button className="primary" disabled={busy || !state} type="submit">{busy ? 'Preparing…' : 'Share current tab →'}</button>
      </form>
      {state?.deviceId && <p className="saved-id">Your address: <code>{formatDeviceId(state.deviceId)}</code></p>}
    </section>}
    <Notifications state={state} error={error} onError={setError}/>
    <footer><span className="connection-dot"/>Direct connection · No relay<span>v0.5</span></footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Popup/>);
