// Prints a fresh gateway signing key pair.
//   node scripts/gen-key.ts
// Put the private key in GATEWAY_PRIVATE_KEY_PEM; give the public key to
// merchants as their sandbox verification key (it is also served at
// /.well-known/jwks.json).
import { generateGatewayKeyPair, PRIVATE_KEY_ENV } from "../src/keys.ts";

const { privateKeyPem, publicKeyPem } = await generateGatewayKeyPair();
const oneLine = privateKeyPem.trim().replace(/\n/g, "\\n");

process.stdout.write(
  [
    "# Private key (secret)",
    privateKeyPem.trim(),
    "",
    "# Public key",
    publicKeyPem.trim(),
    "",
    "# Env line",
    `${PRIVATE_KEY_ENV}="${oneLine}"`,
    "",
  ].join("\n"),
);
