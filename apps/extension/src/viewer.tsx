import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MAX_CLIPBOARD_BYTES, type AppState, type ControlCommand, type Presentation } from '@ghostpair/protocol';
import { Brand, Status, Notifications, request } from './ui';
import { ConnectionPanel } from './connection-panel';
import { NewTabDialog } from './new-tab-dialog';
import { createPeerSession } from './core/peer-session';
import { InputBuffer } from './core/input-buffer';
import './styles.css';

function ViewerIcon({ name, className = '' }: {
  name: 'tab' | 'unavailable' | 'close' | 'add' | 'back' | 'forward' | 'reload' | 'go' | 'waiting' | 'pause';
  className?: string;
}) {
  const icons = {
    tab: <><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M3 7h14M6 5h.01M9 5h.01"/></>,
    unavailable: <><circle cx="10" cy="10" r="7"/><path d="m5 15 10-10"/></>,
    close: <path d="m5 5 10 10M15 5 5 15"/>,
    add: <path d="M10 4v12M4 10h12"/>,
    back: <path d="M16 10H4m6-6-6 6 6 6"/>,
    forward: <path d="M4 10h12m-6-6 6 6-6 6"/>,
    reload: <><path d="M16 6a7 7 0 1 0 1 7M16 2v4h-4"/></>,
    go: <path d="M5 15 15 5M6 5h9v9"/>,
    waiting: <><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/></>,
    pause: <><path d="M7 5v10M13 5v10"/></>,
  };
  return <svg className={`viewer-icon ${className}`.trim()} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{icons[name]}</svg>;
}

