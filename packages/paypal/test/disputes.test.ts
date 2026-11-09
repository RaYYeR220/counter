import { describe, it, expect } from "vitest";
import { PayPal, PayPalApiError } from "../src/index";
import { ENV, MERCHANT, expectedAssertion, fakePayPal } from "./fake";

function fieldNames(form: FormData): string[] {
  const names: string[] = [];
  form.forEach((_value, name) => names.push(name));
  return names;
}

const DISPUTE = {
  dispute_id: "PP-D-27803",
  create_time: "2026-11-01T10:00:00.000Z",
  update_time: "2026-11-02T10:00:00.000Z",
  disputed_transactions: [
    { seller_transaction_id: "3BC38643YC807283D", buyer_transaction_id: "1XC473123G8516345", seller: { merchant_id: MERCHANT } },
  ],
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  status: "WAITING_FOR_SELLER_RESPONSE",
  dispute_amount: { currency_code: "USD", value: "32.80" },
  dispute_life_cycle_stage: "INQUIRY",
  dispute_channel: "INTERNAL",
  seller_response_due_date: "2026-11-21T10:00:00.000Z",
  evidences: [
    { evidence_type: "CREATE", source: "SUBMITTED_BY_BUYER" },
    { evidence_type: "PROOF_OF_FULFILLMENT", source: "REQUESTED_FROM_SELLER" },
  ],
  allowed_response_options: { accept_claim: { accept_claim_types: ["REFUND", "REFUND_WITH_RETURN"] } },
  links: [
    { href: "https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-27803", rel: "self", method: "GET" },
    { href: "https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-27803/provide-evidence", rel: "provide_evidence", method: "POST" },
    { href: "https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-27803/accept-claim", rel: "accept_claim", method: "POST" },
  ],
};
const ALLOWED = ["provide_evidence", "accept_claim"];

describe("listDisputes", () => {
  it("lists the merchant's disputes with filters and the next page token", async () => {
    const pp = fakePayPal({
      "GET /v1/customer/disputes": {
        json: {
          items: [
            {
              dispute_id: "PP-D-27803",
              create_time: "2026-11-01T10:00:00.000Z",
              update_time: "2026-11-02T10:00:00.000Z",
              reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
              status: "WAITING_FOR_SELLER_RESPONSE",
              dispute_state: "REQUIRED_ACTION",
              dispute_amount: { currency_code: "USD", value: "32.80" },
              dispute_life_cycle_stage: "INQUIRY",
              disputed_transactions: [{ seller_transaction_id: "3BC38643YC807283D" }],
            },
          ],
          links: [
            {
              href: "https://api-m.sandbox.paypal.com/v1/customer/disputes?page_size=10&next_page_token=TOKEN2",
              rel: "next",
              method: "GET",
            },
          ],
        },
      },
    });
    const out = await new PayPal(ENV, pp.fetch).listDisputes(MERCHANT, {
      disputeState: "REQUIRED_ACTION",
      pageSize: 10,
    });

    expect(out).toEqual({
      items: [
        {
          id: "PP-D-27803",
          status: "WAITING_FOR_SELLER_RESPONSE",
          reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
          stage: "INQUIRY",
          amount: { currency: "USD", value: "32.80" },
          createTime: "2026-11-01T10:00:00.000Z",
          updateTime: "2026-11-02T10:00:00.000Z",
          transactionIds: ["3BC38643YC807283D"],
          requestedEvidence: [],
          acceptClaimTypes: [],
          allowedActions: [],
        },
      ],
      nextPageToken: "TOKEN2",
    });
    const req = pp.last();
    expect(req.method).toBe("GET");
    expect(req.url.pathname).toBe("/v1/customer/disputes");
    expect(Object.fromEntries(req.url.searchParams)).toEqual({ dispute_state: "REQUIRED_ACTION", page_size: "10" });
    expect(req.headers.get("paypal-auth-assertion")).toBe(expectedAssertion());
    expect(req.headers.get("paypal-partner-attribution-id")).toBe("COUNTER_SP_PPCP");
  });

  it("filters by the disputed transaction and handles an empty page", async () => {
    const pp = fakePayPal({ "GET /v1/customer/disputes": { json: { items: [], links: [] } } });
    const out = await new PayPal(ENV, pp.fetch).listDisputes(undefined, { disputedTransactionId: "3BC38643YC807283D" });
    expect(out).toEqual({ items: [] });
    expect(pp.last().path).toBe("/v1/customer/disputes?disputed_transaction_id=3BC38643YC807283D");
    expect(pp.last().headers.has("paypal-auth-assertion")).toBe(false);
  });
});

