"use client";
import * as React from "react";
import { PageHeader, SECTIONS } from "@/components/shell/page-header";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Clock, KeyRound, Layers, RefreshCw, Save, Server, Users, XCircle } from "lucide-react";
import { Badge, Button, Card, CardHeader, Field, Input, Select, Spinner, Switch } from "@/components/ui/primitives";
import { SpeedCard } from "@/components/settings/speed-card";
import { configureSchedulerAction, saveLaneAction, saveSystemSettingsAction, setAppSecretsAction, systemStatusAction } from "@/app/actions/owner";
import { timeAgo } from "@/lib/jalali";
import { faNum } from "@/lib/utils";
import type { SystemSettings } from "@/lib/settings";

export interface LaneRow {
  lane: "llm" | "external" | "system";
  max_running: number;
  per_owner: number;
  paused: boolean;
  stats: Record<string, unknown>;
  updated_at: string;
}

type Status = Awaited<ReturnType<typeof systemStatusAction>>;

const LANE_META: Record<LaneRow["lane"], { title: string; hint: string }> = {
  llm: { title: "اجرای مدل‌ها (داخل اپ)", hint: "پیش‌کار، مجری داخل اپ، دانش و خلاصه‌ها — با کلیدهای هر کاربر" },
  external: { title: "GitHub Actions", hint: "Claude Code و graphify در مخزن هر کاربر (فقط پیگیری)" },
  system: { title: "کارهای سیستمی", hint: "ورود فایل‌های پروژه، ارتقای اپ و نگهداری" },
};

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

