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

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...(signal ? { signal } : {}) });
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(body.message ?? `${url} answered ${res.status}`);
  return body;
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
