import type { CatalogVariant, PayPalCart } from "../src/index";

export const SHOP = "juniper-clay";
export const OTHER_SHOP = "northpaw";

/** Monday, 2026-11-09 15:00 UTC. */
export const NOW = new Date("2026-11-09T15:00:00Z");

function variant(
  variantId: string,
  parentId: string,
  name: string,
  priceCents: number,
  stock: number,
  extra: Partial<CatalogVariant> = {},
): CatalogVariant {
  return {
    variantId,
    parentId,
    name,
    url: `https://shop.example/p/${variantId.toLowerCase()}`,
    priceCents,
    stock,
    attributes: {},
    active: true,
    ...extra,
  };
}

export const MUG = variant("MUG-BLU-12", "MUG", "Speckled Mug (Blue, 12 oz)", 2500, 40, {
  attributes: { color: "Blue", size: "12 oz" },
});
export const TEE = variant("TEE-BLK-M", "TEE", "Studio Tee (Black, M)", 1800, 10);
export const BOWL = variant("BOWL-SAGE", "BOWL", "Serving Bowl (Sage)", 3200, 5);
export const OOS = variant("MUG-RED-12", "MUG", "Speckled Mug (Red, 12 oz)", 2500, 0);
export const RETIRED = variant("VASE-OLD", "VASE", "Bud Vase (Retired)", 4000, 3, { active: false });

export const CATALOG: Record<string, CatalogVariant[]> = {
  [SHOP]: [MUG, TEE, BOWL, OOS, RETIRED],
  [OTHER_SHOP]: [variant("BEANS-1KG", "BEANS", "House Beans 1 kg", 2900, 50)],
};

export const CUSTOMER = {
  name: { given_name: "John", surname: "Doe" },
  email_address: "jdoe-pp@paypal.com",
  phone: { country_code: "1", national_number: "1234567890" },
};

export const SAN_JOSE = {
  address_line_1: "456 Fictional St",
  address_line_2: "Apt 4B",
  admin_area_2: "San Jose",
  admin_area_1: "CA",
  postal_code: "90210",
  country_code: "US",
};

export const NEW_YORK = {
  address_line_1: "117 Barrow St",
  admin_area_2: "New York",
  admin_area_1: "NY",
  postal_code: "10014",
  country_code: "US",
};

export const PORTLAND = {
  address_line_1: "12333 SW 68th Pkwy",
  admin_area_2: "Portland",
  admin_area_1: "OR",
  postal_code: "97223",
  country_code: "US",
};

export const SYDNEY = {
  address_line_1: "123 Test St",
  admin_area_2: "Sydney",
  admin_area_1: "NSW",
  postal_code: "2000",
  country_code: "AU",
};

export const BILLING = {
  address_line_1: "2211 N 1st St",
  admin_area_2: "San Jose",
  admin_area_1: "CA",
  postal_code: "95131",
  country_code: "US",
};

export function line(v: CatalogVariant | { variantId: string; parentId: string }, quantity = 1) {
  return { parent_id: v.parentId, variant_id: v.variantId, quantity };
}

/** The standard request body the platform sends, with overrides. */
export function cartBody(overrides: Partial<PayPalCart> & Record<string, unknown> = {}): PayPalCart {
  return {
    id: "paypal-cart-id-sent-for-create",
    items: [line(MUG)],
    customer: CUSTOMER,
    shipping_address: SAN_JOSE,
    billing_address: BILLING,
    payment_method: { type: "paypal" },
    ...overrides,
  } as PayPalCart;
}
