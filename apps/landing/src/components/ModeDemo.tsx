import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import "./mode-demo.css";

type InteractionMode = "visual" | "live";
type ClickHalo = { id: number; x: number; y: number };

const initialNote = "Bring a camera.";

export default function ModeDemo() {
  const [mode, setMode] = useState<InteractionMode>("visual");
  const [guestNote, setGuestNote] = useState(initialNote);
  const [hostNote, setHostNote] = useState(initialNote);
  const [guestPacked, setGuestPacked] = useState(false);
  const [hostPacked, setHostPacked] = useState(false);
  const [guestSaved, setGuestSaved] = useState(false);
  const [hostSaved, setHostSaved] = useState(false);
  const [clickHalos, setClickHalos] = useState<ClickHalo[]>([]);
  const nextHaloId = useRef(0);
  const haloTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const pointerStart = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const timers = haloTimers.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  function removeClickHalo(id: number) {
    clearTimeout(haloTimers.current.get(id));
    haloTimers.current.delete(id);
    setClickHalos((halos) => halos.filter((halo) => halo.id !== id));
  }

  function clearClickHalos() {
    haloTimers.current.forEach(clearTimeout);
    haloTimers.current.clear();
    pointerStart.current = null;
    setClickHalos([]);
  }

  function showClickHalo(page: HTMLDivElement, clientX: number, clientY: number) {
    if (mode !== "visual") return;
    const bounds = page.getBoundingClientRect();
    const id = nextHaloId.current++;
    const oldestId = haloTimers.current.keys().next().value;
    if (haloTimers.current.size >= 12 && oldestId !== undefined) {
      clearTimeout(haloTimers.current.get(oldestId));
      haloTimers.current.delete(oldestId);
    }
    setClickHalos((halos) => [
      ...halos.slice(-11),
      { id, x: clientX - bounds.left, y: clientY - bounds.top },
    ]);
    // Keep cleanup bounded even if a browser interrupts the CSS animation.
    haloTimers.current.set(id, setTimeout(() => removeClickHalo(id), 750));
  }

  function startPreviewClick(event: PointerEvent<HTMLDivElement>) {
    if (mode !== "visual" || !event.isPrimary || event.button !== 0) return;
    pointerStart.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }

  function finishPreviewClick(event: PointerEvent<HTMLDivElement>) {
    const start = pointerStart.current;
    if (!start || start.id !== event.pointerId || event.button !== 0) return;
    pointerStart.current = null;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
    // Pointer events fire once for label activation, before its forwarded input click.
    showClickHalo(event.currentTarget, event.clientX, event.clientY);
  }

  function previewKeyboardClick(event: KeyboardEvent<HTMLDivElement>) {
    if (event.repeat || !(event.target instanceof HTMLElement)) return;
    const target = event.target;
    const button = target instanceof HTMLButtonElement;
    const checkbox =
      target instanceof HTMLInputElement && target.type === "checkbox";
    if (
      (button && (event.key === "Enter" || event.key === " ")) ||
      (checkbox && event.key === " ")
    ) {
      const bounds = target.getBoundingClientRect();
      showClickHalo(
        event.currentTarget,
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
    }
  }

  function changeMode(nextMode: InteractionMode) {
    clearClickHalos();
    setMode(nextMode);
  }

  function updateNote(note: string) {
    setGuestNote(note);
    setGuestSaved(false);
    if (mode === "live") {
      setHostNote(note);
      setHostSaved(false);
    }
  }

  function updatePacked(packed: boolean) {
    setGuestPacked(packed);
    setGuestSaved(false);
    if (mode === "live") {
      setHostPacked(packed);
      setHostSaved(false);
    }
  }

  function savePlans() {
    if (mode !== "live") return;
    setGuestSaved(true);
    setHostSaved(true);
  }

  function resetDemo() {
    clearClickHalos();
    setMode("visual");
    setGuestNote(initialNote);
    setHostNote(initialNote);
    setGuestPacked(false);
    setHostPacked(false);
    setGuestSaved(false);
    setHostSaved(false);
  }

  return (
    <div className="mode-demo" data-mode={mode}>
      <p className="mode-demo-caption">
        Interactive illustration · Example data
      </p>

      <fieldset className="mode-switch">
        <legend>Interaction mode illustration</legend>
        <div className="mode-switch-options">
          <div className="mode-switch-option">
            <input
              id="mode-visual"
              type="radio"
              name="interaction-mode"
              value="visual"
              checked={mode === "visual"}
              onChange={() => changeMode("visual")}
              aria-describedby="mode-explanation"
            />
            <label htmlFor="mode-visual">Visual only</label>
          </div>
          <div className="mode-switch-option">
            <input
              id="mode-live"
              type="radio"
              name="interaction-mode"
              value="live"
              checked={mode === "live"}
              onChange={() => changeMode("live")}
              aria-describedby="mode-explanation"
            />
            <label htmlFor="mode-live">Live control</label>
          </div>
        </div>
      </fieldset>

      <p className="demo-mode-note" id="mode-explanation">
        {mode === "visual"
          ? "Clicks and typing are previews."
          : "Real page interactions, when the host allows them."}
      </p>

      <div className="mode-demo-panels">
        <section className="mode-panel" aria-labelledby="guest-preview-title">
          <div className="mode-panel-label">
            <h3 id="guest-preview-title">Guest preview</h3>
            <span className="mode-panel-status">
              {mode === "visual" ? "Preview" : "Live"}
            </span>
          </div>
          <div
            className="demo-page demo-guest"
            onPointerDownCapture={startPreviewClick}
            onPointerUpCapture={finishPreviewClick}
            onPointerCancelCapture={(event) => {
              if (pointerStart.current?.id === event.pointerId) {
                pointerStart.current = null;
              }
            }}
            onKeyDownCapture={previewKeyboardClick}
          >
            <div className="demo-page-header">
              <span className="demo-page-indicator" aria-hidden="true" />
              <span>Weekend plans</span>
            </div>
            <div className="demo-page-body">
              <label className="demo-note" htmlFor="guest-note">
                Guest note
              </label>
              <input
                id="guest-note"
                className="demo-note-input"
                type="text"
                value={guestNote}
                maxLength={120}
                onChange={(event) => updateNote(event.target.value)}
                autoComplete="off"
              />
              <label className="demo-check" htmlFor="guest-pack">
                <input
                  id="guest-pack"
                  type="checkbox"
                  checked={guestPacked}
                  onChange={(event) => updatePacked(event.target.checked)}
                />
                <span>Pack a camera</span>
              </label>
              <div className="demo-save-actions">
                <button className="demo-save" type="button" onClick={savePlans}>
                  Save plans
                </button>
                <p className="demo-save-status" role="status">
                  {guestSaved ? "Plans saved" : ""}
                </p>
              </div>
            </div>
            {clickHalos.map((halo) => (
              <span
                key={halo.id}
                className="demo-click-halo"
                style={{ left: halo.x - 15, top: halo.y - 15 }}
                onAnimationEnd={() => removeClickHalo(halo.id)}
                aria-hidden="true"
              />
            ))}
          </div>
        </section>

        <section className="mode-panel" aria-labelledby="host-original-title">
          <div className="mode-panel-label">
            <h3 id="host-original-title">Host’s original page</h3>
            <span className="mode-panel-status">Original</span>
          </div>
          <div className="demo-page demo-host">
            <div className="demo-page-header">
              <span className="demo-page-indicator" aria-hidden="true" />
              <span>Weekend plans</span>
            </div>
            <div className="demo-page-body">
              <span className="demo-note" id="host-note-label">
                Host note
              </span>
              <output
                className="demo-host-value"
                htmlFor="guest-note"
                aria-labelledby="host-note-label"
              >
                {hostNote || "No note"}
              </output>
              <div className="demo-check demo-check-host">
                <span
                  className="demo-host-checkbox"
                  role="img"
                  aria-label={hostPacked ? "Checked" : "Unchecked"}
                  data-checked={hostPacked}
                >
                  {hostPacked && (
                    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path
                        d="m3.5 8 3 3 6-6"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span>Pack a camera</span>
              </div>
              <div className="demo-save-actions">
                <span className="demo-save demo-save-preview" aria-hidden="true">
                  Save plans
                </span>
                <p className="demo-save-status" role="status">
                  {hostSaved ? "Plans saved" : ""}
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="mode-demo-footer">
        <p className="demo-mode-note">
          The host chooses the mode in a real session. Scrolling, navigation,
          and tab management remain live in both modes.
        </p>
        <button className="demo-reset" type="button" onClick={resetDemo}>
          Reset demonstration
        </button>
      </div>
    </div>
  );
}
