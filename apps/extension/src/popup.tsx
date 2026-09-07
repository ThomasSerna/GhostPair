import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PasswordSchema, SettingsSchema, validateSignalingUrl } from '@ghostpair/protocol';
import { Brand, Status, formatDeviceId, request, requestSessionPermissions, useSession } from './ui';
import './styles.css';

function Popup() {
  const { state, setState, error, setError } = useSession();
  const [mode, setMode] = useState<'host' | 'guest'>('host');
  const [password, setPassword] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [clipboard, setClipboard] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [stun, setStun] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (state?.settings && !settingsOpen) { setUrl(state.settings.signalingUrl); setStun(state.settings.stunUrls.join('\n')); } }, [state?.settings, settingsOpen]);
  const active = state && !['idle', 'error'].includes(state.status);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Ocurrió un error.'); } finally { setBusy(false); }
  }
  async function start() {
    if (!state) return;
    if (!consent) { setError('Confirma qué vas a compartir antes de continuar.'); return; }
    if (mode === 'host') { const result = PasswordSchema.safeParse(password); if (!result.success) { setError(result.error.issues[0]!.message); return; } }
    const permissions = requestSessionPermissions(state.settings.signalingUrl, clipboard);
    await run(async () => {
      await permissions;
      setState(await request(mode === 'host' ? 'ui.host.start' : 'ui.guest.start', { password, clipboard, ...(mode === 'guest' ? { deviceId: deviceId.replace(/[\s-]/g, '').toLowerCase() } : {}) }));
      setPassword('');
    });
  }
  async function saveSettings() {
    const signalingUrl = url.trim().replace(/\/$/, '');
    const settings = SettingsSchema.safeParse({ signalingUrl, stunUrls: stun.split(/[\n,]/).map(x => x.trim()).filter(Boolean) });
    if (!settings.success || !validateSignalingUrl(signalingUrl)) { setError('Usa HTTPS para el servidor y direcciones stun: válidas. HTTP solo se permite en localhost.'); return; }
    const permissions = requestSessionPermissions(signalingUrl, false);
    await run(async () => { await permissions; setState(await request('ui.settings.save', { settings: settings.data })); setSettingsOpen(false); });
  }

  return <main className="popup"><header className="popup-header"><Brand/><button className="icon-button" aria-label={settingsOpen ? 'Cerrar configuración' : 'Abrir configuración'} title="Configuración" onClick={() => { setSettingsOpen(!settingsOpen); setError(''); }} disabled={Boolean(active)}>⚙</button></header>
    {settingsOpen ? <section className="settings"><p className="eyebrow">CONEXIÓN</p><h1>Tu punto de encuentro.</h1><p className="muted">El servidor conecta los equipos. La imagen y el control viajan directamente entre ellos.</p><label>Servidor de señalización<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://conectar.tudominio.com"/></label><label>Servidores STUN<textarea rows={3} value={stun} onChange={e => setStun(e.target.value)} placeholder="stun:stun.tudominio.com:3478"/></label><p className="helper">Cambiar de servidor utiliza una identidad distinta para ese servidor.</p><button className="primary" disabled={busy} onClick={() => void saveSettings()}>Guardar configuración</button><button className="secondary" disabled={busy} onClick={() => void run(async () => { setState(await request("ui.settings.reset")); setSettingsOpen(false); })}>Use build defaults</button><details><summary>Identificador de esta extensión</summary><code className="extension-id">{chrome.runtime.id}</code><p className="helper">El administrador debe autorizar este identificador en el servidor.</p></details></section>
    : active ? <section className="session-panel"><Status state={state}/><h1>{state.role === 'host' ? 'Un espacio para dos.' : 'Al otro lado, contigo.'}</h1><p className="muted">{state.role === 'host' ? 'Estás compartiendo las páginas de la ventana autorizada.' : 'Abre la vista remota para interactuar con la sesión.'}</p>{state.role === 'host' && <div className="address-card"><span className="eyebrow">TU DIRECCIÓN FIJA</span><code>{formatDeviceId(state.deviceId)}</code><button className="text-button" onClick={() => { void navigator.clipboard.writeText(state.deviceId ?? '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => setError('Selecciona y copia la dirección manualmente.')); }}>{copied ? 'Copiada ✓' : 'Copiar dirección ↗'}</button></div>}
      {state.role === 'guest' && <button className="primary" onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') })}>Abrir vista remota ↗</button>}
      {state.role === 'host' && <><button className="secondary" disabled={busy} onClick={() => void run(async () => setState(await request('ui.pause', { paused: !state.paused })))}>{state.paused ? 'Reanudar sesión' : 'Pausar sesión'}</button><label className="check"><input type="checkbox" checked={state.controlEnabled} onChange={e => void run(async () => setState(await request('ui.control', { enabled: e.target.checked })))}/><span>Permitir control remoto</span></label></>}
      <label className="check"><input type="checkbox" checked={state.clipboardEnabled} disabled={busy} onChange={e => { const enabled = e.target.checked; const permissions = enabled ? requestSessionPermissions(state.settings.signalingUrl, true) : Promise.resolve(); void run(async () => { await permissions; setState(await request('ui.clipboard', { enabled })); }); }}/><span>Sincronizar portapapeles de Windows<small>Texto de cualquier aplicación. Ambos deben activarlo.</small></span></label>
      <button className="danger" onClick={() => void run(async () => setState(await request('ui.stop')))}>Terminar sesión</button><p className="shortcut">También puedes usar <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>9</kbd></p></section>
    : <section><div className="intro"><p className="eyebrow">DOS EQUIPOS. UN MISMO ESPACIO.</p><h1>Naveguemos juntos.</h1><p className="muted">Comparte una página. Resuelve algo en equipo.</p></div><div className="mode-tabs" role="tablist" aria-label="Tipo de sesión"><button role="tab" aria-selected={mode === 'host'} onClick={() => { setMode('host'); setConsent(false); setError(''); }}>Compartir</button><button role="tab" aria-selected={mode === 'guest'} onClick={() => { setMode('guest'); setConsent(false); setError(''); }}>Conectarse</button></div>
      <form onSubmit={e => { e.preventDefault(); void start(); }}>
        {mode === 'guest' && <label>Dirección del anfitrión<input required autoComplete="off" value={deviceId} onChange={e => setDeviceId(e.target.value)} placeholder="Pega su dirección de GhostPair" maxLength={64}/></label>}
        <label>{mode === 'host' ? 'Contraseña de esta sesión' : 'Contraseña'}<input required type="password" autoComplete="off" minLength={mode === 'host' ? 12 : 1} maxLength={256} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'host' ? 'Mínimo 12 caracteres' : 'La que te compartió el anfitrión'}/></label>
        {mode === 'host' && <p className="helper">La dirección es permanente. La contraseña solo dura esta sesión.</p>}
        <label className="check"><input type="checkbox" checked={clipboard} onChange={e => setClipboard(e.target.checked)}/><span>Sincronizar portapapeles<small>Comparte continuamente el texto copiado en Windows.</small></span></label>
        <label className="check consent"><input required type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/><span>{mode === 'host' ? 'Autorizo compartir y controlar las páginas de esta ventana, incluidas las pestañas nuevas, con quien tenga mi dirección y contraseña.' : 'Acepto conectarme a la sesión autorizada. Si activo el portapapeles, compartiré el texto que copie en este equipo.'}</span></label>
        <button className="primary" disabled={busy || !state} type="submit">{busy ? 'Preparando…' : mode === 'host' ? 'Iniciar sesión compartida →' : 'Conectar con el anfitrión →'}</button>
      </form>{state?.deviceId && mode === 'host' && <p className="saved-id">Tu dirección: <code>{formatDeviceId(state.deviceId)}</code></p>}
    </section>}
    {(error || state?.error) && <div role="alert" className="alert">{error || state?.error}</div>}{state?.notice && <div role="status" className="notice">{state.notice}</div>}
    <footer><span className="connection-dot"/>Conexión directa · Sin retransmisión<span>v0.1</span></footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Popup/>);
