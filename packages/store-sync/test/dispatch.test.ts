import { describe, expect, it } from "vitest";
import { dispatchDate, quoteShipping } from "../src/shipping";
import { computeCart } from "../src/compute";
import { MemoryCatalog } from "../src/memory";

// Tuesday 2026-11-10, the bench's pinned store clock.
const NOW = new Date("2026-11-10T15:00:00Z");
const US = { address_line_1: "1 Main St", admin_area_2: "Austin", admin_area_1: "TX", postal_code: "78701", country_code: "US" };

describe("dispatch timing", () => {
  it("ships the same day with no lead time or handling", () => {
    expect(dispatchDate(NOW).toISOString().slice(0, 10)).toBe("2026-11-10");
  });

  it("counts lead time in calendar days, then handling in business days", () => {
    // 21 calendar days -> Tue Dec 1, then 2 business days -> Thu Dec 3
    expect(dispatchDate(NOW, { leadTimeDays: 21, handlingDays: 2 }).toISOString().slice(0, 10)).toBe("2026-12-03");
  });

  it("starts transit from the dispatch date", () => {
    const q = quoteShipping(US, 1000, NOW, { handlingDays: 2 });
    // dispatch Thu Nov 12; STANDARD +5 business days -> Thu Nov 19; EXPRESS +2 -> Mon Nov 16
    expect(q.find((o) => o.id === "STANDARD")!.estimatedDelivery).toBe("2026-11-19");
    expect(q.find((o) => o.id === "EXPRESS")!.estimatedDelivery).toBe("2026-11-16");
  });

  it("uses the slowest line of the cart", async () => {
    const catalog = new MemoryCatalog({
      shop: [
        { variantId: "FAST", parentId: "P1", name: "Ready mug", url: "u", priceCents: 3000, stock: 5, attributes: {}, active: true, handlingDays: 2 },
        { variantId: "SLOW", parentId: "P2", name: "Serving bowl", url: "u", priceCents: 12000, stock: 2, attributes: {}, active: true, leadTimeDays: 21, handlingDays: 2 },
      ],
    });
    const out = await computeCart(
      { items: [{ variant_id: "FAST", quantity: 1 }, { variant_id: "SLOW", quantity: 1 }], shipping_address: US } as never,
      catalog,
      "shop",
      { now: NOW },
    );
    const std = out.shipping.find((o) => o.id === "STANDARD")!;
    // dispatch Thu Dec 3 -> +5 business days -> Thu Dec 10
    expect(std.estimated_delivery).toBe("2026-12-10");
  });
});
