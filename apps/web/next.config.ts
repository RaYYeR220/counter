import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: [
    "@counter/store-sync",
    "@counter/paypal",
    "@counter/gateway",
    "@counter/db",
    "@counter/platform",
    "@counter/negotiate",
  ],
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
