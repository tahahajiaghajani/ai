"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { saveAi, testAi, testNotify, type AiTest } from "@/app/actions/admin";
import { saveEmail, testEmail } from "@/app/actions/connections";
import type { ConnectionReport, Status } from "@/lib/connections";
import { PROVIDERS, type AiSettings, type NotifySettings, type ProviderId } from "@/lib/settings-types";
import { Button, Field, Input, Select, Spinner } from "@/components/ui/field";
import { NotifyForm } from "@/components/admin/site-forms";
import { AiTestReport } from "@/components/admin/ai-test";
import { aiErrorText } from "@/lib/ai-errors";
import { toast, useAction } from "@/components/admin/toast";
import { Icon, type IconName } from "@/components/site/icons";

const STATUS: Record<Status, { label: string; dot: string; text: string }> = {
  ok: { label: "آماده", dot: "bg-success", text: "text-success" },
  warn: { label: "نیاز به توجه", dot: "bg-warning", text: "text-warning" },
  error: { label: "وصل نیست", dot: "bg-danger", text: "text-danger" },
  off: { label: "خاموش / اختیاری", dot: "bg-white/30", text: "text-faint" },
};

const fa = (n: number) => new Intl.NumberFormat("fa-IR").format(n);
const when = (iso: string) => new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" }).format(new Date(iso));

function Card({ icon, title, status, children }: { icon: IconName; title: string; status: Status; children: ReactNode }) {
  const st = STATUS[status];
  return (
    <section className="card flex flex-col p-6">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl border border-line bg-white/[0.03]">
          <Icon name={icon} className="size-5 text-violet" />
        </span>
        <h2 className="flex-1 font-semibold">{title}</h2>
        <span className={`inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs ${st.text}`}>
          <span className={`size-2 rounded-full ${st.dot} ${status === "ok" ? "shadow-[0_0_10px_var(--color-success)]" : ""}`} />
          {st.label}
        </span>
      </header>
      <div className="mt-5 flex-1 space-y-4 text-sm leading-7 text-muted">{children}</div>
    </section>
  );
}

