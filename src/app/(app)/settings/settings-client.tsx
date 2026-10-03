"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  ExternalLink,
  FolderGit2,
  Home,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Server,
  SlidersHorizontal,
  Trash2,
  Unplug,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, Field, Input, Select, Spinner, Switch, Textarea } from "@/components/ui/primitives";
import { Modal, Tabs } from "@/components/ui/overlays";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import {
  connectGithubAction,
  deleteConnectionAction,
  disconnectGithubAction,
  refreshModelsAction,
  removeClaudeSecretAction,
  resyncWorkspaceAction,
  saveAiConnectionAction,
  saveUserConfigAction,
  setClaudeSecretAction,
  setModeAction,
  testConnectionAction,
  workspaceStatusAction,
} from "@/app/actions/settings";
import { PROVIDERS, providerPreset, type ProviderId } from "@/lib/ai/providers";
import { CLAUDE_EFFORTS, CLAUDE_MODELS, CLAUDE_THINKING, CLAUDE_THINKING_HINT } from "@/lib/claude/options";
import { timeAgo } from "@/lib/jalali";
import { cn, faNum } from "@/lib/utils";
import type { UserConfig } from "@/lib/settings";

export interface SettingsConnection {
  id: string;
  kind: "ai" | "github";
  provider: string;
  label: string;
  baseUrl: string | null;
  hint: string | null;
  status: "unchecked" | "ok" | "error";
  lastError: string | null;
  checkedAt: string | null;
  config: Record<string, unknown>;
}

type Check = { key: string; label: string; ok: boolean; detail?: string; level?: "error" | "warning" };

const GH_TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo,workflow&description=TaskFlow%20AI";

function StatusIcon({ ok, level }: { ok: boolean; level?: "error" | "warning" }) {
  if (ok) return <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />;
  return level === "warning" ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" /> : <XCircle className="mt-0.5 size-5 shrink-0 text-danger" />;
}

async function go<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>, msg?: string | ((d: T) => string)): Promise<T | null> {
  const r = await p;
  if (!r.ok) {
    toast.error(r.error);
    return null;
  }
  if (msg) toast.success(typeof msg === "function" ? msg(r.data) : msg);
  return r.data;
}

// ---------------------------------------------------------------- AI connection editor
function ConnectionDialog({ open, onOpenChange, edit }: { open: boolean; onOpenChange: (o: boolean) => void; edit: SettingsConnection | null }) {
  const [provider, setProvider] = React.useState<ProviderId>("google");
  const [label, setLabel] = React.useState("");
  const [key, setKey] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [fallbacks, setFallbacks] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setProvider((edit?.provider as ProviderId) ?? "google");
    setLabel(edit?.label ?? "");
    setKey("");
    setBaseUrl(edit?.baseUrl ?? "");
    setFallbacks(((edit?.config.fallbacks as string[] | undefined) ?? []).join(", "));
  }, [open, edit]);
  const p = providerPreset(provider);

  const save = async () => {
    if (!edit && !key.trim()) return toast.error("کلید API را وارد کنید");
    if (provider === "custom" && !baseUrl.trim()) return toast.error("آدرس پایه‌ی API را وارد کنید");
    setBusy(true);
    const r = await saveAiConnectionAction({
      id: edit?.id ?? null,
      provider,
      label: label.trim() || p.label,
      apiKey: key.trim() || undefined,
      baseUrl: provider === "custom" ? baseUrl.trim() : null,
      fallbacks: fallbacks.split(",").map((s) => s.trim()).filter(Boolean),
    });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    if (r.data.warning) toast.warning(`ذخیره شد، اما: ${r.data.warning}`);
    else toast.success(`اتصال ذخیره شد — ${faNum(r.data.models)} مدل در دسترس`);
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={edit ? `ویرایش «${edit.label}»` : "افزودن کلید هوش مصنوعی"}
      description="کلید رمزنگاری‌شده ذخیره می‌شود و هیچ‌وقت به مرورگر برنمی‌گردد. فقط کارهای خودتان با آن اجرا می‌شوند."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            <Save className="size-4" /> ذخیره و بررسی کلید
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!edit ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {PROVIDERS.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => setProvider(x.id)}
                className={cn("rounded-xl border p-3 text-start transition", provider === x.id ? "border-primary bg-primary-soft" : "border-line hover:bg-surface-muted")}
              >
                <p className="flex items-center gap-2 text-sm font-bold">
                  {x.label} {x.free ? <Badge tone="success">رایگان</Badge> : null}
                  {x.id === "anthropic" ? <Badge tone="violet">بهترین</Badge> : null}
                </p>
              </button>
            ))}
          </div>
        ) : null}
        <p className="rounded-xl bg-surface-muted p-3 text-xs leading-6 text-muted">
          {p.note}{" "}
          {p.keyUrl ? (
            <a href={p.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-primary">
              دریافت کلید <ExternalLink className="size-3" />
            </a>
          ) : null}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="نام نمایشی">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={p.label} />
          </Field>
          <Field label={edit ? "کلید API جدید (خالی = بدون تغییر)" : "کلید API"} required={!edit}>
            <Input dir="ltr" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={edit?.hint ? `${edit.hint}` : p.keyHint} />
          </Field>
        </div>
        {provider === "custom" ? (
          <Field label="آدرس پایه‌ی API" hint="مثلاً https://example.com/v1" required>
            <Input dir="ltr" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </Field>
        ) : null}
        <Field label="مدل‌های جایگزین (اختیاری)" hint="اگر مدل انتخابی شلوغ بود یا سقف مصرفش پر شد، به ترتیب این‌ها امتحان می‌شوند؛ با ویرگول جدا کنید.">
          <Input dir="ltr" value={fallbacks} onChange={(e) => setFallbacks(e.target.value)} placeholder={p.protocol === "google" ? "gemini-flash-latest" : ""} />
        </Field>
      </div>
    </Modal>
  );
}

