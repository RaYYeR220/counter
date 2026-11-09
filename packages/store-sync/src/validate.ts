import { PayPalCartSchema } from "@paypal/commerce-cart-zod";
import { invalidRequest, type ErrorBody, type ErrorDetail } from "./errors";
import type { PayPalCart } from "./types";

export type ParsedCartRequest =
  | { ok: true; cart: PayPalCart }
  | { ok: false; status: 400; body: ErrorBody };

export interface ParseOptions {
  /** When false, a body without `items` is accepted (items that are present are still checked). */
  requireItems?: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pathOf(path: ReadonlyArray<PropertyKey>): string {
  return path.reduce<string>((acc, seg) => {
    if (typeof seg === "number") return `${acc}[${seg}]`;
    return acc ? `${acc}.${String(seg)}` : String(seg);
  }, "");
}

function fail(message: string, details: ErrorDetail[]): ParsedCartRequest {
  return { ok: false, ...invalidRequest(message, details) };
}

function checkItems(items: unknown[]): ErrorDetail[] {
  const problems: ErrorDetail[] = [];
  items.forEach((item, i) => {
    if (!isRecord(item)) {
      problems.push({ field: `items[${i}]`, issue: "INVALID_PARAMETER_VALUE", description: "Each item must be an object" });
      return;
    }
    const q = item.quantity;
    if (typeof q !== "number" || !Number.isSafeInteger(q) || q < 1) {
      problems.push({
        field: `items[${i}].quantity`,
        issue: "INVALID_PARAMETER_VALUE",
        description: "Quantity must be a whole number of at least 1",
      });
    }
    const named = [item.variant_id, item.parent_id].some((v) => typeof v === "string" && v.trim() !== "");
    if (!named) {
      problems.push({
        field: `items[${i}].variant_id`,
        issue: "MISSING_REQUIRED_FIELD",
        description: "Each item needs a variant_id (or parent_id)",
      });
    }
  });
  return problems;
}

/**
 * Validates a cart request body (already-parsed JSON or the raw request text)
 * and returns it as a typed cart with unknown fields removed. Structural
 * problems produce a 400 `INVALID_REQUEST`; business problems such as unknown
 * products or stock are left to `computeCart`.
 */
export function parseCartRequest(body: unknown, opts: ParseOptions = {}): ParsedCartRequest {
  const requireItems = opts.requireItems ?? true;

  let raw = body;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return fail("Request body is not valid JSON", [
        { field: "body", issue: "MALFORMED_REQUEST_JSON", description: "The request body could not be parsed as JSON" },
      ]);
    }
  }
  if (!isRecord(raw)) {
    return fail("Request body must be a JSON object", [
      { field: "body", issue: "INVALID_REQUEST_BODY", description: "Expected a cart object" },
    ]);
  }

  const items = raw.items;
  const itemsAbsent = items === undefined || items === null;
  if ((itemsAbsent && requireItems) || (Array.isArray(items) && items.length === 0)) {
    return fail("Required field 'items' is missing", [
      { field: "items", issue: "MISSING_REQUIRED_FIELD", description: "The items field is required and cannot be empty" },
    ]);
  }
  if (!itemsAbsent) {
    if (!Array.isArray(items)) {
      return fail("Field 'items' must be an array", [
        { field: "items", issue: "INVALID_PARAMETER_VALUE", description: "Expected an array of cart items" },
      ]);
    }
    const problems = checkItems(items);
    if (problems.length) return fail("One or more items are invalid", problems);
  }

  const candidate: Record<string, unknown> = { ...raw };
  if (itemsAbsent) delete candidate.items;
  if (isRecord(raw.payment_method)) {
    const type = raw.payment_method.type;
    candidate.payment_method = {
      ...raw.payment_method,
      type: typeof type === "string" ? type.toLowerCase() : type === undefined ? "paypal" : type,
    };
  }

  const parsed = PayPalCartSchema.safeParse(candidate);
  if (!parsed.success) {
    return fail(
      "Request body does not match the cart schema",
      parsed.error.issues.slice(0, 20).map((iss) => ({
        field: pathOf(iss.path) || "body",
        issue: "INVALID_PARAMETER_VALUE",
        description: iss.message,
      })),
    );
  }
  return { ok: true, cart: parsed.data };
}
