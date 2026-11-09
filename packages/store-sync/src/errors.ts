import type { BusinessIssueCode, ValidationIssue } from "./types";

/** What a handler hands back to the HTTP layer: a status code and a JSON body. */
export type HandlerResult = { status: number; body: unknown };

export interface ErrorDetail {
  field?: string;
  issue?: string;
  description?: string;
}

/** The API's `Error` shape, used for 400, 401, 404 and 500 responses. */
export interface ErrorBody {
  name: string;
  message: string;
  debug_id: string;
  details?: ErrorDetail[];
}

/** The API's `BusinessError` shape, used for 422 responses. */
export interface BusinessErrorBody {
  name: string;
  message: string;
  debug_id: string;
  business_context?: ValidationIssue;
  details: Array<{
    field?: string;
    issue?: BusinessIssueCode;
    description?: string;
    business_context?: ValidationIssue;
  }>;
}

/** Correlation id included in every error body so a failure can be traced in logs. */
export function debugId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

export function errorBody(name: string, message: string, details?: ErrorDetail[]): ErrorBody {
  return { name, message, debug_id: debugId(), ...(details?.length ? { details } : {}) };
}

export function invalidRequest(message: string, details: ErrorDetail[]): { status: 400; body: ErrorBody } {
  return { status: 400, body: errorBody("INVALID_REQUEST", message, details) };
}

export function invalidCartId(cartId: string): { status: 400; body: ErrorBody } {
  return {
    status: 400,
    body: errorBody("INVALID_CART_ID", "Cart ID format is invalid. Expected format: CART-[A-Z0-9]+", [
      { field: "cartId", issue: "INVALID_FORMAT", description: `'${cartId.slice(0, 80)}' is not a valid cart ID` },
    ]),
  };
}

export function cartNotFound(cartId: string): { status: 404; body: ErrorBody } {
  return {
    status: 404,
    body: errorBody("CART_NOT_FOUND", `Cart with ID '${cartId}' does not exist`, [
      { field: "cartId", issue: "NOT_FOUND", description: "No cart with this ID exists for this store" },
    ]),
  };
}

export function internalError(
  name = "INTERNAL_SERVER_ERROR",
  message = "A temporary system error occurred. Please try again later.",
): { status: 500; body: ErrorBody } {
  return { status: 500, body: errorBody(name, message) };
}

/**
 * A 422 built from one or more validation issues. The first issue is repeated
 * as the top-level `business_context`; every issue also gets its own detail
 * entry carrying its own `business_context`.
 */
export function businessError(issues: ValidationIssue[], message: string): { status: 422; body: BusinessErrorBody } {
  const first = issues[0];
  return {
    status: 422,
    body: {
      name: "UNPROCESSABLE_ENTITY",
      message,
      debug_id: debugId(),
      ...(first ? { business_context: first } : {}),
      details: issues.map((issue) => ({
        field: issue.field ?? undefined,
        issue: (issue.context?.specific_issue ?? undefined) as BusinessIssueCode | undefined,
        description: issue.message,
        business_context: issue,
      })),
    },
  };
}
