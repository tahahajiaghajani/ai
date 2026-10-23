"use client";

import { useEffect, useState } from "react";
import { adminDeleteTaxon, adminReorderTaxa, adminSaveTaxon } from "@/app/actions/admin-catalog";
import type { Taxon, TaxonKind } from "@/lib/admin-catalog";
import type { Media } from "@/lib/media";
import { num } from "@/lib/format";
import { Badge, Button, ConfirmButton, Dialog, Empty, Field, Input, PageHeader, Spinner, Tabs, Textarea, Toggle } from "@/components/admin/ui";
import { toast, useAction } from "@/components/admin/toast";
import { SLUG_RE, slugify } from "@/components/admin/catalog-labels";
import { ImageDropzone } from "@/components/admin/image-dropzone";
import { MediaEditDialog } from "@/components/admin/media-edit";
import { MediaPicker } from "@/components/admin/media-picker";
import { Icon } from "@/components/ui/icons";
import { Picture } from "@/components/ui/picture";

/** Admin → دسته‌ها و مجموعه‌ها: one list per kind with visibility, order and a side sheet for editing. */

const WORDS: Record<TaxonKind, { one: string; fresh: string; empty: string; gone: string; hidden: string }> = {
  categories: { one: "دسته", fresh: "دسته‌ی تازه", empty: "هنوز دسته‌ای ساخته نشده است.", gone: "محصولات این دسته حذف نمی‌شوند؛ فقط بدون دسته می‌مانند.", hidden: "دسته‌ی پنهان در منو و فروشگاه دیده نمی‌شود." },
  collections: { one: "مجموعه", fresh: "مجموعه‌ی تازه", empty: "هنوز مجموعه‌ای ساخته نشده است.", gone: "محصولات این مجموعه حذف نمی‌شوند؛ فقط بدون مجموعه می‌مانند.", hidden: "مجموعه‌ی پنهان در سایت دیده نمی‌شود." },
};

type Draft = Omit<Taxon, "id" | "sort"> & { id: string | null; sort: number };

const blank = (sort: number): Draft => ({ id: null, slug: "", name_fa: "", name_en: "", description_fa: "", description_en: "", tagline_fa: "", tagline_en: "", story_fa: "", story_en: "", media_id: null, sort, visible: true });

export function TaxaManager({ kind, items, media: initialMedia, counts, totals }: { kind: TaxonKind; items: Taxon[]; media: Record<string, Media>; counts: Record<string, number>; totals: Record<TaxonKind, number> }) {
  const w = WORDS[kind];
  const [list, setList] = useState(items);
  useEffect(() => setList(items), [items]);
  const [media, setMedia] = useState(initialMedia);
  useEffect(() => setMedia((m) => ({ ...m, ...initialMedia })), [initialMedia]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picker, setPicker] = useState(false);
  const [focal, setFocal] = useState(false);
  const order = useAction();

  const putMedia = (m: Media) => m.id && setMedia((x) => ({ ...x, [m.id!]: m }));
  const moveTo = (i: number, to: number) => {
    if (to < 0 || to >= list.length) return;
    const next = [...list];
    const [x] = next.splice(i, 1);
    next.splice(to, 0, x);
    setList(next);
    order.run(() => adminReorderTaxa({ kind, ids: next.map((t) => t.id) }), { onError: () => setList(items) });
  };
  const draftMedia = draft?.media_id ? media[draft.media_id] ?? null : null;

  return (
    <>
      <PageHeader
        title="دسته‌ها و مجموعه‌ها"
        actions={
          <Button icon="plus" onClick={() => setDraft(blank(list.length ? Math.max(...list.map((t) => t.sort)) + 1 : 0))}>
            {w.fresh}
          </Button>
        }
      />
      <Tabs
        active={kind}
        items={[
          { key: "categories", label: "دسته‌ها", href: "/admin/catalog?tab=categories", count: totals.categories },
          { key: "collections", label: "مجموعه‌ها", href: "/admin/catalog?tab=collections", count: totals.collections },
        ]}
      />
      {list.length === 0 ? (
        <Empty title={w.empty} action={<Button icon="plus" onClick={() => setDraft(blank(0))}>{w.fresh}</Button>} />
      ) : (
        <div className="border border-line bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-line bg-ground px-4 py-2.5 text-xs text-muted">
            <span>
              {num(list.length, "fa")} {w.one} · ترتیب این فهرست، ترتیب نمایش در سایت است
            </span>
            {order.pending && <Spinner className="size-3.5" />}
          </div>
          <ul className="divide-y divide-line">
            {list.map((t, i) => (
              <TaxonRow
                key={t.id}
                t={t}
                kind={kind}
                media={t.media_id ? media[t.media_id] : undefined}
                count={counts[t.id] ?? 0}
                first={i === 0}
                last={i === list.length - 1}
                busy={order.pending}
                onUp={() => moveTo(i, i - 1)}
                onDown={() => moveTo(i, i + 1)}
                onEdit={() => setDraft({ ...t })}
              />
            ))}
          </ul>
        </div>
      )}

      <Dialog open={Boolean(draft)} onClose={() => setDraft(null)} title={draft?.id ? `ویرایش ${w.one}` : w.fresh} side>
        {draft && <TaxonForm key={draft.id ?? "new"} kind={kind} draft={draft} setDraft={(fn) => setDraft((d) => (d ? fn(d) : d))} media={draftMedia} onPick={() => setPicker(true)} onFocal={() => setFocal(true)} onUploaded={putMedia} onDone={() => setDraft(null)} count={draft.id ? counts[draft.id] ?? 0 : 0} />}
      </Dialog>
      {/* siblings of the sheet, not inside it: nested <dialog>s would pass their close event up to the sheet */}
      <MediaPicker
        open={picker}
        onClose={() => setPicker(false)}
        alt={{ fa: draft?.name_fa, en: draft?.name_en }}
        onPick={([m]) => {
          if (!m?.id) return;
          putMedia(m);
          setDraft((d) => (d ? { ...d, media_id: m.id! } : d));
        }}
      />
      <MediaEditDialog media={focal ? draftMedia : null} open={focal} onClose={() => setFocal(false)} onSaved={putMedia} />
    </>
  );
}

