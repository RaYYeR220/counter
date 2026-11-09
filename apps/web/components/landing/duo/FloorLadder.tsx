import { floorExample } from "../data";
import s from "./duo.module.css";

/** One variant's price ladder: list, the best single-item price, and the floor nothing is ever sold under. */
export function FloorLadder() {
  const f = floorExample;
  const list = Number(f.list),
    floor = Number(f.floor),
    single = Number(f.singleBest);
  const lo = floor - 1.5,
    hi = list + 1;
  const x = (p: number) => Math.round(((p - lo) / (hi - lo)) * 440 * 10) / 10;
  const [xf, xs, xl] = [x(floor), x(single), x(list)];
  const bundleReachesFloor = list * (1 - f.capPct / 100) <= floor;
  const bundleLabel = bundleReachesFloor ? `${f.bundleMin} or more: down to the floor, never below` : `${f.bundleMin} or more: up to ${f.capPct}% off`;
  return (
    <div
      className={s.ladder}
      role="img"
      aria-label={`${f.name}: list price $${f.list}, floor $${f.floor}. A cart of 1 to ${f.bundleMin - 1} can go down to $${f.singleBest}, ${f.smallCartPct}% off. ${bundleLabel}.`}
    >
      <svg viewBox="0 0 440 74" aria-hidden>
        <defs>
          <pattern id="floor-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="5" stroke="rgba(26,25,21,.24)" strokeWidth="1" />
          </pattern>
        </defs>
        <line x1={xs} y1="10" x2={xl} y2="10" stroke="var(--cx-ink)" strokeWidth="1.3" />
        <line x1={xs} y1="5" x2={xs} y2="15" stroke="var(--cx-ink)" strokeWidth="1.3" />
        <line x1={xf} y1="27" x2={xl} y2="27" stroke="var(--cx-ring)" strokeWidth="1.3" />
        <line x1={xf} y1="22" x2={xf} y2="32" stroke="var(--cx-ring)" strokeWidth="1.3" />
        <rect x="0" y="41" width={xf} height="7" fill="url(#floor-hatch)" />
        <line x1="0" y1="48" x2="440" y2="48" stroke="rgba(26,25,21,.32)" />
        <line x1={xf} y1="40" x2={xf} y2="54" stroke="var(--cx-ink)" strokeWidth="1.3" />
        <line x1={xl} y1="5" x2={xl} y2="54" stroke="var(--cx-ink)" strokeWidth="1.3" />
        <line x1={xs} y1="44" x2={xs} y2="52" stroke="rgba(26,25,21,.5)" />
        <text x={xf} y="70" textAnchor="middle" className={s.v}>
          ${f.floor} floor
        </text>
        <text x={xs} y="70" textAnchor="middle">
          ${f.singleBest}
        </text>
        <text x={xl} y="70" textAnchor="middle" className={s.v}>
          ${f.list} list
        </text>
        <text x={xf / 2} y="37" textAnchor="middle" className={s.h}>
          never
        </text>
      </svg>
      <div className={s.key}>
        <span>
          <i />1–{f.bundleMin - 1} in the cart: up to {f.smallCartPct}% off
        </span>
        <span>
          <i data-ring="true" />
          {bundleLabel}
        </span>
      </div>
    </div>
  );
}
