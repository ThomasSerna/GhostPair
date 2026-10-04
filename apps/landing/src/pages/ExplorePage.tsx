import { useEffect, useReducer, useRef, useState, type CSSProperties, type Dispatch } from 'react';
import { activeTab, canInteract, canManage, catalog, chapters, clipboardActive, DEMO_CODE, DEMO_PASSWORD, initialState, previewFor, reducer, type Action, type Chapter, type DemoState, type Field, type Preferences } from './explore/model';
import './explore.css';

type IconName = 'arrow' | 'back' | 'forward' | 'reload' | 'plus' | 'close' | 'lock' | 'pause' | 'play' | 'drag';
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = { arrow: 'M4 12h16m-6-6 6 6-6 6', back: 'm14 6-6 6 6 6', forward: 'm10 6 6 6-6 6', reload: 'M20 7v5h-5M19 12a7 7 0 1 0-2 5M20 7l-3-2', plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M18 6 6 18', lock: 'M7 10V7a5 5 0 0 1 10 0v3M6 10h12v11H6z', pause: 'M8 5v14M16 5v14', play: 'm8 5 11 7-11 7z', drag: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01' };
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
const now = () => Date.now();
const shown = (value: string | boolean) => typeof value === 'boolean' ? value ? 'On' : 'Off' : value;

function Feedback({ state, dispatch }: { state: DemoState; dispatch: Dispatch<Action> }) {
  const p = state.preferences;
  function update(value: Partial<Preferences>) { dispatch({ type: 'preference', preferences: { ...p, ...value }, now: now() }); }
  return <details className="ex-feedback" open={undefined}>
    <summary>Interaction feedback <span>Appearance & lifetime</span></summary>
    <div className="ex-feedback-inner">
      <label className="ex-check"><input type="checkbox" checked={p.showActions} onChange={e => update({ showActions: e.target.checked })}/>Show their actions</label>
      <label className="ex-check"><input type="checkbox" checked={p.clicks} onChange={e => update({ clicks: e.target.checked })}/>Show where they click</label>
      <label className="ex-check"><input type="checkbox" checked={p.notices} onChange={e => update({ notices: e.target.checked })}/>Visual notices</label>
      {(['text', 'other'] as const).map(category => <fieldset key={category}><legend>{category === 'text' ? 'Text previews' : 'Other previews'}</legend>
        <label>Keep previews<select aria-label={`${category === 'text' ? 'Text' : 'Other'} preview lifetime`} value={p[category].persistent ? 'persistent' : 'temporary'} onChange={e => update({ [category]: { ...p[category], persistent: e.target.value === 'persistent' } })}><option value="temporary">For a short time</option><option value="persistent">Until cleared</option></select></label>
        {!p[category].persistent && <label>Seconds without activity<input aria-label={`${category === 'text' ? 'Text' : 'Other'} preview seconds`} type="number" min="0.1" max="10" step="0.1" value={p[category].seconds} onChange={e => { if (Number.isFinite(e.target.valueAsNumber)) update({ [category]: { ...p[category], seconds: e.target.valueAsNumber } }); }}/></label>}
      </fieldset>)}
      <fieldset className="ex-colors"><legend>Interaction color</legend><div>{[['Purple', '#7871e8'], ['Blue', '#3b82f6'], ['Green', '#22c55e'], ['Orange', '#f97316'], ['Pink', '#ec4899']].map(([label, color]) => <button key={color} aria-label={`${label} interaction color`} aria-pressed={p.color === color} title={label} style={{ '--swatch': color } as CSSProperties} onClick={() => update({ color })}><span/></button>)}<label>Custom<input aria-label="Custom interaction color" type="color" value={p.color} onChange={e => update({ color: e.target.value })}/></label></div></fieldset>
      <p className="ex-small">Lifetimes are independent. Both default to 0.5 seconds; choose 0.1–10 seconds or Until cleared.</p>
      <button className="ex-button ex-secondary" disabled={state.mode !== 'preview'} onClick={() => dispatch({ type: 'clear' })}>Clear previews</button>
    </div>
  </details>;
}

