// «سلامت سرور» (server edition only): the checks in plain Persian, then the database (size, connections, cache hit
// ratio, slowest statements from pg_stat_statements), free disk space per folder, the job queue, the worker processes
// and the scheduler leader, backups, the certificate and the air-gap policy (with recently refused hosts).
import { useState } from "react";
import { Button, Input, Popconfirm, Table, Tag } from "antd";
import { CheckCircle2, CircleAlert, Info, Plus, RefreshCw, TriangleAlert, X } from "lucide-react";
import { api } from "../../../lib/api";
import { useAction } from "../../../lib/hooks";
import { PageHeader } from "../../../components/layout";
import { Skeleton, StatCard } from "../../../components/display";
import { Card } from "../../../components/blocks";
import { fa, toPersianDigits } from "../../../lib/fa";
import { ICON, When, bytes, useAdminQuery } from "../../../pages/admin/ui";

type Tone = "ok" | "warning" | "danger" | "neutral";

interface Worker {
  worker: number;
  pid: number;
  uptime_s: number;
  leader: boolean;
  rss_mb: number;
  loop_lag_ms: { p50: number; p99: number; max: number };
  requests: { total: number; errors: number; in_flight: number; per_min: number; p95_ms: number };
  db: { pool: number; busy: number; slow: number };
  slow: { at: string; method: string; path: string; status: number; ms: number }[];
  last_tick: { at: string; ran: number; failed: number; ms: number } | null;
}

interface ServerHealth {
  ok: boolean;
  checked_at: string;
  checks: { key: string; title: string; tone: Tone; value: string; detail?: string }[];
  versions: { app: string; node: string; postgres: string | null };
  db: {
    bytes: number;
    connections: { total: number; max: number };
    cache_hit_ratio: number | null;
    extensions: { name: string; version: string }[];
    slow_statements: { query: string; calls: number; mean_ms: number; total_ms: number; rows: number }[];
    slow_note: string | null;
  };
  disks: { key: string; path: string; free?: number; total?: number }[];
  queue: { due: number; scheduled: number; running: number; failed_24h: number; oldest_due_s: number | null; top_kinds: { kind: string; n: number }[] };
  workers: Worker[];
  expected_workers: number | null;
  restarts: number;
  backup: { enabled: boolean; dir: string; time: string; next: string | null; last: { ok: boolean; at: string; size: number; verified: boolean; error: string | null } | null; count: number };
  certificate: { subject: string; names: string[]; valid_to: string; days_left: number; self_signed: boolean } | null;
  network: { air_gapped: boolean; allow: string[]; refused: { host: string; at: string; via: string }[] };
  sign_in?: { failed_1h: number; succeeded_1h: number; locked_1h: number; sources: { org: string; source: string; at: string; ok: boolean; message: string }[] };
  trusted_proxies?: string[];
  public_url: string;
}

const TONE_ICON = { ok: CheckCircle2, warning: TriangleAlert, danger: CircleAlert, neutral: Info } as const;
const DISK: Record<string, string> = { data: "داده", blobs: "پیوست‌ها", backups: "پشتیبان‌ها", logs: "گزارش‌ها" };
const Ltr = ({ children }: { children: React.ReactNode }) => (
  <span className="ds-latin" dir="ltr">
    {children}
  </span>
);

