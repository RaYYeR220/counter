import type { McpServer } from "@modelcontextprotocol/server";
import type { McpUiResourceMeta, McpUiToolMeta } from "@modelcontextprotocol/ext-apps";
import { RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY, registerAppResource } from "@modelcontextprotocol/ext-apps/server";
import { APPROVAL_VIEW_JS } from "./approval";
import { CART_VIEW_JS } from "./cart";
import { appPage } from "./page";
import { PRODUCT_VIEW_JS } from "./product";

export { APP_MODEL_JS } from "./model";
export { APP_PROTOCOL_VERSION } from "./runtime";
export { RESOURCE_MIME_TYPE as MCP_APP_MIME_TYPE };

export type CounterAppName = "product" | "cart" | "approval";

export interface CounterApp {
  uri: string;
  name: string;
  description: string;
  html: string;
}

/**
 * MCP Apps cards (interactive views that MCP Apps hosts render inline next to a
 * tool call). Each is one self-contained HTML page built once at module load.
 * Hosts without MCP Apps support ignore them and keep using the tools' text and
 * structuredContent, which the cards do not change.
 */
export const COUNTER_APPS: Record<CounterAppName, CounterApp> = {
  product: {
    uri: "ui://counter/product.html",
    name: "Product card",
    description: "A product's variants with stock, price and delivery dates.",
    html: appPage("product", "Product", PRODUCT_VIEW_JS),
  },
  cart: {
    uri: "ui://counter/cart.html",
    name: "Cart card",
    description: "A cart's lines, shipping, discount, tax, total and PayPal order.",
    html: appPage("cart", "Cart", CART_VIEW_JS),
  },
  approval: {
    uri: "ui://counter/approval.html",
    name: "Checkout card",
    description: "Approve the payment in PayPal, finish the order, and see the order number.",
    html: appPage("approval", "Checkout", APPROVAL_VIEW_JS),
  },
};

/** The cards render from the tool result only: no outside origins at all. */
const RESOURCE_UI: McpUiResourceMeta = {
  csp: { connectDomains: [], resourceDomains: [] },
  prefersBorder: false,
};

/**
 * `_meta` for a tool that shows a card: the nested `ui.resourceUri` plus the
 * flat `ui/resourceUri` key older hosts read (what ext-apps' `registerAppTool`
 * writes). Visible to the model and callable from the card, so the checkout
 * card can call `checkout` again once the buyer has approved.
 */
export function appToolMeta(app: CounterAppName): { ui: McpUiToolMeta; [RESOURCE_URI_META_KEY]: string } {
  const resourceUri = COUNTER_APPS[app].uri;
  return { ui: { resourceUri, visibility: ["model", "app"] }, [RESOURCE_URI_META_KEY]: resourceUri };
}

/** Registers the cards as `ui://` resources. */
export function registerCounterApps(server: McpServer): void {
  for (const app of Object.values(COUNTER_APPS)) {
    registerAppResource(
      server,
      app.name,
      app.uri,
      { description: app.description, mimeType: RESOURCE_MIME_TYPE, _meta: { ui: RESOURCE_UI } },
      async () => ({
        contents: [{ uri: app.uri, mimeType: RESOURCE_MIME_TYPE, text: app.html, _meta: { ui: RESOURCE_UI } }],
      }),
    );
  }
}
