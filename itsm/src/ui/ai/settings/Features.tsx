// «قابلیت‌ها و حریم خصوصی»: the master switch «دستیار فعال است», a switch per feature, what is sent to the models (the
// data policy, in plain words), how long conversations are kept, the business's own notes and instructions, and in
// the Windows app «استفاده از اتصال‌های نسخهٔ وب».
import { useEffect, useState, type ReactNode } from "react";
import { Button, Input, Radio, Select, Switch } from "antd";
import type { AiDataPolicy, AiSettings } from "@shared/ai/types";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { useNotify } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { Note } from "../../components/blocks";
import { FEATURE_KEYS, FEATURE_LABEL, POLICY_LABEL } from "../kit/model";
import { useAiInvalidate } from "../kit/hooks";

const RETENTION = [30, 90, 180, 365];
const POLICIES: AiDataPolicy[] = ["masked", "aggregates", "full"];

function Sec({ title, desc, children }: { title: ReactNode; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="blk-set">
      <div>
        <div className="blk-set-t">{title}</div>
        {desc ? <div className="blk-set-d">{desc}</div> : null}
      </div>
      <div className="blk-set-b">{children}</div>
    </div>
  );
}

function SwitchRow({ title, about, checked, onChange, disabled }: { title: string; about: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="ai-sw-r">
      <div>
        <div className="ai-sw-t">{title}</div>
        <div className="ai-sw-d">{about}</div>
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} aria-label={title} />
    </label>
  );
}

export function FeaturesTab({ settings, mode, linked: linkedView }: { settings: AiSettings; mode?: "cloud" | "desktop"; linked?: boolean }) {
  const { api } = useOrg();
  const { meta } = useSession();
  const n = useNotify();
  const refresh = useAiInvalidate();
  const [s, setS] = useState(settings);
  const [saving, setSaving] = useState(false);
  useEffect(() => setS(settings), [settings]);
  const dirty = JSON.stringify(s) !== JSON.stringify(settings);
  const desktop = (mode ?? meta?.mode) === "desktop";
  const linked = linkedView ?? !!meta?.desktop?.cloud?.linked;

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/ai/settings", { ...s, instructions: s.instructions.trim() });
      n.ok("تنظیمات هوش مصنوعی ذخیره شد.");
      refresh();
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="blk-card">
      <div className="blk-card-b" style={{ paddingBlock: 0 }}>
        <Sec title="دستیار" desc="خاموش کردن، همهٔ کارهای هوش مصنوعی این سازمان را متوقف می‌کند؛ بینش‌ها بدون مدل ادامه دارند.">
          <div className="ai-sw">
            <SwitchRow title="دستیار فعال است" about={s.enabled ? "پرسش، تحلیل و خواندن از تصویر برای اعضای مجاز باز است." : "هیچ درخواستی به مدل‌ها فرستاده نمی‌شود."} checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} />
          </div>
        </Sec>

        <Sec title="قابلیت‌ها" desc="هر قابلیت جدا روشن یا خاموش می‌شود؛ دسترسی هر عضو از «کاربران و دسترسی‌ها» می‌آید.">
          <div className="ai-sw">
            {FEATURE_KEYS.map((k) => (
              <SwitchRow key={k} title={FEATURE_LABEL[k].title} about={FEATURE_LABEL[k].about} checked={!!s.features[k]} disabled={!s.enabled} onChange={(v) => setS({ ...s, features: { ...s.features, [k]: v } })} />
            ))}
          </div>
        </Sec>

        <Sec title="حریم خصوصی" desc="مدل فقط داده‌ای را می‌بیند که برای پاسخ لازم است؛ اینجا تعیین می‌کنید اطلاعات شخصی چگونه فرستاده شود.">
          <Radio.Group className="ai-policy" value={s.data_policy} onChange={(e) => setS({ ...s, data_policy: e.target.value })}>
            {POLICIES.map((p) => (
              <Radio key={p} value={p}>
                <span className="ai-policy-t">
                  {POLICY_LABEL[p].title}
                  {/* a real space: without it «…شخصی» and «پیشنهادی» are shaped as one word (the margin alone does not separate them) */}
                  {p === "masked" ? <>{" "}<span className="blk-cap" style={{ marginInlineStart: 4 }}>پیشنهادی</span></> : null}
                </span>
                <span className="ai-policy-d">{POLICY_LABEL[p].about}</span>
              </Radio>
            ))}
          </Radio.Group>
          <div className="mt-4 grid max-w-xs gap-1.5">
            <span className="blk-f-l">نگه‌داری گفت‌وگوها</span>
            <Select value={s.retention_days} onChange={(v) => setS({ ...s, retention_days: v })} options={RETENTION.map((d) => ({ value: d, label: `${fa(d)} روز` }))} aria-label="نگه‌داری گفت‌وگوها" />
            <span className="blk-f-h">گفت‌وگوهای قدیمی‌تر از این، خودکار پاک می‌شوند.</span>
          </div>
        </Sec>

        <Sec title="دربارهٔ سازمان و دستورهای تکمیلی" desc="دستیار این متن را مثل یادداشت سازمان می‌خواند؛ مثلاً لحن پاسخ‌ها یا واحد نمایش مبالغ.">
          <Input.TextArea
            value={s.instructions}
            onChange={(e) => setS({ ...s, instructions: e.target.value })}
            autoSize={{ minRows: 4, maxRows: 12 }}
            maxLength={4000}
            showCount
            placeholder="مثلاً: فروشگاه پوشاک با دو شعبه در تهران هستیم. مبالغ را به تومان بگو و جدول‌ها کوتاه باشند."
          />
        </Sec>

        {desktop ? (
          <Sec title="نسخهٔ ویندوز" desc="سرویس‌های خارجی از داخل ایران در دسترس نیستند؛ این رایانه می‌تواند از اتصال‌های نسخهٔ وب استفاده کند.">
            <div className="ai-sw">
              <SwitchRow
                title="استفاده از اتصال‌های نسخهٔ وب"
                about="کاری که اتصال محلی ندارد یا اتصال‌های محلی‌اش خطا بدهند، و کاری که در «کارها و مدل‌ها» «اول نسخهٔ وب» دارد، از راه نسخهٔ وب پاسخ می‌گیرد؛ ابزارها روی همین رایانه اجرا می‌شوند."
                checked={s.use_cloud}
                disabled={!linked}
                onChange={(v) => setS({ ...s, use_cloud: v })}
              />
            </div>
            {!linked ? (
              <Note className="mt-3">
                این رایانه به نسخهٔ وب وصل نیست؛ از «نسخهٔ ویندوز» در تنظیمات وصلش کنید.
              </Note>
            ) : null}
          </Sec>
        ) : null}
      </div>
      <div className="blk-savebar">
        <Button type="primary" loading={saving} disabled={!dirty} onClick={save}>
          ذخیره
        </Button>
      </div>
    </div>
  );
}
