"use client";

import { useMemo, useState } from "react";
import { adminAdoptSeedImage, adminUpdateMedia } from "@/app/actions/admin-catalog";
import { adminResetSlot, adminSaveSlot } from "@/app/actions/admin";
import type { SlotDef } from "@/content/slots";
import type { SlotMap } from "@/lib/slot-types";
import type { Media } from "@/lib/media";
import type { Video } from "@/lib/video";
import type { Result } from "@/lib/action";
import { num } from "@/lib/format";
import { Badge, Button, ConfirmButton, Dialog, Input, Textarea } from "@/components/admin/ui";
import { useAction } from "@/components/admin/toast";
import { FocalPointEditor } from "@/components/admin/focal-point";
import { ImageDropzone } from "@/components/admin/image-dropzone";
import { MediaEditDialog } from "@/components/admin/media-edit";
import { MediaPicker } from "@/components/admin/media-picker";
import { SlotVideoField } from "@/components/admin/video-upload";
import { Icon } from "@/components/ui/icons";
import { Picture } from "@/components/ui/picture";

/**
 * Admin → تصاویر سایت: every design picture of the site (a "slot") at the shape it is shown in, grouped by
 * page. A slot keeps its built-in picture until another one is chosen; the focal point is stored on the
 * picture itself (a built-in picture is first copied into the library for that).
 */

export type SlotInfo = Pick<SlotDef, "key" | "page" | "section" | "ratio" | "mobileRatio" | "mobile" | "video" | "hint" | "image" | "texts">;

const cssRatio = (r: string) => r.replace(":", "/");
const shapeOf = (r: string) => {
  const [w, h] = r.split(":").map(Number);
  return w === h ? "مربع" : w < h ? "عمودی" : "افقی";
};
const shapeLabel = (r: string) => `${shapeOf(r)} ${num(r, "fa")}`;

interface Draft {
  key: string;
  /** null = the built-in picture */
  media: Media | null;
  mobile: Media | null;
  /** slots with `video: true` only */
  video: Video | null;
  texts: Record<string, { fa: string; en: string }>;
  fx: number;
  fy: number;
}

