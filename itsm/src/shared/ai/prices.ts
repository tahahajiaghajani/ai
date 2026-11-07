// Dated price table (USD per million tokens) used to estimate what each AI call cost a business.
// Estimates only: providers bill by their own counters; gateways bill in rial at their own rate.
// Prices of 2 Nov 2026 (provider pages, OpenRouter catalogue); dated rows cover announced changes.
import { D } from "../money";

export const PRICES_AS_OF = "2026-11-02";

export interface AiPrice {
  /** uncached input */
  in: string;
  out: string;
  cache_read: string;
  cache_write: string;
  /** a whole request whose prompt is above `above` tokens is billed at these prices */
  long?: { above: number; in: string; out: string; cache_read: string; cache_write: string };
}

interface PriceRow {
  match: RegExp;
  /** first day the price applies (inclusive, YYYY-MM-DD) */
  from?: string;
  /** last day the price applies (inclusive) */
  to?: string;
  price: AiPrice;
}

const p = (input: number, output: number, cacheRead: number, cacheWrite: number, long?: AiPrice["long"]): AiPrice => ({
  in: String(input),
  out: String(output),
  cache_read: String(cacheRead),
  cache_write: String(cacheWrite),
  ...(long ? { long } : {}),
});

const ROWS: PriceRow[] = [
  // Anthropic (cache reads 5% on the 5.5 models, 2.5% on Fable 5.1; 5-minute cache writes ×1.25)
  { match: /^claude-fable-5-1/, price: p(10, 50, 0.25, 12.5) },
  { match: /^claude-opus-5-5/, price: p(4, 20, 0.2, 5) },
  { match: /^claude-sonnet-5-5/, price: p(2, 10, 0.1, 2.5) },
  { match: /^claude-haiku-5-5/, price: p(0.1, 0.5, 0.01, 0.125, { above: 100_000, in: "0.5", out: "2.5", cache_read: "0.05", cache_write: "0.625" }) },
  { match: /^claude-opus-5(?!-\d)/, price: p(5, 25, 0.5, 6.25) },
  { match: /^claude-opus-4/, price: p(5, 25, 0.5, 6.25) },
  { match: /^claude-sonnet-(5|4)/, price: p(3, 15, 0.3, 3.75) },
  { match: /^claude-haiku-4/, price: p(1, 5, 0.1, 1.25) },
  // OpenAI (requests above 272K input tokens: input ×2, output ×1.5)
  { match: /^gpt-6-astra/, price: p(10, 50, 1, 12.5, { above: 272_000, in: "20", out: "75", cache_read: "2", cache_write: "25" }) },
  { match: /^gpt-6(\.1)?-sol/, price: p(2, 10, 0.1, 2.5, { above: 272_000, in: "4", out: "15", cache_read: "0.2", cache_write: "5" }) },
  { match: /^gpt-6(\.1)?-terra/, price: p(1, 5, 0.05, 1.25, { above: 272_000, in: "2", out: "7.5", cache_read: "0.1", cache_write: "2.5" }) },
  { match: /^gpt-6(\.1)?-luna/, price: p(0.1, 0.5, 0.01, 0.125, { above: 272_000, in: "0.2", out: "0.75", cache_read: "0.02", cache_write: "0.25" }) },
  // Google (implicit caching; Gemini 4 Argon doubles on 1 Dec 2026, 3.8/3.6 Flash on 1 Jan 2027)
  { match: /^gemini-4-argon/, to: "2026-11-30", price: p(2, 10, 0.2, 2) },
  { match: /^gemini-4-argon/, from: "2026-12-01", price: p(4, 20, 0.4, 4) },
  { match: /^gemini-3\.(8|6)-flash(?!-lite)/, to: "2026-12-31", price: p(0.75, 3.75, 0.075, 0.75) },
  { match: /^gemini-3\.(8|6)-flash(?!-lite)/, from: "2027-01-01", price: p(1.5, 7.5, 0.15, 1.5) },
  { match: /^gemini-3\.5-flash-lite/, price: p(0.3, 2.5, 0.03, 0.3) },
  { match: /^gemini-3\.1-flash-lite/, price: p(0.25, 1.5, 0.025, 0.25) },
  { match: /^gemini-3\.1-pro/, price: p(2, 12, 0.2, 2, { above: 200_000, in: "4", out: "18", cache_read: "0.4", cache_write: "4" }) },
  // xAI (prompts of 200K tokens and more cost double)
  { match: /^grok-4\.(7|6)/, price: p(2, 6, 0.5, 2, { above: 200_000, in: "4", out: "12", cache_read: "1", cache_write: "4" }) },
  { match: /^grok-4\.5/, price: p(2, 6, 0.3, 2) },
  { match: /^grok-4\.(3|20)/, price: p(1.25, 2.5, 0.2, 1.25) },
  // DeepSeek (peak-hour prices; off-peak is half)
  { match: /^deepseek-(v4\.1-)?flash/, price: p(0.3, 1.2, 0.006, 0.3) },
  { match: /^deepseek-v4-pro/, price: p(1.32, 3.96, 0.044, 1.32) },
  // Qwen, Kimi, Mistral (indicative)
  { match: /^qwen3\.8-max/, price: p(2, 6, 0.2, 2) },
  { match: /^qwen3\.7-plus/, price: p(0.32, 1.28, 0.032, 0.32) },
  { match: /^qwen3\.8-flash/, price: p(0.15, 0.47, 0.015, 0.15) },
  { match: /^kimi-k3/, price: p(2, 10, 0.2, 2) },
  { match: /^mistral-large/, price: p(0.7, 2.1, 0.07, 0.7) },
  { match: /^mistral-small/, price: p(0.15, 0.6, 0.015, 0.15) },
  { match: /^gpt-oss-120b/, price: p(0.15, 0.6, 0.015, 0.15) },
  { match: /^gpt-oss-20b/, price: p(0.075, 0.3, 0.0075, 0.075) },
  // the test-only responder (SIRAF_AI_FAKE=1): nominal prices so usage pages have something to show
  { match: /^fake-/, price: p(1, 5, 0.1, 1.25) },
];

