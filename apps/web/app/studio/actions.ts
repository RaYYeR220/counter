"use server";

import { randomBytes } from "node:crypto";
import { getShop, orderPrefixFor, shops, type Shop, type ShopPolicy } from "@counter/db";
import {
  Channel3Error,
  ImportError,
  importDrafts,
  PublishError,
  publishDrafts,
  suggestFloor,
  type ImportInput,
  type ProductDraft,
} from "@counter/importer";
import { LlmError } from "@counter/negotiate";
import { startOnboarding } from "@counter/platform";
import { like } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { floorPolicy, importDeps, ProductDraftSchema } from "@/app/api/studio/_lib/studio";
import { floorParts, type FloorSource } from "@/components/studio/floor";
import type { ActionState, ImportResult, PublishResult, StudioDraft } from "@/components/studio/types";
import { baseUrl, db, paypal, paypalConfigured } from "@/lib/server/runtime";

// Studio's server actions. They run the importer and publisher on the server
// directly, so no merchant key ever reaches the browser. Anyone can open
// Studio, so imports are rate-limited per address, and writes go only to
// test shops (`try-…`); the demo shops keep their seeded catalog.

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const TEST_PREFIX = "try-";
const MAX_PHOTO_BYTES = 1024 * 1024;
const MAX_CSV_CHARS = 200_000;
const MAX_TEST_SHOPS = 60;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// ---------------------------------------------------------------------------
// Limits: a sliding window per address and action, per server instance.

const windows = new Map<string, number[]>();

async function callerKey(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

async function allow(action: string, max: number, windowMs: number): Promise<boolean> {
  const key = `${action}:${await callerKey()}`;
  const now = Date.now();
  const hits = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    windows.set(key, hits);
    return false;
  }
  hits.push(now);
  windows.set(key, hits);
  if (windows.size > 5000) for (const [k, v] of windows) if (!v.some((t) => now - t < 10 * 60_000)) windows.delete(k);
  return true;
}

const isTestShop = (slug: string) => slug.startsWith(TEST_PREFIX);

async function shopFrom(raw: unknown): Promise<Shop | null> {
  const slug = typeof raw === "string" ? raw.trim() : "";
  if (!SLUG.test(slug)) return null;
  return getShop(db(), slug);
}

// ---------------------------------------------------------------------------
// Import

/** Where each variant's floor came from: the floor rule (and which part of it), or the import itself. */
function floorSources(draft: ProductDraft, shop: Shop): FloorSource[] {
  const policy = floorPolicy(shop);
  return draft.variants.map((v) => {
    for (const market of draft.market ? [draft.market, undefined] : [undefined]) {
      if (v.floorCents !== suggestFloor(v, market, policy)) continue;
      const parts = floorParts(v.priceCents, v.costCents, market?.lowCents, policy.maxDiscountPct);
      if (parts.floorCents === v.floorCents) return parts.source;
    }
    return "given";
  });
}

function importProblem(err: unknown): string {
  if (err instanceof ImportError) return err.message;
  if (err instanceof Channel3Error) {
    return err.code === "rate_limited"
      ? "The product lookup service is busy. Try again in a minute."
      : "The product lookup service didn't answer. Try again in a minute.";
  }
  if (err instanceof LlmError) return "The model that reads products didn't answer. Try again in a moment.";
  console.error("studio.import", err);
  return "The import failed on our side. Try again, or try a different source.";
}

/**
 * Turns a product page URL, a photo or a CSV paste into drafts for review.
 * Nothing is written. At most 3 imports a minute per address; photos up to
 * 1 MB (the page downsizes them first), CSV up to 200 KB.
 */
