"use client";
import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Clock, FolderGit2, KeyRound, Plug, RefreshCw, Save, SlidersHorizontal, Timer, XCircle } from "lucide-react";
import { Button, Card, CardHeader, Field, Input, Select, Spinner, Switch, Textarea } from "@/components/ui/primitives";
import { bootstrapWorkspaceAction, configureSchedulerAction, integrationStatusAction, saveSettingsAction, setClaudeTokenAction } from "@/app/actions/admin";
import { cn, faNum } from "@/lib/utils";
import type { AppSettings } from "@/lib/settings";

type Status = Awaited<ReturnType<typeof integrationStatusAction>>;

function Row({ ok, label, detail, level }: { ok: boolean; label: string; detail?: string; level?: "error" | "warning" }) {
  return (
    <div className="flex items-start gap-3 px-5 py-3">
      {ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" /> : level === "warning" ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" /> : <XCircle className="mt-0.5 size-5 shrink-0 text-danger" />}
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        {detail ? <p className="mt-0.5 break-words text-xs text-muted">{detail}</p> : null}
      </div>
    </div>
  );
}

function ChainInput({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <Field label={label} hint="مدل‌ها به ترتیب؛ با پر شدن سهمیه‌ی هر مدل، سیستم خودکار سراغ بعدی می‌رود">
      <Input dir="ltr" value={value.join(", ")} onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
    </Field>
  );
}

