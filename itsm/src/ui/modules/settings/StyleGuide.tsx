// «راهنمای طراحی»: the living style guide of the «کاریز» design system (docs/DESIGN_SYSTEM.md, docs/BRAND_FA.md) — the
// logo and its rules, every colour role with its live value and contrast in the theme in effect, type, components,
// states, motion, icons with their RTL rules and the illustrations. For people who manage the organisation's settings
// (settings: full). Everything here is drawn by the real tokens and components, so it is also a visual test.
import "./styleguide.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Checkbox, Input, InputNumber, Radio, Segmented, Select, Switch, Table, Tabs, Tooltip } from "antd";
import {
  Bell,
  Calendar,
  Check,
  Clock,
  Database,
  Download,
  FileText,
  Filter,
  History,
  Inbox,
  Link2,
  Lock,
  Pencil,
  Play,
  Plus,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Truck,
  Upload,
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { APP_NAME, APP_NAME_EN, APP_TAGLINE } from "@shared/constants";
import { BRAND_COLORS, appIconSvg, lockupSvg, markSvg, wordmarkSvg, type BrandTone } from "@shared/brand";
import { contrast, over, parseColor, toHex, type RGBA } from "@shared/color";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useTheme } from "../../lib/theme";
import { useReducedMotion } from "../../lib/motion";
import { PageHeader } from "../../components/layout";
import { Card, Note } from "../../components/blocks";
import { Chip, EmptyState, Loader, PriorityChip, Skeleton, StateChip, type StateKind } from "../../components/display";
import { BrandMark, BrandTile, Logo } from "../../components/brand";
import { AiIcon } from "../../components/shell/icons";
import { COLOR_LABELS } from "../../records/model/colors";
import { DIRECTIONAL, DirIcon, Icon, NuqtaSpark, type DirectionalName } from "../../ds/icons";
import { ILLUSTRATIONS, Illustration, type IllustrationName } from "../../ds/illustrations";
import { celebrate } from "../../ds/celebrate";

// ------------------------------------------------------------------ live tokens

/** The resolved values of tokens on <html>, re-read when the theme changes. */
function useTokens(names: readonly string[]): Record<string, string> {
  const { mode } = useTheme();
  const key = names.join(",");
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    setVals(Object.fromEntries(key.split(",").map((n) => [n, cs.getPropertyValue(n).trim()])));
  }, [key, mode]);
  return vals;
}

const fa1 = (n: number) => faDigits(n.toFixed(1)).replace(".", "٫");

function ratioOf(fg: string | undefined, bg: string | undefined): number | null {
  const f = fg ? parseColor(fg) : null;
  const b = bg ? parseColor(bg) : null;
  if (!f || !b) return null;
  const solidBg: RGBA = b[3] < 1 ? over(b, [255, 255, 255, 1]) : b;
  return contrast(f[3] < 1 ? over(f, solidBg) : f, solidBg);
}

/** A contrast figure with its WCAG verdict: AA for text (4.5), «۳:۱» for graphics. */
function Ratio({ r, min = 4.5 }: { r: number | null; min?: number }) {
  if (r === null) return null;
  const ok = r >= min;
  return (
    <Tooltip title={min >= 4.5 ? "کنتراست متن (WCAG AA ≥ ۴٫۵)" : "کنتراست نشانه‌ها و مرزها (≥ ۳)"}>
      <span className="sg-ratio" data-ok={ok || undefined}>
        <span className="ds-num">{fa1(r)}</span>
        {min >= 3 ? <span className="ds-latin">{ok ? (min >= 4.5 ? "AA" : "3:1") : "✕"}</span> : null}
      </span>
    </Tooltip>
  );
}

interface SwatchSpec {
  token: string;
  label: string;
  /** contrast against this token (text roles) or of this text token on the swatch (tints) */
  on?: string;
  text?: string;
  min?: number;
}