function PreviewEditor({ state, dispatch }: { state: DemoState; dispatch: Dispatch<Action> }) {
  const [target, setTarget] = useState<Field>('notes');
  const previews = state.previews.filter(p => p.tabId === state.activeId && p.category === 'text');
  return <details className="ex-feedback ex-preview-editor" open={previews.length > 0 || undefined}>
    <summary>Edit preview text <span>Host only</span></summary>
    <div className="ex-feedback-inner">
      {!previews.length ? <p className="ex-small">Type on the guest’s page to create a preview. Select Until cleared under Interaction feedback to keep it while editing.</p> : previews.map(p => <div className="ex-edit-row" key={p.field}>
        <label>{p.field[0]!.toUpperCase() + p.field.slice(1)} preview<input aria-label={`Edit ${p.field} preview`} data-testid={`edit-preview-${p.field}`} type={p.field === 'password' ? 'password' : 'text'} value={String(p.value)} disabled={state.paused} onChange={e => dispatch({ type: 'edit-preview', field: p.field, value: e.target.value, now: now() })}/></label>
        {p.field !== 'password' && <div className="ex-edit-actions"><span className="ex-drag-text" draggable={!state.paused} title="Drag onto a compatible guest text field. Hold Ctrl or Command to copy." onDragStart={e => { e.dataTransfer.setData('application/x-ghostpair-demo', p.field); e.dataTransfer.effectAllowed = 'copyMove'; }}>Drag text <Icon name="drag"/></span><button disabled={state.paused} className="ex-text-button" onClick={() => dispatch({ type: 'transfer', source: p.field, target, copy: false, now: now() })}>Move</button><button disabled={state.paused} className="ex-text-button" onClick={() => dispatch({ type: 'transfer', source: p.field, target, copy: true, now: now() })}>Copy</button></div>}
        {p.field === 'password' && <p className="ex-small">Password text stays masked and cannot be copied or dragged.</p>}
      </div>)}
      {!!previews.length && <label>Move or copy into<select aria-label="Preview destination" value={target} onChange={e => setTarget(e.target.value as Field)}><option value="notes">Notes</option><option value="name">Name</option><option value="email">Email</option></select></label>}
      {!!previews.length && <p className="ex-small">Move and Copy work with keyboard or touch. Drag onto a guest field to move; hold Ctrl or Command to copy. Original values remain intact.</p>}
    </div>
  </details>;
}

function Connection({ state, dispatch }: { state: DemoState; dispatch: Dispatch<Action> }) {
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState(DEMO_CODE);
  const [guestPassword, setGuestPassword] = useState(DEMO_PASSWORD);
  const [networkFailure, setNetworkFailure] = useState(false);
  return <div className="ex-connect-grid">
    <section className="ex-setup"><div className="ex-person"><span className="ex-person-number">H</span><div><strong>Host</strong><span>You decide what to share</span></div></div>
      {state.status === 'capture' ? <div className="ex-capture"><Icon name="lock"/><h3>Share this example tab?</h3><p>This represents the browser’s capture authorization. No capture permission is requested here.</p><div className="ex-actions"><button className="ex-button" onClick={() => dispatch({ type: 'capture', granted: true })}>Allow example capture</button><button className="ex-text-button" onClick={() => dispatch({ type: 'capture', granted: false })}>Decline</button></div></div> : state.status === 'waiting' ? <div className="ex-waiting"><span className="ex-live-dot"/><h3>Waiting for your guest.</h3><p>Share this example code and the password you chose.</p><code>{DEMO_CODE}</code><p className="ex-small">Example password: <strong>{state.password}</strong></p><button className="ex-text-button" onClick={() => dispatch({ type: 'cancel' })}>Cancel setup</button></div> : <form noValidate onSubmit={e => { e.preventDefault(); dispatch({ type: 'start', password, consent }); }}>
        <h3>Share your tab</h3><label>Session password<input data-testid="session-password" type="password" minLength={8} maxLength={256} value={password} onChange={e => setPassword(e.target.value)}/></label><p className="ex-small">8–256 characters. Only for this session.</p>
        <label className="ex-check ex-consent"><input data-testid="share-consent" type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/><span>I allow the person with my code and password to view and interact with this tab, and manage tabs in this window. I’ll approve each additional tab.</span></label>
        <button className="ex-button" type="submit">Share this tab <Icon name="arrow"/></button><button className="ex-text-button" type="button" onClick={() => { setConsent(false); dispatch({ type: 'cancel' }); }}>Cancel</button>
      </form>}
    </section>
    <section className="ex-setup"><div className="ex-person"><span className="ex-person-number ex-guest-number">G</span><div><strong>Guest</strong><span>An invitation to browse together</span></div></div><form noValidate onSubmit={e => { e.preventDefault(); dispatch({ type: 'join', code, password: guestPassword, networkFailure }); setGuestPassword(''); }}>
      <h3>Join a session.</h3><label>Connection code<input data-testid="join-code" value={code} onChange={e => setCode(e.target.value)} spellCheck={false}/></label><label>Session password<input data-testid="join-password" type="password" value={guestPassword} onChange={e => setGuestPassword(e.target.value)}/></label><label className="ex-check"><input type="checkbox" checked={networkFailure} onChange={e => setNetworkFailure(e.target.checked)}/><span>Try a network with no direct route</span></label><button className="ex-button" type="submit">Join example session <Icon name="arrow"/></button><p className="ex-small">Try a different code or password to see an error, then correct it and join.</p>
    </form></section>
  </div>;
}

