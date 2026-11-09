// «نمایه و اعلان‌ها» (PTL-030…033): who the person is to the desk (name, unit, place, manager — from their profile),
// what they are told and how (the notification service's own preferences: per event and channel, e-mail digests, quiet
// hours), their messenger accounts — linked only by a one-time code they send to the organisation's bot, listed and
// unlinked here — who stands in for them while they are away (approvals, assigned work, notices), and which portal
// they use when their workspaces have several.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Input, Popconfirm, Select, Skeleton, Switch } from "antd";
import { Copy, Link2, MessageCircle, Trash2, UserRoundCheck } from "lucide-react";
import { DEFAULT_PREFS, NOTIFY_CHANNELS, NOTIFY_EVENTS, NOTIFY_EVENT_KEYS, PERSONAL_CHANNELS, type NotifyPrefs } from "@shared/notify";
import { formatCode } from "@shared/portal/logic";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { Chip } from "../../components/display";
import { UserSelect, recordsApi, useMe, useTableDef } from "../../records";
import { KEYS as NOTIFY_KEYS, usePrefs } from "../notify/api";
import { receives, setReceive } from "../notify/model";
import { PORTAL_KEYS, portalApi, type LinkCodeView, type PortalConfig } from "./api";
import { I16, PageHead, Section } from "./parts";
import "../notify/notify.css";

