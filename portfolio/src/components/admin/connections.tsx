"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { saveAi, saveNotify, setupRepo, testAi, testNotify, type AiTest, type Result } from "@/app/actions/connections";
import type { ConnectionReport, PublicSettings, Status } from "@/lib/connections";
import type { NotifyChannel } from "@/lib/settings-types";

const STATUS: Record<Status, { label: string; mark: string; className: string }> = {
  ok: { label: "آماده", mark: "●", className: "border-fg text-fg" },
  warn: { label: "نیاز به توجه", mark: "◐", className: "border-fg-2 text-fg-2" },
  error: { label: "مشکل دارد", mark: "✕", className: "border-fg bg-fg text-bg" },
  off: { label: "خاموش / اختیاری", mark: "○", className: "border-line text-faint" },
};

const fa = (n: number) => new Intl.NumberFormat("fa-IR").format(n);
const when = (iso: string) => new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" }).format(new Date(iso));

const input = "w-full rounded-[6px] border border-line-strong bg-transparent px-3.5 py-2 text-sm outline-none focus:border-fg";
const button = "inline-flex h-9 items-center gap-2 rounded-full bg-fg px-5 text-sm font-semibold text-bg disabled:opacity-50";
const soft = "inline-flex h-9 items-center gap-2 rounded-full border border-line-strong px-4 text-sm hover:border-fg disabled:opacity-50";

