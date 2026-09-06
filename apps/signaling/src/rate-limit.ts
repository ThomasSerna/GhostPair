/** Fixed windows with a bounded key count, including attacker-controlled IP/device keys. */
export class RateLimit {
  private readonly entries = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 20_000,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const entry = this.entries.get(key);
    if (entry && entry.until > now) {
      if (entry.count >= this.limit) return false;
      entry.count += 1;
      return true;
    }
    if (!entry && this.entries.size >= this.maxKeys) {
      for (const [oldKey, value] of this.entries) {
        if (value.until <= now) this.entries.delete(oldKey);
      }
      if (this.entries.size >= this.maxKeys) return false;
    }
    this.entries.set(key, { count: 1, until: now + this.windowMs });
    return true;
  }
}
