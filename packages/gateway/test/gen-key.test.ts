import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { gatewayPublicKeyPem } from "../src/index";

const run = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/gen-key.ts", import.meta.url));

describe("scripts/gen-key.ts", () => {
  it("prints a matching key pair and the env line for the private key", async () => {
    const { stdout } = await run(process.execPath, [script], { timeout: 20_000 });
    const priv = /-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/.exec(stdout)?.[0];
    const pub = /-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/.exec(stdout)?.[0];
    expect(priv).toBeDefined();
    expect(pub).toBeDefined();
    expect((await gatewayPublicKeyPem(priv!)).trim()).toBe(pub!.trim());

    const envLine = /^GATEWAY_PRIVATE_KEY_PEM="(.+)"$/m.exec(stdout)?.[1];
    expect(envLine).toBeDefined();
    expect(envLine!.replace(/\\n/g, "\n").trim()).toBe(priv!.trim());
  });
});
