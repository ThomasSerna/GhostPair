export const DEMO_CODE = '8a40d921c61f46ca98b7e3407e90d215';
export const DEMO_PASSWORD = 'Together-42';
export const catalog = [
  { id: 'trip', title: 'A weekend together', address: 'https://example.ghostpair.test/trip', eyebrow: 'FIELD NOTES / 01', heading: 'Make room for a little adventure.', description: 'A shared plan, a few ideas, and a place to work them out together.' },
  { id: 'checklist', title: 'The packing list', address: 'https://example.ghostpair.test/checklist', eyebrow: 'FIELD NOTES / 02', heading: 'Less to carry. More to discover.', description: 'Choose your pace and leave a note for the person coming along.' },
  { id: 'notes', title: 'The little details', address: 'https://example.ghostpair.test/notes', eyebrow: 'FIELD NOTES / 03', heading: 'Good plans start with a conversation.', description: 'Try an idea here. You decide when it becomes a real change.' },
] as const;
export type PageId = typeof catalog[number]['id'];
export type Field = 'name' | 'email' | 'notes' | 'password' | 'notify' | 'pace' | 'submit';
export type Fields = { name: string; email: string; notes: string; password: string; notify: boolean; pace: string; submit: boolean };
export type Lifetime = { persistent: boolean; seconds: number };
export type Preferences = { showActions: boolean; clicks: boolean; notices: boolean; color: string; text: Lifetime; other: Lifetime };
export type DemoTab = { id: number; approved: boolean; supported: boolean; history: PageId[]; index: number; form: Fields; scroll: number };
export type Preview = { tabId: number; field: Field; value: string | boolean; category: 'text' | 'other'; expiresAt: number | null };
export type DemoState = {
  status: 'idle' | 'capture' | 'waiting' | 'connected' | 'ended'; password: string;
  tabs: DemoTab[]; activeId: number; nextId: number; mode: 'preview' | 'full'; paused: boolean; control: boolean; panelVisible: boolean;
  previews: Preview[]; preferences: Preferences; hostClipboard: boolean; guestClipboard: boolean; hostBuffer: string; guestBuffer: string;
  notice: string; error: string; click: { field: Field; at: number } | null; revision: number;
};
export type Chapter = 'free' | 'connect' | 'modes' | 'tabs' | 'feedback' | 'editing' | 'clipboard' | 'controls' | 'limits';
export const chapters: { id: Chapter; label: string; title: string; description: string; prompt: string }[] = [
  { id: 'free', label: 'Free exploration', title: 'A shared browser. Your turn.', description: 'Two perspectives, one shared tab. Try the guest’s page, then change what the host allows.', prompt: 'Type in the guest’s name field. Both views show a preview; the original stays untouched.' },
  { id: 'connect', label: '01 / Connect', title: 'An invitation, with your permission.', description: 'Create a session as the host. Give your guest the connection code and session password.', prompt: 'Choose a password, confirm consent, then approve the example capture request.' },
  { id: 'modes', label: '02 / Interaction modes', title: 'Suggest it. Or change it.', description: 'Preview changes puts ideas over the page. Full control changes the actual page.', prompt: 'Try the fields, checkbox, pace, and Save plan. Switch modes to compare the result.' },
  { id: 'tabs', label: '03 / Navigation & tabs', title: 'A new tab needs a new yes.', description: 'Navigation works in either mode. The host approves each tab before it becomes visible.', prompt: 'Open a tab in the guest’s toolbar, then choose Share this tab in the host controls.' },
  { id: 'feedback', label: '04 / Interaction feedback', title: 'Make every suggestion visible.', description: 'Choose click highlights, visual notices, a color, and separate lifetimes for text and other previews.', prompt: 'Open Interaction feedback. Set text to Until cleared and type in the guest’s page.' },
  { id: 'editing', label: '05 / Edit previews', title: 'An idea you can work on together.', description: 'The host can edit preview text, then move or copy it into another compatible field.', prompt: 'Edit the seeded name preview below the host’s page. Move it to notes or Ctrl-drag to copy.' },
  { id: 'clipboard', label: '06 / Clipboard', title: 'A shared clipboard takes two yeses.', description: 'Both participants opt in. Only newly copied text is shared while the session is active.', prompt: 'Enable both switches, then use Copy new text. These are example buffers on this page.' },
  { id: 'controls', label: '07 / Host controls', title: 'The host stays in control.', description: 'Pause, remove interaction, stop sharing a tab, or end the session whenever you need.', prompt: 'Pause the session and try a guest action. Resume, then turn off Let them control the page.' },
  { id: 'limits', label: '08 / What to expect', title: 'Know where the browser draws the line.', description: 'Some surfaces and network conditions cannot be shared or controlled by the extension.', prompt: 'Try the scenarios below, then recover by resetting the demo.' },
];
const originalFields = (): Fields => ({ name: 'Alex', email: 'alex@example.com', notes: 'Find a quiet place by the water.', password: '', notify: false, pace: 'slow', submit: false });
const makeTab = (id: number, page: PageId = 'trip', approved = false, supported = true): DemoTab => ({ id, approved, supported, history: [page], index: 0, form: originalFields(), scroll: 0 });
export function initialState(chapter: Chapter = 'free'): DemoState {
  const state: DemoState = { status: chapter === 'connect' ? 'idle' : 'connected', password: DEMO_PASSWORD, tabs: [makeTab(1, 'trip', chapter !== 'connect')], activeId: 1, nextId: 2, mode: 'preview', paused: false, control: true, panelVisible: true, previews: [], preferences: { showActions: true, clicks: true, notices: false, color: '#7871e8', text: { persistent: false, seconds: .5 }, other: { persistent: false, seconds: .5 } }, hostClipboard: false, guestClipboard: false, hostBuffer: 'An earlier host copy', guestBuffer: 'An earlier guest copy', notice: '', error: '', click: null, revision: 0 };
  if (chapter === 'editing') { state.preferences.text.persistent = true; state.previews = [{ tabId: 1, field: 'name', value: 'Sam', category: 'text', expiresAt: null }]; }
  return state;
}
export function activeTab(state: DemoState) { return state.tabs.find(tab => tab.id === state.activeId)!; }
export function canInteract(state: DemoState) { const tab = activeTab(state); return state.status === 'connected' && !state.paused && state.control && tab.approved && tab.supported; }
export function canManage(state: DemoState) { return state.status === 'connected' && !state.paused && state.control; }
export function clipboardActive(state: DemoState) { return state.status === 'connected' && !state.paused && state.hostClipboard && state.guestClipboard; }
export function previewFor(state: DemoState, field: Field) { return state.previews.find(item => item.tabId === state.activeId && item.field === field); }
export type Action =
  | { type: 'reset'; chapter?: Chapter }
  | { type: 'start'; password: string; consent: boolean }
  | { type: 'capture'; granted: boolean }
  | { type: 'join'; code: string; password: string; networkFailure?: boolean }
  | { type: 'cancel' | 'end' | 'leave' | 'pause' | 'control' | 'panel' | 'clear' }
  | { type: 'mode'; mode: DemoState['mode'] }
  | { type: 'field'; field: Field; value: string | boolean; now: number }
  | { type: 'expire'; now: number }
  | { type: 'preference'; preferences: Preferences; now: number }
  | { type: 'open'; page: PageId; actor?: 'host' | 'guest'; supported?: boolean }
  | { type: 'activate' | 'close' | 'approve' | 'release'; id: number; actor?: 'host' | 'guest' }
  | { type: 'navigate'; page: PageId; actor?: 'host' | 'guest' }
  | { type: 'history'; direction: -1 | 1; actor?: 'host' | 'guest' }
  | { type: 'reload'; actor?: 'host' | 'guest' }
  | { type: 'scroll'; position: number; actor?: 'host' | 'guest' }
  | { type: 'edit-preview'; field: Field; value: string; now: number }
  | { type: 'transfer'; source: Field; target: Field; copy: boolean; now: number }
  | { type: 'clipboard-switch'; side: 'host' | 'guest'; enabled: boolean }
  | { type: 'copy-text'; side: 'host' | 'guest'; text: string }
  | { type: 'notice'; text: string };
