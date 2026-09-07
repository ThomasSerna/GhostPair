import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FrameMetaSchema, MAX_CLIPBOARD_BYTES, type AppState, type ControlCommand, type ViewerFrame } from '@ghostpair/protocol';
import { Brand, Status, Notifications, request } from './ui';
import { ConnectionPanel } from './connection-panel';
import './styles.css';

function Viewer() {
  const [state, setState] = useState<AppState>();
  const [error, setError] = useState('');
  const [address, setAddress] = useState('');
  const [hasFrame, setHasFrame] = useState(false);
  const [focused, setFocused] = useState(false);
  const port = useRef<chrome.runtime.Port | null>(null);
  const stateRef = useRef<AppState | undefined>(undefined);
  const canvas = useRef<HTMLCanvasElement>(null);
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const frame = useRef<ViewerFrame | undefined>(undefined);
  const composing = useRef(false);
  const heldKeys = useRef(new Map<string, Omit<Extract<ControlCommand, { type: 'key' }>, 'type' | 'event' | 'tabId' | 'generation'>>());
  const heldPointer = useRef<Extract<ControlCommand, { type: 'pointer' }> | undefined>(undefined);
  const drawing = useRef(false);
  const pending = useRef<ViewerFrame | undefined>(undefined);
  const disposed = useRef(false);
  const lastClick = useRef({ time: 0, x: 0, y: 0, button: -1, count: 0 });

  function send(command: ControlCommand) {
    if (!port.current || !stateRef.current || stateRef.current.status !== 'connected' || stateRef.current.paused || !stateRef.current.controlEnabled) return;
    port.current.postMessage({ type: 'control', command });
  }
  function target() {
    const f = frame.current?.meta;
    const s = stateRef.current;
    return f && s && f.tabId === s.activeTabId && f.generation === s.generation ? { tabId: f.tabId, generation: f.generation } : undefined;
  }
  function releaseKeys() {
    const t = target();
    if (t) for (const key of heldKeys.current.values()) send({ type: 'key', event: 'up', ...t, ...key });
    heldKeys.current.clear();
  }
  function releasePointer() {
    const pointer = heldPointer.current; heldPointer.current = undefined;
    if (pointer) send({ ...pointer, event: 'up', buttons: 0 });
  }
  async function draw(next: ViewerFrame) {
    pending.current = next;
    if (drawing.current) return;
    drawing.current = true;
    try {
      while (pending.current && !disposed.current) {
        const current = pending.current;
        pending.current = undefined;
        const img = new Image();
        img.src = current.dataUrl;
        try { await img.decode(); } catch { continue; }
        const s = stateRef.current;
        if (!canvas.current || !s || disposed.current || current.meta.generation !== s.generation || current.meta.tabId !== s.activeTabId) continue;
        if (img.naturalWidth > 1920 || img.naturalHeight > 1920 || !img.naturalWidth || !img.naturalHeight) continue;
        canvas.current.width = img.naturalWidth;
        canvas.current.height = img.naturalHeight;
        canvas.current.getContext('2d')!.drawImage(img, 0, 0);
        frame.current = current;
        setHasFrame(true);
      }
    } finally { drawing.current = false; }
  }
  useEffect(() => {
    disposed.current = false;
    const connection = chrome.runtime.connect({ name: 'viewer' });
    port.current = connection;
    connection.onMessage.addListener((message: { type?: string; state?: AppState; frame?: ViewerFrame; error?: string }) => {
      if (message.type === 'state' && message.state) {
        const next = message.state;
        if (stateRef.current?.generation !== next.generation || stateRef.current?.activeTabId !== next.activeTabId) { releaseKeys(); releasePointer(); frame.current = undefined; setHasFrame(false); }
        stateRef.current = next;
        setState(next);
      }
      if (message.type === 'frame' && message.frame && FrameMetaSchema.safeParse(message.frame.meta).success && /^data:image\/jpeg;base64,/.test(message.frame.dataUrl)) void draw(message.frame);
      if (message.type === 'error') setError(message.error ?? 'No se pudo completar la acción.');
    });
    connection.onDisconnect.addListener(() => { if (!disposed.current) { port.current = null; setError('Se perdió la conexión con la extensión. Abre GhostPair para iniciar otra sesión.'); } });
    void request('ui.status').then(s => { if (!disposed.current) { stateRef.current = s; setState(s); } }).catch(e => setError(e.message));
    const releaseInput = () => { releaseKeys(); releasePointer(); };
    window.addEventListener('blur', releaseInput);
    window.addEventListener('pagehide', releaseInput);
    return () => { releaseInput(); window.removeEventListener('blur', releaseInput); window.removeEventListener('pagehide', releaseInput); disposed.current = true; connection.disconnect(); port.current = null; };
  }, []);
  useEffect(() => { setAddress(state?.tabs.find(t => t.id === state.activeTabId)?.url ?? ''); }, [state?.activeTabId, state?.tabs.find(t => t.id === state.activeTabId)?.url]);

  const interactive = Boolean(state?.status === 'connected' && state.controlEnabled && !state.paused && hasFrame);
  const modifiers = (event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => Number(event.altKey) | Number(event.ctrlKey) << 1 | Number(event.metaKey) << 2 | Number(event.shiftKey) << 3;
  function coordinates(event: { clientX: number; clientY: number }, clamp = false) {
    const t = target(); const f = frame.current?.meta; const bounds = canvas.current?.getBoundingClientRect();
    if (!t || !f || !bounds?.width || !interactive) return;
    // Input coordinates are viewport CSS pixels; never include the browser toolbar.
    let x = (event.clientX - bounds.left) / bounds.width * f.viewportWidth;
    let y = (event.clientY - bounds.top) / bounds.height * f.viewportHeight - f.offsetTop;
    if (clamp) { x = Math.max(0, Math.min(f.viewportWidth, x)); y = Math.max(0, Math.min(f.viewportHeight, y)); }
    if (x < 0 || y < 0 || x > f.viewportWidth || y > f.viewportHeight) return;
    return { ...t, x, y };
  }
  function text(value: string) { const t = target(); if (t && value && new TextEncoder().encode(value).length <= MAX_CLIPBOARD_BYTES) send({ type: 'text', ...t, text: value }); }
  function pointer(event: React.PointerEvent<HTMLCanvasElement>, kind: 'move' | 'down' | 'up') {
    const point = coordinates(event, kind !== 'down' && Boolean(heldPointer.current)); if (!point) return;
    event.preventDefault();
    if (kind === 'down') { keyboard.current?.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); }
    if (kind === 'down') {
      const previous = lastClick.current;
      const consecutive = performance.now() - previous.time < 500 && previous.button === event.button && Math.hypot(point.x - previous.x, point.y - previous.y) < 5;
      lastClick.current = { time: performance.now(), x: point.x, y: point.y, button: event.button, count: consecutive ? previous.count % 3 + 1 : 1 };
    }
    const button = kind === 'move' && heldPointer.current ? heldPointer.current.button : event.button === 1 ? 'middle' : event.button === 2 ? 'right' : 'left';
    const command: Extract<ControlCommand, { type: 'pointer' }> = { type: 'pointer', ...point, event: kind, button, buttons: event.buttons & 7, clickCount: kind === 'move' ? 0 : lastClick.current.count || 1, modifiers: modifiers(event) };
    if (kind === 'up') heldPointer.current = undefined;
    else if (kind === 'down' || heldPointer.current) heldPointer.current = command;
    send(command);
    if (kind === 'up' && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function key(event: React.KeyboardEvent<HTMLTextAreaElement>, kind: 'down' | 'up') {
    if (event.key === 'Escape') { event.preventDefault(); releaseKeys(); keyboard.current?.blur(); return; }
    const t = target(); if (!t || composing.current || event.nativeEvent.isComposing) return;
    const fields = { key: event.key, code: event.code, keyCode: event.keyCode, modifiers: modifiers(event), repeat: event.repeat };
    if (kind === 'down') heldKeys.current.set(event.code, fields); else heldKeys.current.delete(event.code);
    if (!(event.ctrlKey && event.key.toLowerCase() === 'v')) send({ type: 'key', event: kind, ...t, ...fields });
    // Text and IME are committed once through the textarea input/composition events.
    if (event.key.length > 1 || (event.ctrlKey && !['v', 'c', 'x'].includes(event.key.toLowerCase())) || event.metaKey || event.altKey) event.preventDefault();
  }
  const selected = state?.tabs.find(t => t.id === state.activeTabId);

  if (!state || state.role !== 'guest' || !['connected', 'paused'].includes(state.status)) return <main className="connection-page"><header className="viewer-header"><Brand compact/></header>{state ? <ConnectionPanel state={state} onState={setState} onError={setError}/> : <p>Loading GhostPair…</p>}<Notifications state={state} error={error} onError={setError} floating/></main>;

  return <main className="viewer"><header className="viewer-header"><Brand compact/><div className="viewer-session">{state && <Status state={state}/>}<span className="muted">{state?.connection?.latencyMs !== undefined ? `${Math.round(state.connection.latencyMs)} ms` : 'P2P directo'}</span></div><button className="danger small" onClick={() => { void request('ui.stop').catch(e => setError(e.message)); }}>Desconectar</button></header>
    <div className="remote-tabs" role="tablist" aria-label="Pestañas compartidas">{state?.tabs.map(tab => <div className={`remote-tab ${tab.active ? 'active' : ''}`} key={tab.id}><button role="tab" aria-selected={tab.active} title={tab.url} disabled={!state.controlEnabled || state.paused} onClick={() => send({ type: 'tab.activate', tabId: tab.id })}><span>{tab.supported ? '▤' : '⊘'}</span>{tab.title || 'Sin título'}</button><button aria-label={`Cerrar ${tab.title}`} disabled={!state.controlEnabled || state.paused} onClick={() => send({ type: 'tab.close', tabId: tab.id })}>×</button></div>)}<button className="new-tab" title="Abrir pestaña" aria-label="Abrir pestaña" disabled={!state?.controlEnabled || state.paused || state.status !== 'connected'} onClick={() => { const url = window.prompt('Dirección de la nueva pestaña', 'https://example.com'); if (url) send({ type: 'tab.create', url: url.includes('://') ? url : `https://${url}` }); }}>+</button></div>
    <form className="navigation" onSubmit={e => { e.preventDefault(); const t = target(); if (t) send({ type: 'navigate', ...t, url: address.includes('://') ? address : `https://${address}` }); }}><button type="button" aria-label="Atrás" disabled={!interactive} onClick={() => { const t = target(); if (t) send({ type: 'history', ...t, direction: 'back' }); }}>←</button><button type="button" aria-label="Adelante" disabled={!interactive} onClick={() => { const t = target(); if (t) send({ type: 'history', ...t, direction: 'forward' }); }}>→</button><button type="button" aria-label="Recargar" disabled={!interactive} onClick={() => { const t = target(); if (t) send({ type: 'reload', ...t }); }}>↻</button><input aria-label="Dirección de la página remota" value={address} onChange={e => setAddress(e.target.value)} placeholder="Dirección de la página compartida" disabled={!interactive}/><button type="submit" disabled={!interactive}>Ir ↗</button></form>
    <section className="remote-stage" aria-label="Página remota"><canvas ref={canvas} className={!hasFrame ? 'invisible' : ''} aria-label="Vista de la página compartida" onPointerDown={e => pointer(e, 'down')} onPointerMove={e => pointer(e, 'move')} onPointerUp={e => pointer(e, 'up')} onPointerCancel={releasePointer} onLostPointerCapture={releasePointer} onContextMenu={e => e.preventDefault()} onWheel={e => { const point = coordinates(e); if (point) send({ type: 'wheel', ...point, deltaX: Math.max(-10000, Math.min(10000, e.deltaX)), deltaY: Math.max(-10000, Math.min(10000, e.deltaY)), modifiers: modifiers(e) }); }}/>
      <textarea ref={keyboard} className="keyboard-input" aria-label="Entrada de teclado remoto" autoCapitalize="off" autoComplete="off" spellCheck={false} disabled={!interactive} onFocus={() => setFocused(true)} onBlur={() => { releaseKeys(); setFocused(false); }} onKeyDown={e => key(e, 'down')} onKeyUp={e => key(e, 'up')} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={e => { composing.current = false; text(e.data); e.currentTarget.value = ''; }} onInput={e => { if (!composing.current) { text(e.currentTarget.value); e.currentTarget.value = ''; } }} onPaste={e => { e.preventDefault(); text(e.clipboardData.getData('text/plain')); }}/>
      {(!hasFrame || state?.paused || state?.status !== 'connected') && <div className="stage-overlay"><div className="empty-symbol">◎</div><h1>{state?.paused ? 'La sesión está en pausa.' : selected && !selected.supported ? 'Esta página no se comparte.' : state?.status === 'idle' || state?.status === 'error' ? 'La sesión ha terminado.' : 'Preparando tu espacio.'}</h1><p>{state?.paused ? 'El anfitrión puede reanudarla desde GhostPair.' : selected && !selected.supported ? 'Selecciona una página web de la ventana autorizada.' : state?.status === 'idle' || state?.status === 'error' ? 'Abre el menú de GhostPair para volver a conectarte.' : 'La imagen aparecerá cuando los equipos estén conectados.'}</p></div>}
    </section><footer className="viewer-footer"><span><i className={`connection-dot ${focused ? 'live' : ''}`}/>{focused ? 'Teclado remoto activo · Esc para liberar' : state?.controlEnabled ? 'Haz clic en la página para interactuar' : 'Solo visualización'}</span><span>{state?.clipboardEnabled && state.remoteClipboardEnabled ? 'Portapapeles sincronizado' : 'Portapapeles sin sincronizar'}</span></footer>
    <Notifications state={state} error={error} onError={setError} floating/>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Viewer/>);
