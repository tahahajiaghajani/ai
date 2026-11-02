// Small presentation pieces of the «طلا» module: the gold price strip (the one amber surface in the product), the
// karat avatar, the karat selector and the karat text/tag. Gold materials stay inside this module (components.md §4.7).
import { Coins, Recycle } from "lucide-react";
import { D, type Num } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { Ic } from "../../components/shell/icons";
import { jTime } from "../../lib/fa";
import { coinTitle, RateChange, type Coin, type Rate } from "./shared";

/** Fineness in thousandths → karat (750 → 18, 875 → 21, 999.9 → 24); null when it is not a whole karat. */
export function karatOf(fineness: Num | null | undefined): number | null {
  if (fineness === null || fineness === undefined || fineness === "") return null;
  const k = D(fineness).times(24).div(1000);
  const r = k.toDecimalPlaces(0);
  return k.minus(r).abs().lt(0.05) ? r.toNumber() : null;
}

/** The business's default karat (۱۸) is plain text-3; only exceptions (۱۷، ۲۱، ۲۴، سکه) wear the gold tag. */
export function KaratText({ fineness, coin }: { fineness: Num | null | undefined; coin?: boolean }) {
  if (coin) return <span className="sf-karat">سکه</span>;
  const k = karatOf(fineness);
  if (k === 18) return <span className="sf-karat-plain">۱۸ عیار</span>;
  if (k !== null) return <span className="sf-karat">{faDigits(k)} عیار</span>;
  return <span className="sf-karat">{faDigits(D(fineness ?? 0).toString())}</span>;
}

/** 36 px gold avatar with the karat figure; coins are round with a coin glyph, used gold is a neutral tile. */
export function KaratAvatar({ kind, fineness, small }: { kind?: string; fineness?: Num | null; small?: boolean }) {
  if (kind === "old") return <span className={`sf-gold-av is-old ${small ? "is-sm" : ""}`} aria-hidden><Ic icon={Recycle} /></span>;
  if (kind === "coin") return <span className={`sf-gold-av is-coin ${small ? "is-sm" : ""}`} aria-hidden><Ic icon={Coins} /></span>;
  const k = karatOf(fineness ?? 750);
  return <span className={`sf-gold-av ${small ? "is-sm" : ""}`} aria-hidden>{k !== null ? faDigits(k) : faDigits(D(fineness ?? 0).toDecimalPlaces(0).toString())}</span>;
}

const KARATS: [string, string][] = [["705", "۱۷"], ["750", "۱۸"], ["875", "۲۱"], ["999.9", "۲۴"]];

/** Karat selector: a segmented row; the selected karat is gold tint + gold text + a gold-line ring. */
export function KaratSeg({ value, onChange, disabled, small, options = KARATS }: { value: Num | null | undefined; onChange: (v: string) => void; disabled?: boolean; small?: boolean; options?: [string, string][] }) {
  const k = karatOf(value);
  return (
    <div className={`sf-kseg ${small ? "is-sm" : ""}`} role="group" aria-label="عیار">
      {options.map(([f, label]) => {
        const on = k !== null && karatOf(f) === k;
        return (
          <button key={f} type="button" aria-pressed={on} disabled={disabled} onClick={() => onChange(f)} title={`${label} عیار (${faDigits(f)})`}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The gold price strip: today's board — the 18k gram with its delta chip, the mazaneh, the used-gold buy price, the
 * coins and the world ounce (Latin digits, a Latin currency symbol) — and the time of the rate with the live nuqta.
 */
export function GoldStrip({ rate, change, changePct, coins }: { rate: Rate | null | undefined; change?: string | null; changePct?: string | null; coins?: Coin[] }) {
  if (!rate) {
    return (
      <div className="sf-gstrip" role="group" aria-label="قیمت روز">
        <span className="gi"><span className="gk">قیمت روز</span><span>هنوز قیمتی در تابلو ثبت نشده است.</span></span>
      </div>
    );
  }
  const priced = (coins ?? []).filter((c) => c.price).slice(0, 2);
  const short = (name: string) => name.replace(/\s*\(.*?\)\s*/g, " ").trim();
  const at = new Date(rate.at);
  const fresh = Date.now() - at.getTime() < 6 * 3600_000;
  return (
    <div className="sf-gstrip" role="group" aria-label="قیمت روز">
      {rate.gram18 ? (
        <span className="gi">
          <span className="sf-gold-av is-sm" aria-hidden>۱۸</span>
          <span className="gk">طلای ۱۸ عیار</span>
          <span className="gv">{formatNumber(rate.gram18)}</span>
          <RateChange change={change} pct={changePct} />
        </span>
      ) : null}
      {rate.mazaneh ? <span className="gi"><span className="gk">مظنه</span><span className="gv">{formatNumber(rate.mazaneh)}</span></span> : null}
            {priced.length
        ? priced.map((c) => (
            <span key={c.id} className="gi"><span className="gk">{short(c.name)}</span><span className="gv">{formatNumber(c.price!)}</span></span>
          ))
        : (["emami", "nim"] as const).filter((k) => rate.coins?.[k]).map((k) => (
            <span key={k} className="gi"><span className="gk">{k === "emami" ? "سکه‌ی امامی" : coinTitle(k)}</span><span className="gv">{formatNumber(rate.coins[k])}</span></span>
          ))}
      {rate.ounce_usd ? <span className="gi"><span className="gk">انس جهانی</span><span className="usd">${formatNumber(rate.ounce_usd, { dp: 2, minDp: 2, fa: false })}</span></span> : null}
      <span className="live" title={rate.source === "manual" ? "قیمت دستی" : "قیمت زنده"}>
        <i className="sf-nuqta" data-live={fresh ? "" : undefined} aria-hidden />
        <span className="sf-num">{jTime(at)}</span>
      </span>
    </div>
  );
}
