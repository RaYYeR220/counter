import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import c from "@/components/storefront/catalog.module.css";
import { ProductDetail } from "@/components/storefront/ProductDetail";
import p from "@/components/storefront/product.module.css";
import { LoadingShell, ShopFrame } from "@/components/storefront/ShopFrame";
import s from "@/components/storefront/sf.module.css";
import { storeNow } from "@/lib/server/runtime";
import { deliveryQuotes, FREE_STANDARD_FROM_CENTS, getShopView, shippingRates } from "@/lib/storefront/catalog";

type Props = PageProps<"/s/[shop]/p/[parentId]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { shop, parentId } = await params;
  const view = await getShopView(shop);
  const product = view?.products.find((x) => x.parentId === parentId);
  if (!view || !product) return { title: "Product not found" };
  return { title: `${product.name} | ${view.name}`, description: product.description.slice(0, 160) };
}

export default function ProductPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<LoadingShell label="Loading the product" />}>
      <Product params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Product({ params, searchParams }: Props) {
  const [{ shop: slug, parentId }, query] = await Promise.all([params, searchParams]);
  const shop = await getShopView(slug);
  if (!shop) notFound();
  const rates = shippingRates();
  const product = shop.products.find((x) => x.parentId === parentId);

  if (!product) {
    return (
      <ShopFrame shop={shop} rates={rates}>
        <div className={c.missing}>
          <h1 className={s.pageTitle}>We can&apos;t find that product</h1>
          <p className={s.muted}>It may have been renamed or taken down. Everything we sell is on the shop page.</p>
          <p>
            <Link href={`/s/${shop.slug}`} className={s.link}>
              See all products
            </Link>
          </p>
        </div>
      </ShopFrame>
    );
  }

  // Delivery dates count from today on the store's clock.
  await connection();
  const quotes = deliveryQuotes(
    shop.policy.handlingDays,
    product.variants.map((v) => v.leadTimeDays),
    storeNow(),
  );
  const v = typeof query.v === "string" ? query.v : undefined;

  return (
    <ShopFrame shop={shop} rates={rates}>
      <nav aria-label="Breadcrumb" className={p.crumbs}>
        <ol>
          <li>
            <Link href={`/s/${shop.slug}`}>{shop.name}</Link>
          </li>
          <li>
            <Link href={`/s/${shop.slug}#products`}>All products</Link>
          </li>
          <li aria-current="page">{product.name}</li>
        </ol>
      </nav>
      <ProductDetail
        key={product.parentId}
        shop={shop.slug}
        product={product}
        initialVariantId={v}
        quotes={quotes}
        freeFromCents={FREE_STANDARD_FROM_CENTS}
        shipsFrom={shop.policy.shipsFrom}
        handlingDays={shop.policy.handlingDays}
      >
        <section className={p.section} aria-labelledby="product-description">
          <h2 id="product-description" className={p.sectionTitle}>
            Description
          </h2>
          <p className={p.description}>{product.description}</p>
          <ul className={p.details}>
            <li>Returns accepted within {shop.policy.returnsDays} days of delivery</li>
            <li>Paid through PayPal, which holds the payment until your order ships</li>
          </ul>
        </section>
      </ProductDetail>
    </ShopFrame>
  );
}
