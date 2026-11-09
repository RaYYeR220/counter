import { describe, expect, it } from "vitest";
import { createCart, PaymentsUnavailable } from "../src/index";
import { cartBody, line, MUG, SHOP } from "./fixtures";
import { makeDeps } from "./harness";

describe("payments that cannot be taken", () => {
  it("answers with the port's named error instead of a generic processor outage", async () => {
    const deps = makeDeps();
    deps.payments.createOrder = async () => {
      throw new PaymentsUnavailable("PAYMENTS_NOT_CONNECTED", "This shop has not connected PayPal yet.");
    };
    const r = await createCart(SHOP, cartBody({ items: [line(MUG, 1)] }), deps, {});
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ name: "PAYMENTS_NOT_CONNECTED", message: "This shop has not connected PayPal yet." });
  });

  it("keeps the generic name for other PayPal failures", async () => {
    const deps = makeDeps();
    deps.payments.createOrder = async () => {
      throw new Error("socket hang up");
    };
    const r = await createCart(SHOP, cartBody({ items: [line(MUG, 1)] }), deps, {});
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ name: "PAYMENT_PROCESSOR_UNAVAILABLE" });
  });
});