function TaxonRow({
  t,
  kind,
  media,
  count,
  first,
  last,
  busy,
  onUp,
  onDown,
  onEdit,
}: {
  t: Taxon;
  kind: TaxonKind;
  media?: Media;
  count: number;
  first: boolean;
  last: boolean;
  busy: boolean;
  onUp: () => void;
  onDown: () => void;
  onEdit: () => void;
}) {
  const vis = useAction();
  const toggle = () => vis.run(() => adminSaveTaxon({ kind, ...t, visible: !t.visible }), { silent: true, onOk: () => toast(true, t.visible ? "از سایت پنهان شد." : "در سایت نمایش داده می‌شود.") });
  return (
    <li data-taxon={t.slug} className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[56px_minmax(0,1fr)_auto]">
      <button type="button" onClick={onEdit} className="row-span-2 self-start sm:row-span-1 sm:self-center" tabIndex={-1} aria-hidden>
        <Picture media={media} ratio="1/1" sizes="56px" alt="" className={`w-14 border border-line ${t.visible ? "" : "opacity-50"}`} />
      </button>
      <div className="min-w-0">
        <button type="button" onClick={onEdit} className="flex max-w-full items-center gap-2 text-start text-sm font-medium hover:text-gold-text">
          <span className="truncate">{t.name_fa}</span>
          {!t.visible && <Badge>پنهان</Badge>}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
          {t.name_en && <span className="ltr">{t.name_en}</span>}
          <span className="ltr font-mono text-[11px] text-faint">{t.slug}</span>
          <span>{count ? `${num(count, "fa")} محصول` : "بدون محصول"}</span>
        </div>
      </div>
      <div className="flex items-center gap-1 sm:justify-end">
        <button
          type="button"
          role="switch"
          aria-checked={t.visible}
          onClick={toggle}
          disabled={vis.pending}
          className="inline-flex h-10 items-center gap-2 rounded-sm px-2 text-xs text-ink-2 hover:bg-bone disabled:opacity-60"
          title={t.visible ? "در سایت نمایش داده می‌شود" : "در سایت پنهان است"}
        >
          <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${t.visible ? "bg-ink" : "bg-line-strong"}`}>
            <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${t.visible ? "start-[18px]" : "start-0.5"}`} />
          </span>
          نمایش
        </button>
        <span className="mx-1 h-6 w-px bg-line" />
        <IconBtn label="بالاتر" onClick={onUp} disabled={first || busy} rotate />
        <IconBtn label="پایین‌تر" onClick={onDown} disabled={last || busy} />
        <Button variant="secondary" size="sm" icon="edit" className="ms-1 h-10 sm:h-8" onClick={onEdit}>
          ویرایش
        </Button>
      </div>
    </li>
  );
}

function IconBtn({ label, onClick, disabled, rotate }: { label: string; onClick: () => void; disabled?: boolean; rotate?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="grid size-10 place-items-center rounded-sm text-muted transition-colors hover:bg-bone hover:text-ink disabled:text-line-strong disabled:hover:bg-transparent">
      <Icon name="chevron-down" className={`size-4 ${rotate ? "rotate-180" : ""}`} />
    </button>
  );
}