function Card({ title, status, children }: { title: string; status: Status; children: ReactNode }) {
  const s = STATUS[status];
  return (
    <section className="flex flex-col rounded-[8px] border border-line p-6">
      <header className="flex items-center gap-3">
        <h2 className="flex-1 font-bold">{title}</h2>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-xs ${s.className}`}>
          <span aria-hidden>{s.mark}</span>
          {s.label}
        </span>
      </header>
      <div className="mt-5 flex-1 space-y-4 text-sm leading-7 text-fg-2">{children}</div>
    </section>
  );
}

function Row({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span aria-hidden className={`mt-1.5 grid size-4 shrink-0 place-items-center rounded-full border text-[9px] ${ok === null ? "border-line text-faint" : ok ? "border-fg bg-fg text-bg" : "border-fg text-fg"}`}>
        {ok === null ? "–" : ok ? "✓" : "✕"}
      </span>
      <span className="sr-only">{ok === null ? "اطلاع" : ok ? "درست" : "مشکل"}: </span>
      <span>{children}</span>
    </li>
  );
}

const Code = ({ children }: { children: ReactNode }) => (
  <span dir="ltr" className="rounded bg-fg/[0.07] px-1.5 py-0.5 font-mono text-[12px] text-fg">
    {children}
  </span>
);

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs text-muted">{label}</span>
      {children}
      {hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </label>
  );
}

/** Runs a server action and shows its message under the form. */
function useRun() {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const run = <T,>(fn: () => Promise<Result<T>>, onOk?: (r: Result<T> & { ok: true }) => void) => {
    setNote(null);
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) {
          if (r.message) setNote({ ok: true, text: r.message });
          onOk?.(r);
        } else setNote({ ok: false, text: r.error });
      } catch {
        setNote({ ok: false, text: "ارتباط با سرور برقرار نشد؛ دوباره امتحان کنید." });
      }
    });
  };
  const message = note ? (
    <p role="status" className={`rounded-[6px] border px-3 py-2 text-sm ${note.ok ? "border-line" : "border-fg font-semibold text-fg"}`}>
      {note.ok ? "✓ " : "✕ "}
      {note.text}
    </p>
  ) : null;
  return { pending, run, message };
}

function VercelHint() {
  return (
    <p className="text-xs leading-6 text-faint">
      متغیرها را در پروژه‌ی پورتفولیو در Vercel، بخش <span dir="ltr">Settings → Environment Variables</span> اضافه کنید و یک بار Redeploy کنید.{" "}
      <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer" className="link-draw text-fg-2">
        باز کردن Vercel
      </a>
    </p>
  );
}

export function ConnectionsBoard({ report, settings, loaded }: { report: ConnectionReport; settings: PublicSettings; loaded: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const r = report;
  const all: Status[] = [r.github.status, r.security.status, r.ai.status, r.notify.status, r.site.status, r.vercel.status];
  const ready = all.filter((s) => s === "ok").length;
  const optional = all.filter((s) => s === "off").length;
  const problems = all.length - ready - optional;
  const recheck = () => startRefresh(() => router.refresh());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4 rounded-[8px] border border-line p-5">
        <div className="flex-1">
          <p className="text-lg font-bold">
            {problems ? `${fa(problems)} مورد نیاز به رسیدگی دارد` : "همه‌چیز آماده است"}
          </p>
          <p className="text-sm text-fg-2">
            {fa(ready)} آماده{optional ? ` · ${fa(optional)} خاموش یا اختیاری` : ""}
          </p>
          <p className="text-xs text-faint">آخرین بررسی: {when(r.checkedAt)}</p>
        </div>
        <button type="button" className={soft} onClick={recheck} disabled={refreshing}>
          {refreshing ? "…" : "بررسی دوباره"}
        </button>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <GitHubCard r={r} onDone={recheck} />
        <SecurityCard r={r} />
        {/* each form starts again from what is stored when its own section changes, never when the other one is saved */}
        <AiCard key={JSON.stringify(settings.ai)} r={r} settings={settings} loaded={loaded} onSaved={recheck} />
        <NotifyCard key={JSON.stringify(settings.notify)} r={r} settings={settings} loaded={loaded} onSaved={recheck} />
        <SiteCard r={r} />
        <VercelCard r={r} />
      </div>
    </div>
  );
}

function GitHubCard({ r, onDone }: { r: ConnectionReport; onDone: () => void }) {
  const g = r.github;
  const { pending, run, message } = useRun();
  const needsSetup = g.reachable && (!g.settingsFile || !g.knowledgeFile || !g.labels);
  return (
    <Card title="مخزن داده (GitHub)" status={g.status}>
      <p className="text-xs leading-6 text-faint">درخواست‌ها (به‌صورت Issue)، تنظیمات همین صفحه و دانش اضافه‌ی دستیار در یک مخزن خصوصی نگه داشته می‌شوند؛ پایگاه داده‌ی دیگری لازم نیست.</p>
      <ul className="space-y-2">
        <Row ok={g.tokenSet}>
          <Code>GITHUB_TOKEN</Code> {g.tokenSet ? "تنظیم است" : "تنظیم نشده"}
        </Row>
        <Row ok={g.repoValid}>
          <Code>GITHUB_REPO</Code> {g.repo ? <Code>{g.repo}</Code> : "تنظیم نشده"}
          {g.repo && !g.repoValid ? " — باید به شکل owner/name باشد" : ""}
        </Row>
        {g.tokenSet && g.repoValid ? <Row ok={g.reachable}>{g.reachable ? "اتصال برقرار است." : g.error || "اتصال برقرار نشد."}</Row> : null}
        {g.private !== null ? (
          <Row ok={g.private}>{g.private ? "مخزن خصوصی است." : "مخزن عمومی است! همه‌ی درخواست‌های ذخیره‌شده و اطلاعات تماس بازدیدکننده‌ها الان برای همه دیده می‌شود. فوراً در GitHub → Settings → Danger Zone آن را Private کنید. سایت حداکثر یک دقیقه پس از عمومی شدن، دیگر درخواستی در آن نمی‌نویسد و صفحه‌های پیگیری را نشان نمی‌دهد."}</Row>
        ) : null}
        {g.issues !== null ? <Row ok={g.issues}>{g.issues ? "Issues فعال است." : "Issues در این مخزن خاموش است؛ در Settings → Features روشنش کنید."}</Row> : null}
        {g.settingsError ? (
          <Row ok={false}>
            <Code>settings.json</Code> خوانده نشد ({g.settingsError}). تا درست شود، سایت با آخرین تنظیماتی که خوانده کار می‌کند (و اگر تازه بالا آمده، دستیار و اعلان خاموش می‌مانند)؛ وضعیت کارت‌های هوش مصنوعی و اعلان هم قابل اعتماد نیست. فایل را در GitHub درست کنید. پاک کردنش همه‌چیز را به پیش‌فرض برمی‌گرداند (دستیار روشن، و کلید و ربات Vercel اگر باشند) و کلید و توکن ذخیره‌شده را هم پاک می‌کند.
          </Row>
        ) : null}
        {g.reachable ? (
          <Row ok={Boolean(g.settingsFile && g.knowledgeFile && g.labels)}>
            {g.settingsFile && g.knowledgeFile && g.labels ? (
              <>
                <Code>settings.json</Code>، <Code>knowledge.md</Code> و برچسب‌ها آماده‌اند.
              </>
            ) : (
              "مخزن هنوز آماده‌سازی نشده (فایل‌ها یا برچسب‌ها نیستند)."
            )}
          </Row>
        ) : null}
        {g.tokenExpires ? (
          <Row ok={Date.parse(g.tokenExpires) - Date.parse(r.checkedAt) > 14 * 86400_000}>انقضای توکن: {when(g.tokenExpires)} — پیش از آن توکن تازه بسازید و در Vercel عوض کنید.</Row>
        ) : null}
        {g.tokenExpiresRaw ? (
          <Row ok={false}>
            انقضای توکن خوانده نشد (<span dir="ltr">{g.tokenExpiresRaw}</span>)؛ تاریخ انقضا را در تنظیمات توکن در GitHub ببینید.
          </Row>
        ) : null}
        {g.rateRemaining !== null ? <Row ok={null}>سهمیه‌ی باقی‌مانده‌ی GitHub در این ساعت: {fa(g.rateRemaining)} درخواست</Row> : null}
      </ul>
      {!g.tokenSet || !g.repoValid ? <VercelHint /> : null}
      <div className="flex flex-wrap gap-2">
        {g.reachable ? (
          <button type="button" className={needsSetup ? button : soft} disabled={pending} onClick={() => run(() => setupRepo(), () => onDone())}>
            {pending ? "…" : needsSetup ? "آماده‌سازی مخزن" : "بررسی و آماده‌سازی دوباره"}
          </button>
        ) : null}
        {g.url && g.reachable ? (
          <a href={g.url} target="_blank" rel="noreferrer" className={soft}>
            باز کردن مخزن ↗
          </a>
        ) : null}
      </div>
      {message}
    </Card>
  );
}

function SecurityCard({ r }: { r: ConnectionReport }) {
  const s = r.security;
  return (
    <Card title="امنیت پنل" status={s.status}>
      <ul className="space-y-2">
        <Row ok={s.adminPassword}>
          رمز ورود پنل (<Code>ADMIN_PASSWORD</Code>) {s.adminPassword ? "تنظیم است." : "تنظیم نشده."}
        </Row>
        <Row ok={s.appSecret === "ok"}>
          {s.appSecret === "missing" ? (
            <>
              <Code>APP_SECRET</Code> تنظیم نشده؛ بدون آن پنل، پیوندهای پیگیری و رمز کردن کلیدها کار نمی‌کند.
            </>
          ) : s.appSecret === "short" ? (
            <>
              <Code>APP_SECRET</Code> کوتاه است؛ تا دست‌کم ۳۲ نویسه‌ی تصادفی نشود، پنل، پیوندهای پیگیری و رمز کردن کلیدها کار نمی‌کنند.
            </>
          ) : (
            <>
              <Code>APP_SECRET</Code> تنظیم است؛ کلیدهای این صفحه با آن رمز می‌شوند.
            </>
          )}
        </Row>
        {s.previous ? (
          <Row ok>
            <Code>APP_SECRET_PREVIOUS</Code> تنظیم است: کلیدهای ذخیره‌شده و پیوندهای پیگیری ساخته‌شده با مقدار قبلی هم کار می‌کنند.
          </Row>
        ) : null}
        {s.reencrypt ? (
          <Row ok={false}>
            کلید هوش مصنوعی یا توکن ربات هنوز با مقدار قبلی رمز شده؛ در هر دو کارت یک بار «ذخیره» بزنید (کادرها خالی بمانند) تا با <Code>APP_SECRET</Code> تازه رمز شوند. بعد از آن می‌توانید <Code>APP_SECRET_PREVIOUS</Code> را پاک کنید.
          </Row>
        ) : null}
      </ul>
      <p className="text-xs leading-6 text-faint">
        اگر <Code>APP_SECRET</Code> را عوض کنید، مقدار قبلی را در <Code>APP_SECRET_PREVIOUS</Code> بگذارید تا کلیدهای ذخیره‌شده و پیوندهای پیگیری قبلی کار کنند. برای بیرون کردن همه‌ی نشست‌های پنل، <Code>ADMIN_PASSWORD</Code> را عوض کنید.
      </p>
      {s.status !== "ok" ? <VercelHint /> : null}
    </Card>
  );
}

function NotLoaded() {
  return <p className="rounded-[6px] border border-fg px-3 py-2 text-sm font-semibold">✕ تنظیمات فعلی از GitHub خوانده نشد؛ تا وصل نشود ذخیره خاموش است تا چیزی پاک نشود.</p>;
}

function AiCard({ r, settings, loaded, onSaved }: { r: ConnectionReport; settings: PublicSettings; loaded: boolean; onSaved: () => void }) {
  const a = r.ai;
  const { pending, run, message } = useRun();
  const [enabled, setEnabled] = useState(settings.ai.enabled);
  const [key, setKey] = useState("");
  const [models, setModels] = useState(settings.ai.models.join(", "));
  const [test, setTest] = useState<AiTest | null>(null);
  const source = {
    panel: (
      <>
        کلید ذخیره‌شده در همین صفحه (<span dir="ltr">{a.keyHint}</span>)
      </>
    ),
    env: "کلید GEMINI_API_KEY در Vercel",
    none: "هیچ کلیدی تنظیم نشده",
  }[a.keySource];
  const testSource = { form: "کلید داخل کادر", panel: "کلید ذخیره‌شده", env: "کلید Vercel" };
  return (
    <Card title="هوش مصنوعی (Google AI Studio)" status={a.status}>
      <ul className="space-y-2">
        <Row ok={a.enabled}>{a.enabled ? "دستیار سایت و تحلیل درخواست‌ها روشن است." : "دستیار خاموش است؛ گفتگو پیام «در دسترس نیست» می‌دهد."}</Row>
        <Row ok={a.keySource !== "none"}>{source}</Row>
        {a.keyUnreadable ? <Row ok={false}>کلید ذخیره‌شده خوانده نمی‌شود (APP_SECRET عوض شده)؛ کلید را دوباره وارد و ذخیره کنید.</Row> : null}
        {a.live !== null ? <Row ok={a.live === ""}>{a.live === "" ? "کلید همین الان با Google بررسی شد و کار می‌کند." : a.live}</Row> : null}
        <Row ok={null}>
          مدل‌ها به ترتیب: <span dir="ltr" className="font-mono text-[12px]">{a.models.join(" → ")}</span>
        </Row>
      </ul>
      {!loaded ? <NotLoaded /> : null}
      <Field label="کلید API" hint={settings.ai.hasKey ? "خالی بگذارید تا همان کلید ذخیره‌شده بماند" : "از aistudio.google.com/apikey؛ کلیدهای تازه با AQ. و کلیدهای قدیمی‌تر با AIza شروع می‌شوند"}>
        <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} dir="ltr" placeholder="AQ.…" className={input} />
      </Field>
      <Field label="مدل‌های ترجیحی (اختیاری)" hint="با ویرگول؛ پیش از زنجیره‌ی رایگان پیش‌فرض امتحان می‌شوند">
        <input value={models} onChange={(e) => setModels(e.target.value)} dir="ltr" placeholder="gemini-3.5-flash-lite" className={input} />
      </Field>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4 accent-current" />
        دستیار روشن باشد
      </label>
      <p className="text-xs leading-6 text-faint">
        کلید رایگان را در{" "}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="link-draw text-fg-2">
          Google AI Studio
        </a>{" "}
        بسازید. کلید پیش از ذخیره با APP_SECRET رمز می‌شود و فقط چهار نویسه‌ی آخرش نمایش داده می‌شود.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={soft}
          disabled={pending}
          onClick={() => {
            setTest(null);
            run(() => testAi({ apiKey: key || undefined, models }), (res) => setTest(res.data ?? null));
          }}
        >
          {pending ? "…" : "آزمایش اتصال"}
        </button>
        <button
          type="button"
          className={button}
          disabled={pending || !loaded}
          onClick={() =>
            run(
              () => saveAi({ enabled, apiKey: key || undefined, models }),
              () => {
                setKey("");
                onSaved();
              },
            )
          }
        >
          ذخیره
        </button>
        {settings.ai.hasKey ? (
          <button
            type="button"
            className={soft}
            disabled={pending || !loaded}
            onClick={() => window.confirm("کلید از این صفحه حذف شود؟ (اگر GEMINI_API_KEY در Vercel باشد، همان به کار می‌رود)") && run(() => saveAi({ enabled, clearKey: true, models }), () => onSaved())}
          >
            حذف کلید
          </button>
        ) : null}
      </div>
      {test ? (
        <p role="status" className="rounded-[6px] border border-fg px-3 py-2 text-sm">
          ✓ پاسخ گرفت از <Code>{test.model}</Code> در {fa(test.ms)} میلی‌ثانیه ({testSource[test.source]}).
        </p>
      ) : null}
      {message}
    </Card>
  );
}

function NotifyCard({ r, settings, loaded, onSaved }: { r: ConnectionReport; settings: PublicSettings; loaded: boolean; onSaved: () => void }) {
  const n = r.notify;
  const { pending, run, message } = useRun();
  const [channel, setChannel] = useState<NotifyChannel>(settings.notify.channel);
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState(settings.notify.chatId);
  const name = n.channel === "bale" ? "بله" : "تلگرام";
  return (
    <Card title="اعلان درخواست‌ها (تلگرام / بله)" status={n.status}>
      <ul className="space-y-2">
        <Row ok={n.channel === "none" ? null : n.source !== "none"}>
          {n.channel === "none"
            ? "اعلان خاموش است؛ درخواست‌ها فقط در پنل دیده می‌شوند (GitHub برای Issueهایی که سایت با توکن خودتان می‌سازد اعلانی نمی‌فرستد)."
            : n.source === "panel"
              ? (
                  <>
                    {name} · ربات ذخیره‌شده (<span dir="ltr">{n.tokenHint}</span>) · گفتگو <span dir="ltr">{n.chatId}</span>
                  </>
                )
              : n.source === "env"
                ? "ربات TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID در Vercel"
                : `ربات ${name} هنوز تنظیم نشده (اختیاری، ولی تنها راه باخبر شدن فوری از درخواست‌هاست).`}
        </Row>
        {n.tokenUnreadable ? <Row ok={false}>توکن ذخیره‌شده خوانده نمی‌شود (APP_SECRET عوض شده)؛ دوباره وارد کنید.</Row> : null}
        {n.tokenOtherChannel ? <Row ok={false}>توکن ذخیره‌شده مال سرویس دیگری است و به {name} فرستاده نمی‌شود؛ توکن ربات {name} را وارد کنید.</Row> : null}
        {n.live ? (
          n.live.ok ? (
            <Row ok={n.live.chatOk !== false}>
              ربات وصل است{n.live.username ? <> (<span dir="ltr">@{n.live.username}</span>)</> : null}
              {n.live.chatOk === true ? " و شناسه‌ی گفتگو پیدا شد." : n.live.chatOk === false ? ` ولی ${n.live.error}` : "."}
            </Row>
          ) : (
            <Row ok={false}>{n.live.error}</Row>
          )
        ) : null}
      </ul>
      {!loaded ? <NotLoaded /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="کانال">
          <select value={channel} onChange={(e) => setChannel(e.target.value as NotifyChannel)} className={`${input} bg-bg`}>
            <option value="telegram">تلگرام</option>
            <option value="bale">بله</option>
            <option value="none">خاموش</option>
          </select>
        </Field>
        <Field label="شناسه‌ی گفتگو (chat id)">
          <input value={chatId} onChange={(e) => setChatId(e.target.value)} dir="ltr" placeholder="123456789" className={input} />
        </Field>
      </div>
      <Field
        label="توکن ربات"
        hint={
          settings.notify.hasToken && (channel === "none" || settings.notify.tokenChannel === channel)
            ? "خالی بگذارید تا همان توکن ذخیره‌شده بماند"
            : channel === "bale"
              ? "از @botfather در بله (ساخت بازوی جدید)"
              : "از @BotFather در تلگرام"
        }
      >
        <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} dir="ltr" placeholder="123456789:AA…" className={input} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={pending || !loaded}
          onClick={() =>
            run(
              () => saveNotify({ channel, token: token || undefined, chatId }),
              () => {
                setToken("");
                onSaved();
              },
            )
          }
        >
          ذخیره
        </button>
        {n.status === "ok" ? (
          <button type="button" className={soft} disabled={pending} onClick={() => run(() => testNotify())}>
            {pending ? "…" : "ارسال پیام آزمایشی"}
          </button>
        ) : null}
      </div>
      {message}
    </Card>
  );
}

function SiteCard({ r }: { r: ConnectionReport }) {
  const s = r.site;
  return (
    <Card title="نشانی سایت" status={s.status}>
      <ul className="space-y-2">
        <Row ok={s.explicit || s.vercelUrl}>
          {s.explicit ? (
            <>
              <Code>NEXT_PUBLIC_SITE_URL</Code>: <span dir="ltr">{s.configured}</span>
            </>
          ) : (
            <>
              <Code>NEXT_PUBLIC_SITE_URL</Code> تنظیم نشده؛ <span dir="ltr">{s.configured}</span> در پیوندها، نقشه‌ی سایت و اعلان‌ها به کار می‌رود
              {s.vercelUrl ? " (نشانی Production خود Vercel، که دامنه‌ی وصل‌شده را هم خودکار می‌گیرد)." : ". روی Vercel منتشر کنید یا این متغیر را بگذارید."}
            </>
          )}
        </Row>
        {s.current ? (
          <Row ok={null}>
            این صفحه از <span dir="ltr">{s.current}</span> باز شده است{s.explicit && s.status === "warn" ? " (پیش‌نمایش یا دامنه‌ی دیگر)" : ""}.
          </Row>
        ) : null}
      </ul>
    </Card>
  );
}

function VercelCard({ r }: { r: ConnectionReport }) {
  const v = r.vercel;
  return (
    <Card title="میزبانی (Vercel)" status={v.status}>
      {v.onVercel ? (
        <ul className="space-y-2">
          <Row ok>
            محیط: <Code>{v.environment || "—"}</Code>
            {v.region ? (
              <>
                {" "}· منطقه: <Code>{v.region}</Code>
              </>
            ) : null}
          </Row>
          <Row ok={null}>
            نسخه: <Code>{v.commit || "—"}</Code>
            {v.branch ? (
              <>
                {" "}از شاخه‌ی <Code>{v.branch}</Code>
              </>
            ) : null}
          </Row>
          {v.url ? (
            <Row ok={null}>
              نشانی Production در Vercel: <span dir="ltr">{v.url}</span>
            </Row>
          ) : null}
        </ul>
      ) : (
        <p>این نسخه روی Vercel اجرا نمی‌شود (اجرای محلی).</p>
      )}
    </Card>
  );
}