function Row({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-1 grid size-4 shrink-0 place-items-center rounded-full text-[10px] ${ok === null ? "bg-white/10 text-faint" : ok ? "bg-success/20 text-success" : "bg-danger/20 text-danger"}`}>{ok === null ? "–" : ok ? "✓" : "✕"}</span>
      <span>{children}</span>
    </li>
  );
}

const Code = ({ children }: { children: ReactNode }) => <span className="ltr rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-fg/90">{children}</span>;

type AiInitial = Omit<AiSettings, "apiKeyEnc"> & { hasKey: boolean };
type NotifyInitial = Omit<NotifySettings, "botTokenEnc"> & { hasToken: boolean };

export function ConnectionsBoard({ report, sql, ai, notify }: { report: ConnectionReport; sql: { name: string; sql: string }[]; ai: AiInitial; notify: NotifyInitial }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const r = report;
  const all: Status[] = [r.supabase.status, r.ai.status, r.security.status, r.site.status, r.notify.status, r.email.status, r.keepalive.status];
  const ready = all.filter((s) => s === "ok").length;
  const recheck = () => startRefresh(() => router.refresh());

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-center gap-4 p-5">
        <div className="flex-1">
          <div className="text-lg font-semibold text-fg">
            {fa(ready)} از {fa(all.length)} مورد آماده است
          </div>
          <div className="text-xs text-faint">آخرین بررسی: {when(r.checkedAt)}</div>
        </div>
        <Button variant="soft" onClick={recheck} disabled={refreshing}>
          {refreshing ? <Spinner /> : null} بررسی دوباره
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SupabaseCard r={r} sql={sql} />
        <AiCard r={r} ai={ai} onSaved={recheck} />
        <NotifyCard r={r} notify={notify} />
        <EmailCard r={r} onSaved={recheck} />
        <Card icon="shield" title="امنیت پنل" status={r.security.status}>
          <ul className="space-y-2">
            <Row ok>
              رمز ورود پنل (<Code>ADMIN_PASSWORD</Code>) تنظیم است.
            </Row>
            <Row ok={r.security.appSecret === "own"}>
              {r.security.appSecret === "own" ? (
                <>
                  کلید جداگانه‌ی <Code>APP_SECRET</Code> تنظیم است.
                </>
              ) : (
                <>
                  <Code>APP_SECRET</Code> تنظیم نشده و از کلید Supabase استفاده می‌شود. بهتر است یک رشته‌ی تصادفی ۳۲ نویسه‌ای یا بلندتر در Vercel اضافه کنید؛ داده‌های قبلی خوانا می‌مانند.
                </>
              )}
            </Row>
            {r.security.previous && (
              <Row ok>
                <Code>APP_SECRET_PREVIOUS</Code> برای خواندن داده‌های رمزشده با کلید قبلی تنظیم است.
              </Row>
            )}
          </ul>
          <VercelHint />
        </Card>
        <Card icon="globe" title="نشانی سایت" status={r.site.status}>
          <ul className="space-y-2">
            <Row ok={r.site.explicit}>
              {r.site.explicit ? (
                <>
                  <Code>NEXT_PUBLIC_SITE_URL</Code>: <span className="ltr">{r.site.configured}</span>
                </>
              ) : (
                <>
                  <Code>NEXT_PUBLIC_SITE_URL</Code> تنظیم نشده؛ فعلاً <span className="ltr">{r.site.configured}</span> در پیوندها، نقشه‌ی سایت و ایمیل‌ها به کار می‌رود. پس از وصل کردن دامنه، آن را تنظیم و Redeploy کنید.
                </>
              )}
            </Row>
            {r.site.current && (
              <Row ok={null}>
                این صفحه از <span className="ltr">{r.site.current}</span> باز شده است{r.site.status === "warn" && r.site.explicit ? " (پیش‌نمایش یا دامنه‌ی دیگر)" : ""}.
              </Row>
            )}
          </ul>
        </Card>
        <Card icon="clock" title="بیدار ماندن Supabase" status={r.keepalive.status}>
          <ul className="space-y-2">
            <Row ok={r.keepalive.lastAt ? r.keepalive.status === "ok" : null}>
              {r.keepalive.lastAt ? <>آخرین اجرای روزانه: {when(r.keepalive.lastAt)}</> : <>هنوز اجرا نشده است. Vercel فقط روی نسخه‌ی Production هر روز یک بار <Code>/api/keepalive</Code> را صدا می‌زند.</>}
            </Row>
            <Row ok={null}>
              {r.keepalive.cronSecret ? (
                <>
                  <Code>CRON_SECRET</Code> تنظیم است؛ فقط Vercel می‌تواند این نشانی را صدا بزند.
                </>
              ) : (
                <>
                  اختیاری: با تنظیم <Code>CRON_SECRET</Code> فقط Vercel می‌تواند این نشانی را صدا بزند.
                </>
              )}
            </Row>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function VercelHint() {
  return (
    <p className="text-xs leading-6 text-faint">
      متغیرهای محیطی را در Vercel → پروژه‌ی سایت → Settings → Environment Variables اضافه کنید و یک بار Redeploy کنید.{" "}
      <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer" className="text-violet hover:text-fg">
        باز کردن Vercel
      </a>
    </p>
  );
}

function SupabaseCard({ r, sql }: { r: ConnectionReport; sql: { name: string; sql: string }[] }) {
  const s = r.supabase;
  const [copied, setCopied] = useState(false);
  const missing = s.objects.filter((o) => !o.ok);
  const text = sql.map((f) => `-- ${f.name}\n${f.sql}`).join("\n\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast(false, "کپی نشد؛ متن را از کادر زیر انتخاب کنید.");
    }
  };
  return (
    <Card icon="data" title="پایگاه داده (Supabase)" status={s.status}>
      <ul className="space-y-2">
        <Row ok={s.urlSet}>
          <Code>SUPABASE_URL</Code> {s.urlSet ? "تنظیم است" : "تنظیم نشده"}
        </Row>
        <Row ok={s.keySet}>
          <Code>SUPABASE_SERVICE_ROLE_KEY</Code> {s.keySet ? "تنظیم است" : "تنظیم نشده"}
        </Row>
        {s.urlSet && s.keySet && <Row ok={s.reachable}>{s.reachable ? "اتصال برقرار است." : `اتصال برقرار نشد${s.error ? `: ${s.error}` : ""}`}</Row>}
      </ul>
      {(!s.urlSet || !s.keySet) && <VercelHint />}
      {s.reachable && (
        <>
          <ul className="flex flex-wrap gap-1.5">
            {s.objects.map((o) => (
              <li key={o.name} className={`ltr rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${o.ok ? "border-success/30 text-success" : "border-danger/40 text-danger"}`} title={o.file}>
                {o.ok ? "✓" : "✕"} {o.name}
              </li>
            ))}
          </ul>
          {missing.length > 0 ? (
            <div className="space-y-3 rounded-2xl border border-warning/30 bg-warning/[0.06] p-4">
              <p className="text-fg/90">
                {fa(missing.length)} مورد هنوز ساخته نشده است. SQL زیر را کپی کنید، در Supabase → SQL Editor بچسبانید و Run بزنید؛ سپس «بررسی دوباره». اجرای دوباره بی‌خطر است.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={copy}>{copied ? "کپی شد ✓" : `کپی SQL (${fa(sql.length)} فایل)`}</Button>
                {s.projectRef && (
                  <a href={`https://supabase.com/dashboard/project/${s.projectRef}/sql/new`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line-strong px-4 text-sm text-fg hover:bg-white/5">
                    باز کردن SQL Editor <Icon name="external" className="size-3.5" />
                  </a>
                )}
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer text-faint">نمایش SQL</summary>
                <pre dir="ltr" className="scroll-thin mt-2 max-h-72 overflow-auto rounded-xl bg-ink-2 p-3 text-[11px] leading-5 text-muted">{text}</pre>
              </details>
            </div>
          ) : (
            <p>همه‌ی جدول‌ها و تابع‌ها ساخته شده‌اند.</p>
          )}
        </>
      )}
    </Card>
  );
}

