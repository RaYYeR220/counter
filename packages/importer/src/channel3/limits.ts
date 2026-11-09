export type Clock = () => number;
export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * In-memory cache with a fixed time to live. Concurrent `get`s for the same
 * key share one load. Failed loads, and values `keep` rejects, are not kept.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { at: number; value: Promise<T> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: Clock = Date.now,
    private readonly keep: (value: T) => boolean = () => true,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const value = load();
    const entry = { at: this.now(), value };
    this.entries.set(key, entry);
    value.then(
      (v) => {
        if (!this.keep(v) && this.entries.get(key) === entry) this.entries.delete(key);
        else entry.at = this.now();
      },
      () => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      },
    );
    return value;
  }
}

/** Spaces the start of calls at least `minIntervalMs` apart, in the order they arrive. */
export class RateGate {
  private last = Number.NEGATIVE_INFINITY;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly minIntervalMs: number,
    private readonly now: Clock = Date.now,
    private readonly sleep: Sleep = realSleep,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const turn = this.queue.then(async () => {
      const wait = this.last + this.minIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.last = this.now();
    });
    this.queue = turn;
    await turn;
    return fn();
  }
}
