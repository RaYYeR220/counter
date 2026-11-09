import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CartView } from "@/components/storefront/CartView";
import { LoadingShell, ShopFrame } from "@/components/storefront/ShopFrame";
import { getShopSummary, shippingRates } from "@/lib/storefront/catalog";

type Props = PageProps<"/s/[shop]/cart">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { shop } = await params;
  const summary = await getShopSummary(shop);
  return { title: summary ? `Your cart | ${summary.name}` : "Cart", robots: { index: false } };
}

export default function CartPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<LoadingShell label="Loading your cart" />}>
      <Cart params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Cart({ params, searchParams }: Props) {
  const [{ shop: slug }, query] = await Promise.all([params, searchParams]);
  const shop = await getShopSummary(slug);
  if (!shop) notFound();
  const notice = typeof query.checkout === "string" ? query.checkout : null;
  return (
    <ShopFrame shop={shop} rates={shippingRates()}>
      <CartView shop={shop.slug} shopName={shop.name} notice={notice} />
    </ShopFrame>
  );
}
