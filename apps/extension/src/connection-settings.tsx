import { useEffect, useId, useRef, useState } from 'react';
import type { AppState } from '@ghostpair/protocol';
import { GHOSTPAIR_SERVER_SETTINGS, getConnectionServerMode, parseCustomConnectionSettings } from './connection-presets';
import { request, requestSessionPermissions } from './ui';
import { useTranslation } from './language';

interface ConnectionSettingsProps {
  state: AppState;
  busy?: boolean;
  onState: (state: AppState) => void;
  onError: (error: string) => void;
  onSaved?: () => void;
  onBusyChange?: (busy: boolean) => void;
}

export function ConnectionSettings({ state, busy = false, onState, onError, onSaved, onBusyChange }: ConnectionSettingsProps) {
  const t = useTranslation();
  const [mode, setMode] = useState(() => getConnectionServerMode(state.settings));
  const [url, setUrl] = useState(state.settings.signalingUrl);
  const [stun, setStun] = useState(state.settings.stunUrls.join('\n'));
  const [legacyCompatibility, setLegacyCompatibility] = useState(state.settings.legacyCompatibility === true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const latestState = useRef(state);
  latestState.current = state;
  const radioName = useId();
  const savedStun = state.settings.stunUrls.join('\n');
  const active = !['idle', 'error'].includes(state.status);
  const disabled = active || busy || saving;

  useEffect(() => {
    setMode(getConnectionServerMode(state.settings));
    setUrl(state.settings.signalingUrl);
    setStun(savedStun);
    setLegacyCompatibility(state.settings.legacyCompatibility === true);
  }, [state.settings.signalingUrl, savedStun, state.settings.legacyCompatibility]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function save() {
    if (disabled || savingRef.current) return;
    onError('');
    try {
      const connection = mode === 'ghostpair' ? { ...GHOSTPAIR_SERVER_SETTINGS, stunUrls: [...GHOSTPAIR_SERVER_SETTINGS.stunUrls] } : parseCustomConnectionSettings(url, stun);
      const settings = legacyCompatibility ? { ...connection, legacyCompatibility: true } : connection;
      savingRef.current = true;
      setSaving(true);
      onBusyChange?.(true);
      // Keep the permission request in the original Save gesture.
      const permissions = requestSessionPermissions(settings.signalingUrl, false);
      await permissions;
      if (!mounted.current) return;
      if (!['idle', 'error'].includes(latestState.current.status)) throw new Error('End the session before changing connection settings.');
      const nextState = await request('ui.settings.save', { settings });
      if (!mounted.current) return;
      onState(nextState);
      onSaved?.();
    } catch (error) {
      if (mounted.current) onError(error instanceof Error ? error.message : 'Could not save connection settings.');
    } finally {
      if (savingRef.current) {
        savingRef.current = false;
        if (mounted.current) setSaving(false);
        onBusyChange?.(false);
      }
    }
  }

  return <form className="connection-settings" aria-busy={saving} onSubmit={event => { event.preventDefault(); void save(); }}>
    <fieldset className="server-options" disabled={disabled}>
      <legend>{t("Connection")}</legend>
      <label className={`server-option${mode === 'ghostpair' ? ' selected' : ''}`}>
        <input type="radio" name={radioName} value="ghostpair" checked={mode === 'ghostpair'} onChange={() => setMode('ghostpair')}/>
        <span>{t("GhostPair server")}<small>{t("Recommended · Ready to use")}</small></span>
      </label>
      <label className={`server-option${mode === 'custom' ? ' selected' : ''}`}>
        <input type="radio" name={radioName} value="custom" checked={mode === 'custom'} onChange={() => setMode('custom')}/>
        <span>{t("Custom server")}<small>{t("Use your own connection settings")}</small></span>
      </label>
    </fieldset>
    {mode === 'custom' && <fieldset className="custom-server-fields" disabled={disabled}>
      <legend className="sr-only">{t("Custom server settings")}</legend>
      <label>{t("Connection server")}<input required type="url" autoComplete="off" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://your-server.com"/></label>
      <label>{t("STUN servers")}<textarea required rows={3} value={stun} onChange={event => setStun(event.target.value)} placeholder="stun:stun.example.com:3478"/></label>
      <p className="helper">{t("One to five addresses, separated by commas or new lines. Both people must use the same connection server.")}</p>
    </fieldset>}
    <label className="check"><input type="checkbox" checked={legacyCompatibility} disabled={disabled} onChange={event => setLegacyCompatibility(event.target.checked)}/><span>{t("Connect with GhostPair 0.6.6")}<small>{t("Enable when the other person uses 0.6.6. Uses its older authentication: the server receives the session password and peer identity is not verified end to end.")}</small></span></label>
    {active && <p className="helper">{t("End the session before changing connection settings.")}</p>}
    <button className="primary" type="submit" disabled={disabled}>{saving ? t("Saving…") : t("Save")}</button>
  </form>;
}
