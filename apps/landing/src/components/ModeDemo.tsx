import { useState } from "react";

type InteractionMode = "visual" | "live";

const initialNote = "Bring a camera.";

export default function ModeDemo() {
  const [mode, setMode] = useState<InteractionMode>("visual");
  const [guestNote, setGuestNote] = useState(initialNote);
  const [hostNote, setHostNote] = useState(initialNote);
  const [guestPacked, setGuestPacked] = useState(false);
  const [hostPacked, setHostPacked] = useState(false);

  function updateNote(note: string) {
    setGuestNote(note);
    if (mode === "live") setHostNote(note);
  }

  function updatePacked(packed: boolean) {
    setGuestPacked(packed);
    if (mode === "live") setHostPacked(packed);
  }

  function resetDemo() {
    setMode("visual");
    setGuestNote(initialNote);
    setHostNote(initialNote);
    setGuestPacked(false);
    setHostPacked(false);
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
              onChange={() => setMode("visual")}
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
              onChange={() => setMode("live")}
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
          <div className="demo-page">
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
            </div>
          </div>
        </section>

        <section className="mode-panel" aria-labelledby="host-original-title">
          <div className="mode-panel-label">
            <h3 id="host-original-title">Host’s original page</h3>
            <span className="mode-panel-status">Original</span>
          </div>
          <div className="demo-page">
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
