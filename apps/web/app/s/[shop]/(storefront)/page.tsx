import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import c from "@/components/storefront/catalog.module.css";
import { artKind, ProductArt } from "@/components/storefront/ProductArt";
import { LoadingShell, ShopFrame } from "@/components/storefront/ShopFrame";
import s from "@/components/storefront/sf.module.css";
import { getShopSummary, getShopView, shippingRates } from "@/lib/storefront/catalog";
import { flagLabel, money } from "@/lib/storefront/format";
import { artSubject, defaultVariant, heroSubjects, productHref } from "@/lib/storefront/pick";
import type { ProductView } from "@/lib/storefront/types";

export async function generateMetadata({ params }: PageProps<"/s/[shop]">): Promise<Metadata> {
  const { shop } = await params;
  const summary = await getShopSummary(shop);
  if (!summary) return { title: "Shop not found" };
  return { title: `${summary.name}: ${summary.tagline}`, description: summary.about.slice(0, 160) };
}

export default function ShopHomePage({ params }: PageProps<"/s/[shop]">) {
  return (
    <Suspense fallback={<LoadingShell />}>
      <ShopHome params={params} />
    </Suspense>
  );
}

/** The first one or two sentences, up to about 260 characters. */
function intro(about: string): string {
  const sentences = about.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [about];
  let out = "";
  for (const sentence of sentences) {
    if (out && out.length + sentence.length > 260) break;
    out += sentence;
  }
  return out.trim();
}

function ProductCard({ shop, product }: { shop: string; product: ProductView }) {
  const v = defaultVariant(product);
  const flags = product.flags.filter((f) => !(f === "subscription_only" && product.availability.kind === "not_sold_alone"));
  const soldOut = product.availability.kind === "sold_out";
  return (
    <li className={c.card}>
      <div className={c.tile}>
        <ProductArt subject={artSubject(product, v)} decorative />
      </div>
      <h3 className={c.cardTitle}>
        <Link href={productHref(shop, product.parentId)} className={c.cardLink}>
          {product.name}
        </Link>
      </h3>
      <p className={c.cardPrice}>
        <span className={soldOut ? c.soldOut : undefined}>
          {product.priceVaries ? `From ${money(product.fromCents)}` : money(product.fromCents)}
        </span>
      </p>
      <p className={c.cardAvail}>{product.availability.label}</p>
      {flags.length ? (
        <ul className={c.chips} aria-label="Notes">
          {flags.map((f) => (
            <li key={f} className={c.chip}>
              {flagLabel(f)}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

async function ShopHome({ params }: { params: PageProps<"/s/[shop]">["params"] }) {
  const { shop: slug } = await params;
  const shop = await getShopView(slug);
  if (!shop) notFound();

  const hero = heroSubjects(shop.products);
  // Long, flat things (skeins) read better piled up than side by side.
  const stacked = hero.length > 0 && hero.every((h) => artKind(h) === "skein");
  const days = shop.policy.handlingDays;

  return (
    <ShopFrame shop={shop} rates={shippingRates()}>
      <section className={c.hero} aria-labelledby="shop-intro">
        <div className={c.heroText}>
          <h1 id="shop-intro" className={c.heroTitle}>
            {shop.tagline}
          </h1>
          <p className={c.heroOwner}>
            From {shop.owner} in {shop.city}
          </p>
          <p className={c.heroAbout}>{intro(shop.about)}</p>
          <div className={c.heroActions}>
            <a href="#products" className={s.button}>
              Shop all {shop.products.length} products
            </a>
            <a href="#about" className={s.link}>
              Read our story
            </a>
          </div>
        </div>
        <div className={`${c.heroArt} ${stacked ? c.heroStack : ""}`} aria-hidden="true">
          {hero.map((subject) => (
            <ProductArt key={subject.parentId} subject={subject} decorative crop />
          ))}
        </div>
      </section>

      <section id="products" className={c.catalog} aria-labelledby="products-title">
        <div className={c.categoryHead}>
          <h2 id="products-title" className={c.categoryTitle}>
            All products
          </h2>
          <span className={c.categoryCount}>
            {shop.products.length} {shop.products.length === 1 ? "product" : "products"}
          </span>
        </div>
        <ul className={c.grid}>
          {shop.products.map((p) => (
            <ProductCard key={p.parentId} shop={shop.slug} product={p} />
          ))}
        </ul>
      </section>

      <section id="about" className={c.about} aria-labelledby="about-title">
        <h2 id="about-title" className={c.aboutTitle}>
          About {shop.name}
        </h2>
        <div>
          <p className={c.aboutBody}>{shop.about}</p>
          <p className={c.aboutSign}>
            {shop.owner}, {shop.city}
          </p>
          <ul className={c.facts}>
            <li>
              Ships from {shop.policy.shipsFrom} within {days} business {days === 1 ? "day" : "days"}
            </li>
            <li>Returns within {shop.policy.returnsDays} days of delivery</li>
            <li>US shipping only</li>
          </ul>
        </div>
      </section>
    </ShopFrame>
  );
}
