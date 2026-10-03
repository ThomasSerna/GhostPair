import { VisualSecondsSchema, type VisualPreferences } from '@ghostpair/protocol';

const colors = [
  ['Purple', '#7871e8'], ['Blue', '#3b82f6'], ['Green', '#22c55e'],
  ['Orange', '#f97316'], ['Pink', '#ec4899'],
] as const;

export function SimulationPreferences({ preferences, busy, onChange }: {
  preferences: VisualPreferences;
  busy: boolean;
  onChange: (preferences: VisualPreferences) => void;
}) {
  return <>
    <label className="check"><input type="checkbox" checked={preferences.showInteractions} disabled={busy} onChange={e => onChange({ ...preferences, showInteractions: e.target.checked })}/><span>Show their actions<small>Show previews and click feedback on the shared page. Changes made with Full control remain visible.</small></span></label>
    <label className="check"><input type="checkbox" checked={preferences.clickAnimations} disabled={busy} onChange={e => onChange({ ...preferences, clickAnimations: e.target.checked })}/><span>Show where they click<small>Highlight clicks when their actions are visible.</small></span></label>
    {(['text', 'other'] as const).map(category => <fieldset className="simulation-lifetime" key={category} disabled={busy}>
    <legend>{category === 'text' ? 'Text previews' : 'Other previews'}</legend>
    <label>Keep previews<select value={preferences[category].duration} onChange={e => onChange({ ...preferences, [category]: { ...preferences[category], duration: e.target.value } })}><option value="persistent">Until cleared</option><option value="temporary">For a short time</option></select></label>
    {preferences[category].duration === 'temporary' && <label>Seconds without activity<input type="number" min={0.1} max={10} step={0.1} defaultValue={preferences[category].seconds} key={preferences[category].seconds} onBlur={e => {
      const seconds = e.target.valueAsNumber;
      if (!VisualSecondsSchema.safeParse(seconds).success) { e.target.value = String(preferences[category].seconds); return; }
      if (seconds !== preferences[category].seconds) onChange({ ...preferences, [category]: { ...preferences[category], seconds } });
    }}/><small className="helper">0.1–10 seconds, in steps of 0.1.</small></label>}
    </fieldset>)}
    <fieldset className="simulation-colors" disabled={busy}>
      <legend>Interaction color</legend>
      <div className="color-options">{colors.map(([name, color]) => <label key={color}>
        <input type="radio" name="simulation-color" value={color} checked={preferences.accentColor === color} onChange={() => onChange({ ...preferences, accentColor: color })}/>
        <span className="color-swatch" style={{ backgroundColor: color }}/><span>{name}</span>
      </label>)}</div>
      <label className="custom-color">Custom color<input type="color" value={preferences.accentColor} onChange={e => onChange({ ...preferences, accentColor: e.target.value })}/></label>
    </fieldset>
    <label className="check"><input type="checkbox" checked={preferences.showHostPanel} disabled={busy} onChange={e => onChange({ ...preferences, showHostPanel: e.target.checked })}/><span>Show page controls<small>Show GhostPair controls on the shared page. Turn this on to restore a hidden panel.</small></span></label>
    <label className="check"><input type="checkbox" checked={preferences.notices} disabled={busy} onChange={e => onChange({ ...preferences, notices: e.target.checked })}/><span>Visual notices<small>Briefly label click and typing previews on the shared page.</small></span></label>
  </>;
}
