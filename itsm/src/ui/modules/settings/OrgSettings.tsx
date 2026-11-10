// Organisation settings («سازمان»): identity and contact, the time zone and printing, and the optional modules
// (once there are any). Each tab is one card of titled sections with a sticky save bar.
import { useState, type ReactNode } from "react";
import { Button, Form, Input, Select, Switch, Tabs, Checkbox } from "antd";
import { Blocks, LayoutGrid } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { ImageInput } from "../../components/data";
import { EmptyState } from "../../components/display";
import { DEFAULT_TIMEZONE, MODULES, TIMEZONES, type ModuleKey } from "@shared/constants";
import { Note, cx } from "../../components/blocks";
import { ArchiveSettings } from "./Archive";

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

function SaveBar({ loading, disabled, note }: { loading: boolean; disabled?: boolean; note?: ReactNode }) {
  return (
    <div className="blk-savebar">
      {note ? <span className="blk-savebar-m">{note}</span> : null}
      <Button type="primary" htmlType="submit" loading={loading} disabled={disabled}>
        ذخیره
      </Button>
    </div>
  );
}

export default function OrgSettings() {
  const { org, api, orgId, can } = useOrg();
  const qc = useQueryClient();
  const [tab, setTab] = useState("profile");
  const save = useAction((v: any) => api.patch("", v), {
    success: "تنظیمات ذخیره شد.",
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org", orgId] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const s = org.settings ?? {};
  const editable = can("settings", "edit");
  const ltr = { dir: "ltr" as const, className: "ds-num", style: { textAlign: "right" as const } };
  // a zone typed through the API that is not in the list still shows as itself
  const zones = TIMEZONES.some((z) => z.value === s.timezone) || !s.timezone ? TIMEZONES : [...TIMEZONES, { value: s.timezone, label: s.timezone }];

  return (
    <div>
      <PageHeader title="سازمان" subtitle={org.name} />
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: "profile", label: "مشخصات" },
          { key: "settings", label: "زمان و چاپ" },
          { key: "archive", label: "بایگانی" },
          { key: "modules", label: "بخش‌ها" },
        ]}
      />
      {tab === "profile" ? (
        <Form layout="vertical" requiredMark={false} disabled={!editable} initialValues={org} onFinish={(v) => save.mutate(v)} className="blk-card">
          <div className="px-5">
            <Sec title="نام" desc="در فهرست سازمان‌ها، سربرگ چاپ‌ها و پیام‌ها دیده می‌شود.">
              <div className="blk-grid3">
                <Form.Item name="name" label="نام سازمان" rules={[{ required: true, min: 2, message: "نام سازمان را بنویسید." }]}>
                  <Input />
                </Form.Item>
                <Form.Item name="legal_name" label="نام رسمی (اختیاری)">
                  <Input />
                </Form.Item>
              </div>
            </Sec>
            <Sec title="تماس و نشانی">
              <div className="blk-grid3">
                <Form.Item name="phone" label="تلفن">
                  <Input {...ltr} inputMode="tel" />
                </Form.Item>
                <Form.Item name="email" label="ایمیل" rules={[{ type: "email", message: "ایمیل درست نیست." }]}>
                  <Input dir="ltr" className="ds-latin" />
                </Form.Item>
                <Form.Item name="website" label="وب‌سایت">
                  <Input dir="ltr" className="ds-latin" />
                </Form.Item>
                <Form.Item name="city" label="شهر">
                  <Input />
                </Form.Item>
                <Form.Item name="address" label="نشانی" className="is-wide">
                  <Input.TextArea autoSize={{ minRows: 2 }} />
                </Form.Item>
              </div>
            </Sec>
            <Sec title="لوگو" desc="کنار نام سازمان در منو و روی چاپ‌ها.">
              <Form.Item name="logo">
                <ImageInput />
              </Form.Item>
            </Sec>
          </div>
          {editable ? <SaveBar loading={save.isPending} /> : null}
        </Form>
      ) : tab === "settings" ? (
        <Form
          layout="vertical"
          requiredMark={false}
          disabled={!editable}
          initialValues={{ timezone: s.timezone ?? DEFAULT_TIMEZONE, print: { show_logo: true, footer: "", ...(s.print ?? {}) } }}
          onFinish={(v) => save.mutate({ settings: v })}
          className="blk-card"
        >
          <div className="px-5">
            <Sec title="منطقهٔ زمانی" desc="«امروز»، تاریخ گزارش‌ها و تقویم دستیار بر پایهٔ همین منطقه است.">
              <div className="blk-grid3">
                <Form.Item name="timezone" label="منطقهٔ زمانی">
                  <Select options={zones} showSearch={{ optionFilterProp: "label" }} />
                </Form.Item>
              </div>
            </Sec>
            <Sec title="چاپ" desc="سربرگ و پانویس برگه‌هایی که از برنامه چاپ می‌شوند.">
              <div className="blk-grid3">
                <Form.Item name={["print", "show_logo"]} label="لوگو در سربرگ" valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item name={["print", "footer"]} label="پانویس (اختیاری)" className="is-wide">
                  <Input maxLength={200} />
                </Form.Item>
              </div>
            </Sec>
          </div>
          {editable ? <SaveBar loading={save.isPending} /> : null}
        </Form>
      ) : tab === "archive" ? (
        <ArchiveSettings section={(title, desc, body) => <Sec title={title} desc={desc ?? undefined}>{body}</Sec>} />
      ) : MODULES.length ? (
        <Form layout="vertical" disabled={!can("settings", "full")} initialValues={{ modules: org.modules }} onFinish={(v) => save.mutate(v)} className="blk-card">
          <div className="px-5 pt-5">
            <Note className="mb-4">روشن کردن یک بخش تنظیمات پیش‌فرض آن را می‌افزاید؛ خاموش کردن فقط منوها را پنهان می‌کند و داده‌ای حذف نمی‌شود.</Note>
            <Form.Item name="modules" noStyle>
              <ModulePicker disabled={!can("settings", "full")} />
            </Form.Item>
            <div className="h-5" />
          </div>
          {can("settings", "full") ? <SaveBar loading={save.isPending} /> : null}
        </Form>
      ) : (
        <div className="blk-card">
          <EmptyState icon={Blocks} title="هنوز بخشی برای روشن کردن نیست" description="بخش‌های کاری که به برنامه افزوده می‌شوند، این‌جا برای هر سازمان روشن یا خاموش می‌شوند." />
        </div>
      )}
    </div>
  );
}

function ModulePicker({ value = [], onChange, disabled }: { value?: ModuleKey[]; onChange?: (v: ModuleKey[]) => void; disabled?: boolean }) {
  return (
    <Checkbox.Group value={value} onChange={(v) => onChange?.(v as ModuleKey[])} disabled={disabled} className="blk-mods w-full">
      {MODULES.map((m) => {
        const on = value.includes(m.key);
        return (
          <label key={m.key} className={cx("blk-mod", on && "is-on")}>
            <span className="blk-mod-ic" aria-hidden>
              <LayoutGrid size={18} strokeWidth={1.4} absoluteStrokeWidth />
            </span>
            <span className="min-w-0">
              <span className="blk-mod-t block">{m.title}</span>
              <span className="blk-mod-d block">{m.description}</span>
            </span>
            <Checkbox value={m.key} />
          </label>
        );
      })}
    </Checkbox.Group>
  );
}