function TaxonForm({
  kind,
  draft,
  setDraft,
  media,
  onPick,
  onFocal,
  onUploaded,
  onDone,
  count,
}: {
  kind: TaxonKind;
  draft: Draft;
  setDraft: (fn: (d: Draft) => Draft) => void;
  media: Media | null;
  onPick: () => void;
  onFocal: () => void;
  onUploaded: (m: Media) => void;
  onDone: () => void;
  count: number;
}) {
  const w = WORDS[kind];
  const [slugTouched, setSlugTouched] = useState(Boolean(draft.id));
  const [err, setErr] = useState<{ name_fa?: string; slug?: string }>({});
  const save = useAction();
  const del = useAction();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = () => {
    const e: typeof err = {};
    if (!draft.name_fa.trim()) e.name_fa = "نام فارسی را بنویسید.";
    const slug = draft.slug.trim() || slugify(draft.name_en);
    if (!slug) e.slug = "نشانی را بنویسید (یا نام انگلیسی را پر کنید).";
    else if (!SLUG_RE.test(slug)) e.slug = "فقط حروف کوچک انگلیسی، عدد و خط تیره.";
    setErr(e);
    const first = Object.values(e)[0];
    if (first) return toast(false, first);
    const { id, ...rest } = draft;
    save.run(() => adminSaveTaxon({ kind, ...(id ? { id } : {}), ...rest, slug }), { onOk: onDone });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نام فارسی *" error={err.name_fa}>
          <Input value={draft.name_fa} onChange={(e) => set("name_fa", e.target.value)} maxLength={120} name="name_fa" autoFocus={!draft.id} />
        </Field>
        <Field label="نام انگلیسی">
          <Input
            value={draft.name_en}
            dir="ltr"
            maxLength={120}
            name="name_en"
            onChange={(e) => {
              set("name_en", e.target.value);
              if (!slugTouched) set("slug", slugify(e.target.value));
            }}
          />
        </Field>
      </div>
      <Field label="نشانی در سایت (slug)" error={err.slug} hint={slugTouched ? "فقط حروف کوچک انگلیسی، عدد و خط تیره" : "خودکار از نام انگلیسی ساخته می‌شود"}>
        <Input
          value={draft.slug}
          dir="ltr"
          maxLength={80}
          name="slug"
          placeholder={kind === "categories" ? "rings" : "nour"}
          onChange={(e) => {
            setSlugTouched(true);
            set("slug", e.target.value.toLowerCase().replace(/\s+/g, "-"));
          }}
        />
      </Field>

      {kind === "categories" ? (
        <>
          <Field label="توضیح کوتاه (فارسی)">
            <Textarea value={draft.description_fa} onChange={(e) => set("description_fa", e.target.value)} rows={3} maxLength={600} />
          </Field>
          <Field label="توضیح کوتاه (انگلیسی)">
            <Textarea value={draft.description_en} onChange={(e) => set("description_en", e.target.value)} rows={3} maxLength={600} dir="ltr" />
          </Field>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="جمله‌ی کوتاه (فارسی)">
              <Input value={draft.tagline_fa} onChange={(e) => set("tagline_fa", e.target.value)} maxLength={200} />
            </Field>
            <Field label="جمله‌ی کوتاه (انگلیسی)">
              <Input value={draft.tagline_en} onChange={(e) => set("tagline_en", e.target.value)} maxLength={200} dir="ltr" />
            </Field>
          </div>
          <Field label="داستان مجموعه (فارسی)">
            <Textarea value={draft.story_fa} onChange={(e) => set("story_fa", e.target.value)} rows={5} maxLength={3000} />
          </Field>
          <Field label="داستان مجموعه (انگلیسی)">
            <Textarea value={draft.story_en} onChange={(e) => set("story_en", e.target.value)} rows={5} maxLength={3000} dir="ltr" />
          </Field>
        </>
      )}

      <div>
        <span className="mb-1.5 block text-xs font-medium text-ink-2">تصویر</span>
        <div className="flex gap-4 border border-line bg-white p-3">
          <Picture media={media} ratio="3/4" sizes="120px" alt="" className="w-24 shrink-0 border border-line sm:w-28" />
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
            <Button variant="secondary" size="sm" icon="image" className="h-10 sm:h-8" onClick={onPick}>
              انتخاب از کتابخانه
            </Button>
            <ImageDropzone
              compact
              multiple={false}
              alt={{ fa: draft.name_fa, en: draft.name_en }}
              label="بارگذاری تصویر تازه"
              onUploaded={(m) => {
                onUploaded(m);
                if (m.id) set("media_id", m.id);
              }}
            />
            {media && (
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" icon="eye" className="h-10 sm:h-8" onClick={onFocal}>
                  نقطه‌ی کانونی
                </Button>
                <Button variant="ghost" size="sm" icon="close" className="h-10 sm:h-8" onClick={() => set("media_id", null)}>
                  بدون تصویر
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <Toggle checked={draft.visible} onChange={(v) => set("visible", v)} label="نمایش در سایت" hint={w.hidden} />

      <div className="sticky -bottom-5 z-10 -mx-5 -mb-5 space-y-3 border-t border-line bg-white px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {draft.id ? (
            <ConfirmButton size="md" pending={del.pending} confirmLabel="حذف شود؟ دوباره بزنید" onConfirm={() => del.run(() => adminDeleteTaxon({ kind, id: draft.id }), { onOk: onDone })}>
              حذف {w.one}
            </ConfirmButton>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onDone}>
              انصراف
            </Button>
            <Button icon="check" pending={save.pending} onClick={submit}>
              ذخیره
            </Button>
          </div>
        </div>
        {draft.id && <p className="text-xs leading-5 text-muted">{count ? `${num(count, "fa")} محصول در این ${w.one} است. ` : ""}{w.gone}</p>}
      </div>
    </div>
  );
}
