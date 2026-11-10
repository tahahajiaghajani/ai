// Windows app settings: backups, LAN (office network) mode and the link with the web version.
import { useState } from "react";
import { Button, Table, Switch, Form, Input, Modal, Select, Tooltip, message } from "antd";
import { CloudUpload, CloudDownload, RefreshCw, Unlink, FolderOpen, DatabaseBackup, ArchiveRestore, Copy, QrCode, Monitor } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { EmptyState, JDateTime, Skeleton } from "../../components/display";
import { Card, ICON, ICON14, Note, Version } from "../../components/blocks";
import { faDigits } from "@shared/format";

function size(n: number) {
  if (n > 1e6) return `${faDigits((n / 1e6).toFixed(1))} مگابایت`;
  return `${faDigits(Math.round(n / 1e3))} کیلوبایت`;
}

export default function Desktop() {
  const { meta } = useSession();
  const { orgId } = useOrg();
  const n = useNotify();
  const info = useQuery({ queryKey: ["local-info"], queryFn: () => api.get("/local/info"), refetchInterval: 10_000, enabled: meta?.mode === "desktop" });
  const backups = useQuery({ queryKey: ["local-backups"], queryFn: () => api.get("/local/backups").then((r) => r.backups), enabled: meta?.mode === "desktop" });
  const settings = useQuery({ queryKey: ["local-settings"], queryFn: () => api.get("/local/settings"), enabled: meta?.mode === "desktop" });
  const backupNow = useAction(() => api.post("/local/backups"), { success: "پشتیبان گرفته شد", invalidate: [["local-backups"], ["local-info"]] });
  const restore = useAction((file: string) => api.post("/local/backups/restore", { file }), { onSuccess: () => { n.ok("بازگردانی پس از راه‌اندازی دوباره‌ی برنامه انجام می‌شود"); window.itsm?.relaunch?.(); } });
  const saveSettings = useAction((v: any) => api.patch("/local/settings", v), { success: "ذخیره شد؛ تغییر شبکه پس از اجرای دوباره‌ی برنامه اعمال می‌شود", invalidate: [["local-settings"], ["local-info"]] });
  const syncNow = useAction(() => api.post("/local/sync"), { success: "همگام‌سازی انجام شد", invalidate: [["local-info"], ["local-sync"]] });
  const unlink = useAction(() => api.post("/local/cloud/unlink"), { success: "اتصال قطع شد", invalidate: [["local-info"]] });
  const [qr, setQr] = useState<string | null>(null);
  const [link, setLink] = useState(false);

  if (meta?.mode !== "desktop")
    return (
      <div>
        <PageHeader title="نسخهٔ ویندوز" />
        <Card>
          <EmptyState icon={Monitor} title="این بخش مخصوص نسخهٔ ویندوز است" description="پشتیبان‌گیری، حالت شبکه و هم‌گامی با نسخهٔ وب در برنامهٔ ویندوز تنظیم می‌شوند." />
        </Card>
      </div>
    );
  const d = info.data;
  const lanUrl = d?.lan?.addresses?.[0] ? `http://${d.lan.addresses[0]}:${d.lan.port}` : null;
  const linked = !!d?.cloud?.linked;
  return (
    <div>
      <PageHeader title="نسخهٔ ویندوز" subtitle={d ? <span>نسخهٔ <Version v={d.version} />، {d.computer}</span> : null} />
      <div className="blk-cols grid items-start gap-4 xl:grid-cols-2">
        <Card
          title="هم‌گامی با نسخهٔ وب"
          meta={
            <span className="inline-flex items-center gap-2 blk-meta">
              <i className="ds-nuqta" data-live={linked ? "" : undefined} style={linked ? undefined : { color: "var(--ds-text-3)" }} aria-hidden />
              {linked ? "متصل" : "متصل نیست"}
            </span>
          }
        >
          {linked ? (
            <>
              <dl className="blk-dl">
                <div className="is-wide">
                  <dt>نسخهٔ وب</dt>
                  <dd><bdi dir="ltr" className="ds-latin">{d.cloud.url}</bdi></dd>
                </div>
                <div>
                  <dt>حساب</dt>
                  <dd><bdi dir="ltr" className="ds-latin">{d.cloud.email}</bdi></dd>
                </div>
                <div>
                  <dt>آخرین هم‌گامی</dt>
                  <dd><JDateTime v={d.sync.last_sync_at} /></dd>
                </div>
                <div>
                  <dt>تغییرات در صف ارسال</dt>
                  <dd className="ds-num">{faDigits(d.sync.pending)}</dd>
                </div>
              </dl>
              {d.sync.last_error ? <Note tone="warning" className="mt-4"><b>آخرین هم‌گامی کامل نشد.</b> {d.sync.last_error}</Note> : null}
              {d.sync.failed?.length ? (
                <Note tone="danger" className="mt-3">
                  <b>{faDigits(d.sync.failed.length)} مورد ارسال نشد.</b> {d.sync.failed.slice(0, 5).map((f: any) => f.error).join("، ")}
                </Note>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-2">
                <Button type="primary" icon={<RefreshCw {...ICON} className={syncNow.isPending ? "ds-spin" : undefined} />} onClick={() => syncNow.mutate(undefined)}>
                  هم‌گامی الان
                </Button>
                <Button
                  danger
                  icon={<Unlink {...ICON} />}
                  onClick={async () => {
                    if (await n.confirm("قطع اتصال از نسخهٔ وب؟", "داده‌های این رایانه می‌مانند ولی دیگر با وب هم‌گام نمی‌شوند.", true)) unlink.mutate(undefined);
                  }}
                >
                  قطع اتصال
                </Button>
              </div>
            </>
          ) : (
            <EmptyState
              compact
              icon={CloudUpload}
              title="به نسخهٔ وب وصل نیست"
              description="با اتصال، هر تغییر این رایانه چند ثانیه بعد به وب می‌رسد و برعکس؛ بی‌اینترنت هم کار می‌کنید و تغییرات در صف می‌مانند."
              action={<Button type="primary" icon={<CloudUpload {...ICON} />} onClick={() => setLink(true)}>اتصال به حساب ابری</Button>}
            />
          )}
        </Card>

        <Card
          title="پشتیبان‌گیری"
          meta={<span className="blk-cap">خودکار هر {faDigits(settings.data?.backups?.every_hours ?? 6)} ساعت، {faDigits(settings.data?.backups?.keep ?? 30)} نسخهٔ آخر</span>}
          tools={
            <>
              {d?.backups?.dir ? (
                <Tooltip title="باز کردن پوشه">
                  <Button type="text" icon={<FolderOpen {...ICON} />} onClick={() => window.itsm?.openPath?.(d.backups.dir)} aria-label="باز کردن پوشه" />
                </Tooltip>
              ) : null}
              <Button size="small" icon={<DatabaseBackup {...ICON14} />} loading={backupNow.isPending} onClick={() => backupNow.mutate(undefined)}>
                پشتیبان الان
              </Button>
            </>
          }
          flush
        >
          <Table
            className="blk-tbl"
            size="small"
            rowKey="file"
            dataSource={backups.data ?? []}
            loading={backups.isLoading}
            pagination={{ pageSize: 8, hideOnSinglePage: true, size: "small" }}
            locale={{ emptyText: <EmptyState compact icon={DatabaseBackup} title="هنوز پشتیبانی گرفته نشده" /> }}
            columns={[
              { key: "at", dataIndex: "at", title: "زمان", width: 160, render: (v) => <JDateTime v={v} /> },
              { key: "size", dataIndex: "size", title: "حجم", width: 112, render: (v) => <span className="blk-2 ds-num">{size(v)}</span> },
              { key: "name", dataIndex: "file", title: "فایل", ellipsis: true, render: (v) => <bdi dir="ltr" className="ds-mono blk-3">{String(v).split(/[\\/]/).pop()}</bdi> },
              {
                key: "a",
                width: 104,
                render: (_, r: any) => (
                  <span className="blk-ra">
                    <Button
                      size="small"
                      type="text"
                      icon={<ArchiveRestore {...ICON14} />}
                      onClick={async () => {
                        if (await n.confirm("بازگردانی این پشتیبان؟", "پیش از بازگردانی از وضعیت فعلی هم پشتیبان گرفته می‌شود و برنامه دوباره اجرا می‌شود.", true)) restore.mutate(r.file);
                      }}
                    >
                      بازگردانی
                    </Button>
                  </span>
                ),
              },
            ]}
          />
        </Card>

        <Card title="حالت شبکه" meta={<span className="blk-cap">چند رایانه در یک فروشگاه</span>}>
          {settings.data ? (
            <Form layout="vertical" initialValues={settings.data.lan} onFinish={(v) => saveSettings.mutate({ lan: v })}>
              <div className="flex flex-wrap items-end gap-3">
                <Form.Item name="enabled" valuePropName="checked" label="فعال" className="!mb-0"><Switch /></Form.Item>
                <Form.Item name="port" label="پورت" className="!mb-0"><Input dir="ltr" className="ds-num !w-28" /></Form.Item>
                <Button htmlType="submit">ذخیره</Button>
              </div>
              <div className="blk-f-h mt-3">رایانه‌ها و گوشی‌های همین شبکه با مرورگر یا برنامهٔ ویندوز به این رایانه وصل می‌شوند و هم‌زمان کار می‌کنند؛ تغییر پس از اجرای دوبارهٔ برنامه اعمال می‌شود.</div>
            </Form>
          ) : null}
          {d?.lan?.enabled && lanUrl ? (
            <div className="mt-4 grid gap-2">
              <div className="blk-f-l">نشانی برای دستگاه‌های دیگر</div>
              {d.lan.addresses.map((a: string) => (
                <div key={a} className="blk-copy">
                  <code>http://{a}:{d.lan.port}</code>
                  <Tooltip title="رونوشت">
                    <Button type="text" size="small" icon={<Copy {...ICON14} />} aria-label="رونوشت" onClick={() => { void navigator.clipboard?.writeText(`http://${a}:${d.lan.port}`); message.success("رونوشت شد."); }} />
                  </Tooltip>
                </div>
              ))}
              <div>
                <Button icon={<QrCode {...ICON} />} onClick={async () => setQr(await QRCode.toDataURL(lanUrl, { margin: 1, width: 220 }))}>QR برای گوشی</Button>
              </div>
            </div>
          ) : null}
        </Card>

        <Card title="دربارهٔ این نصب">
          {d ? (
            <dl className="blk-dl">
              <div>
                <dt>نسخه</dt>
                <dd><Version v={d.version} /></dd>
              </div>
              <div>
                <dt>رایانه</dt>
                <dd><bdi dir="ltr" className="ds-latin">{d.computer}</bdi></dd>
              </div>
              <div className="is-wide">
                <dt>پوشهٔ داده</dt>
                <dd><bdi dir="ltr" className="ds-mono">{d.data_dir}</bdi></dd>
              </div>
              <div className="is-wide">
                <dt>شناسهٔ دستگاه</dt>
                <dd><bdi dir="ltr" className="ds-mono blk-2">{d.device_id}</bdi></dd>
              </div>
            </dl>
          ) : (
            <Skeleton rows={4} />
          )}
        </Card>
      </div>
      <Modal open={!!qr} onCancel={() => setQr(null)} footer={null} title="اتصال گوشی یا تبلت" width={320}>
        {qr ? <img src={qr} alt="QR" className="mx-auto block rounded-md" /> : null}
      </Modal>
      <LinkModal open={link} onClose={() => setLink(false)} currentOrg={orgId} />
    </div>
  );
}

function LinkModal({ open, onClose, currentOrg }: { open: boolean; onClose: () => void; currentOrg: string }) {
  const n = useNotify();
  const [form] = Form.useForm();
  const [orgs, setOrgs] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState<"upload" | "download">("upload");
  const [target, setTarget] = useState<string | null>(null);
  return (
    <Modal open={open} onCancel={onClose} title="اتصال به نسخهٔ وب" footer={null} destroyOnHidden width={520}>
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ url: "https://" }}>
        <Form.Item name="url" label="نشانی نسخهٔ وب" rules={[{ required: true, type: "url", message: "نشانی درست نیست." }]}><Input dir="ltr" className="ds-latin" /></Form.Item>
        <Form.Item name="email" label="ایمیل حساب ابری" rules={[{ required: true, type: "email", message: "ایمیل درست نیست." }]}><Input dir="ltr" className="ds-latin" /></Form.Item>
        <Form.Item name="password" label="رمز عبور" rules={[{ required: true }]}><Input.Password dir="ltr" /></Form.Item>
        <Form.Item label="جهت">
          <Select
            value={direction}
            onChange={setDirection}
            options={[
              { value: "upload", label: "بارگذاری سازمان همین رایانه در فضای ابری (سازمان در وب ساخته می‌شود)" },
              { value: "download", label: "دریافت سازمانی که در وب دارم روی این رایانه" },
            ]}
          />
        </Form.Item>
        {direction === "download" && orgs ? (
          <Form.Item label="سازمان ابری">
            <Select value={target} onChange={setTarget} options={orgs.map((o) => ({ value: o.id, label: o.name }))} />
          </Form.Item>
        ) : null}
        <Button
          type="primary"
          loading={busy}
          icon={direction === "upload" ? <CloudUpload {...ICON} /> : <CloudDownload {...ICON} />}
          onClick={async () => {
            const v = await form.validateFields();
            setBusy(true);
            try {
              if (direction === "download" && !orgs) {
                const r = await api.post("/local/cloud/orgs", v);
                setOrgs(r.orgs);
                setBusy(false);
                return;
              }
              await api.post("/local/cloud/link", { ...v, direction, org_id: direction === "upload" ? currentOrg : target });
              n.ok("اتصال برقرار شد و هم‌گامی انجام شد.");
              onClose();
            } catch (e) {
              n.error(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {direction === "download" && !orgs ? "ورود و دیدن سازمان‌ها" : "اتصال و همگام‌سازی"}
        </Button>
      </Form>
    </Modal>
  );
}
