// Add or edit a connection (a side sheet): the provider with its Persian note and «دریافت کلید ↗», where it works from
// (Iran, the Windows app, data leaving the country), the name, the write-only key, the base URL for gateways, custom and
// local servers, the smart/fast/vision models (first = main, the rest are tried in order), enabled and priority.
// «آزمایش اتصال» runs on the values in the form before they are saved.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AutoComplete, Button, Checkbox, Drawer, Input, InputNumber, Select, Switch } from "antd";
import { ChevronDown, ExternalLink, FlaskConical, Globe, Monitor, Plug, Route, ShieldCheck } from "lucide-react";
import type { AiConnectionPublic, AiProtocol, AiTestReport } from "@shared/ai/types";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { Field, Note } from "../../modules/reports/kit";
import { TIER_LABEL, cleanKey } from "../kit/model";
import { objectOf } from "../kit/hooks";
import type { AiConnectionInput, AiPresetView } from "../kit/types";
import { TestReport } from "./TestReport";

type Tier = "smart" | "fast" | "vision";
const TIERS: Tier[] = ["smart", "fast", "vision"];

type Region = AiPresetView["region"];

const REGION_GROUP: { key: Region; label: string }[] = [
  { key: "foreign", label: "سرویس‌های خارجی" },
  { key: "iran", label: "درگاه‌های ایرانی، پرداخت ریالی" },
  { key: "local", label: "مدل محلی روی همین رایانه" },
  { key: "any", label: "سرویس دیگر" },
];

/** A short line under the preset's own note: where it runs (the details open with «بیشتر»). */
const REGION_LINE: Record<Region, { icon: typeof Globe; text: string }> = {
  foreign: { icon: Globe, text: "سرویس خارجی" },
  iran: { icon: Route, text: "درگاه داخلی" },
  local: { icon: Monitor, text: "روی همین رایانه" },
  any: { icon: Plug, text: "هر سرویس سازگار؛ نشانی پایه را کامل وارد کنید (معمولاً به ‎/v1 ختم می‌شود)" },
};

const PROTOCOL_LABEL: Record<AiProtocol, string> = {
  "openai-chat": "سازگار با OpenAI (Chat Completions)",
  "openai-responses": "OpenAI Responses",
  anthropic: "سازگار با Anthropic (Messages)",
  gemini: "Gemini",
};

const regionOf = (p: AiPresetView | undefined): Region => p?.region ?? "any";
const editableBase = (p: AiPresetView | undefined) => !!p && (p.base_url_required || !p.base_url || regionOf(p) !== "foreign");

/** A new connection starts with every suggested model of each tier: the first answers, the rest stand in (free quotas are per model). */
function presetModels(p: AiPresetView | undefined): Record<Tier, string[]> {
  return { smart: [...(p?.models.smart ?? [])], fast: [...(p?.models.fast ?? [])], vision: [...(p?.models.vision ?? [])] };
}

type Draft = Omit<AiConnectionInput, "models" | "label"> & { label: string; models: Record<Tier, string[]>; enabled: boolean; priority: number; free_tier: boolean };