export function SettingsClient({ settings: initial, info }: { settings: AppSettings; info: { appUrl: string; workspaceRepo: string; appRepo: string; owner: string; budget: number } }) {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [s, setS] = React.useState<AppSettings>(initial);
  const [schedInterval, setSchedInterval] = React.useState("30 seconds");
  const [claudeToken, setClaudeToken] = React.useState("");
  const [anthropicKey, setAnthropicKey] = React.useState("");
  const [dbUrl, setDbUrl] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setStatus(null);
    setStatus(await integrationStatusAction());
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);

  const doAct = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (r.ok) {
      toast.success(msg);
      void load();
    } else toast.error(r.error ?? "خطا");
  };

  const set = <K extends keyof AppSettings>(k: K, v: Partial<AppSettings[K]>) => setS((prev) => ({ ...prev, [k]: { ...prev[k], ...v } }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black">تنظیمات و اتصال‌ها</h1>
        <p className="mt-1 text-sm text-muted">
          آدرس اپ: <span className="ltr font-mono">{info.appUrl || "—"}</span> · مخزن کاری: <span className="ltr font-mono">{info.owner ? `${info.owner}/` : ""}{info.workspaceRepo}</span>
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="وضعیت اتصال‌ها" icon={<Plug className="size-4" />} actions={<Button size="sm" variant="ghost" onClick={load}><RefreshCw className="size-4" /></Button>} />
          {!status ? (
            <div className="grid place-items-center py-10">
              <Spinner className="size-6" />
            </div>
          ) : status.ok ? (
            <div className="divide-y divide-line">
              {status.data.env.map((e) => (
                <Row key={e.key} ok={e.ok} label={`${e.label} (${e.key})`} detail={e.ok ? undefined : `در Vercel تنظیم کنید — ${e.hint}`} />
              ))}
              {status.data.checks.map((c) => (
                <Row key={c.key} ok={c.ok} label={c.label} detail={c.detail} level={c.level} />
              ))}
            </div>
          ) : (
            <p className="p-5 text-sm text-danger">{status.error}</p>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="۱) فعال‌سازی زمان‌بند و ورکر" subtitle="Supabase (pg_cron) هر چند ثانیه ورکر اپ را روی Vercel صدا می‌زند" icon={<Timer className="size-4" />} />
            <div className="flex flex-wrap items-end gap-3 p-5">
              <Field label="فاصله‌ی اجرا" className="w-48">
                <Select value={schedInterval} onChange={(e) => setSchedInterval(e.target.value)}>
                  <option value="20 seconds">هر ۲۰ ثانیه</option>
                  <option value="30 seconds">هر ۳۰ ثانیه</option>
                  <option value="1 minutes">هر ۱ دقیقه</option>
                  <option value="2 minutes">هر ۲ دقیقه</option>
                </Select>
              </Field>
              <Button loading={busy === "sched"} onClick={() => doAct("sched", () => configureSchedulerAction(schedInterval), "زمان‌بند فعال شد")}>
                <Clock className="size-4" /> فعال‌سازی
              </Button>
              <p className="w-full text-xs text-muted">ورکر در هر اجرا حداکثر {faNum(info.budget)} ثانیه کار می‌کند (محدودیت Vercel رایگان) و تا وقتی کار باقی است خودش را دوباره صدا می‌زند.</p>
            </div>
          </Card>

          <Card>
            <CardHeader title="۲) راه‌اندازی مخزن کاری GitHub" subtitle="ساخت مخزن خصوصی، کپی ورکفلوهای Claude/graphify و تنظیم secrets" icon={<FolderGit2 className="size-4" />} />
            <div className="space-y-3 p-5">
              <p className="text-xs leading-6 text-muted">
                مخزن <b className="ltr">{info.workspaceRepo}</b> (اگر وجود نداشته باشد) ساخته می‌شود؛ خروجی همه‌ی تسک‌ها و پایگاه دانش آنجا ذخیره می‌شود. با هر تغییر در قالب، دوباره این دکمه را بزنید تا همگام شود.
              </p>
              <Button loading={busy === "ws"} onClick={() => doAct("ws", () => bootstrapWorkspaceAction(claudeToken || undefined, anthropicKey || undefined), "مخزن کاری آماده شد")}>
                <FolderGit2 className="size-4" /> راه‌اندازی / همگام‌سازی قالب
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="۳) اتصال Claude" subtitle="توکن مستقیماً و رمزنگاری‌شده در GitHub Secrets ذخیره می‌شود — در دیتابیس اپ ذخیره نمی‌شود" icon={<KeyRound className="size-4" />} />
            <div className="space-y-3 p-5">
              <Field label="CLAUDE_CODE_OAUTH_TOKEN (اشتراک Pro/Max)" hint="در ترمینال: claude setup-token">
                <Input dir="ltr" type="password" value={claudeToken} onChange={(e) => setClaudeToken(e.target.value)} placeholder="sk-ant-oat01-…" />
              </Field>
              <Field label="یا ANTHROPIC_API_KEY (پرداخت به ازای مصرف)">
                <Input dir="ltr" type="password" value={anthropicKey} onChange={(e) => setAnthropicKey(e.target.value)} placeholder="sk-ant-api03-…" />
              </Field>
              <Field label="SUPABASE_DB_URL (اختیاری — برای اعمال خودکار migrationهای ارتقا)" hint="Supabase → Connect → Session pooler">
                <Input dir="ltr" type="password" value={dbUrl} onChange={(e) => setDbUrl(e.target.value)} placeholder="postgresql://postgres.xxxx:password@aws-0-…pooler.supabase.com:5432/postgres" />
              </Field>
              <Button
                loading={busy === "claude"}
                disabled={!claudeToken && !anthropicKey && !dbUrl}
                onClick={() =>
                  doAct("claude", async () => {
                    const r = await setClaudeTokenAction({ claudeToken, anthropicKey, dbUrl });
                    if (r.ok) {
                      setClaudeToken("");
                      setAnthropicKey("");
                      setDbUrl("");
                    }
                    return r;
                  }, "secrets در هر دو مخزن تنظیم شد")
                }
              >
                <Save className="size-4" /> ذخیره در GitHub Secrets
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title="مدل‌ها و ورکفلوی پیش‌کار"
          icon={<SlidersHorizontal className="size-4" />}
          actions={
            <Button size="sm" loading={busy === "save"} onClick={() => doAct("save", () => saveSettingsAction(s), "تنظیمات ذخیره شد")}>
              <Save className="size-4" /> ذخیره
            </Button>
          }
        />
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <ChainInput label="ایجنت تحقیق" value={s.models.research} onChange={(v) => set("models", { research: v })} />
          <ChainInput label="ساختاردهی (WBS)" value={s.models.structure} onChange={(v) => set("models", { structure: v })} />
          <ChainInput label="روش انجام" value={s.models.methods} onChange={(v) => set("models", { methods: v })} />
          <ChainInput label="اجرای کارهای ساده" value={s.models.execute} onChange={(v) => set("models", { execute: v })} />
          <ChainInput label="گزارش" value={s.models.report} onChange={(v) => set("models", { report: v })} />
          <ChainInput label="استخراج دانش" value={s.models.knowledge} onChange={(v) => set("models", { knowledge: v })} />
          <Field label="مدل embedding" hint="تغییر آن نیاز به ساخت دوباره‌ی بردارهای قبلی دارد">
            <Input dir="ltr" value={s.models.embedding} onChange={(e) => set("models", { embedding: e.target.value })} />
          </Field>
          <Field label="سطح تفکر (thinking)">
            <Select value={s.pipeline.thinkingLevel} onChange={(e) => set("pipeline", { thinkingLevel: e.target.value as AppSettings["pipeline"]["thinkingLevel"] })}>
              <option value="LOW">کم (سریع‌تر، مصرف کمتر)</option>
              <option value="MEDIUM">متوسط</option>
              <option value="HIGH">زیاد (دقیق‌تر)</option>
            </Select>
          </Field>
          <Field label="تعداد فعالیت در هر فراخوانی «روش انجام»">
            <Input type="number" min={1} max={12} value={s.pipeline.methodsBatch} onChange={(e) => set("pipeline", { methodsBatch: Number(e.target.value) })} />
          </Field>
          <Field label="تعداد فعالیت در هر فراخوانی «اجرا»">
            <Input type="number" min={1} max={6} value={s.pipeline.executeBatch} onChange={(e) => set("pipeline", { executeBatch: Number(e.target.value) })} />
          </Field>
          <Field label="حداکثر فعالیت‌های اجراشونده در پیش‌کار">
            <Input type="number" min={0} max={80} value={s.pipeline.maxExecuteItems} onChange={(e) => set("pipeline", { maxExecuteItems: Number(e.target.value) })} />
          </Field>
          <Field label="تعداد نتایج بازیابی دانش (RAG)">
            <Input type="number" min={0} max={20} value={s.pipeline.ragResults} onChange={(e) => set("pipeline", { ragResults: Number(e.target.value) })} />
          </Field>
          <div className="space-y-3 md:col-span-2">
            <Switch checked={s.pipeline.useGoogleSearch} onChange={(v) => set("pipeline", { useGoogleSearch: v })} label="جستجوی گوگل (Grounding) برای ایجنت تحقیق — اگر کلید رایگان پشتیبانی نکند خودکار غیرفعال می‌شود" />
            <Switch checked={s.knowledge.autoExtract} onChange={(v) => set("knowledge", { autoExtract: v })} label="استخراج خودکار دانش پس از پیش‌کار و کار اصلی" />
            <Switch checked={s.claude.resumeSessions} onChange={(v) => set("claude", { resumeSessions: v })} label="ادامه‌ی همان جلسه‌ی Claude برای تسک‌های مرتبط" />
            <Switch checked={s.upgrade.autoMerge} onChange={(v) => set("upgrade", { autoMerge: v })} label="انتشار خودکار همه‌ی ارتقاها پس از build موفق" />
          </div>
          <Field label="graphify">
            <Select value={s.graphify.mode} onChange={(e) => set("graphify", { mode: e.target.value as AppSettings["graphify"]["mode"] })}>
              <option value="gemini">کامل (کد + اسناد با Gemini)</option>
              <option value="code-only">فقط کد (بدون مصرف API)</option>
              <option value="off">خاموش</option>
            </Select>
          </Field>
          <Field label="مدل Claude (اختیاری)" hint="خالی = پیش‌فرض اشتراک شما؛ مثلاً opus یا sonnet">
            <Input dir="ltr" value={s.claude.model} onChange={(e) => set("claude", { model: e.target.value })} />
          </Field>
          <Field label="حداکثر نوبت‌های Claude در هر اجرا">
            <Input type="number" min={20} max={1000} value={s.claude.maxTurns} onChange={(e) => set("claude", { maxTurns: Number(e.target.value) })} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="پرامپت‌های پیش‌فرض" subtitle="هنگام ارسال به پیش‌کار یا Claude در فرم پرامپت از پیش پر می‌شوند" />
        <div className="grid gap-4 p-5 lg:grid-cols-2">
          <Field label="پرامپت پیش‌فرض پیش‌کار">
            <Textarea value={s.prework.defaultPrompt} onChange={(e) => set("prework", { defaultPrompt: e.target.value })} className="min-h-36" />
          </Field>
          <Field label="پرامپت پیش‌فرض کار اصلی (Claude)">
            <Textarea value={s.claude.defaultPrompt} onChange={(e) => set("claude", { defaultPrompt: e.target.value })} className="min-h-36" />
          </Field>
        </div>
        <div className={cn("flex justify-end border-t border-line px-5 py-3")}>
          <Button loading={busy === "save"} onClick={() => doAct("save", () => saveSettingsAction(s), "تنظیمات ذخیره شد")}>
            <Save className="size-4" /> ذخیره‌ی همه‌ی تنظیمات
          </Button>
        </div>
      </Card>
    </div>
  );
}