function LaneCard({ lane }: { lane: LaneRow }) {
  const [max, setMax] = React.useState(lane.max_running);
  const [per, setPer] = React.useState(lane.per_owner);
  const [busy, setBusy] = React.useState(false);
  const meta = LANE_META[lane.lane];
  const save = async (patch: { max_running?: number; per_owner?: number; paused?: boolean }) => {
    setBusy(true);
    const r = await saveLaneAction(lane.lane, patch);
    setBusy(false);
    if (r.ok) toast.success("ذخیره شد");
    else toast.error(r.error);
  };
  return (
    <Card className="p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-extrabold">{meta.title}</p>
          <p className="text-xs text-muted">{meta.hint}</p>
        </div>
        {lane.paused ? (
          <Badge tone="warning" dot>
            متوقف
          </Badge>
        ) : (
          <Badge tone="success" dot>
            فعال
          </Badge>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="هم‌زمان برای همه">
          <Input type="number" min={1} max={200} value={max} onChange={(e) => setMax(Number(e.target.value))} />
        </Field>
        <Field label="هم‌زمان برای هر کاربر">
          <Input type="number" min={1} max={10} value={per} onChange={(e) => setPer(Number(e.target.value))} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" loading={busy} disabled={max === lane.max_running && per === lane.per_owner} onClick={() => void save({ max_running: max, per_owner: per })}>
          <Save className="size-4" /> ذخیره
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void save({ paused: !lane.paused })}>
          {lane.paused ? "ادامه" : "توقف همه"}
        </Button>
      </div>
    </Card>
  );
}

/** Problems first; the healthy ones fold into one line. */
function ServiceRows({ rows }: { rows: { key: string; ok: boolean; label: string; detail?: string; level?: "warning" | "error" }[] }) {
  const [all, setAll] = React.useState(false);
  const bad = rows.filter((r) => !r.ok);
  const good = rows.filter((r) => r.ok);
  return (
    <div className="divide-y divide-line">
      {bad.map((r) => (
        <Row key={r.key} ok={false} label={r.label} detail={r.detail} level={r.level} />
      ))}
      {all ? good.map((r) => <Row key={r.key} ok label={r.label} detail={r.detail} />) : null}
      <button type="button" onClick={() => setAll((v) => !v)} className="flex w-full items-center gap-3 px-5 py-3 text-start text-sm font-semibold text-success hover:bg-surface-muted">
        <CheckCircle2 className="size-5 shrink-0" />
        {all ? "پنهان کردن موارد سالم" : `${faNum(good.length)} مورد سالم`}
      </button>
    </div>
  );
}

export function SystemClient({
  settings: initial,
  lanes,
  info,
  stats,
}: {
  settings: SystemSettings;
  lanes: LaneRow[];
  info: { appUrl: string; budget: number; appRepo: string | null };
  stats: { users: number; pending: number; full: number; withAi: number; withGithub: number };
}) {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [settings, setSettings] = React.useState(initial);
  const [interval, setInterval_] = React.useState("30 seconds");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [secrets, setSecrets] = React.useState({ claudeToken: "", anthropicKey: "", dbUrl: "" });

  const load = React.useCallback(async () => {
    setStatus(null);
    setStatus(await systemStatusAction());
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = async (patch: Partial<SystemSettings>) => {
    const r = await saveSystemSettingsAction(patch);
    if (r.ok) {
      setSettings(r.data);
      toast.success("ذخیره شد");
    } else toast.error(r.error);
  };
  const lastTick = lanes.find((l) => l.lane === "system")?.stats?.last_tick_at as string | undefined;

  return (
    <div className="space-y-5">
      <PageHeader title="مدیریت" tabs={SECTIONS.admin} />

      <Card className="grid grid-cols-2 divide-line sm:grid-cols-5 sm:divide-x sm:divide-x-reverse">
        {[
          { label: "کاربران فعال", value: stats.users },
          { label: "منتظر تایید", value: stats.pending },
          { label: "حالت کامل", value: stats.full },
          { label: "با کلید هوش مصنوعی", value: stats.withAi },
          { label: "با GitHub", value: stats.withGithub },
        ].map((k) => (
          <div key={k.label} className="px-4 py-3">
            <p className="text-xs text-muted">{k.label}</p>
            <p className="mt-0.5 text-xl font-black">{faNum(k.value)}</p>
          </div>
        ))}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="وضعیت سرویس‌ها"
            icon={<Server className="size-4" />}
            actions={
              <Button size="sm" variant="ghost" onClick={() => void load()}>
                <RefreshCw className="size-4" />
              </Button>
            }
          />
          {!status ? (
            <div className="p-5">
              <Spinner />
            </div>
          ) : !status.ok ? (
            <p className="p-5 text-sm text-danger">{status.error}</p>
          ) : (
            <ServiceRows
              rows={[
                ...status.data.env.map((e) => ({ key: e.key, ok: e.ok, label: `${e.label} (${e.key})`, detail: e.ok ? undefined : e.hint, level: (e.optional ? "warning" : "error") as "warning" | "error" })),
                ...status.data.checks.map((c) => ({ key: c.key, ok: c.ok, label: c.label, detail: c.detail, level: c.level })),
              ]}
            />
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <p className="flex items-center gap-2 font-extrabold">
              <Clock className="size-4" /> زمان‌بند ورکر (pg_cron)
            </p>
            <p className="mt-1 text-xs text-muted">آخرین اجرا: {lastTick ? timeAgo(lastTick) : "هنوز"}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Select value={interval} onChange={(e) => setInterval_(e.target.value)} className="w-48">
                <option value="20 seconds">هر ۲۰ ثانیه</option>
                <option value="30 seconds">هر ۳۰ ثانیه</option>
                <option value="1 minute">هر دقیقه</option>
              </Select>
              <Button
                loading={busy === "sched"}
                onClick={async () => {
                  setBusy("sched");
                  const r = await configureSchedulerAction(interval);
                  setBusy(null);
                  if (r.ok) {
                    toast.success("زمان‌بند فعال شد");
                    void load();
                  } else toast.error(r.error);
                }}
              >
                فعال‌سازی / به‌روزرسانی
              </Button>
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <p className="flex items-center gap-2 font-extrabold">
              <Users className="size-4" /> ثبت‌نام
            </p>
            <Switch
              checked={settings.registration.autoApprove}
              onChange={(v) => void saveSettings({ registration: { autoApprove: v } })}
              label="فعال شدن کاربران جدید بدون تایید"
            />
          </Card>
        </div>
      </div>

      <div>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-black">
          <Layers className="size-5" /> ظرفیت اجرا
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {lanes.map((l) => (
            <LaneCard key={l.lane} lane={l} />
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SpeedCard />
        <Card className="p-5">
          <p className="flex items-center gap-2 font-extrabold">
            <KeyRound className="size-4" /> Secrets مخزن اپ (ارتقای خودکار)
          </p>
          <p className="mt-1 text-xs text-muted">
            {info.appRepo ? <span className="ltr font-mono">{info.appRepo}</span> : "GITHUB_TOKEN، GITHUB_OWNER و GITHUB_APP_REPO در Vercel تنظیم نشده"}
          </p>
          <div className="mt-3 space-y-3">
            <Field label="CLAUDE_CODE_OAUTH_TOKEN">
              <Input dir="ltr" type="password" autoComplete="off" value={secrets.claudeToken} onChange={(e) => setSecrets((s) => ({ ...s, claudeToken: e.target.value }))} />
            </Field>
            <Field label="یا ANTHROPIC_API_KEY">
              <Input dir="ltr" type="password" autoComplete="off" value={secrets.anthropicKey} onChange={(e) => setSecrets((s) => ({ ...s, anthropicKey: e.target.value }))} />
            </Field>
            <Field label="SUPABASE_DB_URL (migrationها)">
              <Input dir="ltr" type="password" autoComplete="off" value={secrets.dbUrl} onChange={(e) => setSecrets((s) => ({ ...s, dbUrl: e.target.value }))} />
            </Field>
            <Button
              disabled={!info.appRepo}
              loading={busy === "secrets"}
              onClick={async () => {
                setBusy("secrets");
                const r = await setAppSecretsAction(secrets);
                setBusy(null);
                if (r.ok) {
                  toast.success(`ثبت شد: ${r.data.join("، ")}`);
                  setSecrets({ claudeToken: "", anthropicKey: "", dbUrl: "" });
                  void load();
                } else toast.error(r.error);
              }}
            >
              <Save className="size-4" /> ثبت در GitHub
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