function ConnectionCard({ c, onEdit }: { c: SettingsConnection; onEdit: () => void }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const models = (c.config.models as string[] | undefined) ?? [];
  const p = providerPreset(c.provider);
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-500/12 text-violet-600 dark:text-violet-300">
          <Cpu className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-extrabold">{c.label}</p>
          <p className="text-xs text-muted">
            {p.label} · <span className="ltr font-mono">{c.hint ?? "••••"}</span>
          </p>
        </div>
        {c.status === "ok" ? (
          <Badge tone="success" dot>
            سالم
          </Badge>
        ) : c.status === "error" ? (
          <Badge tone="danger" dot>
            خطا
          </Badge>
        ) : (
          <Badge>بررسی نشده</Badge>
        )}
      </div>
      {c.lastError && c.status === "error" ? <p className="mt-2 rounded-lg bg-rose-500/8 px-2.5 py-1.5 text-xs text-danger">{c.lastError}</p> : null}
      <p className="mt-2 text-xs text-muted">
        {faNum(models.length)} مدل در دسترس{c.checkedAt ? ` · بررسی ${timeAgo(c.checkedAt)}` : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
        <Button
          size="sm"
          variant="secondary"
          loading={busy === "test"}
          onClick={async () => {
            setBusy("test");
            await go(testConnectionAction(c.id), (d) => `پاسخ ${d.model} در ${faNum(Math.round(d.ms / 100) / 10)} ثانیه: ${d.text}`);
            setBusy(null);
          }}
        >
          <Zap className="size-4" /> آزمایش
        </Button>
        <Button
          size="sm"
          variant="ghost"
          loading={busy === "models"}
          onClick={async () => {
            setBusy("models");
            await go(refreshModelsAction(c.id), (d) => `${faNum(d.length)} مدل خوانده شد`);
            setBusy(null);
          }}
        >
          <RefreshCw className="size-4" /> فهرست مدل‌ها
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <Pencil className="size-4" /> ویرایش
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ms-auto text-danger"
          onClick={async () => {
            if (!window.confirm(`اتصال «${c.label}» حذف شود؟ مراحلی که از آن استفاده می‌کنند خالی می‌شوند.`)) return;
            await go(deleteConnectionAction(c.id), "حذف شد");
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- stage models
function modelOptions(c: SettingsConnection | undefined, current: string): ComboOption[] {
  if (!c) return [];
  const p = providerPreset(c.provider);
  const list = [...new Set([...(p.protocol === "google" ? ["auto", "auto-lite"] : []), ...((c.config.models as string[] | undefined) ?? []), ...p.suggested, ...(current ? [current] : [])])];
  return list.map((m) => ({
    value: m,
    label: m,
    ltr: true,
    hint: m === "auto" ? "جدیدترین Flash رایگان" : m === "auto-lite" ? "جدیدترین Flash Lite" : undefined,
  }));
}

function StagePicker({
  title,
  hint,
  value,
  onChange,
  connections,
  allowEmpty,
}: {
  title: string;
  hint: string;
  value: { connectionId: string | null; model: string };
  onChange: (v: { connectionId: string | null; model: string }) => void;
  connections: SettingsConnection[];
  allowEmpty?: string;
}) {
  const conn = connections.find((c) => c.id === value.connectionId);
  return (
    <div className="rounded-2xl border border-line p-4">
      <p className="text-sm font-extrabold">{title}</p>
      <p className="mb-3 mt-0.5 text-xs text-muted">{hint}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="اتصال">
          <Select value={value.connectionId ?? ""} onChange={(e) => onChange({ connectionId: e.target.value || null, model: "" })}>
            <option value="">{allowEmpty ?? "— انتخاب کنید —"}</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="مدل" hint="خالی = مدل پیشنهادی همان اتصال">
          <Combobox
            disabled={!conn}
            options={modelOptions(conn, value.model)}
            value={value.model ? [value.model] : []}
            onChange={(v) => onChange({ ...value, model: v[0] ?? "" })}
            placeholder={conn ? "مدل پیشنهادی" : "اول اتصال را انتخاب کنید"}
            searchPlaceholder="جستجو یا نوشتن نام مدل…"
            create={{ label: (q) => `استفاده از «${q}»`, onCreate: (q) => onChange({ ...value, model: q.trim() }) }}
          />
        </Field>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- GitHub
function GithubSection({ github, anthropic, templateVersion }: { github: SettingsConnection | undefined; anthropic: SettingsConnection[]; templateVersion: string }) {
  const [token, setToken] = React.useState("");
  const [repo, setRepo] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [checks, setChecks] = React.useState<Check[] | null>(null);
  const [oauth, setOauth] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const cfg = (github?.config ?? {}) as { owner?: string; repo?: string; login?: string; templateVersion?: string; claudeCode?: boolean };

  const loadChecks = React.useCallback(async () => {
    setChecks(null);
    const r = await workspaceStatusAction();
    setChecks(r.ok ? r.data : [{ key: "x", label: "بررسی ناموفق", ok: false, detail: r.error }]);
  }, []);
  React.useEffect(() => {
    if (github) void loadChecks();
  }, [github, loadChecks]);

  if (!github) {
    return (
      <Card className="p-5">
        <CardHeader title="اتصال GitHub" subtitle="برای پروژه‌ها، دانش، گراف و اجرای Claude Code" icon={<FolderGit2 className="size-4" />} className="-m-5 mb-4" />
        <ol className="mb-4 list-decimal space-y-1.5 ps-5 text-sm leading-7 text-muted">
          <li>
            یک توکن GitHub با دسترسی <span className="ltr font-mono">repo</span> و <span className="ltr font-mono">workflow</span> بسازید:{" "}
            <a href={GH_TOKEN_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-primary">
              ساخت توکن <ExternalLink className="size-3" />
            </a>
          </li>
          <li>توکن را این‌جا وارد کنید؛ اپ یک مخزن خصوصی به نام دلخواه (پیش‌فرض taskflow-workspace) در حساب شما می‌سازد و فایل‌های اجرا را در آن قرار می‌دهد.</li>
          <li>پروژه‌ها، فایل دانش، گراف و سوابق تسک‌ها فقط در همین مخزن شما ذخیره می‌شوند.</li>
        </ol>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="توکن GitHub" required>
            <Input dir="ltr" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_… یا github_pat_…" />
          </Field>
          <Field label="نام مخزن (اختیاری)" hint="خالی = taskflow-workspace؛ برای مخزن یک سازمان: org/name">
            <Input dir="ltr" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="taskflow-workspace" />
          </Field>
        </div>
        <Button
          className="mt-4"
          loading={busy === "connect"}
          onClick={async () => {
            setBusy("connect");
            await go(connectGithubAction(token, repo || undefined), (d) => (d.created ? `مخزن ${d.repo} ساخته و آماده شد` : `به ${d.repo} وصل شد`));
            setBusy(null);
          }}
        >
          <FolderGit2 className="size-4" /> اتصال و آماده‌سازی مخزن
        </Button>
      </Card>
    );
  }

  const outdated = cfg.templateVersion !== templateVersion;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="GitHub"
          subtitle={
            <a href={`https://github.com/${cfg.owner}/${cfg.repo}`} target="_blank" rel="noreferrer" className="ltr inline-flex items-center gap-1 font-mono text-primary">
              {cfg.owner}/{cfg.repo} <ExternalLink className="size-3" />
            </a>
          }
          icon={<FolderGit2 className="size-4" />}
          actions={
            <Button size="sm" variant="ghost" onClick={() => void loadChecks()}>
              <RefreshCw className="size-4" />
            </Button>
          }
        />
        <div className="divide-y divide-line">
          {!checks ? (
            <div className="p-5">
              <Spinner />
            </div>
          ) : (
            checks.map((c) => (
              <div key={c.key} className="flex items-start gap-3 px-5 py-3">
                <StatusIcon ok={c.ok} level={c.level} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{c.label}</p>
                  {c.detail ? <p className="mt-0.5 break-words text-xs text-muted">{c.detail}</p> : null}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line p-4">
          <Button
            size="sm"
            variant={outdated ? "primary" : "secondary"}
            loading={busy === "sync"}
            onClick={async () => {
              setBusy("sync");
              await go(resyncWorkspaceAction(), (d) => `${faNum(d.files)} فایل همگام شد`);
              setBusy(null);
              void loadChecks();
            }}
          >
            <RefreshCw className="size-4" /> {outdated ? "به‌روزرسانی فایل‌های اجرا (نسخه‌ی جدید)" : "همگام‌سازی دوباره"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ms-auto text-danger"
            onClick={async () => {
              if (!window.confirm("اتصال GitHub قطع شود؟ مخزن و فایل‌هایش در GitHub باقی می‌مانند.")) return;
              await go(disconnectGithubAction(), "قطع شد");
            }}
          >
            <Unplug className="size-4" /> قطع اتصال
          </Button>
        </div>
        <div className="border-t border-line p-4">
          <Field label="تعویض توکن (اختیاری)">
            <div className="flex gap-2">
              <Input dir="ltr" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="توکن جدید" />
              <Button
                variant="secondary"
                disabled={!token.trim()}
                loading={busy === "connect"}
                onClick={async () => {
                  setBusy("connect");
                  if (await go(connectGithubAction(token, `${cfg.owner}/${cfg.repo}`), "توکن به‌روز شد")) setToken("");
                  setBusy(null);
                }}
              >
                ذخیره
              </Button>
            </div>
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <p className="flex items-center gap-2 font-extrabold">
          <KeyRound className="size-4" /> Claude Code در GitHub Actions {cfg.claudeCode ? <Badge tone="success">فعال</Badge> : <Badge>غیرفعال</Badge>}
        </p>
        <p className="mt-1 text-xs leading-6 text-muted">
          اختیاری: کار اصلی می‌تواند به‌جای مجری داخل اپ با Claude Code روی GitHub Actions مخزن شما اجرا شود. توکن اشتراک Claude را با دستور <span className="ltr font-mono">claude setup-token</span> روی کامپیوتر خودتان بسازید، یا یک کلید API
          Anthropic بدهید. این مقدار فقط به‌صورت Secret در مخزن شما ذخیره می‌شود.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="توکن اشتراک Claude (CLAUDE_CODE_OAUTH_TOKEN)">
            <Input dir="ltr" type="password" autoComplete="off" value={oauth} onChange={(e) => setOauth(e.target.value)} placeholder="sk-ant-oat…" />
          </Field>
          <Field label="یا کلید API (ANTHROPIC_API_KEY)">
            <Input dir="ltr" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-ant-…" />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!oauth.trim() && !apiKey.trim()}
            loading={busy === "claude"}
            onClick={async () => {
              setBusy("claude");
              if (await go(setClaudeSecretAction({ oauthToken: oauth || undefined, apiKey: apiKey || undefined }), "Claude Code فعال شد")) {
                setOauth("");
                setApiKey("");
              }
              setBusy(null);
              void loadChecks();
            }}
          >
            <Save className="size-4" /> ذخیره در Secrets مخزن
          </Button>
          {anthropic.map((a) => (
            <Button
              key={a.id}
              size="sm"
              variant="secondary"
              loading={busy === `use-${a.id}`}
              onClick={async () => {
                setBusy(`use-${a.id}`);
                await go(setClaudeSecretAction({ connectionId: a.id }), "Claude Code با کلید Anthropic شما فعال شد");
                setBusy(null);
                void loadChecks();
              }}
            >
              استفاده از کلید «{a.label}»
            </Button>
          ))}
          {cfg.claudeCode ? (
            <Button size="sm" variant="ghost" className="text-danger" onClick={async () => void (await go(removeClaudeSecretAction(), "غیرفعال شد"))}>
              غیرفعال کردن
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- page
export function SettingsClient({ config, connections, isOwner, templateVersion }: { config: UserConfig; connections: SettingsConnection[]; isOwner: boolean; templateVersion: string }) {
  const router = useRouter();
  const [cfg, setCfg] = React.useState<UserConfig>(config);
  const [dialog, setDialog] = React.useState<{ edit: SettingsConnection | null } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [tab, setTab] = React.useState(() => (connections.some((c) => c.kind === "ai") ? "stages" : "connections"));
  React.useEffect(() => setCfg(config), [config]);

  const ai = connections.filter((c) => c.kind === "ai");
  const github = connections.find((c) => c.kind === "github");
  const claudeCode = !!(github?.config as { claudeCode?: boolean } | undefined)?.claudeCode;
  const dirty = JSON.stringify(cfg) !== JSON.stringify(config);

  const save = async () => {
    setSaving(true);
    await go(saveUserConfigAction(cfg), "تنظیمات ذخیره شد");
    setSaving(false);
  };
  const set = <K extends keyof UserConfig>(k: K, v: Partial<UserConfig[K]>) => setCfg((p) => ({ ...p, [k]: typeof p[k] === "object" ? { ...(p[k] as object), ...v } : v }) as UserConfig);
  const setStage = (k: "prework" | "main" | "knowledge", v: Partial<UserConfig["stages"]["main"]>) => setCfg((p) => ({ ...p, stages: { ...p.stages, [k]: { ...p.stages[k], ...v } } }));

  const saveBar = dirty ? (
    <div className="glass sticky bottom-24 z-20 flex items-center gap-3 rounded-2xl px-4 py-3 lg:bottom-4">
      <span className="text-sm font-bold">تغییرات ذخیره نشده</span>
      <Button className="ms-auto" loading={saving} onClick={() => void save()}>
        <Save className="size-4" /> ذخیره
      </Button>
      <Button variant="ghost" onClick={() => setCfg(config)}>
        لغو
      </Button>
    </div>
  ) : null;

  const connectionsTab = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted">کلیدهای هوش مصنوعی خودتان را وصل کنید؛ هر مرحله (پیش‌کار، کار اصلی، دانش) می‌تواند از اتصال و مدل جداگانه استفاده کند.</p>
        <Button className="ms-auto" onClick={() => setDialog({ edit: null })}>
          <Plus className="size-4" /> افزودن کلید
        </Button>
      </div>
      {ai.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ai.map((c) => (
            <ConnectionCard key={c.id} c={c} onEdit={() => setDialog({ edit: c })} />
          ))}
        </div>
      ) : (
        <Card className="p-6 text-sm leading-7 text-muted">
          هنوز کلیدی وصل نشده است. پیشنهاد: <b className="text-fg">Claude (Anthropic)</b> برای بهترین کیفیت، یا <b className="text-fg">Google AI Studio</b> / <b className="text-fg">NVIDIA</b> برای شروع رایگان.
        </Card>
      )}
      <ConnectionDialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)} edit={dialog?.edit ?? null} />
    </div>
  );

  const stagesTab = (
    <div className="space-y-4">
      {!ai.length ? (
        <Card className="p-5 text-sm">
          اول در زبانه‌ی «کلیدهای هوش مصنوعی» یک اتصال اضافه کنید.
        </Card>
      ) : null}
      <StagePicker
        title="پیش‌کار"
        hint="فهم درخواست و فایل‌ها و آماده کردن دستور کار؛ مدل سریع و ارزان کافی است."
        value={cfg.stages.prework}
        onChange={(v) => setStage("prework", v)}
        connections={ai}
      />
      <div className="space-y-3 rounded-2xl border border-line p-4">
        <p className="text-sm font-extrabold">کار اصلی</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              { k: "agent", t: "مجری داخل اپ", d: "با هر کلیدی کار می‌کند؛ فایل‌ها را پیدا، ویرایش، ایجاد و در GitHub ثبت می‌کند. بهترین نتیجه با Claude." },
              { k: "claude_code", t: "Claude Code (GitHub Actions)", d: claudeCode ? "روی Actions مخزن شما با اشتراک یا کلید Claude اجرا می‌شود." : "ابتدا در زبانه‌ی GitHub فعالش کنید." },
            ] as const
          ).map((o) => (
            <button
              key={o.k}
              type="button"
              disabled={o.k === "claude_code" && !claudeCode}
              onClick={() => setStage("main", { engine: o.k })}
              className={cn("rounded-xl border p-3 text-start transition disabled:opacity-50", cfg.stages.main.engine === o.k ? "border-primary bg-primary-soft" : "border-line hover:bg-surface-muted")}
            >
              <p className="text-sm font-bold">{o.t}</p>
              <p className="mt-1 text-xs leading-5 text-muted">{o.d}</p>
            </button>
          ))}
        </div>
        {cfg.stages.main.engine === "agent" ? (
          <StagePicker title="مدل مجری" hint="مدلی که از ابزار (tool calling) پشتیبانی کند؛ برای کد، Claude بهترین است." value={cfg.stages.main} onChange={(v) => setStage("main", v)} connections={ai} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="مدل Claude Code">
              <Select value={cfg.claude.model} onChange={(e) => set("claude", { model: e.target.value })}>
                {CLAUDE_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Effort">
              <Select value={cfg.claude.effort} onChange={(e) => set("claude", { effort: e.target.value as UserConfig["claude"]["effort"] })}>
                {CLAUDE_EFFORTS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Thinking" hint={CLAUDE_THINKING_HINT}>
              <Select value={cfg.claude.thinking} onChange={(e) => set("claude", { thinking: e.target.value as UserConfig["claude"]["thinking"] })}>
                {CLAUDE_THINKING.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </div>
      <StagePicker
        title="دانش پروژه و خلاصه‌ی فایل‌ها"
        hint="به‌روز کردن فایل KNOWLEDGE.md پروژه بعد از هر کار و خلاصه‌ی فایل‌های واردشده."
        value={cfg.stages.knowledge}
        onChange={(v) => setStage("knowledge", v)}
        connections={ai}
        allowEmpty="مثل پیش‌کار"
      />
      {saveBar}
    </div>
  );

  const defaultsTab = (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <Field label="درباره‌ی کار شما" hint="به دستورالعمل همه‌ی ایجنت‌ها اضافه می‌شود: حوزه‌ی کاری، سازمان، زبان و قراردادهای مهم. (فقط برای خودتان)">
          <Textarea className="min-h-28" value={cfg.about} onChange={(e) => set("about", e.target.value as never)} placeholder="مثلاً: توسعه‌دهنده‌ی وب در یک سازمان؛ خروجی‌ها فارسی؛ کدها با TypeScript…" />
        </Field>
        <Field label="پرامپت پیش‌فرض پیش‌کار" hint="وقتی هنگام ارسال پرامپتی ننویسید">
          <Textarea className="min-h-24" value={cfg.prework.defaultPrompt} onChange={(e) => set("prework", { defaultPrompt: e.target.value })} />
        </Field>
        <Field label="پرامپت پیش‌فرض کار اصلی">
          <Textarea className="min-h-24" value={cfg.main.defaultPrompt} onChange={(e) => set("main", { defaultPrompt: e.target.value })} />
        </Field>
      </Card>
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="سطح تفکر مدل‌ها">
          <Select value={cfg.pipeline.thinking} onChange={(e) => set("pipeline", { thinking: e.target.value as UserConfig["pipeline"]["thinking"] })}>
            <option value="LOW">کم (سریع)</option>
            <option value="MEDIUM">متوسط</option>
            <option value="HIGH">زیاد (دقیق)</option>
          </Select>
        </Field>
        <Field label="حداکثر فایل کمکی پیش‌کار">
          <Input type="number" min={0} max={10} value={cfg.pipeline.maxHelperFiles} onChange={(e) => set("pipeline", { maxHelperFiles: Number(e.target.value) })} />
        </Field>
        <Field label="حداکثر گام‌های مجری در هر اجرا" hint="هر گام = یک بار خواندن/جستجو/ویرایش">
          <Input type="number" min={5} max={200} value={cfg.pipeline.maxAgentTurns} onChange={(e) => set("pipeline", { maxAgentTurns: Number(e.target.value) })} />
        </Field>
        <Field label="حافظه‌ی گفت‌وگوی تسک (کاراکتر)" hint="پرامپت‌ها و پاسخ‌های قبلی همین تسک در اجرای بعد">
          <Input type="number" min={0} max={200000} step={5000} value={cfg.pipeline.historyChars} onChange={(e) => set("pipeline", { historyChars: Number(e.target.value) })} />
        </Field>
        <div className="space-y-2.5 sm:col-span-2">
          <Switch checked={cfg.pipeline.useSearch} onChange={(v) => set("pipeline", { useSearch: v })} label="جستجوی گوگل برای ایجنت‌های پیش‌کار (فقط مدل‌های Gemini)" />
          <Switch checked={cfg.knowledge.autoUpdate} onChange={(v) => set("knowledge", { autoUpdate: v })} label="به‌روزرسانی خودکار فایل دانش پروژه بعد از هر کار" />
          <Switch checked={cfg.claude.resumeSessions} onChange={(v) => set("claude", { resumeSessions: v })} label="Claude Code: ادامه‌ی همان جلسه در دستورهای تکمیلی" />
        </div>
        <Field label="graphify (گراف پروژه‌ها)" hint="با کلید Gemini شما در GitHub Actions اجرا می‌شود؛ بدون آن فقط کد تحلیل می‌شود.">
          <Select value={cfg.graphify.mode} onChange={(e) => set("graphify", { mode: e.target.value as UserConfig["graphify"]["mode"] })}>
            <option value="llm">کامل (کد + اسناد)</option>
            <option value="code-only">فقط کد</option>
            <option value="off">خاموش</option>
          </Select>
        </Field>
        <Field label="Claude Code: حداکثر گام‌ها">
          <Input type="number" min={10} max={1000} value={cfg.claude.maxTurns} onChange={(e) => set("claude", { maxTurns: Number(e.target.value) })} />
        </Field>
      </Card>
      {saveBar}
    </div>
  );

  const modeTab = (
    <div className="space-y-4">
      {!isOwner ? (
        <Card className="p-5">
          <p className="flex items-center gap-2 font-extrabold">
            <Home className="size-4" /> بازگشت به حالت ساده
          </p>
          <p className="mt-1 text-sm leading-7 text-muted">
            در حالت ساده فقط تسک می‌دهید، تسک‌های سپرده به خودتان را می‌بینید و وضعیتشان را دستی به‌روز می‌کنید. اتصال‌ها، پروژه‌ها و تنظیمات شما پاک نمی‌شوند و هر وقت خواستید برمی‌گردید.
          </p>
          <Button
            className="mt-3"
            variant="secondary"
            onClick={async () => {
              const d = await go(setModeAction("simple"), "به حالت ساده رفتید");
              if (d) {
                router.push(d.redirect);
                router.refresh();
              }
            }}
          >
            <Home className="size-4" /> رفتن به حالت ساده
          </Button>
        </Card>
      ) : (
        <Card className="p-5">
          <p className="flex items-center gap-2 font-extrabold">
            <Server className="size-4" /> مدیریت اپ
          </p>
          <p className="mt-1 text-sm text-muted">تنظیمات Vercel و Supabase، زمان‌بند، صف‌ها، ثبت‌نام و کاربران فقط برای مالک در بخش «سیستم و سرویس‌ها» است.</p>
          <Link href="/system">
            <Button className="mt-3" variant="secondary">
              <Server className="size-4" /> سیستم و سرویس‌ها
            </Button>
          </Link>
        </Card>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black">
          <SlidersHorizontal className="size-6 text-primary" /> تنظیمات و اتصال‌ها
        </h1>
        <p className="mt-1 text-sm text-muted">همه‌ی این تنظیمات شخصی‌اند: کلیدها، مخزن GitHub، مدل‌ها و ایجنت‌های شما فقط برای کارهای خودتان استفاده می‌شوند.</p>
      </div>
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "connections", label: "کلیدهای هوش مصنوعی", badge: ai.length ? <span className="rounded-full bg-surface-muted px-1.5 text-[10.5px]">{faNum(ai.length)}</span> : null, content: connectionsTab },
          { value: "stages", label: "مدل هر مرحله", content: stagesTab },
          { value: "github", label: "GitHub و Claude Code", content: <GithubSection github={github} anthropic={ai.filter((c) => c.provider === "anthropic")} templateVersion={templateVersion} /> },
          { value: "defaults", label: "پیش‌فرض‌ها", content: defaultsTab },
          { value: "mode", label: isOwner ? "مدیریت اپ" : "حالت اپ", content: modeTab },
        ]}
      />
    </div>
  );
}
