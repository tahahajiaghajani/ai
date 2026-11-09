// Header actions and panels of the portal's records in the desk: a messaging connector's webhook secret (shown once),
// a new webhook address, registering the webhook with the bot platform and the last messages it carried; the website
// widget's key and the snippet to paste; a survey's results and «ارسال برای مخاطبان» for campaigns; and on incidents,
// requests and feedback the survey answers given about them.
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Modal, Popconfirm, Table, Tooltip } from "antd";
import { BarChart3, Code2, Copy, KeyRound, ListOrdered, PlugZap, RefreshCw, Send } from "lucide-react";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { MESSAGE_STATUSES } from "@shared/tables/portal";
import { useOrg } from "../../lib/org";
import { errorText } from "../../lib/api";
import type { RecordContext } from "../../records";
import { portalApi } from "./api";
import { I16 } from "./parts";

function CopyBox({ text, label }: { text: string; label: string }) {
  const { message } = App.useApp();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12.5px] text-ink-3">{label}</span>
      <div className="flex items-start gap-2">
        <pre className="m-0 min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-line bg-sunken p-2 text-[12px]" dir="ltr">
          {text}
        </pre>
        <Tooltip title="رونوشت">
          <Button size="small" icon={<Copy {...I16} />} aria-label={`رونوشت ${label}`} onClick={() => void navigator.clipboard?.writeText(text).then(() => message.success("رونوشت شد"), () => undefined)} />
        </Tooltip>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = Object.fromEntries(MESSAGE_STATUSES.map((o) => [o.value, o.label]));