function ExamplePage({ state, dispatch, side }: { state: DemoState; dispatch: Dispatch<Action>; side: 'host' | 'guest' }) {
  const tab = activeTab(state), page = catalog.find(p => p.id === tab.history[tab.index])!;
  const interactive = side === 'guest' && canInteract(state);
  const scrollRef = useRef<HTMLDivElement>(null);
  const guestBlocked = side === 'guest' && (state.paused || !tab.approved || !tab.supported || state.status !== 'connected');
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const syncScroll = () => {
      if (!scroller.clientHeight) return;
      const target = (scroller.scrollHeight - scroller.clientHeight) * tab.scroll / 100;
      if (Math.abs(scroller.scrollTop - target) > 2) scroller.scrollTop = target;
    };
    syncScroll();
    const resize = new ResizeObserver(syncScroll);
    resize.observe(scroller);
    return () => resize.disconnect();
  }, [tab.scroll, tab.id, tab.index, guestBlocked, tab.supported]);
  if (guestBlocked) return <div className="ex-view-blocked" data-testid="guest-withheld"><Icon name={state.paused ? 'pause' : 'lock'}/><h3>{state.paused ? 'A moment to pause.' : state.status !== 'connected' ? 'The session has ended.' : !tab.supported ? 'This tab can’t be shared.' : 'Waiting for the host.'}</h3><p>{state.paused ? 'The shared view and clipboard updates are suspended. The host can resume when ready.' : state.status !== 'connected' ? 'Reset the demo to browse together again.' : !tab.supported ? 'Browser internals aren’t regular web pages. Open a supported example page.' : 'Only an active, approved tab is visible. Choose Share this tab on the host side.'}</p></div>;
  if (!tab.supported) return <div className="ex-view-blocked"><Icon name="lock"/><h3>Browser settings</h3><p>This represents an internal browser page on the host’s device. It stays outside the shared view. Open a regular example tab to continue.</p></div>;
  function change(field: Field, value: string | boolean) { dispatch({ type: 'field', field, value, now: now() }); }
  function dragTarget(field: Field, e: React.DragEvent) { if (interactive && e.dataTransfer.types.includes('application/x-ghostpair-demo') && field !== 'password') { e.preventDefault(); e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? 'copy' : 'move'; } }
  function drop(field: Field, e: React.DragEvent) { if (!interactive) return; e.preventDefault(); const source = e.dataTransfer.getData('application/x-ghostpair-demo') as Field; dispatch({ type: 'transfer', source, target: field, copy: e.ctrlKey || e.metaKey, now: now() }); }
  function textInput(field: 'name' | 'email' | 'password' | 'notes', label: string) {
    const preview = state.preferences.showActions ? previewFor(state, field) : undefined;
    const value = String(preview?.value ?? tab.form[field]);
    const props = { id: `${side}-${field}`, 'data-testid': `${side}-${field}`, 'data-original': tab.form[field], value, readOnly: side === 'host', disabled: side === 'guest' && !interactive, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(field, e.target.value), onDragOver: (e: React.DragEvent) => dragTarget(field, e), onDrop: (e: React.DragEvent) => drop(field, e) };
    return <label className={`ex-example-field${preview ? ' ex-has-preview' : ''}`} key={field} htmlFor={`${side}-${field}`}><span>{label}{preview && <em>Preview</em>}</span>{field === 'notes' ? <textarea {...props} rows={3}/> : <input {...props} type={field === 'password' ? 'password' : field === 'email' ? 'email' : 'text'} autoComplete="off"/>}{preview && <small data-testid={`${side}-${field}-original`}>Original: {field === 'password' ? tab.form[field] ? '••••••••' : '(empty)' : tab.form[field] || '(empty)'}</small>}</label>;
  }
  const notifyPreview = state.preferences.showActions ? previewFor(state, 'notify') : undefined, pacePreview = state.preferences.showActions ? previewFor(state, 'pace') : undefined, buttonPreview = state.preferences.showActions ? previewFor(state, 'submit') : undefined;
  return <div className="ex-example-scroll" ref={scrollRef} data-testid={`${side}-page-scroll`} tabIndex={0} aria-label={`${side === 'host' ? 'Host' : 'Guest'} example page`} onScroll={e => { const el = e.currentTarget; if ((side === 'host' || canInteract(state)) && el.clientHeight > 0 && el.scrollHeight > el.clientHeight) { const position = el.scrollTop / (el.scrollHeight - el.clientHeight) * 100; if (Math.abs(position - tab.scroll) > .7) dispatch({ type: 'scroll', position, actor: side }); } }}>
    <div className="ex-example-content"><div className="ex-example-masthead"><strong>fieldnotes<span>®</span></strong><span>Little plans. Good company.</span></div><div className="ex-example-banner"><strong>Your weekend,<br/>in good company.</strong><span>Saturday<br/>+ Sunday</span></div><h3>{page.heading}</h3><p className="ex-example-description">{page.description}</p>
      <form noValidate onSubmit={e => { e.preventDefault(); if (interactive) change('submit', true); }}>
        <div className="ex-example-form-grid">{textInput('name', 'Your name')}{textInput('email', 'Email')}</div>{textInput('notes', 'A note for the trip')}{textInput('password', 'Private reminder')}
        <label className={`ex-example-check${notifyPreview ? ' ex-has-preview' : ''}`}><input data-testid={`${side}-notify`} type="checkbox" checked={Boolean(notifyPreview?.value ?? tab.form.notify)} disabled={!interactive} onChange={e => change('notify', e.target.checked)}/><span>Send a packing reminder{notifyPreview && <em>Preview · original {shown(tab.form.notify)}</em>}</span>{state.click?.field === 'notify' && <i className="ex-click-ring"/>}</label>
        <fieldset className={`ex-example-radio${pacePreview ? ' ex-has-preview' : ''}`}><legend>Choose your pace{pacePreview && <em>Preview · original {tab.form.pace}</em>}</legend>{[['slow', 'Take it slow'], ['explore', 'See it all']].map(([value, label]) => <label key={value}><input type="radio" name={`${side}-pace`} checked={(pacePreview?.value ?? tab.form.pace) === value} disabled={!interactive} onChange={() => change('pace', value)}/>{label}</label>)}{state.click?.field === 'pace' && <i className="ex-click-ring"/>}</fieldset>
        <button data-testid={`${side}-submit`} className={`ex-save-plan${buttonPreview ? ' ex-has-preview' : ''}`} type="submit" disabled={!interactive}>{buttonPreview ? 'Preview: Save plan' : 'Save plan'}<Icon name="arrow"/>{state.click?.field === 'submit' && <i className="ex-click-ring"/>}</button>
        {tab.form.submit && <p className="ex-plan-saved" data-testid={`${side}-plan-saved`}>Plan saved. See you by the water.</p>}{buttonPreview && <p className="ex-example-original">Preview only. This form has not been submitted.</p>}
      </form><div className="ex-example-bottom"><span>01—03</span><p>Leave a little room for the unexpected.</p></div>
    </div>
  </div>;
}