export default function ServerHealthPage() {
  const q = useAdminQuery<ServerHealth>(["server-health"], "/admin/server");
  const h = q.data;
  const [host, setHost] = useState("");
  // an explicit, re-authenticated change of the air-gap allowlist (never automatic: a refused host is only offered)
  const allow = useAction((change: { add?: string[]; remove?: string[] }) => api.put<{ allow: string[] }>("/admin/server/allow", change), {
    success: "فهرست مجاز به‌روز شد",
    onSuccess: () => {
      setHost("");
      void q.refetch();
    },
  });
  const leader = h?.workers.find((w) => w.leader);
  return (
    <div>
      <PageHeader
        title="سلامت سرور"
        subtitle={h ? <When v={h.checked_at} /> : undefined}
        actions={
          <Button icon={<RefreshCw {...ICON} />} loading={q.isFetching} onClick={() => q.refetch()}>
            بررسی دوباره
          </Button>
        }
      />
      {!h ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <section className="ad-kpis" aria-label="خلاصه">
            <StatCard title="وضعیت" value={h.ok ? "رو به راه" : "نیازمند توجه"} hint={h.ok ? "همهٔ بررسی‌ها درست است" : `${fa(h.checks.filter((c) => c.tone === "warning" || c.tone === "danger").length)} مورد`} />
            <StatCard title="فرایندها" value={<span className="ds-num">{fa(h.workers.length)}</span>} hint={leader ? `زمان‌بند: فرایند ${fa(leader.worker)}` : "زمان‌بند هنوز انتخاب نشده"} />
            <StatCard title="پایگاه داده" value={<span className="ds-num">{bytes(h.db.bytes)}</span>} hint={`${fa(h.db.connections.total)} از ${fa(h.db.connections.max)} اتصال`} />
            <StatCard title="صف کارها" value={<span className="ds-num">{fa(h.queue.due)}</span>} hint={h.queue.failed_24h ? `${fa(h.queue.failed_24h)} ناموفق در ۲۴ ساعت` : `${fa(h.queue.scheduled)} زمان‌بندی‌شده`} />
          </section>

          <Card title="بررسی‌ها" className="ad-section-gap" flush>
            {h.checks.map((c) => {
              const Icon = TONE_ICON[c.tone];
              return (
                <div key={c.key} className="ad-check">
                  <span className="ad-tone" data-tone={c.tone} aria-hidden>
                    <Icon {...ICON} />
                  </span>
                  <span className="ad-li-main">
                    <span className="block font-medium text-ink">{c.title}</span>
                    <span className="block text-[13px] text-ink-2">{c.value}</span>
                    {c.detail ? <span className="mt-1 block text-[13px] leading-5 text-ink-3">{c.detail}</span> : null}
                  </span>
                </div>
              );
            })}
          </Card>

          <Card title="فرایندهای سرور" className="ad-section-gap" flush>
            <Table<Worker>
              rowKey="worker"
              size="small"
              pagination={false}
              dataSource={h.workers}
              columns={[
                { title: "فرایند", render: (_, w) => <span className="ds-num">{fa(w.worker)}{w.leader ? <Tag className="ms-2" variant="filled">زمان‌بند</Tag> : null}</span> },
                { title: "حافظه", render: (_, w) => <span className="ds-num">{fa(w.rss_mb)} مگابایت</span> },
                { title: "تأخیر پردازش (صدک ۹۹)", render: (_, w) => <span className="ds-num">{fa(w.loop_lag_ms.p99)} میلی‌ثانیه</span> },
                { title: "درخواست در دقیقه", render: (_, w) => <span className="ds-num">{fa(w.requests.per_min)}</span> },
                { title: "پاسخ (صدک ۹۵)", render: (_, w) => <span className="ds-num">{fa(w.requests.p95_ms)} میلی‌ثانیه</span> },
                { title: "اتصال پایگاه داده", render: (_, w) => <span className="ds-num">{fa(w.db.busy)} از {fa(w.db.pool)}</span> },
                { title: "آخرین اجرای صف", render: (_, w) => (w.last_tick ? <When v={w.last_tick.at} /> : "—") },
              ]}
            />
            {h.restarts ? <p className="px-4 py-2 text-[13px] text-ink-3">{fa(h.restarts)} بار فرایندی از کار افتاد و دوباره راه‌اندازی شد.</p> : null}
          </Card>

          <Card title="کندترین دستورهای پایگاه داده" className="ad-section-gap" flush>
            {h.db.slow_note ? (
              <p className="px-4 py-3 text-[13px] text-ink-3">{h.db.slow_note}</p>
            ) : (
              <Table
                rowKey={(r) => r.query}
                size="small"
                pagination={false}
                dataSource={h.db.slow_statements}
                columns={[
                  { title: "میانگین", render: (_, r) => <span className="ds-num">{fa(r.mean_ms)} میلی‌ثانیه</span>, width: 120 },
                  { title: "دفعات", render: (_, r) => <span className="ds-num">{fa(r.calls)}</span>, width: 90 },
                  { title: "دستور", render: (_, r) => <code className="block max-w-[56rem] truncate text-[12px]" dir="ltr" title={r.query}>{r.query}</code> },
                ]}
              />
            )}
            <p className="px-4 py-2 text-[13px] text-ink-3">
              PostgreSQL <Ltr>{h.versions.postgres ?? "?"}</Ltr> · نرخ برخورد حافظهٔ نهان {h.db.cache_hit_ratio === null ? "—" : `${h.db.cache_hit_ratio.toLocaleString("fa-IR")}٪`} · افزونه‌ها: <Ltr>{h.db.extensions.map((e) => `${e.name} ${e.version}`).join(", ")}</Ltr>
            </p>
          </Card>

          <Card title="فضای دیسک" className="ad-section-gap" flush>
            {h.disks.map((d) => (
              <div key={d.key} className="ad-check">
                <span className="ad-li-main">
                  <span className="block font-medium text-ink">{DISK[d.key] ?? d.key}</span>
                  <span className="block text-[13px] text-ink-2">{d.total ? `${bytes(d.free ?? 0)} آزاد از ${bytes(d.total)}` : "خوانده نشد"}</span>
                  <span className="block text-[12px] text-ink-3">
                    <Ltr>{d.path}</Ltr>
                  </span>
                </span>
              </div>
            ))}
          </Card>

          <Card title="پشتیبان‌گیری" className="ad-section-gap">
            <p className="text-[13px] leading-6 text-ink-2">
              {h.backup.enabled ? `هر روز ساعت ${toPersianDigits(h.backup.time)}` : "پشتیبان‌گیری خودکار خاموش است"} · {fa(h.backup.count)} پشتیبان در <Ltr>{h.backup.dir}</Ltr>
              <br />
              {h.backup.last ? (
                <>
                  آخرین: <When v={h.backup.last.at} /> — {h.backup.last.ok ? `${bytes(h.backup.last.size)}${h.backup.last.verified ? "، بررسی‌شده" : ""}` : `ناموفق: ${h.backup.last.error ?? ""}`}
                </>
              ) : (
                "هنوز پشتیبانی گرفته نشده است"
              )}
            </p>
          </Card>

          <Card title="گواهی و شبکه" className="ad-section-gap">
            <p className="text-[13px] leading-6 text-ink-2">
              نشانی سامانه: <Ltr>{h.public_url}</Ltr>
              <br />
              {h.certificate ? (
                <>
                  گواهی: <Ltr>{h.certificate.subject}</Ltr> — {h.certificate.self_signed ? "خودامضا (موقت)" : `${fa(h.certificate.days_left)} روز تا انقضا`}
                </>
              ) : (
                "HTTPS در این سرور خاموش است (پشت پراکسی)"
              )}
              <br />
              شبکهٔ بسته: {h.network.air_gapped ? "روشن" : "خاموش"}
              {h.trusted_proxies?.length ? (
                <>
                  {" "}· پراکسی‌های معتمد: <Ltr>{h.trusted_proxies.join(", ")}</Ltr>
                </>
              ) : null}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1">
              {h.network.allow.map((e) => (
                <Tag key={e} closable closeIcon={<X size={12} />} onClose={(ev) => {
                  ev.preventDefault();
                  allow.mutate({ remove: [e] });
                }}>
                  <Ltr>{e}</Ltr>
                </Tag>
              ))}
              <Input size="small" dir="ltr" className="w-56" value={host} onChange={(e) => setHost(e.target.value)} placeholder="dc1.bank.local" onPressEnter={() => host.trim() && allow.mutate({ add: [host.trim()] })} />
              <Button size="small" icon={<Plus {...ICON} />} disabled={!host.trim()} loading={allow.isPending} onClick={() => allow.mutate({ add: [host.trim()] })}>
                افزودن میزبان مجاز
              </Button>
            </div>
            {h.network.refused.length ? (
              <div className="mt-3">
                <span className="block text-[13px] font-medium text-ink">تلاش‌های ردشده برای اتصال به بیرون</span>
                {h.network.refused.map((r) => (
                  <span key={`${r.host}${r.at}`} className="flex items-center gap-2 text-[13px] text-ink-3">
                    <Ltr>{r.host}</Ltr> · <When v={r.at} />
                    {h.network.allow.includes(r.host) ? null : (
                      <Popconfirm title={`«${r.host}» به فهرست مجاز افزوده شود؟`} okText="افزودن" cancelText="انصراف" onConfirm={() => allow.mutateAsync({ add: [r.host] })}>
                        <Button size="small" type="link">
                          مجاز کن
                        </Button>
                      </Popconfirm>
                    )}
                  </span>
                ))}
              </div>
            ) : null}
          </Card>
          {h.sign_in ? (
            <Card title="ورود کاربران" className="ad-section-gap">
              <p className="text-[13px] leading-6 text-ink-2">
                یک ساعت گذشته: {fa(h.sign_in.succeeded_1h)} ورود موفق · {fa(h.sign_in.failed_1h)} ورود ناموفق · {fa(h.sign_in.locked_1h)} قفل موقت
              </p>
              {h.sign_in.sources.map((x) => (
                <span key={`${x.org}${x.source}`} className="block text-[13px] text-ink-3">
                  <Tag color={x.ok ? "green" : "red"}>{x.ok ? "اتصال برقرار" : "ناموفق"}</Tag>
                  {x.org} · {x.source} · <When v={x.at} />
                  {x.ok ? null : <span className="block text-ink-2">{x.message}</span>}
                </span>
              ))}
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
