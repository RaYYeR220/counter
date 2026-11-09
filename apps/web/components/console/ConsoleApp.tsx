"use client";

import {
  AgStudioAiModule,
  enableStudioDevValidations,
  singleColumnLayout,
  type AgContextMenuItem,
  type AgDataTransaction,
  type AgGetContextMenuParams,
  type AgPopupInstance,
  type AgReportState,
  type AgResponsiveLayoutBreakpoint,
  type AgStudioApi,
  type AgStudioMode,
} from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { buildConsoleAi } from "@/lib/console/ai/harness";
import { pendingShipments } from "@/lib/console/ai/pending";
import { consoleBus, type ConsoleRequest } from "@/lib/console/bus";
import { consoleApi } from "@/lib/console/client";
import { ago } from "@/lib/console/format";
import {
  buildStudioData,
  eventRow,
  funnelRows,
  negotiationRow,
  orderRow,
  variantRow,
  type ConsoleSnapshot,
  type EventRow,
} from "@/lib/console/studio/data";
import type { ConsoleRegistry } from "@/lib/console/studio/registry";
import { initialReport, PAGES, type PageId } from "@/lib/console/studio/report";
import { consoleTheme, DARK_MODE, LIGHT_MODE, tokenCss, type ConsoleMode } from "@/lib/console/theme";
import type { ConsoleActionResult, ConsoleEvent, ConsoleNegotiation, ConsoleOrder, ConsoleSummary, ConsoleVariant } from "@/lib/console/types";
import { merchantOpsToolDisplay, ShipmentConfirm } from "./ai/ToolCards";
import s from "./console.module.css";
import { NegotiationDetail } from "./NegotiationDetail";
import { OrderDetail, type OrderAction, type OrderDetailProps } from "./OrderDetail";
import { consoleWidgets } from "./widgets";

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();

const POLL_MS = 3_000;

type Rows = AgDataTransaction["add"];
/** Studio's transaction rows from the Console's typed rows. */
const rows = (list: readonly object[]) => list as unknown as Rows;
const THEME_KEY = "counter.console.theme";

export interface ConsoleAppProps {
  shop: string;
  licenseKey?: string;
  aiModels: Array<{ id: string; label: string }>;
}

type Boot =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; summary: ConsoleSummary; snapshot: ConsoleSnapshot };

/** Loads the shop's activity, then hands it to Studio. */
export default function ConsoleApp(props: ConsoleAppProps) {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    const slug = props.shop;
    Promise.all([
      consoleApi.summary(slug, ctl.signal),
      consoleApi.events(slug, undefined, ctl.signal),
      consoleApi.orders(slug, ctl.signal),
      consoleApi.negotiations(slug, ctl.signal),
      consoleApi.catalog(slug, ctl.signal),
    ])
      .then(([summary, ev, or, ne, ca]) =>
        setBoot({
          state: "ready",
          summary,
          snapshot: { shopName: summary.shop.name, events: ev.events, orders: or.orders, negotiations: ne.negotiations, variants: ca.variants },
        }),
      )
      .catch((err: unknown) => {
        if (ctl.signal.aborted) return;
        setBoot({ state: "error", message: err instanceof Error ? err.message : "The Console couldn't load." });
      });
    return () => ctl.abort();
  }, [props.shop, attempt]);

  if (boot.state === "loading") return <ConsoleSkeleton />;
  if (boot.state === "error") {
    return (
      <div className={s.failed} role="alert">
        <h1>The Console couldn&rsquo;t load {props.shop}</h1>
        <p>{boot.message}</p>
        <button type="button" className={s.button} onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  }
  return <ConsoleStudio {...props} summary={boot.summary} snapshot={boot.snapshot} />;
}

