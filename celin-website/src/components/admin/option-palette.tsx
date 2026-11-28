"use client";

import { useState, type ReactNode } from "react";
import { adminResetOptions, adminSaveOptions } from "@/app/actions/admin-catalog";
import { LEATHERS, METALS, STONES } from "@/lib/catalog-types";
import { num } from "@/lib/format";
import { AXIS_FA, MATERIAL_RE, MAX_VALUES, OPTION_AXES, valueWord, type OptionAxis, type OptionPalette, type PaletteValue } from "@/lib/options";
import { Badge, Button, ConfirmButton, Input, Select } from "@/components/admin/ui";
import { useAction } from "@/components/admin/toast";
import { LEATHER_LABEL, METAL_LABEL, STONE_LABEL } from "@/components/admin/catalog-labels";
import { Section } from "@/components/admin/settings-forms";
import { Swatch, SwatchPicker } from "@/components/admin/swatch";
import { Icon, type IconName } from "@/components/ui/icons";

/**
 * Settings → «رنگ‌های گزینه‌ها»: the plating, stone and leather colours a product's options are made of
 * (src/lib/options.ts). Each colour has a Persian and English name, a dot, a code for the SKU and the shop filter it
 * falls under. A colour used by a product cannot be deleted; a rename is written into every stored combination.
 */

type Row = PaletteValue & { k: number };

const FACET_LABEL: Record<OptionAxis, { values: readonly string[]; label: Record<string, string> }> = {
  plating: { values: METALS, label: METAL_LABEL },
  stone: { values: STONES, label: STONE_LABEL },
  leather: { values: LEATHERS, label: LEATHER_LABEL },
};

let K = 0;
const nk = () => ++K;

const move = <T,>(xs: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= xs.length) return xs;
  const next = [...xs];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
};

/** A field with its label on phones; from tablets up the list's header row names the columns. */
function Cell({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-xs font-medium text-ink-2 sm:sr-only">{label}</span>
      {children}
    </label>
  );
}

export function OptionPaletteForm({ initial, usage }: { initial: OptionPalette; usage: Record<string, number> }) {
  const [rows, setRows] = useState<Record<OptionAxis, Row[]>>(() => Object.fromEntries(OPTION_AXES.map((a) => [a, initial[a].map((v) => ({ ...v, k: nk() }))])) as Record<OptionAxis, Row[]>);
  const save = useAction();
  const reset = useAction();
  const setAxis = (axis: OptionAxis, fn: (xs: Row[]) => Row[]) => setRows((r) => ({ ...r, [axis]: fn(r[axis]) }));
  const patch = (axis: OptionAxis, k: number, p: Partial<PaletteValue>) => setAxis(axis, (xs) => xs.map((x) => (x.k === k ? { ...x, ...p } : x)));
  const palette = Object.fromEntries(OPTION_AXES.map((a) => [a, rows[a].map(({ k: _, ...v }) => v)])) as OptionPalette;

  return (
    <Section
      id="options"
      title="رنگ‌های گزینه‌ها"
      footer={
        <>
          <ConfirmButton variant="ghost" icon="refresh" size="md" pending={reset.pending} confirmLabel="بازنشانی؟ دوباره بزنید" onConfirm={() => reset.run(() => adminResetOptions())}>
            پیش‌فرض
          </ConfirmButton>
          <Button pending={save.pending} onClick={() => save.run(() => adminSaveOptions({ palette }))}>
            ذخیره
          </Button>
        </>
      }
    >
      <p className="text-xs leading-6 text-muted">رنگ‌هایی که در «گزینه‌ها»ی هر محصول انتخاب می‌شوند. رنگ نگین را با نام رنگ بنویسید، نه نام سنگ؛ تغییر نام، نام ترکیب‌های ذخیره‌شده را هم عوض می‌کند.</p>
      {OPTION_AXES.map((axis) => (
        <AxisList key={axis} axis={axis} rows={rows[axis]} usage={usage} setRows={(fn) => setAxis(axis, fn)} patch={(k, p) => patch(axis, k, p)} />
      ))}
    </Section>
  );
}

