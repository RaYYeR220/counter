import type { PayPalEnv } from "./env";
import { PayPalApiError } from "./errors";

export interface AccessToken {
  accessToken: string;
  /** Epoch ms after which the token is no longer handed out (expires_in − 60 s). */
  expiresAt: number;
}

const SAFETY_MARGIN_S = 60;

/** Client-credentials token for the platform app, cached until shortly before expiry. */
export class TokenCache {
  private current?: AccessToken;
  private inflight?: Promise<AccessToken>;

  constructor(
    private readonly env: PayPalEnv,
    private readonly fetchImpl: typeof fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<AccessToken> {
    if (this.current && this.now() < this.current.expiresAt) return this.current;
    this.inflight ??= this.fetchToken().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async fetchToken(): Promise<AccessToken> {
    const basic = Buffer.from(`${this.env.clientId}:${this.env.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(`${this.env.base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });
    const text = await res.text();
    if (!res.ok) throw PayPalApiError.fromText(res.status, text, "POST /v1/oauth2/token");
    const data = JSON.parse(text) as { access_token: string; expires_in: number };
    const token: AccessToken = {
      accessToken: data.access_token,
      expiresAt: this.now() + Math.max(0, data.expires_in - SAFETY_MARGIN_S) * 1000,
    };
    this.current = token;
    return token;
  }
}
