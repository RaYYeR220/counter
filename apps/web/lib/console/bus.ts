// Requests from inside Studio (cell renderers, custom widgets, assistant tool
// cards) to the Console shell that owns dialogs, popups and the action API.

import type { ConsoleOrder, ConsoleVariant } from "./types";

export type ConsoleRequest =
  | { kind: "open-order"; orderId: string }
  | { kind: "ship"; orderId: string }
  | { kind: "cancel"; orderId: string }
  | { kind: "refund"; orderId: string }
  | { kind: "open-negotiation"; negotiationId: string }
  | { kind: "market-check"; variantIds: string[] }
  | { kind: "order-changed"; order: ConsoleOrder; message?: string }
  | { kind: "variants-changed"; variants: ConsoleVariant[] };

type Listener = (r: ConsoleRequest) => void;

const listeners = new Set<Listener>();

export const consoleBus = {
  send(r: ConsoleRequest) {
    for (const l of listeners) l(r);
  },
  listen(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