describe("getDispute", () => {
  it("reads one dispute with the evidence PayPal wants from the seller", async () => {
    const pp = fakePayPal({ "GET /v1/customer/disputes/PP-D-27803": { json: DISPUTE } });
    const d = await new PayPal(ENV, pp.fetch).getDispute("PP-D-27803", MERCHANT);

    expect(d).toEqual({
      id: "PP-D-27803",
      status: "WAITING_FOR_SELLER_RESPONSE",
      reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
      stage: "INQUIRY",
      channel: "INTERNAL",
      amount: { currency: "USD", value: "32.80" },
      createTime: "2026-11-01T10:00:00.000Z",
      updateTime: "2026-11-02T10:00:00.000Z",
      sellerResponseDueDate: "2026-11-21T10:00:00.000Z",
      transactionIds: ["3BC38643YC807283D"],
      requestedEvidence: ["PROOF_OF_FULFILLMENT"],
      acceptClaimTypes: ["REFUND", "REFUND_WITH_RETURN"],
      allowedActions: ALLOWED,
      raw: DISPUTE,
    });
    expect(pp.last().headers.get("paypal-auth-assertion")).toBe(expectedAssertion());
  });

  it("throws for an unknown dispute", async () => {
    const pp = fakePayPal();
    await expect(new PayPal(ENV, pp.fetch).getDispute("PP-D-0")).rejects.toBeInstanceOf(PayPalApiError);
  });
});