export function ChannelActions({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const { message } = App.useApp();
  const [secret, setSecret] = useState<{ secret: string; webhook_url: string } | null>(null);
  const [log, setLog] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const id = ctx.row.id;
  const kind = String(ctx.row.kind ?? "");
  const run = async <T,>(key: string, f: () => Promise<T>, done: (r: T) => void) => {
    setBusy(key);
    try {
      done(await f());
      ctx.refresh();
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const logQ = useQuery({ queryKey: ["portal", "channel-log", id], queryFn: () => portalApi.channelLog(api, id), enabled: log });
  return (
    <>
      <Popconfirm title="کلید تازهٔ وب‌هوک ساخته شود؟" description="کلید پیشین دیگر پذیرفته نمی‌شود؛ کلید تازه فقط یک بار نشان داده می‌شود." okText="بسازید" cancelText="انصراف" onConfirm={() => void run("secret", () => portalApi.channelSecret(api, id), setSecret)}>
        <Button size="small" icon={<KeyRound {...I16} />} loading={busy === "secret"}>
          کلید وب‌هوک
        </Button>
      </Popconfirm>
      <Popconfirm title="نشانی وب‌هوک عوض شود؟" description="نشانی پیشین دیگر کار نمی‌کند؛ برای تلگرام و بله دوباره «ثبت در پیام‌رسان» را بزنید." okText="عوض شود" cancelText="انصراف" onConfirm={() => void run("rotate", () => portalApi.rotateChannel(api, id), (r) => message.success(`نشانی تازه: ${r.webhook_url}`))}>
        <Button size="small" icon={<RefreshCw {...I16} />} loading={busy === "rotate"}>
          نشانی تازه
        </Button>
      </Popconfirm>
      {kind === "telegram" || kind === "bale" ? (
        <Button size="small" icon={<PlugZap {...I16} />} loading={busy === "register"} onClick={() => void run("register", () => portalApi.registerChannel(api, id), (r) => (r.ok ? message.success(r.message) : message.warning(r.message)))}>
          ثبت در پیام‌رسان
        </Button>
      ) : null}
      <Button size="small" icon={<ListOrdered {...I16} />} onClick={() => setLog(true)}>
        پیام‌ها
      </Button>
      <Modal open={!!secret} title="کلید وب‌هوک" onCancel={() => setSecret(null)} footer={<Button onClick={() => setSecret(null)}>بستم؛ نگه داشتم</Button>} destroyOnHidden>
        {secret ? (
          <div className="flex flex-col gap-3">
            <Alert type="warning" showIcon title="این کلید را همین حالا نگه دارید؛ دوباره نشان داده نمی‌شود." />
            <CopyBox label="کلید" text={secret.secret} />
            <CopyBox label="نشانی وب‌هوک" text={secret.webhook_url} />
            <p className="m-0 text-[12.5px] text-ink-3">{kind === "webhook" ? (ctx.row.auth_mode === "hmac" ? "سامانهٔ فرستنده بدنهٔ هر پیام را با HMAC-SHA256 همین کلید امضا کند و امضا را در سرآیند x-signature-256 بفرستد." : "سامانهٔ فرستنده این کلید را در سرآیند X-Telegram-Bot-Api-Secret-Token هر پیام بفرستد.") : "«ثبت در پیام‌رسان» نشانی و کلید را خودکار به بات می‌دهد."}</p>
          </div>
        ) : null}
      </Modal>
      <Modal open={log} title="پیام‌های این مجرا" onCancel={() => setLog(false)} footer={null} width={860} destroyOnHidden>
        <Table
          size="small"
          loading={logQ.isLoading}
          rowKey={(r) => `${r.at}${r.direction}${r.chat ?? ""}${r.text ?? ""}`}
          dataSource={logQ.data?.items ?? []}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          locale={{ emptyText: "هنوز پیامی رد و بدل نشده است" }}
          columns={[
            { title: "زمان", dataIndex: "at", render: (v: string) => <span className="ds-num whitespace-nowrap">{formatJalaliDateTime(v)}</span> },
            { title: "سو", dataIndex: "direction", render: (v: string) => (v === "in" ? "دریافت" : "ارسال") },
            { title: "وضعیت", dataIndex: "status", render: (v: string) => STATUS_LABEL[v] ?? v },
            { title: "عضو", dataIndex: "user", render: (v: string | null) => (v ? (logQ.data?.display[v] ?? "عضو") : "—") },
            { title: "متن", dataIndex: "text", render: (v: string | null, r) => <span className="line-clamp-2">{r.error ? <span className="text-danger">{r.error}</span> : (v ?? "")}</span> },
          ]}
        />
      </Modal>
    </>
  );
}

export function WidgetActions({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = ctx.row.id;
  const q = useQuery({ queryKey: ["portal", "widget-snippet", id], queryFn: () => portalApi.widgetSnippet(api, id), enabled: open });
  const make = async () => {
    setBusy(true);
    try {
      await portalApi.widgetKey(api, id);
      await q.refetch();
      ctx.refresh();
      message.success("کلید تازه ساخته شد؛ کد جاسازی وب‌سایت را به‌روز کنید.");
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size="small" icon={<Code2 {...I16} />} onClick={() => setOpen(true)}>
        کد جاسازی
      </Button>
      <Modal open={open} title="ابزارک وب‌سایت" onCancel={() => setOpen(false)} footer={null} width={720} destroyOnHidden>
        <div className="flex flex-col gap-3">
          {q.data?.snippet ? (
            <>
              <CopyBox label="این کد را پیش از </body> در صفحه‌های وب‌سایت بگذارید" text={q.data.snippet} />
              <p className="m-0 text-[12.5px] text-ink-3">ابزارک فقط روی نشانی‌های «وب‌سایت‌های مجاز» کار می‌کند؛ جست‌وجو فقط مقاله‌های عمومیِ انتشار برگزیده را نشان می‌دهد و گفتگو پس از ورود باز می‌شود.</p>
              <Popconfirm title="کلید عوض شود؟" description="کد جاسازی کنونی از کار می‌افتد." okText="عوض شود" cancelText="انصراف" onConfirm={() => void make()}>
                <Button size="small" icon={<RefreshCw {...I16} />} loading={busy} className="self-start">
                  کلید تازه
                </Button>
              </Popconfirm>
            </>
          ) : (
            <>
              <p className="m-0 text-[13px]">هنوز کلیدی برای این ابزارک ساخته نشده است.</p>
              <Button type="primary" icon={<KeyRound {...I16} />} loading={busy || q.isLoading} className="self-start" onClick={() => void make()}>
                ساختن کلید و کد جاسازی
              </Button>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}

export function SurveyActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const campaign = ctx.row.kind === "pulse" || ctx.row.kind === "xla" || ctx.row.kind === "custom";
  const send = async () => {
    setBusy(true);
    try {
      const r = await portalApi.sendCampaign(api, ctx.row.id);
      message.success(`${r.invited.toLocaleString("fa-IR")} دعوت فرستاده شد${r.skipped ? `؛ ${r.skipped.toLocaleString("fa-IR")} نفر کنار گذاشته شدند` : ""}`);
      ctx.refresh();
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Link to={`/${orgId}/portal-admin/results?survey=${ctx.row.id}`}>
        <Button size="small" icon={<BarChart3 {...I16} />}>
          نتیجه‌ها
        </Button>
      </Link>
      {campaign && ctx.row.active !== false ? (
        <Popconfirm title="دعوت برای مخاطبان فرستاده شود؟" description="به هر کس در مخاطبان این نظرسنجی که دعوت باز ندارد، یک دعوت می‌رسد." okText="بفرستید" cancelText="انصراف" onConfirm={() => void send()}>
          <Button size="small" icon={<Send {...I16} />} loading={busy}>
            ارسال برای مخاطبان
          </Button>
        </Popconfirm>
      ) : null}
    </>
  );
}

/** The survey answers about a record (incident, request item, feedback), for those who work it. */
export function RecordSurveys({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const q = useQuery({ queryKey: ["portal", "record-surveys", ctx.table, ctx.row.id], queryFn: () => portalApi.recordSurveys(api, ctx.table, ctx.row.id), retry: false });
  const rows = q.data?.responses ?? [];
  if (q.isLoading) return null;
  if (!rows.length) return <p className="m-0 text-[13px] text-ink-3">پاسخی به نظرسنجی دربارهٔ این مورد نرسیده است.</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-0.5">
          <span className="font-medium">
            {r.title}
            {r.csat !== null ? ` · رضایت ${r.csat.toLocaleString("fa-IR")} از ۵` : r.score !== null ? ` · امتیاز ${r.score.toLocaleString("fa-IR")}` : ""}
          </span>
          {r.comment ? <span className="text-ink-2">{r.comment}</span> : null}
          {r.at ? <span className="text-[12px] text-ink-3">{formatJalali(r.at.slice(0, 10))}</span> : null}
        </li>
      ))}
    </ul>
  );
}
