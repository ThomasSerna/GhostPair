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
type PreviewKind = "text" | "choice" | "button";

const initialNote = "Bring a camera.";
const previewDuration = 1000;

export default function ModeDemo() {
  const [mode, setMode] = useState<InteractionMode>("visual");
  const [hostNote, setHostNote] = useState(initialNote);
  const [hostPacked, setHostPacked] = useState(false);
  const [hostSaved, setHostSaved] = useState(false);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [previewPacked, setPreviewPacked] = useState<boolean | null>(null);
  const [previewButton, setPreviewButton] = useState(false);
  const [clickHalos, setClickHalos] = useState<ClickHalo[]>([]);
  const nextHaloId = useRef(0);
  const haloTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const previewTimers = useRef(
    new Map<PreviewKind, ReturnType<typeof setTimeout>>(),
  );
  const pointerStart = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const timers = haloTimers.current;
    const previews = previewTimers.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
      previews.forEach(clearTimeout);
      previews.clear();
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
    const bounds = page.getBoundingClientRect();
    const id = nextHaloId.current++;
    const oldestId = haloTimers.current.keys().next().value;
    if (haloTimers.current.size >= 12 && oldestId !== undefined) {
      clearTimeout(haloTimers.current.get(oldestId));
      haloTimers.current.delete(oldestId);
    }
    setClickHalos((halos) => [
      ...halos.slice(-11),
      {
        id,
        x: (clientX - bounds.left) / bounds.width,
        y: (clientY - bounds.top) / bounds.height,
      },
    ]);
    // Keep cleanup bounded even if a browser interrupts the CSS animation.
    haloTimers.current.set(
      id,
      setTimeout(() => removeClickHalo(id), previewDuration),
    );
  }

  function startPreviewClick(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
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
    if (
      mode === "visual" &&
      event.target instanceof Element &&
      event.target.closest(".demo-check")
    ) return;
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
      if (mode === "visual" && checkbox) return;
      const bounds = target.getBoundingClientRect();
      showClickHalo(
        event.currentTarget,
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
    }
  }

  function changeMode(nextMode: InteractionMode) {
    clearPreviews();
    clearClickHalos();
    setMode(nextMode);
  }

  function clearPreviews() {
    previewTimers.current.forEach(clearTimeout);
    previewTimers.current.clear();
    setPreviewNote(null);
    setPreviewPacked(null);
    setPreviewButton(false);
  }

  function expirePreview(kind: PreviewKind, clear: () => void) {
    clearTimeout(previewTimers.current.get(kind));
    previewTimers.current.set(
      kind,
      setTimeout(() => {
        previewTimers.current.delete(kind);
        clear();
      }, previewDuration),
    );
  }

  function updateNote(note: string) {
    if (mode === "live") {
      setHostNote(note);
      setHostSaved(false);
    } else {
      setPreviewNote(note);
      expirePreview("text", () => setPreviewNote(null));
    }
  }

  function updatePacked(packed: boolean) {
    if (mode === "live") {
      setHostPacked(packed);
      setHostSaved(false);
    } else {
      setPreviewPacked(packed);
      expirePreview("choice", () => setPreviewPacked(null));
    }
  }

  function savePlans() {
    if (mode !== "live") {
      setPreviewButton(true);
      expirePreview("button", () => setPreviewButton(false));
      return;
    }
    setHostSaved(true);
  }

  function resetDemo() {
    clearPreviews();
    clearClickHalos();
    setMode("visual");
    setHostNote(initialNote);
    setHostPacked(false);
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
            <label htmlFor="mode-visual">Preview changes</label>
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
            <label htmlFor="mode-live">Full control</label>
          </div>
        </div>
      </fieldset>

      <p className="demo-mode-note" id="mode-explanation">
        {mode === "visual"
          ? "Guest gestures appear as previews on the host’s page. Original values stay unchanged."
          : "Guest gestures change the host’s page, when the host allows control."}
      </p>

      <div className="mode-demo-panels">
        <section className="mode-panel" aria-labelledby="guest-preview-title">
          <div className="mode-panel-label">
            <h3 id="guest-preview-title">Guest input</h3>
            <span className="mode-panel-status">Remote input</span>
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
                value={previewNote ?? hostNote}
                maxLength={120}
                onChange={(event) => updateNote(event.target.value)}
                autoComplete="off"
              />
              <label className="demo-check" htmlFor="guest-pack">
                <input
                  id="guest-pack"
                  type="checkbox"
                  checked={previewPacked ?? hostPacked}
                  onChange={(event) => updatePacked(event.target.checked)}
                />
                <span>Pack a camera</span>
              </label>
              <div className="demo-save-actions">
                <button className="demo-save" type="button" onClick={savePlans}>
                  Save plans
                </button>
                <p className="demo-save-status" role="status">
                  {hostSaved ? "Plans saved" : ""}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mode-panel" aria-labelledby="host-original-title">
          <div className="mode-panel-label">
            <h3 id="host-original-title">Host’s shared page</h3>
            <span className="mode-panel-status">
              {mode === "visual" ? "Preview overlay" : "Live"}
            </span>
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
              <div className="demo-host-field">
                <output
                  className="demo-host-value"
                  htmlFor="guest-note"
                  aria-labelledby="host-note-label"
                >
                  {hostNote}
                </output>
                {previewNote !== null && (
                  <span className="demo-text-preview">{previewNote}</span>
                )}
              </div>
              <div className="demo-check demo-check-host">
                <span className="demo-choice-field">
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
                  {previewPacked !== null && (
                    <span
                      className="demo-choice-preview"
                      role="img"
                      aria-label={previewPacked ? "Preview checked" : "Preview unchecked"}
                      data-checked={previewPacked}
                    >
                      {previewPacked && (
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
                  )}
                </span>
                <span>Pack a camera</span>
              </div>
              <div className="demo-save-actions">
                <span className="demo-button-field">
                  <span className="demo-save demo-save-preview" aria-hidden="true">
                    Save plans
                  </span>
                  {previewButton && (
                    <span className="demo-button-preview" aria-hidden="true" />
                  )}
                </span>
                <p className="demo-save-status" role="status">
                  {hostSaved ? "Plans saved" : ""}
                </p>
              </div>
            </div>
            {clickHalos.map((halo) => (
              <span
                key={halo.id}
                className="demo-click-halo"
                style={{
                  left: `calc(${halo.x * 100}% - 15px)`,
                  top: `calc(${halo.y * 100}% - 15px)`,
                }}
                aria-hidden="true"
              />
            ))}
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
      <p className="demo-preview-timing">
        Demo previews last 1 second. Preview duration is configurable.
      </p>
    </div>
  );
}
