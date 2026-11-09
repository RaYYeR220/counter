import "@/lib/app-theme/tokens.css";
import { Closing, Footer } from "./Closing";
import { AgentsAndShops } from "./duo/AgentsAndShops";
import { Hero } from "./hero/Hero";
import { HowItWorks } from "./how/HowItWorks";
import l from "./landing.module.css";
import { Nav } from "./Nav";
import { Numbers } from "./numbers/Numbers";
import { PayPalUnderneath } from "./paypal/PayPalUnderneath";

/** Counter's landing page. Light only: the dot cluster's glazes are drawn for the warm ground. */
export function LandingPage() {
  return (
    <div className={`app-theme ${l.page}`} data-theme="light">
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <AgentsAndShops />
        <Numbers />
        <PayPalUnderneath />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}
