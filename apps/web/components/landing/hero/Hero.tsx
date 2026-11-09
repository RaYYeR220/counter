import Link from "next/link";
import { LINKS, TEST_COUNTS } from "@/lib/site";
import { hero } from "../data";
import l from "../landing.module.css";
import { HeroStage } from "./HeroStage";
import s from "./hero.module.css";

export function Hero() {
  return (
    <HeroStage data={hero}>
      <div className={s.copy}>
        <h1 id="hero-title" className={s.h1}>
          <span>Agents shop here now.</span> <span>Every answer is exact.</span>
        </h1>
        <p className={s.sub}>
          Counter puts any small PayPal shop on PayPal&rsquo;s Store Sync Cart API, so an AI agent can ask for one exact variant and get a straight
          answer. PayPal holds the payment until the shop ships.
        </p>
        <div className={`${l.ctas} ${s.ctas}`}>
          <Link className={`${l.btn} ${l.primary}`} href={LINKS.playground}>
            Try the playground
          </Link>
          <a className={`${l.btn} ${l.ghost}`} href="#agents">
            Connect an agent
          </a>
        </div>
        <p className={s.proof}>
          <Link href={LINKS.liveVerification}>
            <i className={s.live} aria-hidden />
            Live on PayPal sandbox
          </Link>
          <span>Store Sync Cart API</span>
          <span>{TEST_COUNTS.total} tests</span>
        </p>
      </div>
    </HeroStage>
  );
}
