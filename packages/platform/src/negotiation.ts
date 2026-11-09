import { and, desc, eq } from "drizzle-orm";
import { getShop, listVariants, logEvent, negotiations, offers, type Db } from "@counter/db";
import {
  negotiate,
  OfferBook,
  OfferDiscounts,
  type ChatModel,
  type Offer,
  type OfferStore,
  type SellerLine,
  type Turn,
} from "@counter/negotiate";
import { fmt } from "@counter/store-sync";

/** Offers kept in Postgres, so every serverless instance applies the same deals. */
export class DbOfferStore implements OfferStore {
  constructor(private readonly db: Db) {}

  async save(offer: Offer): Promise<void> {
    await this.db
      .insert(offers)
      .values({
        id: offer.id,
        shopId: offer.shopId,
        agentClient: offer.agentClient,
        lines: offer.lines.map((l) => ({ ...l })),
        discountCents: offer.discountCents,
        createdAt: offer.createdAt,
        expiresAt: offer.expiresAt,
      })
      .onConflictDoNothing();
  }

  async forAgent(shopId: string, agentClient: string): Promise<Offer[]> {
    const rows = await this.db
      .select()
      .from(offers)
      .where(and(eq(offers.shopId, shopId), eq(offers.agentClient, agentClient)))
      .orderBy(desc(offers.createdAt))
      .limit(50);
    return rows.map((r) => ({
      id: r.id,
      shopId: r.shopId,
      agentClient: r.agentClient,
      lines: r.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitCents: l.unitCents, listCents: l.listCents ?? l.unitCents })),
      discountCents: r.discountCents,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
    }));
  }
}

export function offerBook(db: Db): OfferBook {
  return new OfferBook({ store: new DbOfferStore(db) });
}

export function offerDiscounts(db: Db): OfferDiscounts {
  return new OfferDiscounts(offerBook(db));
}

export interface HaggleRequest {
  shop: string;
  items: Array<{ variant_id: string; quantity: number }>;
  message: string;
  agentClient: string;
  history?: Turn[];
}

export interface HaggleResult {
  reply: string;
  verdict: "accept" | "clamped" | "refuse" | "none";
  offer?: {
    offer_id: string;
    lines: Array<{ variant_id: string; quantity: number; unit_price: string; list_price: string }>;
    discount: string;
    expires_at: string;
  };
  unknown_items?: string[];
}

/**
 * Runs one round of haggling for a shop. The seller model talks; the pricing
 * engine inside `negotiate` decides. Floors and costs never leave this function.
 */
export class NegotiationService {
  constructor(
    private readonly db: Db,
    private readonly llm: ChatModel,
    private readonly model: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async haggle(req: HaggleRequest): Promise<HaggleResult> {
    const shop = await getShop(this.db, req.shop);
    if (!shop) throw new Error(`Unknown shop ${req.shop}`);
    const variants = new Map((await listVariants(this.db, shop.slug)).map((v) => [v.variantId, v]));

    const lines: SellerLine[] = [];
    const unknown: string[] = [];
    for (const item of req.items) {
      const v = variants.get(item.variant_id);
      if (!v || !v.active || !v.purchasable) {
        unknown.push(item.variant_id);
        continue;
      }
      lines.push({
        variantId: v.variantId,
        name: v.name,
        quantity: item.quantity,
        listCents: v.priceCents,
        floorCents: v.floorCents,
        stock: v.stock,
      });
    }
    if (lines.length === 0) {
      return {
        reply: "None of those items can be ordered here, so there is nothing to price.",
        verdict: "refuse",
        unknown_items: unknown,
      };
    }

    const result = await negotiate({
      shop: {
        id: shop.slug,
        name: shop.name,
        owner: shop.owner,
        about: shop.about,
        tagline: shop.tagline,
        policy: {
          enabled: shop.policy.negotiation.enabled,
          maxDiscountPct: shop.policy.negotiation.max_discount_pct,
          bundleMinItems: shop.policy.negotiation.bundle_min_items,
        },
      },
      lines,
      buyerMessage: req.message,
      ...(req.history ? { history: req.history } : {}),
      agentClient: req.agentClient,
      llm: this.llm,
      model: this.model,
      offers: offerBook(this.db),
      now: this.now(),
    });

    const first = lines[0]!;
    const finalFirst = result.deal.lines.find((l) => l.variantId === first.variantId);
    await this.db.insert(negotiations).values({
      shopId: shop.slug,
      agentClient: req.agentClient,
      variantId: first.variantId,
      transcript: [
        ...(req.history ?? []),
        { from: "buyer", text: req.message },
        { from: "seller", text: result.reply, verdict: result.verdict, offerId: result.offer?.id ?? null, discountCents: result.deal.discountCents },
      ],
      outcome: result.verdict,
      finalUnitCents: finalFirst?.unitCents ?? first.listCents,
      floorCents: first.floorCents,
    });
    await logEvent(this.db, shop.slug, `negotiation.${result.verdict}`, result.offer?.id ?? null, {
      agent: req.agentClient,
      lines: result.deal.lines.map((l) => ({ variant_id: l.variantId, quantity: l.quantity, unit: fmt(l.unitCents), list: fmt(l.listCents) })),
      discount: fmt(result.deal.discountCents),
      reply_source: result.trace.replySource,
      ms: Math.round(result.trace.latencyMs),
    }).catch(() => undefined);

    return {
      reply: result.reply,
      verdict: result.verdict,
      ...(result.offer
        ? {
            offer: {
              offer_id: result.offer.id,
              lines: result.offer.lines.map((l) => ({
                variant_id: l.variantId,
                quantity: l.quantity,
                unit_price: fmt(l.unitCents),
                list_price: fmt(l.listCents),
              })),
              discount: fmt(result.offer.discountCents),
              expires_at: result.offer.expiresAt.toISOString(),
            },
          }
        : {}),
      ...(unknown.length ? { unknown_items: unknown } : {}),
    };
  }
}
