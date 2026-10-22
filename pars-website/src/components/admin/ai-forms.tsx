"use client";

import { useState } from "react";
import { saveAi, saveChat, saveSupport, testAi } from "@/app/actions/admin";
import { PROVIDERS, type AiSettings, type ChatSettings, type ProviderId, type SupportSettings } from "@/lib/settings-types";
import { Button, Field, Input, Select, Spinner, Textarea } from "@/components/ui/field";
import { Panel, Toggle } from "@/components/admin/ui";
import { useAction } from "@/components/admin/toast";

type AiInitial = Omit<AiSettings, "apiKeyEnc"> & { hasKey: boolean };

export function AiForm({ initial, envKey }: { initial: AiInitial; envKey: boolean }) {
  const [f, setF] = useState(initial);
  const [apiKey, setApiKey] = useState("");
  const [fallbacks, setFallbacks] = useState(initial.fallbackModels.join("\n"));
  const [test, setTest] = useState<{ answer: string; model: string; ms: number } | null>(null);
  const { pending, run } = useAction();
  const preset = PROVIDERS.find((p) => p.id === f.provider) ?? PROVIDERS[0];

  return (
    <Panel title="مدل هوش مصنوعی" sub="کلید API رمزنگاری‌شده ذخیره می‌شود و هرگز به مرورگر بازنمی‌گردد. برای نسخه‌ی نهایی کافی است کلید و مدل قوی‌تر را اینجا عوض کنید.">
      <div className="space-y-5">
        <Toggle checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="دستیار فعال است" hint="اگر خاموش باشد، به بازدیدکننده پیشنهاد ثبت درخواست یا تماس داده می‌شود." />
        <Field label="سرویس‌دهنده">
          <Select
            value={f.provider}
            onChange={(e) => {
              const p = PROVIDERS.find((x) => x.id === e.target.value)!;
              setF({ ...f, provider: p.id as ProviderId, model: p.models[0], baseUrl: "" });
              setFallbacks(p.id === "google" ? "gemini-flash-lite-latest\ngemini-2.5-flash-lite" : "");
            }}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
          <p className="mt-2 text-xs leading-6 text-muted">
            {preset.note}{" "}
            {preset.keyUrl && (
              <a href={preset.keyUrl} target="_blank" rel="noreferrer" className="text-violet hover:text-pink">
                دریافت کلید ↗
              </a>
            )}
          </p>
        </Field>
        <Field label="کلید API" hint={f.hasKey ? `ذخیره‌شده ${f.apiKeyHint ?? ""}` : envKey ? "فعلاً از GEMINI_API_KEY محیط" : "تنظیم نشده"}>
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={f.hasKey ? "برای تغییر، کلید تازه را وارد کنید" : preset.hint} dir="ltr" autoComplete="off" />
          {f.hasKey && (
            <button type="button" className="mt-2 text-xs text-danger hover:underline" onClick={() => confirm("کلید ذخیره‌شده حذف شود؟") && run(() => saveAi({ ...f, fallbackModels: fallbacks.split(/\s+/).filter(Boolean), clearKey: true }), { onOk: () => setF({ ...f, hasKey: false }) })}>
              حذف کلید ذخیره‌شده
            </button>
          )}
        </Field>
        <Field label="مدل اصلی">
          <Input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} list="models" dir="ltr" />
          <datalist id="models">
            {preset.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label="مدل‌های جایگزین (وقتی سهمیه تمام شود)" hint="هر خط یک مدل">
          <Textarea value={fallbacks} onChange={(e) => setFallbacks(e.target.value)} rows={3} dir="ltr" className="font-mono text-sm" />
        </Field>
        <Field label="آدرس پایه‌ی API" hint="اختیاری">
          <Input value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} placeholder={f.provider === "openai" ? "https://api.openai.com/v1" : "پیش‌فرض سرویس"} dir="ltr" />
          <p className="mt-2 text-xs leading-6 text-muted">برای درگاه‌های واسط (Relay) یا سرویس‌های سازگار با OpenAI؛ اگر سایت روی سرور داخل ایران میزبانی شود، از یک درگاه واسط استفاده کنید.</p>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="دما (خلاقیت)" hint="۰ تا ۱٫۵">
            <Input type="number" step="0.1" min="0" max="1.5" value={f.temperature} onChange={(e) => setF({ ...f, temperature: Number(e.target.value) })} dir="ltr" />
          </Field>
          <Field label="حداکثر طول پاسخ (توکن)">
            <Input type="number" min="200" max="8000" value={f.maxTokens} onChange={(e) => setF({ ...f, maxTokens: Number(e.target.value) })} dir="ltr" />
          </Field>
        </div>
        <Field label="دستورهای تکمیلی برای دستیار" hint="اختیاری">
          <Textarea value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} rows={4} placeholder="مثلاً: در پایان پاسخ‌های فروش، جلسه‌ی معرفی رایگان را پیشنهاد کن." />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending}
            onClick={() =>
              run(() => saveAi({ ...f, fallbackModels: fallbacks.split(/\s+/).filter(Boolean), apiKey }), {
                onOk: () => {
                  if (apiKey) setF({ ...f, hasKey: true, apiKeyHint: `…${apiKey.slice(-4)}` });
                  setApiKey("");
                },
              })
            }
          >
            {pending && <Spinner />}
            ذخیره
          </Button>
          <Button variant="soft" disabled={pending} onClick={() => run(() => testAi({ provider: f.provider, model: f.model, baseUrl: f.baseUrl, apiKey: apiKey || undefined }), { silent: true, onOk: (r) => setTest({ answer: r.answer, model: r.model, ms: r.ms }) })}>
            آزمایش اتصال
          </Button>
        </div>
        {test && (
          <div className="rounded-2xl border border-success/30 bg-success/[0.06] p-4 text-sm leading-7">
            <div className="mb-1 text-xs text-success">
              ✓ اتصال برقرار است · <span className="ltr">{test.model}</span> · {new Intl.NumberFormat("fa-IR").format(test.ms)} میلی‌ثانیه
            </div>
            {test.answer}
          </div>
        )}
      </div>
    </Panel>
  );
}

