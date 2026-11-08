// «سازندهٔ کاتالوگ» (REQ-010, REQ-011, REQ-013): one item's questions and form policies, approval and fulfilment,
// audiences and versions, with a live preview of the order form as a requester or a fulfiller sees it (the draft as it
// stands, policies applied as you answer). Publishing freezes the draft as a new version after the server's checks;
// orders keep the version they were placed with. The item's details (name, price, delivery, ordering switches) are
// edited on its record page («جزئیات قلم»).
import { useEffect, useState } from "react";
import { Alert, Button, Input, Modal, Segmented, Space, Tabs, Tag } from "antd";
import { CopyPlus, FileText, Rocket, UserCheck } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import type { Answers } from "@shared/request/form";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { Loader, Chip } from "../../components/display";
import { Card, Field, ICON, ICON14, Note } from "../../components/blocks";
import { RecordSelect, UserSelect, recordPath, recordsApi, useMe } from "../../records";
import { OrderForm, initialAnswers } from "./OrderForm";
import { Questions } from "./Questions";
import { Fulfilment } from "./Fulfilment";
import { requestApi, useDefinition, useRequestRefresh } from "./api";

const STATE_LABELS: Record<string, string> = { draft: "پیش‌نویس", review: "در بازبینی", published: "منتشرشده", retired: "بازنشسته" };

