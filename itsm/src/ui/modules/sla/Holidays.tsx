// «تعطیلات»: the holidays of a Jalali year by month — weekday, date, occasion, set (official / the organisation's),
// half days, and the predicted lunar dates of the bundled calendar («پیش‌بینی», with their possible other day) to
// confirm once the official calendar is out. Every holiday is editable; the official holidays of a bundled year are
// added in one go. Calendars use the sets they name; SLA deadlines follow every change (the server recomputes them).
import { useEffect, useMemo, useState } from "react";
import { Button, Drawer, Form, Input, Popconfirm, Segmented, Select, Switch } from "antd";
import { CalendarPlus, CalendarX, Check, Plus, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { HOLIDAY_KINDS } from "@shared/tables/sla";
import { currentJalaliYear, formatJalali, todayISO, toFa } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { DateInput } from "../../components/inputs";
import { ICON, ICON14, Note, cx } from "../../components/blocks";
import { ChoiceTag, recordKeys, recordsApi, useSchema } from "../../records";
import { calendarsApi, useBundledHolidays, useSlaRefresh } from "./api";
import { holidaysByMonth, weekdayName, type HolidayRow } from "./model";

interface Holiday extends HolidayRow {
  version: number;
  holiday_set: string;
  half_day: boolean;
  kind: string;
  predicted: boolean;
  alternative_date: string | null;
  note: string | null;
  source: string;
  active: boolean;
}

type Draft = Partial<Holiday>;

export default function Holidays() {
  const { api, orgId, timezone } = useOrg();
  const { schema } = useSchema();
  const def = schema?.def("holiday");
  const canCreate = !!def?.can.create;
  const sets = schema?.choices["holiday.set"] ?? [];
  const refresh = useSlaRefresh();
  const bundled = useBundledHolidays().data?.years ?? [];
  const thisYear = currentJalaliYear(todayISO(timezone));
  const years = useMemo(() => [...new Set([...bundled, thisYear - 1, thisYear, thisYear + 1])].sort((a, b) => a - b), [bundled, thisYear]);
  const [jy, setJy] = useState(thisYear);
  const [set, setSet] = useState<string>("all");
  const [open, setOpen] = useState<Draft | null>(null);
  const [form] = Form.useForm<Draft>();
  const listKey = [...recordKeys.lists(orgId, "holiday"), "year", jy];
  const list = useQuery({
    queryKey: listKey,
    queryFn: () => recordsApi.list(api, "holiday", { filter: { f: "year", op: "eq", v: jy }, size: 500, sort: "date" }),
  });
  const all = (list.data?.rows ?? []) as unknown as Holiday[];
  const rows = set === "all" ? all : all.filter((h) => h.holiday_set === set);
  const months = holidaysByMonth(rows, jy);
  const predicted = all.filter((h) => h.predicted && h.active !== false).length;
  // the bundled official holidays of this year are not in yet (a year once added is never added again)
  const officialMissing = bundled.includes(jy) && !list.isLoading && !all.some((h) => h.source === "bundled");
  const changed = () => {
    refresh.holidays();
    void list.refetch();
  };

  useEffect(() => {
    form.resetFields();
    if (open) form.setFieldsValue({ holiday_set: "org", half_day: false, kind: "org", active: true, ...open });
  }, [open, form]);

  const save = useAction(
    (v: Draft) => {
      const data = { date: v.date, title: v.title, holiday_set: v.holiday_set, half_day: !!v.half_day, kind: v.kind, note: v.note ?? null, active: v.active !== false };
      return open?.id ? api.patch(`/r/holiday/${open.id}`, { ...data, ...(open.predicted && v.date !== open.date ? { predicted: false } : {}), version: open.version }) : api.post(`/r/holiday`, data);
    },
    { success: "تعطیلی ذخیره شد.", onSuccess: () => { setOpen(null); changed(); } },
  );
  const patch = useAction((p: { h: Holiday; data: Record<string, unknown> }) => api.patch(`/r/holiday/${p.h.id}`, { ...p.data, version: p.h.version }), { onSuccess: changed });
  const remove = useAction(() => api.del(`/r/holiday/${open!.id}?version=${open!.version}`), { success: "تعطیلی حذف شد.", onSuccess: () => { setOpen(null); changed(); } });
  const seed = useAction(() => calendarsApi.seed(api, [jy]), {
    success: (r) => (Number((r as { holidays?: number }).holidays) ? `${toFa(Number((r as { holidays?: number }).holidays))} تعطیلی رسمی افزوده شد.` : "تعطیلات رسمی این سال پیش‌تر افزوده شده بود."),
    onSuccess: changed,
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="تعطیلات"
        actions={
          canCreate ? (
            <Button type="primary" icon={<Plus {...ICON} />} onClick={() => setOpen({})}>
              تعطیلی تازه
            </Button>
          ) : null
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<number> value={jy} onChange={setJy} options={years.map((y) => ({ value: y, label: toFa(y) }))} />
        <Segmented<string> value={set} onChange={setSet} options={[{ value: "all", label: "همه" }, ...sets.map((o) => ({ value: o.value, label: o.label }))]} />
        {canCreate && officialMissing && rows.length ? (
          <Button className="ms-auto" icon={<CalendarPlus {...ICON14} />} loading={seed.isPending} onClick={() => seed.mutate()}>
            تعطیلات رسمی {toFa(jy)}
          </Button>
        ) : null}
      </div>
      {predicted ? (
        <Note tone="warning">
          {toFa(predicted)} تاریخ قمری این سال پیش‌بینی است؛ پس از انتشار تقویم رسمی، هر کدام را تأیید یا جابه‌جا کنید.
        </Note>
      ) : null}
      {list.isLoading ? (
        <Loader />
      ) : !rows.length ? (
        <EmptyState
          icon={CalendarX}
          title={`برای سال ${toFa(jy)} تعطیلی‌ای ثبت نشده است`}
          action={
            canCreate && officialMissing ? (
              <Button type="primary" icon={<CalendarPlus {...ICON14} />} loading={seed.isPending} onClick={() => seed.mutate()}>
                افزودن تعطیلات رسمی {toFa(jy)}
              </Button>
            ) : canCreate ? (
              <Button onClick={() => setOpen({})}>تعطیلی تازه</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {months.map((m) => (
            <section key={m.month} className="flex flex-col rounded-lg border border-line bg-surface" aria-label={m.label}>
              <header className="flex items-baseline justify-between border-b border-line px-3 py-2">
                <span className="ds-t-title text-ink">{m.label}</span>
                <span className="ds-num text-[12px] text-ink-3">{toFa(m.items.length)}</span>
              </header>
              <ul className="flex flex-col divide-y divide-[var(--ds-line)]">
                {m.items.map((h) => (
                  <li key={h.id} className={cx("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2", h.active === false && "opacity-60")}>
                    <button type="button" className="flex min-w-0 flex-1 items-baseline gap-3 text-start" onClick={() => setOpen(h)}>
                      <span className="w-16 shrink-0 text-[12px] text-ink-3">{weekdayName(h.date)}</span>
                      <span className="ds-num w-12 shrink-0 text-[13px] text-ink-2">{formatJalali(h.date, { style: "short" })}</span>
                      <span className={cx("min-w-0 truncate text-[13px]", h.half_day ? "text-ink" : "text-holiday")}>{h.title}</span>
                    </button>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {set === "all" ? <ChoiceTag option={sets.find((o) => o.value === h.holiday_set)} value={h.holiday_set} /> : null}
                      {h.half_day ? <Chip dot={false}>نیمه‌تعطیل</Chip> : null}
                      {h.predicted ? (
                        <>
                          <Chip tone="warning" title={h.alternative_date ? `یا ${formatJalali(h.alternative_date, { style: "long" })}` : undefined}>
                            پیش‌بینی{h.alternative_date ? ` (یا ${formatJalali(h.alternative_date, { style: "short" })})` : ""}
                          </Chip>
                          {def?.can.create ? (
                            <Button size="small" type="text" icon={<Check {...ICON14} />} loading={patch.isPending && patch.variables?.h.id === h.id} onClick={() => patch.mutate({ h, data: { predicted: false } })}>
                              تأیید
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                      {h.active === false ? <Chip dot={false}>غیرفعال</Chip> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <Drawer open={!!open} onClose={() => setOpen(null)} size={460} destroyOnHidden title={open?.id ? open.title : "تعطیلی تازه"}>
        <Form<Draft> form={form} layout="vertical" requiredMark={false} disabled={!canCreate} onFinish={(v) => save.mutate(v)}>
          <div className="grid gap-x-3 sm:grid-cols-[1fr_1fr]">
            <Form.Item name="date" label="تاریخ" rules={[{ required: true, message: "تاریخ را وارد کنید." }]}>
              <DateInput />
            </Form.Item>
            <Form.Item name="holiday_set" label="مجموعه" rules={[{ required: true }]}>
              <Select options={sets.map((o) => ({ value: o.value, label: o.label }))} />
            </Form.Item>
          </div>
          <Form.Item name="title" label="مناسبت" rules={[{ required: true, message: "مناسبت را بنویسید." }]}>
            <Input maxLength={200} />
          </Form.Item>
          <div className="grid gap-x-3 sm:grid-cols-2">
            <Form.Item name="kind" label="نوع">
              <Select options={HOLIDAY_KINDS.map((o) => ({ value: o.value, label: o.label }))} />
            </Form.Item>
            <Form.Item name="half_day" label="نیمه‌تعطیل" valuePropName="checked" extra="فقط نیمهٔ نخست زمان کاری آن روز کاری است.">
              <Switch />
            </Form.Item>
          </div>
          <Form.Item name="note" label="یادداشت">
            <Input maxLength={300} />
          </Form.Item>
          <Form.Item name="active" label="فعال" valuePropName="checked">
            <Switch />
          </Form.Item>
          {open?.predicted ? <Note tone="warning">این تاریخ پیش‌بینی است؛ با جابه‌جا کردن تاریخ، تأییدشده به شمار می‌آید.</Note> : null}
          {canCreate ? (
            <div className="mt-4 flex items-center gap-2">
              <Button type="primary" htmlType="submit" loading={save.isPending}>
                ذخیره
              </Button>
              {open?.id ? (
                <Popconfirm title="این تعطیلی حذف شود؟" okText="حذف" cancelText="انصراف" okButtonProps={{ danger: true }} onConfirm={() => remove.mutate()}>
                  <Button danger type="text" icon={<Trash2 {...ICON14} />} className="ms-auto">
                    حذف
                  </Button>
                </Popconfirm>
              ) : null}
            </div>
          ) : null}
        </Form>
      </Drawer>
    </div>
  );
}