describe("provideSupportingInfo", () => {
  it("sends notes and the document while PayPal reviews the case", async () => {
    const pp = fakePayPal({ "POST /v1/customer/disputes/PP-D-27803/provide-supporting-info": { json: { links: [] } } });
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
    await new PayPal(ENV, pp.fetch).provideSupportingInfo("PP-D-27803", MERCHANT, {
      notes: "Shipped USPS 9400111899223197428490 on Nov 3.",
      file: { name: "evidence-JC-10002.pdf", bytes: pdf, contentType: "application/pdf" },
    });
    const req = pp.last();
    expect(req.url.pathname).toBe("/v1/customer/disputes/PP-D-27803/provide-supporting-info");
    expect(req.headers.get("paypal-auth-assertion")).toBe(expectedAssertion());
    const form = await req.formData();
    expect(fieldNames(form)).toEqual(["input", "file1"]);
    expect(JSON.parse(form.get("input") as string)).toEqual({ notes: "Shipped USPS 9400111899223197428490 on Nov 3." });
    expect((form.get("file1") as File).name).toBe("evidence-JC-10002.pdf");
  });

  it("refuses a file name PayPal would reject", async () => {
    const pp = fakePayPal();
    await expect(
      new PayPal(ENV, pp.fetch).provideSupportingInfo("PP-D-27803", undefined, {
        notes: "x",
        file: { name: "../evidence.exe", bytes: new Uint8Array([1]), contentType: "application/pdf" },
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe("provideEvidence", () => {
  it("uploads the evidence as multipart: an input JSON part and the file", async () => {
    const pp = fakePayPal({ "POST /v1/customer/disputes/PP-D-27803/provide-evidence": { json: { links: [] } } });
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff]);
    await new PayPal(ENV, pp.fetch).provideEvidence("PP-D-27803", MERCHANT, {
      evidenceType: "PROOF_OF_FULFILLMENT",
      notes: "Shipped USPS on Nov 3, delivered Nov 5.",
      evidenceInfo: { trackingInfo: [{ carrierName: "USPS", trackingNumber: "9400111899223197428490" }] },
      file: { name: "label.pdf", bytes: pdf, contentType: "application/pdf" },
    });

    const req = pp.last();
    expect(req.method).toBe("POST");
    expect(req.url.href).toBe("https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-27803/provide-evidence");
    expect(req.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(req.headers.get("paypal-auth-assertion")).toBe(expectedAssertion());
    expect(req.headers.get("paypal-partner-attribution-id")).toBe("COUNTER_SP_PPCP");

    const form = await req.formData();
    expect(fieldNames(form)).toEqual(["input", "file1"]);
    expect(JSON.parse(form.get("input") as string)).toEqual({
      evidences: [
        {
          evidence_type: "PROOF_OF_FULFILLMENT",
          evidence_info: { tracking_info: [{ carrier_name: "USPS", tracking_number: "9400111899223197428490" }] },
          notes: "Shipped USPS on Nov 3, delivered Nov 5.",
        },
      ],
    });
    const file = form.get("file1") as File;
    expect(file.name).toBe("label.pdf");
    expect(file.type).toBe("application/pdf");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(pdf);
    expect(req.text).toContain('Content-Disposition: form-data; name="input"\r\nContent-Type: application/json\r\n\r\n');
  });

  it("sends the input part alone when there is no file", async () => {
    const pp = fakePayPal({ "POST /v1/customer/disputes/PP-D-1/provide-evidence": { json: { links: [] } } });
    await new PayPal(ENV, pp.fetch).provideEvidence("PP-D-1", undefined, {
      evidenceType: "PROOF_OF_REFUND",
      notes: "Refunded in full.",
      evidenceInfo: { refundIds: ["REF1"] },
    });
    const form = await pp.last().formData();
    expect(fieldNames(form)).toEqual(["input"]);
    expect(JSON.parse(form.get("input") as string).evidences[0].evidence_info).toEqual({ refund_ids: ["REF1"] });
  });

  it("refuses file names PayPal would reject before uploading", async () => {
    const pp = fakePayPal();
    await expect(
      new PayPal(ENV, pp.fetch).provideEvidence("PP-D-1", undefined, {
        evidenceType: "PROOF_OF_FULFILLMENT",
        notes: "x",
        file: { name: "label?.pdf", bytes: new Uint8Array([1]), contentType: "application/pdf" },
      }),
    ).rejects.toThrow(/file name/);
    expect(pp.calls()).toHaveLength(0);
  });
});

describe("acceptClaim", () => {
  it("accepts liability with a note", async () => {
    const pp = fakePayPal({ "POST /v1/customer/disputes/PP-D-27803/accept-claim": { json: { links: [] } } });
    await new PayPal(ENV, pp.fetch).acceptClaim("PP-D-27803", MERCHANT, "Full refund to the customer.");

    const req = pp.last();
    expect(req.method).toBe("POST");
    expect(req.url.href).toBe("https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-27803/accept-claim");
    expect(req.json()).toEqual({ note: "Full refund to the customer." });
    expect(req.contentType).toBe("application/json");
    expect(req.headers.get("paypal-auth-assertion")).toBe(expectedAssertion());
  });

  it("can name the refund type", async () => {
    const pp = fakePayPal({ "POST /v1/customer/disputes/PP-D-1/accept-claim": { json: { links: [] } } });
    await new PayPal(ENV, pp.fetch).acceptClaim("PP-D-1", undefined, "Refund.", { acceptClaimType: "REFUND" });
    expect(pp.last().json()).toEqual({ note: "Refund.", accept_claim_type: "REFUND" });
  });
});