export function SlotsBoard({ defs, slots, defaults }: { defs: SlotInfo[]; slots: SlotMap; defaults: Record<string, Media> }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picker, setPicker] = useState<"main" | "mobile" | null>(null);
  const [mobileFocal, setMobileFocal] = useState(false);

  const groups = useMemo(() => {
    const out: { page: string; items: SlotInfo[] }[] = [];
    for (const d of defs) {
      const g = out.find((x) => x.page === d.page);
      if (g) g.items.push(d);
      else out.push({ page: d.page, items: [d] });
    }
    return out;
  }, [defs]);

  const openSlot = (d: SlotInfo) => {
    const r = slots[d.key];
    const chosen = r?.media?.id ? r.media : null;
    const shown = chosen ?? defaults[d.key];
    setDraft({
      key: d.key,
      media: chosen,
      mobile: r?.mobile ?? null,
      video: r?.video ?? null,
      texts: Object.fromEntries(d.texts.map((t) => [t.key, { fa: r?.texts[t.key]?.fa ?? t.fa, en: r?.texts[t.key]?.en ?? t.en }])),
      fx: shown.fx,
      fy: shown.fy,
    });
  };
  const def = draft ? defs.find((d) => d.key === draft.key) ?? null : null;
  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const choose = (m: Media) => patch({ media: m, fx: m.fx, fy: m.fy });

  return (
    <>
      <div className="space-y-10">
        {groups.map((g) => (
          <section key={g.page}>
            <h2 className="mb-4 flex items-center gap-3 text-base font-medium">
              {g.page}
              <span className="h-px flex-1 bg-line" />
              <span className="text-xs font-normal text-muted">{num(g.items.length, "fa")} تصویر</span>
            </h2>
            <ul className="grid grid-cols-2 items-start gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
              {g.items.map((d) => {
                const r = slots[d.key];
                return (
                  <li key={d.key} data-slot={d.key}>
                    <button type="button" onClick={() => openSlot(d)} className="group block w-full border border-line bg-white text-start transition-colors hover:border-ink">
                      <div className="relative">
                        <Picture media={r?.media ?? defaults[d.key]} ratio={cssRatio(d.ratio)} sizes="(min-width: 1280px) 260px, (min-width: 768px) 30vw, 45vw" alt="" />
                        {r?.custom && (
                          <span className="absolute start-2 top-2">
                            <Badge tone="gold">تغییر داده شده</Badge>
                          </span>
                        )}
                        <span className="absolute end-2 top-2 grid size-8 place-items-center bg-white/90 text-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                          <Icon name="edit" className="size-4" />
                        </span>
                      </div>
                      <div className="space-y-1 p-3">
                        <div className="text-sm leading-6 font-medium">{d.section}</div>
                        <div className="line-clamp-2 text-xs leading-5 text-muted">{d.hint}</div>
                        <div className="flex flex-wrap gap-1 pt-1">
                          <Badge>{shapeLabel(d.ratio)}</Badge>
                          {d.mobileRatio && <Badge>موبایل {num(d.mobileRatio, "fa")}</Badge>}
                          {r?.mobile && <Badge tone="gold">عکس موبایل جدا</Badge>}
                          {r?.video && <Badge tone="gold">ویدئو</Badge>}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <Dialog open={Boolean(draft && def)} onClose={() => setDraft(null)} title={def ? def.section : ""} side>
        {draft && def && (
          <SlotForm
            def={def}
            draft={draft}
            patch={patch}
            choose={choose}
            fallback={defaults[def.key]}
            custom={Boolean(slots[def.key]?.custom)}
            onPick={(target) => setPicker(target)}
            onMobileFocal={() => setMobileFocal(true)}
            onDone={() => setDraft(null)}
          />
        )}
      </Dialog>
      {/* siblings of the sheet: a <dialog> inside the sheet would hand its close event to the sheet too */}
      <MediaPicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        title={picker === "mobile" ? "تصویر موبایل از کتابخانه" : "انتخاب از کتابخانه"}
        exclude={picker === "mobile" ? (draft?.mobile?.id ? [draft.mobile.id] : []) : draft?.media?.id ? [draft.media.id] : []}
        onPick={([m]) => {
          if (!m) return;
          if (picker === "mobile") patch({ mobile: m });
          else choose(m);
        }}
      />
      <MediaEditDialog media={mobileFocal ? draft?.mobile ?? null : null} open={mobileFocal} onClose={() => setMobileFocal(false)} title="تصویر موبایل" onSaved={(m) => patch({ mobile: m })} />
    </>
  );
}

function SlotForm({
  def,
  draft,
  patch,
  choose,
  fallback,
  custom,
  onPick,
  onMobileFocal,
  onDone,
}: {
  def: SlotInfo;
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  choose: (m: Media) => void;
  fallback: Media;
  custom: boolean;
  onPick: (target: "main" | "mobile") => void;
  onMobileFocal: () => void;
  onDone: () => void;
}) {
  const [focalOpen, setFocalOpen] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const adopt = useAction();
  const save = useAction();
  const reset = useAction();
  const base = draft.media ?? fallback;
  const shown: Media = { ...base, fx: draft.fx, fy: draft.fy };
  const focalChanged = Boolean(draft.media?.id) && (draft.fx !== draft.media!.fx || draft.fy !== draft.media!.fy);
  const mobileRatio = def.mobileRatio ?? def.ratio;
  const showMobile = Boolean(def.mobileRatio || def.mobile);

  const openFocal = () => {
    if (draft.media?.id) return setFocalOpen(true);
    // a built-in picture gets a library row first, so its focal point can be stored
    adopt.run(() => adminAdoptSeedImage({ key: def.image }), {
      silent: true,
      onOk: (r) => {
        choose(r.media);
        setFocalOpen(true);
      },
    });
  };

  const onSave = () =>
    save.run(
      async (): Promise<Result> => {
        if (focalChanged && draft.media?.id) {
          const r = await adminUpdateMedia({ id: draft.media.id, focal_x: draft.fx, focal_y: draft.fy });
          if (!r.ok) return r;
        }
        return adminSaveSlot({ key: def.key, media_id: draft.media?.id ?? null, media_mobile_id: draft.mobile?.id ?? null, ...(def.video ? { video_id: draft.video?.id ?? null } : {}), texts: draft.texts });
      },
      { onOk: onDone },
    );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span>{def.page}</span>
          <span aria-hidden>·</span>
          <span>قاب {shapeLabel(def.ratio)}</span>
          {def.mobileRatio && <span>· موبایل {num(def.mobileRatio, "fa")}</span>}
        </div>
        <p className="flex items-start gap-2 bg-bone px-3 py-2.5 text-xs leading-6 text-ink-2">
          <Icon name="info" className="mt-1 size-4 shrink-0 text-gold" />
          <span>
            <span className="font-medium">بهترین عکس: </span>
            {def.hint}
          </span>
        </p>
      </div>

      {/* previews at the real shapes */}
      <div className={`grid items-end gap-3 ${showMobile ? "grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : "grid-cols-1"}`}>
        <figure className={showMobile ? "" : "mx-auto w-full max-w-[360px]"}>
          <Picture media={shown} ratio={cssRatio(def.ratio)} sizes="320px" alt="" className="border border-line" />
          <figcaption className="mt-1.5 text-center text-[11px] text-muted">دسکتاپ · {num(def.ratio, "fa")}</figcaption>
        </figure>
        {showMobile && (
          <figure>
            <Picture media={draft.mobile ?? shown} ratio={cssRatio(mobileRatio)} sizes="220px" alt="" className="border border-line" />
            <figcaption className="mt-1.5 text-center text-[11px] text-muted">موبایل · {num(mobileRatio, "fa")}</figcaption>
          </figure>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-ink-2">{draft.media ? "تصویر انتخابی شما" : "تصویر پیش‌فرض سایت"}</span>
          {draft.media && (
            <button type="button" onClick={() => patch({ media: null, fx: fallback.fx, fy: fallback.fy })} className="h-8 px-1 text-muted underline-offset-4 hover:text-ink hover:underline">
              برگرداندن تصویر پیش‌فرض
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <ImageDropzone compact multiple={false} label="بارگذاری تصویر تازه" onUploaded={choose} />
          <Button variant="secondary" icon="image" onClick={() => onPick("main")}>
            انتخاب از کتابخانه
          </Button>
          <Button variant="ghost" icon="eye" pending={adopt.pending} onClick={() => (focalOpen ? setFocalOpen(false) : openFocal())} aria-expanded={focalOpen}>
            نقطه‌ی کانونی
          </Button>
        </div>
        {focalOpen && draft.media && (
          <div className="border border-line bg-white p-3">
            <FocalPointEditor media={draft.media} fx={draft.fx} fy={draft.fy} onChange={(fx, fy) => patch({ fx, fy })} maxHeight="min(40vh, 360px)" />
            <p className="mt-3 text-xs leading-5 text-muted">نقطه‌ی کانونی روی خود تصویر ذخیره می‌شود و هر جا این تصویر استفاده شده باشد اعمال می‌شود.</p>
          </div>
        )}
      </div>

      {def.mobile && (
        <div className="space-y-3 border-t border-line pt-5">
          <div>
            <div className="text-sm font-medium">تصویر جداگانه برای موبایل</div>
            <p className="mt-0.5 text-xs leading-5 text-muted">اختیاری؛ اگر خالی بماند همان تصویر بالا در قاب {num(mobileRatio, "fa")} نمایش داده می‌شود.</p>
          </div>
          <div className="flex items-start gap-3">
            {draft.mobile ? (
              <Picture media={draft.mobile} ratio={cssRatio(mobileRatio)} sizes="96px" alt="" className="w-20 shrink-0 border border-line" />
            ) : (
              <div className="grid w-20 shrink-0 place-items-center border border-dashed border-line-strong bg-ground text-faint" style={{ aspectRatio: cssRatio(mobileRatio) }}>
                <Icon name="phone" className="size-5" />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <ImageDropzone compact multiple={false} label="بارگذاری" onUploaded={(m) => patch({ mobile: m })} />
              <Button variant="secondary" icon="image" onClick={() => onPick("mobile")}>
                از کتابخانه
              </Button>
              {draft.mobile && (
                <>
                  <Button variant="ghost" icon="eye" onClick={onMobileFocal}>
                    نقطه‌ی کانونی
                  </Button>
                  <Button variant="ghost" icon="close" onClick={() => patch({ mobile: null })}>
                    حذف
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {def.video && <SlotVideoField video={draft.video} poster={shown} ratio={cssRatio(def.ratio)} onChange={(video) => patch({ video })} onBusy={setVideoBusy} />}

      {def.texts.length > 0 && (
        <div className="space-y-4 border-t border-line pt-5">
          <div className="text-sm font-medium">متن‌های این بخش</div>
          {def.texts.map((t) => {
            const v = draft.texts[t.key] ?? { fa: "", en: "" };
            const put = (lang: "fa" | "en", value: string) => patch({ texts: { ...draft.texts, [t.key]: { ...v, [lang]: value } } });
            const link = t.key === "href";
            return (
              <fieldset key={t.key} className="space-y-2">
                <legend className="mb-1.5 text-xs font-medium text-ink-2">{t.label}</legend>
                {link ? (
                  <Input value={v.fa} dir="ltr" maxLength={600} placeholder="/collections/yas" onChange={(e) => patch({ texts: { ...draft.texts, [t.key]: { fa: e.target.value, en: e.target.value } } })} aria-label={t.label} />
                ) : t.multiline ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Textarea value={v.fa} maxLength={600} rows={3} placeholder="فارسی" aria-label={`${t.label} (فارسی)`} onChange={(e) => put("fa", e.target.value)} />
                    <Textarea value={v.en} maxLength={600} rows={3} placeholder="English" aria-label={`${t.label} (انگلیسی)`} dir="ltr" onChange={(e) => put("en", e.target.value)} />
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input value={v.fa} maxLength={600} placeholder="فارسی" aria-label={`${t.label} (فارسی)`} onChange={(e) => put("fa", e.target.value)} />
                    <Input value={v.en} maxLength={600} placeholder="English" aria-label={`${t.label} (انگلیسی)`} dir="ltr" onChange={(e) => put("en", e.target.value)} />
                  </div>
                )}
              </fieldset>
            );
          })}
        </div>
      )}

      <div className="sticky -bottom-5 z-10 -mx-5 -mb-5 flex flex-wrap items-center justify-between gap-2 border-t border-line bg-white px-5 py-3">
        {custom ? (
          <ConfirmButton size="md" variant="secondary" icon="refresh" pending={reset.pending} confirmLabel="تصویر و متن پیش‌فرض؟ دوباره بزنید" onConfirm={() => reset.run(() => adminResetSlot({ key: def.key }), { onOk: onDone })}>
            بازگشت به پیش‌فرض
          </ConfirmButton>
        ) : (
          <span className="text-xs text-muted">هنوز پیش‌فرض است</span>
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onDone}>
            انصراف
          </Button>
          <Button icon="check" pending={save.pending} disabled={videoBusy} onClick={onSave}>
            ذخیره
          </Button>
        </div>
      </div>
    </div>
  );
}
