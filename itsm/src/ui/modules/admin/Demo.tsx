// «داده‌های نمایشی» (docs/DEMO_FA.md): the fictional «بانک نمونهٔ آفتاب» for presenting the product — load it with a
// size, see what it holds and the personas to sign in as, and remove it completely: a pre-purge report (what goes,
// the real records that refer to it), a typed confirmation and the platform's re-authentication, then a progress bar
// and the result. Only content-free audit lines remain.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Input, Modal, Progress, Segmented, Switch, Table, Typography } from "antd";
import { Database, Trash2, Upload } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { useNotify } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Chip, JDateTime, Skeleton, StatCard } from "../../components/display";
import { Card, ICON } from "../../components/blocks";

type Size = "small" | "medium" | "large";
type State = "none" | "loading" | "loaded" | "purging" | "tombstoned" | "failed";

interface Status {
  state: State;
  bank: string;
  size?: Size;
  size_label?: string;
  progress?: { done: number; total: number; label: string };
  counts?: Record<string, number>;
  rows?: number;
  loaded_at?: string | null;
  error?: string | null;
  accounts?: { persona: string; email: string; name: string; title: string }[];
  password?: string | null;
  signin?: boolean;
  waiting_devices?: number;
  last?: { action: string; at: string; data: Record<string, unknown> | null } | null;
  real_records?: number;
}

interface Report {
  tables: Record<string, number>;
  rows: number;
  accounts: number;
  references: { table: string; field: string; rows: number; action: "cleared" | "reported" }[];
}

const PHRASE = "حذف کامل";

const STATE: Record<State, { label: string; tone: "neutral" | "in" | "info" | "warning" | "danger" }> = {
  none: { label: "بارگذاری نشده", tone: "neutral" },
  loading: { label: "در حال بارگذاری", tone: "info" },
  loaded: { label: "بارگذاری‌شده", tone: "in" },
  purging: { label: "در حال حذف", tone: "warning" },
  tombstoned: { label: "در انتظار همگام‌سازی برنامه‌های ویندوز", tone: "warning" },
  failed: { label: "بارگذاری ناتمام", tone: "danger" },
};

const COUNT_LABELS: [string, string][] = [
  ["branch", "شعبه"],
  ["employee", "کارمند"],
  ["agent", "کارشناس"],
  ["incident", "رخداد"],
  ["problem", "مشکل"],
  ["change_request", "تغییر"],
  ["request", "درخواست"],
  ["kb_article", "مقالهٔ دانش"],
  ["ci", "پیکربندی"],
  ["asset", "دارایی"],
  ["supplier", "تأمین‌کننده"],
  ["sec_incident", "رخداد امنیتی"],
  ["hr_case", "پروندهٔ منابع انسانی"],
  ["work_order", "بازدید میدانی"],
];

const PERSONA: Record<string, string> = { agent: "کارشناس", manager: "مدیر", requester: "درخواست‌دهنده", change: "مدیر تغییر", assets: "مدیر دارایی", soc: "امنیت", hr: "منابع انسانی" };