function Facts({ rows }: { rows: [string, string | null | undefined][] }) {
  const shown = rows.filter(([, v]) => v);
  return (
    <dl className="pt-facts">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Notifications() {
  const { api, orgId } = useOrg();
  const q = usePrefs();
  const [draft, setDraft] = useState<NotifyPrefs | null>(null);
  const prefs = draft ?? q.data?.prefs ?? DEFAULT_PREFS;
  const save = useAction((p: NotifyPrefs) => api.put<{ prefs: NotifyPrefs }>("/notify/prefs", p), {
    success: "تنظیم اعلان‌ها ذخیره شد.",
    invalidate: [NOTIFY_KEYS.prefs(orgId)],
    onSuccess: () => setDraft(null),
  });
  if (q.isLoading) return <Skeleton active />;
  return (
    <div className="pt-card flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="nf-matrix">
          <thead>
            <tr>
              <th scope="col">چه چیزی</th>
              {PERSONAL_CHANNELS.map((c) => (
                <th key={c} scope="col" className="nf-cell">
                  {NOTIFY_CHANNELS[c].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>همهٔ اعلان‌ها</td>
              {PERSONAL_CHANNELS.map((c) => (
                <td key={c} className="nf-cell">
                  <Switch size="small" checked={receives(prefs, "*", c)} onChange={(on) => setDraft(setReceive(prefs, "*", c, on))} aria-label={`همهٔ اعلان‌ها — ${NOTIFY_CHANNELS[c].label}`} />
                </td>
              ))}
            </tr>
            {NOTIFY_EVENT_KEYS.map((ev) => (
              <tr key={ev}>
                <td>{NOTIFY_EVENTS[ev].label}</td>
                {PERSONAL_CHANNELS.map((c) => (
                  <td key={c} className="nf-cell">
                    <Checkbox checked={receives(prefs, ev, c)} disabled={!receives(prefs, "*", c)} onChange={(e) => setDraft(setReceive(prefs, ev, c, e.target.checked))} aria-label={`${NOTIFY_EVENTS[ev].label} — ${NOTIFY_CHANNELS[c].label}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-[12.5px] text-ink-3">اطلاعیه‌های لازم سازمان (مثل قطعی‌ها) هر چه این‌جا برگزینید می‌رسد. ساعت سکوت و خلاصهٔ ایمیلی در «اعلان‌های من» در میز کار تنظیم می‌شود.</p>
      <div>
        <Button type="primary" disabled={!draft} loading={save.isPending} onClick={() => save.mutate(prefs)}>
          ذخیرهٔ اعلان‌ها
        </Button>
      </div>
    </div>
  );
}

function Messengers({ identities, channels }: { identities: { id: string; channel_name: string; kind: string; external_name: string | null; linked_at: string | null }[]; channels: number }) {
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  const notify = useNotify();
  const [code, setCode] = useState<LinkCodeView | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [code]);
  const left = code ? Math.max(0, Math.round((Date.parse(code.expires_at) - now) / 1000)) : 0;
  const make = async () => {
    setBusy(true);
    try {
      setCode(await portalApi.linkCode(api));
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };
  const unlink = async (id: string) => {
    try {
      await portalApi.unlink(api, id);
      notify.ok("حساب جدا شد");
      void qc.invalidateQueries({ queryKey: PORTAL_KEYS.profile(orgId) });
    } catch (e) {
      notify.error(e);
    }
  };
  if (!channels && !identities.length) return <p className="pt-muted m-0 text-[13px]">سازمان هنوز پیام‌رسانی را وصل نکرده است.</p>;
  return (
    <div className="pt-card flex flex-col gap-3">
      {identities.length ? (
        <ul className="pt-list">
          {identities.map((i) => (
            <li key={i.id} className="flex items-center gap-3 py-2">
              <MessageCircle {...I16} aria-hidden className="text-ink-3" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{i.channel_name}</span>
                <span className="text-[12.5px] text-ink-3">
                  {i.external_name ?? "حساب پیام‌رسان"}
                  {i.linked_at ? ` · از ${formatJalali(i.linked_at.slice(0, 10))}` : ""}
                </span>
              </span>
              <Popconfirm title="این حساب جدا شود؟" description="از این پس پیام‌های آن حساب به نام شما ثبت نمی‌شود." okText="جدا شود" cancelText="انصراف" onConfirm={() => unlink(i.id)}>
                <Button size="small" danger icon={<Trash2 {...I16} />}>
                  جدا کردن
                </Button>
              </Popconfirm>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[13px] text-ink-2">با پیام‌رسان هم می‌توانید بپرسید، گزارش دهید و پیگیری کنید. برای اتصال، یک کد یک‌بار مصرف بگیرید و آن را برای بات سازمان بفرستید.</p>
      )}
      {code && left > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border border-line p-3" role="status">
          <span className="text-[13px] text-ink-3">این کد را برای بات بفرستید (تا {Math.floor(left / 60).toLocaleString("fa-IR")}:{String(left % 60).padStart(2, "0").replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)])} دیگر):</span>
          <div className="flex flex-wrap items-center gap-2">
            <bdi className="ltr text-[22px] font-medium tracking-widest" dir="ltr">
              {formatCode(code.code)}
            </bdi>
            <Button
              size="small"
              icon={<Copy {...I16} />}
              onClick={() => {
                void navigator.clipboard?.writeText(code.code).then(() => notify.ok("کد رونوشت شد"), () => undefined);
              }}
            >
              رونوشت
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {code.channels.map((c) =>
              c.deep_link ? (
                <a key={c.id} className="pt-chip-btn" href={c.deep_link} target="_blank" rel="noopener noreferrer">
                  <Link2 {...I16} aria-hidden /> باز کردن {c.name}
                </a>
              ) : (
                <Chip key={c.id}>{c.name}</Chip>
              ),
            )}
          </div>
          <span className="text-[12px] text-ink-3">کد را به کسی ندهید؛ هر کس آن را بفرستد، به نام شما وصل می‌شود.</span>
        </div>
      ) : null}
      {channels ? (
        <div>
          <Button icon={<Link2 {...I16} />} loading={busy} onClick={make}>
            {code && left > 0 ? "کد تازه" : "گرفتن کد اتصال"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const SPANS = [
  { value: 1, label: "یک روز" },
  { value: 3, label: "سه روز" },
  { value: 7, label: "یک هفته" },
  { value: 14, label: "دو هفته" },
  { value: 30, label: "یک ماه" },
];

function Delegation() {
  const { api } = useOrg();
  const { userId } = useMe();
  const notify = useNotify();
  const { def } = useTableDef("delegation");
  const list = useQuery({
    queryKey: ["portal", "delegations", userId],
    queryFn: () => recordsApi.list(api, "delegation", { filter: { and: [{ f: "from_user", op: "is_me" }, { f: "active", op: "eq", v: true }] }, size: 20, sort: "-starts_at", fields: ["to_user", "starts_at", "ends_at", "scopes", "reason"] }),
    enabled: !!def,
  });
  const [to, setTo] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [scopes, setScopes] = useState<string[]>(["approvals"]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!def) return <p className="pt-muted m-0 text-[13px]">جانشینی برای شما باز نیست.</p>;
  const rows = list.data?.rows ?? [];
  const display = list.data?.display ?? {};
  const add = async () => {
    if (!to) return setProblem("جانشین را برگزینید");
    if (to === userId) return setProblem("خودتان نمی‌توانید جانشین خودتان باشید");
    setBusy(true);
    setProblem(null);
    try {
      const start = new Date();
      await recordsApi.create(api, "delegation", { from_user: userId, to_user: to, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + days * 86_400_000).toISOString(), scopes, reason: reason.trim() || null, active: true });
      notify.ok("جانشین ثبت شد");
      setTo(null);
      setReason("");
      void list.refetch();
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const end = async (id: string) => {
    try {
      await recordsApi.update(api, "delegation", id, { active: false });
      void list.refetch();
    } catch (e) {
      notify.error(e);
    }
  };
  return (
    <div className="pt-card flex flex-col gap-3">
      {rows.length ? (
        <ul className="pt-list">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
              <UserRoundCheck {...I16} aria-hidden className="text-ink-3" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{display[String(r.to_user)] ?? "جانشین"}</span>
                <span className="text-[12.5px] text-ink-3">
                  {r.starts_at ? formatJalaliDateTime(String(r.starts_at)) : ""}
                  {r.ends_at ? ` تا ${formatJalaliDateTime(String(r.ends_at))}` : ""}
                </span>
              </span>
              <Button size="small" onClick={() => void end(r.id)}>
                پایان دادن
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[13px] text-ink-2">وقتی نیستید، کسی را بگذارید که تأییدها، کارهای ارجاعی یا اعلان‌های شما را در دست بگیرد.</p>
      )}
      {def.can.create ? (
        <div className="flex flex-col gap-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <UserSelect value={to ?? undefined} onChange={(v) => setTo(typeof v === "string" ? v : null)} placeholder="جانشین" />
            <Select value={days} onChange={setDays} options={SPANS} aria-label="مدت" />
          </div>
          <Checkbox.Group
            value={scopes}
            onChange={(v) => setScopes(v.length ? (v as string[]) : ["approvals"])}
            options={[
              { value: "approvals", label: "تأییدها" },
              { value: "assignments", label: "کارهای ارجاعی" },
              { value: "notifications", label: "اعلان‌ها" },
            ]}
          />
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="علت (مثلاً: مرخصی)" />
          {problem ? <Alert type="error" title={problem} /> : null}
          <div>
            <Button icon={<UserRoundCheck {...I16} />} loading={busy} onClick={add}>
              گذاشتن جانشین
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function Profile({ cfg }: { cfg: PortalConfig }) {
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  const notify = useNotify();
  const q = useQuery({ queryKey: PORTAL_KEYS.profile(orgId), queryFn: () => portalApi.profile(api) });
  const p = q.data;
  const portals = useMemo(() => cfg.portals.map((x) => ({ value: x.id, label: x.name })), [cfg.portals]);
  return (
    <>
      <PageHead title="نمایه و اعلان‌ها" />
      {q.isLoading ? (
        <div className="pt-card">
          <Skeleton active />
        </div>
      ) : p ? (
        <Section title="من">
          <div className="pt-card">
            <Facts
              rows={[
                ["نام", p.user.name],
                ["ایمیل", p.user.email.endsWith(".invalid") ? null : p.user.email],
                ["همراه", p.user.mobile],
                ["سمت", p.profile.title],
                ["واحد", p.profile.unit],
                ["محل", p.profile.location],
                ["مدیر", p.profile.manager],
              ]}
            />
            <p className="mb-0 mt-3 text-[12.5px] text-ink-3">اگر چیزی نادرست است، به میز خدمت بگویید تا در نمایهٔ سازمانی شما درست شود.</p>
          </div>
        </Section>
      ) : null}
      {portals.length > 1 ? (
        <Section title="درگاه من">
          <div className="pt-card flex flex-wrap items-center gap-3">
            <Select
              value={cfg.portal.id ?? undefined}
              options={portals}
              style={{ minInlineSize: 240 }}
              aria-label="درگاه"
              onChange={async (v) => {
                try {
                  await portalApi.choose(api, v);
                  await qc.invalidateQueries({ queryKey: PORTAL_KEYS.all(orgId) });
                  notify.ok("درگاه شما عوض شد");
                } catch (e) {
                  notify.error(e);
                }
              }}
            />
          </div>
        </Section>
      ) : null}
      <Section title="اعلان‌ها">
        <Notifications />
      </Section>
      <Section title="پیام‌رسان‌ها">{p ? <Messengers identities={p.identities} channels={p.channels} /> : null}</Section>
      <Section title="جانشینی">
        <Delegation />
      </Section>
    </>
  );
}