function AxisList({ axis, rows, usage, setRows, patch }: { axis: OptionAxis; rows: Row[]; usage: Record<string, number>; setRows: (fn: (xs: Row[]) => Row[]) => void; patch: (k: number, p: Partial<PaletteValue>) => void }) {
  const facets = FACET_LABEL[axis];
  const plating = axis === "plating";
  const example = plating ? undefined : rows.find((r) => r.fa);
  const add = () => {
    const k = nk();
    setRows((xs) => [...xs, { k, key: "", fa: "", en: "", swatch: "", code: "", facet: "" }]);
    setTimeout(() => document.querySelector<HTMLInputElement>(`[data-colour="${k}"] input[data-first]`)?.focus(), 30);
  };
  return (
    <fieldset className="border-t border-line pt-4">
      <legend className="flex w-full items-baseline gap-2 text-sm font-medium">
        {AXIS_FA[axis]}
        <span className="text-xs font-normal text-muted">{num(rows.length, "fa")} رنگ</span>
      </legend>
      {/* how its colours read in a combination's name (the basket, orders, the team's message) */}
      {example && (
        <p className="mt-1 text-xs leading-6 text-muted">
          در نام ترکیب: «{valueWord(axis, example, example.key, "fa")}»
          {example.en && (
            <>
              {" / "}
              <bdi dir="ltr">{valueWord(axis, example, example.key, "en")}</bdi>
            </>
          )}
        </p>
      )}
      {rows.length > 0 && (
        <div className="mt-3">
          <div aria-hidden className="hidden gap-3 px-3 pb-1.5 text-xs text-muted sm:grid sm:grid-cols-[2.5rem_minmax(0,1.3fr)_minmax(0,1fr)_4.5rem_minmax(0,9rem)_10.5rem]">
            <span>رنگ</span>
            <span>نام فارسی</span>
            <span>نام انگلیسی</span>
            <span>کد</span>
            <span>فیلتر فروشگاه</span>
            <span />
          </div>
          <ol className="space-y-2">
            {rows.map((r, i) => {
              const used = r.key ? usage[`${axis}:${r.key}`] ?? 0 : 0;
              const material = MATERIAL_RE.test(r.fa) || MATERIAL_RE.test(r.en);
              return (
                <li key={r.k} data-colour={r.k} className={`border bg-white ${material ? "border-danger/50" : "border-line"}`}>
                  <div className="grid grid-cols-2 items-center gap-3 p-3 sm:grid-cols-[2.5rem_minmax(0,1.3fr)_minmax(0,1fr)_4.5rem_minmax(0,9rem)_10.5rem]">
                    {plating ? (
                      <span className="hidden sm:grid sm:place-items-center">
                        <Swatch value={r.swatch} className="size-6" />
                      </span>
                    ) : (
                      <span className="col-span-2 flex items-center gap-2 sm:col-span-1">
                        <SwatchPicker value={r.swatch} onChange={(s) => patch(r.k, { swatch: s })} presets={false} none={false} hex={false} label={`رنگ نشانگر ${r.fa || "رنگ تازه"}`} />
                        <span className="text-xs text-muted sm:hidden">رنگ نشانگر</span>
                      </span>
                    )}
                    <Cell label="نام فارسی">
                      <Input value={r.fa} onChange={(e) => patch(r.k, { fa: e.target.value })} maxLength={40} placeholder={plating ? "مثلاً طلایی" : axis === "stone" ? "مثلاً سفید" : "مثلاً مشکی"} {...(r.fa ? {} : { "data-first": "" })} />
                    </Cell>
                    <Cell label="نام انگلیسی">
                      <Input value={r.en} onChange={(e) => patch(r.k, { en: e.target.value })} maxLength={40} dir="ltr" placeholder={plating ? "Gold-tone" : axis === "stone" ? "White" : "Black"} />
                    </Cell>
                    <Cell label="کد (برای SKU)">
                      <Input value={r.code} onChange={(e) => patch(r.k, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) })} maxLength={4} dir="ltr" className="font-mono uppercase" placeholder="GT" title="پسوند کد کالا، مثلاً CL-NEG-BG-001-GT" />
                    </Cell>
                    <Cell label="فیلتر فروشگاه">
                      <Select value={r.facet} onChange={(e) => patch(r.k, { facet: e.target.value })}>
                        <option value="">—</option>
                        {facets.values.map((f) => (
                          <option key={f} value={f}>
                            {facets.label[f]}
                          </option>
                        ))}
                      </Select>
                    </Cell>
                    <span className="col-span-2 flex items-center justify-end gap-0.5 sm:col-span-1">
                      {used > 0 && <Badge className="me-1">در {num(used, "fa")} محصول</Badge>}
                      <RowButton icon="chevron-down" label="بالاتر" onClick={() => setRows((xs) => move(xs, i, i - 1))} disabled={i === 0} className="rotate-180" />
                      <RowButton icon="chevron-down" label="پایین‌تر" onClick={() => setRows((xs) => move(xs, i, i + 1))} disabled={i === rows.length - 1} />
                      <RowButton
                        icon="trash"
                        label={used ? `«${r.fa}» در ${num(used, "fa")} محصول به کار رفته است؛ اول آن را از گزینه‌های آن‌ها بردارید` : `حذف ${r.fa || "رنگ"}`}
                        onClick={() => setRows((xs) => xs.filter((x) => x.k !== r.k))}
                        disabled={used > 0}
                        className="hover:text-danger!"
                      />
                    </span>
                    {plating && (
                      <div className="col-span-2 sm:col-span-full">
                        <span className="mb-1 block text-xs text-muted">رنگ نشانگر</span>
                        <SwatchPicker value={r.swatch} onChange={(s) => patch(r.k, { swatch: s })} none={false} label={`رنگ نشانگر ${r.fa || "رنگ تازه"}`} />
                      </div>
                    )}
                    {material && <p className="col-span-2 text-xs text-danger sm:col-span-full">نام جنس نگین در نام رنگ‌ها نمی‌آید؛ رنگ را با نام رنگ بنویسید.</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <Button variant="secondary" size="sm" icon="plus" className="mt-3 h-10 sm:h-8" onClick={add} disabled={rows.length >= MAX_VALUES}>
        رنگ تازه
      </Button>
    </fieldset>
  );
}

function RowButton({ icon, label, onClick, disabled, className = "" }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean; className?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className={`grid size-10 place-items-center text-muted transition-colors hover:text-ink disabled:text-line-strong sm:size-8 ${className}`}>
      <Icon name={icon} className="size-4" />
    </button>
  );
}