export function ConsoleSkeleton() {
  return (
    <div className={s.skeleton} aria-busy="true" aria-label="Loading the Console">
      <div className={s.skeletonBar} />
      <div className={s.skeletonGrid}>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className={s.skeletonCard} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function initialMode(): ConsoleMode {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === LIGHT_MODE || saved === DARK_MODE) return saved;
  } catch {
    // Storage blocked: fall back to the system setting.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? DARK_MODE : LIGHT_MODE;
}

/** Every `field = value` pair in a Studio filter definition, by field id. */
function filterValues(filter: unknown, out = new Map<string, unknown>()): Map<string, unknown> {
  if (!filter || typeof filter !== "object") return out;
  if (Array.isArray(filter)) {
    for (const f of filter) filterValues(f, out);
    return out;
  }
  const f = filter as Record<string, unknown>;
  const field = f.field as Record<string, unknown> | string | undefined;
  const id = typeof field === "string" ? field : (field?.id ?? field?.fieldId ?? field?.key);
  if (typeof id === "string" && "value" in f) out.set(id, Array.isArray(f.value) ? f.value[0] : f.value);
  for (const key of ["conditions", "filters", "and", "or", "children"]) filterValues(f[key], out);
  return out;
}

const breakpoints: AgResponsiveLayoutBreakpoint[] = [{ maxWidth: 760, layout: singleColumnLayout }];

const NARROW = "(max-width: 760px)";
const isNarrow = () => window.matchMedia(NARROW).matches;
function subscribeNarrow(onChange: () => void) {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

type Toast = { id: number; ok: boolean; text: string };

function ConsoleStudio({ shop: slug, licenseKey, aiModels, summary, snapshot }: ConsoleAppProps & { summary: ConsoleSummary; snapshot: ConsoleSnapshot }) {
  const apiRef = useRef<AgStudioApi<ConsoleRegistry> | null>(null);
  const readyRef = useRef(false);
  const data = useRef({
    events: snapshot.events.map(eventRow) as EventRow[],
    rawEvents: snapshot.events as ConsoleEvent[],
    orders: new Map(snapshot.orders.map((o) => [o.id, o])),
    negotiations: new Map(snapshot.negotiations.map((n) => [n.id, n])),
    variants: new Map(snapshot.variants.map((v) => [v.variantId, v])),
    lastEventId: snapshot.events.at(-1)?.id ?? summary.lastEventId,
  });
  const orderPopups = useRef(new Map<string, AgPopupInstance<OrderDetailProps>>());

  const [themeMode, setThemeMode] = useState<ConsoleMode>(initialMode);
  const [mode, setMode] = useState<AgStudioMode>("view");
  const [focusPanel, setFocusPanel] = useState<"ai" | "edit">("ai");
  const [page, setPage] = useState<PageId>("agents");
  const [live, setLive] = useState<{ at: number; ok: boolean }>(() => ({ at: Date.now(), ok: true }));
  const [, setTick] = useState(0);
  const [includesDemo, setIncludesDemo] = useState(summary.includesDemo || snapshot.events.some((e) => e.demo));
  const [toShip, setToShip] = useState(() => snapshot.orders.filter((o) => o.fulfilment === "to_ship").length);
  const popupParams = useRef<((order: ConsoleOrder) => OrderDetailProps) | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pending = useSyncExternalStore(pendingShipments.subscribe, pendingShipments.snapshot, pendingShipments.snapshot);
  const openShipments = pending.filter((p) => p.status === "pending" || p.status === "confirming");

  const aiEnabled = summary.aiEnabled && aiModels.length > 0;

  // --- Studio props, built once -----------------------------------------------
  const [studioData] = useState(() => buildStudioData(snapshot));
  const [initialState] = useState(() => initialReport());
  const [modules] = useState(() => (aiEnabled ? [AgStudioAiModule] : []));
  const [ai] = useState(() => (aiEnabled ? buildConsoleAi({ shop: summary.shop, models: aiModels }) : undefined));
  const [widgets] = useState(() => consoleWidgets);
  const layout = useMemo(() => ({ minWidth: 320, widgetBorderEnabled: true }), []);
  // On a phone the canvas gets the whole width: no filters strip in view mode.
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  const panels = useMemo(
    () => ({
      edit: { left: ["data" as const], right: ["ai" as const, "edit" as const, "filters" as const] },
      view: narrow ? {} : { right: ["filters" as const] },
    }),
    [narrow],
  );
  const studioStyle = useMemo(() => ({ height: "100%", width: "100%" }), []);

  const toast = useCallback((ok: boolean, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, ok, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6_000);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_KEY, themeMode);
    } catch {
      // Not remembered; the toggle still works.
    }
  }, [themeMode]);

  // --- Live data --------------------------------------------------------------
  const engine = () => (readyRef.current ? apiRef.current?.getDataEngine() : undefined);

  const applyOrders = useCallback(async (list: ConsoleOrder[]) => {
    const d = data.current;
    const add: ConsoleOrder[] = [];
    const update: ConsoleOrder[] = [];
    for (const o of list) (d.orders.has(o.id) ? update : add).push(o);
    for (const o of list) d.orders.set(o.id, o);
    setToShip([...d.orders.values()].filter((o) => o.fulfilment === "to_ship").length);
    if (!add.length && !update.length) return;
    await engine()?.applyTransaction?.({ tableId: "orders", add: rows(add.map(orderRow)), update: rows(update.map(orderRow)) });
    for (const o of list) {
      const popup = orderPopups.current.get(o.id);
      const params = popupParams.current?.(o);
      if (popup && params) popup.refresh(params);
    }
  }, []);

  const applyNegotiations = useCallback(async (list: ConsoleNegotiation[]) => {
    const d = data.current;
    const add = list.filter((n) => !d.negotiations.has(n.id));
    const update = list.filter((n) => d.negotiations.has(n.id));
    for (const n of list) d.negotiations.set(n.id, n);
    if (!add.length && !update.length) return;
    await engine()?.applyTransaction?.({ tableId: "negotiations", add: rows(add.map(negotiationRow)), update: rows(update.map(negotiationRow)) });
  }, []);

  const applyVariants = useCallback(async (list: ConsoleVariant[]) => {
    const d = data.current;
    const add = list.filter((v) => !d.variants.has(v.variantId));
    const update = list.filter((v) => d.variants.has(v.variantId));
    for (const v of list) d.variants.set(v.variantId, v);
    if (!add.length && !update.length) return;
    await engine()?.applyTransaction?.({ tableId: "variants", add: rows(add.map(variantRow)), update: rows(update.map(variantRow)) });
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (document.visibilityState === "visible" && readyRef.current) {
        try {
          const d = data.current;
          const { events } = await consoleApi.events(slug, d.lastEventId);
          if (events.length) {
            d.lastEventId = events.at(-1)!.id;
            const added = events.map(eventRow);
            d.events.push(...added);
            d.rawEvents.push(...events);
            if (events.some((e) => e.demo)) setIncludesDemo(true);
            await engine()?.applyTransaction?.([
              { tableId: "events", add: rows(added) },
              { tableId: "funnel", update: rows(funnelRows(d.events)) },
            ]);
            const types = new Set(events.map((e) => e.stage));
            const follow: Promise<unknown>[] = [];
            if (types.has("order") || types.has("checkout") || types.has("payment") || types.has("dispute")) {
              follow.push(consoleApi.orders(slug).then((r) => applyOrders(r.orders)));
            }
            if (types.has("negotiation")) follow.push(consoleApi.negotiations(slug).then((r) => applyNegotiations(r.negotiations)));
            if (types.has("catalog")) follow.push(consoleApi.catalog(slug).then((r) => applyVariants(r.variants)));
            await Promise.all(follow);
          }
          setLive({ at: Date.now(), ok: true });
        } catch {
          setLive((l) => ({ ...l, ok: false }));
        }
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    const clock = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [slug, applyOrders, applyNegotiations, applyVariants]);

  // --- Actions and popups -----------------------------------------------------
  const act = useCallback(
    async (orderId: string, action: OrderAction): Promise<ConsoleActionResult> => {
      const out = await consoleApi.act(
        slug,
        action.kind === "ship" ? { kind: "ship", orderId, carrier: action.carrier, trackingNumber: action.trackingNumber } : { kind: action.kind, orderId },
      );
      toast(out.ok, out.message);
      if (out.order) await applyOrders([out.order]);
      return out;
    },
    [slug, toast, applyOrders],
  );

  const orderPopupParams = (order: ConsoleOrder, shipping = false): OrderDetailProps => ({
    order,
    events: data.current.rawEvents,
    shipping,
    act,
    closePopup: () => orderPopups.current.get(order.id)?.closePopup(),
  });

  const openOrder = (orderId: string, shipping = false) => {
    const api = apiRef.current;
    const order = data.current.orders.get(orderId);
    if (!api || !order) return;
    const open = orderPopups.current.get(orderId);
    if (open) {
      open.refresh(orderPopupParams(order, shipping));
      return;
    }
    const popup = api.createPopup<OrderDetailProps>({
      comp: OrderDetail,
      compParams: orderPopupParams(order, shipping),
      title: `Order ${order.id}`,
      movable: true,
      resizable: true,
      maximizable: true,
      width: 460,
      height: 560,
      minWidth: 320,
      minHeight: 320,
      closedCallback: () => orderPopups.current.delete(orderId),
    });
    orderPopups.current.set(orderId, popup);
  };

  const openNegotiation = (id: string) => {
    const api = apiRef.current;
    const n = data.current.negotiations.get(id);
    if (!api || !n) return;
    api.createPopup({
      comp: NegotiationDetail,
      compParams: ({ closePopup }) => ({ negotiation: n, closePopup }),
      title: "Negotiation",
      movable: true,
      resizable: true,
      width: 480,
      height: 560,
      minWidth: 320,
    });
  };

  const marketCheck = async (variantIds: string[]) => {
    toast(true, `Checking other sellers' prices for ${variantIds.length} item${variantIds.length === 1 ? "" : "s"}…`);
    const out = await consoleApi.act(slug, { kind: "market_check", variantIds });
    toast(out.ok, out.message);
    if (out.variants?.length) await applyVariants(out.variants);
  };

  // Requests from cell renderers, widgets and the assistant's cards.
  const handlers = useRef<(r: ConsoleRequest) => void>(() => undefined);
  useEffect(() => {
    popupParams.current = (o) => orderPopupParams(o);
  });
  useEffect(() => {
    handlers.current = (r: ConsoleRequest) => {
      switch (r.kind) {
        case "open-order":
          return openOrder(r.orderId);
        case "ship":
          return openOrder(r.orderId, true);
        case "cancel":
        case "refund":
          return openOrder(r.orderId);
        case "open-negotiation":
          return openNegotiation(r.negotiationId);
        case "market-check":
          return void marketCheck(r.variantIds);
        case "order-changed":
          toast(true, r.message ?? `${r.order.id} updated.`);
          return void applyOrders([r.order]);
        case "variants-changed":
          return void applyVariants(r.variants);
      }
    };
  });
  useEffect(() => consoleBus.listen((r) => handlers.current(r)), []);

  const getContextMenuItems = useCallback((params: AgGetContextMenuParams): AgContextMenuItem[] => {
    const d = data.current;
    const values = filterValues(params.filter);
    const ctx = (params.widgetContext ?? {}) as Record<string, unknown>;
    const items: AgContextMenuItem[] = [];

    const orderId = (values.get("orders.id") ?? (ctx.kind === "event" ? ctx.ref : undefined)) as string | undefined;
    const order = orderId ? d.orders.get(orderId) : undefined;
    if (order) {
      items.push({ name: `Open order ${order.id}`, action: () => openOrder(order.id) });
      if (order.fulfilment === "to_ship") {
        items.push({ name: "Ship…", action: () => openOrder(order.id, true) });
        items.push({ name: "Cancel order…", action: () => openOrder(order.id) });
      }
      if (order.fulfilment === "shipped") items.push({ name: "Refund…", action: () => openOrder(order.id) });
      items.push("separator", { name: "Copy order number", action: () => void navigator.clipboard?.writeText(order.id) });
    }

    const negotiationId = (values.get("negotiations.id") ?? (ctx.kind === "negotiation" ? ctx.id : undefined)) as string | undefined;
    if (negotiationId && d.negotiations.has(negotiationId)) {
      items.push({ name: "Open transcript", action: () => openNegotiation(negotiationId) });
    }

    const product = (values.get("variants.product") ?? values.get("variants.item") ?? values.get("variants.variantId")) as string | undefined;
    if (product) {
      const ids = [...d.variants.values()].filter((v) => v.productName === product || v.name === product || v.variantId === product).map((v) => v.variantId);
      if (ids.length) items.push({ name: `Re-check market price for ${product}`, action: () => void marketCheck(ids.slice(0, 10)) });
    }
    return items;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- reads live data through refs

  // --- Navigation -------------------------------------------------------------
  const goTo = (id: PageId) => {
    const api = apiRef.current;
    if (!api) return;
    api.setState({ ...api.getState(), selectedPageId: id } as AgReportState<ConsoleRegistry>);
    setPage(id);
  };

  const openPanel = (panel: "ai" | "edit") => {
    setFocusPanel(panel);
    setMode((m) => (m === "edit" && focusPanel === panel ? "view" : "edit"));
  };

  // Entering edit mode opens the panel that was asked for and folds the others away.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || mode !== "edit") return;
    const frame = requestAnimationFrame(() => {
      const state = api.getState();
      const open = (name: string, on: boolean) => ({ ...state.panels?.[name], collapsed: !on });
      api.setState({
        ...state,
        panels: {
          ...state.panels,
          ai: { ...open("ai", focusPanel === "ai"), width: 440 },
          edit: open("edit", focusPanel === "edit"),
          data: open("data", focusPanel === "edit"),
          filters: open("filters", false),
        },
      } as AgReportState<ConsoleRegistry>);
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, focusPanel]);

  const liveText = live.ok ? `Live, updated ${ago(live.at)} ago` : "Reconnecting…";
  const onOrders = page === "orders" || page === "order-book";

  return (
    <div className={`${s.root} ag-theme-mode`} data-ag-theme-mode={themeMode}>
      <style>{tokenCss(`.${s.root}`)}</style>
      <header className={s.bar}>
        <div className={s.identity}>
          <span className={s.mark} aria-hidden>
            <svg viewBox="0 0 20 20" width="20" height="20">
              <path d="M2 14h16" stroke="currentColor" strokeWidth="1.6" />
              <path d="M7 9v10" stroke="var(--cx-floor)" strokeWidth="1.6" />
              <circle cx="13" cy="14" r="2.6" fill="currentColor" />
            </svg>
          </span>
          <div className={s.shopName}>
            <strong>{summary.shop.name}</strong>
            <span>
              {summary.shop.owner}, {summary.shop.city}
            </span>
          </div>
        </div>

        <nav className={s.tabs} aria-label="Console pages">
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={s.tab}
              aria-current={page === p.id || (p.id === "orders" && page === "order-book") ? "page" : undefined}
              onClick={() => goTo(p.id)}
            >
              {p.title}
              {p.id === "orders" && toShip > 0 ? <span className={s.count}>{toShip}</span> : null}
            </button>
          ))}
        </nav>

        <div className={s.tools}>
          <span className={s.live} data-ok={live.ok} title="New activity appears without reloading">
            <span className={s.pulse} aria-hidden />
            {liveText}
          </span>
          {includesDemo ? (
            <span className={s.demo} title="Seeded activity is mixed in so the Console isn't empty before real agent traffic arrives">
              Includes demo activity
            </span>
          ) : null}
          {onOrders ? (
            <button type="button" className={s.button} onClick={() => goTo(page === "order-book" ? "orders" : "order-book")}>
              {page === "order-book" ? "Back to overview" : "Full-page table"}
            </button>
          ) : null}
          {aiEnabled ? (
            <button type="button" className={s.button} data-active={mode === "edit" && focusPanel === "ai"} onClick={() => openPanel("ai")}>
              Assistant
            </button>
          ) : null}
          <button type="button" className={`${s.button} ${s.wide}`} data-active={mode === "edit" && focusPanel === "edit"} onClick={() => openPanel("edit")}>
            {mode === "edit" && focusPanel === "edit" ? "Done" : "Customize"}
          </button>
          <button
            type="button"
            className={s.iconButton}
            aria-label={themeMode === DARK_MODE ? "Use light theme" : "Use dark theme"}
            onClick={() => setThemeMode((m) => (m === DARK_MODE ? LIGHT_MODE : DARK_MODE))}
          >
            {themeMode === DARK_MODE ? (
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
                <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10 2v2.2M10 15.8V18M2 10h2.2M15.8 10H18M4.3 4.3l1.6 1.6M14.1 14.1l1.6 1.6M4.3 15.7l1.6-1.6M14.1 5.9l1.6-1.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
                <path d="M16 12.5A6.5 6.5 0 0 1 7.5 4a6.5 6.5 0 1 0 8.5 8.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {openShipments.length ? (
        <aside className={s.tray} aria-label="Shipments waiting for your confirmation">
          {openShipments.map((p) => (
            <ShipmentConfirm key={p.id} shipment={p} />
          ))}
        </aside>
      ) : null}

      <main className={s.canvas}>
        <AgStudioProvider licenseKey={licenseKey} modules={modules}>
          <AgStudio<ConsoleRegistry>
            style={studioStyle}
            theme={consoleTheme}
            data={studioData}
            initialState={initialState}
            widgets={widgets}
            layout={layout}
            panels={panels}
            mode={mode}
            ai={ai}
            aiToolDisplay={merchantOpsToolDisplay}
            responsiveLayoutBreakpoints={breakpoints}
            getContextMenuItems={getContextMenuItems}
            onApiReady={(e) => {
              apiRef.current = e.api as unknown as AgStudioApi<ConsoleRegistry>;
            }}
            onStudioReady={() => {
              readyRef.current = true;
            }}
            onStateUpdated={(e) => setPage(e.state.selectedPageId as PageId)}
          />
        </AgStudioProvider>
      </main>

      <div className={s.toasts} role="status" aria-live="polite">
        {toasts.map((t) => (
          <p key={t.id} className={s.toast} data-ok={t.ok}>
            {t.text}
          </p>
        ))}
      </div>
    </div>
  );
}
