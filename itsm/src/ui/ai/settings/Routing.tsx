// «کارها و مدل‌ها»: for each job (دستیار، تحلیل و گزارش، کارهای سریع، خواندن تصویر و سند) the ordered chain of
// connection + model — the first that works answers, the next ones take over on errors — and the effort of the job.
// An empty chain means «خودکار»: every enabled connection by priority, each with the models of the job's tier in order.
// In the Windows app with «استفاده از اتصال‌های نسخهٔ وب» on, «اول نسخهٔ وب» lets the web version answer a job before
// this computer's chain (a model on a computer without a graphics card is slow for the assistant's long prompts).
import { useEffect, useMemo, useState } from "react";
import { AutoComplete, Button, Segmented, Select, Switch, Tooltip } from "antd";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import type { AiConnectionPublic, AiEffort, AiJob, AiSettings } from "@shared/ai/types";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { useNotify } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { EmptyState } from "../../components/display";
import { EFFORTS, EFFORT_LABEL, JOBS, JOB_LABEL, autoChain, cleanChain, modelOptions, moveLink, type ChainLink } from "../kit/model";
import { useAiInvalidate } from "../kit/hooks";

const ICON14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

function ChainEditor({ job, chain, connections, onChange }: { job: AiJob; chain: ChainLink[]; connections: AiConnectionPublic[]; onChange: (c: ChainLink[]) => void }) {
  const tier = JOB_LABEL[job].tier;
  const live = connections.filter((c) => c.enabled);
  const autoLinks = autoChain(job, connections);
  const auto = autoLinks[0] ?? null;
  const conn = (id: string) => connections.find((c) => c.id === id);
  const add = () => {
    const used = new Set(chain.map((l) => `${l.connection_id}\u0000${l.model}`));
    const c = live.find((x) => !chain.some((l) => l.connection_id === x.id)) ?? live[0];
    if (!c) return;
    const model = modelOptions(c, tier).find((m) => !used.has(`${c.id}\u0000${m}`)) ?? "";
    onChange([...chain, { connection_id: c.id, model }]);
  };
  if (!chain.length)
    return (
      <div className="ai-auto">
        <span className="min-w-0 flex-1">
          {auto ? (
            <>
              خودکار: <span className="ai-mid">{auto.model}</span> از «{conn(auto.connection_id)?.label}»
              {autoLinks.length > 1 ? `، با ${fa(autoLinks.length - 1)} جایگزین` : null}
            </>
          ) : (
            "خودکار؛ هنوز اتصال فعالی نیست."
          )}
        </span>
        {live.length ? (
          <Button size="small" icon={<Plus {...ICON14} />} onClick={() => (autoLinks.length ? onChange(autoLinks.slice(0, 8)) : add())}>
            تعیین زنجیره
          </Button>
        ) : null}
      </div>
    );
  return (
    <>
      <ol className="ai-chain">
        {chain.map((l, i) => {
          const c = conn(l.connection_id);
          return (
            <li key={`${i}-${l.connection_id}`} className="ai-link">
              <span className="ai-link-n" title={i === 0 ? "اصلی" : `جایگزین ${fa(i)}`}>
                {fa(i + 1)}
              </span>
              <Select
                size="small"
                value={l.connection_id || undefined}
                onChange={(id) => {
                  const nc = conn(id);
                  const model = modelOptions(nc, tier)[0] ?? "";
                  onChange(chain.map((x, j) => (j === i ? { connection_id: id, model } : x)));
                }}
                options={connections.map((x) => ({ value: x.id, label: x.enabled ? x.label : `${x.label} (غیرفعال)`, disabled: !x.enabled }))}
                status={!c ? "error" : undefined}
                placeholder="اتصال"
                aria-label={`اتصال ردیف ${fa(i + 1)}`}
              />
              <AutoComplete
                size="small"
                value={l.model}
                onChange={(model) => onChange(chain.map((x, j) => (j === i ? { ...x, model } : x)))}
                options={modelOptions(c, tier).map((m) => ({ value: m, label: <span className="ai-mid">{m}</span> }))}
                filterOption={(input, o) => String(o?.value ?? "").toLowerCase().includes(input.toLowerCase())}
                className="ai-ltr-in"
                placeholder="مدل"
                aria-label={`مدل ردیف ${fa(i + 1)}`}
                status={!l.model.trim() ? "warning" : undefined}
              />
              <span className="ai-link-x">
                <Tooltip title="بالاتر">
                  <Button size="small" type="text" icon={<ArrowUp {...ICON14} />} disabled={i === 0} onClick={() => onChange(moveLink(chain, i, -1))} aria-label="بالاتر" />
                </Tooltip>
                <Tooltip title="پایین‌تر">
                  <Button size="small" type="text" icon={<ArrowDown {...ICON14} />} disabled={i === chain.length - 1} onClick={() => onChange(moveLink(chain, i, 1))} aria-label="پایین‌تر" />
                </Tooltip>
                <Tooltip title="برداشتن">
                  <Button size="small" type="text" icon={<X {...ICON14} />} onClick={() => onChange(chain.filter((_, j) => j !== i))} aria-label="برداشتن" />
                </Tooltip>
              </span>
            </li>
          );
        })}
      </ol>
      <div>
        <Button size="small" type="text" icon={<Plus {...ICON14} />} onClick={add} disabled={!live.length}>
          افزودن جایگزین
        </Button>
      </div>
    </>
  );
}

