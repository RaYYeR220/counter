interface ErrorDetail {
  issue?: string;
  field?: string;
  description?: string;
}

/** A non-2xx answer from PayPal, with the error envelope pulled apart. */
export class PayPalApiError extends Error {
  readonly status: number;
  /** PayPal's error `name` (REST APIs) or `error` (OAuth), e.g. `UNPROCESSABLE_ENTITY`. */
  readonly paypalName?: string;
  /** The first `details[].issue`, e.g. `ORDER_ALREADY_COMPLETED`. */
  readonly issue?: string;
  readonly issues: string[];
  readonly debugId?: string;
  readonly body: unknown;

  constructor(status: number, body: unknown, context: string) {
    const env = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const details = Array.isArray(env.details) ? (env.details as ErrorDetail[]) : [];
    const issues = details.map((d) => d.issue).filter((i): i is string => typeof i === "string");
    const paypalName =
      typeof env.name === "string" ? env.name : typeof env.error === "string" ? env.error : undefined;
    const message =
      typeof env.message === "string"
        ? env.message
        : typeof env.error_description === "string"
          ? env.error_description
          : `HTTP ${status}`;
    super(`${context}: ${status} ${[paypalName, issues[0]].filter(Boolean).join("/")} ${message}`.trim());
    this.name = "PayPalApiError";
    this.status = status;
    this.paypalName = paypalName;
    this.issues = issues;
    this.issue = issues[0];
    this.debugId = typeof env.debug_id === "string" ? env.debug_id : undefined;
    this.body = body;
  }

  /** True when PayPal reported `issue` anywhere in the error details. */
  has(issue: string): boolean {
    return this.issues.includes(issue);
  }

  static fromText(status: number, text: string, context: string): PayPalApiError {
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      // keep the raw text
    }
    return new PayPalApiError(status, body, context);
  }
}