function BrowserFrame({ state, dispatch, side }: { state: DemoState; dispatch: Dispatch<Action>; side: 'host' | 'guest' }) {
  const tab = activeTab(state), page = catalog.find(p => p.id === tab.history[tab.index])!;
  const [address, setAddress] = useState(page.address as string);
  useEffect(() => setAddress(tab.supported ? page.address : 'chrome://extensions'), [page.address, tab.id, tab.supported]);
  const allowed = side === 'host' || canManage(state), navigationAllowed = side === 'host' || canInteract(state);
  function navigate(e: React.FormEvent) { e.preventDefault(); const destination = catalog.find(p => p.address === address || p.id === address || p.address.replace('https://', '') === address.replace(/\/$/, '')); if (destination) dispatch({ type: 'navigate', page: destination.id, actor: side }); else dispatch({ type: 'notice', text: 'This local demo includes /trip, /checklist, and /notes at example.ghostpair.test. Other addresses are not opened or fetched.' }); }
  return <div className="ex-browser-frame">
    <div className="ex-tab-strip" aria-label={`${side} example tabs`}>{state.tabs.map(t => <div className={`ex-browser-tab${t.id === state.activeId ? ' ex-active-tab' : ''}`} key={t.id}><button disabled={!allowed} onClick={() => dispatch({ type: 'activate', id: t.id, actor: side })} aria-pressed={t.id === state.activeId}><span className={t.approved ? 'ex-tab-approved' : 'ex-tab-pending'} aria-label={t.approved ? 'Approved' : 'Not shared'}/><span>{t.supported ? catalog.find(p => p.id === t.history[t.index])!.title : 'Browser settings'}</span></button><button className="ex-tab-close" disabled={!allowed} aria-label={`Close ${t.supported ? catalog.find(p => p.id === t.history[t.index])!.title : 'browser settings'} tab ${t.id}`} onClick={() => dispatch({ type: 'close', id: t.id, actor: side })}><Icon name="close"/></button></div>)}<button className="ex-new-tab" data-testid={`${side}-new-tab`} disabled={!allowed} aria-label={`Open a new ${side} example tab`} onClick={() => dispatch({ type: 'open', page: 'checklist', actor: side })}><Icon name="plus"/></button></div>
    <form className="ex-browser-toolbar" onSubmit={navigate}><button type="button" aria-label={`${side} go back`} disabled={!navigationAllowed || tab.index === 0} onClick={() => dispatch({ type: 'history', direction: -1, actor: side })}><Icon name="back"/></button><button type="button" aria-label={`${side} go forward`} disabled={!navigationAllowed || tab.index >= tab.history.length - 1} onClick={() => dispatch({ type: 'history', direction: 1, actor: side })}><Icon name="forward"/></button><button type="button" aria-label={`${side} reload example page`} disabled={!navigationAllowed} onClick={() => dispatch({ type: 'reload', actor: side })}><Icon name="reload"/></button><label><Icon name="lock"/><input aria-label={`${side} example address`} data-testid={`${side}-address`} value={address} disabled={!navigationAllowed} spellCheck={false} onChange={e => setAddress(e.target.value)}/></label><button type="submit" disabled={!navigationAllowed} aria-label={`Open ${side} example address`}><Icon name="arrow"/></button></form>
    <ExamplePage state={state} dispatch={dispatch} side={side}/>
    <div className="ex-browser-bottom"><span>{side === 'host' ? 'Original page + visible previews' : state.control ? 'Click the page to interact' : 'View only'}</span><label>Scroll <input aria-label={`${side} shared page scroll`} type="range" min={0} max={100} value={tab.scroll} disabled={side === 'guest' && !canInteract(state)} onChange={e => dispatch({ type: 'scroll', position: Number(e.target.value), actor: side })}/></label></div>
  </div>;
}

