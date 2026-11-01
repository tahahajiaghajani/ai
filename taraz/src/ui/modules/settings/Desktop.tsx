// Windows app settings: backups, LAN (office network) mode and the link with the web version.
import { useState } from "react";
import { Button, Table, Switch, Form, Input, Alert, Tag, Descriptions, Modal, Select, Space, Result } from "antd";
import { CloudUploadOutlined, CloudDownloadOutlined, SyncOutlined, DatabaseOutlined, WifiOutlined, DisconnectOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader, Section } from "../../components/layout";
import { JDateTime } from "../../components/display";
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
  const restore = useAction((file: string) => api.post("/local/backups/restore", { file }), { onSuccess: () => { n.ok("بازگردانی پس از راه‌اندازی دوباره‌ی برنامه انجام می‌شود"); window.taraz?.relaunch?.(); } });
  const saveSettings = useAction((v: any) => api.patch("/local/settings", v), { success: "ذخیره شد؛ تغییر شبکه پس از اجرای دوباره‌ی برنامه اعمال می‌شود", invalidate: [["local-settings"], ["local-info"]] });
  const syncNow = useAction(() => api.post("/local/sync"), { success: "همگام‌سازی انجام شد", invalidate: [["local-info"], ["local-sync"]] });
  const unlink = useAction(() => api.post("/local/cloud/unlink"), { success: "اتصال قطع شد", invalidate: [["local-info"]] });
  const [qr, setQr] = useState<string | null>(null);
  const [link, setLink] = useState(false);

  if (meta?.mode !== "desktop") return <Result status="info" title="این بخش مخصوص نسخه‌ی ویندوز است" />;
  const d = info.data;
  const lanUrl = d?.lan?.addresses?.[0] ? `http://${d.lan.addresses[0]}:${d.lan.port}` : null;
  return (
    <div>
      <PageHeader title="نسخه‌ی ویندوز" subtitle={d ? <span className="ltr">{d.data_dir}</span> : null} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title={<span><CloudUploadOutlined /> همگام‌سازی با نسخه‌ی وب</span>}
          extra={d?.cloud?.linked ? <Tag color="success" variant="filled">متصل</Tag> : <Tag variant="filled">متصل نیست</Tag>}
        >
          {d?.cloud?.linked ? (
            <>
              <Descriptions
                size="small"
                column={1}
                items={[
                  { key: "url", label: "نسخه‌ی وب", children: <span className="ltr">{d.cloud.url}</span> },
                  { key: "email", label: "حساب", children: <span className="ltr">{d.cloud.email}</span> },
                  { key: "last", label: "آخرین همگام‌سازی", children: <JDateTime v={d.sync.last_sync_at} /> },
                  { key: "pending", label: "تغییرات در صف ارسال", children: faDigits(d.sync.pending) },
                ]}
              />
              {d.sync.last_error ? <Alert className="!my-3" type="warning" showIcon title={d.sync.last_error} /> : null}
              {d.sync.failed?.length ? <Alert className="!my-3" type="error" showIcon title={`${faDigits(d.sync.failed.length)} مورد ارسال نشد`} description={d.sync.failed.slice(0, 5).map((f: any) => f.error).join(" · ")} /> : null}
              <Space className="mt-3">
                <Button type="primary" icon={<SyncOutlined spin={syncNow.isPending} />} onClick={() => syncNow.mutate(undefined)}>همگام‌سازی الان</Button>
                <Button danger icon={<DisconnectOutlined />} onClick={async () => { if (await n.confirm("قطع اتصال از نسخه‌ی وب؟", "داده‌های این رایانه باقی می‌مانند ولی دیگر با وب هم‌گام نمی‌شوند.")) unlink.mutate(undefined); }}>قطع اتصال</Button>
              </Space>
            </>
          ) : (
            <>
              <p className="mt-0 text-sm text-muted">با اتصال، هر تغییر روی این رایانه ظرف چند ثانیه به نسخه‌ی وب می‌رود و تغییرات وب هم به این‌جا می‌آید. بدون اینترنت هم کار می‌کنید؛ تغییرات در صف می‌مانند و با وصل شدن ارسال می‌شوند.</p>
              <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => setLink(true)}>اتصال به حساب ابری</Button>
            </>
          )}
        </Section>

        <Section title={<span><DatabaseOutlined /> پشتیبان‌گیری</span>} extra={<Button size="small" type="primary" loading={backupNow.isPending} onClick={() => backupNow.mutate(undefined)}>پشتیبان الان</Button>} bodyClass="p-0">
          <div className="p-4 pb-2 text-sm text-muted">
            پشتیبان خودکار هر {faDigits(settings.data?.backups?.every_hours ?? 6)} ساعت؛ {faDigits(settings.data?.backups?.keep ?? 30)} نسخه‌ی آخر نگه داشته می‌شود.{" "}
            {d?.backups?.dir ? <a onClick={() => window.taraz?.openPath?.(d.backups.dir)}><FolderOpenOutlined /> باز کردن پوشه</a> : null}
          </div>
          <Table
            className="tz-table"
            size="small"
            rowKey="file"
            dataSource={backups.data ?? []}
            pagination={{ pageSize: 8, hideOnSinglePage: true, size: "small" }}
            columns={[
              { key: "at", dataIndex: "at", title: "زمان", render: (v) => <JDateTime v={v} /> },
              { key: "size", dataIndex: "size", title: "حجم", render: (v) => size(v) },
              { key: "name", dataIndex: "file", title: "فایل", ellipsis: true, render: (v) => <span className="ltr text-xs text-muted">{String(v).split(/[\\/]/).pop()}</span> },
              { key: "a", render: (_, r: any) => <Button size="small" onClick={async () => { if (await n.confirm("بازگردانی این پشتیبان؟", "وضعیت فعلی هم پیش از بازگردانی پشتیبان گرفته می‌شود. برنامه دوباره اجرا می‌شود.", true)) restore.mutate(r.file); }}>بازگردانی</Button> },
            ]}
          />
        </Section>

        <Section title={<span><WifiOutlined /> حالت شبکه (چند رایانه در فروشگاه)</span>}>
          <p className="mt-0 text-sm text-muted">با روشن کردن حالت شبکه، رایانه‌ها و گوشی‌های دیگرِ همین شبکه می‌توانند با مرورگر یا برنامه‌ی تراز به این رایانه وصل شوند و هم‌زمان کار کنند.</p>
          {settings.data ? (
            <Form layout="inline" initialValues={settings.data.lan} onFinish={(v) => saveSettings.mutate({ lan: v })}>
              <Form.Item name="enabled" valuePropName="checked" label="فعال"><Switch /></Form.Item>
              <Form.Item name="port" label="پورت"><Input dir="ltr" className="!w-24" /></Form.Item>
              <Button htmlType="submit" type="primary">ذخیره</Button>
            </Form>
          ) : null}
          {d?.lan?.enabled && lanUrl ? (
            <div className="mt-4 flex items-center gap-4">
              <div>
                <div className="text-xs text-muted">نشانی برای دستگاه‌های دیگر:</div>
                {d.lan.addresses.map((a: string) => <div key={a} className="ltr font-mono text-base font-bold">http://{a}:{d.lan.port}</div>)}
              </div>
              <Button onClick={async () => setQr(await QRCode.toDataURL(lanUrl, { margin: 1, width: 220 }))}>QR برای گوشی</Button>
            </div>
          ) : null}
        </Section>

        <Section title="درباره‌ی این نصب">
          {d ? (
            <Descriptions
              size="small"
              column={1}
              items={[
                { key: "v", label: "نسخه", children: faDigits(d.version) },
                { key: "pc", label: "رایانه", children: <span className="ltr">{d.computer}</span> },
                { key: "dir", label: "پوشه‌ی داده", children: <span className="ltr text-xs">{d.data_dir}</span> },
                { key: "dev", label: "شناسه‌ی دستگاه", children: <span className="ltr text-xs">{d.device_id}</span> },
              ]}
            />
          ) : null}
        </Section>
      </div>
      <Modal open={!!qr} onCancel={() => setQr(null)} footer={null} title="اتصال گوشی یا تبلت" width={300}>
        {qr ? <img src={qr} alt="QR" className="mx-auto block" /> : null}
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
    <Modal open={open} onCancel={onClose} title="اتصال به نسخه‌ی وب" footer={null} destroyOnHidden width={520}>
      <Form form={form} layout="vertical" initialValues={{ url: "https://" }}>
        <Form.Item name="url" label="نشانی نسخه‌ی وب" rules={[{ required: true, type: "url" }]}><Input dir="ltr" /></Form.Item>
        <Form.Item name="email" label="ایمیل حساب ابری" rules={[{ required: true, type: "email" }]}><Input dir="ltr" /></Form.Item>
        <Form.Item name="password" label="رمز عبور" rules={[{ required: true }]}><Input.Password dir="ltr" /></Form.Item>
        <Form.Item label="جهت">
          <Select
            value={direction}
            onChange={setDirection}
            options={[
              { value: "upload", label: "بارگذاری کسب‌وکار همین رایانه در فضای ابری (کسب‌وکار در وب ساخته می‌شود)" },
              { value: "download", label: "دریافت کسب‌وکاری که در وب دارم روی این رایانه" },
            ]}
          />
        </Form.Item>
        {direction === "download" && orgs ? (
          <Form.Item label="کسب‌وکار ابری">
            <Select value={target} onChange={setTarget} options={orgs.map((o) => ({ value: o.id, label: o.name }))} />
          </Form.Item>
        ) : null}
        <Button
          type="primary"
          loading={busy}
          icon={direction === "upload" ? <CloudUploadOutlined /> : <CloudDownloadOutlined />}
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
              n.ok("اتصال برقرار شد و همگام‌سازی انجام شد");
              onClose();
            } catch (e) {
              n.error(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {direction === "download" && !orgs ? "ورود و دیدن کسب‌وکارها" : "اتصال و همگام‌سازی"}
        </Button>
      </Form>
    </Modal>
  );
}
