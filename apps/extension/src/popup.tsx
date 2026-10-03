import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MIN_PASSWORD_LENGTH, PasswordSchema, type VisualPreferences } from '@ghostpair/protocol';
import { ConnectionSettings } from './connection-settings';
import { SimulationPreferences } from './simulation-preferences';
import { Brand, Status, Notifications, formatDeviceId, request, requestSessionPermissions, useSession } from './ui';
import './styles.css';

function Popup() {
  const { state, setState, error, setError } = useSession();
  const [screen, setScreen] = useState<'home' | 'share'>('home');
  const [password, setPassword] = useState('');
  const [clipboard, setClipboard] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareButton = useRef<HTMLButtonElement>(null);

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

  function openViewer() {
    void run(async () => { await request('ui.viewer.open'); });
  }

  function saveVisualPreferences(preferences: VisualPreferences) {
    void run(async () => setState(await request('ui.visual.preferences', { preferences })));
  }

  function back() {
    setScreen('home');
    setPassword('');
    setConsent(false);
    setError('');
    requestAnimationFrame(() => shareButton.current?.focus());
  }

  const clipboardControl = state && <label className="check">
    <input type="checkbox" checked={state.clipboardEnabled} disabled={busy} onChange={e => {
      const enabled = e.target.checked;
      const permissions = enabled ? requestSessionPermissions(state.settings.signalingUrl, true) : Promise.resolve();
      void run(async () => { await permissions; setState(await request('ui.clipboard', { enabled })); });
    }}/>
    <span>Share clipboard<small>Text copied in any application. Both people must enable sharing.</small></span>
  </label>;

  return <main className={`popup${active && !settingsOpen ? ' session-popup' : ''}`}>
    <header className="popup-header">
      <Brand/>
      <button className="icon-button" aria-label={settingsOpen ? 'Close settings' : 'Open settings'} title="Settings" aria-expanded={settingsOpen} onClick={() => { setSettingsOpen(!settingsOpen); setError(''); }} disabled={busy || Boolean(active && !settingsOpen)}>
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m9 3-.7 2.4-2.1 1.2-2.4-.6-2 3.5 1.7 1.8v2.4l-1.7 1.8 2 3.5 2.4-.6 2.1 1.2L9 22h4l.7-2.4 2.1-1.2 2.4.6 2-3.5-1.7-1.8v-2.4l1.7-1.8-2-3.5-2.4.6-2.1-1.2L13 3Z"/><circle cx="11" cy="12.5" r="3"/></svg>
      </button>
    </header>

    {settingsOpen ? <section className="settings">
      <h1>Settings</h1>
      {state && <>
        <ConnectionSettings state={state} busy={busy} onState={setState} onError={setError} onBusyChange={setBusy} onSaved={() => setSettingsOpen(false)}/>
        <details className="advanced-options feedback-options">
          <summary>Interaction feedback</summary>
          <p className="helper">{state.role === 'guest' ? 'Interaction feedback is available when you share a tab.' : 'Saved automatically for your next sharing session.'}</p>
          <SimulationPreferences preferences={state.visualPreferences} busy={busy || state.role === 'guest'} onChange={saveVisualPreferences}/>
        </details>
      </>}
    </section> : active ? <section className="session-panel">
      <Status state={state}/>
      {state.role === 'host' ? <>
        <h1 className="sr-only">Sharing session</h1>
        <div className="address-card">
          <h2>Connection code</h2>
          <div className="code-row">
            <code>{state.deviceId ? formatDeviceId(state.deviceId) : 'Preparing your code…'}</code>
            <button className="copy-button" disabled={!state.deviceId} aria-live="polite" onClick={() => {
              void navigator.clipboard.writeText(state.deviceId ?? '').then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }).catch(() => setError('Select and copy the connection code manually.'));
            }}>
              <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M12 7V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h3"/></svg>
              {copied ? 'Copied' : 'Copy code'}
            </button>
          </div>
          <p className="helper">Share this code and your password with the person joining.</p>
        </div>

        <section className="shared-tabs" aria-label="Shared tabs">
          <h2>Shared tabs <span className="tab-count">{sharedTabs.length}/5</span></h2>
          {sharedTabs.length ? <ul>{sharedTabs.map(tab => <li key={tab.id}>
            <div><strong title={tab.title}>{tab.title || 'Untitled tab'}</strong><span className="helper">{tab.active ? 'Active · ' : ''}{tab.captureState === 'ready' ? 'Shared' : tab.captureState === 'pending' ? 'Getting ready…' : "This tab can't be shared"}</span></div>
            <button className="text-button" disabled={busy} aria-label={`Stop sharing ${tab.title || 'untitled tab'}`} onClick={() => void run(async () => setState(await request('ui.host.release', { tabId: tab.id })))}>Stop sharing</button>
          </li>)}</ul> : <p className="helper">No tabs shared yet. Open a web page and share it here.</p>}
          {activeTab && !activeTab.authorized && <p className="helper">{activeTab.supported ? 'This tab is waiting for you to share it.' : "This tab can't be shared. Open a regular web page."}</p>}
          <button className="secondary" disabled={busy || sharedTabs.length >= 5 || activeTab?.authorized === true || activeTab?.supported === false} onClick={shareCurrentTab}>Share this tab</button>
          <p className="helper">{sharedTabs.length >= 5 ? 'Stop sharing a tab to make room for another.' : 'Only your active, approved tab is visible. Open another tab to share it.'}</p>
        </section>

        <section className="session-controls" aria-label="Page interaction">
          <label className="check"><input type="checkbox" checked={state.controlEnabled} disabled={busy} onChange={e => void run(async () => setState(await request('ui.control', { enabled: e.target.checked })))}/><span>Let them control the page</span></label>
          <label>Interaction mode<select value={state.controlMode} disabled={busy} onChange={e => void run(async () => setState(await request('ui.control.mode', { mode: e.target.value })))}><option value="visual">Preview changes</option><option value="live">Full control</option></select></label>
          <p className="helper">{state.controlMode === 'visual' ? 'Clicks and typing are previews. Scrolling, navigation and tab management still affect the page.' : 'Clicks and typing change the page. Scrolling, navigation and tab management also affect it.'}</p>
        </section>
      </> : <>
        <h1>Your shared session</h1>
        <p className="muted">Open the shared view to browse together.</p>
        <button className="primary" disabled={busy} onClick={openViewer}>Open shared view</button>
      </>}

      <details className="advanced-options">
        <summary>Advanced options</summary>
        {clipboardControl}
        {state.role === 'host' && <section className="interaction-feedback" aria-label="Interaction feedback">
          <h2>Interaction feedback</h2>
          <p className="helper">Choose what appears on the shared page. Changes save automatically.</p>
          <SimulationPreferences preferences={state.visualPreferences} busy={busy} onChange={saveVisualPreferences}/>
          <button className="secondary" disabled={busy || state.controlMode !== 'visual'} onClick={() => void run(async () => setState(await request('ui.visual.clear')))}>Clear previews</button>
        </section>}
      </details>

    </section> : screen === 'share' ? <section className="share-setup">
      <button className="text-button back-button" disabled={busy} onClick={back}>Back</button>
      <h1>Share your tab</h1>
      <p className="muted">Choose a password, then invite someone to browse with you.</p>
      <form onSubmit={e => { e.preventDefault(); void start(); }}>
        <label>Password<input autoFocus required type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={256} value={password} onChange={e => setPassword(e.target.value)} placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} disabled={busy}/></label>
        <p className="helper">This password is only for this session.</p>
        <label className="check"><input type="checkbox" checked={clipboard} onChange={e => setClipboard(e.target.checked)} disabled={busy}/><span>Share clipboard<small>Text copied in any application. Both people must enable sharing.</small></span></label>
        <label className="check consent"><input required type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy}/><span>I allow the person with my connection code and password to view and interact with this tab, and manage tabs in this window. I’ll approve each additional tab before it’s shared.</span></label>
        <button className="primary" disabled={busy || !state} type="submit">{busy ? 'Preparing…' : 'Share this tab'}</button>
      </form>
    </section> : <section className="start-panel">
      <div className="intro"><h1>Browse together.</h1><p className="muted">What would you like to do?</p></div>
      <div className="session-choices">
        <div className="share-choice">
          <button ref={shareButton} className="intent-action primary" aria-label="Share my tab" aria-describedby="share-intent share-code" disabled={busy || !state} onClick={() => { setScreen('share'); setError(''); }}><span>Share my tab</span><small id="share-intent">Invite someone to see and interact with your tab.</small></button>
          <p id="share-code" className="helper connection-code">Your connection code: <span>{formatDeviceId(state?.deviceId)}</span></p>
        </div>
        <button className="intent-action secondary" aria-label="Join a session" aria-describedby="join-intent" disabled={busy || !state} onClick={openViewer}><span>Join a session</span><small id="join-intent">Connect to someone who is already sharing.</small></button>
      </div>
    </section>}
    <Notifications state={state} error={error} onError={setError}/>
    {active && !settingsOpen && <section className="session-footer" aria-label="Session actions">
      <div className="session-actions">
        {state.role === 'host' && connected && <button className="secondary" disabled={busy} onClick={() => void run(async () => setState(await request('ui.pause', { paused: !state.paused })))}>{state.paused ? 'Resume session' : 'Pause session'}</button>}
        <button className="danger" disabled={busy} onClick={() => void run(async () => setState(await request('ui.stop')))}>{state.role === 'host' ? 'End session' : 'Leave session'}</button>
      </div>
      <p className="shortcut">End session: <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>9</kbd></p>
    </section>}
    <footer className="popup-footer"><span>Connected, together</span><span>v{chrome.runtime.getManifest().version}</span></footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Popup/>);
