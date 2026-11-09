"use client";

import type {
  ConsoleAction,
  ConsoleActionResult,
  ConsoleEvent,
  ConsoleNegotiation,
  ConsoleOrder,
  ConsoleSummary,
  ConsoleVariant,
} from "./types";

// Browser-side calls to the Console API.

/** A Console API call that failed; `status` 401 means the merchant session is missing or over. */
export class ConsoleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const needsSignIn = (err: unknown) => err instanceof ConsoleApiError && err.status === 401;

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...(signal ? { signal } : {}) });
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new ConsoleApiError(body.message ?? `${url} answered ${res.status}`, res.status);
  return body;
}

async function session(method: "POST" | "DELETE", shop?: string): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch("/api/console/session", {
    method,
    headers: { "content-type": "application/json" },
    ...(shop ? { body: JSON.stringify({ shop }) } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  return { ok: res.ok && body.ok !== false, ...(body.message ? { message: body.message } : {}) };
}

const base = (shop: string) => `/api/console/${encodeURIComponent(shop)}`;

export const consoleApi = {
  summary: (shop: string, signal?: AbortSignal) => getJson<ConsoleSummary>(`${base(shop)}/summary`, signal),
  events: (shop: string, since?: number, signal?: AbortSignal) =>
    getJson<{ events: ConsoleEvent[]; lastEventId: number }>(`${base(shop)}/events${since != null ? `?since=${since}` : ""}`, signal),
  orders: (shop: string, signal?: AbortSignal) => getJson<{ orders: ConsoleOrder[] }>(`${base(shop)}/orders`, signal),
  negotiations: (shop: string, signal?: AbortSignal) =>
    getJson<{ negotiations: ConsoleNegotiation[] }>(`${base(shop)}/negotiations`, signal),
  catalog: (shop: string, signal?: AbortSignal) => getJson<{ variants: ConsoleVariant[] }>(`${base(shop)}/catalog`, signal),

  /** Opens the demo merchant session for `shop` (an httpOnly cookie the API reads). */
  signIn: (shop: string) => session("POST", shop),
  signOut: () => session("DELETE"),

  async act(shop: string, action: ConsoleAction, signal?: AbortSignal): Promise<ConsoleActionResult> {
    const res = await fetch(`${base(shop)}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
      ...(signal ? { signal } : {}),
    });
    const body = (await res.json().catch(() => ({ ok: false, message: `The action failed (${res.status})` }))) as ConsoleActionResult;
    return res.ok ? body : { ...body, ok: false, message: body.message || `The action failed (${res.status})` };
  },
};