export function ConnectionDrawer({
  open,
  connection,
  presets,
  secretOk,
  count,
  onClose,
  onSaved,
  onDelete,
}: {
  open: boolean;
  connection: AiConnectionPublic | null;
  presets: AiPresetView[];
  secretOk: boolean;
  /** connections already stored (for the default priority of a new one) */
  count: number;
  onClose: () => void;
  onSaved: (c: AiConnectionPublic | null, created: boolean) => void;
  onDelete: (c: AiConnectionPublic) => void;
}) {
  const { api } = useOrg();
  const n = useNotify();
  const editing = !!connection;
  const [presetId, setPresetId] = useState<string>("");
  const [protocol, setProtocol] = useState<AiProtocol | undefined>(undefined);
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [models, setModels] = useState<Record<Tier, string[]>>({ smart: [], fast: [], vision: [] });
  const [enabled, setEnabled] = useState(true);
  const [freeTier, setFreeTier] = useState(false);
  const [priority, setPriority] = useState<number>(1);
  const [more, setMore] = useState(false);
  const [region, setRegion] = useState(false);
  const [report, setReport] = useState<AiTestReport | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listed, setListed] = useState<string[]>([]);

  const preset = presets.find((p) => p.id === presetId);

  // a fresh form every time the sheet opens
  useEffect(() => {
    if (!open) return;
    const c = connection;
    const first = c ? presets.find((p) => p.id === c.preset) : presets[0];
    setPresetId(c?.preset ?? first?.id ?? "");
    setProtocol(c?.protocol ?? first?.protocol);
    setLabel(c?.label ?? "");
    setKey("");
    setRemoveKey(false);
    setBaseUrl(c?.base_url ?? (editableBase(first) ? first?.base_url ?? "" : ""));
    setModels(c ? { smart: [...c.models.smart], fast: [...c.models.fast], vision: [...c.models.vision] } : presetModels(first));
    setEnabled(c?.enabled ?? true);
    setFreeTier(c?.free_tier ?? false);
    setPriority(c?.priority ?? count + 1);
    setMore(false);
    setRegion(false);
    setReport(null);
    setListed(c?.available_models ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connection?.id]);

  const pickPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    setPresetId(id);
    setProtocol(p?.protocol);
    setBaseUrl(editableBase(p) ? p?.base_url ?? "" : "");
    setModels(presetModels(p));
    setListed([]);
    setReport(null);
  };

  const keyRequired = preset?.key_required !== false && regionOf(preset) !== "local";
  // the stored key goes only where it was saved for (the server checks the same): a new service or
  // base URL needs the key again, or an explicit «ذخیره بدون کلید» for a service that works without one
  const destinationOf = (pid: string, url: string | null | undefined) => `${pid} ${String(url || presets.find((p) => p.id === pid)?.base_url || "").trim().replace(/\/+$/, "")}`;
  const moved = editing && destinationOf(presetId, baseUrl.trim()) !== destinationOf(connection!.preset, connection!.base_url);
  const keyAgain = editing && !!connection!.has_key && moved && !cleanKey(key);
  const canDropKey = keyAgain && preset?.key_required === false;
  const baseRequired = !!preset?.base_url_required || !preset?.base_url;
  const input = (): Draft => ({
    label: label.trim() || preset?.label || "",
    preset: presetId,
    protocol: protocol ?? preset?.protocol,
    base_url: baseUrl.trim().replace(/\/+$/, "") || null,
    key: cleanKey(key) || undefined,
    models: { smart: models.smart.map((m) => m.trim()).filter(Boolean), fast: models.fast.map((m) => m.trim()).filter(Boolean), vision: models.vision.map((m) => m.trim()).filter(Boolean) },
    enabled,
    priority,
    // a local model costs nothing anyway
    free_tier: preset?.region === "local" ? false : freeTier,
  });

  const problem = (): string | null => {
    if (!presetId) return "سرویس‌دهنده را انتخاب کنید.";
    if (!editing && keyRequired && !cleanKey(key)) return "کلید API را وارد کنید.";
    if (keyAgain && !(canDropKey && removeKey)) return canDropKey ? "نشانی عوض شده است؛ کلید API را دوباره وارد کنید یا «ذخیره بدون کلید» را بزنید." : "نشانی عوض شده است؛ کلید API را دوباره وارد کنید.";
    if (baseRequired && !baseUrl.trim()) return "نشانی پایهٔ API را وارد کنید.";
    if (baseUrl.trim() && !/^https?:\/\/\S+$/i.test(baseUrl.trim())) return "نشانی پایه باید با https:// یا http:// شروع شود.";
    if (!input().models.smart.length) return "دست‌کم یک مدل هوشمند انتخاب کنید.";
    return null;
  };

  const test = async () => {
    const p = problem();
    if (p && !(editing && p === "کلید API را وارد کنید.")) return n.warn(p);
    setTesting(true);
    setReport(null);
    try {
      // «ذخیره بدون کلید»: test without the stored key as well
      const r = await api.post<AiTestReport>("/ai/test", { ...input(), connection_id: keyAgain ? null : connection?.id ?? null });
      const rep = objectOf<AiTestReport>(r, "report");
      setReport(rep);
      if (rep.available_models?.length) setListed(rep.available_models);
    } catch (e) {
      n.error(e);
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    const p = problem();
    if (p) return n.warn(p);
    setSaving(true);
    try {
      const body = input();
      let saved: AiConnectionPublic | null = null;
      let warning: string | null = null;
      if (editing) {
        // one request: a new key travels with a new service or base URL (the server refuses the move without it)
        const r = await api.patch<{ connection: AiConnectionPublic; warning?: string | null }>(`/ai/connections/${connection!.id}`, keyAgain && removeKey ? { ...body, remove_key: true } : body);
        saved = objectOf<AiConnectionPublic>(r, "connection");
        warning = r?.warning ?? null;
      } else {
        const r = await api.post<{ connection: AiConnectionPublic; warning?: string | null }>("/ai/connections", body);
        saved = objectOf<AiConnectionPublic>(r, "connection");
        warning = r?.warning ?? null;
      }
      n.ok(editing ? "اتصال ذخیره شد." : "اتصال ساخته شد؛ آزمایش آن شروع شد.");
      if (warning) n.warn(warning);
      onSaved(saved && typeof saved === "object" && "id" in saved ? saved : null, !editing);
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };

  const options = (tier: Tier) => {
    const all = [...new Set([...models[tier], ...(preset?.models[tier] ?? []), ...listed, ...(preset?.suggested ?? [])])];
    return all.map((m) => ({ value: m, label: <span className="ai-mid">{m}</span> }));
  };

  const grouped = useMemo(
    () =>
      REGION_GROUP.map((g) => ({
        label: g.label,
        options: presets.filter((p) => regionOf(p) === g.key).map((p) => ({ value: p.id, label: p.label })),
      })).filter((g) => g.options.length),
    [presets],
  );

  const reg = REGION_LINE[regionOf(preset)];
  const keyHintLine = editing
    ? keyAgain
      ? <span className="text-danger">نشانی عوض شده؛ کلید را دوباره وارد کنید</span>
      : connection!.key_unreadable
      ? <span className="text-danger">کلید ذخیره‌شده خوانده نمی‌شود؛ دوباره واردش کنید</span>
      : connection!.has_key
        ? <>ذخیره‌شده <span className="ai-key">{connection!.key_hint ?? ""}</span></>
        : "کلیدی ذخیره نشده"
    : !keyRequired
      ? "اختیاری"
      : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="left"
      size={560}
      closable={{ placement: "end" }}
      destroyOnHidden
      title={editing ? `ویرایش «${connection!.label}»` : "اتصال تازه"}
      footer={
        <div className="ai-sheet-foot">
          {editing ? (
            <Button danger type="text" onClick={() => onDelete(connection!)}>
              حذف اتصال
            </Button>
          ) : null}
          <span className="ds-end">
            <Button icon={<FlaskConical size={16} strokeWidth={1.4} absoluteStrokeWidth />} loading={testing} onClick={test}>
              آزمایش اتصال
            </Button>
            <Button type="primary" loading={saving} onClick={save} disabled={!secretOk && !!cleanKey(key)}>
              {saving ? "در حال ذخیره…" : "ذخیره"}
            </Button>
          </span>
        </div>
      }
    >
      <div className="ai-form">
        {!secretOk ? (
          <Note tone="warning">
            <b>کلید رمزنگاری سامانه تنظیم نشده است.</b> تا مدیر سامانه متغیر <bdi dir="ltr" className="ds-mono">APP_SECRET</bdi> را تنظیم نکند، کلید تازه ذخیره نمی‌شود.
          </Note>
        ) : null}

        <Field label="سرویس‌دهنده">
          <Select
            value={presetId || undefined}
            onChange={pickPreset}
            options={grouped}
            disabled={editing}
            showSearch={{ optionFilterProp: "label" }}
            placeholder="انتخاب سرویس…"
            aria-label="سرویس‌دهنده"
          />
        </Field>
        {preset ? (
          <div className="ai-presetnote">
            {preset.note ? (
              <p>
                {preset.note}
                {preset.key_url ? (
                  <>
                    {" "}
                    <a className="ds-link ai-ext" href={preset.key_url} target="_blank" rel="noopener noreferrer">
                      دریافت کلید
                      <ExternalLink size={12} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
                    </a>
                  </>
                ) : null}
              </p>
            ) : preset.key_url ? (
              <p>
                <a className="ds-link ai-ext" href={preset.key_url} target="_blank" rel="noopener noreferrer">
                  دریافت کلید
                  <ExternalLink size={12} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
                </a>
              </p>
            ) : null}
            <div className="ai-reg">
              <reg.icon size={14} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
              <span>
                {reg.text}{" "}
                <button type="button" className="ds-link border-0 bg-transparent p-0 text-[12px]" onClick={() => setRegion((r) => !r)} aria-expanded={region}>
                  {region ? "بستن" : "بیشتر"}
                </button>
              </span>
            </div>
            {region ? <RegionNote /> : null}
          </div>
        ) : null}

        {preset?.protocols && preset.protocols.length > 1 ? (
          <Field label="نوع API" hint="همان قالبی که سرویس در راهنمایش گفته است.">
            <Select value={protocol} onChange={setProtocol} options={preset.protocols.map((p) => ({ value: p, label: PROTOCOL_LABEL[p] }))} aria-label="نوع API" />
          </Field>
        ) : null}

        <Field label="نام نمایشی" hint="برای تشخیص این اتصال در فهرست‌ها؛ مثلاً «Claude اصلی» یا «متیس دفتر».">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={preset?.label ?? ""} maxLength={60} />
        </Field>

        <Field label="کلید API" extra={keyHintLine}>
          <Input.Password
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onBlur={() => setKey((k) => cleanKey(k))}
            className="ai-ltr-in"
            dir="ltr"
            autoComplete="new-password"
            spellCheck={false}
            placeholder={editing && connection!.has_key ? "برای تغییر، کلید تازه را وارد کنید" : preset?.key_hint ?? ""}
            aria-label="کلید API"
          />
          {canDropKey ? (
            <Checkbox className="mt-2" checked={removeKey} onChange={(e) => setRemoveKey(e.target.checked)}>
              ذخیره بدون کلید (کلید ذخیره‌شده حذف می‌شود)
            </Checkbox>
          ) : null}
        </Field>

        {editableBase(preset) ? (
          <Field
            label="نشانی پایهٔ API"
            extra={baseRequired ? null : "اختیاری"}
            hint={regionOf(preset) === "local" ? "نشانی سرور محلی روی همین رایانه یا شبکهٔ داخلی." : preset?.base_url_candidates?.length ? "نشانی‌های دیگر همین سرویس در فهرست این خانه است؛ اگر یکی در دسترس نبود، دیگری را امتحان کنید." : "همان نشانی که سرویس در راهنمایش داده است."}
          >
            {preset?.base_url_candidates?.length ? (
              <AutoComplete
                value={baseUrl}
                onChange={(v) => setBaseUrl(String(v ?? ""))}
                options={preset.base_url_candidates.map((u) => ({ value: u, label: <span dir="ltr">{u}</span> }))}
                className="ai-ltr-in w-full"
                placeholder={preset.base_url ?? "https://example.com/v1"}
                aria-label="نشانی پایهٔ API"
              >
                <Input dir="ltr" spellCheck={false} />
              </AutoComplete>
            ) : (
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="ai-ltr-in" dir="ltr" spellCheck={false} placeholder={preset?.base_url ?? "https://example.com/v1"} />
            )}
          </Field>
        ) : null}

        <div className="ai-sec-t">
          مدل‌ها <small>اولی اصلی است؛ بقیه به‌ترتیب جایگزین می‌شوند</small>
        </div>
        {TIERS.map((t) => (
          <Field key={t} label={`مدل ${TIER_LABEL[t]}`} extra={t === "smart" ? "دستیار و تحلیل" : t === "fast" ? "کارهای سریع" : "خواندن عکس و PDF"}>
            <Select
              mode="tags"
              className="ai-models-in"
              value={models[t]}
              onChange={(v) => setModels((m) => ({ ...m, [t]: v }))}
              options={options(t)}
              tokenSeparators={[",", "،", " "]}
              placeholder="نام مدل را بنویسید یا انتخاب کنید"
              aria-label={`مدل ${TIER_LABEL[t]}`}
              maxTagTextLength={40}
            />
          </Field>
        ))}

        <div className="ai-sw">
          <div className="ai-sw-r">
            <div>
              <div className="ai-sw-t">فعال</div>
              <div className="ai-sw-d">اتصال غیرفعال در هیچ کاری به کار نمی‌رود و کلیدش می‌ماند.</div>
            </div>
            <Switch checked={enabled} onChange={setEnabled} aria-label="فعال" />
          </div>
          {preset?.region !== "local" ? (
            <div className="ai-sw-r">
              <div>
                <div className="ai-sw-t">طرح رایگان سرویس</div>
                <div className="ai-sw-d">برای کلید بدون پرداخت، مثل Gemini با کلید Google AI Studio: مصرف این اتصال صفر دلار حساب می‌شود و از بودجه کم نمی‌کند. سقف درخواست‌های طرح رایگان را خود سرویس تعیین می‌کند.</div>
              </div>
              <Switch checked={freeTier} onChange={setFreeTier} aria-label="طرح رایگان سرویس" />
            </div>
          ) : null}
        </div>

        <button type="button" className="ai-sec-t border-0 bg-transparent p-0 text-start" onClick={() => setMore((m) => !m)} aria-expanded={more} style={{ cursor: "pointer" }}>
          <ChevronDown size={14} strokeWidth={1.4} absoluteStrokeWidth style={{ transform: more ? "rotate(180deg)" : undefined }} aria-hidden />
          تنظیمات بیشتر
        </button>
        {more ? (
          <div className="ai-grid2">
            <Field label="اولویت" hint="وقتی برای کاری زنجیره تعیین نشده، اتصال با عدد کمتر زودتر به کار می‌رود.">
              <InputNumber min={1} max={99} value={priority} onChange={(v) => setPriority(Number(v) || 1)} className="w-full" />
            </Field>
            {!editableBase(preset) ? (
              <Field label="نشانی پایهٔ API" extra="اختیاری" hint="فقط برای درگاه واسط؛ خالی یعنی نشانی خود سرویس.">
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="ai-ltr-in" dir="ltr" spellCheck={false} placeholder={preset?.base_url ?? ""} />
              </Field>
            ) : null}
          </div>
        ) : null}

        {report ? (
          <div className="ai-well">
            <TestReport report={report} />
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

/** Where providers work from, and what leaves the country (the same words as «راهنما»). */
export function RegionNote(): ReactNode {
  return (
    <ul className="ai-region ai-well">
      <li>
        <i className="ds-nuqta" aria-hidden />
        <span>
          <b>سرویس‌های خارجی</b> (Claude، OpenAI، Gemini و …) به نشانی‌های ایران پاسخ نمی‌دهند. نسخهٔ وب سیراف بیرون از ایران اجرا می‌شود و مستقیم وصل می‌شود.
        </span>
      </li>
      <li>
        <i className="ds-nuqta" aria-hidden />
        <span>
          <b>نسخهٔ ویندوز داخل ایران</b> از درگاه ایرانی (متیس، اول‌ای‌آی، گپ‌جی‌پی‌تی) یا از «استفاده از اتصال‌های نسخهٔ وب» کمک می‌گیرد.
        </span>
      </li>
      <li>
        <i className="ds-nuqta" aria-hidden />
        <span>
          <b>مدل محلی</b> (Ollama، LM Studio، llama.cpp) روی همان رایانه اجرا می‌شود و داده از رایانه بیرون نمی‌رود.
        </span>
      </li>
      <li>
        <i className="ds-nuqta" aria-hidden />
        <span>
          <ShieldCheck size={13} strokeWidth={1.4} absoluteStrokeWidth className="me-1 inline align-[-2px] text-ink-3" aria-hidden />
          با سرویس خارجی یا درگاه، پرسش و داده‌های لازم برای پاسخ از سیراف بیرون می‌رود؛ «حریم خصوصی» تعیین می‌کند کد ملی، موبایل و حساب‌ها پوشانده شود.
        </span>
      </li>
    </ul>
  );
}