export default function Builder() {
  const { id = "" } = useParams();
  const { api, orgId, timezone } = useOrg();
  const { userId } = useMe();
  const navigate = useNavigate();
  const notify = useNotify();
  const refresh = useRequestRefresh();
  const q = useDefinition(id);
  const def = q.data;
  const [persona, setPersona] = useState<"order" | "fulfil">("order");
  const [answers, setAnswers] = useState<Answers>({});
  const [publishing, setPublishing] = useState(false);
  const [note, setNote] = useState("");
  const [who, setWho] = useState<string | null>(null);
  const [check, setCheck] = useState<{ can_order: boolean; reasons: string[] } | null>(null);
  const schemaKey = def ? JSON.stringify(def.schema.variables.map((v) => [v.name, v.default])) : "";

  useEffect(() => {
    if (def) setAnswers(initialAnswers(def.schema, userId, new Date().toISOString().slice(0, 10)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaKey, userId]);

  const changed = () => void refresh.definition(id);
  const publish = useAction(() => requestApi.publish(api, id, note || undefined, Number(def?.item.version) || undefined), {
    onSuccess: (r) => {
      setPublishing(false);
      setNote("");
      notify.ok(`نسخهٔ ${r.version.version_no.toLocaleString("fa-IR")} منتشر شد.`);
      changed();
    },
  });
  const copy = useAction(() => requestApi.copy(api, id), { onSuccess: (r) => navigate(`/${orgId}/catalog-items/${r.item.id}/builder`) });
  const audience = async () => {
    if (!who) return;
    try {
      setCheck(await requestApi.audience(api, id, who));
    } catch (e) {
      notify.error(e);
    }
  };
  const patchItem = async (data: Record<string, unknown>) => {
    try {
      await recordsApi.update(api, "catalog_item", id, data);
      changed();
    } catch (e) {
      notify.error(e);
    }
  };

  if (q.isLoading) return <Loader />;
  if (q.error || !def) return <Alert type="error" title={errorText(q.error) || "قلم پیدا نشد"} />;
  const item = def.item;
  const errors = def.problems.filter((p) => p.level === "error");
  const warnings = def.problems.filter((p) => p.level === "warning");
  const canWrite = def.can_write;

  return (
    <>
      <PageHeader
        title={`سازندهٔ کاتالوگ: ${item.name}`}
        back={`/${orgId}/${recordPath("catalog_item", id)}`}
        extra={
          <Space wrap size={6}>
            <Tag>{STATE_LABELS[item.state] ?? item.state}</Tag>
            {item.version_no ? <Chip>نسخهٔ {Number(item.version_no).toLocaleString("fa-IR")}</Chip> : null}
            {item.dirty ? <Chip tone="warning">تغییر منتشرنشده</Chip> : null}
          </Space>
        }
        actions={
          <Space wrap>
            <Button icon={<FileText {...ICON} />} onClick={() => navigate(`/${orgId}/${recordPath("catalog_item", id)}`)}>
              جزئیات قلم
            </Button>
            <Button icon={<CopyPlus {...ICON} />} loading={copy.isPending} onClick={() => copy.mutate(undefined)}>
              رونوشت
            </Button>
            {canWrite ? (
              <Button type="primary" icon={<Rocket {...ICON} />} onClick={() => setPublishing(true)} disabled={item.state === "retired"}>
                انتشار
              </Button>
            ) : null}
          </Space>
        }
      />
      {errors.length || warnings.length ? (
        <div className="rq-problems rq-banner">
          {errors.map((p, i) => (
            <Note key={`e${i}`} tone="danger">{p.message}</Note>
          ))}
          {warnings.map((p, i) => (
            <Note key={`w${i}`} tone="warning">{p.message}</Note>
          ))}
        </div>
      ) : null}
      <div className="rq-builder">
        <Tabs
          items={[
            { key: "questions", label: "پرسش‌ها و قاعده‌ها", children: <Questions itemId={id} item={item} schema={def.schema} canWrite={canWrite} onChanged={changed} /> },
            { key: "fulfil", label: "تأیید و انجام", children: <Fulfilment def={def} canWrite={canWrite} onChanged={changed} /> },
            {
              key: "audience",
              label: "مخاطبان",
              children: (
                <Card title="چه کسی می‌تواند سفارش دهد">
                  <div className="rq-form">
                    <Field label="در دسترس برای" hint="خالی یعنی همه؛ کاتالوگ و دسته‌ها هم باید شخص را بپذیرند">
                      <RecordSelect table="catalog_audience" multiple value={item.available_for ?? []} disabled={!canWrite} onChange={(v) => patchItem({ available_for: Array.isArray(v) ? v : v ? [v] : [] })} />
                    </Field>
                    <Field label="در دسترس نیست برای" hint="بر «در دسترس برای» مقدم است">
                      <RecordSelect table="catalog_audience" multiple value={item.not_available_for ?? []} disabled={!canWrite} onChange={(v) => patchItem({ not_available_for: Array.isArray(v) ? v : v ? [v] : [] })} />
                    </Field>
                    <Field label="بررسی برای یک شخص">
                      <Space.Compact block>
                        <UserSelect value={who} onChange={(v) => setWho(typeof v === "string" ? v : null)} />
                        <Button icon={<UserCheck {...ICON14} />} disabled={!who} onClick={audience}>
                          بررسی
                        </Button>
                      </Space.Compact>
                    </Field>
                    {check ? (
                      check.can_order ? (
                        <Alert type="success" title="این شخص می‌تواند این قلم را سفارش دهد" />
                      ) : (
                        <Alert type="warning" title="این شخص نمی‌تواند سفارش دهد" description={<ul>{check.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>} />
                      )
                    ) : null}
                  </div>
                </Card>
              ),
            },
            {
              key: "versions",
              label: "نسخه‌ها",
              children: (
                <Card title="نسخه‌های منتشرشده">
                  {def.versions.length ? (
                    <ul className="rq-bars">
                      {def.versions.map((v) => (
                        <li key={v.id} className="rq-line-m">
                          <span>نسخهٔ {v.version_no.toLocaleString("fa-IR")}</span>
                          <span>{formatJalaliDateTime(v.created_at, timezone)}</span>
                          {v.created_by ? <span>{def.display[v.created_by] ?? ""}</span> : null}
                          {v.note ? <span>{v.note}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Note>هنوز منتشر نشده است؛ تا انتشار، کسی نمی‌تواند آن را سفارش دهد.</Note>
                  )}
                </Card>
              ),
            },
          ]}
        />
        <div className="rq-preview">
          <Card
            title="پیش‌نمایش فرم"
            tools={<Segmented size="small" value={persona} onChange={(v) => setPersona(v as "order" | "fulfil")} options={[{ value: "order", label: "درخواست‌کننده" }, { value: "fulfil", label: "کارشناس" }]} />}
          >
            <OrderForm schema={def.schema} answers={answers} onChange={setAnswers} mode={persona} summary={{ quantity: 1, promise: item.delivery_days !== null && item.delivery_days !== undefined ? `حدود ${Number(item.delivery_days).toLocaleString("fa-IR")} روز کاری` : null }} />
            <Button size="small" type="link" onClick={() => setAnswers(initialAnswers(def.schema, userId, new Date().toISOString().slice(0, 10)))}>
              پاک کردن پاسخ‌ها
            </Button>
          </Card>
        </div>
      </div>
      <Modal open={publishing} title="انتشار نسخهٔ تازه" okText="انتشار" cancelText="انصراف" confirmLoading={publish.isPending} onCancel={() => setPublishing(false)} onOk={() => publish.mutate(undefined)} okButtonProps={{ disabled: !!errors.length }} destroyOnHidden>
        <div className="rq-form">
          {errors.length ? <Alert type="error" title="پیش از انتشار، ایرادها را برطرف کنید" description={<ul>{errors.map((p, i) => <li key={i}>{p.message}</li>)}</ul>} /> : null}
          <p>سفارش‌های تازه با این نسخه ثبت می‌شوند؛ سفارش‌های پیشین نسخهٔ خود را نگه می‌دارند.</p>
          <Field label="یادداشت انتشار">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="چه چیزی تغییر کرد؟" />
          </Field>
        </div>
      </Modal>
    </>
  );
}