function Swatches({ items }: { items: SwatchSpec[] }) {
  const names = useMemo(() => [...new Set(items.flatMap((i) => [i.token, i.on, i.text].filter(Boolean) as string[]))], [items]);
  const v = useTokens(names);
  return (
    <div className="sg-grid">
      {items.map((i) => {
        const value = v[i.token];
        const c = value ? parseColor(value) : null;
        const r = i.text ? ratioOf(v[i.text], value) : i.on ? ratioOf(value, v[i.on]) : null;
        return (
          <div key={i.token + (i.text ?? "")} className="sg-sw">
            <div className="sg-sw-chip" style={{ background: `var(${i.token})`, color: i.text ? `var(${i.text})` : undefined }}>
              {i.text ? <span className="sg-sw-sample">نمونهٔ متن</span> : null}
            </div>
            <div className="sg-sw-meta">
              <b>{i.label}</b>
              <Ratio r={r} min={i.min} />
            </div>
            <code className="sg-code">{i.token}</code>
            <code className="sg-code sg-code-v">{c ? (c[3] < 1 ? value : toHex(c)) : value}</code>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ helpers

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function download(name: string, svg: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Block({ title, children, note }: { title: ReactNode; children: ReactNode; note?: ReactNode }) {
  return (
    <Card title={title}>
      <div className="sg-block">
        {children}
        {note ? <p className="sg-note">{note}</p> : null}
      </div>
    </Card>
  );
}

/** Re-mounts its children when the button is pressed (to replay an entrance). */
function Replay({ label, children }: { label: string; children: (key: number) => ReactNode }) {
  const [k, setK] = useState(0);
  return (
    <div className="sg-demo-cell">
      <div className="sg-demo-stage">{children(k)}</div>
      <Button size="small" onClick={() => setK((x) => x + 1)}>
        {label}
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ 1. brand

function BrandTab() {
  const masters: [string, string][] = [
    ["kariz-lockup-fa.svg", lockupSvg("horizontal", "fa", { pad: 2 })],
    ["kariz-lockup-en.svg", lockupSvg("horizontal", "en", { pad: 2 })],
    ["kariz-lockup-stacked.svg", lockupSvg("stacked", "fa", { pad: 2 })],
    ["kariz-mark.svg", markSvg({ pad: 1, title: APP_NAME })],
    ["kariz-wordmark-fa.svg", wordmarkSvg("fa", { pad: 1 })],
    ["kariz-wordmark-en.svg", wordmarkSvg("en", { pad: 1 })],
    ["kariz-app-icon.svg", appIconSvg({ px: 512 })],
  ];
  const panel = (on: "paper" | "charcoal" | "night", tone: BrandTone, kind: "horizontal" | "stacked", lang: "fa" | "en", h: number) => (
    <div className="sg-panel" data-on={on}>
      <img src={svgUrl(lockupSvg(kind, lang, { tone, height: h }))} alt={lang === "fa" ? APP_NAME : APP_NAME_EN} />
    </div>
  );
  return (
    <div className="sg">
      <Block title="نشانه و نام" note={`«${APP_NAME}» — ${APP_TAGLINE}. طاقِ دهانهٔ کاریز، جایی که آبِ پنهان به روشنایی می‌رسد، و نقطهٔ لوزی، واحد اندازه در خوشنویسی.`}>
        <div className="sg-row sg-row-spread">
          <Logo size={34} />
          <Logo size={30} latin />
          <img src={svgUrl(lockupSvg("stacked", "fa", { height: 150 }))} alt={APP_NAME} />
        </div>
      </Block>
      <Block title="روی زمینه‌ها" note="رنگی روی کاغذ و زغال؛ سفید با نقطهٔ زعفرانی روی شبِ برند؛ تک‌رنگ برای چاپ و مُهر.">
        <div className="sg-panels">
          {panel("paper", "brand", "horizontal", "fa", 44)}
          {panel("charcoal", "brand-dark", "horizontal", "fa", 44)}
          <div className="sg-panel" data-on="night">
            <Logo size={30} tone="white" />
          </div>
          {panel("paper", "mono", "horizontal", "en", 36)}
          {panel("charcoal", "inverse", "horizontal", "en", 36)}
          {panel("night", "inverse", "stacked", "fa", 120)}
        </div>
      </Block>
      <Block title="اندازه‌ها" note="از ۲۴ پیکسل و کمتر برش سنگین‌تر نشانه به کار می‌رود. کاشی برنامه (گرادیان لاجورد به فیروزه) فقط برای نماد برنامه و فهرست سازمان‌هاست.">
        <div className="sg-row">
          {[16, 24, 32, 48, 64].map((s) => (
            <BrandMark key={s} size={s} title="" />
          ))}
          <span className="sg-sep" />
          {[24, 32, 44, 64].map((s) => (
            <BrandTile key={s} size={s} />
          ))}
          <img src={svgUrl(appIconSvg({ px: 96 }))} alt="" width={96} height={96} />
        </div>
      </Block>
      <Block title="حریم و کوچک‌ترین اندازه">
        <div className="sg-row sg-row-spread">
          <span className="sg-clear">
            <Logo size={28} />
          </span>
          <ul className="sg-rules">
            <li>حریم دور نشانه و قفل‌ها دست‌کم به پهنای دهانهٔ طاق است (نیمِ پهنای نشانه)؛ چیزی وارد آن نشود.</li>
            <li>کوچک‌ترین اندازه: نشانه ۱۶ پیکسل (۵ میلی‌متر)، قفل افقی ۷۲ پیکسل پهنا (۲۰ میلی‌متر)، قفل عمودی ۴۸ پیکسل.</li>
            <li>نشانه را نکشید، نچرخانید، سایه یا رنگ دیگری به آن ندهید و نام را با قلم دیگری کنارش ننویسید.</li>
            <li>نقطه همیشه هم‌رنگ زعفران یا هم‌رنگ خود نشانه است؛ هرگز قرمز.</li>
          </ul>
        </div>
      </Block>
      <Block title="دریافت طرح‌های اصلی (SVG)">
        <div className="sg-row">
          {masters.map(([name, svg]) => (
            <Button key={name} size="small" icon={<Icon icon={Download} size={14} />} onClick={() => download(name, svg)}>
              <span className="ds-latin">{name}</span>
            </Button>
          ))}
        </div>
      </Block>
    </div>
  );
}

// ------------------------------------------------------------------ 2. colour

const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

function ScaleRow({ name, label, scale }: { name: string; label: string; scale: Record<number, string> }) {
  return (
    <div className="sg-scale-row">
      <b>{label}</b>
      <div className="sg-scale">
        {SCALE_STEPS.map((s) => (
          <Tooltip key={s} title={<span className="ds-latin">{`--ds-${name}-${s} ${scale[s]}`}</span>}>
            <span className="sg-scale-cell" style={{ background: scale[s], color: s >= 600 ? "#FFFFFF" : BRAND_COLORS.ink }}>
              <span className="ds-num">{faDigits(String(s))}</span>
            </span>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

const STATES: [StateKind, string][] = [
  ["new", "جدید"],
  ["progress", "در جریان"],
  ["hold", "در انتظار"],
  ["resolved", "حل‌شده"],
  ["closed", "بسته"],
  ["cancelled", "لغوشده"],
];
const PRIORITIES: [1 | 2 | 3 | 4 | 5, string][] = [
  [1, "بحرانی"],
  [2, "زیاد"],
  [3, "متوسط"],
  [4, "کم"],
  [5, "برنامه‌ریزی"],
];
const SLA: [Parameters<typeof Chip>[0]["tone"], string][] = [
  ["in", "در مهلت · ۲ ساعت مانده"],
  ["warning", "نزدیک به نقض · ۸۰٪"],
  ["danger", "نقض‌شده · ۱۵ دقیقه"],
  ["neutral", "متوقف · منتظر درخواست‌دهنده"],
];
const HUES = ["gray", "red", "orange", "gold", "green", "teal", "blue", "indigo", "purple", "magenta"] as const;
const CHART_NAMES = ["فیروزه", "زعفران", "شامگاه", "سفال", "لاجورد", "پسته", "گردو", "آسمان"];

function ColourTab() {
  return (
    <div className="sg">
      <Block title="رنگ‌های برند" note="فیروزه برای کنش و انتخاب، لاجورد برای آگاهی و هوش مصنوعی، زعفران برای گرما و «در انتظار»؛ روی کاهگل و مرکب.">
        <ScaleRow name="firuzeh" label="فیروزه" scale={BRAND_COLORS.firuzeh} />
        <ScaleRow name="lajvard" label="لاجورد" scale={BRAND_COLORS.lajvard} />
        <ScaleRow name="zaferan" label="زعفران" scale={BRAND_COLORS.zaferan} />
      </Block>
      <Block title="سطح‌ها و متن" note="عدد کنار هر رنگ، کنتراست آن در پوستهٔ فعلی است؛ همهٔ ۵۴۲ جفت هر دو پوسته را scripts/ds-tokens.ts می‌سنجد.">
        <Swatches
          items={[
            { token: "--ds-canvas", label: "زمینه" },
            { token: "--ds-surface", label: "سطح" },
            { token: "--ds-raised", label: "برجسته" },
            { token: "--ds-sunken", label: "فرورفته" },
            { token: "--ds-well", label: "چاهک" },
            { token: "--ds-text", label: "متن", on: "--ds-surface" },
            { token: "--ds-text-2", label: "متن ۲", on: "--ds-surface" },
            { token: "--ds-text-3", label: "متن ۳", on: "--ds-surface" },
            { token: "--ds-text-4", label: "غیرفعال", on: "--ds-surface", min: 2 },
            { token: "--ds-control-strong", label: "لبهٔ کنترل", on: "--ds-surface", min: 3 },
            { token: "--ds-line-2", label: "خط ۲" },
            { token: "--ds-line-3", label: "خط ۳" },
          ]}
        />
      </Block>
      <Block title="تأکید و انتخاب">
        <Swatches
          items={[
            { token: "--ds-accent", label: "کنش اصلی", text: "--ds-on-accent" },
            { token: "--ds-accent-hover", label: "اشاره", text: "--ds-on-accent" },
            { token: "--ds-accent-text", label: "متن تأکید", on: "--ds-surface" },
            { token: "--ds-accent-line", label: "سری اصلی", on: "--ds-surface", min: 3 },
            { token: "--ds-accent-tint-2", label: "پالایهٔ فعال", text: "--ds-accent-text" },
            { token: "--ds-focus-color", label: "حلقهٔ تمرکز", on: "--ds-surface", min: 3 },
            { token: "--ds-selection", label: "گزینش متن", text: "--ds-text" },
            { token: "--ds-brand-nuqta", label: "نقطهٔ برند", on: "--ds-surface", min: 3 },
          ]}
        />
      </Block>
      <Block title="معنایی" note="رنگ هرگز تنها نشانه نیست: هر وضعیت با واژه و نقطه می‌آید.">
        <Swatches
          items={[
            { token: "--ds-in-tint", label: "موفق", text: "--ds-in" },
            { token: "--ds-warning-tint", label: "هشدار", text: "--ds-warning" },
            { token: "--ds-danger-tint", label: "خطا", text: "--ds-danger" },
            { token: "--ds-info-tint", label: "آگاهی", text: "--ds-info" },
            { token: "--ds-ai-tint", label: "هوش مصنوعی", text: "--ds-ai-text" },
            { token: "--ds-neutral-tint", label: "خنثی", text: "--ds-text-2" },
          ]}
        />
      </Block>
      <Block title="وضعیت رکورد، اولویت و توافق سطح خدمت">
        <div className="sg-row">
          {STATES.map(([s, l]) => (
            <StateChip key={s} state={s}>
              {l}
            </StateChip>
          ))}
        </div>
        <div className="sg-row">
          {PRIORITIES.map(([p, l]) => (
            <PriorityChip key={p} p={p}>
              {l}
            </PriorityChip>
          ))}
        </div>
        <div className="sg-row">
          {SLA.map(([t, l]) => (
            <Chip key={l} tone={t} fig>
              {l}
            </Chip>
          ))}
        </div>
      </Block>
      <Block title="رنگ‌های نام‌دار (گزینه‌ها و درگاه)" note="یک گزینه یا درگاه یکی از این نام‌ها را برمی‌گزیند؛ هرگز کد رنگ.">
        <div className="sg-hues">
          {HUES.map((h) => (
            <span key={h} className="sg-hue">
              <i style={{ background: `var(--ds-hue-${h})` }} />
              <span>{COLOR_LABELS[h]}</span>
            </span>
          ))}
        </div>
      </Block>
      <Block title="نمودار" note="ترتیب ثابت، هرگز چرخشی؛ بیش از هشت سری در «سایر» جمع یا تفکیک می‌شود. همسایه‌ها برای کوررنگی سنجیده شده‌اند؛ کنار نمودار همیشه برچسب یا جدول هست.">
        <div className="sg-bars" role="img" aria-label="هشت رنگ دسته‌ای نمودار">
          {CHART_NAMES.map((n, i) => (
            <div key={n} className="sg-bar-col">
              <span className="sg-bar" style={{ blockSize: `${38 + ((i * 37) % 60)}%`, background: `var(--ds-chart-${i + 1})` }} />
              <small>{n}</small>
            </div>
          ))}
        </div>
        <div className="sg-strip-l">
          <small>پیوسته</small>
          <div className="sg-strip">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} style={{ background: `var(--ds-seq-${i + 1})` }} />
            ))}
          </div>
        </div>
        <div className="sg-strip-l">
          <small>واگرا</small>
          <div className="sg-strip">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} style={{ background: `var(--ds-div-${i + 1})` }} />
            ))}
          </div>
        </div>
      </Block>
    </div>
  );
}

// ------------------------------------------------------------------ 3. type

const TYPE_ROLES: [string, string, string][] = [
  ["ds-t-display", "display", "خدمت، پیوسته و بی‌صدا"],
  ["ds-t-page", "page", "رخدادها و مشکلات"],
  ["ds-t-section", "section", "در انتظار رسیدگی"],
  ["ds-t-title", "title", "قطعی شبکهٔ ساختمان مرکزی"],
  ["ds-t-body", "body", "درخواست شما ثبت شد و به گروه پشتیبانی شبکه سپرده شد."],
  ["ds-t-dense", "dense", "۱۲ رخداد باز · ۳ نزدیک به نقض توافق"],
  ["ds-t-label", "label", "گروه پشتیبانی"],
  ["ds-t-caption", "caption", "آخرین تغییر: ۱۹ آبان ۱۴۰۵، ساعت ۱۰:۲۴"],
  ["ds-t-paragraph", "paragraph", "کاریز آب را از دل زمین، آرام و پیوسته و به‌اندازه، به شهر می‌رساند؛ خدمات سازمان هم همین‌طور: بی‌صدا وقتی درست کار می‌کنند و روشن وقتی کاری مانده است."],
];

function TypeTab() {
  const v = useTokens(TYPE_ROLES.flatMap(([, k]) => [`--ds-type-${k}-size`, `--ds-type-${k}-line`, `--ds-type-${k}-weight`]));
  return (
    <div className="sg">
      <Block title="مقیاس حروف" note="قلم فارسی آراد (OFL، با نقطه‌های لوزی DSTY ۳)، همهٔ رقم‌ها با «DS Num» (زیرمجموعهٔ وزیرمتن)، لاتین با Geist و کد با Geist Mono؛ همه از پوشهٔ خود برنامه، بدون CDN.">
        {TYPE_ROLES.map(([cls, k, text]) => (
          <div key={cls} className="sg-type-row">
            <div className="sg-type-meta">
              <code className="sg-code">.{cls}</code>
              <span className="ds-num sg-type-spec ds-ltr">{[v[`--ds-type-${k}-size`], v[`--ds-type-${k}-line`], v[`--ds-type-${k}-weight`]].filter(Boolean).join(" / ")}</span>
            </div>
            <div className={cls}>{text}</div>
          </div>
        ))}
      </Block>
      <Block title="وزن‌ها">
        <div className="sg-row">
          <span style={{ fontWeight: "var(--ds-weight-regular)" }}>معمولی ۴۵۰</span>
          <span style={{ fontWeight: "var(--ds-weight-medium)" }}>میانه ۵۴۰</span>
          <span style={{ fontWeight: "var(--ds-weight-strong)" }}>پررنگ ۶۰۰ (عنوان‌ها و جمع‌ها)</span>
        </div>
      </Block>
      <Block title="رقم و جهت" note="رقم‌ها پیش‌فرض فارسی‌اند؛ شناسه‌هایی که باید لاتین بمانند .ds-id و کد و نشانی .ds-mono می‌گیرند. هر تکهٔ چپ‌به‌راست یک جزیرهٔ دوسویه است.">
        <div className="sg-digits">
          <span className="ds-t-figure ds-num">۱۲۸٬۴۵۰٫۷۵</span>
          <span>
            رخداد <span className="ds-id">INC-000123</span> در صف «پشتیبانی شبکه»
          </span>
          <span className="ds-mono">10.0.4.17 · srv-db-02 · a3f9-77c2</span>
          <table className="sg-tab">
            <tbody>
              {["۱۲٬۴۰۰", "۳۸۱", "۹٬۰۰۵٫۵"].map((n) => (
                <tr key={n}>
                  <td>هزینه</td>
                  <td className="ds-num">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
    </div>
  );
}

// ------------------------------------------------------------------ 4. components

const ROWS = [
  { key: "1", no: "INC-001204", title: "قطعی اینترنت طبقهٔ سوم", state: "progress" as StateKind, stateL: "در جریان", p: 1 as const, sla: ["warning", "۸۰٪ مهلت"] as const },
  { key: "2", no: "INC-001199", title: "درخواست دسترسی به سامانهٔ مالی", state: "hold" as StateKind, stateL: "در انتظار", p: 3 as const, sla: ["neutral", "متوقف"] as const },
  { key: "3", no: "INC-001187", title: "کندی ایمیل در شعبهٔ اصفهان", state: "new" as StateKind, stateL: "جدید", p: 2 as const, sla: ["in", "۴ ساعت مانده"] as const },
  { key: "4", no: "INC-001150", title: "خطای چاپگر واحد منابع انسانی", state: "resolved" as StateKind, stateL: "حل‌شده", p: 4 as const, sla: ["in", "انجام در مهلت"] as const },
];

function ComponentsTab() {
  const [seg, setSeg] = useState<string>("همه");
  return (
    <div className="sg">
      <Block title="دکمه‌ها" note="در هر بخش فقط یک کنش اصلی فیروزه‌ای؛ کنش‌های دیگر پیش‌فرض یا متنی.">
        <div className="sg-row">
          <Button type="primary" icon={<Icon icon={Plus} />}>
            رخداد تازه
          </Button>
          <Button>ذخیره پیش‌نویس</Button>
          <Button type="text">انصراف</Button>
          <Button type="link">نمایش تاریخچه</Button>
          <Button danger>حذف</Button>
          <Button type="primary" danger>
            حذف همیشگی
          </Button>
          <Button type="primary" loading>
            در حال ثبت
          </Button>
          <Button disabled>غیرفعال</Button>
          <Tooltip title="ویرایش">
            <Button icon={<Icon icon={Pencil} />} aria-label="ویرایش" />
          </Tooltip>
        </div>
      </Block>
      <Block title="ورودی‌ها">
        <div className="sg-form">
          <Input placeholder="عنوان رخداد" />
          <Select
            placeholder="گروه پشتیبانی"
            options={[
              { value: "net", label: "پشتیبانی شبکه" },
              { value: "app", label: "پشتیبانی نرم‌افزار" },
            ]}
          />
          <InputNumber placeholder="۰" min={0} style={{ inlineSize: "100%" }} />
          <Segmented value={seg} onChange={(v) => setSeg(String(v))} options={["همه", "باز", "مال من"]} />
          <span className="sg-row">
            <Switch defaultChecked aria-label="اعلان" /> <Checkbox defaultChecked>اطلاع به درخواست‌دهنده</Checkbox>
          </span>
          <Radio.Group defaultValue="a" options={[{ value: "a", label: "عادی" }, { value: "b", label: "فوری" }]} />
        </div>
      </Block>
      <Block title="برچسب‌ها">
        <div className="sg-row">
          {(["neutral", "accent", "in", "warning", "danger", "info", "ai"] as const).map((t) => (
            <Chip key={t} tone={t}>
              {{ neutral: "پیش‌نویس", accent: "این دوره", in: "تأییدشده", warning: "در انتظار", danger: "ناموفق", info: "تازه", ai: "پیشنهاد هوش مصنوعی" }[t]}
            </Chip>
          ))}
        </div>
      </Block>
      <Block title="پیام‌ها">
        <div className="sg-stack">
          <Alert type="info" showIcon title="اطلاعیه: به‌روزرسانی سامانهٔ ایمیل امشب ساعت ۲۲ انجام می‌شود." />
          <Alert type="success" showIcon title="تغییر بدون رخداد بسته شد." />
          <Alert type="warning" showIcon title={<><b>نزدیک به نقض:</b> سه رخداد کمتر از یک ساعت تا پایان مهلت دارند.</>} />
          <Alert type="error" showIcon title="ثبت نشد: اتصال به سرور برقرار نیست." />
          <Note>یادداشت آرام: توضیحی که لازم است دیده شود ولی هشدار نیست.</Note>
        </div>
      </Block>
      <Block title="جدول">
        <Table
          size="small"
          pagination={false}
          rowKey="key"
          dataSource={ROWS}
          rowClassName={(r) => (r.key === "1" ? "ant-table-row-selected" : "")}
          columns={[
            { title: "شماره", dataIndex: "no", width: 130, render: (n: string) => <span className="ds-id">{n}</span> },
            { title: "عنوان", dataIndex: "title", ellipsis: true },
            { title: "وضعیت", dataIndex: "state", width: 120, render: (_: unknown, r: (typeof ROWS)[number]) => <StateChip state={r.state}>{r.stateL}</StateChip> },
            { title: "اولویت", dataIndex: "p", width: 110, render: (p: 1 | 2 | 3 | 4 | 5) => <PriorityChip p={p} /> },
            { title: "مهلت", dataIndex: "sla", width: 140, render: (_: unknown, r: (typeof ROWS)[number]) => <Chip tone={r.sla[0]} fig>{r.sla[1]}</Chip> },
          ]}
        />
      </Block>
      <Block title="حالت‌های خالی و بارگذاری" note="تصویرها برای صفحه‌های خالی و نخستین اجرا؛ در جدول‌ها کاشی نماد کافی است. بارگذاری: اسکلت در نخستین بار، سه نقطهٔ لوزی برای انتظار بیش از یک ثانیه؛ هرگز چرخنده.">
        <div className="sg-split">
          <EmptyState art="done" title={ILLUSTRATIONS.done.title} description={ILLUSTRATIONS.done.hint} compact />
          <EmptyState title="هنوز رخدادی ثبت نشده است" icon={Inbox} compact action={<Button icon={<Icon icon={Plus} />}>رخداد تازه</Button>} />
          <div className="sg-stack">
            <Skeleton rows={4} />
            <Loader />
          </div>
        </div>
      </Block>
    </div>
  );
}

// ------------------------------------------------------------------ 5. motion

const DURATIONS = ["instant", "fast", "base", "moderate", "slow", "sheet", "sheet-exit", "hero", "flash", "celebrate", "pulse"];
const EASINGS = ["out", "out-quad", "in-out", "sheet"];

function MotionTab() {
  const reduced = useReducedMotion();
  const v = useTokens([...DURATIONS.map((d) => `--ds-dur-${d}`), ...EASINGS.map((e) => `--ds-ease-${e}`)]);
  const [simulate, setSimulate] = useState(false);
  const [pending, setPending] = useState(false);
  const [on, setOn] = useState(true);
  const [flash, setFlash] = useState(0);
  const [loaded, setLoaded] = useState(true);
  const party = useRef<HTMLButtonElement>(null);
  // simulate «reduce motion» for this page only: set data-motion, and put back whatever the app had when switched off
  useEffect(() => {
    if (!simulate) return;
    const root = document.documentElement;
    const original = root.dataset.motion;
    root.dataset.motion = "reduced";
    return () => {
      if (original === undefined) delete root.dataset.motion;
      else root.dataset.motion = original;
    };
  }, [simulate]);
  const toggleOptimistic = (next: boolean) => {
    setOn(next); // shown at once
    setPending(true);
    window.setTimeout(() => {
      setPending(false);
      setFlash((x) => x + 1); // confirmed
    }, 1200);
  };
  return (
    <div className="sg">
      <Block title="زمان و منحنی" note="فقط transform و opacity جابه‌جا می‌شوند؛ هرگز transition: all. خروج‌ها حدود سه‌چهارم ورودند. با «کاهش حرکت» همهٔ جابه‌جایی‌ها حذف و فقط محوشدن کوتاه می‌ماند.">
        <div className="sg-tokens">
          {DURATIONS.map((d) => (
            <span key={d}>
              <code className="sg-code">--ds-dur-{d}</code>
              <span className="ds-latin">{v[`--ds-dur-${d}`]}</span>
            </span>
          ))}
          {EASINGS.map((e) => (
            <span key={e}>
              <code className="sg-code">--ds-ease-{e}</code>
              <span className="ds-latin sg-ease">{v[`--ds-ease-${e}`]}</span>
            </span>
          ))}
        </div>
        <div className="sg-row">
          <Switch checked={simulate} onChange={setSimulate} aria-label="شبیه‌سازی کاهش حرکت" />
          <span>شبیه‌سازی «کاهش حرکت» در این نشست</span>
          <Chip tone={reduced ? "warning" : "neutral"}>{reduced ? "کاهش حرکت فعال است" : "حرکت کامل"}</Chip>
        </div>
      </Block>
      <Block title="ریزتعامل‌ها و گذارها">
        <div className="sg-demo">
          <Replay label="ورود">{(k) => <div key={k} className="sg-demo-box ds-enter">ورود</div>}</Replay>
          <Replay label="پشت‌سرهم">
            {(k) => (
              <div key={k} className="sg-demo-list ds-stagger">
                {[1, 2, 3, 4, 5].map((i) => (
                  <i key={i} />
                ))}
              </div>
            )}
          </Replay>
          <Replay label="بازشدن">{(k) => <div key={k} className="sg-demo-box ds-pop">لایهٔ شناور</div>}</Replay>
          <div className="sg-demo-cell">
            <div className="sg-demo-stage">
              <button type="button" className="sg-demo-box ds-press">
                فشار دهید
              </button>
            </div>
            <small>فشار: کوچک‌شدن ۲٪</small>
          </div>
          <Replay label="نخستین نمایش نشانه">{(k) => <BrandMark key={k} size={56} launch title="" />}</Replay>
          <div className="sg-demo-cell">
            <div className="sg-demo-stage">{loaded ? <div key="c" className="sg-demo-box ds-fade">محتوا</div> : <Skeleton rows={2} />}</div>
            <Button size="small" onClick={() => setLoaded((x) => !x)}>
              اسکلت ↔ محتوا
            </Button>
          </div>
          <div className="sg-demo-cell">
            <div className="sg-demo-stage">
              <div key={flash} className={`sg-opt${flash ? " ds-flash" : ""}`} data-pending={pending || undefined}>
                <Switch checked={on} onChange={toggleOptimistic} size="small" aria-label="اعلان به درخواست‌دهنده" />
                <span>اعلان به درخواست‌دهنده</span>
                {pending ? <Loader label="در حال ذخیره" /> : null}
              </div>
            </div>
            <small>به‌روزرسانی خوش‌بینانه: فوری، کم‌رنگ تا تأیید، سپس درخشش کوتاه</small>
          </div>
          <div className="sg-demo-cell">
            <div className="sg-demo-stage">
              <Button ref={party} type="primary" onClick={() => void celebrate(party.current)}>
                رخداد عمده حل شد
              </Button>
            </div>
            <small>جشن نقطه‌ها، فقط برای نقطه‌های عطف</small>
          </div>
        </div>
      </Block>
    </div>
  );
}

// ------------------------------------------------------------------ 6. icons and illustration

const SET: [LucideIcon, string][] = [
  [Inbox, "صندوق"],
  [Search, "جست‌وجو"],
  [Filter, "پالایه"],
  [Bell, "اعلان"],
  [Settings, "تنظیمات"],
  [User, "کاربر"],
  [Users, "گروه"],
  [FileText, "سند"],
  [Calendar, "تقویم"],
  [Clock, "زمان"],
  [Check, "تأیید"],
  [X, "بستن"],
  [Plus, "افزودن"],
  [Pencil, "ویرایش"],
  [Trash2, "حذف"],
  [Download, "دریافت"],
  [Upload, "بارگذاری"],
  [Link2, "پیوند"],
  [Lock, "قفل"],
  [Server, "سرور"],
  [Database, "پایگاه داده"],
  [ShieldCheck, "امنیت"],
];
const DIR_DEMO: [DirectionalName, string][] = [
  ["back", "بازگشت"],
  ["forward", "پیش"],
  ["prev", "قبلی"],
  ["next", "بعدی"],
  ["undo", "واگرد"],
  ["redo", "از نو"],
  ["reply", "پاسخ"],
  ["send", "فرستادن"],
  ["external", "پیوند بیرونی"],
  ["logout", "خروج"],
];
const NEVER: [LucideIcon, string][] = [
  [History, "تاریخچه"],
  [Clock, "زمان"],
  [Check, "تأیید"],
  [Search, "جست‌وجو"],
  [Play, "پخش"],
  [TrendingUp, "روند"],
  [Truck, "ارسال"],
];

function IconsTab() {
  return (
    <div className="sg">
      <Block title="مجموعهٔ نماد" note="Lucide در ۱۶ پیکسل با خط ۱٫۴ در هر اندازه؛ رنگ نماد از متن است (متن ۳، و متن وقتی فعال است)، نه از رنگ تأکید.">
        <div className="sg-icons">
          {SET.map(([I, l]) => (
            <span key={l} className="sg-icon">
              <Icon icon={I} size={20} />
              <small>{l}</small>
            </span>
          ))}
          <span className="sg-icon" data-ai>
            <Icon icon={AiIcon} size={20} />
            <small>هوش مصنوعی</small>
          </span>
          <span className="sg-icon" data-ai>
            <Icon icon={NuqtaSpark} size={20} />
            <small>جرقهٔ نقطه</small>
          </span>
        </div>
      </Block>
      <Block title="جهت‌دارها در راست‌به‌چپ" note={`فقط نمادهای جهت‌دار برمی‌گردند (${Object.keys(DIRECTIONAL).length} نام منطقی در ds/icons.tsx). در صفحهٔ فارسی «بعدی» به چپ و «بازگشت» به راست اشاره می‌کند؛ در جزیرهٔ لاتین برعکس.`}>
        <div className="sg-dir">
          <span className="sg-dir-h">نام</span>
          <span className="sg-dir-h">راست‌به‌چپ</span>
          <span className="sg-dir-h">چپ‌به‌راست</span>
          {DIR_DEMO.map(([n, l]) => (
            <span key={n} className="sg-dir-row">
              <span>
                {l} <code className="sg-code">{n}</code>
              </span>
              <DirIcon name={n} size={20} />
              <span dir="ltr">
                <DirIcon name={n} size={20} />
              </span>
            </span>
          ))}
        </div>
        <div className="sg-row">
          <small>هرگز برنمی‌گردند:</small>
          {NEVER.map(([I, l]) => (
            <Tooltip key={l} title={l}>
              <span className="sg-never">
                <Icon icon={I} size={20} label={l} />
              </span>
            </Tooltip>
          ))}
        </div>
      </Block>
      <Block title="تصویرهای حالت خالی" note="خط‌های آرام روی نقش‌مایه‌های برند — طاق، افق، آب فیروزه‌ای و نقطهٔ زعفرانی — با رنگ‌های پوسته.">
        <div className="sg-illus">
          {(Object.keys(ILLUSTRATIONS) as IllustrationName[]).map((n) => (
            <figure key={n}>
              <Illustration name={n} size={160} />
              <figcaption>
                <b>{ILLUSTRATIONS[n].title}</b>
                <small>{ILLUSTRATIONS[n].hint}</small>
              </figcaption>
            </figure>
          ))}
        </div>
      </Block>
    </div>
  );
}

// ------------------------------------------------------------------ the page

const TABS = [
  { key: "brand", label: "نشانه", el: <BrandTab /> },
  { key: "colour", label: "رنگ", el: <ColourTab /> },
  { key: "type", label: "حروف", el: <TypeTab /> },
  { key: "components", label: "اجزا", el: <ComponentsTab /> },
  { key: "motion", label: "حرکت", el: <MotionTab /> },
  { key: "icons", label: "نماد و تصویر", el: <IconsTab /> },
];

export default function StyleGuide() {
  const { can } = useOrg();
  const [tab, setTab] = useState(() => {
    try {
      return localStorage.getItem("itsm.styleGuideTab") ?? "brand";
    } catch {
      return "brand";
    }
  });
  if (!can("settings", "full"))
    return (
      <>
        <PageHeader title="راهنمای طراحی" />
        <EmptyState art="locked" title={ILLUSTRATIONS.locked.title} description="راهنمای طراحی برای مدیران تنظیمات سازمان است." />
      </>
    );
  return (
    <>
      <PageHeader title="راهنمای طراحی" subtitle={<span>سامانهٔ طراحی «{APP_NAME}» · نسخهٔ <span className="ds-num">۲٫۰</span></span>} />
      <Tabs
        activeKey={tab}
        onChange={(k) => {
          setTab(k);
          try {
            localStorage.setItem("itsm.styleGuideTab", k);
          } catch {
            /* private window */
          }
        }}
        items={TABS.map((t) => ({ key: t.key, label: t.label, children: t.el }))}
      />
    </>
  );
}
