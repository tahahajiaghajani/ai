// «فهرست تغییرهای استاندارد» (CHG-011): the published, pre-assessed standard changes the person may use, with their
// track record (uses, success rate), searchable; «درخواست» opens a short form — the window, the CI or service, the
// group — and creates the change from the template (pre-authorized), scheduled at once when the person asks and the
// schedule allows (blackouts, lockdowns and the template's maximum duration are checked by the server).
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Form, Input, Modal } from "antd";
import { Search, Zap } from "lucide-react";
import { CHANGE_CATEGORIES } from "@shared/tables/change";
import { humanSpan } from "@shared/change/logic";
import { useOrg } from "../../lib/org";
import { useAction, useDebounced } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { ICON14 } from "../../components/blocks";
import { recordPath } from "../../records";
import { CHANGE_KEYS, changeApi, useChangeRefresh, type CatalogItem } from "./api";
import { riskChip, riskLabel } from "./model";
import { FormDateTime, FormRecords } from "./parts";
import "./change.css";

const categoryLabel = (v: unknown) => CHANGE_CATEGORIES.find((c) => c.value === v)?.label ?? "";

export default function Catalogue() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const refresh = useChangeRefresh();
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 250);
  const [ordering, setOrdering] = useState<CatalogItem | null>(null);
  const list = useQuery({ queryKey: CHANGE_KEYS.catalog(orgId, q), queryFn: () => changeApi.catalog(api, q) });
  const order = useAction((v: Record<string, unknown>) => changeApi.order(api, String(ordering!.id), v), {
    success: (d) => (d.warning ? `تغییر ${d.change.number} ثبت شد ولی زمان‌بندی نشد: ${d.warning}` : `تغییر ${d.change.number} ثبت شد.`),
    onSuccess: (d) => {
      setOrdering(null);
      refresh();
      nav(`/${orgId}/${recordPath("change_request", String(d.change.id))}`);
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="تغییرهای استاندارد" />
      <Input prefix={<Search {...ICON14} />} placeholder="جست‌وجو در تغییرهای استاندارد" value={search} onChange={(e) => setSearch(e.target.value)} allowClear style={{ maxWidth: 420 }} aria-label="جست‌وجو" />
      {list.isLoading ? (
        <Loader />
      ) : !list.data?.items.length ? (
        <EmptyState title="تغییر استانداردی منتشر نشده است" description="در «الگوها و تغییرهای استاندارد» الگویی از گونهٔ تغییر استاندارد بسازید و منتشر کنید." />
      ) : (
        <div className="chg-cards">
          {list.data.items.map((t) => (
            <article key={String(t.id)} className="chg-item">
              <div className="chg-item-h">
                <Zap {...ICON14} className="text-ink-3" aria-hidden />
                <span className="font-medium">{String(t.name)}</span>
              </div>
              <div className="chg-facts">
                <span>{categoryLabel(t.category) || "بدون دسته"}</span>
                <span>
                  ریسک <Chip tone={riskChip(t.risk)}>{riskLabel(t.risk)}</Chip>
                </span>
                {t.max_duration ? <span>حداکثر {humanSpan(Number(t.max_duration) * 1000)}</span> : null}
              </div>
              {t.description ? <p className="line-clamp-3 text-[13px] text-ink-2">{String(t.description)}</p> : null}
              <div className="chg-facts">
                <span className="ds-num">{Number(t.usage_count ?? 0)} بار استفاده</span>
                {t.success_rate !== null ? <span className={`ds-num ${t.success_rate < 90 ? "text-warning" : ""}`}>موفقیت {t.success_rate}٪</span> : null}
              </div>
              <Button type="primary" size="small" className="self-start" onClick={() => setOrdering(t)}>
                درخواست
              </Button>
            </article>
          ))}
        </div>
      )}
      <Modal open={!!ordering} title={ordering ? `درخواست «${ordering.name}»` : ""} okText="ثبت تغییر" cancelText="انصراف" destroyOnHidden width={560} onCancel={() => setOrdering(null)} okButtonProps={{ form: "chg-order", htmlType: "submit", loading: order.isPending }}>
        <Form id="chg-order" layout="vertical" initialValues={{ submit: true }} onFinish={(v) => order.mutate(v)}>
          <Form.Item name="short_description" label="عنوان (خالی: عنوان الگو)">
            <Input maxLength={200} />
          </Form.Item>
          <div className="flex flex-wrap gap-3">
            <Form.Item name="planned_start" label="شروع" rules={[{ required: true, message: "زمان شروع را تعیین کنید" }]}>
              <FormDateTime />
            </Form.Item>
            <Form.Item name="planned_end" label="پایان" rules={[{ required: true, message: "زمان پایان را تعیین کنید" }]}>
              <FormDateTime />
            </Form.Item>
          </div>
          <Form.Item name="ci_id" label="پیکربندی">
            <FormRecords table="ci" />
          </Form.Item>
          <Form.Item name="service_id" label="خدمت">
            <FormRecords table="service" />
          </Form.Item>
          <Form.Item name="assignment_group_id" label="گروه مجری" rules={[{ required: !ordering?.assignment_group_id, message: "گروه مجری را تعیین کنید" }]}>
            <FormRecords table="group" />
          </Form.Item>
          <Form.Item name="description" label="توضیح">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="submit" valuePropName="checked">
            <Checkbox>همین حالا زمان‌بندی شود</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
