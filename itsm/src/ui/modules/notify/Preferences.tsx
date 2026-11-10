// «اعلان‌های من»: what the caller receives and how — a matrix of events × personal channels (in-app, e-mail, SMS;
// a row «همهٔ اعلان‌ها» switches a channel off entirely), e-mail at once or as an hourly or daily digest, and quiet
// hours during which e-mail and SMS wait. The organisation's mandatory notices arrive whatever is chosen here.
import { useMemo, useState } from "react";
import { Button, Checkbox, Select, Switch } from "antd";
import { DEFAULT_PREFS, DIGEST_MODES, NOTIFY_CHANNELS, NOTIFY_EVENTS, NOTIFY_EVENT_KEYS, PERSONAL_CHANNELS, type DigestMode, type NotifyPrefs } from "@shared/notify";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Card, Field } from "../../components/blocks";
import { Skeleton } from "../../components/display";
import { KEYS, usePrefs } from "./api";
import { quietProblem, receives, setReceive } from "./model";
import "./notify.css";

const pad = (n: number) => String(n).padStart(2, "0");
/** Quiet-time choices every half hour, labelled in Persian digits. */
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const v = `${pad(Math.floor(i / 2))}:${i % 2 ? "30" : "00"}`;
  return { value: v, label: faDigits(v) };
});
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: faDigits(`${pad(h)}:00`) }));

export default function Preferences() {
  const { api, orgId } = useOrg();
  const q = usePrefs();
  const [draft, setDraft] = useState<NotifyPrefs | null>(null);
  const prefs = draft ?? q.data?.prefs ?? DEFAULT_PREFS;
  const problem = quietProblem(prefs.quiet_from, prefs.quiet_to);
  const save = useAction((p: NotifyPrefs) => api.put<{ prefs: NotifyPrefs }>("/notify/prefs", p), {
    success: "تنظیم اعلان‌ها ذخیره شد.",
    invalidate: [KEYS.prefs(orgId)],
    onSuccess: () => setDraft(null),
  });
  const set = (p: Partial<NotifyPrefs>) => setDraft({ ...prefs, ...p });
  const digestOptions = useMemo(() => (Object.entries(DIGEST_MODES) as [DigestMode, string][]).map(([value, label]) => ({ value, label })), []);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="اعلان‌های من"
        actions={
          <Button type="primary" disabled={!draft || !!problem} loading={save.isPending} onClick={() => save.mutate(prefs)}>
            ذخیره
          </Button>
        }
      />
      {q.isLoading ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <Card title="چه اعلان‌هایی، از چه راهی" flush>
            <div className="overflow-x-auto">
              <table className="nf-matrix">
                <thead>
                  <tr>
                    <th scope="col">رویداد</th>
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
                          <Checkbox
                            checked={receives(prefs, ev, c)}
                            disabled={!receives(prefs, "*", c)}
                            onChange={(e) => setDraft(setReceive(prefs, ev, c, e.target.checked))}
                            aria-label={`${NOTIFY_EVENTS[ev].label} — ${NOTIFY_CHANNELS[c].label}`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="ایمیل‌ها و ساعت سکوت">
            <div className="nf-prefs-grid">
              <Field label="ایمیل اعلان‌ها">
                <Select value={prefs.digest} options={digestOptions} onChange={(v) => set({ digest: v })} aria-label="ایمیل اعلان‌ها" />
              </Field>
              {prefs.digest === "daily" ? (
                <Field label="ساعت خلاصهٔ روزانه">
                  <Select value={prefs.digest_hour} options={HOURS} onChange={(v) => set({ digest_hour: v })} aria-label="ساعت خلاصهٔ روزانه" />
                </Field>
              ) : null}
              <Field label="آغاز سکوت">
                <Select allowClear placeholder="بدون سکوت" value={prefs.quiet_from ?? undefined} options={TIMES} onChange={(v) => set({ quiet_from: v ?? null })} aria-label="آغاز سکوت" />
              </Field>
              <Field label="پایان سکوت" hint={problem ?? undefined}>
                <Select allowClear placeholder="بدون سکوت" value={prefs.quiet_to ?? undefined} options={TIMES} status={problem ? "error" : undefined} onChange={(v) => set({ quiet_to: v ?? null })} aria-label="پایان سکوت" />
              </Field>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