export async function importProducts(form: FormData): Promise<ImportResult> {
  const shop = await shopFrom(form.get("shop"));
  if (!shop) return { ok: false, message: "That shop doesn't exist." };
  if (!process.env.VENICE_API_KEY) return { ok: false, message: "Imports aren't set up on this deployment yet." };

  let input: ImportInput;
  const kind = form.get("kind");
  if (kind === "url") {
    const parsed = z
      .string()
      .trim()
      .url()
      .max(2000)
      .refine((u) => /^https?:\/\//i.test(u))
      .safeParse(form.get("url"));
    if (!parsed.success) return { ok: false, message: "Paste the full product page address, starting with https://." };
    input = { url: parsed.data };
  } else if (kind === "photo") {
    const photo = form.get("photo");
    if (!(photo instanceof File) || photo.size === 0) return { ok: false, message: "Choose a product photo first." };
    if (!PHOTO_TYPES.has(photo.type)) return { ok: false, message: "Use a JPEG, PNG or WebP photo." };
    if (photo.size > MAX_PHOTO_BYTES) return { ok: false, message: "That photo is over 1 MB even after resizing. Try a smaller one." };
    input = { photo: { bytes: new Uint8Array(await photo.arrayBuffer()), mime: photo.type, filename: photo.name.slice(0, 200) } };
  } else if (kind === "csv") {
    const csv = form.get("csv");
    const text = typeof csv === "string" ? csv : csv instanceof File ? await csv.text() : "";
    if (!text.trim()) return { ok: false, message: "Paste CSV rows or choose a .csv file first." };
    if (text.length > MAX_CSV_CHARS) return { ok: false, message: "Keep CSV imports under 200 KB here; split bigger catalogs." };
    input = { csv: text };
  } else {
    return { ok: false, message: "Pick a product URL, a photo or a CSV." };
  }

  if (!(await allow("import", 3, 60_000))) {
    return { ok: false, message: "That's 3 imports this minute. Wait a moment and try again." };
  }

  try {
    const drafts = await importDrafts(input, importDeps(shop));
    const out: StudioDraft[] = drafts.map((draft) => ({ draft, floorSources: floorSources(draft, shop) }));
    return { ok: true, drafts: out };
  } catch (err) {
    return { ok: false, message: importProblem(err) };
  }
}

// ---------------------------------------------------------------------------
// Publish

const PublishBody = z.object({
  shop: z.string().regex(SLUG),
  drafts: z.array(ProductDraftSchema).min(1).max(20),
});

/** Writes reviewed drafts into a test shop's catalog, where agents can find and buy them. */
export async function publishProducts(shopSlug: string, drafts: unknown): Promise<PublishResult> {
  const body = PublishBody.safeParse({ shop: shopSlug, drafts });
  if (!body.success) return { ok: false, message: "Some drafts are incomplete. Check names, prices and stock, then publish again." };
  if (!isTestShop(body.data.shop)) {
    return {
      ok: false,
      message: "Demo shops keep their seeded catalog so every visitor sees the same shop. Create a test shop to publish.",
    };
  }
  if (!(await allow("publish", 6, 60_000))) return { ok: false, message: "That's a lot of publishing this minute. Wait a moment." };
  try {
    const out = await publishDrafts(db(), body.data.shop, body.data.drafts as ProductDraft[], { publicBaseUrl: baseUrl() });
    return { ok: true, products: out.products, variants: out.variants, created: out.created, updated: out.updated };
  } catch (err) {
    if (err instanceof PublishError) {
      return err.code === "shop_not_found"
        ? { ok: false, message: "That test shop no longer exists." }
        : { ok: false, message: "Fix these before publishing:", problems: err.problems };
    }
    console.error("studio.publish", err);
    return { ok: false, message: "Publishing failed on our side. Nothing was changed; try again." };
  }
}

// ---------------------------------------------------------------------------
// Test shops

const TEST_POLICY: ShopPolicy = {
  returns_days: 30,
  ships_from_state: "OR",
  handling_days: 2,
  negotiation: { enabled: true, max_discount_pct: 10, bundle_min_items: 3 },
};

/** Creates an empty test shop (`try-<random>`) to import and publish into, then opens it in Studio. */
export async function createTestShop(_prev: ActionState, form: FormData): Promise<ActionState> {
  const name = String(form.get("name") ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  if (!(await allow("create-shop", 2, 10 * 60_000))) {
    return { ok: false, message: "You've made two test shops in the last few minutes. Use one of those, or try again later." };
  }
  let slug: string;
  try {
    const existing = await db().select({ id: shops.id }).from(shops).where(like(shops.slug, `${TEST_PREFIX}%`)).limit(MAX_TEST_SHOPS);
    if (existing.length >= MAX_TEST_SHOPS) return { ok: false, message: "There are too many test shops right now. Try again later." };
    slug = `${TEST_PREFIX}${randomBytes(4).toString("hex")}`;
    await db()
      .insert(shops)
      .values({
        id: slug,
        slug,
        name: name || "Test shop",
        owner: "Studio",
        city: "Portland, OR",
        state: "OR",
        tagline: "A test shop made in Studio.",
        about: "Products here were published from Counter Studio to try the import and publishing flow.",
        policy: TEST_POLICY,
        orderPrefix: orderPrefixFor(slug),
      });
  } catch (err) {
    console.error("studio.create-shop", err);
    return { ok: false, message: "The test shop couldn't be created. Try again." };
  }
  redirect(`/studio?shop=${encodeURIComponent(slug)}&created=1`);
}

// ---------------------------------------------------------------------------
// PayPal

/**
 * Sends a test shop's owner to PayPal to connect their own sandbox account.
 * Demo shops are paid to the platform account and are not reconnected here.
 */
export async function connectPayPal(_prev: ActionState, form: FormData): Promise<ActionState> {
  const shop = await shopFrom(form.get("shop"));
  if (!shop) return { ok: false, message: "That shop doesn't exist." };
  if (!isTestShop(shop.slug)) return { ok: false, message: "Demo shops are pre-connected to the platform's PayPal sandbox account." };
  if (!paypalConfigured()) return { ok: false, message: "Payments aren't connected on this deployment yet, so PayPal signup can't start." };
  if (!(await allow("onboarding", 3, 10 * 60_000))) return { ok: false, message: "Wait a few minutes before starting PayPal signup again." };
  let actionUrl: string;
  try {
    ({ actionUrl } = await startOnboarding(paypal(), {
      shopSlug: shop.slug,
      returnUrl: `${baseUrl()}/api/onboarding/return?shop=${encodeURIComponent(shop.slug)}`,
    }));
  } catch (err) {
    console.error("studio.onboarding", err);
    return { ok: false, message: "PayPal didn't start the signup. Try again in a moment." };
  }
  redirect(actionUrl);
}
