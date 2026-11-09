// «پرسش از داده‌ها» without a model (catalogue ANA-023's rule-based floor): a Persian question → a report definition
// over the tables the asker may read, plus the interpretation as chips the person can correct. It recognises the
// table («رخدادها»، «تغییرهای اضطراری»…), the measure («تعداد»، «میانگین زمان حل»، «MTTR»…), the breakdown («به
// تفکیک اولویت»، «ماهانه»، «روز هفته»…), the time («ماه گذشته»، «۳۰ روز اخیر»، «سه ماه اول ۱۴۰۵»، «بهار ۱۴۰۵»،
// «فروردین ۱۴۰۵»…), option filters («بحرانی»، «باز»، «حل‌شده»، «به من»…), a top N and the chart («نمودار خطی»).
// The AI layer replaces it through `registerAnalyticsAi`; whatever produced the definition, it runs with the asker's
// access like every report. Pure.
import type { Cond } from "../model/conditions";
import { normalizeSearch } from "../model/conditions";
import type { FieldDef, Option, TableDef } from "../model/types";
import { addDays, fromJalali, JALALI_MONTHS } from "../jalali";
import { addUnits, type DateUnit, type RelativeWindow } from "../model/jalali-buckets";
import { QUARTERS } from "../model/jalali-buckets";
import { suggestViz, VIZ } from "./model";
import { faDigits } from "../format";
import type { Dimension, Measure, ReportSpec, VizType } from "./types";

export interface NlTable {
  def: TableDef;
  /** options of a choice field (the organisation's list) */
  options: (f: FieldDef) => Option[];
}

export interface NlChip {
  kind: "table" | "measure" | "dim" | "time" | "filter" | "viz" | "limit";
  label: string;
}

export interface NlResult {
  spec: ReportSpec | null;
  chips: NlChip[];
  /** what was not understood (Persian), when nothing could be built */
  problem: string | null;
}