function Viewer() {
  const [state, setState] = useState<AppState>();
  const [error, setError] = useState('');
  const [address, setAddress] = useState('');
  const [hasFrame, setHasFrame] = useState(false);
  const [focused, setFocused] = useState(false);
  const [newTabOpen, setNewTabOpen] = useState(false);
  const newTabButton = useRef<HTMLButtonElement>(null);
  const closeNewTab = () => { setNewTabOpen(false); requestAnimationFrame(() => newTabButton.current?.focus()); };
  const port = useRef<chrome.runtime.Port | null>(null);
  const stateRef = useRef<AppState | undefined>(undefined);
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLElement>(null);
  const [area, setArea] = useState({ width: 800, height: 600 });
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const frame = useRef<Presentation | undefined>(undefined);
  const composing = useRef(false);
  const compositionRevision = useRef<number | undefined>(undefined);
  const heldPointer = useRef<Extract<ControlCommand, { type: 'pointer' }> | undefined>(undefined);
  const canceledPointer = useRef(false);
  const peer = useRef<ReturnType<typeof createPeerSession> | undefined>(undefined);
  const [incoming, setIncoming] = useState<{ stream: MediaStream; meta: Presentation }>();
  const [duplicate, setDuplicate] = useState(false);
  const disposed = useRef(false);
  const lastClick = useRef({ time: 0, x: 0, y: 0, button: -1, count: 0 });
  const input = useRef<InputBuffer | null>(null);
  input.current ??= new InputBuffer(transmit);

  function transmit(command: ControlCommand) {
    if (!port.current || !stateRef.current || stateRef.current.status !== 'connected' || stateRef.current.paused || !stateRef.current.controlEnabled) return;
    void peer.current?.handle({ type: 'session.command', command }).then(reply => {
      if (reply?.ok === false) setError(('error' in reply ? reply.error : undefined) ?? 'Could not apply the action.');
    }).catch(e => setError(e.message));
  }
  function send(command: ControlCommand) { input.current!.send(command); }
  function target() {
    const f = frame.current;
    const s = stateRef.current;
    return f && s && f.tabId === s.activeTabId && f.generation === s.generation ? { tabId: f.tabId, generation: f.generation, captureId: f.captureId, documentId: f.documentId, controlRevision: s.controlRevision } : undefined;
  }
  function releaseInput() {
    const original = heldPointer.current ?? target();
    input.current?.discard();
    composing.current = false; compositionRevision.current = undefined; if (keyboard.current) keyboard.current.value = '';
    if (heldPointer.current) canceledPointer.current = true;
    heldPointer.current = undefined;
    lastClick.current.count = 0;
    if (original) send({ type: 'input.release', tabId: original.tabId, captureId: original.captureId, documentId: original.documentId, generation: original.generation, controlRevision: original.controlRevision });
  }
  function applyState(next: AppState) {
    if (stateRef.current?.controlRevision !== next.controlRevision) { releaseInput(); composing.current = false; if (keyboard.current) keyboard.current.value = ''; }
    if (stateRef.current?.sessionId !== next.sessionId || stateRef.current?.generation !== next.generation || stateRef.current?.activeTabId !== next.activeTabId || next.status !== 'connected') {
      releaseInput(); frame.current = undefined; setHasFrame(false);
    }
    if (stateRef.current?.controlEnabled && !next.controlEnabled) releaseInput();
    stateRef.current = next; setState(next);
  }
  useEffect(() => {
    disposed.current = false;
    const dispatch = (message: Record<string, unknown>) => chrome.runtime.sendMessage({ target: 'background', ...message });
    const clipboard = {
      read: async () => { const reply = await dispatch({ type: 'ui.clipboard.read' }); if (!reply?.ok) throw new Error(reply?.error); return String(reply.text); },
      write: async (text: string) => { const reply = await dispatch({ type: 'ui.clipboard.write', text }); if (!reply?.ok) throw new Error(reply?.error); },
    };
    peer.current = createPeerSession((type, payload = {}) => { void dispatch({ type, ...payload }).catch(() => undefined); }, dispatch, clipboard, {
      stream: (stream, meta) => { releaseInput(); frame.current = undefined; setHasFrame(false); setIncoming(stream && meta ? { stream, meta } : undefined); },
    });
    let retry: ReturnType<typeof setTimeout> | undefined;
    function connectPort() {
      if (disposed.current) return;
      const connection = chrome.runtime.connect({ name: 'viewer' }); port.current = connection;
      connection.onMessage.addListener(message => {
        if (message.type === 'state') applyState(message.state);
        if (message.type === 'viewer.duplicate') { setDuplicate(true); peer.current?.stop(); }
        if (message.type === 'transport.request') {
          void peer.current!.handle(message.message).then(reply => connection.postMessage({ type: 'transport.reply', requestId: message.requestId, reply })).catch(error => {
            try { connection.postMessage({ type: 'transport.reply', requestId: message.requestId, reply: { ok: false, error: error.message } }); } catch { /* viewer closed */ }
          });
        }
      });
      connection.onDisconnect.addListener(() => {
        if (disposed.current) return;
        releaseInput();
        port.current = null; peer.current?.stop('The viewer lost its extension connection.');
        setError('The extension connection was interrupted. Start a new session.');
        retry = setTimeout(connectPort, 500);
      });
      void request('ui.status').then(applyState).catch(e => setError(e.message));
    }
    connectPort();
    const refresh = setInterval(() => { void request('ui.status').then(applyState).catch(() => undefined); }, 15000);
    const leave = () => { releaseInput(); peer.current?.stop('The connection page closed.'); };
    const visibility = () => { if (document.hidden) releaseInput(); };
    window.addEventListener('blur', releaseInput); window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', visibility);
    return () => { disposed.current = true; clearTimeout(retry); clearInterval(refresh); leave(); window.removeEventListener('blur', releaseInput); window.removeEventListener('pagehide', leave); document.removeEventListener('visibilitychange', visibility); port.current?.disconnect(); port.current = null; };
  }, []);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = incoming?.stream ?? null;
    if (!incoming || state?.status !== 'connected') return;
    const { stream, meta } = incoming;
    let canceled = false;
    const callback = element.requestVideoFrameCallback(() => {
      const current = stateRef.current;
      if (canceled || element.srcObject !== stream || !current?.presentation || current.status !== 'connected' || current.generation !== meta.generation || current.presentation.captureId !== meta.captureId || current.presentation.documentId !== meta.documentId) return;
      frame.current = meta; setHasFrame(true);
    });
    void element.play().catch(error => { if (!canceled) setError(`Could not play the shared video: ${error.message}`); });
    return () => { canceled = true; element.cancelVideoFrameCallback(callback); };
  }, [incoming, state?.status, state?.generation, state?.controlEnabled]);
  useEffect(() => { setAddress(state?.tabs.find(t => t.id === state.activeTabId)?.url ?? ''); }, [state?.activeTabId, state?.tabs.find(t => t.id === state.activeTabId)?.url]);
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(entries => { const box = entries[0]?.contentRect; if (box) setArea({ width: box.width, height: box.height }); });
    observer.observe(stage.current); return () => observer.disconnect();
  }, [state?.status]);
  const aspect = state?.presentation ? state.presentation.viewportWidth / state.presentation.viewportHeight : 16 / 9;
  const videoWidth = Math.min(area.width, area.height * aspect);

  const interactive = Boolean(state?.status === 'connected' && state.controlEnabled && !state.paused && hasFrame);
  useEffect(() => { if (state?.status !== 'connected' || state.paused || !state.controlEnabled) setNewTabOpen(false); }, [state?.status, state?.paused, state?.controlEnabled]);
  const modifiers = (event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => Number(event.altKey) | Number(event.ctrlKey) << 1 | Number(event.metaKey) << 2 | Number(event.shiftKey) << 3;
  function coordinates(event: { clientX: number; clientY: number }, clamp = false) {
    const t = target(); const f = frame.current; const bounds = video.current?.getBoundingClientRect();
    if (!t || !f || !bounds?.width || !interactive) return;
    // Input coordinates are viewport CSS pixels; never include the browser toolbar.
    let x = (event.clientX - bounds.left) / bounds.width * (f.viewportWidth / f.scale) + f.offsetLeft;
    let y = (event.clientY - bounds.top) / bounds.height * (f.viewportHeight / f.scale) + f.offsetTop;
    if (clamp) { x = Math.max(0, Math.min(f.viewportWidth, x)); y = Math.max(0, Math.min(f.viewportHeight, y)); }
    if (x < 0 || y < 0 || x > f.viewportWidth || y > f.viewportHeight) return;
    return { ...t, x, y };
  }
  function text(value: string) { const t = target(); if (t && value && new TextEncoder().encode(value).length <= MAX_CLIPBOARD_BYTES) send({ type: 'text', ...t, text: value }); }
  function pointer(event: React.PointerEvent<HTMLVideoElement>, kind: 'move' | 'down' | 'up') {
    if (kind === 'down') canceledPointer.current = false;
    else if (canceledPointer.current) { if (kind === 'up') canceledPointer.current = false; return; }
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
    if (event.key === 'Escape') { event.preventDefault(); releaseInput(); keyboard.current?.blur(); return; }
    const t = target(); if (!t || composing.current || event.nativeEvent.isComposing) return;
    const fields = { key: event.key, code: event.code, keyCode: event.keyCode, modifiers: modifiers(event), repeat: event.repeat };
    if (!(event.ctrlKey && event.key.toLowerCase() === 'v')) send({ type: 'key', event: kind, ...t, ...fields });
    // Text and IME are committed once through the textarea input/composition events.
    if (event.key.length > 1 || (event.ctrlKey && !['v', 'c', 'x'].includes(event.key.toLowerCase())) || event.metaKey || event.altKey) event.preventDefault();
  }
  const selected = state?.tabs.find(t => t.id === state.activeTabId);
  if (duplicate) return <main className="connection-page"><header className="viewer-header"><Brand compact/></header><section className="connection-panel"><h1>Your session page is already open.</h1><button className="primary" onClick={() => void request('ui.viewer.open')}>Open session page</button></section></main>;

  if (!state || state.role !== 'guest' || !['connected', 'paused'].includes(state.status)) return <main className="connection-page"><header className="viewer-header"><Brand compact/></header>{state ? <ConnectionPanel state={state} onState={applyState} onError={setError}/> : <p>Loading GhostPair…</p>}<Notifications state={state} error={error} onError={setError} floating/></main>;

  return <main className="viewer"><header className="viewer-header"><Brand compact/><div className="viewer-session">{state && <Status state={state}/>}<span className="control-mode" title={state.controlMode === 'visual' ? 'Clicks and typing are previews. Scrolling, navigation and tab management still change the shared page.' : 'Your actions change the shared page.'}>{state.controlMode === 'visual' ? 'Preview mode' : 'Control mode'}</span></div><button className="danger small" onClick={() => { void request('ui.stop').catch(e => setError(e.message)); }}>Leave session</button></header>
    <div className="remote-tabs" role="tablist" aria-label="Shared tabs">{state?.tabs.map(tab => <div className={`remote-tab ${tab.active ? 'active' : ''}`} key={tab.id}><button role="tab" aria-selected={tab.active} title={tab.url} disabled={!state.controlEnabled || state.paused} onClick={() => send({ type: 'tab.activate', tabId: tab.id, controlRevision: state.controlRevision })}><span><ViewerIcon name={tab.supported ? 'tab' : 'unavailable'}/></span>{tab.title || 'Untitled tab'}{!tab.authorized && <small> · {tab.supported ? 'Waiting for permission' : "This tab can't be shared"}</small>}</button><button aria-label={`Close ${tab.title || 'untitled tab'}`} disabled={!state.controlEnabled || state.paused} onClick={() => send({ type: 'tab.close', tabId: tab.id, controlRevision: state.controlRevision })}><ViewerIcon name="close"/></button></div>)}<button ref={newTabButton} className="new-tab" title="Open tab" aria-label="Open tab" disabled={!state?.controlEnabled || state.paused || state.status !== 'connected'} onClick={() => setNewTabOpen(true)}><ViewerIcon name="add"/></button></div>{newTabOpen && <NewTabDialog onClose={closeNewTab} controlRevision={state.controlRevision}/>}
    <form className="navigation" onSubmit={e => { e.preventDefault(); const t = target(); if (t) send({ type: 'navigate', ...t, url: address.includes('://') ? address : `https://${address}` }); }}><button type="button" aria-label="Back" disabled={!interactive} onClick={() => { const t = target(); if (t) send({ type: 'history', ...t, direction: 'back' }); }}><ViewerIcon name="back"/></button><button type="button" aria-label="Forward" disabled={!interactive} onClick={() => { const t = target(); if (t) send({ type: 'history', ...t, direction: 'forward' }); }}><ViewerIcon name="forward"/></button><button type="button" aria-label="Reload" disabled={!interactive} onClick={() => { const t = target(); if (t) send({ type: 'reload', ...t }); }}><ViewerIcon name="reload"/></button><input aria-label="Remote page address" value={address} onChange={e => setAddress(e.target.value)} placeholder="Shared page address" disabled={!interactive}/><button type="submit" disabled={!interactive}>Go <ViewerIcon name="go"/></button></form>
    <section ref={stage} className="remote-stage" aria-label="Remote page"><video ref={video} style={{ width: videoWidth, height: videoWidth / aspect, objectFit: 'cover' }} autoPlay muted playsInline data-generation={hasFrame ? frame.current?.generation : undefined} className={!hasFrame ? 'invisible' : ''} aria-label="Shared page video" onPointerDown={e => pointer(e, 'down')} onPointerMove={e => pointer(e, 'move')} onPointerUp={e => pointer(e, 'up')} onPointerCancel={releaseInput} onLostPointerCapture={() => { if (heldPointer.current) releaseInput(); }} onContextMenu={e => e.preventDefault()} onWheel={e => { const point = coordinates(e); if (point) send({ type: 'wheel', ...point, deltaX: Math.max(-10000, Math.min(10000, e.deltaX)), deltaY: Math.max(-10000, Math.min(10000, e.deltaY)), modifiers: modifiers(e) }); }}/>
      <textarea ref={keyboard} className="keyboard-input" aria-label="Remote keyboard input" autoCapitalize="off" autoComplete="off" spellCheck={false} disabled={!interactive} onFocus={() => setFocused(true)} onBlur={() => { releaseInput(); setFocused(false); }} onKeyDown={e => key(e, 'down')} onKeyUp={e => key(e, 'up')} onCompositionStart={() => { composing.current = true; compositionRevision.current = stateRef.current?.controlRevision; }} onCompositionEnd={e => { const valid = composing.current && compositionRevision.current === stateRef.current?.controlRevision; composing.current = false; compositionRevision.current = undefined; if (valid) text(e.data); e.currentTarget.value = ''; }} onInput={e => { if (!composing.current && !(e.nativeEvent as InputEvent).isComposing && !(e.nativeEvent as InputEvent).inputType?.includes('Composition')) { text(e.currentTarget.value); e.currentTarget.value = ''; } }} onPaste={e => { e.preventDefault(); text(e.clipboardData.getData('text/plain')); }}/>
      {(!hasFrame || state?.paused || state?.status !== 'connected') && <div className="stage-overlay"><div className="empty-symbol"><ViewerIcon className="stage-icon" name={state?.paused ? 'pause' : selected && !selected.supported ? 'unavailable' : 'waiting'}/></div><h1>{state?.paused ? 'The session is paused.' : selected && !selected.supported ? "This tab can't be shared." : state?.status === 'idle' || state?.status === 'error' ? 'The session ended.' : 'Preparing your shared view.'}</h1><p>{state?.paused ? 'The person sharing can resume the session from GhostPair.' : selected && !selected.supported ? 'Ask the person sharing to choose another web page.' : state?.status === 'idle' || state?.status === 'error' ? 'Use the connection form to join again.' : selected && !selected.authorized ? 'The person sharing needs to allow this tab before you can see it.' : 'Waiting for the shared view to load.'}</p></div>}
    </section><footer className="viewer-footer"><span><i className={`connection-dot ${focused ? 'live' : ''}`}/>{focused ? 'Typing on the shared page · Esc to stop' : state?.controlEnabled ? 'Click the page to interact' : 'View only'}</span><span>{state?.clipboardEnabled && state.remoteClipboardEnabled ? 'Clipboard sharing on' : 'Clipboard sharing off'}</span></footer>
    <Notifications state={state} error={error} onError={setError} floating/>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Viewer/>);
