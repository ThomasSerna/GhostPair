import { useEffect, useReducer, useRef, useState, type Dispatch, type FormEvent } from 'react';
import { activeTab, canInteract, canManage, catalog, initialState, legacyTourHashes, previewFor, reducer, tourStepFromHash, type Action, type DemoState, type TourStep } from './explore/model';
import './explore.css';

type Side = 'host' | 'guest';
type IconName = 'arrow' | 'back' | 'forward' | 'reload' | 'plus' | 'close' | 'lock' | 'pause' | 'play';
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = { arrow: 'M4 12h16m-6-6 6 6-6 6', back: 'm14 6-6 6 6 6', forward: 'm10 6 6 6-6 6', reload: 'M20 7v5h-5M19 12a7 7 0 1 0-2 5M20 7l-3-2', plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M18 6 6 18', lock: 'M7 10V7a5 5 0 0 1 10 0v3M6 10h12v11H6z', pause: 'M8 5v14M16 5v14', play: 'm8 5 11 7-11 7z' };
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
type SessionProps = { state: DemoState; dispatch: Dispatch<Action> };
type ViewProps = SessionProps & { side: Side; guidedStep: TourStep | null };

function ExamplePage({ state, dispatch, side, guidedStep }: ViewProps) {
  const tab = activeTab(state), page = catalog.find(item => item.id === tab.history[tab.index])!;
  const interactive = side === 'guest' && canInteract(state);
  const blocked = side === 'guest' && (state.paused || !tab.approved || state.status !== 'connected');
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const sync = () => {
      if (!scroller.clientHeight) return;
      const target = (scroller.scrollHeight - scroller.clientHeight) * tab.scroll / 100;
      if (Math.abs(scroller.scrollTop - target) > 2) scroller.scrollTop = target;
    };
    sync();
    const resize = new ResizeObserver(sync);
    resize.observe(scroller);
    return () => resize.disconnect();
  }, [tab.scroll, tab.id, tab.index, blocked]);

  if (blocked) return <div className="ex-view-blocked" data-testid="guest-withheld"><Icon name={state.paused ? 'pause' : 'lock'}/><h3>{state.paused ? 'A moment to pause.' : state.status === 'ended' ? 'The session has ended.' : 'Waiting for the host.'}</h3><p>{state.paused ? 'The host can resume when ready.' : state.status === 'ended' ? 'Reset the demo to browse together again.' : 'Choose Share this tab on the host side.'}</p></div>;
  const notes = previewFor(state, 'notes'), notify = previewFor(state, 'notify'), submit = previewFor(state, 'submit');
  function propose(field: 'notes' | 'notify' | 'submit', value: string | boolean) { dispatch({ type: 'field', field, value, now: Date.now() }); }
  return <div className="ex-example-scroll" ref={scrollRef} data-testid={`${side}-page-scroll`} tabIndex={0} aria-label={`${side === 'host' ? 'Host' : 'Guest'} example page`} onScroll={event => {
    const scroller = event.currentTarget;
    if ((side === 'host' || canInteract(state)) && scroller.clientHeight > 0 && scroller.scrollHeight > scroller.clientHeight) {
      const position = scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight) * 100;
      if (Math.abs(position - tab.scroll) > .7) dispatch({ type: 'scroll', position, actor: side });
    }
  }}>
    <div className="ex-example-content">
      <div className="ex-example-masthead"><strong>fieldnotes<span>®</span></strong><span>Good plans. Good company.</span></div>
      <h3>{page.heading}</h3><p className="ex-example-description">{page.description}</p>
      <form onSubmit={event => { event.preventDefault(); if (interactive) propose('submit', true); }}>
        <label className={`ex-example-field${notes ? ' ex-has-preview' : ''}${side === 'guest' && guidedStep === 1 ? ' ex-tour-target' : ''}`} htmlFor={`${side}-notes`}>
          <span>A note for the trip{notes && <em>Preview</em>}</span>
          <textarea id={`${side}-notes`} data-testid={`${side}-notes`} data-original={tab.form.notes} value={String(notes?.value ?? tab.form.notes)} rows={3} readOnly={side === 'host'} disabled={side === 'guest' && !interactive} onChange={event => propose('notes', event.target.value)}/>
          {notes && <small>Original: {tab.form.notes || '(empty)'}</small>}
        </label>
        <label className={`ex-example-check${notify ? ' ex-has-preview' : ''}`}><input data-testid={`${side}-notify`} type="checkbox" checked={Boolean(notify?.value ?? tab.form.notify)} disabled={!interactive} onChange={event => propose('notify', event.target.checked)}/><span>Send a packing reminder{notify && <em>Preview · original {tab.form.notify ? 'On' : 'Off'}</em>}</span></label>
        <button data-testid={`${side}-submit`} className={`ex-save-plan${submit ? ' ex-has-preview' : ''}`} type="submit" disabled={!interactive}>{submit ? 'Preview: Save plan' : 'Save plan'}<Icon name="arrow"/></button>
        {tab.form.submit && <p className="ex-plan-saved" data-testid={`${side}-plan-saved`}>Plan saved. See you by the water.</p>}
        {submit && <p className="ex-example-original">Preview only. The plan has not been saved.</p>}
      </form>
      <div className="ex-example-bottom"><span>fieldnotes</span><p>Leave room for the unexpected.</p></div>
    </div>
  </div>;
}

