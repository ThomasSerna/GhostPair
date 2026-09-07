import { useEffect, useRef, useState } from 'react';
import { isSupportedUrl } from '@ghostpair/protocol';
import { request } from './ui';

export function NewTabDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  async function open() {
    if (busy) return;
    const value = url.trim();
    const normalized = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
    if (!value || !isSupportedUrl(normalized)) { setError('Enter an HTTP or HTTPS page address.'); return; }
    setBusy(true); setError('');
    try { await request('ui.command', { command: { type: 'tab.create', url: normalized } }); onClose(); }
    catch (error) { setError((error as Error).message); setBusy(false); }
  }
  return <dialog ref={dialog} className="new-tab-dialog" aria-labelledby="new-tab-title" onCancel={onClose} onClose={onClose}><form onSubmit={e => { e.preventDefault(); void open(); }}><h1 id="new-tab-title">Open a new tab</h1><label>Page address<input autoFocus autoComplete="off" value={url} maxLength={8192} onChange={e => setUrl(e.target.value)} placeholder="https://example.com" disabled={busy}/></label>{error && <p role="alert" className="alert">{error}</p>}<button className="primary" disabled={busy} type="submit">{busy ? 'Opening…' : 'Open'}</button><button className="secondary" type="button" onClick={onClose}>Cancel</button></form></dialog>;
}
