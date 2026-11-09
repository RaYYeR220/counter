import "server-only";
import { timingSafeEqual } from "node:crypto";
import { logEvent } from "@counter/db";
import { db } from "@/lib/server/runtime";
import type { AddressInput, CartLineInput } from "./types";

/** Cookie the benchmark harness sets on a browser run; its value is the run id. */
export const BENCH_COOKIE = "counter_bench_run";
export const BENCH_EVENT = "bench.checkout";

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export function benchEnabled(): boolean {
  return Boolean(process.env.BENCH_KEY);
}

export function isRunId(value: string | null | undefined): value is string {
  return typeof value === "string" && RUN_ID.test(value);
}

/**
 * The run id for a storefront request in bench capture mode, or null. Capture
 * mode needs both the harness cookie and a configured BENCH_KEY.
 */
export function benchRunId(cookieValue: string | undefined): string | null {
  if (!benchEnabled()) return null;
  return isRunId(cookieValue) ? cookieValue : null;
}

function sameKey(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Gate for the bench API: 404 while BENCH_KEY is unset, 401 for a missing or
 * wrong `x-bench-key`, null when the caller may proceed.
 */
export function benchGate(req: Request): Response | null {
  const key = process.env.BENCH_KEY;
  if (!key) return Response.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
  const given = req.headers.get("x-bench-key");
  if (!given || !sameKey(given, key)) {
    return Response.json({ error: "unauthorized", message: "x-bench-key is missing or wrong" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  return null;
}

export interface BenchCapture {
  runId: string;
  shop: string;
  lines: CartLineInput[];
  shipping_address: AddressInput;
  shipping_option: string | null;
  /** Order total the buyer would approve in PayPal, e.g. "79.50". Null if the cart could not be priced. */
  total: string | null;
  validation_status: string | null;
  source: "storefront" | "api";
}

export async function recordBenchCheckout(capture: BenchCapture): Promise<{ id: number; at: string }> {
  const row = await logEvent(db(), capture.shop, BENCH_EVENT, capture.runId, { ...capture });
  return { id: row.id, at: row.at.toISOString() };
}

export async function listBenchCheckouts(runId: string, shop?: string) {
  const rows = await db().query.events.findMany({
    where: (e, { and, eq }) =>
      shop ? and(eq(e.type, BENCH_EVENT), eq(e.ref, runId), eq(e.shopId, shop)) : and(eq(e.type, BENCH_EVENT), eq(e.ref, runId)),
    orderBy: (e, { asc }) => [asc(e.id)],
    limit: 200,
  });
  return rows.map((r) => ({ id: r.id, at: r.at.toISOString(), ...(r.payload as unknown as BenchCapture) }));
}
