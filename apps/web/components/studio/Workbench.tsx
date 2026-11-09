"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { importProducts, publishProducts } from "@/app/studio/actions";
import { DraftCard, draftProblemsOf, type EditableDraft } from "./DraftCard";
import { preparePhoto, type PreparedPhoto } from "./image";
import type { PublishResult, StudioShop } from "./types";
import s from "./studio.module.css";

type Source = "url" | "photo" | "csv";

const SOURCES: Array<{ id: Source; label: string }> = [
  { id: "url", label: "Product URL" },
  { id: "photo", label: "Photo" },
  { id: "csv", label: "CSV" },
];

const SAMPLE_CSV = `Handle,Title,Option1 Name,Option1 Value,Variant Price,Variant Inventory Qty,Cost per item
market-tote,Canvas market tote,Color,Natural,28.00,40,9.50
market-tote,Canvas market tote,Color,Indigo,30.00,25,10.00
linen-napkins,Linen napkins (set of 4),Color,Oat,36.00,18,12.00`;

const WORKING: Record<Source, string> = {
  url: "Reading the product page, then checking what other sellers charge. This can take up to a minute.",
  photo: "Reading the photo, then looking for comparable products. This can take up to a minute.",
  csv: "Reading the rows, then checking what other sellers charge. This can take up to a minute.",
};

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/** Sections 2 and 3 of Studio: import products as editable drafts, then publish them. */
export function Workbench({ shop, liveProducts }: { shop: StudioShop; liveProducts: number }) {
  const router = useRouter();
  const ids = useId();
  const [source, setSource] = useState<Source>("url");
  const [url, setUrl] = useState("");
  const [csv, setCsv] = useState("");
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [photoNote, setPhotoNote] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [drafts, setDrafts] = useState<EditableDraft[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<PublishResult | null>(null);
  const nextKey = useRef(1);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const canImport =
    !importing && ((source === "url" && url.trim().length > 8) || (source === "photo" && !!photo) || (source === "csv" && csv.trim().length > 0));

  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setPhoto(null);
    setPreview(null);
    setPhotoNote("");
    setImportError("");
    if (!file) return;
    try {
      const prepared = await preparePhoto(file);
      setPhoto(prepared);
      setPreview(URL.createObjectURL(prepared.file));
      setPhotoNote(`Resized to ${prepared.width} × ${prepared.height} px, ${kb(prepared.file.size)} (from ${kb(file.size)}).`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "That photo couldn't be read.");
    }
  };

  const onCsvFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 200 * 1024) {
      setImportError("Keep CSV imports under 200 KB here; split bigger catalogs.");
      return;
    }
    setCsv(await file.text());
    setImportError("");
  };

  const runImport = async () => {
    if (!canImport) return;
    const form = new FormData();
    form.set("shop", shop.slug);
    form.set("kind", source);
    if (source === "url") form.set("url", url.trim());
    if (source === "csv") form.set("csv", csv);
    if (source === "photo" && photo) form.set("photo", photo.file);
    setImporting(true);
    setImportError("");
    setPublished(null);
    try {
      const res = await importProducts(form);
      if (!res.ok) {
        setImportError(res.message);
        return;
      }
      if (!res.drafts.length) {
        setImportError("The import found no products. Check the source and try again.");
        return;
      }
      setDrafts((all) => [
        ...all,
        ...res.drafts.map((d) => ({
          key: nextKey.current++,
          draft: d.draft,
          floorSources: d.floorSources,
          floorEdited: d.draft.variants.map(() => false),
        })),
      ]);
      if (source === "url") setUrl("");
    } catch {
      setImportError("Studio couldn't reach the server. Check your connection and try again.");
    } finally {
      setImporting(false);
    }
  };

  const problems = drafts.flatMap((d) => draftProblemsOf(d.draft));
  const variantCount = drafts.reduce((n, d) => n + d.draft.variants.length, 0);

  const publish = async () => {
    if (!shop.canPublish || !drafts.length || problems.length) return;
    setPublishing(true);
    setPublished(null);
    try {
      const res = await publishProducts(
        shop.slug,
        drafts.map((d) => d.draft),
      );
      setPublished(res);
      if (res.ok) {
        setDrafts([]);
        router.refresh();
      }
    } catch {
      setPublished({ ok: false, message: "Studio couldn't reach the server. Nothing was published; try again." });
    } finally {
      setPublishing(false);
    }
  };

  const onTabKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : SOURCES.length - 1)) % SOURCES.length;
    setSource(SOURCES[next]!.id);
    tabRefs.current[next]?.focus();
  };

  return (
    <>
      <section id="products" className={s.section} aria-labelledby="products-h">
        <header className={s.sectionHead}>
          <span className={s.stepNo} aria-hidden>
            2
          </span>
          <div className={s.sectionTitle}>
            <h2 id="products-h">Add products</h2>
            <p>
              Start from a product page, a photo or a spreadsheet. Each import becomes a draft with exact variants, a check of what other
              sellers charge and a suggested floor. Nothing is saved until you publish.
            </p>
          </div>
          <span className={s.chip} data-tone={liveProducts ? "ok" : "muted"}>
            {liveProducts ? `${liveProducts} live` : "No products yet"}
          </span>
        </header>
        <div className={s.sectionBody}>
          <div className={s.tabs} role="tablist" aria-label="Import from">
            {SOURCES.map((src, i) => (
              <button
                key={src.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${ids}-tab-${src.id}`}
                aria-selected={source === src.id}
                aria-controls={`${ids}-panel`}
                tabIndex={source === src.id ? 0 : -1}
                onClick={() => setSource(src.id)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                {src.label}
              </button>
            ))}
          </div>

          <form
            id={`${ids}-panel`}
            role="tabpanel"
            aria-labelledby={`${ids}-tab-${source}`}
            className={s.importPanel}
            onSubmit={(e) => {
              e.preventDefault();
              void runImport();
            }}
          >
            {source === "url" ? (
              <label className={s.field}>
                <span>Product page address</span>
                <input
                  type="url"
                  inputMode="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://yourshop.com/products/speckled-mug"
                  autoComplete="off"
                />
                <span className={s.hint}>A page from your own shop works best: Shopify, Etsy, Squarespace and most product pages.</span>
              </label>
            ) : null}
            {source === "photo" ? (
              <div className={s.photoRow}>
                <label className={s.field}>
                  <span>Product photo</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onPhoto} />
                  <span className={s.hint}>One item, plain background. Resized here to 1600 px before upload.</span>
                </label>
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local preview of the resized upload
                  <img src={preview} alt="The photo that will be imported" className={s.preview} />
                ) : null}
                {photoNote ? <p className={s.hint}>{photoNote}</p> : null}
              </div>
            ) : null}
            {source === "csv" ? (
              <div className={s.csvBlock}>
                <label className={s.field}>
                  <span>CSV rows</span>
                  <textarea
                    rows={6}
                    value={csv}
                    onChange={(e) => setCsv(e.target.value)}
                    placeholder="Handle,Title,Option1 Name,Option1 Value,Variant Price,Variant Inventory Qty"
                    spellCheck={false}
                  />
                  <span className={s.hint}>A Shopify product export works as is. Columns for cost and floor are used when present.</span>
                </label>
                <div className={s.csvTools}>
                  <label className={s.fileButton}>
                    Choose a .csv file
                    <input type="file" accept=".csv,text/csv" onChange={onCsvFile} />
                  </label>
                  <button type="button" className={s.linkButton} onClick={() => setCsv(SAMPLE_CSV)}>
                    Use a sample
                  </button>
                </div>
              </div>
            ) : null}
            <div className={s.importActions}>
              <button type="submit" className={s.primary} disabled={!canImport}>
                {importing ? "Importing…" : "Import"}
              </button>
              <p className={s.hint}>3 imports a minute.</p>
            </div>
            <div aria-live="polite" className={s.liveRegion}>
              {importing ? (
                <p className={s.working}>
                  <span className={s.workingDot} aria-hidden />
                  {WORKING[source]}
                </p>
              ) : null}
              {importError ? <p className={s.formError}>{importError}</p> : null}
            </div>
          </form>

          {drafts.length ? (
            <div className={s.drafts}>
              <h3 className={s.draftsHead}>
                Drafts{" "}
                <span className={s.quiet}>
                  {drafts.length} product{drafts.length === 1 ? "" : "s"}, {variantCount} variant{variantCount === 1 ? "" : "s"}
                </span>
              </h3>
              {drafts.map((d) => (
                <DraftCard
                  key={d.key}
                  value={d}
                  maxDiscountPct={shop.maxDiscountPct}
                  onChange={(next) => setDrafts((all) => all.map((x) => (x.key === d.key ? next : x)))}
                  onRemove={() => setDrafts((all) => all.filter((x) => x.key !== d.key))}
                />
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section id="publish" className={s.section} aria-labelledby="publish-h">
        <header className={s.sectionHead}>
          <span className={s.stepNo} aria-hidden>
            3
          </span>
          <div className={s.sectionTitle}>
            <h2 id="publish-h">Publish</h2>
            <p>Publishing writes the drafts into the catalog agents shop: search, the seller agent&apos;s floors and the Store Sync cart.</p>
          </div>
          <span className={s.chip} data-tone={shop.canPublish ? (drafts.length ? "warn" : "muted") : "muted"}>
            {shop.canPublish ? (drafts.length ? `${drafts.length} to publish` : "Nothing to publish") : "Test shops only"}
          </span>
        </header>
        <div className={s.sectionBody}>
          {!shop.canPublish ? (
            <p className={s.banner} data-tone="muted">
              {shop.name} is a demo shop: it keeps its seeded catalog so every visitor sees the same shop. Imports work here for a look at the
              drafts; to publish, create a test shop (top of the page) and import there.
            </p>
          ) : null}
          {drafts.length && problems.length ? (
            <div className={s.problems}>
              <p>Fix these before publishing:</p>
              <ul>
                {problems.slice(0, 8).map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className={s.importActions}>
            <button
              type="button"
              className={s.primary}
              onClick={() => void publish()}
              disabled={!shop.canPublish || !drafts.length || problems.length > 0 || publishing}
            >
              {publishing
                ? "Publishing…"
                : drafts.length
                  ? `Publish ${drafts.length} product${drafts.length === 1 ? "" : "s"} to ${shop.name}`
                  : `Publish to ${shop.name}`}
            </button>
            {!drafts.length ? <p className={s.hint}>Import products first; they appear above as drafts.</p> : null}
          </div>
          <div aria-live="polite" className={s.liveRegion}>
            {published?.ok ? (
              <p className={s.banner} data-tone="ok">
                Published {published.products} product{published.products === 1 ? "" : "s"} ({published.variants} variants: {published.created} new,{" "}
                {published.updated} updated). Agents can find them within a minute: try the{" "}
                <a href={`/s/${shop.slug}`} target="_blank" rel="noopener noreferrer">
                  storefront
                </a>{" "}
                or ask for one in the <a href="/playground">Playground</a>.
              </p>
            ) : null}
            {published && !published.ok ? (
              <div className={s.problems}>
                <p>{published.message}</p>
                {published.problems?.length ? (
                  <ul>
                    {published.problems.slice(0, 8).map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}
