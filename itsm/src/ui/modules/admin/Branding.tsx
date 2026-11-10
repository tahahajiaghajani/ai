// «برند و ظاهر»: the organisation's brand — an accent from the design system's colours (never a hex: contrast and the
// dark theme come from the tokens), the self-service portal's title, the message on the sign-in page, the footer of
// outgoing e-mail and the support address — with a live preview. The logo stays where it is edited today («سازمان»).
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Form, Input, Select } from "antd";
import { Save } from "lucide-react";
import { COLOR_KEYS, type ColorKey } from "@shared/model/types";
import { COLOR_LABELS, COLOR_TOKENS } from "../../records/model/colors";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Skeleton } from "../../components/display";
import { Card, ICON } from "../../components/blocks";

interface Brand {
  accent: ColorKey | null;
  portal_title: string | null;
  login_message: string | null;
  email_footer: string | null;
  support_email: string | null;
}


const KEY = ["admin", "branding"];

export default function Branding() {
  const { api, org, orgId, can } = useOrg();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<{ brand: Brand; logo: string | null }>("/admin/branding") });
  const [form] = Form.useForm<Brand>();
  const [draft, setDraft] = useState<Brand | null>(null);
  useEffect(() => {
    if (q.data) {
      form.setFieldsValue(q.data.brand);
      setDraft(q.data.brand);
    }
  }, [q.data, form]);
  const save = useAction((v: Brand) => api.put("/admin/branding", { ...v, support_email: v.support_email ?? "" }), { invalidate: [KEY, ["org", orgId]], success: "برند سازمان ذخیره شد" });
  const editable = can("settings", "edit");
  const accent = draft?.accent ?? null;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="برند و ظاهر"
        actions={
          editable ? (
            <Button type="primary" icon={<Save {...ICON} />} loading={save.isPending} onClick={() => form.validateFields().then((v) => save.mutate(v))}>
              ذخیره
            </Button>
          ) : undefined
        }
      />
      {!q.data ? (
        <Skeleton rows={6} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card title="تنظیمات">
            <Form form={form} layout="vertical" disabled={!editable} onValuesChange={(_, all) => setDraft(all as Brand)} requiredMark={false}>
              <Form.Item name="accent" label="رنگ برند">
                <Select
                  allowClear
                  placeholder="رنگ پیش‌فرض سامانه"
                  options={COLOR_KEYS.map((c) => ({
                    value: c,
                    label: (
                      <span className="inline-flex items-center gap-2">
                        <i className="inline-block size-3 rounded-full" style={{ background: COLOR_TOKENS[c] }} aria-hidden />
                        {COLOR_LABELS[c]}
                      </span>
                    ),
                  }))}
                />
              </Form.Item>
              <Form.Item name="portal_title" label="عنوان پرتال سلف‌سرویس" rules={[{ max: 80 }]}>
                <Input placeholder={org.name} />
              </Form.Item>
              <Form.Item name="login_message" label="پیام صفحهٔ ورود" rules={[{ max: 500 }]}>
                <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} />
              </Form.Item>
              <Form.Item name="email_footer" label="پانویس ایمیل‌ها" rules={[{ max: 1000 }]}>
                <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
              </Form.Item>
              <Form.Item name="support_email" label="ایمیل پشتیبانی" rules={[{ type: "email", message: "ایمیل معتبر نیست" }]}>
                <Input dir="ltr" className="ltr" />
              </Form.Item>
            </Form>
            <p className="m-0 text-[13px] text-ink-3">
              نشان سازمان در <Link to={`/${orgId}/settings/org`}>تنظیمات سازمان</Link> عوض می‌شود.
            </p>
          </Card>
          <Card title="پیش‌نمایش">
            <div className="flex flex-col gap-3 rounded-lg border border-line p-4" data-accent={accent ?? undefined}>
              <div className="flex items-center gap-3 border-b border-line pb-3" style={accent ? { borderBottomColor: COLOR_TOKENS[accent], borderBottomWidth: 2 } : undefined}>
                {q.data.logo ? <img src={q.data.logo} alt="" className="size-8 rounded object-contain" /> : null}
                <span className="font-medium text-ink">{draft?.portal_title || org.name}</span>
              </div>
              {draft?.login_message ? <p className="m-0 whitespace-pre-line text-[13px] text-ink-2">{draft.login_message}</p> : <p className="m-0 text-[13px] text-ink-3">پیامی برای صفحهٔ ورود نوشته نشده است.</p>}
              <div className="mt-2 border-t border-line pt-3 text-[12px] text-ink-3">
                <div className="whitespace-pre-line">{draft?.email_footer || "پانویس ایمیل‌ها"}</div>
                {draft?.support_email ? <div className="ltr mt-1">{draft.support_email}</div> : null}
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