const norm = (s: string) =>
  normalizeSearch(s)
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[ـ]/g, "")
    .replace(/[؟?!،,.:؛;«»"()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const has = (q: string, ...words: string[]) => words.some((w) => q.includes(norm(w)));

/** Words people use for tables (beyond their labels). */
const TABLE_WORDS: Record<string, string[]> = {
  incident: ["رخداد", "حادثه", "تیکت", "خرابی", "incident"],
  change_request: ["تغییر", "change", "rfc"],
  request_item: ["قلم درخواست", "درخواست خدمت", "درخواست"],
  request: ["سفارش"],
  problem: ["مشکل", "problem"],
  kb_article: ["مقاله", "دانش"],
  ci: ["پیکربندی", "ci", "دارایی"],
  task_sla: ["sla", "توافق سطح خدمت", "زمان سنج"],
  known_error: ["خطای شناخته"],
};

const VIZ_WORDS: [string[], VizType][] = [
  [["نقشه حرارتی", "حرارتی", "heatmap"], "heatmap"],
  [["ستونی"], "column"],
  [["میله ای", "میله‌ای", "افقی"], "bar"],
  [["خطی", "روند"], "line"],
  [["ناحیه ای", "ناحیه‌ای"], "area"],
  [["دایره ای", "دایره‌ای", "نمودار دایره"], "pie"],
  [["حلقه ای", "حلقه‌ای", "دونات"], "donut"],
  [["قیف"], "funnel"],
  [["پارتو"], "pareto"],
  [["جدول متقاطع", "پیوت"], "pivot"],
  [["جدول"], "table"],
  [["فهرست", "لیست", "کدام"], "list"],
  [["عقربه"], "gauge"],
];

const UNIT_WORDS: [string[], DateUnit][] = [
  [["روز"], "day"],
  [["هفته"], "week"],
  [["ماه"], "month"],
  [["فصل"], "quarter"],
  [["سال"], "year"],
];

const NUM_WORDS: Record<string, number> = { یک: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, هفت: 7, هشت: 8, نه: 9, ده: 10, دوازده: 12, پانزده: 15, بیست: 20, سی: 30, نود: 90 };

const numberIn = (s: string): number | null => {
  const m = /(\d{1,4})/.exec(s);
  if (m) return Number(m[1]);
  for (const [w, n] of Object.entries(NUM_WORDS)) if (new RegExp(`(^|\\s)${w}(\\s|$)`).test(s)) return n;
  return null;
};

/** The table a question is about (longest matching word wins), among the readable ones. */
function findTable(q: string, tables: NlTable[]): NlTable | null {
  let best: { t: NlTable; len: number } | null = null;
  for (const t of tables) {
    const words = [t.def.label, t.def.plural, ...(TABLE_WORDS[t.def.key] ?? [])].map(norm).filter((w) => w.length >= 2);
    for (const w of words) if (q.includes(w) && (!best || w.length > best.len)) best = { t, len: w.length };
  }
  return best?.t ?? null;
}

/** Everyday words for common fields («گروه» is the assignment group, «کارشناس» the assignee…). */
const FIELD_WORDS: Record<string, string[]> = {
  assignment_group_id: ["گروه", "تیم"],
  assigned_to: ["کارشناس", "مسئول"],
  category: ["دسته", "دسته بندی", "دسته‌بندی"],
  subcategory: ["زیردسته"],
  priority: ["اولویت"],
  state: ["وضعیت", "مرحله"],
  channel: ["کانال", "راه ثبت"],
  service_id: ["خدمت", "سرویس"],
  ci_id: ["پیکربندی"],
  caller_id: ["درخواست دهنده", "درخواست‌دهنده", "تماس گیرنده"],
  location_id: ["مکان"],
  type: ["نوع"],
  risk: ["ریسک"],
  close_code: ["نتیجه", "کد بستن"],
};

const fieldWords = (f: FieldDef) => [f.label, f.name.replace(/_/g, " "), ...(FIELD_WORDS[f.name] ?? [])].map(norm).filter((w) => w.length >= 2);

/** The field a word sequence starts with: a whole label, a known everyday word, or the label's first word. */
function fieldAt(rest: string, def: TableDef, accept: (f: FieldDef) => boolean): FieldDef | null {
  let best: { f: FieldDef; len: number } | null = null;
  const starts = (w: string) => rest.startsWith(w) && (rest.length === w.length || /[\sهای]/.test(rest[w.length]));
  for (const f of def.fields) {
    if (!accept(f) || f.hidden) continue;
    for (const w of fieldWords(f)) if (starts(w) && (!best || w.length > best.len)) best = { f, len: w.length };
  }
  if (best) return best.f;
  // the label's first word («گروه» for «گروه پشتیبانی»), when only one field has it
  const first = rest.split(" ")[0];
  if (first.length < 3) return null;
  const hits = def.fields.filter((f) => accept(f) && !f.hidden && norm(f.label).split(" ")[0] === first);
  return hits.length === 1 ? hits[0] : null;
}

/** The field named right after a phrase («به تفکیک اولویت»). */
function fieldAfter(q: string, def: TableDef, phrases: string[], accept: (f: FieldDef) => boolean): FieldDef | null {
  for (const p of phrases.map(norm)) {
    const at = q.indexOf(p);
    if (at < 0) continue;
    const f = fieldAt(q.slice(at + p.length).trim(), def, accept);
    if (f) return f;
  }
  return null;
}

const isDate = (f: FieldDef) => f.type === "date" || f.type === "datetime";
const groupable = (f: FieldDef) => !["text", "markdown", "json", "conditions", "secret"].includes(f.type);

/** The date field the time words refer to: «حل‌شده» → resolved_at, «بسته» → closed_at, else when it was opened. */
function timeField(q: string, def: TableDef): FieldDef | null {
  const by = (n: string) => def.fields.find((f) => f.name === n && isDate(f)) ?? null;
  if (has(q, "حل شده", "حل‌شده", "حل شد")) return by("resolved_at") ?? by("closed_at") ?? by("opened_at") ?? by("created_at");
  if (has(q, "بسته شده", "بسته‌شده")) return by("closed_at") ?? by("resolved_at") ?? by("created_at");
  if (has(q, "اجرا شده", "اجراشده")) return by("actual_end") ?? by("created_at");
  if (has(q, "منتشر")) return by("published_at") ?? by("created_at");
  return by("opened_at") ?? by("created_at");
}

/** Time words → a relative window or fixed Jalali dates. */
function findTime(q: string, now: string): { window?: RelativeWindow; from?: string; to?: string; label: string } | null {
  const year = (s: string) => {
    const m = /(1[34]\d\d)/.exec(s);
    return m ? Number(m[1]) : null;
  };
  // «سه ماه اول ۱۴۰۵» / «سه‌ماهه دوم ۱۴۰۴» / «بهار ۱۴۰۵»
  const ordinals = ["اول", "دوم", "سوم", "چهارم"];
  for (const [i, o] of ordinals.entries()) {
    if (has(q, `سه ماه ${o}`, `سه ماهه ${o}`, `فصل ${o}`)) {
      const y = year(q);
      if (y) {
        const from = fromJalali(y, i * 3 + 1, 1);
        return { from, to: addDays(addUnits(from, "quarter", 1), -1), label: `${QUARTERS[i]} ${y}` };
      }
    }
  }
  for (const [i, s] of QUARTERS.entries()) {
    const y = year(q);
    if (y && has(q, `${s} ${y}`)) {
      const from = fromJalali(y, i * 3 + 1, 1);
      return { from, to: addDays(addUnits(from, "quarter", 1), -1), label: `${s} ${y}` };
    }
  }
  for (const [i, m] of JALALI_MONTHS.entries()) {
    if (!q.includes(norm(m))) continue;
    const y = year(q);
    if (y) {
      const from = fromJalali(y, i + 1, 1);
      return { from, to: addDays(addUnits(from, "month", 1), -1), label: `${m} ${y}` };
    }
  }
  const named: [string[], RelativeWindow, string][] = [
    [["امروز"], { unit: "day", from: 0, to: 0 }, "امروز"],
    [["دیروز"], { unit: "day", from: -1, to: -1 }, "دیروز"],
    [["این هفته", "هفته جاری"], { unit: "week", from: 0, to: 0 }, "این هفته"],
    [["هفته گذشته", "هفته پیش", "هفته قبل"], { unit: "week", from: -1, to: -1 }, "هفتهٔ گذشته"],
    [["این ماه", "ماه جاری"], { unit: "month", from: 0, to: 0 }, "این ماه"],
    [["ماه گذشته", "ماه پیش", "ماه قبل"], { unit: "month", from: -1, to: -1 }, "ماه گذشته"],
    [["این فصل"], { unit: "quarter", from: 0, to: 0 }, "این فصل"],
    [["فصل گذشته", "فصل پیش"], { unit: "quarter", from: -1, to: -1 }, "فصل گذشته"],
    [["امسال", "این سال", "سال جاری"], { unit: "year", from: 0, to: 0 }, "امسال"],
    [["پارسال", "سال گذشته", "سال پیش"], { unit: "year", from: -1, to: -1 }, "پارسال"],
  ];
  // «۳۰ روز گذشته»، «سه ماه اخیر»
  const rel = /(\d{1,3}|یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده|دوازده|پانزده|بیست|سی|نود)\s*(روز|هفته|ماه|فصل|سال)\s*(گذشته|اخیر|پیش|قبل)/.exec(q);
  if (rel) {
    const n = numberIn(rel[1]) ?? 1;
    const unit = UNIT_WORDS.find(([w]) => w.includes(rel[2]))?.[1] ?? "day";
    return { window: { unit, from: -(n - 1), to: 0 }, label: `${n} ${rel[2]} اخیر` };
  }
  for (const [words, window, label] of named) if (has(q, ...words)) return { window, label };
  const y = /سال\s*(1[34]\d\d)/.exec(q) ?? /(?:^|\s)(1[34]\d\d)(?:\s|$)/.exec(q);
  if (y) {
    const from = fromJalali(Number(y[1]), 1, 1);
    return { from, to: addDays(addUnits(from, "year", 1), -1), label: `سال ${y[1]}` };
  }
  void now;
  return null;
}

/** Measures: «میانگین زمان حل»، «MTTR»، «میانه …»، «جمع …»، «درصد …»، otherwise «تعداد». */
function findMeasure(q: string, def: TableDef, opts: { filters: Cond[] }): { m: Measure; label: string } {
  const field = (n: string) => def.fields.find((f) => f.name === n) ?? null;
  const fn: Measure["fn"] | null = has(q, "میانگین", "متوسط") ? "avg" : has(q, "میانه") ? "median" : has(q, "جمع", "مجموع") ? "sum" : has(q, "بیشترین", "بیشینه") ? "max" : has(q, "کمترین", "کمینه") ? "min" : null;
  if (has(q, "mttr") || (fn && has(q, "زمان حل", "زمان رفع"))) {
    const f = field("time_to_resolve");
    if (f) return { m: { fn: fn ?? "avg", field: f.name }, label: `${fn === "median" ? "میانهٔ" : "میانگین"} زمان تا حل` };
    if (field("resolved_at") && field("opened_at")) return { m: { fn: fn ?? "avg", field: "resolved_at", from: "opened_at" }, label: "میانگین زمان تا حل" };
  }
  if (has(q, "mtta") || (fn && has(q, "زمان پذیرش", "زمان پاسخ"))) {
    const f = field("time_to_accept");
    if (f) return { m: { fn: fn ?? "avg", field: f.name }, label: "میانگین زمان تا پذیرش" };
  }
  if (fn) {
    const f = fieldAfter(q, def, ["میانگین", "متوسط", "میانه", "جمع", "مجموع", "بیشترین", "کمترین", "بیشینه", "کمینه"], (x) => !!["int", "decimal", "money", "percent", "duration", "rating"].includes(x.type));
    if (f) return { m: { fn, field: f.name }, label: `${fn === "avg" ? "میانگین" : fn === "median" ? "میانه" : fn === "sum" ? "جمع" : fn === "max" ? "بیشینه" : "کمینه"} ${f.label}` };
  }
  if (has(q, "درصد", "نرخ", "سهم") && opts.filters.length) {
    const filter = opts.filters.length === 1 ? opts.filters[0] : { and: opts.filters };
    opts.filters.length = 0;
    return { m: { fn: "ratio", filter }, label: "درصد موارد" };
  }
  return { m: { fn: "count" }, label: "تعداد" };
}

/** Option filters: a choice option's words in the question («بحرانی» → priority 1), «باز»، «به من»، «گروه من». */
function findFilters(q: string, t: NlTable, chips: NlChip[]): Cond[] {
  const out: Cond[] = [];
  const def = t.def;
  const field = (n: string) => def.fields.find((f) => f.name === n) ?? null;
  if (field("active") && /(^|\s)باز(\s|$)/.test(q)) {
    out.push({ f: "active", op: "eq", v: true });
    chips.push({ kind: "filter", label: "فقط باز" });
  } else if (def.states && has(q, "حل شده", "حل‌شده", "بسته شده")) {
    const done = def.states.states.filter((s) => s.category === "resolved" || s.category === "closed").map((s) => s.value);
    if (done.length) {
      out.push({ f: def.states.field, op: "in", v: done });
      chips.push({ kind: "filter", label: "حل‌شده یا بسته" });
    }
  }
  if (field("assigned_to") && (has(q, "به من", "مال من", "واگذار شده به من") || /(^|\s)من(\s|$)/.test(q)) && !has(q, "گروه من", "گروه‌های من", "گروههای من")) {
    out.push({ f: "assigned_to", op: "is_me" });
    chips.push({ kind: "filter", label: "واگذارشده به من" });
  }
  if (field("assignment_group_id") && has(q, "گروه من", "گروه‌های من", "گروههای من")) {
    out.push({ f: "assignment_group_id", op: "is_my_group" });
    chips.push({ kind: "filter", label: "گروه‌های من" });
  }
  const preferred = ["priority", "type", "risk", "category", "channel", "major_state", "close_code", "impact", "urgency"];
  const choiceFields = def.fields.filter((f) => f.type === "choice" && f.filter && !f.hidden && f.name !== def.states?.field).sort((a, b) => {
    const ia = preferred.indexOf(a.name);
    const ib = preferred.indexOf(b.name);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const used = new Set<string>();
  for (const f of choiceFields) {
    if (used.has(f.name)) continue;
    for (const o of t.options(f)) {
      // «۱ — بحرانی» → «بحرانی»
      const core = norm(String(o.label).replace(/^[\d۰-۹]+\s*[—-]\s*/, ""));
      if (core.length < 3) continue;
      const re = new RegExp(`(^|\\s)${core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$|ها|های)`);
      if (re.test(q)) {
        out.push({ f: f.name, op: "eq", v: o.value });
        chips.push({ kind: "filter", label: `${f.label}: ${String(o.label)}` });
        used.add(f.name);
        break;
      }
    }
  }
  return out;
}

/** The question → a definition (null with a reason when no table could be recognised). */
export function parseQuestion(question: string, tables: NlTable[], opts: { now?: string } = {}): NlResult {
  const q = ` ${norm(question)} `;
  const chips: NlChip[] = [];
  if (q.trim().length < 3) return { spec: null, chips, problem: "پرسش کوتاه است" };
  const t = findTable(q, tables);
  if (!t) return { spec: null, chips, problem: "معلوم نشد پرسش دربارهٔ کدام جدول است؛ نام آن را بیاورید (مثلاً «رخدادها»، «تغییرها»، «درخواست‌ها»)" };
  const def = t.def;
  chips.push({ kind: "table", label: def.plural });

  const filters = findFilters(q, t, chips);
  const { m, label } = findMeasure(q, def, { filters });
  chips.push({ kind: "measure", label });

  // time
  const tf = timeField(q, def);
  const tw = tf ? findTime(q, opts.now ?? new Date().toISOString().slice(0, 10)) : null;
  const time = tf && tw ? { field: tf.name, window: tw.window ?? null, from: tw.from ?? null, to: tw.to ?? null } : null;
  if (time && tw) chips.push({ kind: "time", label: faDigits(`${tf!.label}: ${tw.label}`) });

  // dimensions
  const dims: Dimension[] = [];
  const by = fieldAfter(q, def, ["به تفکیک", "بر اساس", "برحسب", "بر حسب", "برای هر", "به ازای هر", "در هر", "per"], (f) => groupable(f) && !isDate(f));
  if (by) {
    dims.push({ field: by.name });
    chips.push({ kind: "dim", label: `به تفکیک ${by.label}` });
  }
  const dateDim = tf ?? def.fields.find(isDate) ?? null;
  const bucketWord: [string[], Dimension["bucket"], string][] = [
    [["روز هفته", "روزهای هفته"], "weekday", "روز هفته"],
    [["ساعت روز", "ساعت های روز", "ساعت‌های روز", "در چه ساعتی"], "hour_of_day", "ساعت روز"],
    [["روزانه", "هر روز", "به تفکیک روز"], "day", "روزانه"],
    [["هفتگی", "هر هفته", "به تفکیک هفته"], "week", "هفتگی"],
    [["ماهانه", "ماه به ماه", "هر ماه", "به تفکیک ماه"], "month", "ماهانه"],
    [["فصلی", "هر فصل", "به تفکیک فصل"], "quarter", "فصلی"],
    [["سالانه", "هر سال", "به تفکیک سال"], "year", "سالانه"],
  ];
  if (dateDim) {
    for (const [words, bucket, l] of bucketWord) {
      if (!has(q, ...words) || dims.length >= 2) continue;
      if ((bucket === "hour_of_day") && dateDim.type !== "datetime") continue;
      dims.push({ field: dateDim.name, bucket });
      chips.push({ kind: "dim", label: l });
    }
    if (!dims.some((d) => d.bucket) && has(q, "روند")) {
      dims.push({ field: dateDim.name, bucket: time?.window?.unit === "day" || !time ? "day" : "month" });
      chips.push({ kind: "dim", label: "روند در زمان" });
    }
  }
  // put a time bucket first (the axis), a field second (the series)
  dims.sort((a, b) => Number(!!b.bucket) - Number(!!a.bucket));

  // top N: «۱۰ دستهٔ پرتکرار»، «پنج گروه برتر» (the noun is the breakdown when none was named)
  let limit: number | null = null;
  const top = /(\d{1,3}|پنج|ده|بیست)\s+([^\s]+(?:\s[^\s]+)?)\s+(برتر|اول|پرتکرار|پر تکرار)/.exec(q) ?? /(پرتکرارترین|بیشترین|برترین)\s+(\d{1,3}|پنج|ده|بیست)\s+([^\s]+)/.exec(q);
  if (top) {
    const noun = top[1].match(/\d|پنج|ده|بیست/) ? top[2] : top[3];
    if (!dims.some((d) => !d.bucket) && noun) {
      const f = fieldAt(noun, def, (x) => groupable(x) && !isDate(x));
      if (f) {
        dims.push({ field: f.name });
        chips.push({ kind: "dim", label: `به تفکیک ${f.label}` });
      }
    }
    limit = dims.length ? numberIn(top[0]) : null;
    if (limit) chips.push({ kind: "limit", label: `${faDigits(limit)} مورد برتر` });
  }

  // the chart
  let viz: VizType | null = null;
  for (const [words, v] of VIZ_WORDS) if (has(q, ...words)) {
    viz = v;
    break;
  }
  const shape = (v: VizType) => dims.length >= VIZ[v].dims[0] && dims.length <= VIZ[v].dims[1];
  if (viz === "list") {
    dims.length = 0;
  } else if (!viz || !shape(viz)) {
    viz = suggestViz(dims.map((d) => ({ type: def.fields.find((f) => f.name === d.field)?.type ?? "string", bucket: d.bucket ?? null })), 1);
  }
  chips.push({ kind: "viz", label: VIZ[viz].label });

  const spec: ReportSpec = {
    v: 1,
    table: def.key,
    filter: filters.length ? (filters.length === 1 ? filters[0] : { and: filters }) : null,
    time,
    measures: viz === "list" ? [] : [{ ...m, label }],
    dims,
    columns: viz === "list" ? def.list?.columns ?? null : null,
    sort: dims.length && !dims[0].bucket ? { by: "value", dir: "desc" } : null,
    limit,
    other: !!limit,
    compare: false,
    viz,
    options: null,
  };
  return { spec, chips, problem: null };
}
