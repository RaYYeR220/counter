import type { StoreSyncDeps } from "@counter/store-sync";
import { ConcurrentUpdateError } from "./repos";

/**
 * Runs a Store Sync handler, and runs it again when its cart write lost a race
 * to another instance (`ConcurrentUpdateError`). Each run re-reads the cart, so
 * a retried PUT lands on top of the write that beat it: last write wins, as
 * within one instance. The handler answers a lost race with a 500 and reports
 * it through `onError`; on retry that report is swallowed, and only the last
 * attempt's failure reaches the caller's `onError`.
 */
export async function withCartRetry<T>(
  deps: StoreSyncDeps,
  run: (deps: StoreSyncDeps) => Promise<T>,
  opts: { attempts?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  for (let attempt = 1; ; attempt++) {
    let conflicted = false;
    const final = attempt >= attempts;
    const result = await run({
      ...deps,
      onError: (err, where) => {
        if (!final && err instanceof ConcurrentUpdateError) conflicted = true;
        else deps.onError?.(err, where);
      },
    });
    if (!conflicted) return result;
  }
}
