/** Origin the storefront is served from: `PUBLIC_BASE_URL`, else the local dev server. */
export function publicBaseUrl(): string {
  return trimSlash(process.env.PUBLIC_BASE_URL || "http://localhost:3000");
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Product page with the variant preselected: `/s/<slug>/p/<parent_id>?v=<variant_id>`. */
export function storefrontUrl(baseUrl: string, slug: string, parentId: string, variantId: string): string {
  return `${trimSlash(baseUrl)}/s/${encodeURIComponent(slug)}/p/${encodeURIComponent(parentId)}?v=${encodeURIComponent(variantId)}`;
}

/** Order review page: `/s/<slug>/orders/<order id>`. */
export function orderReviewUrl(baseUrl: string, slug: string, orderId: string): string {
  return `${trimSlash(baseUrl)}/s/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderId)}`;
}
