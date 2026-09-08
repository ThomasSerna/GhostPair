/** Clipboard replication is opt-in and restricted to text for the active session. */
export interface ClipboardAdapter {
  read(): Promise<string>;
  write(text: string): Promise<void>;
}

export interface ClipboardUpdate {
  counter: number;
  origin: string;
  text: string;
}

export const MAX_CLIPBOARD_BYTES = 256 * 1024;
export const textBytes = (text: string): number => new TextEncoder().encode(text).byteLength;

export function newerClipboard(a: ClipboardUpdate, b: Pick<ClipboardUpdate, 'counter' | 'origin'>): boolean {
  return a.counter > b.counter || (a.counter === b.counter && a.origin > b.origin);
}

export class ClipboardSync {
  private timer?: ReturnType<typeof setTimeout>;
  private epoch = 0;
  private active = false;
  private baseline = '';
  private version = { counter: 0, origin: '' };
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly origin: string,
    private readonly adapter: ClipboardAdapter,
    private readonly send: (update: ClipboardUpdate) => void,
    private readonly onError: (message: string) => void,
  ) {}

  private serial(operation: () => Promise<void>): Promise<void> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    const epoch = ++this.epoch;
    await this.serial(async () => {
      if (!this.current(epoch)) return;
      try {
        const initial = await this.adapter.read();
        if (!this.current(epoch)) return;
        this.baseline = initial;
        this.schedule(epoch);
      } catch {
        if (!this.current(epoch)) return;
        this.stop();
        this.onError('Could not read the clipboard. Check extension permissions.');
      }
    });
  }

  stop(): void {
    this.active = false;
    this.epoch += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.baseline = '';
  }

  private current(epoch: number): boolean { return this.active && this.epoch === epoch; }

  get isActive(): boolean { return this.active; }

  private schedule(epoch: number): void {
    if (!this.current(epoch)) return;
    this.timer = setTimeout(() => {
      void this.poll().finally(() => this.schedule(epoch));
    }, 500);
  }

  /** Public for deterministic testing; production polling remains strictly serial. */
  async poll(): Promise<void> {
    const epoch = this.epoch;
    return this.serial(async () => {
      if (!this.current(epoch)) return;
      try {
        const text = await this.adapter.read();
        if (!this.current(epoch) || text === this.baseline) return;
        this.baseline = text;
        if (textBytes(text) > MAX_CLIPBOARD_BYTES) {
          this.onError('The text exceeds the 256 KiB limit and was not shared.');
          return;
        }
        if (this.version.counter >= Number.MAX_SAFE_INTEGER - 1) {
          this.stop();
          this.onError('Start a new session to continue clipboard synchronization.');
          return;
        }
        this.version = { counter: this.version.counter + 1, origin: this.origin };
        this.send({ ...this.version, text });
      } catch {
        if (!this.current(epoch)) return;
        this.stop();
        this.onError('Se detuvo el portapapeles porque no pudo leerse.');
      }
    });
  }

  async receive(update: ClipboardUpdate): Promise<void> {
    const epoch = this.epoch;
    await this.serial(async () => {
      if (!this.current(epoch) || !Number.isSafeInteger(update.counter) || update.counter < 1 || update.counter > Number.MAX_SAFE_INTEGER - 1 ||
          typeof update.origin !== 'string' || !update.origin || update.origin.length > 128 || typeof update.text !== 'string' ||
          textBytes(update.text) > MAX_CLIPBOARD_BYTES || !newerClipboard(update, this.version)) return;
      try {
        await this.adapter.write(update.text);
        if (!this.current(epoch)) return;
        this.version = { counter: update.counter, origin: update.origin };
        this.baseline = update.text;
      } catch {
        if (!this.current(epoch)) return;
        this.stop();
        this.onError('Se detuvo el portapapeles porque no pudo escribirse.');
      }
    });
  }
}

/** execCommand is isolated here because the offscreen document cannot receive focus. */
export function createDomClipboard(doc: Document): ClipboardAdapter {
  const field = doc.createElement('textarea');
  field.setAttribute('aria-label', 'Portapapeles temporal de GhostPair');
  doc.body.append(field);
  return {
    async read() {
      field.value = '';
      field.focus();
      field.select();
      try {
        if (!doc.execCommand('paste')) throw new Error('Clipboard read failed');
        return field.value;
      } finally { field.value = ''; }
    },
    async write(text) {
      field.value = text;
      field.focus();
      field.select();
      try {
        if (!doc.execCommand('copy')) throw new Error('Clipboard write failed');
      } finally { field.value = ''; }
    },
  };
}
