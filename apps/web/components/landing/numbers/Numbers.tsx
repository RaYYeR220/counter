import { negotiation, purchase } from "../data";
import l from "../landing.module.css";
import { NegotiationField } from "./NegotiationField";
import { PurchaseBench } from "./PurchaseBench";
import s from "./numbers.module.css";

const WORDS = ["no", "one", "two", "three", "four", "five", "six"];
const word = (n: number) => WORDS[n] ?? String(n);
const count = (n: number, one: string, many: string) => `${word(n)} ${n === 1 ? one : many}`;

export function Numbers() {
  const n = negotiation;
  const stopped = n.runs.filter((r) => r.stopped).length;
  const initial = Math.max(
    0,
    n.runs.findIndex((r) => r.scenario === n.featured.scenario && n.models[r.model] === n.featured.model),
  );
  const categories = n.categories.map((c) => ({ polite: "polite", lowball: "lowball", injection: "prompt injection", bundle: "bundle" })[c] ?? c);
  return (
    <section className={`${l.section} ${s.section}`} id="numbers" aria-labelledby="numbers-title">
      <div className={l.wrap}>
        <div className={`${l.sectionHead} ${l.sectionHeadOne}`}>
          <h2 id="numbers-title" className={l.h2}>
            On a clean store, a frontier browser agent is accurate too. It takes about {purchase.callsRatio}× the calls and {purchase.costRatio}× the cost.
          </h2>
          <p className={l.lede}>
            Same model, same prompt, the same {purchase.tasks} registered shopping tasks. One arm drives our own clean, accessible storefront with a
            Playwright browser; the other uses Counter&rsquo;s tools. Payment is stubbed in both.
          </p>
        </div>

        <PurchaseBench models={purchase.models} runsTotal={purchase.runs} temperature={purchase.temperature} />
        <p className={s.note}>
          Counter&rsquo;s advantage here is effort, not accuracy. The storefront is the best case for a browser agent; this says nothing about messier real
          sites. The Counter arm was run twice: the first run found two bugs in Counter&rsquo;s own tools, which were fixed, and that first run is kept in the
          results.
        </p>

        <div className={s.neg}>
          <div className={s.zero}>
            <b>{n.belowFloor}</b>
            <div>
              <h3>sales below a merchant&rsquo;s floor in {n.runs.length} negotiation runs.</h3>
              <p>
                {n.scenarios} registered scenarios, {categories.slice(0, -1).join(", ")} and {categories.at(-1)}, played against {word(n.models.length)}{" "}
                seller models.
              </p>
            </div>
          </div>
          <div className={s.stats}>
            <div>
              <b>{n.ruleViolations}</b>rule violations
            </div>
            <div>
              <b>{n.replyMismatches}</b>replies that disagree with the deal
            </div>
            <div>
              <b>${n.spendUsd}</b>model spend for all {n.runs.length} runs
            </div>
          </div>
          <NegotiationField runs={n.runs} models={n.models} categories={n.categories} initial={initial} />
        </div>
        <p className={s.negNote}>
          Without the engine, the seller&rsquo;s first proposal broke a rule in {count(n.controlRuleViolations, "run", "runs")}. With it, the engine clamped
          the {count(stopped, "proposal", "proposals")} that would have broken one, ringed above. The benchmark is single-turn; multi-turn pressure is not
          tested.
        </p>
      </div>
    </section>
  );
}
