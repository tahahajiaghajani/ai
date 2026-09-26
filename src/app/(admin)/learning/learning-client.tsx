"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Brain, CheckCircle2, History, Sparkles, ThumbsDown, ThumbsUp, Wand2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, Textarea } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { activatePromptAction, runOptimizerAction, savePromptVersionAction } from "@/app/actions/admin";
import { timeAgo } from "@/lib/jalali";
import { cn, faNum } from "@/lib/utils";

interface Version {
  id: string;
  agent: string;
  version: number;
  content: string;
  is_active: boolean;
  source: string;
  rationale: string | null;
  created_at: string;
}

export function LearningClient({
  agents,
  versions,
  feedback,
  knowledgeCount,
  initialAgent,
}: {
  agents: { key: string; label: string; defaultPrompt: string }[];
  initialAgent?: string;
  versions: Version[];
  feedback: { agent: string; rating: number; comment: string | null; created_at: string }[];
  knowledgeCount: number;
}) {
  const router = useRouter();
  const [agent, setAgent] = React.useState<string>(agents.some((a) => a.key === initialAgent) ? initialAgent! : agents[0].key);
  const current = agents.find((a) => a.key === agent)!;
  const list = versions.filter((v) => v.agent === agent);
  const active = list.find((v) => v.is_active);
  const [draft, setDraft] = React.useState(active?.content ?? current.defaultPrompt);
  const [viewing, setViewing] = React.useState<Version | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setDraft((versions.find((v) => v.agent === agent && v.is_active)?.content ?? agents.find((a) => a.key === agent)?.defaultPrompt) || "");
  }, [agent, versions, agents]);

  const fb = feedback.filter((f) => f.agent === agent);
  const pos = feedback.filter((f) => f.rating > 0).length;
  const neg = feedback.filter((f) => f.rating < 0).length;
  const aiPending = versions.filter((v) => v.source === "ai" && !v.is_active);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">یادگیری و بهبود مستمر</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            سیستم از سه راه یاد می‌گیرد: (۱) پایگاه دانش که با هر تسک بزرگ‌تر می‌شود ({faNum(knowledgeCount)} قطعه)، (۲) بازخورد شما روی خروجی ایجنت‌ها، (۳) بهینه‌ساز که با تحلیل بازخوردها نسخه‌ی بهتر پرامپت‌ها را پیشنهاد می‌دهد.
          </p>
        </div>
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            const r = await runOptimizerAction([]);
            setBusy(false);
            if (r.ok) toast.success("بهینه‌ساز در صف Gemini قرار گرفت؛ پیشنهادها در همین صفحه ظاهر می‌شوند");
            else toast.error(r.error);
          }}
        >
          <Wand2 className="size-4" /> اجرای بهینه‌ساز پرامپت‌ها
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted">بازخورد مثبت</p>
          <p className="mt-1 flex items-center gap-2 text-2xl font-black text-success">
            <ThumbsUp className="size-5" /> {faNum(pos)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">بازخورد منفی</p>
          <p className="mt-1 flex items-center gap-2 text-2xl font-black text-danger">
            <ThumbsDown className="size-5" /> {faNum(neg)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">پیشنهادهای بهینه‌ساز</p>
          <p className="mt-1 flex items-center gap-2 text-2xl font-black text-primary">
            <Sparkles className="size-5" /> {faNum(aiPending.length)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">قطعات دانش</p>
          <p className="mt-1 flex items-center gap-2 text-2xl font-black">
            <Brain className="size-5" /> {faNum(knowledgeCount)}
          </p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="h-fit p-2">
          {agents.map((a) => {
            const hasAi = versions.some((v) => v.agent === a.key && v.source === "ai" && !v.is_active);
            return (
              <button
                key={a.key}
                onClick={() => setAgent(a.key)}
                className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-start text-sm font-semibold", agent === a.key ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-muted")}
              >
                <span className="flex-1">{a.label}</span>
                {hasAi ? <span className="size-2 rounded-full bg-primary" /> : null}
              </button>
            );
          })}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title={current.label}
              subtitle={active ? `نسخه‌ی فعال: ${faNum(active.version)} (${active.source === "ai" ? "پیشنهاد هوش مصنوعی" : active.source === "human" ? "ویرایش شما" : "پیش‌فرض"})` : "پرامپت پیش‌فرض سیستم فعال است"}
              icon={<Brain className="size-4" />}
            />
            <div className="p-5">
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[360px] font-mono text-[12.5px] leading-7" dir="auto" />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  onClick={async () => {
                    const r = await savePromptVersionAction(agent, draft, true);
                    if (r.ok) {
                      toast.success(`نسخه‌ی ${faNum(r.data.version)} ذخیره و فعال شد`);
                      router.refresh();
                    } else toast.error(r.error);
                  }}
                >
                  <CheckCircle2 className="size-4" /> ذخیره و فعال‌سازی
                </Button>
                <Button variant="ghost" onClick={() => setDraft(current.defaultPrompt)}>
                  بازگشت به پیش‌فرض
                </Button>
                {active ? (
                  <Button variant="ghost" onClick={async () => { await activatePromptAction(agent, null); toast.success("پرامپت پیش‌فرض فعال شد"); router.refresh(); }}>
                    غیرفعال کردن نسخه‌ها
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="نسخه‌ها" icon={<History className="size-4" />} />
            <div className="divide-y divide-line">
              {list.length === 0 ? <p className="px-5 py-6 text-sm text-muted">هنوز نسخه‌ای ثبت نشده است.</p> : null}
              {list.map((v) => (
                <div key={v.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
                  <span className="font-black">v{faNum(v.version)}</span>
                  <Badge tone={v.source === "ai" ? "violet" : v.source === "human" ? "info" : "neutral"}>{v.source === "ai" ? "پیشنهاد AI" : v.source === "human" ? "دستی" : "پیش‌فرض"}</Badge>
                  {v.is_active ? <Badge tone="success" dot>فعال</Badge> : null}
                  <span className="text-xs text-muted">{timeAgo(v.created_at)}</span>
                  <div className="ms-auto flex gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setViewing(v)}>
                      مشاهده
                    </Button>
                    {!v.is_active ? (
                      <Button size="sm" variant="secondary" onClick={async () => { await activatePromptAction(agent, v.version); toast.success("فعال شد"); router.refresh(); }}>
                        فعال‌سازی
                      </Button>
                    ) : null}
                  </div>
                  {v.rationale ? <p className="w-full whitespace-pre-line text-xs text-muted">{v.rationale}</p> : null}
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="بازخوردهای این ایجنت" />
            <div className="max-h-72 divide-y divide-line overflow-y-auto">
              {fb.length === 0 ? <p className="px-5 py-6 text-sm text-muted">از صفحه‌ی هر تسک، زیر خروجی ایجنت‌ها بازخورد بدهید.</p> : null}
              {fb.map((f, i) => (
                <p key={i} className="px-5 py-2.5 text-sm">
                  {f.rating > 0 ? "👍" : "👎"} {f.comment || "بدون توضیح"} <span className="text-xs text-faint">· {timeAgo(f.created_at)}</span>
                </p>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Modal open={!!viewing} onOpenChange={(o) => !o && setViewing(null)} title={`نسخه‌ی ${faNum(viewing?.version ?? 0)}`} size="lg">
        <pre className="whitespace-pre-wrap text-[12.5px] leading-7" dir="auto">
          {viewing?.content}
        </pre>
      </Modal>
    </div>
  );
}
