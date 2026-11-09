import type { C3Product } from "../src/channel3/port";
import { assignVariantIds, varyingKeys } from "../src/rows";
import { slug } from "../src/text";
import type { ProductDraft } from "../src/types";

/** Keys whose string values are vocabulary rather than merchant data. */
const KEEP = new Set(["currency", "availability", "condition", "unit", "kind", "position", "shot_type", "slug"]);

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces merchant-identifying data in recorded live output (domains,
 * brands, product titles, Channel3 ids, links and images) with stable
 * placeholders, keeping shapes and numbers. `assertClean` fails if any
 * registered original is still present.
 */
export class Anonymiser {
  private readonly domains = new Map<string, string>();
  private readonly brands = new Map<string, string>();
  private readonly titles = new Map<string, string>();
  private readonly ids = new Map<string, string>();
  private readonly images = new Map<string, string>();

  domain(d: string): string {
    const key = d.toLowerCase().replace(/^www\d*\./, "");
    if (!key) return d;
    if (!this.domains.has(key)) this.domains.set(key, `shop-${this.domains.size + 1}.example`);
    return this.domains.get(key)!;
  }

  brand(name: string): string {
    if (!this.brands.has(name)) this.brands.set(name, `Brand ${this.brands.size + 1}`);
    return this.brands.get(name)!;
  }

  title(t: string): string {
    if (!this.titles.has(t)) this.titles.set(t, `Product ${String.fromCharCode(65 + (this.titles.size % 26))}${this.titles.size >= 26 ? this.titles.size : ""}`);
    return this.titles.get(t)!;
  }

  id(i: string): string {
    if (!this.ids.has(i)) this.ids.set(i, `prod${String(this.ids.size + 1).padStart(3, "0")}`);
    return this.ids.get(i)!;
  }

  /** Registers what a Channel3 product names, so later text can be scrubbed of it. */
  learn(p: C3Product | null | undefined): void {
    if (!p) return;
    this.id(p.id);
    this.title(p.title);
    for (const b of p.brands ?? []) this.brand(b.name);
    for (const o of p.offers ?? []) this.domain(o.domain);
  }

  url(u: string): string {
    let url: URL;
    try {
      url = new URL(u);
    } catch {
      return this.text(u);
    }
    if (url.hostname === "buy.trychannel3.com") {
      const id = url.pathname.split("/")[1]?.split("-")[0] ?? "";
      return `https://buy.trychannel3.com/${id ? this.id(id) : ""}`;
    }
    if (url.hostname.endsWith("trychannel3.com")) {
      if (!this.images.has(u)) this.images.set(u, `https://images.example/${this.images.size + 1}.jpg`);
      return this.images.get(u)!;
    }
    return `https://${this.domain(url.hostname)}/products/item`;
  }

  /** Free text with every known title, brand, domain and domain name replaced. */
  text(s: string): string {
    const pairs: Array<[string, string]> = [
      ...this.titles,
      ...this.brands,
      ...[...this.domains].flatMap(([d, to]): Array<[string, string]> => [
        [d, to],
        [d.split(".")[0]!, to.split(".")[0]!],
      ]),
    ];
    const titleSlugs: Array<[string, string]> = [...this.titles].flatMap(([from, to]) => [
      [slug(from.replace(/^(the|a|an)\s+/i, ""), 32), slug(to, 32)],
      [slug(from, 32), slug(to, 32)],
    ]);
    let out = s;
    for (const [from, to] of [...pairs, ...titleSlugs].filter(([f]) => f.length >= 3).sort((a, b) => b[0].length - a[0].length)) {
      out = out.replace(new RegExp(escape(from), "gi"), to);
    }
    return out;
  }

  /** Numbers, booleans, nulls, keys and array lengths as they are; strings as placeholders. */
  skeleton(v: unknown, key = ""): unknown {
    if (Array.isArray(v)) return v.map((x) => this.skeleton(x, key));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.skeleton(x, k)]));
    if (typeof v !== "string") return v;
    if (KEEP.has(key)) return v;
    if (key === "url" || /^https?:\/\//.test(v)) return this.url(v);
    if (key === "id" || key === "product_id") return this.id(v);
    if (key === "domain") return this.domain(v);
    return `<text ${v.length}>`;
  }

  /**
   * A draft with its name, description, source, market and warnings
   * scrubbed. The values buyers choose between are the shop's own naming
   * (glaze names, colourways), so they become `<key> 1`, `<key> 2`...;
   * attributes every variant shares stay, and variant ids are rebuilt.
   */
  draft(d: ProductDraft): ProductDraft {
    const name = this.title(d.name);
    const varying = varyingKeys(d);
    const options = new Map(varying.map((k) => [k, [...new Set(d.variants.map((v) => v.attributes[k] ?? ""))]]));
    const variants = d.variants.map((v) => ({
      ...v,
      attributes: Object.fromEntries(
        Object.entries(v.attributes).map(([k, value]) => [k, options.has(k) ? `${k} ${options.get(k)!.indexOf(value) + 1}` : value]),
      ),
    }));
    const parentId = this.text(d.parentId);
    assignVariantIds({ ...d, parentId, variants }, "").forEach((id, i) => (variants[i]!.variantId = id));
    return {
      ...d,
      parentId,
      name,
      description: this.text(d.description),
      variants,
      source: {
        ...d.source,
        ...(d.source.ref ? { ref: d.source.kind === "url" ? this.url(d.source.ref) : this.text(d.source.ref) } : {}),
        ...(d.source.merchant ? { merchant: this.domain(d.source.merchant) } : {}),
      },
      ...(d.market
        ? {
            market: {
              ...d.market,
              comparable: d.market.comparable.map((c) => ({
                title: this.title(c.title),
                merchant: this.domain(c.merchant),
                priceCents: c.priceCents,
                url: this.url(c.url),
              })),
            },
          }
        : {}),
      warnings: d.warnings.map((w) => this.text(w)),
    };
  }

  /** Throws when any registered domain, domain name, brand, Channel3 id or title is still in `value`. */
  assertClean(value: unknown): void {
    const json = JSON.stringify(value).toLowerCase();
    const originals = [
      ...[...this.domains.keys()].flatMap((d) => [d, d.split(".")[0]!]),
      ...this.brands.keys(),
      ...this.ids.keys(),
      ...[...this.titles.keys()].map((t) => `"${t}"`),
    ].filter((o) => o.length >= 4);
    const left = originals.filter((o) => json.includes(o.toLowerCase()));
    if (left.length) throw new Error(`Recorded output still names: ${left.join(", ")}`);
  }
}
