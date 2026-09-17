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
    <label>Simulation duration<select value={preferences.duration} disabled={busy} onChange={e => onChange({ ...preferences, duration: e.target.value as VisualPreferences['duration'] })}><option value="persistent">Until cleared</option><option value="temporary">Temporary</option></select></label>
    {preferences.duration === 'temporary' && <label>Seconds without interaction<input type="number" min={0.1} max={30} step={0.1} defaultValue={preferences.seconds} key={preferences.seconds} disabled={busy} onBlur={e => {
      const seconds = e.target.valueAsNumber;
      if (!VisualSecondsSchema.safeParse(seconds).success) { e.target.value = String(preferences.seconds); return; }
      if (seconds !== preferences.seconds) onChange({ ...preferences, seconds });
    }}/><small className="helper">0.1–30 seconds, in steps of 0.1.</small></label>}
    <fieldset className="simulation-colors" disabled={busy}>
      <legend>Simulation color</legend>
      <div className="color-options">{colors.map(([name, color]) => <label key={color}>
        <input type="radio" name="simulation-color" value={color} checked={preferences.accentColor === color} onChange={() => onChange({ ...preferences, accentColor: color })}/>
        <span className="color-swatch" style={{ backgroundColor: color }}/><span>{name}</span>
      </label>)}</div>
      <label className="custom-color">Custom color<input type="color" value={preferences.accentColor} onChange={e => onChange({ ...preferences, accentColor: e.target.value })}/><span>{preferences.accentColor}</span></label>
    </fieldset>
    <label className="check"><input type="checkbox" checked={preferences.notices} disabled={busy} onChange={e => onChange({ ...preferences, notices: e.target.checked })}/><span>Simulation notices<small>Briefly label simulated clicks and typing on the shared page.</small></span></label>
  </>;
}
