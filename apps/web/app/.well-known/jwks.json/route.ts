import { connection } from "next/server";
import { publicJwks } from "@counter/gateway";

/** Public key of Counter's gateway, which signs Store Sync calls the way PayPal's platform does. */
export async function GET(): Promise<Response> {
  await connection();
  return new Response(JSON.stringify(await publicJwks()), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
  });
}
