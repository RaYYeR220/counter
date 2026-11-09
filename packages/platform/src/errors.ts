export type PlatformErrorCode = "not_found" | "conflict" | "invalid_request";

/** A request the platform refuses for a business reason (unknown order, wrong state, bad input). */
export class PlatformError extends Error {
  override readonly name = "PlatformError";

  constructor(
    readonly code: PlatformErrorCode,
    message: string,
  ) {
    super(message);
  }

  /** HTTP status a route should answer with. */
  get httpStatus(): number {
    return this.code === "not_found" ? 404 : this.code === "conflict" ? 409 : 400;
  }
}