function HostControls({ state, dispatch }: { state: DemoState; dispatch: Dispatch<Action> }) {
  const tab = activeTab(state), running = state.status === 'connected';
  return <div className="ex-host-controls">
    <div className="ex-controls-heading"><h3>Sharing session</h3><span>{state.tabs.filter(t => t.approved).length}/5 tabs approved</span></div>
    <div className="ex-session-settings"><label>Interaction mode<select data-testid="interaction-mode" value={state.mode} disabled={!running} onChange={e => dispatch({ type: 'mode', mode: e.target.value as DemoState['mode'] })}><option value="preview">Preview changes</option><option value="full">Full control</option></select></label><label className="ex-check"><input data-testid="allow-control" type="checkbox" checked={state.control} disabled={!running} onChange={() => dispatch({ type: 'control' })}/><span>Let them control the page</span></label></div>
    <p className="ex-small">{state.mode === 'preview' ? 'Clicks and typing are previews. Scrolling, navigation and tab management still affect the page.' : 'Clicks and typing change the example page. Navigation and tab management also affect it.'}</p>
    <div className="ex-shared-tab-row"><span><i className={tab.approved ? 'ex-tab-approved' : 'ex-tab-pending'}/>{!tab.supported ? 'This tab can’t be shared' : tab.approved ? 'Active · Shared' : 'Active · Waiting for approval'}</span>{tab.approved ? <button className="ex-text-button" disabled={!running} onClick={() => dispatch({ type: 'release', id: tab.id })}>Stop sharing tab</button> : <button className="ex-button ex-secondary" data-testid="share-active-tab" disabled={!running || !tab.supported} onClick={() => dispatch({ type: 'approve', id: tab.id })}>Share this tab</button>}</div>
    <div className="ex-actions"><button data-testid="pause-session" className="ex-button ex-secondary" disabled={!running} onClick={() => dispatch({ type: 'pause' })}><Icon name={state.paused ? 'play' : 'pause'}/>{state.paused ? 'Resume session' : 'Pause session'}</button><button className="ex-text-button ex-end-session" disabled={!running} onClick={() => dispatch({ type: 'end' })}>End session</button><button className="ex-text-button" disabled={!running} onClick={() => dispatch({ type: 'panel' })}>{state.panelVisible ? 'Hide page controls' : 'Restore page controls'}</button></div>
    <Feedback state={state} dispatch={dispatch}/><PreviewEditor state={state} dispatch={dispatch}/>
  </div>;
}

