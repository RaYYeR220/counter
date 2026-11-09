"use client";

import type { AgWidgetField, AgWidgetFieldReference } from "ag-studio";
import type { AgWidgetCustomCellRendererProps } from "ag-studio-react";
import type { ComponentType } from "react";
import { consoleBus } from "@/lib/console/bus";
import s from "./widgets.module.css";

// Cell renderers for Studio's own table widget: status chips, agent badges
// and the order row's next action, so a plain Studio table reads like the
// rest of the Console.

const TONES: Record<string, string> = {
  "To ship": "accent",
  Shipped: "ok",
  Cancelled: "warn",
  Refunded: "warn",
  Disputed: "bad",
  Accepted: "ok",
  Countered: "warn",
  Refused: "bad",
  "In range": "ok",
  "Above market": "warn",
  "Below market": "accent",
};

function Chip({ value }: AgWidgetCustomCellRendererProps) {
  if (value == null || value === "") return null;
  const text = String(value);
  return (
    <span className={s.chip} data-tone={TONES[text]}>
      {text}
    </span>
  );
}

function Agent({ value }: AgWidgetCustomCellRendererProps) {
  if (value == null || value === "") return null;
  const text = String(value);
  return (
    <span className={s.agent}>
      <span>{text}</span>
    </span>
  );
}

const ORDER_ID: AgWidgetFieldReference = { id: "orders.id" };

function NextStep(props: AgWidgetCustomCellRendererProps) {
  const step = props.value == null ? "" : String(props.value);
  // The linked value when Studio fetched it; otherwise the row's own Order column.
  const orderId = props.getLinkedValue(ORDER_ID) ?? (props as { data?: Record<string, unknown> }).data?.["orders.id"];
  if (typeof orderId !== "string" || !step || step === "Closed") {
    return <span style={{ color: "var(--cx-muted)" }}>{step === "Closed" ? "Done" : step}</span>;
  }
  const kind = step === "Ship" ? "ship" : step === "Refund" ? "refund" : "open-order";
  return (
    <button
      type="button"
      className="cx-cell-action"
      data-kind={kind}
      onClick={(e) => {
        e.stopPropagation();
        consoleBus.send(kind === "open-order" ? { kind, orderId } : { kind, orderId });
      }}
    >
      {step}
    </button>
  );
}

function OrderLink(props: AgWidgetCustomCellRendererProps) {
  const id = props.value == null ? "" : String(props.value);
  if (!id) return null;
  return (
    <button
      type="button"
      className="cx-cell-link"
      onClick={(e) => {
        e.stopPropagation();
        consoleBus.send({ kind: "open-order", orderId: id });
      }}
    >
      {id}
    </button>
  );
}

const fieldName = (field: AgWidgetField) => String(field.rootFieldId ?? field.fieldId ?? "");

export function createCellRenderer(field: AgWidgetField): ComponentType<AgWidgetCustomCellRendererProps> | undefined {
  const id = fieldName(field);
  if (field.aggregation) return undefined;
  if (id === "orders.nextStep") return NextStep;
  if (id === "orders.id") return OrderLink;
  if (/\.agent$/.test(id)) return Agent;
  if (["orders.fulfilment", "negotiations.verdict", "variants.position"].includes(id)) return Chip;
  return undefined;
}

export function getLinkedFields(field: AgWidgetField): AgWidgetFieldReference[] | undefined {
  return fieldName(field) === "orders.nextStep" ? [ORDER_ID] : undefined;
}
