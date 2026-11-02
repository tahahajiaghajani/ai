// The entry to «حالت پشتیبانی»: why (required, shown on the business's audit page), at what level and for how
// long (at most four hours). On success the business opens with the support band on top.
import { useState } from "react";
import { Button, Form, Input, Modal, Radio, Select } from "antd";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useNotify } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Note } from "../../modules/reports/kit";
import { faDigits } from "@shared/format";

export function SupportDialog({ org, open, onClose }: { org: { id: string; name: string } | null; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const n = useNotify();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { refresh } = useSession();
  const submit = async (v: { reason: string; level: "view" | "edit"; hours: number }) => {
    if (!org) return;
    setBusy(true);
    try {
      await api.post(`/admin/orgs/${org.id}/support`, v);
      await refresh();
      qc.removeQueries({ queryKey: ["org", org.id] });
      qc.invalidateQueries({ queryKey: ["admin"] });
      onClose();
      nav(`/${org.id}`);
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onCancel={onClose} title={org ? `حالت پشتیبانی در «${org.name}»` : "حالت پشتیبانی"} footer={null} destroyOnHidden width={500}>
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ level: "view", hours: 1 }} onFinish={submit}>
        <Note className="mb-4">ورود، دلیل و هر تغییری که بدهید در گزارش رویدادهای این کسب‌وکار دیده می‌شود و مالک می‌تواند آن را پایان دهد.</Note>
        <Form.Item
          name="reason"
          label="دلیل ورود"
          rules={[
            { required: true, message: "دلیل را بنویسید." },
            { min: 5, message: "دست‌کم ۵ نویسه بنویسید." },
          ]}
        >
          <Input.TextArea autoFocus autoSize={{ minRows: 2, maxRows: 4 }} maxLength={500} placeholder="مثلاً: درخواست مالک برای بررسی ماندهٔ صندوق" />
        </Form.Item>
        <Form.Item name="level" label="سطح دسترسی">
          <Radio.Group
            options={[
              { value: "view", label: "فقط مشاهده" },
              { value: "edit", label: "مشاهده و اصلاح" },
            ]}
            optionType="button"
          />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(a, b) => a.level !== b.level}>
          {({ getFieldValue }) =>
            getFieldValue("level") === "edit" ? (
              <p className="-mt-3 mb-4 text-[13px] leading-5 text-ink-3">در «مشاهده و اصلاح» همهٔ بخش‌ها جز کاربران و کارهای ویژهٔ مالک در دسترس است.</p>
            ) : null
          }
        </Form.Item>
        <Form.Item name="hours" label="مدت">
          <Select options={[1, 2, 3, 4].map((h) => ({ value: h, label: `${faDigits(h)} ساعت` }))} style={{ maxInlineSize: 160 }} />
        </Form.Item>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>انصراف</Button>
          <Button type="primary" htmlType="submit" loading={busy}>
            آغاز و ورود
          </Button>
        </div>
      </Form>
    </Modal>
  );
}