function Clipboard({ state, dispatch }: { state: DemoState; dispatch: Dispatch<Action> }) {
  const [hostText, setHostText] = useState('Meet at the lake at nine.');
  const [guestText, setGuestText] = useState('I’ll bring the picnic.');
  return <section className="ex-clipboard" id="clipboard-example"><div className="ex-module-heading"><div><h2>A little text, shared.</h2><p>These buffers simulate two clipboards. Enabling sharing never sends their existing contents.</p></div><span className={`ex-state-tag${clipboardActive(state) ? ' ex-tag-live' : ''}`}>{state.paused ? 'Suspended while paused' : clipboardActive(state) ? 'Sharing new text' : 'Sharing off'}</span></div><div className="ex-clipboard-grid">{(['host', 'guest'] as const).map(side => <div className="ex-clipboard-side" key={side}><div className="ex-clipboard-side-heading"><h3>{side === 'host' ? 'Host' : 'Guest'} example clipboard</h3><label className="ex-check"><input data-testid={`${side}-clipboard`} type="checkbox" checked={side === 'host' ? state.hostClipboard : state.guestClipboard} disabled={state.status !== 'connected'} onChange={e => dispatch({ type: 'clipboard-switch', side, enabled: e.target.checked })}/>Share clipboard</label></div><div className="ex-buffer" data-testid={`${side}-buffer`}><span>Current example buffer</span><p>{side === 'host' ? state.hostBuffer : state.guestBuffer || '(empty)'}</p></div><label>Text to copy next<input aria-label={`${side} next example clipboard text`} value={side === 'host' ? hostText : guestText} onChange={e => side === 'host' ? setHostText(e.target.value) : setGuestText(e.target.value)}/></label><button data-testid={`${side}-copy`} className="ex-button ex-secondary" disabled={state.status !== 'connected'} onClick={() => dispatch({ type: 'copy-text', side, text: side === 'host' ? hostText : guestText })}>Copy new text <Icon name="arrow"/></button></div>)}</div><p className="ex-small">The extension can share newly copied text from any application when both people enable it. This demo only changes the two buffers above.</p></section>;
}

