import type { CartRecord, PayPalCart } from "@counter/store-sync";
import { createTestDb, seedCatalog, type Db } from "../src/index";

export const SHOP = "juniper-clay";
export const NOW = new Date("2026-11-09T15:00:00.000Z");

export async function seededDb(): Promise<Db> {
  const db = await createTestDb();
  await seedCatalog(db, { publicBaseUrl: "https://counter.example" });
  return db;
}

const usd = (value: string) => ({ currency_code: "USD" as const, value });

export function cartRecord(over: Partial<CartRecord> = {}): CartRecord {
  return {
    id: "CART-AAAAAAAAAA",
    shopId: SHOP,
    status: "INCOMPLETE",
    cart: {
      id: "CART-AAAAAAAAAA",
      status: "INCOMPLETE",
      validation_status: "REQUIRES_ADDITIONAL_INFORMATION",
      items: [
        {
          variant_id: "JC-MUG-SPECKLE-SAGE-12",
          parent_id: "JC-MUG-SPECKLE",
          quantity: 2,
          name: "Speckled mug — sage, 12 oz",
          price: usd("34.00"),
          selected_attributes: [
            { name: "glaze", value: "sage" },
            { name: "size", value: "12 oz" },
          ],
        },
      ],
      totals: {
        subtotal: usd("68.00"),
        shipping: usd("0.00"),
        tax: usd("0.00"),
        total: usd("68.00"),
      },
    } satisfies PayPalCart,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}