export function RoutingTab({ settings, connections, mode, linked: linkedView }: { settings: AiSettings; connections: AiConnectionPublic[]; mode?: "cloud" | "desktop"; linked?: boolean }) {
  const { api } = useOrg();
  const { meta } = useSession();
  const n = useNotify();
  const refresh = useAiInvalidate();
  const [routing, setRouting] = useState(settings.routing);
  const [effort, setEffort] = useState(settings.effort);
  const [cloudFirst, setCloudFirst] = useState(settings.cloud_first);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setRouting(settings.routing);
    setEffort(settings.effort);
    setCloudFirst(settings.cloud_first);
  }, [settings]);
  const ids = useMemo(() => new Set(connections.map((c) => c.id)), [connections]);
  // «اول نسخهٔ وب»: only in the Windows app, linked, with «استفاده از اتصال‌های نسخهٔ وب» on
  const webFirst = (mode ?? meta?.mode) === "desktop" && settings.use_cloud && (linkedView ?? !!meta?.desktop?.cloud?.linked);
  const dirty =
    JSON.stringify(routing) !== JSON.stringify(settings.routing) || JSON.stringify(effort) !== JSON.stringify(settings.effort) || JSON.stringify(cloudFirst) !== JSON.stringify(settings.cloud_first);

  const save = async () => {
    const clean = Object.fromEntries(JOBS.map((j) => [j, cleanChain(routing[j] ?? [], ids)])) as AiSettings["routing"];
    setSaving(true);
    try {
      await api.put("/ai/settings", { ...settings, routing: clean, effort, cloud_first: cloudFirst });
      n.ok("کارها و مدل‌ها ذخیره شد.");
      refresh();
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (!connections.length)
    return (
      <div className="bk-card">
        <EmptyState title="اول یک اتصال اضافه کنید." description="هر کار از مدل‌های اتصال‌های شما استفاده می‌کند." />
      </div>
    );

  return (
    <div className="bk-card">
      <div className="bk-card-b" style={{ paddingBlock: 0 }}>
        {JOBS.map((j) => (
          <div key={j} className="bk-set">
            <div>
              <div className="bk-set-t">{JOB_LABEL[j].title}</div>
              <div className="bk-set-d">{JOB_LABEL[j].about}</div>
            </div>
            <div className="bk-set-b ai-job">
              <ChainEditor job={j} chain={routing[j] ?? []} connections={connections} onChange={(c) => setRouting((r) => ({ ...r, [j]: c }))} />
              <div className="ai-effort">
                <span>میزان تلاش</span>
                <Segmented<AiEffort>
                  size="small"
                  value={effort[j] ?? "medium"}
                  onChange={(v) => setEffort((e) => ({ ...e, [j]: v }))}
                  options={EFFORTS.map((e) => ({ value: e, label: EFFORT_LABEL[e] }))}
                  aria-label={`میزان تلاش ${JOB_LABEL[j].title}`}
                />
                {webFirst ? (
                  <Tooltip title="این کار اول از اتصال‌های نسخهٔ وب پاسخ می‌گیرد و اتصال‌های این رایانه فقط وقتی پاسخ می‌دهند که نسخهٔ وب در دسترس نباشد.">
                    <label className="ai-webfirst">
                      <span>اول نسخهٔ وب</span>
                      <Switch
                        size="small"
                        checked={cloudFirst.includes(j)}
                        onChange={(v) => setCloudFirst((cf) => JOBS.filter((x) => (x === j ? v : cf.includes(x))))}
                        aria-label={`اول نسخهٔ وب برای ${JOB_LABEL[j].title}`}
                      />
                    </label>
                  </Tooltip>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="bk-savebar">
        <span className="bk-savebar-m">تلاش بیشتر یعنی پاسخ دقیق‌تر، کندتر و پرهزینه‌تر؛ مدلی که پشتیبانی نکند، آن را نادیده می‌گیرد.</span>
        <Button type="primary" loading={saving} disabled={!dirty} onClick={save}>
          ذخیره
        </Button>
      </div>
    </div>
  );
}
