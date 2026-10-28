import { useEffect, useRef, useState } from 'react';
import { MIN_PASSWORD_LENGTH, PasswordSchema, type AppState } from '@ghostpair/protocol';
import { ConnectionSettings } from './connection-settings';
import { request, requestSessionPermissions, Status } from './ui';
import { useTranslation } from './language';
import { validationMessage } from './runtime-messages';

export function ConnectionPanel({ state, onState, onError }: { state: AppState; onState: (state: AppState) => void; onError: (error: string) => void }) {
  const t = useTranslation();
  const [deviceId, setDeviceId] = useState(() => sessionStorage.getItem('guest.address') ?? '');
  const [password, setPassword] = useState('');
  const [clipboard, setClipboard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const attempt = useRef(0);
  const active = !['idle', 'error'].includes(state.status);
  useEffect(() => () => { ++attempt.current; }, []);

  async function connect() {
    if (active || busy || settingsBusy) return;
    const current = ++attempt.current;
    onError('');
    try {
      PasswordSchema.parse(password);
      const address = deviceId.replace(/[\s-]/g, '').toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(address)) throw new Error('Enter the 32-character connection code shared with you.');
      setBusy(true);
      const permissions = requestSessionPermissions(state.settings.signalingUrl, clipboard);
      await permissions;
      if (attempt.current !== current) return;
      sessionStorage.setItem('guest.address', address);
      onState(await request('ui.guest.start', { deviceId: address, password, clipboard }));
    } catch (error) { if (attempt.current === current) onError(validationMessage(error)); }
    finally { setPassword(''); if (attempt.current === current) setBusy(false); }
  }
  async function cancel() {
    ++attempt.current; setPassword(''); setBusy(false);
    try { onState(await request('ui.stop')); } catch (error) { onError((error as Error).message); }
  }

  return <section className="connection-panel"><Status state={state}/><h1>{t("Join a session.")}</h1><p className="muted">{t("Enter the code and password from the person sharing their tab.")}</p>
    {active || busy ? <><p className="notice">{state.role === 'host' ? t("You’re already sharing a session. End it before joining another one.") : t("Preparing your connection…")}</p><button className="danger" onClick={() => void cancel()}>{state.role === 'host' ? t("End current session") : t("Cancel connection")}</button></> : <>
      <form className="join-form" onSubmit={event => { event.preventDefault(); void connect(); }}>
        {state.settings.legacyCompatibility && <p className="helper">{t("0.6.6 compatibility is on.")}</p>}
        <label>{t("Connection code")}<input required autoComplete="off" maxLength={64} value={deviceId} disabled={settingsBusy} onChange={event => setDeviceId(event.target.value)} placeholder={t("Code shared with you")}/></label>
        <label>{t("Password")}<input required type="password" autoComplete="off" minLength={MIN_PASSWORD_LENGTH} maxLength={256} value={password} disabled={settingsBusy} onChange={event => setPassword(event.target.value)} placeholder={t("Session password")}/></label>
        <label className="check"><input type="checkbox" checked={clipboard} disabled={settingsBusy} onChange={event => setClipboard(event.target.checked)}/><span>{t("Share clipboard")}<small>{t("Share text copied in any application. Both people must turn this on.")}</small></span></label>
        <button className="primary" type="submit" disabled={settingsBusy}>{t("Join session")}</button>
      </form>
      <details className="advanced-options" open={settingsOpen} onToggle={event => setSettingsOpen(event.currentTarget.open)}>
        <summary>{t("Advanced connection settings")}</summary>
        {settingsOpen && <ConnectionSettings state={state} onState={onState} onError={onError} onSaved={() => setSettingsOpen(false)} onBusyChange={setSettingsBusy}/>}
      </details>
    </>}
  </section>;
}