function Limitations({ state, dispatch }: { state: DemoState; dispatch: Dispatch<Action> }) {
  const [selected, setSelected] = useState('internal');
  const options = [
    { id: 'internal', label: 'Browser internals', title: 'Some tabs stay private.', description: 'Internal pages such as chrome://extensions cannot be captured. A regular HTTP or HTTPS page is needed.', action: 'Open an internal example', run: () => dispatch({ type: 'open', page: 'trip', actor: 'host', supported: false }) },
    { id: 'native', label: 'Native dialogs', title: 'The browser owns this surface.', description: 'File pickers, permission prompts, and other native dialogs need action on the host’s device. The guest cannot control them.', action: 'Try a file picker', run: () => dispatch({ type: 'notice', text: 'Example file picker: the host must choose a file locally. The guest cannot interact with this native browser dialog.' }) },
    { id: 'trusted', label: 'Trusted events', title: 'Some controls need the host.', description: 'A website can require a trusted user gesture for sensitive controls. Synthetic remote input may not activate it.', action: 'Try a protected control', run: () => dispatch({ type: 'notice', text: 'Example protected control refused synthetic input. The host must activate it locally with a trusted browser gesture.' }) },
    { id: 'network', label: 'Network routes', title: 'Connected signaling isn’t a video route.', description: 'STUN helps peers find each other. It cannot relay media. Restricted networks may fail to establish a direct route; GhostPair currently has no TURN relay.', action: 'Try a restricted network', run: () => dispatch({ type: 'notice', text: 'Example network result: /health and /ready are healthy, but no direct peer route is available. A signaling server does not relay the shared tab.' }) },
  ];
  const choice = options.find(item => item.id === selected)!;
  return <section className="ex-limits" id="limits-example"><div className="ex-module-heading"><div><h2>A few real-world boundaries.</h2><p>Explore the surfaces and network conditions that need another approach.</p></div></div><div className="ex-limits-layout"><div className="ex-limit-options" aria-label="Limit scenarios">{options.map(item => <button key={item.id} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>{item.label}<Icon name="arrow"/></button>)}</div><div className="ex-limit-detail"><Icon name="lock"/><h3>{choice.title}</h3><p>{choice.description}</p><button className="ex-button ex-secondary" onClick={choice.run}>{choice.action}<Icon name="arrow"/></button>{selected === 'internal' && !activeTab(state).supported && <button className="ex-text-button" onClick={() => dispatch({ type: 'open', page: 'trip', actor: 'host' })}>Open a regular example tab</button>}</div></div></section>;
}