const textField = (field: Field) => ['name', 'email', 'notes', 'password'].includes(field);
function addPreview(state: DemoState, field: Field, value: string | boolean, now: number): DemoState {
  const category = textField(field) ? 'text' : 'other';
  const lifetime = state.preferences[category];
  const item: Preview = { tabId: state.activeId, field, value, category, expiresAt: lifetime.persistent ? null : now + lifetime.seconds * 1000 };
  return { ...state, previews: [...state.previews.filter(p => !(p.tabId === state.activeId && p.field === field)).map(p => p.tabId === state.activeId && p.category === category ? { ...p, expiresAt: item.expiresAt } : p), item] };
}
const changedTab = (state: DemoState, update: (tab: DemoTab) => DemoTab): DemoState => ({ ...state, tabs: state.tabs.map(tab => tab.id === state.activeId ? update(tab) : tab) });
const unavailable = (state: DemoState): DemoState => ({ ...state, notice: state.paused ? 'The session is paused. Resume it on the host side.' : !state.control ? 'The host has disabled page interaction. You can still view the approved tab.' : 'The active tab is waiting for the host to share it.' });
export function reducer(state: DemoState, action: Action): DemoState {
  switch (action.type) {
    case 'reset': return { ...initialState(action.chapter), revision: state.revision + 1 };
    case 'start': {
      if (!action.consent) return { ...state, error: 'Confirm what you want to share before continuing.' };
      if (action.password.length < 8 || action.password.length > 256) return { ...state, error: 'Use a session password with 8–256 characters.' };
      return { ...state, password: action.password, status: 'capture', error: '', notice: '' };
    }
    case 'capture': return action.granted ? { ...changedTab(state, tab => ({ ...tab, approved: true })), status: 'waiting', notice: 'Example tab authorized. The host is waiting for a guest.', error: '' } : { ...state, status: 'idle', error: 'Capture permission was declined. No tab is being shared.' };
    case 'join': {
      if (state.status !== 'waiting') return { ...state, error: 'Start sharing and authorize a tab on the host side first.' };
      const code = action.code.replace(/[\s-]/g, '').toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(code)) return { ...state, error: 'Enter a 32-character connection code.' };
      if (code !== DEMO_CODE) return { ...state, error: 'This connection code does not match the example host.' };
      if (action.password !== state.password) return { ...state, error: 'The session password does not match. Try again.' };
      if (action.networkFailure) return { ...state, error: 'Signaling is ready, but these peers have no direct network route. STUN cannot relay traffic.' };
      return { ...state, status: 'connected', mode: 'preview', notice: 'Connected. Every new session starts in Preview changes.', error: '' };
    }
    case 'cancel': return { ...initialState('connect'), revision: state.revision + 1, notice: 'Setup cancelled. No example tab is being shared.' };
    case 'end': case 'leave': return { ...state, status: 'ended', previews: [], paused: false, hostClipboard: false, guestClipboard: false, click: null, notice: action.type === 'end' ? 'The host ended the session. Capture and clipboard sharing have stopped.' : 'The guest left the session. The shared view is disconnected.', error: '' };
    case 'pause': return { ...state, paused: !state.paused, previews: [], click: null, notice: state.paused ? 'Session resumed. The active approved tab is visible again.' : 'Session paused. Previews cleared; shared view and clipboard updates are suspended.' };
    case 'control': return { ...state, control: !state.control, previews: [], click: null, notice: state.control ? 'Page interaction disabled. Previews cleared; the guest can view only.' : 'Page interaction enabled.' };
    case 'panel': return { ...state, panelVisible: !state.panelVisible };
    case 'mode': return { ...state, mode: action.mode, previews: [], click: null, notice: action.mode === 'full' ? 'Full control: guest input now changes the example page.' : 'Preview changes: guest input leaves original values untouched.' };
    case 'clear': return { ...state, previews: [], click: null, notice: 'All previews cleared. Original values are unchanged.' };
    case 'field': {
      if (!canInteract(state)) return unavailable(state);
      const click = state.preferences.showActions && state.preferences.clicks && !textField(action.field) ? { field: action.field, at: action.now } : null;
      let next = { ...state, error: '', click, notice: state.preferences.notices ? `${state.mode === 'preview' ? 'Preview' : 'Changed'}: ${action.field === 'password' ? 'password (masked)' : action.field}` : '' };
      if (state.mode === 'preview') return addPreview(state.preferences.showActions ? next : { ...next, notice: 'Preview feedback is hidden. Original values remain unchanged.' }, action.field, action.value, action.now);
      if (action.field === 'submit') {
        const fields = activeTab(state).form;
        if (!fields.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) return { ...next, error: 'Add a name and a valid email before saving the example plan.' };
        return { ...changedTab(next, tab => ({ ...tab, form: { ...tab.form, submit: true } })), notice: 'Example plan saved locally. No data was sent.' };
      }
      return changedTab(next, tab => ({ ...tab, form: { ...tab.form, [action.field]: action.value, submit: false } }));
    }
    case 'expire': return { ...state, previews: state.previews.filter(p => p.expiresAt === null || p.expiresAt > action.now), click: state.click && state.click.at + 700 > action.now ? state.click : null };
    case 'preference': {
      const preferences = { ...action.preferences, text: { ...action.preferences.text, seconds: Math.max(.1, Math.min(10, action.preferences.text.seconds || .5)) }, other: { ...action.preferences.other, seconds: Math.max(.1, Math.min(10, action.preferences.other.seconds || .5)) } };
      return { ...state, preferences, click: preferences.showActions && preferences.clicks ? state.click : null, previews: state.previews.map(p => {
        const lifetime = preferences[p.category], previous = state.preferences[p.category];
        return lifetime.persistent !== previous.persistent || lifetime.seconds !== previous.seconds ? { ...p, expiresAt: lifetime.persistent ? null : action.now + lifetime.seconds * 1000 } : p;
      }) };
    }
    case 'open': {
      if (action.actor !== 'host' && !canManage(state)) return unavailable(state);
      return { ...state, tabs: [...state.tabs, makeTab(state.nextId, action.page, false, action.supported !== false)], activeId: state.nextId, nextId: state.nextId + 1, previews: [], notice: action.supported === false ? 'Internal browser pages cannot be captured. Open a regular web page.' : 'New tab opened in the same window. The host must approve it before sharing.' };
    }
    case 'activate': {
      if (action.actor !== 'host' && !canManage(state)) return unavailable(state);
      if (!state.tabs.some(tab => tab.id === action.id)) return state;
      return { ...state, activeId: action.id, previews: [], notice: state.tabs.find(tab => tab.id === action.id)?.approved ? 'Only this active approved tab is transmitted.' : 'This tab is waiting for the host to share it.' };
    }
    case 'close': {
      if (action.actor !== 'host' && !canManage(state)) return unavailable(state);
      const tabs = state.tabs.filter(tab => tab.id !== action.id);
      if (!tabs.length) return { ...state, tabs: [makeTab(state.nextId)], activeId: state.nextId, nextId: state.nextId + 1, previews: [], notice: 'The last tab closed. The new tab needs host approval.' };
      return { ...state, tabs, activeId: action.id === state.activeId ? tabs[0]!.id : state.activeId, previews: state.previews.filter(p => p.tabId !== action.id), notice: 'Tab closed in the host’s window.' };
    }
    case 'approve': {
      const tab = state.tabs.find(t => t.id === action.id);
      if (!tab?.supported) return { ...state, error: 'This tab cannot be shared. Open a regular web page.' };
      if (tab.approved) return state;
      if (state.tabs.filter(t => t.approved).length >= 5) return { ...state, error: 'Five tabs are already approved. Stop sharing a tab to make room.' };
      return { ...state, tabs: state.tabs.map(t => t.id === action.id ? { ...t, approved: true } : t), error: '', notice: 'The host approved this tab. Only the active approved tab is visible.' };
    }
    case 'release': return { ...state, tabs: state.tabs.map(t => t.id === action.id ? { ...t, approved: false } : t), previews: state.previews.filter(p => p.tabId !== action.id), notice: 'Sharing stopped for this tab. It remains open on the host side.' };
    case 'navigate': {
      if (action.actor !== 'host' && !canInteract(state)) return unavailable(state);
      return { ...changedTab(state, tab => ({ ...tab, history: [...tab.history.slice(0, tab.index + 1), action.page], index: tab.index + 1, form: originalFields(), scroll: 0 })), previews: [], notice: 'Navigation changed the shared page, even in Preview changes.' };
    }
    case 'history': {
      if (action.actor !== 'host' && !canInteract(state)) return unavailable(state);
      const tab = activeTab(state), index = tab.index + action.direction;
      if (index < 0 || index >= tab.history.length) return state;
      return { ...changedTab(state, t => ({ ...t, index, form: originalFields(), scroll: 0 })), previews: [], notice: 'History navigation changed the shared page.' };
    }
    case 'reload': return action.actor === 'host' || canInteract(state) ? { ...changedTab(state, t => ({ ...t, form: originalFields(), scroll: 0 })), previews: [], notice: 'Example page reloaded. Unsaved values and previews were reset.' } : unavailable(state);
    case 'scroll': return action.actor === 'host' || canInteract(state) ? changedTab(state, tab => ({ ...tab, scroll: Math.max(0, Math.min(100, action.position)) })) : unavailable(state);
    case 'edit-preview': {
      if (state.paused || state.mode !== 'preview' || !previewFor(state, action.field) || !textField(action.field)) return state;
      return addPreview(state, action.field, action.value, action.now);
    }
    case 'transfer': {
      if (state.paused || state.mode !== 'preview' || action.source === 'password' || action.target === 'password' || !textField(action.source) || !textField(action.target) || action.source === action.target) return { ...state, notice: 'Move or copy text between different compatible fields. Password previews cannot be copied or dragged.' };
      const source = previewFor(state, action.source);
      if (!source || typeof source.value !== 'string') return { ...state, notice: 'Create a text preview first.' };
      const target = previewFor(state, action.target)?.value ?? activeTab(state).form[action.target];
      const next = addPreview(state, action.target, `${typeof target === 'string' ? target : ''}${target ? ' ' : ''}${source.value}`, action.now);
      return { ...next, previews: action.copy ? next.previews : next.previews.map(p => p.tabId === state.activeId && p.field === action.source ? { ...p, value: '' } : p), notice: action.copy ? 'Preview text copied. Original fields are unchanged.' : 'Preview text moved. The source preview is now empty; original fields are unchanged.' };
    }
    case 'clipboard-switch': return { ...state, [action.side === 'host' ? 'hostClipboard' : 'guestClipboard']: action.enabled, notice: 'Clipboard preference updated. Existing buffer contents are never sent on activation.' };
    case 'copy-text': {
      if (new TextEncoder().encode(action.text).byteLength > 256 * 1024) return { ...state, error: 'Example clipboard text is larger than the extension’s 256 KiB limit.' };
      const synchronized = clipboardActive(state);
      return { ...state, error: '', [action.side === 'host' ? 'hostBuffer' : 'guestBuffer']: action.text, ...(synchronized ? { hostBuffer: action.text, guestBuffer: action.text } : {}), notice: synchronized ? 'New example text shared with both buffers.' : state.paused ? 'Local example copy only. Clipboard sharing is suspended while paused.' : 'Local example copy only. Both participants must enable clipboard sharing.' };
    }
    case 'notice': return { ...state, notice: action.text, error: '' };
  }
}
