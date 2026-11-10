// Rule-based extraction of a contract's terms from its text (the fallback of the AI skill `contract.extract` and its
// cross-check; tests: tests/supplier-logic.test.ts): Jalali or Gregorian start and end dates, the duration, the
// contract amount (Rials, or Tomans × 10), the notice period, automatic renewal, the payment schedule, service-level
// commitments and obligations («متعهد است»، «موظف است»…). Every value carries the sentence it came from and its page,
// so a person reviews it before anything is saved.
import { fromJalali, isValidJalali } from "../jalali";
import { normalizeDigits } from "../money";
import { addJalaliMonths } from "./logic";

export interface ExtractedField {
  field: "start_date" | "end_date" | "value" | "notice_period_days" | "renewal_type" | "payment_frequency" | "uc_targets";
  value: string | number;
  evidence: string;
  page: number | null;
}

export interface ExtractedObligation {
  title: string;
  party: "supplier" | "us";
  due_hint: string | null;
  evidence: string;
  page: number | null;
}

export interface Extraction {
  fields: ExtractedField[];
  obligations: ExtractedObligation[];
}

const SUPPLIER_WORDS = /(پیمانکار|فروشنده|تأمین[‌ ]?کننده|طرف دوم|مجری|ارائه[‌ ]?دهنده)/;
const US_WORDS = /(کارفرما|خریدار|طرف اول|سازمان)/;

/** Normalise digits, Arabic letters and spacing so the patterns read every typing of Persian. */
export function normalizeContractText(s: string): string {
  return normalizeDigits(s).replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[٬،]/g, (c) => (c === "٬" ? "," : "،")).replace(/[ \t]+/g, " ");
}

/** A date written as 1405/01/15 (Jalali) or 2026-03-21 (Gregorian) → ISO, or null. */
export function parseContractDate(s: string): string | null {
  const g = /(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (g) {
    const [y, m, d] = [Number(g[1]), Number(g[2]), Number(g[3])];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const j = /(1[34]\d{2})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(s);
  if (j) {
    const [y, m, d] = [Number(j[1]), Number(j[2]), Number(j[3])];
    if (isValidJalali(y, m, d)) return fromJalali(y, m, d);
  }
  return null;
}

const sentences = (text: string): string[] => text.split(/(?<=[.؛!?\n])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 3);

/** Extract a contract's terms from its pages. */
export function extractContract(pages: { page: number; text: string }[]): Extraction {
  const fields: ExtractedField[] = [];
  const obligations: ExtractedObligation[] = [];
  const has = (f: ExtractedField["field"]) => fields.some((x) => x.field === f);
  for (const p of pages) {
    const text = normalizeContractText(p.text ?? "");
    for (const s of sentences(text)) {
      const evidence = s.slice(0, 300);
      if (!has("start_date") && /(از تاریخ|تاریخ شروع|شروع قرارداد|commence|start date|effective)/i.test(s)) {
        const d = parseContractDate(s.replace(/.*?(از تاریخ|تاریخ شروع|شروع قرارداد|commence|start date|effective)/i, ""));
        if (d) fields.push({ field: "start_date", value: d, evidence, page: p.page });
      }
      if (!has("end_date") && /(تا تاریخ|تاریخ پایان|پایان قرارداد|انقضا|expir|end date|terminat)/i.test(s)) {
        const d = parseContractDate(s.replace(/.*?(تا تاریخ|تاریخ پایان|پایان قرارداد|انقضا|expir|end date|terminat)/i, ""));
        if (d) fields.push({ field: "end_date", value: d, evidence, page: p.page });
      }
      if (!has("end_date") && has("start_date")) {
        const dur = /(?:به مدت|مدت قرارداد|for a (?:term|period) of)\s*:?\s*(\d{1,3})\s*(ماه|سال|month|year)/i.exec(s);
        if (dur) {
          const start = String(fields.find((f) => f.field === "start_date")!.value);
          const months = Number(dur[1]) * (/سال|year/i.test(dur[2]) ? 12 : 1);
          const end = addJalaliMonths(start, months);
          fields.push({ field: "end_date", value: new Date(Date.parse(end) - 86400_000).toISOString().slice(0, 10), evidence, page: p.page });
        }
      }
      if (!has("value") && /(مبلغ|ارزش|بهای کل|total|amount|price)/i.test(s)) {
        const m = /(\d{1,3}(?:[,]\d{3})+|\d{5,})\s*(ریال|تومان|rial|toman|irr)/i.exec(s);
        if (m) {
          const n = Number(m[1].replace(/,/g, ""));
          if (Number.isFinite(n) && n > 0) fields.push({ field: "value", value: String(/تومان|toman/i.test(m[2]) ? n * 10 : n), evidence, page: p.page });
        }
      }
      if (!has("notice_period_days")) {
        const m = /(\d{1,3})\s*(روز|ماه|day|month)s?\s*(پیش|قبل|before|prior)/i.exec(s);
        if (m && /(اعلام|اطلاع|کتبی|notice|notif)/i.test(s)) fields.push({ field: "notice_period_days", value: Number(m[1]) * (/ماه|month/i.test(m[2]) ? 30 : 1), evidence, page: p.page });
      }
      if (!has("renewal_type") && /(تمدید خودکار|خودبه[‌ ]?خود تمدید|خود به خود تمدید|automatically renew|auto[- ]?renew)/i.test(s)) fields.push({ field: "renewal_type", value: "auto", evidence, page: p.page });
      if (!has("payment_frequency")) {
        const freq = /(ماهانه|monthly)/i.test(s) ? "monthly" : /(فصلی|سه[‌ ]?ماهه|quarterly)/i.test(s) ? "quarterly" : /(سالانه|annually|yearly)/i.test(s) ? "annual" : /(یک[‌ ]?جا|lump sum)/i.test(s) ? "one_off" : null;
        if (freq && /(پرداخت|payment|invoice|صورت[‌ ]?حساب)/i.test(s)) fields.push({ field: "payment_frequency", value: freq, evidence, page: p.page });
      }
      if (/(زمان پاسخ|زمان پاسخگویی|زمان رفع|response time|resolution time|دسترس[‌ ]?پذیری|availability)/i.test(s) && /\d/.test(s)) {
        const prev = fields.find((f) => f.field === "uc_targets");
        if (prev) prev.value = `${prev.value}\n- ${evidence}`;
        else fields.push({ field: "uc_targets", value: `- ${evidence}`, evidence, page: p.page });
      }
      if (/(متعهد است|متعهد می[‌ ]?شود|موظف است|موظف می[‌ ]?باشد|shall |must )/i.test(s) && obligations.length < 25) {
        const party = SUPPLIER_WORDS.test(s) ? "supplier" : US_WORDS.test(s) ? "us" : "supplier";
        const due = /(ماهانه|فصلی|سالانه|هر\s*\d+\s*(روز|ماه)|ظرف\s*\d+\s*(روز|ساعت)|monthly|quarterly|annually|within \d+ days)/i.exec(s);
        obligations.push({ title: s.replace(/\s+/g, " ").slice(0, 200), party, due_hint: due ? due[0] : null, evidence, page: p.page });
      }
    }
  }
  return { fields, obligations };
}
