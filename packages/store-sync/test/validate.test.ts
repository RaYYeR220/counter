import { describe, it, expect } from "vitest";
import { ErrorSchema } from "@paypal/commerce-cart-zod";
import { parseCartRequest } from "../src/index";
import { cartBody, MUG, line } from "./fixtures";

function expect400(res: ReturnType<typeof parseCartRequest>, field: string, issue: string) {
  expect(res.ok).toBe(false);
  if (res.ok) return;
  expect(res.status).toBe(400);
  expect(res.body.name).toBe("INVALID_REQUEST");
  expect(typeof res.body.message).toBe("string");
  expect(ErrorSchema.safeParse(res.body).success).toBe(true);
  expect(res.body.details).toContainEqual(expect.objectContaining({ field, issue }));
}

describe("parseCartRequest", () => {
  it("accepts the platform's standard body", () => {
    const res = parseCartRequest(cartBody());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.cart.items).toHaveLength(1);
  });

  it("parses a raw JSON string", () => {
    const res = parseCartRequest(JSON.stringify(cartBody()));
    expect(res.ok).toBe(true);
  });

  it("rejects malformed JSON", () => {
    expect400(parseCartRequest("{ items: ["), "body", "MALFORMED_REQUEST_JSON");
  });

  it("rejects bodies that are not JSON objects", () => {
    for (const b of [null, undefined, 42, "[]", [1, 2]]) {
      expect400(parseCartRequest(b), "body", "INVALID_REQUEST_BODY");
    }
  });

  it("rejects a missing or empty items list", () => {
    const { items: _drop, ...noItems } = cartBody();
    expect400(parseCartRequest(noItems), "items", "MISSING_REQUIRED_FIELD");
    expect400(parseCartRequest(cartBody({ items: [] })), "items", "MISSING_REQUIRED_FIELD");
    expect400(parseCartRequest(cartBody({ items: null })), "items", "MISSING_REQUIRED_FIELD");
  });

  it("rejects zero, negative, fractional, string and missing quantities", () => {
    for (const quantity of [0, -1, 1.5, "2", null, undefined]) {
      const body = cartBody({ items: [line(MUG), { ...line(MUG), quantity } as never] });
      expect400(parseCartRequest(body), "items[1].quantity", "INVALID_PARAMETER_VALUE");
    }
  });

  it("rejects an item that names no product", () => {
    const body = cartBody({ items: [{ quantity: 1 }] });
    expect400(parseCartRequest(body), "items[0].variant_id", "MISSING_REQUIRED_FIELD");
  });

  it("reports schema violations with the offending path", () => {
    const body = cartBody({ shipping_address: { country_code: "USA" } });
    expect400(parseCartRequest(body), "shipping_address.country_code", "INVALID_PARAMETER_VALUE");
  });

  it("normalises an upper-case payment method type", () => {
    const res = parseCartRequest(cartBody({ payment_method: { type: "PAYPAL" as never, token: "T1" } }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.cart.payment_method).toEqual({ type: "paypal", token: "T1" });
  });

  it("drops fields that are not part of the cart model", () => {
    const res = parseCartRequest({ ...cartBody(), accepted_policies: ["terms_of_service"] });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.cart).not.toHaveProperty("accepted_policies");
  });

  it("can allow a body without items (checkout carries only payment details)", () => {
    const res = parseCartRequest(
      { payment_method: { type: "paypal", token: "T1", payer_id: "P1" } },
      { requireItems: false },
    );
    expect(res.ok).toBe(true);
    // ...but items that are present are still validated
    expect400(
      parseCartRequest({ items: [{ variant_id: "X", quantity: 0 }] }, { requireItems: false }),
      "items[0].quantity",
      "INVALID_PARAMETER_VALUE",
    );
  });
});