export default function ExplorePage() {
  const chapterFromHash = (): Chapter => chapters.some(item => item.id === window.location.hash.slice(1)) ? window.location.hash.slice(1) as Chapter : 'free';
  const [chapter, setChapter] = useState<Chapter>(chapterFromHash);
  const [state, dispatch] = useReducer(reducer, chapter, initialState);
  const [perspective, setPerspective] = useState<'host' | 'guest'>('guest');
  const current = chapters.find(item => item.id === chapter)!;
  const labRef = useRef<HTMLDivElement>(null);
  const tab = activeTab(state);
  useEffect(() => {
    const deadlines = state.previews.flatMap(p => p.expiresAt === null ? [] : [p.expiresAt]);
    if (state.click) deadlines.push(state.click.at + 700);
    if (!deadlines.length) return;
    const timer = window.setTimeout(() => dispatch({ type: 'expire', now: now() }), Math.max(0, Math.min(...deadlines) - now()) + 5);
    return () => window.clearTimeout(timer);
  }, [state.previews, state.click, state.revision]);
  useEffect(() => {
    function onHash() { const hash = window.location.hash.slice(1); if (!chapters.some(item => item.id === hash)) return; const selected = hash as Chapter; setChapter(selected); dispatch({ type: 'reset', chapter: selected }); }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  function selectChapter(selected: Chapter) { setChapter(selected); dispatch({ type: 'reset', chapter: selected }); window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${selected}`); setPerspective(selected === 'connect' ? 'host' : 'guest'); }
  return <main id="main" tabIndex={-1} className="explore-page" style={{ '--ex-accent': state.preferences.color } as CSSProperties}>
    <section className="ex-intro"><a className="ex-back-link" href="./">GhostPair <span>/ Explore</span></a><div className="ex-intro-grid"><div><h1>See both sides.<br/><span>Try it together.</span></h1></div><div className="ex-intro-copy"><p>One person shares. The other joins. Explore the controls, the little previews, and the permission that keeps it all in your hands.</p><div className="ex-demo-label"><span className="ex-live-dot"/>Interactive demo · Example data</div><p className="ex-small">Every action stays in this page. Choose a chapter for a guided start, or explore freely.</p></div></div></section>
    <div className="ex-chapter-nav" aria-label="Explore chapters">{chapters.map(item => <button key={item.id} aria-pressed={chapter === item.id} onClick={() => selectChapter(item.id)}>{item.label}</button>)}</div>
    <section className="ex-laboratory" data-testid="explore-lab" ref={labRef}>
      <div className="ex-lab-heading"><div><h2>{current.title}</h2><p>{current.description}</p></div><button className="ex-button ex-secondary" data-testid="reset-demo" onClick={() => dispatch({ type: 'reset', chapter })}><Icon name="reload"/>Reset demo</button></div>
      <div className="ex-try-note"><span>TRY THIS</span><p>{current.prompt}</p></div>
      <div className="ex-session-status"><span className={`ex-state-tag${state.status === 'connected' && !state.paused ? ' ex-tag-live' : ''}`}><i/>{state.paused ? 'Paused' : state.status === 'connected' ? 'Connected' : state.status === 'waiting' ? 'Waiting for guest' : state.status === 'capture' ? 'Waiting for authorization' : state.status === 'ended' ? 'Session ended' : 'Not connected'}</span><span>{state.mode === 'preview' ? 'Preview changes' : 'Full control'}<span className="ex-status-divider">/</span>One window · one active approved tab</span></div>
      {['idle', 'capture', 'waiting'].includes(state.status) ? <Connection key={state.revision} state={state} dispatch={dispatch}/> : <><div className="ex-perspective-switch" aria-label="Demo perspective"><button aria-pressed={perspective === 'host'} onClick={() => setPerspective('host')}>Host</button><button aria-pressed={perspective === 'guest'} onClick={() => setPerspective('guest')}>Guest</button></div><div className={`ex-perspectives ex-show-${perspective}`}>
        <section className="ex-perspective ex-host" data-testid="host-view"><div className="ex-perspective-heading"><div className="ex-person"><span className="ex-person-number">H</span><div><strong>The host</strong><span>Your tab. Your permissions.</span></div></div><span className="ex-view-kind">Original browser</span></div><BrowserFrame state={state} dispatch={dispatch} side="host"/>{state.panelVisible && state.status === 'connected' && <div className="ex-page-panel"><span className="ex-live-dot"/>GhostPair <span>{state.paused ? 'Paused' : `${tab.approved ? 'Sharing' : 'Waiting'} · ${state.mode === 'preview' ? 'Preview' : 'Full control'}`}</span><button aria-label="Hide page controls" onClick={() => dispatch({ type: 'panel' })}><Icon name="close"/></button></div>}<HostControls state={state} dispatch={dispatch}/></section>
        <section className="ex-perspective ex-guest" data-testid="guest-view"><div className="ex-perspective-heading"><div className="ex-person"><span className="ex-person-number ex-guest-number">G</span><div><strong>The guest</strong><span>A live view of the shared tab.</span></div></div><button className="ex-text-button ex-end-session" disabled={state.status !== 'connected'} onClick={() => dispatch({ type: 'leave' })}>Leave session</button></div><BrowserFrame state={state} dispatch={dispatch} side="guest"/><div className="ex-guest-explanation"><h3>{state.mode === 'preview' ? 'Your ideas sit over the page.' : 'Your input changes the page.'}</h3><p>{state.mode === 'preview' ? 'Type, click, and suggest. The host sees the same overlays you do. Original values remain underneath until Full control is enabled.' : 'The host enabled Full control. Type and select to change the actual example fields, then save the plan.'}</p><div className="ex-page-links">{catalog.map(page => <button key={page.id} disabled={!canInteract(state)} onClick={() => dispatch({ type: 'navigate', page: page.id })}>{page.title}<Icon name="arrow"/></button>)}</div><p className="ex-small">Scrolling, navigation, and managing tabs act on the host’s window in either interaction mode. Each new tab needs host approval.</p></div></section>
      </div></>}
      <div className={`ex-demo-message${state.error ? ' ex-message-error' : ''}`} data-testid="demo-message" role={state.error ? 'alert' : 'status'} aria-live="polite"><span>{state.error ? 'Check this' : 'Demo feedback'}</span><p>{state.error || state.notice || 'Try a guest action. Both views stay synchronized; nothing leaves this page.'}</p></div>
    </section>
    <Clipboard key={`clipboard-${state.revision}`} state={state} dispatch={dispatch}/><Limitations key={`limits-${state.revision}`} state={state} dispatch={dispatch}/>
    <section className="ex-next-step"><h2>The next tab can be yours.</h2><a className="ex-button" href="?view=installation">Open the installation guide <Icon name="arrow"/></a></section>
  </main>;
}
