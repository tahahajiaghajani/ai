"use client";
import * as React from "react";
import { toast } from "sonner";
import { Megaphone } from "lucide-react";
import { PageHeader, SECTIONS } from "@/components/shell/page-header";
import { AnnouncementBanner } from "@/components/shell/shell-parts";
import { Button, Card, Field, Input, Switch, Textarea } from "@/components/ui/primitives";
import { saveBannerAction } from "@/app/actions/owner";
import { timeAgo } from "@/lib/jalali";
import { cn, faNum } from "@/lib/utils";
import type { Banner, BannerTone } from "@/lib/banner";

const TONES: { key: BannerTone; label: string; swatch: string }[] = [
  { key: "brand", label: "آبی", swatch: "bg-flow" },
  { key: "gold", label: "طلایی", swatch: "bg-gold" },
  { key: "success", label: "سبز", swatch: "bg-success" },
  { key: "warning", label: "نارنجی", swatch: "bg-warning" },
];
const MAX = 280;

/** The owner writes today's message; everyone sees it at the top of the app. */
export function BannerEditor({ initial }: { initial: Banner | null }) {
  const [text, setText] = React.useState(initial?.text ?? "");
  const [link, setLink] = React.useState(initial?.link ?? "");
  const [tone, setTone] = React.useState<BannerTone>(initial?.tone ?? "brand");
  const [active, setActive] = React.useState(initial?.active ?? true);
  const [busy, setBusy] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState(initial?.updated_at ?? null);

  const save = async () => {
    setBusy(true);
    const r = await saveBannerAction({ text, link, tone, active });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    setSavedAt(r.data.updated_at);
    toast.success(r.data.active ? "اطلاعیه برای همه منتشر شد" : "اطلاعیه پنهان شد");
  };

  return (
    <div className="space-y-5">
      <PageHeader title="مدیریت" tabs={SECTIONS.admin} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="space-y-4 p-5">
          <p className="flex items-center gap-2 font-extrabold">
            <Megaphone className="size-4 text-primary" /> اطلاعیه برای همه
          </p>
          <Field label="متن" hint={`${faNum(text.length)} / ${faNum(MAX)}`}>
            <Textarea value={text} maxLength={MAX} onChange={(e) => setText(e.target.value)} className="min-h-28" placeholder="مثلاً: جلسه‌ی هفتگی امروز ساعت ۱۶" />
          </Field>
          <Field label="لینک (اختیاری)">
            <Input dir="ltr" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://… یا /help" />
          </Field>
          <div className="space-y-1.5">
            <span className="text-[13px] font-semibold">رنگ</span>
            <div className="flex gap-2">
              {TONES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTone(t.key)}
                  aria-pressed={tone === t.key}
                  className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition", tone === t.key ? "border-primary bg-primary-soft text-primary" : "border-line text-muted hover:bg-surface-muted")}
                >
                  <span className={cn("size-3 rounded-full", t.swatch)} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <Switch checked={active} onChange={setActive} label="نمایش به همه" />
            <Button onClick={save} loading={busy} disabled={active && !text.trim()}>
              ذخیره
            </Button>
          </div>
        </Card>

        <div className="space-y-2">
          <p className="text-xs font-bold text-muted">پیش‌نمایش</p>
          {text.trim() ? (
            <div className={cn(!active && "opacity-40")}>
              <AnnouncementBanner text={text} link={link || null} tone={tone} version="preview" preview />
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-line px-4 py-3 text-sm text-faint">—</div>
          )}
          {savedAt ? (
            <p className="text-xs text-faint" suppressHydrationWarning>
              آخرین ذخیره: {timeAgo(savedAt)}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