function AiCard({ r, ai, onSaved }: { r: ConnectionReport; ai: AiInitial; onSaved: () => void }) {
  const { pending, run } = useAction();
  const [provider, setProvider] = useState<ProviderId>(ai.provider);
  const [model, setModel] = useState(ai.model);
  const [key, setKey] = useState("");
  const [test, setTest] = useState<AiTest | null>(null);
  const p = PROVIDERS.find((x) => x.id === provider) ?? PROVIDERS[0];
  const envNote = r.ai.provider === "google" ? "کلید GEMINI_API_KEY در Vercel" : "بدون کلید پنل؛ دستیار با GEMINI_API_KEY در Vercel روی Gemini کار می‌کند";
  const source = { panel: `کلید ذخیره‌شده در پنل (${r.ai.keyHint})`, env: envNote, none: "هیچ کلیدی تنظیم نشده" }[r.ai.keySource];
  // the stored base URL and fallback models belong to the stored provider (this card has no fields for them)
  const same = provider === ai.provider;
  const baseUrl = same ? ai.baseUrl : "";
  const changeProvider = (id: ProviderId) => {
    setProvider(id);
    setModel(id === ai.provider ? ai.model : (PROVIDERS.find((x) => x.id === id)?.models[0] ?? ""));
  };
  const runTest = () => {
    setTest(null);
    run(() => testAi({ provider, model, baseUrl, apiKey: key || undefined }), { silent: true, onOk: (res) => setTest(res) });
  };
  const save = () => {
    const { hasKey, ...rest } = ai;
    void hasKey;
    run(() => saveAi({ ...rest, provider, model, baseUrl, fallbackModels: same ? ai.fallbackModels : [], enabled: true, apiKey: key || undefined }), {
      onOk: () => {
        setKey("");
        onSaved();
      },
    });
  };
  return (
    <Card icon="ai" title="هوش مصنوعی" status={r.ai.status}>
      <ul className="space-y-2">
        <Row ok={r.ai.enabled}>{r.ai.enabled ? "دستیار سایت روشن است." : "دستیار سایت خاموش است (با «ذخیره و فعال‌سازی» روشن می‌شود)."}</Row>
        <Row ok={r.ai.keySource !== "none"}>
          {PROVIDERS.find((x) => x.id === r.ai.provider)?.label} · <span className="ltr">{r.ai.model}</span> · {source}
        </Row>
        {r.ai.keyUnreadable && <Row ok={false}>کلید ذخیره‌شده خوانده نمی‌شود (APP_SECRET عوض شده)؛ کلید را دوباره وارد و ذخیره کنید.</Row>}
        {(r.ai.lastOk || r.ai.lastError) && (
          <Row ok={r.ai.status === "ok"}>
            {r.ai.lastOk ? (
              <>
                آخرین پاسخ موفق دستیار سایت: {when(r.ai.lastOk.at)} · <span className="ltr">{r.ai.lastOk.model}</span>
              </>
            ) : (
              "هنوز پاسخ موفقی ثبت نشده است."
            )}
            {r.ai.lastError && (
              <span className="mt-1 block text-xs leading-6 text-faint">
                آخرین خطا: {when(r.ai.lastError.at)}
                {r.ai.lastError.model ? <> · <span className="ltr">{r.ai.lastError.model}</span></> : null} — {aiErrorText(r.ai.lastError)}
              </span>
            )}
          </Row>
        )}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="سرویس‌دهنده">
          <Select value={provider} onChange={(e) => changeProvider(e.target.value as ProviderId)}>
            {PROVIDERS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="مدل">
          <Input value={model} onChange={(e) => setModel(e.target.value)} list="conn-models" dir="ltr" />
        </Field>
      </div>
      <datalist id="conn-models">
        {p.models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <Field label="کلید API" hint={ai.hasKey ? "خالی = همان کلید ذخیره‌شده" : p.hint}>
        <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} dir="ltr" placeholder={p.hint} />
      </Field>
      <p className="text-xs text-faint">
        {p.note}{" "}
        <a href={p.keyUrl} target="_blank" rel="noreferrer" className="text-violet hover:text-fg">
          گرفتن کلید
        </a>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="soft" disabled={pending} onClick={runTest}>
          {pending ? <Spinner /> : null} آزمایش
        </Button>
        <Button disabled={pending} onClick={save}>
          ذخیره و فعال‌سازی
        </Button>
      </div>
      {test && <AiTestReport test={test} />}
    </Card>
  );
}

function NotifyCard({ r, notify }: { r: ConnectionReport; notify: NotifyInitial }) {
  const { pending, run } = useAction();
  const n = r.notify;
  return (
    <Card icon="telegram" title="اعلان تیکت‌ها (تلگرام / بله)" status={n.status}>
      <ul className="space-y-2">
        <Row ok={n.channel === "none" ? null : n.hasToken && n.chatId}>
          {n.channel === "none" ? "اعلان خاموش است؛ تیکت‌ها فقط در پنل دیده می‌شوند." : `${n.channel === "bale" ? "بله" : "تلگرام"} · توکن ربات ${n.hasToken ? "ذخیره شده" : "ندارد"} · شناسه‌ی گفتگو ${n.chatId ? "دارد" : "ندارد"}`}
        </Row>
      </ul>
      {n.channel !== "none" && (
        <Button variant="soft" disabled={pending} onClick={() => run(() => testNotify())}>
          {pending ? <Spinner /> : null} ارسال پیام آزمایشی
        </Button>
      )}
      <details className="rounded-2xl border border-line p-4">
        <summary className="cursor-pointer text-fg/90">تنظیم ربات</summary>
        <div className="mt-4">
          <NotifyForm initial={notify} />
        </div>
      </details>
    </Card>
  );
}

function EmailCard({ r, onSaved }: { r: ConnectionReport; onSaved: () => void }) {
  const { pending, run } = useAction();
  const e = r.email;
  const [key, setKey] = useState("");
  const [from, setFrom] = useState(e.from);
  const [to, setTo] = useState("");
  const source = { panel: `کلید ذخیره‌شده در پنل (${e.keyHint})`, env: "کلید RESEND_API_KEY در Vercel", none: "کلید Resend تنظیم نشده" }[e.source];
  return (
    <Card icon="mail" title="ایمیل به مشتری (Resend)" status={e.status}>
      <ul className="space-y-2">
        <Row ok={e.source === "none" ? null : true}>{source}</Row>
        <Row ok={e.source === "none" ? null : Boolean(e.from)}>{e.from ? <>فرستنده: <span className="ltr">{e.from}</span></> : "نشانی فرستنده تنظیم نشده"}</Row>
      </ul>
      <p className="text-xs leading-6 text-faint">
        اختیاری: وقتی تیم به تیکتی پاسخ می‌دهد، به مشتری ایمیل می‌رود. در{" "}
        <a href="https://resend.com" target="_blank" rel="noreferrer" className="text-violet hover:text-fg">
          resend.com
        </a>{" "}
        (پلن رایگان) دامنه را تأیید و یک کلید بسازید.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="کلید Resend" hint={e.source === "panel" ? "خالی = همان کلید" : "re_…"}>
          <Input type="password" autoComplete="off" value={key} onChange={(ev) => setKey(ev.target.value)} dir="ltr" placeholder="re_…" />
        </Field>
        <Field label="فرستنده">
          <Input value={from} onChange={(ev) => setFrom(ev.target.value)} dir="ltr" placeholder="Pars <support@parspmi.ir>" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            run(() => saveEmail({ apiKey: key || undefined, mailFrom: from }), {
              onOk: () => {
                setKey("");
                onSaved();
              },
            })
          }
        >
          {pending ? <Spinner /> : null} ذخیره
        </Button>
        {e.source === "panel" && (
          <Button
            variant="soft"
            disabled={pending}
            onClick={() => window.confirm("کلید Resend از پنل حذف شود؟ (اگر RESEND_API_KEY در Vercel باشد، همان به کار می‌رود)") && run(() => saveEmail({ mailFrom: from, clearKey: true }), { onOk: onSaved })}
          >
            حذف کلید
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="ارسال آزمایشی به" className="min-w-0 flex-1">
          <Input value={to} onChange={(ev) => setTo(ev.target.value)} dir="ltr" placeholder="you@example.com" />
        </Field>
        <Button variant="soft" disabled={pending || !to} onClick={() => run(() => testEmail({ to, apiKey: key || undefined, mailFrom: from || undefined }))}>
          ارسال
        </Button>
      </div>
    </Card>
  );
}