export function ChatForm({ initial }: { initial: ChatSettings }) {
  const [f, setF] = useState(initial);
  const [sFa, setSFa] = useState(initial.suggestionsFa.join("\n"));
  const [sEn, setSEn] = useState(initial.suggestionsEn.join("\n"));
  const { pending, run } = useAction();
  return (
    <Panel title="گفتگو" sub="پیام خوشامد، پرسش‌های پیشنهادی صفحه‌ی اول و محدودیت استفاده برای جلوگیری از سوءاستفاده.">
      <div className="space-y-4">
        <Field label="پیام خوشامد (فارسی)">
          <Textarea value={f.greetingFa} onChange={(e) => setF({ ...f, greetingFa: e.target.value })} rows={2} />
        </Field>
        <Field label="Greeting (English)">
          <Textarea value={f.greetingEn} onChange={(e) => setF({ ...f, greetingEn: e.target.value })} rows={2} dir="ltr" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="پرسش‌های پیشنهادی" hint="هر خط یکی">
            <Textarea value={sFa} onChange={(e) => setSFa(e.target.value)} rows={5} />
          </Field>
          <Field label="Suggestions" hint="one per line">
            <Textarea value={sEn} onChange={(e) => setSEn(e.target.value)} rows={5} dir="ltr" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="پیام در ۱۰ دقیقه (هر بازدیدکننده)">
            <Input type="number" min="1" value={f.perTenMinutes} onChange={(e) => setF({ ...f, perTenMinutes: Number(e.target.value) })} dir="ltr" />
          </Field>
          <Field label="پیام در روز (هر بازدیدکننده)">
            <Input type="number" min="1" value={f.perDay} onChange={(e) => setF({ ...f, perDay: Number(e.target.value) })} dir="ltr" />
          </Field>
        </div>
        <Toggle checked={f.logChats} onChange={(v) => setF({ ...f, logChats: v })} label="ثبت گفتگوها برای نظارت" hint="پرسش و پاسخ‌ها (بدون IP) در «گفتگوهای دستیار» دیده می‌شوند." />
        <Button disabled={pending} onClick={() => run(() => saveChat({ ...f, suggestionsFa: sFa.split("\n").map((x) => x.trim()).filter(Boolean), suggestionsEn: sEn.split("\n").map((x) => x.trim()).filter(Boolean) }))}>
          {pending && <Spinner />}
          ذخیره
        </Button>
      </div>
    </Panel>
  );
}

export function SupportForm({ initial }: { initial: SupportSettings }) {
  const [f, setF] = useState(initial);
  const { pending, run } = useAction();
  return (
    <Panel title="پشتیبانی هوشمند">
      <div className="space-y-3">
        <Toggle checked={f.deflection} onChange={(v) => setF({ ...f, deflection: v })} label="پیشنهاد پاسخ پیش از ثبت تیکت" hint="اگر پاسخ در دانش پارس باشد، پیش از ثبت به مشتری نشان داده می‌شود." />
        <Toggle checked={f.triage} onChange={(v) => setF({ ...f, triage: v })} label="تحلیل خودکار تیکت‌ها" hint="دسته‌بندی، اولویت، لحن، خلاصه و پیش‌نویس پاسخ برای تیم." />
        <Button disabled={pending} onClick={() => run(() => saveSupport(f))}>
          ذخیره
        </Button>
      </div>
    </Panel>
  );
}
