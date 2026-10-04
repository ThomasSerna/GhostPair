export const catalog = [
  { id: 'trip', title: 'A weekend together', address: 'https://example.ghostpair.test/trip', heading: 'Make room for a little adventure.', description: 'A shared plan, with room for your ideas.' },
  { id: 'checklist', title: 'The packing list', address: 'https://example.ghostpair.test/checklist', heading: 'Less to carry. More to discover.', description: 'Leave a note for the person coming along.' },
  { id: 'notes', title: 'The little details', address: 'https://example.ghostpair.test/notes', heading: 'Good plans start with a conversation.', description: 'A few details to work out together.' },
] as const;
export type PageId = typeof catalog[number]['id'];
export type Field = 'notes' | 'notify' | 'submit';
export type Fields = { notes: string; notify: boolean; submit: boolean };
export type DemoTab = { id: number; approved: boolean; history: PageId[]; index: number; form: Fields; scroll: number };
export type Preview = { tabId: number; field: Field; value: string | boolean; expiresAt: number };
export type DemoState = {
  status: 'connected' | 'ended';
  tabs: DemoTab[]; activeId: number; nextId: number; mode: 'preview' | 'full'; paused: boolean; control: boolean;
  previews: Preview[]; notice: string; error: string; revision: number;
};
export type TourStep = 1 | 2 | 3;
export function tourStepFromHash(hash: string): TourStep { return hash.replace(/^#/, '') === 'modes' ? 2 : hash.replace(/^#/, '') === 'tabs' ? 3 : 1; }
export const legacyTourHashes = ['free', 'connect', 'modes', 'tabs', 'feedback', 'editing', 'clipboard', 'controls', 'limits', 'preview'] as const;
export const PREVIEW_DURATION = 500;
const originalFields = (): Fields => ({ notes: 'Find a quiet place by the water.', notify: false, submit: false });
const makeTab = (id: number, page: PageId = 'trip', approved = false): DemoTab => ({ id, approved, history: [page], index: 0, form: originalFields(), scroll: 0 });
export function initialState(): DemoState {
  return { status: 'connected', tabs: [makeTab(1, 'trip', true)], activeId: 1, nextId: 2, mode: 'preview', paused: false, control: true, previews: [], notice: '', error: '', revision: 0 };
}
export function activeTab(state: DemoState) { return state.tabs.find(tab => tab.id === state.activeId)!; }
export function canInteract(state: DemoState) { return canManage(state) && activeTab(state).approved; }
export function canManage(state: DemoState) { return state.status === 'connected' && !state.paused && state.control; }
export function previewFor(state: DemoState, field: Field) { return state.previews.find(item => item.tabId === state.activeId && item.field === field); }
export type Action =
  | { type: 'reset' | 'end' | 'pause' | 'control' }
  | { type: 'mode'; mode: DemoState['mode'] }
  | { type: 'field'; field: Field; value: string | boolean; now: number }
  | { type: 'expire'; now: number }
  | { type: 'open'; page: PageId; actor: 'host' | 'guest' }
  | { type: 'activate' | 'close'; id: number; actor: 'host' | 'guest' }
  | { type: 'approve' | 'release'; id: number }
  | { type: 'navigate'; page: PageId; actor: 'host' | 'guest' }
  | { type: 'history'; direction: -1 | 1; actor: 'host' | 'guest' }
  | { type: 'reload'; actor: 'host' | 'guest' }
  | { type: 'scroll'; position: number; actor: 'host' | 'guest' }
  | { type: 'notice'; text: string };
const changedTab = (state: DemoState, update: (tab: DemoTab) => DemoTab): DemoState => ({ ...state, tabs: state.tabs.map(tab => tab.id === state.activeId ? update(tab) : tab) });
const unavailable = (state: DemoState): DemoState => ({ ...state, error: '', notice: state.status === 'ended' ? 'The session has ended. Reset the demo to start again.' : state.paused ? 'The session is paused. Resume it on the host side.' : !state.control ? 'The host disabled interaction. You can still view the shared tab.' : 'This tab is waiting for the host to share it.' });
const hostOrAllowed = (actor: 'host' | 'guest', allowed: boolean) => actor === 'host' || allowed;
export function reducer(state: DemoState, action: Action): DemoState {
  switch (action.type) {
    case 'reset': return { ...initialState(), revision: state.revision + 1 };
    case 'end': return { ...state, status: 'ended', paused: false, previews: [], error: '', notice: 'The host ended the session. Reset the demo to start again.' };
    case 'pause': return state.status !== 'connected' ? state : { ...state, paused: !state.paused, previews: [], error: '', notice: state.paused ? 'Session resumed.' : 'Session paused. The shared view is suspended.' };
    case 'control': return state.status !== 'connected' ? state : { ...state, control: !state.control, previews: [], error: '', notice: state.control ? 'Interaction disabled. The guest can view only.' : 'Interaction enabled.' };
    case 'mode': return state.status !== 'connected' ? state : { ...state, mode: action.mode, previews: [], error: '', notice: action.mode === 'full' ? 'Full control: guest edits change the page.' : 'Preview changes: original values stay untouched.' };
    case 'field': {
      if (!canInteract(state)) return unavailable(state);
      const next = { ...state, error: '', notice: state.mode === 'preview' ? 'A preview. The original stays untouched.' : '' };
      if (state.mode === 'preview') {
        const text = action.field === 'notes';
        const preview: Preview = { tabId: state.activeId, field: action.field, value: action.value, expiresAt: action.now + PREVIEW_DURATION };
        return { ...next, previews: [...state.previews.filter(item => item.tabId !== state.activeId || item.field !== action.field).map(item => item.tabId === state.activeId && (item.field === 'notes') === text ? { ...item, expiresAt: preview.expiresAt } : item), preview] };
      }
      return { ...changedTab(next, tab => ({ ...tab, form: { ...tab.form, [action.field]: action.value, submit: action.field === 'submit' ? true : false } })), notice: action.field === 'submit' ? 'Plan saved in this local demo.' : 'The page changed for both people.' };
    }
    case 'expire': return { ...state, previews: state.previews.filter(item => item.expiresAt > action.now) };
    case 'open': {
      if (!hostOrAllowed(action.actor, canManage(state))) return unavailable(state);
      return { ...state, tabs: [...state.tabs, makeTab(state.nextId, action.page)], activeId: state.nextId, nextId: state.nextId + 1, previews: [], error: '', notice: 'New tab opened. The host must approve it before sharing.' };
    }
    case 'activate': {
      if (!hostOrAllowed(action.actor, canManage(state))) return unavailable(state);
      const tab = state.tabs.find(item => item.id === action.id);
      if (!tab) return state;
      return { ...state, activeId: action.id, previews: [], error: '', notice: tab.approved ? 'The active shared tab is visible.' : 'This tab is waiting for host approval.' };
    }
    case 'close': {
      if (!hostOrAllowed(action.actor, canManage(state)) || !state.tabs.some(tab => tab.id === action.id)) return unavailable(state);
      const tabs = state.tabs.filter(tab => tab.id !== action.id);
      if (!tabs.length) return { ...state, tabs: [makeTab(state.nextId)], activeId: state.nextId, nextId: state.nextId + 1, previews: [], error: '', notice: 'New tab opened. Host approval is required.' };
      return { ...state, tabs, activeId: state.activeId === action.id ? tabs[0]!.id : state.activeId, previews: state.previews.filter(item => item.tabId !== action.id), error: '', notice: 'Tab closed.' };
    }
    case 'approve': {
      if (state.status !== 'connected') return state;
      const tab = state.tabs.find(item => item.id === action.id);
      if (!tab || tab.approved) return state;
      if (state.tabs.filter(item => item.approved).length >= 5) return { ...state, error: 'Five tabs are already approved. Stop sharing a tab to make room.' };
      return { ...state, tabs: state.tabs.map(item => item.id === action.id ? { ...item, approved: true } : item), error: '', notice: 'The host approved this tab.' };
    }
    case 'release': return state.status !== 'connected' ? state : { ...state, tabs: state.tabs.map(tab => tab.id === action.id ? { ...tab, approved: false } : tab), previews: state.previews.filter(item => item.tabId !== action.id), error: '', notice: 'This tab is no longer shared. It remains open for the host.' };
    case 'navigate': {
      if (!hostOrAllowed(action.actor, canInteract(state))) return unavailable(state);
      return { ...changedTab(state, tab => ({ ...tab, history: [...tab.history.slice(0, tab.index + 1), action.page], index: tab.index + 1, form: originalFields(), scroll: 0 })), previews: [], error: '', notice: 'Both views followed the navigation.' };
    }
    case 'history': {
      if (!hostOrAllowed(action.actor, canInteract(state))) return unavailable(state);
      const tab = activeTab(state), index = tab.index + action.direction;
      if (index < 0 || index >= tab.history.length) return state;
      return { ...changedTab(state, item => ({ ...item, index, form: originalFields(), scroll: 0 })), previews: [], error: '', notice: 'Both views followed the navigation.' };
    }
    case 'reload': return hostOrAllowed(action.actor, canInteract(state)) ? { ...changedTab(state, tab => ({ ...tab, form: originalFields(), scroll: 0 })), previews: [], error: '', notice: 'Example page reloaded.' } : unavailable(state);
    case 'scroll': return hostOrAllowed(action.actor, canInteract(state)) ? changedTab(state, tab => ({ ...tab, scroll: Math.max(0, Math.min(100, action.position)) })) : unavailable(state);
    case 'notice': return { ...state, notice: action.text, error: '' };
  }
}
