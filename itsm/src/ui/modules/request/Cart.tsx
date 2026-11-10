// «سبد سفارش» (REQ-018): the lines to order now and those saved for later («برای بعد»), each editable in its order
// drawer; the order's details (for whom, where it is delivered, by when, the cost centre, special instructions) and
// the totals; «ثبت سفارش» places one request with one requested item per line and person. A line whose item changed
// or left the catalogue says so and blocks the checkout until it is reviewed or removed.
import { useEffect, useState } from "react";
import { Alert, Button, Input, Popconfirm, Space, Tooltip } from "antd";
import { Bookmark, BookmarkCheck, Pencil, Send, ShoppingCart, Trash2 } from "lucide-react";
import { useNavigate } from "react-router";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { EmptyState, Loader } from "../../components/display";
import { Card, Field, ICON, ICON14 } from "../../components/blocks";
import { DateInput } from "../../components/inputs";
import { RecordSelect, UserSelect, useMe } from "../../records";
import { requestApi, useCart, useRequestRefresh, type CartLine } from "./api";
import { cartState, money, recurringText } from "./model";
import OrderDrawer, { useOrderDone } from "./OrderDrawer";

export default function Cart() {
  const { api, orgId } = useOrg();
  const { userId } = useMe();
  const navigate = useNavigate();
  const q = useCart();
  const refresh = useRequestRefresh();
  const done = useOrderDone();
  const [edit, setEdit] = useState<CartLine | null>(null);
  const [header, setHeader] = useState<Record<string, string | null>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const data = q.data;

  useEffect(() => {
    if (!data) return;
    const c = data.cart;
    setHeader({ requested_for: c.requested_for ?? null, location_id: c.location_id ?? null, needed_by: c.needed_by ?? null, cost_center_id: c.cost_center_id ?? null, instructions: c.instructions ?? null });
  }, [data]);

  const saveHeader = useAction((patch: Record<string, string | null>) => requestApi.updateCart(api, patch), { onSuccess: () => void refresh.cart() });
  const toggle = useAction((l: CartLine) => requestApi.updateLine(api, l.id, { saved: !l.saved }), { onSuccess: () => void refresh.cart() });
  const remove = useAction((l: CartLine) => requestApi.removeLine(api, l.id), { success: "از سبد برداشته شد.", onSuccess: () => void refresh.cart() });
  const checkout = useAction(() => requestApi.checkout(api, { ...header, channel: "portal" }), {
    onSuccess: (r) => {
      setProblem(null);
      void refresh.all();
      done(r);
    },
  });

  const set = (k: string, v: string | null) => {
    const next = { ...header, [k]: v };
    setHeader(next);
    saveHeader.mutate({ [k]: v });
  };

  if (q.isLoading) return <Loader />;
  const lines = data?.lines ?? [];
  const st = cartState(lines);
  const now = lines.filter((l) => !l.saved);
  const later = lines.filter((l) => l.saved);
  const row = (l: CartLine) => {
    const people = l.requested_for_list?.length ? l.requested_for_list : l.requested_for ? [l.requested_for] : [];
    return (
      <div key={l.id} className="rq-line">
        <div className="rq-line-b">
          <span className="rq-line-t">{l.title || l.item?.name}</span>
          <span className="rq-line-m">
            {l.item?.name && l.item.name !== l.title ? <span>{l.item.name}</span> : null}
            {l.quantity > 1 ? <span>تعداد {l.quantity.toLocaleString("fa-IR")}</span> : null}
            {people.length ? <span>برای {people.map((p) => data?.display[p] ?? "…").join("، ")}</span> : null}
            {l.item?.promise ? <span>{l.item.promise}</span> : null}
          </span>
          {l.problem ? <span className="rq-err">{l.problem}</span> : null}
        </div>
        <span className="rq-line-p">{l.price && Number(l.price) > 0 ? money(l.price) : "رایگان"}</span>
        <span className="rq-line-x">
          <Tooltip title="ویرایش">
            <Button size="small" type="text" icon={<Pencil {...ICON14} />} aria-label="ویرایش" onClick={() => setEdit(l)} disabled={!l.item} />
          </Tooltip>
          <Tooltip title={l.saved ? "بازگرداندن به سفارش" : "برای بعد"}>
            <Button size="small" type="text" icon={l.saved ? <BookmarkCheck {...ICON14} /> : <Bookmark {...ICON14} />} aria-label={l.saved ? "بازگرداندن به سفارش" : "برای بعد"} onClick={() => toggle.mutate(l)} />
          </Tooltip>
          <Popconfirm title="این قلم از سبد برداشته شود؟" okText="بردار" cancelText="انصراف" onConfirm={() => remove.mutate(l)}>
            <Button size="small" type="text" danger icon={<Trash2 {...ICON14} />} aria-label="برداشتن" />
          </Popconfirm>
        </span>
      </div>
    );
  };

  return (
    <>
      <PageHeader title="سبد سفارش" back={`/${orgId}/catalog`} />
      {!lines.length ? (
        <EmptyState icon={ShoppingCart} title="سبد شما خالی است" description="اقلام کاتالوگ را با «افزودن به سبد» این‌جا جمع کنید و یک‌جا سفارش دهید" action={<Button type="primary" onClick={() => navigate(`/${orgId}/catalog`)}>رفتن به کاتالوگ</Button>} />
      ) : (
        <div className="rq-cart">
          <div>
            <Card title="اقلام این سفارش" meta={<span className="rq-card-f">{st.ready.toLocaleString("fa-IR")} قلم</span>}>
              {now.length ? now.map(row) : <EmptyState compact title="همهٔ اقلام برای بعد کنار گذاشته شده‌اند" />}
            </Card>
            {later.length ? (
              <Card title="برای بعد" className="rq-banner">
                {later.map(row)}
              </Card>
            ) : null}
          </div>
          <Card title="جزئیات سفارش">
            <div className="rq-form">
              <Field label="درخواست برای" hint="هر قلم می‌تواند شخص خودش را هم داشته باشد">
                <UserSelect value={header.requested_for ?? userId} onChange={(v) => set("requested_for", typeof v === "string" ? v : null)} />
              </Field>
              <Field label="محل تحویل">
                <RecordSelect table="location" value={header.location_id} onChange={(v) => set("location_id", typeof v === "string" ? v : null)} allowClear />
              </Field>
              <Field label="تاریخ نیاز">
                <DateInput value={header.needed_by} onChange={(v) => set("needed_by", v)} allowClear />
              </Field>
              <Field label="مرکز هزینه">
                <RecordSelect table="org_unit" filter={{ f: "kind", op: "eq", v: "cost_center" }} value={header.cost_center_id} onChange={(v) => set("cost_center_id", typeof v === "string" ? v : null)} allowClear />
              </Field>
              <Field label="توضیحات ویژه">
                <Input.TextArea value={header.instructions ?? ""} onChange={(e) => setHeader({ ...header, instructions: e.target.value })} onBlur={() => saveHeader.mutate({ instructions: header.instructions || null })} autoSize={{ minRows: 2, maxRows: 6 }} maxLength={2000} />
              </Field>
              <dl className="rq-sum">
                <div>
                  <dt>جمع</dt>
                  <dd>{Number(data?.totals.total ?? 0) > 0 ? money(data?.totals.total) : "رایگان"}</dd>
                </div>
                {data?.totals.recurring ? (
                  <div>
                    <dt>هزینهٔ دوره‌ای</dt>
                    <dd>{recurringText(data.totals.recurring, null)}</dd>
                  </div>
                ) : null}
              </dl>
              {st.blocked ? <Alert type="warning" title="چند قلم بازبینی لازم دارد؛ آن‌ها را ویرایش یا حذف کنید" /> : null}
              {problem ? <Alert type="error" title={problem} /> : null}
              <Space>
                <Button type="primary" icon={<Send {...ICON} />} loading={checkout.isPending} disabled={!st.ready || !!st.blocked} onClick={() => checkout.mutate(undefined, { onError: (e) => setProblem(errorText(e)) })}>
                  ثبت سفارش
                </Button>
              </Space>
            </div>
          </Card>
        </div>
      )}
      <OrderDrawer itemId={edit?.item_id ?? null} forUser={edit?.requested_for ?? null} open={!!edit} onClose={() => setEdit(null)} line={edit} />
    </>
  );
}
