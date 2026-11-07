// Record-page widgets of the channel tables (loaded with the record page): «ایمیل آزمایشی» and «بررسی صندوق اکنون»
// on an e-mail channel with its polling state in the side panel; «پیام آزمایشی» and the SMS gateway presets
// (کاوه‌نگار، قاصدک، JSON عمومی) on a messenger, webhook or SMS channel. Tests use the stored settings.
import { useState } from "react";
import { Button, Dropdown, Input, Popover } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Send, SlidersHorizontal } from "lucide-react";
import { SMS_PRESETS } from "@shared/notify";
import { faDigits } from "@shared/format";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { ICON14, Note } from "../../components/blocks";
import { relTime } from "../../records/model/activity";
import type { RecordContext } from "../../records/extensions";
import { KEYS, type InboxStatus, type PollResult } from "./api";

const fa = (n: number | undefined) => faDigits(String(n ?? 0));

export function pollSummary(r: PollResult): string {
  if (!r.fetched) return "ایمیل تازه‌ای نبود.";
  const parts = [`${fa(r.created)} رکورد تازه`, `${fa(r.replied)} پاسخ`];
  if (r.rejected) parts.push(`${fa(r.rejected)} کنار گذاشته`);
  if (r.failed) parts.push(`${fa(r.failed)} خطا`);
  return `${fa(r.fetched)} ایمیل خوانده شد: ${parts.join("، ")}.`;
}

/** A button that asks for an address or number first (empty: the caller's own). */
function TestButton({ label, placeholder, ltr, run }: { label: string; placeholder: string; ltr?: boolean; run: (to: string | null) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await run(to.trim() || null);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      content={
        <div className="flex w-72 flex-col gap-2">
          <Input dir={ltr ? "ltr" : undefined} value={to} onChange={(e) => setTo(e.target.value)} placeholder={placeholder} onPressEnter={go} aria-label={placeholder} autoFocus />
          <Button type="primary" size="small" loading={busy} onClick={go}>
            ارسال
          </Button>
        </div>
      }
    >
      <Button icon={<Send {...ICON14} />}>{label}</Button>
    </Popover>
  );
}

export function EmailChannelActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const [checking, setChecking] = useState(false);
  const id = ctx.row.id;
  if (!id || !ctx.meta.canWrite) return null;
  const test = async (to: string | null) => {
    try {
      const r = await api.post<{ to: string }>(`/notify/email-channels/${id}/test`, { to });
      n.ok(`ایمیل آزمایشی به ${r.to} فرستاده شد.`);
    } catch (e) {
      n.error(e);
    }
  };
  const check = async () => {
    setChecking(true);
    try {
      const r = await api.post<{ result: PollResult }>(`/notify/email-channels/${id}/check`);
      n.ok(pollSummary(r.result));
    } catch (e) {
      n.error(e);
    } finally {
      setChecking(false);
      void qc.invalidateQueries({ queryKey: KEYS.status(orgId, id) });
    }
  };
  return (
    <>
      <TestButton label="ایمیل آزمایشی" placeholder="نشانی (خالی: ایمیل شما)" ltr run={test} />
      {ctx.row.inbound ? (
        <Button icon={<Inbox {...ICON14} />} loading={checking} onClick={check}>
          بررسی صندوق اکنون
        </Button>
      ) : null}
    </>
  );
}

export function InboxStatusPanel({ id }: { id: string }) {
  const { api, orgId, timezone } = useOrg();
  const q = useQuery({ queryKey: KEYS.status(orgId, id), queryFn: () => api.get<InboxStatus>(`/notify/email-channels/${id}/status`), refetchInterval: 60_000 });
  const s = q.data;
  if (!s) return null;
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div>
        آخرین بررسی:{" "}
        {s.last_checked_at ? <span title={formatJalaliDateTime(s.last_checked_at, timezone)}>{relTime(s.last_checked_at, Date.now(), timezone)}</span> : "هنوز بررسی نشده"}
      </div>
      {s.last_result ? <div className="text-ink-2">{pollSummary(s.last_result)}</div> : null}
      {s.last_error ? <Note tone="danger">{s.last_error}</Note> : null}
    </div>
  );
}

export function ChannelActions({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const n = useNotify();
  const id = ctx.row.id;
  if (!id || !ctx.meta.canWrite) return null;
  const sms = ctx.row.kind === "sms";
  const test = async (to: string | null) => {
    try {
      await api.post(`/notify/channels/${id}/test`, { to });
      n.ok("پیام آزمایشی فرستاده شد.");
    } catch (e) {
      n.error(e);
    }
  };
  return (
    <>
      {sms ? (
        <Dropdown
          trigger={["click"]}
          menu={{
            items: Object.entries(SMS_PRESETS).map(([key, p]) => ({ key, label: p.label })),
            onClick: ({ key }) => {
              const { label: _label, ...fields } = SMS_PRESETS[key];
              void ctx.save({ sms_headers: null, ...fields }).then((ok) => ok && n.ok(`تنظیم «${SMS_PRESETS[key].label}» گذاشته شد؛ کلید و شمارهٔ فرستنده را وارد کنید.`));
            },
          }}
        >
          <Button icon={<SlidersHorizontal {...ICON14} />}>پیش‌تنظیم درگاه</Button>
        </Dropdown>
      ) : null}
      {sms ? <TestButton label="پیامک آزمایشی" placeholder="شمارهٔ همراه (خالی: شمارهٔ شما)" ltr run={test} /> : (
        <Button icon={<Send {...ICON14} />} onClick={() => void test(null)}>
          پیام آزمایشی
        </Button>
      )}
    </>
  );
}
