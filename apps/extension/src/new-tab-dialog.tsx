import { useEffect, useRef, useState } from 'react';
import { isSupportedUrl } from '@ghostpair/protocol';
import { request } from './ui';
import { useLocale, useTranslation } from './language';
import { translateRuntimeMessage } from './runtime-messages';

export function NewTabDialog({ onClose, controlRevision }: { onClose: () => void; controlRevision: number }) {
  const t = useTranslation();
  const locale = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  async function open() {
    if (busy) return;
    const value = url.trim();
    const normalized = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
    if (!value || !isSupportedUrl(normalized)) { setError('Enter an HTTP or HTTPS page address.'); return; }
    setBusy(true); setError('');
    try { await request('ui.command', { command: { type: 'tab.create', url: normalized, controlRevision } }); onClose(); }
    catch (error) { setError((error as Error).message); setBusy(false); }
  }
  return <dialog ref={dialog} className="new-tab-dialog" aria-labelledby="new-tab-title" onCancel={onClose} onClose={onClose}><form onSubmit={e => { e.preventDefault(); void open(); }}><h1 id="new-tab-title">{t("Open a new tab")}</h1><label>{t("Page address")}<input autoFocus autoComplete="off" value={url} maxLength={8192} onChange={e => setUrl(e.target.value)} placeholder="https://example.com" disabled={busy}/></label>{error && <p role="alert" className="alert">{translateRuntimeMessage(locale, error)}</p>}<button className="primary" disabled={busy} type="submit">{busy ? t("Opening…") : t("Open")}</button><button className="secondary" type="button" onClick={onClose}>{t("Cancel")}</button></form></dialog>;
}
