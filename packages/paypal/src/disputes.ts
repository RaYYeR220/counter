import { randomUUID } from "node:crypto";
import type { Money } from "./env";
import { dropUndefined } from "./orders";
import type { Transport } from "./transport";

export interface DisputeView {
  id: string;
  status?: string;
  reason?: string;
  /** INQUIRY, CHARGEBACK, PRE_ARBITRATION or ARBITRATION. */
  stage?: string;
  channel?: string;
  amount?: Money;
  createTime?: string;
  updateTime?: string;
  sellerResponseDueDate?: string;
  /** Seller-side PayPal transaction ids (capture ids) under dispute. */
  transactionIds: string[];
  /** Evidence types PayPal has asked the seller for. */
  requestedEvidence: string[];
  /** Refund types available if the seller accepts the claim. */
  acceptClaimTypes: string[];
}

export interface DisputeDetails extends DisputeView {
  /** The full dispute as PayPal returned it. */
  raw: unknown;
}

export interface ListDisputesQuery {
  disputedTransactionId?: string;
  /** e.g. REQUIRED_ACTION, UNDER_PAYPAL_REVIEW, RESOLVED. */
  disputeState?: string;
  startTime?: string;
  pageSize?: number;
  nextPageToken?: string;
}

interface DisputeWire {
  dispute_id: string;
  status?: string;
  reason?: string;
  dispute_life_cycle_stage?: string;
  dispute_channel?: string;
  dispute_amount?: { currency_code: string; value: string };
  create_time?: string;
  update_time?: string;
  seller_response_due_date?: string;
  disputed_transactions?: { seller_transaction_id?: string }[];
  evidences?: { evidence_type?: string; source?: string }[];
  allowed_response_options?: { accept_claim?: { accept_claim_types?: string[] } };
}

function view(d: DisputeWire): DisputeView {
  return dropUndefined({
    id: d.dispute_id,
    status: d.status,
    reason: d.reason,
    stage: d.dispute_life_cycle_stage,
    channel: d.dispute_channel,
    amount: d.dispute_amount ? { currency: d.dispute_amount.currency_code, value: d.dispute_amount.value } : undefined,
    createTime: d.create_time,
    updateTime: d.update_time,
    sellerResponseDueDate: d.seller_response_due_date,
    transactionIds: (d.disputed_transactions ?? [])
      .map((t) => t.seller_transaction_id)
      .filter((id): id is string => !!id),
    requestedEvidence: (d.evidences ?? [])
      .filter((e) => e.source === "REQUESTED_FROM_SELLER" && e.evidence_type)
      .map((e) => e.evidence_type!),
    acceptClaimTypes: d.allowed_response_options?.accept_claim?.accept_claim_types ?? [],
  });
}

export async function listDisputes(
  t: Transport,
  merchantId?: string,
  q: ListDisputesQuery = {},
): Promise<{ items: DisputeView[]; nextPageToken?: string }> {
  const { data } = await t.request<{ items?: DisputeWire[]; links?: { rel: string; href: string }[] }>(
    "GET",
    "/v1/customer/disputes",
    {
      headers: t.merchantHeaders(merchantId),
      query: {
        disputed_transaction_id: q.disputedTransactionId,
        dispute_state: q.disputeState,
        start_time: q.startTime,
        page_size: q.pageSize,
        next_page_token: q.nextPageToken,
      },
    },
  );
  const next = data.links?.find((l) => l.rel === "next")?.href;
  const nextPageToken = next ? (new URL(next).searchParams.get("next_page_token") ?? undefined) : undefined;
  return dropUndefined({ items: (data.items ?? []).map(view), nextPageToken });
}

export async function getDispute(t: Transport, disputeId: string, merchantId?: string): Promise<DisputeDetails> {
  const { data } = await t.request<DisputeWire>("GET", `/v1/customer/disputes/${encodeURIComponent(disputeId)}`, {
    headers: t.merchantHeaders(merchantId),
  });
  return { ...view(data), raw: data };
}

export interface EvidenceParams {
  /** As requested in the dispute, e.g. PROOF_OF_FULFILLMENT, PROOF_OF_REFUND. */
  evidenceType: string;
  notes?: string;
  evidenceInfo?: {
    trackingInfo?: { carrierName: string; trackingNumber: string }[];
    refundIds?: string[];
  };
  /** One document: jpg, jpeg, gif, png or pdf, under 10 MB. */
  file?: { name: string; bytes: Uint8Array; contentType: string };
}

const FILE_NAME = /^[A-Za-z0-9-_,\s]+\.(jpg|jpeg|gif|png|pdf)$/i;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Submits evidence for a dispute (multipart: `input` JSON part plus optional `file1`). */
export async function provideEvidence(
  t: Transport,
  disputeId: string,
  merchantId: string | undefined,
  p: EvidenceParams,
): Promise<void> {
  if (p.file) {
    if (!FILE_NAME.test(p.file.name)) {
      throw new RangeError(`evidence file name "${p.file.name}" must be letters, digits, - _ , or spaces plus a jpg/jpeg/gif/png/pdf extension`);
    }
    if (p.file.bytes.byteLength >= MAX_FILE_BYTES) throw new RangeError("evidence file must be under 10 MB");
  }
  const info = p.evidenceInfo;
  const input = {
    evidences: [
      dropUndefined({
        evidence_type: p.evidenceType,
        evidence_info: info
          ? dropUndefined({
              tracking_info: info.trackingInfo?.map((x) => ({
                carrier_name: x.carrierName,
                tracking_number: x.trackingNumber,
              })),
              refund_ids: info.refundIds,
            })
          : undefined,
        notes: p.notes,
      }),
    ],
  };

  const boundary = `----counter-${randomUUID()}`;
  const chunks: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="input"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(input)}\r\n`,
    ),
  ];
  if (p.file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file1"; filename="${p.file.name}"\r\nContent-Type: ${p.file.contentType}\r\n\r\n`,
      ),
      Buffer.from(p.file.bytes),
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  await t.request("POST", `/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`, {
    body: new Uint8Array(Buffer.concat(chunks)),
    headers: { ...t.merchantHeaders(merchantId), "Content-Type": `multipart/form-data; boundary=${boundary}` },
  });
}

/** Accepts liability; PayPal refunds the buyer and closes the dispute. */
export async function acceptClaim(
  t: Transport,
  disputeId: string,
  merchantId: string | undefined,
  note: string,
  opts: { acceptClaimType?: string } = {},
): Promise<void> {
  await t.request("POST", `/v1/customer/disputes/${encodeURIComponent(disputeId)}/accept-claim`, {
    json: dropUndefined({ note, accept_claim_type: opts.acceptClaimType }),
    headers: t.merchantHeaders(merchantId),
  });
}