function BrowserFrame({ state, dispatch, side, guidedStep }: ViewProps) {
  const tab = activeTab(state), page = catalog.find(item => item.id === tab.history[tab.index])!;
  const [address, setAddress] = useState<string>(page.address);
  useEffect(() => setAddress(page.address), [page.address, tab.id, state.revision]);
  const manage = side === 'host' || canManage(state), navigate = side === 'host' || canInteract(state);
  function openAddress(event: FormEvent) {
    event.preventDefault();
    const destination = catalog.find(item => item.address === address || item.id === address || item.address.replace('https://', '') === address.replace(/^https:\/\//, '').replace(/\/$/, ''));
    dispatch(destination ? { type: 'navigate', page: destination.id, actor: side } : { type: 'notice', text: 'Try /trip, /checklist or /notes at example.ghostpair.test. This demo stays on this page.' });
  }
  return <div className="ex-browser-frame">
    <div className="ex-tab-strip" aria-label={`${side} example tabs`}>{state.tabs.map(item => <div className={`ex-browser-tab${item.id === state.activeId ? ' ex-active-tab' : ''}`} key={item.id}><button disabled={!manage} onClick={() => dispatch({ type: 'activate', id: item.id, actor: side })} aria-pressed={item.id === state.activeId}><span className={item.approved ? 'ex-tab-approved' : 'ex-tab-pending'} aria-label={item.approved ? 'Approved' : 'Not shared'}/><span>{catalog.find(entry => entry.id === item.history[item.index])!.title}</span></button><button className="ex-tab-close" disabled={!manage} aria-label={`Close ${catalog.find(entry => entry.id === item.history[item.index])!.title} tab ${item.id}`} onClick={() => dispatch({ type: 'close', id: item.id, actor: side })}><Icon name="close"/></button></div>)}<button className={`ex-new-tab${side === 'guest' && guidedStep === 3 ? ' ex-tour-target' : ''}`} data-testid={`${side}-new-tab`} disabled={!manage} aria-label={`Open a new ${side} example tab`} onClick={() => dispatch({ type: 'open', page: 'checklist', actor: side })}><Icon name="plus"/></button></div>
    <form className="ex-browser-toolbar" onSubmit={openAddress}>
      <button type="button" aria-label={`${side} go back`} disabled={!navigate || tab.index === 0} onClick={() => dispatch({ type: 'history', direction: -1, actor: side })}><Icon name="back"/></button>
      <button type="button" aria-label={`${side} go forward`} disabled={!navigate || tab.index >= tab.history.length - 1} onClick={() => dispatch({ type: 'history', direction: 1, actor: side })}><Icon name="forward"/></button>
      <button type="button" aria-label={`${side} reload example page`} disabled={!navigate} onClick={() => dispatch({ type: 'reload', actor: side })}><Icon name="reload"/></button>
      <label><Icon name="lock"/><input aria-label={`${side} example address`} data-testid={`${side}-address`} value={address} disabled={!navigate} spellCheck={false} onChange={event => setAddress(event.target.value)}/></label>
      <button type="submit" disabled={!navigate} aria-label={`Open ${side} example address`}><Icon name="arrow"/></button>
    </form>
    <ExamplePage state={state} dispatch={dispatch} side={side} guidedStep={guidedStep}/>
    <div className="ex-browser-bottom">{side === 'host' ? 'Original page + visible previews' : state.control ? 'Try the page above' : 'View only'}</div>
  </div>;
}

function HostControls({ state, dispatch, guidedStep }: SessionProps & { guidedStep: TourStep | null }) {
  const tab = activeTab(state), running = state.status === 'connected';
  return <div className="ex-host-controls">
    <div className="ex-controls-heading"><h3>Sharing session</h3><span>{state.tabs.filter(item => item.approved).length}/5 tabs approved</span></div>
    <div className="ex-session-settings"><label className={guidedStep === 2 ? 'ex-tour-target' : undefined}>Interaction mode<select data-testid="interaction-mode" value={state.mode} disabled={!running} onChange={event => dispatch({ type: 'mode', mode: event.target.value as DemoState['mode'] })}><option value="preview">Preview changes</option><option value="full">Full control</option></select></label><label className="ex-check"><input data-testid="allow-control" type="checkbox" checked={state.control} disabled={!running} onChange={() => dispatch({ type: 'control' })}/><span>Let them control the page</span></label></div>
    <div className="ex-shared-tab-row"><span><i className={tab.approved ? 'ex-tab-approved' : 'ex-tab-pending'}/>{tab.approved ? 'Active · Shared' : 'Waiting for approval'}</span>{tab.approved ? <button className="ex-text-button" disabled={!running} onClick={() => dispatch({ type: 'release', id: tab.id })}>Stop sharing tab</button> : <button className={`ex-button ex-secondary${guidedStep === 3 ? ' ex-tour-target' : ''}`} data-testid="share-active-tab" disabled={!running} onClick={() => dispatch({ type: 'approve', id: tab.id })}>Share this tab</button>}</div>
    <div className="ex-actions"><button data-testid="pause-session" className="ex-button ex-secondary" disabled={!running} onClick={() => dispatch({ type: 'pause' })}><Icon name={state.paused ? 'play' : 'pause'}/>{state.paused ? 'Resume session' : 'Pause session'}</button><button className="ex-text-button ex-end-session" disabled={!running} onClick={() => dispatch({ type: 'end' })}>End session</button></div>
  </div>;
}

const tour = [
  { title: 'Propose an edit.', description: 'Type a guest note. Both views show a brief preview; the original stays untouched.' },
  { title: 'Make a real change.', description: 'Choose Full control on the host. Guest edits can now be saved.' },
  { title: 'Share another tab.', description: 'Open a guest tab, then approve it on the host.' },
];

export default function ExplorePage() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [perspective, setPerspective] = useState<Side>(() => tourStepFromHash(window.location.hash) === 2 ? 'host' : 'guest');
  const [tourStep, setTourStep] = useState<TourStep>(() => tourStepFromHash(window.location.hash));
  const [tourOpen, setTourOpen] = useState(true);
  const openTourRef = useRef<HTMLButtonElement>(null);
  const nextTourRef = useRef<HTMLButtonElement>(null);
  const closeTourRef = useRef<HTMLButtonElement>(null);
  const tourRef = useRef<HTMLDivElement>(null);
  const guidedStep = tourOpen ? tourStep : null;
  const guideDescription = state.status === 'ended' ? 'Reset the demo to browse together again.'
    : state.paused ? 'Resume the session on the host to continue.'
    : !state.control ? 'The host has disabled interaction. Enable it to try the guest’s page.'
    : tourStep === 1 && state.mode === 'full' ? 'Full control is on. Guest edits now change the shared page.'
    : tourStep === 2 && state.mode === 'full' ? 'Full control is on. Edit or save the guest’s page.'
    : tourStep === 3 && !activeTab(state).approved ? 'This tab needs approval. Choose Share this tab on the host.'
    : tour[tourStep - 1]!.description;
  useEffect(() => {
    if (!state.previews.length) return;
    const deadline = Math.min(...state.previews.map(item => item.expiresAt));
    const timer = window.setTimeout(() => dispatch({ type: 'expire', now: Date.now() }), Math.max(0, deadline - Date.now()) + 5);
    return () => window.clearTimeout(timer);
  }, [state.previews, state.revision]);
  useEffect(() => {
    function onHash() {
      if (!legacyTourHashes.some(hash => hash === window.location.hash.slice(1))) return;
      const step = tourStepFromHash(window.location.hash);
      setTourStep(step); setTourOpen(true); setPerspective(step === 2 ? 'host' : 'guest');
    }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  function chooseMoment(step: TourStep) {
    setTourStep(step); setPerspective(step === 2 ? 'host' : 'guest');
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${['preview', 'modes', 'tabs'][step - 1]}`);
    requestAnimationFrame(() => {
      if (step === 2) document.querySelector('[data-testid="interaction-mode"]')?.scrollIntoView({ block: 'nearest' });
      if (step === 3) closeTourRef.current?.focus({ preventScroll: true });
      if (step === 1) nextTourRef.current?.focus({ preventScroll: true });
    });
  }
  function showHostApproval() {
    setPerspective('host');
    requestAnimationFrame(() => document.querySelector('.ex-shared-tab-row')?.scrollIntoView({ block: 'nearest' }));
  }
  function closeTour() { setTourOpen(false); requestAnimationFrame(() => openTourRef.current?.focus({ preventScroll: true })); }
  function reopenTour() { setTourOpen(true); setPerspective(tourStep === 2 ? 'host' : 'guest'); requestAnimationFrame(() => tourRef.current?.focus({ preventScroll: true })); }

  return <main id="main" tabIndex={-1} className="explore-page">
    <section className="ex-intro"><div><h1>See both sides.<br/><span>Try it together.</span></h1></div><div className="ex-intro-copy"><p>Try the guest’s page. The host decides what changes.</p><span className="ex-demo-label"><span className="ex-live-dot"/>Local demo · Example data</span></div></section>
    <section className="ex-laboratory" aria-label="GhostPair interactive demo" data-testid="explore-lab">
      <div className="ex-lab-tools"><span className={`ex-state-tag${state.status === 'connected' && !state.paused ? ' ex-tag-live' : ''}`}><i/>{state.status === 'ended' ? 'Session ended' : state.paused ? 'Paused' : 'Connected'}<span className="ex-status-divider">/</span>{state.mode === 'preview' ? 'Preview changes' : 'Full control'}</span><div>{!tourOpen && <button ref={openTourRef} className="ex-text-button" data-testid="open-tour" onClick={reopenTour}>Quick tour</button>}<button className="ex-text-button" data-testid="reset-demo" onClick={() => dispatch({ type: 'reset' })}><Icon name="reload"/>Reset demo</button></div></div>
      {tourOpen && <div className="ex-tour" data-testid="tour-step" data-step={tourStep} role="region" aria-label="Quick tour" tabIndex={-1} ref={tourRef}>
        <span className="ex-tour-count">{tourStep} / 3</span><div className="ex-tour-copy"><h2>{tour[tourStep - 1]!.title}</h2><p>{guideDescription}</p>{tourStep === 3 && <button className="ex-text-button" data-testid="tour-show-host" onClick={showHostApproval}>Show host approval <Icon name="arrow"/></button>}</div>
        <div className="ex-tour-actions"><button className="ex-tour-arrow" data-testid="tour-previous" aria-label="Previous tour moment" disabled={tourStep === 1} onClick={() => chooseMoment((tourStep - 1) as TourStep)}><Icon name="back"/></button><button className="ex-button ex-secondary" data-testid="tour-next" ref={nextTourRef} disabled={tourStep === 3} onClick={() => chooseMoment((tourStep + 1) as TourStep)}>Next <Icon name="arrow"/></button><button className="ex-tour-arrow" data-testid="close-tour" ref={closeTourRef} aria-label="Close tour" onClick={closeTour}><Icon name="close"/></button></div>
      </div>}
      <div className="ex-perspective-switch" aria-label="Demo perspective"><button aria-pressed={perspective === 'host'} onClick={() => setPerspective('host')}>Host</button><button aria-pressed={perspective === 'guest'} onClick={() => setPerspective('guest')}>Guest</button></div>
      <div className={`ex-perspectives ex-show-${perspective}`}>
        <section className="ex-perspective ex-host" data-testid="host-view"><div className="ex-perspective-heading"><div className="ex-person"><span className="ex-person-number">H</span><div><strong>The host</strong><span>Your tab. Your permissions.</span></div></div><span className="ex-view-kind">Original browser</span></div><BrowserFrame state={state} dispatch={dispatch} side="host" guidedStep={guidedStep}/><HostControls state={state} dispatch={dispatch} guidedStep={guidedStep}/></section>
        <section className="ex-perspective ex-guest" data-testid="guest-view"><div className="ex-perspective-heading"><div className="ex-person"><span className="ex-person-number ex-guest-number">G</span><div><strong>The guest</strong><span>A view of the shared tab.</span></div></div><span className="ex-view-kind">Shared browser</span></div><BrowserFrame state={state} dispatch={dispatch} side="guest" guidedStep={guidedStep}/></section>
      </div>
      <p className={`ex-demo-message${state.error ? ' ex-message-error' : ''}`} data-testid="demo-message" role={state.error ? 'alert' : 'status'} aria-live="polite">{state.error || state.notice || 'Guest edits appear as 0.5-second previews. Nothing leaves this page.'}</p>
    </section>
    <section className="ex-next-step"><h2>Ready for your own session?</h2><a className="ex-button" href="?view=installation">Open the installation guide <Icon name="arrow"/></a></section>
  </main>;
}