/** Strip a router's vendor prefix and normalise Claude ids written with dots (OpenRouter style). */
export function normalizeModelId(model: string): string {
  let m = String(model ?? "").trim().toLowerCase();
  const slash = m.lastIndexOf("/");
  if (slash >= 0) m = m.slice(slash + 1);
  m = m.replace(/:(free|beta|thinking)$/, "");
  if (m.startsWith("claude-")) m = m.replace(/(\d)\.(\d)/g, "$1-$2");
  return m;
}

export function priceOf(model: string, day: string): AiPrice | null {
  const id = normalizeModelId(model);
  for (const r of ROWS) {
    if (!r.match.test(id)) continue;
    if (r.from && day < r.from) continue;
    if (r.to && day > r.to) continue;
    return r.price;
  }
  return null;
}

export interface UsageTokens {
  /** uncached input tokens */
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

/**
 * Estimated cost in USD (decimal string, 6 places). `priced` is false when the model is not in the
 * table: the call is counted as 0 and the usage page says so. Local models cost nothing.
 */
export function estimateCostUsd(model: string, u: UsageTokens, opts: { day: string; local?: boolean }): { usd: string; priced: boolean } {
  if (opts.local) return { usd: "0", priced: true };
  const price = priceOf(model, opts.day);
  if (!price) return { usd: "0", priced: false };
  const prompt = u.input + u.cache_read + u.cache_write;
  const pr = price.long && prompt > price.long.above ? price.long : price;
  const total = D(u.input).mul(pr.in).plus(D(u.output).mul(pr.out)).plus(D(u.cache_read).mul(pr.cache_read)).plus(D(u.cache_write).mul(pr.cache_write));
  return { usd: total.div(1_000_000).toDecimalPlaces(6).toFixed(), priced: true };
}
