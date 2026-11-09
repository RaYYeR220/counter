import type {
  AgBaseRegistry,
  AgBaseWidgetDefinition,
  AgDefaultWidgetDefinition,
  AgExternalShape,
  AgFormatShapeParams,
  AgShapeBuilder,
  AgTitle,
  AgWidgetFieldReference,
} from "ag-studio";

/** Formats every Console widget shares: Studio's titles plus the cross-filter switches. */
export interface ConsoleWidgetFormat<TStyle> {
  title?: AgTitle;
  subtitle?: AgTitle;
  caption?: AgTitle;
  crossFilter?: "highlight" | "filter" | "none";
  triggerCrossFilter?: boolean;
  style?: TStyle;
}

export interface AgentStreamDef {
  type: "agent-stream";
  dataMapping: {
    time: AgWidgetFieldReference[];
    agent: AgWidgetFieldReference[];
    event: AgWidgetFieldReference[];
    amount?: AgWidgetFieldReference[];
    reference?: AgWidgetFieldReference[];
    latency?: AgWidgetFieldReference[];
  };
  format?: ConsoleWidgetFormat<{ maxRows?: number; showLatency?: boolean }>;
}

export interface FloorLadderDef {
  type: "floor-ladder";
  dataMapping: {
    label: AgWidgetFieldReference[];
    list: AgWidgetFieldReference[];
    ask: AgWidgetFieldReference[];
    answer: AgWidgetFieldReference[];
    final: AgWidgetFieldReference[];
    floor: AgWidgetFieldReference[];
    verdict?: AgWidgetFieldReference[];
    agent?: AgWidgetFieldReference[];
    time?: AgWidgetFieldReference[];
    id?: AgWidgetFieldReference[];
  };
  format?: ConsoleWidgetFormat<{ maxRows?: number; showFloorValue?: boolean }>;
}

export interface MarketPositionDef {
  type: "market-position";
  dataMapping: {
    label: AgWidgetFieldReference[];
    price: AgWidgetFieldReference[];
    low: AgWidgetFieldReference[];
    median: AgWidgetFieldReference[];
    high: AgWidgetFieldReference[];
    floor?: AgWidgetFieldReference[];
  };
  format?: ConsoleWidgetFormat<{ maxRows?: number }>;
}

export interface ConsoleRegistry extends AgBaseRegistry {
  widgets: readonly (
    | AgDefaultWidgetDefinition
    | AgBaseWidgetDefinition<"agent-stream", AgentStreamDef>
    | AgBaseWidgetDefinition<"floor-ladder", FloorLadderDef>
    | AgBaseWidgetDefinition<"market-position", MarketPositionDef>
  )[];
}

/**
 * Builds a widget's `formatShape` with Studio's own shape builder, so the
 * assistant gets a JSON schema for the widget's options and Studio validates
 * what it writes. The builder is the one Studio hands to AI commands; without
 * the AI module there is no assistant to describe the format to.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function formatShape(build: (s: AgShapeBuilder) => AgExternalShape<any>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ({ api }: AgFormatShapeParams): AgExternalShape<any> => {
    const define = (api as { defineAiCommand?: (f: (s: AgShapeBuilder) => unknown) => unknown }).defineAiCommand;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let shape: AgExternalShape<any> | undefined;
    if (typeof define === "function") {
      define.call(api, (s: AgShapeBuilder) => {
        shape = build(s);
        return { input: s.object({}), execute: () => ({ success: true, value: undefined }) };
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return shape as AgExternalShape<any>;
  };
}

/** The format fields every Console widget keeps: titles and cross-filtering. */
export function baseFormat(s: AgShapeBuilder) {
  const typography = s
    .object({
      fontFamily: s.string().optional(),
      fontSize: s.number().optional(),
      fontWeight: s.union([s.string(), s.number()]).optional(),
      fontStyle: s.string().optional(),
    })
    .optional();
  const title = s
    .object({
      enabled: s.boolean({ description: "Show this line." }).optional(),
      text: s.string().optional(),
      color: s.string().optional(),
      typography,
    })
    .optional();
  return {
    title,
    subtitle: title,
    caption: title,
    crossFilter: s.enum(["highlight", "filter", "none"]).optional(),
    triggerCrossFilter: s.boolean().optional(),
  };
}
