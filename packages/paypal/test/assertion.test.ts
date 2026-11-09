import { describe, it, expect } from "vitest";
import { authAssertion } from "../src/index";

describe("authAssertion", () => {
  it("builds the unsigned JWT PayPal expects for acting on behalf of a merchant", () => {
    expect(authAssertion("CLIENT", "MERCHANT")).toBe(
      "eyJhbGciOiJub25lIn0.eyJpc3MiOiJDTElFTlQiLCJwYXllcl9pZCI6Ik1FUkNIQU5UIn0.",
    );
  });

  it("decodes to alg none and the iss / payer_id pair, with an empty signature", () => {
    const [h, p, sig] = authAssertion("AbC-123_x", "5VT3RDX64P5Z6").split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "none" });
    expect(JSON.parse(Buffer.from(p!, "base64url").toString())).toEqual({
      iss: "AbC-123_x",
      payer_id: "5VT3RDX64P5Z6",
    });
    expect(sig).toBe("");
  });

  it("uses base64url without padding", () => {
    const value = authAssertion("A", "B");
    expect(value).not.toMatch(/[+/=]/);
  });
});
