// Display helpers shared by server and client storefront components.

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** 3400 -> "$34.00" */
export function money(cents: number): string {
  return usd.format(cents / 100);
}

const dayFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** "2026-11-17" -> "Tue, Nov 17" */
export function formatDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? ymd : dayFormat.format(d);
}

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? String(d) : dateFormat.format(date);
}

/** "dye_lot" -> "Dye lot" */
export function attributeLabel(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : key;
}

/** "whole bean" -> "Whole bean"; values that start with a digit or capital are kept. */
export function displayValue(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

export const FLAG_LABELS: Record<string, string> = {
  seconds: "Seconds",
  decaf: "Decaf",
  made_to_order: "Made to order",
  subscription_only: "Subscription only",
  limited: "Limited lot",
};

export function flagLabel(flag: string): string {
  return FLAG_LABELS[flag] ?? attributeLabel(flag);
}

export function stockLabel(stock: number): string {
  if (stock <= 0) return "Sold out";
  if (stock <= 10) return `${stock} left`;
  return `${stock} in stock`;
}

export const US_STATES: ReadonlyArray<readonly [code: string, name: string]> = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
];

export const STATE_NAMES: Record<string, string> = Object.fromEntries(US_STATES);