export default function Demo() {
  const { api } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "demo"],
    queryFn: () => api.get<Status>("/demo"),
    refetchInterval: (query) => (["loading", "purging"].includes((query.state.data as Status | undefined)?.state ?? "") ? 2000 : false),
  });
  // the Windows app's embedded database: the small bank (docs/DEMO_FA.md)
  const { meta } = useSession();
  const [size, setSize] = useState<Size>(meta?.mode === "desktop" ? "small" : "medium");
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const s = q.data;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "demo"] });
    void qc.invalidateQueries({ queryKey: ["demo-banner"] });
  };

  const load = async () => {
    setBusy(true);
    try {
      await api.post("/demo/load", { size, force });
      n.ok("بارگذاری دادهٔ نمایشی آغاز شد.");
      refresh();
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };

  const setSignin = async (on: boolean) => {
    setBusy(true);
    try {
      await api.post("/demo/signin", { on });
      n.ok(on ? "ورود با حساب‌های نمایشی روشن شد." : "ورود با حساب‌های نمایشی خاموش شد.");
      refresh();
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };

  const finalize = async () => {
    setBusy(true);
    try {
      await api.post("/demo/finalize", { force: true });
      n.ok("حذف داده‌های نمایشی کامل شد.");
      refresh();
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };

  const canPurge = s && s.state !== "none" && s.state !== "purging";
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="داده‌های نمایشی"
        actions={
          canPurge && s.state !== "tombstoned" ? (
            <Button danger icon={<Trash2 {...ICON} />} onClick={() => setPurgeOpen(true)}>
              حذف کامل داده‌های نمایشی
            </Button>
          ) : undefined
        }
      />
      {!s ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <Card
            title={s.bank}
            meta={<Chip tone={STATE[s.state].tone}>{STATE[s.state].label}</Chip>}
            tools={s.size_label ? <span className="text-ink-3">اندازه: {s.size_label}</span> : undefined}
          >
            {s.state === "none" ? (
              <div className="flex flex-col gap-3">
                <Segmented<Size>
                  value={size}
                  onChange={setSize}
                  options={[
                    { value: "small", label: "کوچک (≈ ۶۰ شعبه)" },
                    { value: "medium", label: "متوسط (≈ ۳۰۰ شعبه)" },
                    { value: "large", label: "بزرگ (≈ ۲٬۰۰۰ شعبه)" },
                  ]}
                />
                {s.real_records ? (
                  <Checkbox checked={force} onChange={(e) => setForce(e.target.checked)}>
                    این سازمان {fa(s.real_records)} رکورد واقعی دارد؛ با وجود دادهٔ واقعی بارگذاری شود
                  </Checkbox>
                ) : null}
                <div>
                  <Button type="primary" icon={<Upload {...ICON} />} loading={busy} disabled={!!s.real_records && !force} onClick={load}>
                    بارگذاری دادهٔ نمایشی
                  </Button>
                </div>
              </div>
            ) : null}
            {s.progress && (s.state === "loading" || s.state === "purging" || s.state === "failed") ? (
              <div className="flex flex-col gap-1" aria-live="polite">
                <Progress percent={Math.round((100 * s.progress.done) / Math.max(1, s.progress.total))} status={s.state === "failed" ? "exception" : "active"} />
                <span className="text-ink-2">{s.progress.label}</span>
              </div>
            ) : null}
            {s.error ? <Alert type="error" showIcon title="بارگذاری متوقف شد" description={s.error} /> : null}
            {s.state === "tombstoned" ? (
              <div className="flex flex-col gap-2">
                <span className="text-ink-2">
                  داده‌ها از سامانه برداشته شد؛ {fa(s.waiting_devices ?? 0)} برنامهٔ ویندوز هنوز آن را همگام نکرده است. پس از همگام‌سازی آن‌ها یا ۳۰ روز، ردپای همگام‌سازی خودکار پاک می‌شود.
                </span>
                <div>
                  <Button onClick={finalize} loading={busy}>
                    پایان حذف اکنون
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>

          {s.counts && s.state !== "none" ? (
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="آمار داده‌های نمایشی">
              {COUNT_LABELS.filter(([k]) => s.counts![k]).map(([k, label]) => (
                <StatCard key={k} title={label} value={<span className="ds-num">{fa(s.counts![k])}</span>} />
              ))}
            </section>
          ) : null}

          {s.accounts?.length ? (
            <Card title="حساب‌های نمایش" meta={s.password ? <span>گذرواژهٔ مشترک: <Typography.Text code copyable className="ltr">{s.password}</Typography.Text></span> : undefined}>
              <label className="mb-3 inline-flex items-center gap-2">
                <Switch size="small" checked={!!s.signin} loading={busy} onChange={(on) => void setSignin(on)} />
                <span>ورود با حساب‌های نمایشی {s.signin ? "روشن است؛ پس از ارائه آن را خاموش کنید" : "خاموش است"}</span>
              </label>
              <Table
                size="small"
                rowKey="email"
                pagination={false}
                dataSource={s.accounts}
                columns={[
                  { title: "نقش", dataIndex: "persona", render: (v: string) => PERSONA[v] ?? v },
                  { title: "نام", dataIndex: "name" },
                  { title: "سمت", dataIndex: "title" },
                  { title: "نام کاربری", dataIndex: "email", render: (v: string) => <Typography.Text copyable className="ltr">{v}</Typography.Text> },
                ]}
              />
            </Card>
          ) : null}

          {s.last ? (
            <Card title="آخرین رویداد">
              <span className="inline-flex items-center gap-2 text-ink-2">
                <Database {...ICON} aria-hidden />
                {s.last.action === "demo_purge" ? "داده‌های نمایشی حذف شد" : "داده‌های نمایشی بارگذاری شد"} · <JDateTime v={s.last.at} />
              </span>
            </Card>
          ) : null}
        </>
      )}
      {purgeOpen ? <PurgeDialog onClose={() => setPurgeOpen(false)} onDone={refresh} /> : null}
    </div>
  );
}

function PurgeDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { api } = useOrg();
  const n = useNotify();
  const r = useQuery({ queryKey: ["admin", "demo", "report"], queryFn: () => api.get<Report>("/demo/report") });
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post("/demo/purge", { confirm: typed });
      n.ok("حذف داده‌های نمایشی آغاز شد.");
      onDone();
      onClose();
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  const d = r.data;
  return (
    <Modal
      open
      title="حذف کامل داده‌های نمایشی"
      onCancel={onClose}
      okText="حذف کامل"
      cancelText="انصراف"
      okButtonProps={{ danger: true, disabled: typed.trim() !== PHRASE, loading: busy }}
      onOk={submit}
      width={640}
    >
      {!d ? (
        <Skeleton rows={4} />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-ink-2">
            {fa(d.rows)} ردیف در {fa(Object.keys(d.tables).length)} جدول و {fa(d.accounts)} حساب نمایشی برای همیشه حذف می‌شود؛ پیوست‌ها، اعلان‌ها، نمایه‌های جست‌وجو و هوش مصنوعی و محاسبه‌های انجام‌شده روی آن‌ها نیز. فقط یک سطر ممیزی بدون محتوا می‌ماند.
          </p>
          {d.references.length ? (
            <>
              <Alert type="warning" showIcon title="رکوردهای واقعی که به دادهٔ نمایشی اشاره می‌کنند" description="ارجاع‌های اختیاری خالی می‌شوند؛ ارجاع‌های اجباری و نشانه‌های دسترسی فقط گزارش می‌شوند. هیچ رکورد واقعی حذف نمی‌شود." />
              <Table
                size="small"
                rowKey={(x) => `${x.table}.${x.field}`}
                pagination={false}
                dataSource={d.references}
                columns={[
                  { title: "جدول", dataIndex: "table", render: (v: string) => <span className="ltr">{v}</span> },
                  { title: "فیلد", dataIndex: "field", render: (v: string) => <span className="ltr">{v}</span> },
                  { title: "ردیف", dataIndex: "rows", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
                  { title: "اقدام", dataIndex: "action", render: (v: string) => (v === "cleared" ? "خالی می‌شود" : "فقط گزارش") },
                ]}
              />
            </>
          ) : null}
          <label className="flex flex-col gap-1">
            <span>
              برای تأیید، عبارت «<b>{PHRASE}</b>» را بنویسید:
            </span>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus aria-label="عبارت تأیید" />
          </label>
        </div>
      )}
    </Modal>
  );
}
