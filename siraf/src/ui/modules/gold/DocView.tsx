// A gold document (the voucher screen links here): header, lines with weights, values and the
// posted costs, settlement, its voucher, printing and the lifecycle actions.
import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Dropdown, Table } from "antd";
import { Ban, CircleCheck, Ellipsis, FileText, Pencil, Printer, ReceiptText, Trash2 } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader, Section } from "../../components/layout";
import { JDate, JDateTime, Loader, Money } from "../../components/display";
import { D } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { gw, KIND_PATH, KINDS, StatusOf, ITEM_STATUS, formTitle, wageText, type DocKind } from "./shared";
import { PrintArea, printSheet, type PrintFormat } from "./Invoice";
import { KaratText } from "./kit";

const LINE_LABEL: Record<string, string> = { piece: "جنس", bulk: "وزنی", old: "مستعمل", coin: "سکه", bar: "شمش" };

export default function DocView() {
  const { id } = useParams();
  const { api, orgId, can } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const n = useNotify();
  const [format, setFormat] = useState<PrintFormat>("a5");
  const q = useQuery({ queryKey: ["gold-doc", id], queryFn: () => api.get(`/gold/docs/${id}`).then((r) => r.doc) });
  const d = q.data;
  if (q.isLoading) return <div className="grid h-64 place-content-center"><Loader /></div>;
  if (q.error || !d) return <Alert type="error" title={errorText(q.error)} />;
  const kind = d.kind as DocKind;
  const rule = KINDS[kind];
  const money = !["consign_in", "consign_return", "workshop_out", "melt"].includes(kind);

  const run = async (what: "post" | "cancel" | "delete") => {
    if (what === "cancel" && !(await n.confirm(`${rule.title} شماره‌ی ${faDigits(d.no)} باطل شود؟`, "اجناس و موجودی‌ها به حالت قبل برمی‌گردند و سند حسابداری حذف می‌شود.", true))) return;
    if (what === "delete" && !(await n.confirm("این سند حذف شود؟", undefined, true))) return;
    try {
      if (what === "delete") {
        await api.del(`/gold/docs/${id}`);
        n.ok("سند حذف شد");
        qc.invalidateQueries({ queryKey: ["table"] });
        nav(`/${orgId}/gold/docs`);
        return;
      }
      const r = await api.post(`/gold/docs/${id}/${what}`);
      qc.setQueryData(["gold-doc", id], r.doc);
      qc.invalidateQueries({ queryKey: ["table"] });
      n.ok(what === "post" ? "سند ثبت شد" : "سند باطل شد");
    } catch (e) {
      n.error(e);
    }
  };
  const print = (f: PrintFormat) => {
    setFormat(f);
    printSheet(f);
  };
  const s = d.settle ?? {};
  const names = d.settle_names ?? {};
  const lines: any[] = d.lines ?? [];
  // a column that is «—» on every row says nothing: it is left out
  const has = (k: string) => lines.some((l) => !D(l[k] ?? 0).isZero());

  return (
    <div className="sf-doc">
      <PageHeader
        back={`/${orgId}/gold/docs`}
        title={`${rule.title} ${faDigits(d.no)}`}
        subtitle={<span className="sf-doc-meta"><StatusOf s={d.status} /><span className="sf-sep" aria-hidden /><JDate v={d.date} /><span className="sf-sep" aria-hidden /><JDateTime v={d.created_at} />{d.created_by_name ? <><span className="sf-sep" aria-hidden /><span>{d.created_by_name}</span></> : null}</span>}
        actions={
          <>
            <Dropdown
              trigger={["click"]}
              placement="bottomLeft"
              menu={{
                items: [
                  ...(can("gold", "edit") && d.status !== "cancelled" ? [{ key: "e", icon: <Ic icon={Pencil} />, label: "ویرایش سند", onClick: () => nav(`/${orgId}/${KIND_PATH[kind]}/${d.id}`) }] : []),
                  ...(kind === "sale" ? [{ key: "r", icon: <Ic icon={ReceiptText} />, label: "رسید ۸۰ میلی‌متری", onClick: () => print("receipt") }] : []),
                  ...(d.voucher ? [{ key: "v", icon: <Ic icon={FileText} />, label: `سند حسابداری ${faDigits(d.voucher.no)}`, onClick: () => nav(`/${orgId}/accounting/vouchers/${d.voucher.id}`) }] : []),
                  ...(can("gold", "edit") && d.status === "posted" ? [{ key: "c", icon: <Ic icon={Ban} />, danger: true, label: "ابطال سند", onClick: () => run("cancel") }] : []),
                  ...(can("gold", "full") ? [{ key: "d", icon: <Ic icon={Trash2} />, danger: true, label: "حذف سند", onClick: () => run("delete") }] : []),
                ],
              }}
            >
              <Button icon={<Ic icon={Ellipsis} />} aria-label="بیشتر" />
            </Dropdown>
            <Button type={can("gold", "edit") && d.status !== "posted" && d.status !== "cancelled" ? "default" : "primary"} icon={<Ic icon={Printer} />} onClick={() => print("a5")}>{kind === "sale" ? "چاپ فاکتور" : "چاپ"}</Button>
            {can("gold", "edit") && d.status !== "posted" && d.status !== "cancelled" ? <Button type="primary" icon={<Ic icon={CircleCheck} />} onClick={() => run("post")}>ثبت قطعی</Button> : null}
          </>
        }
      />
      <div className="no-print">
        {d.status === "cancelled" ? <div className="sf-inline mb-4" data-tone="danger"><i className="sf-nuqta" aria-hidden /><span><b>باطل شده.</b> این سند اثری در حساب‌ها و موجودی ندارد.</span></div> : null}
        <div className="sf-doc-card sf-doc-pad mb-4">
          <dl className="sf-kv m-0">
            <div><dt>{rule.partyLabel || "طرف حساب"}</dt><dd>{d.party ? <Link className="sf-link" to={`/${orgId}/parties/${d.party.id}`}>{d.party.name}</Link> : d.buyer?.name ?? "—"}</dd></div>
            <div><dt>گرم ۱۸ عیار</dt><dd className="sf-num">{d.gram18 ? formatNumber(d.gram18) : "—"}</dd></div>
            <div><dt>مظنه</dt><dd className="sf-num">{d.mazaneh ? formatNumber(d.mazaneh) : "—"}</dd></div>
            <div><dt>وزن ۷۵۰ خروجی (گرم)</dt><dd className="sf-num">{D(d.weight_out ?? 0).isZero() ? <span className="sf-zero">—</span> : gw(d.weight_out)}</dd></div>
            <div><dt>وزن ۷۵۰ ورودی (گرم)</dt><dd className="sf-num">{D(d.weight_in ?? 0).isZero() ? <span className="sf-zero">—</span> : gw(d.weight_in)}</dd></div>
            <div><dt>سند حسابداری</dt><dd>{d.voucher ? <Link to={`/${orgId}/accounting/vouchers/${d.voucher.id}`} className="sf-link sf-num">سند {faDigits(d.voucher.no)}</Link> : "—"}</dd></div>
          </dl>
        </div>
        <Section title="ردیف‌ها" bodyClass="p-0">
          <Table
            className=""
            size="small"
            rowKey="id"
            pagination={false}
            scroll={{ x: "max-content" }}
            dataSource={lines}
            columns={[
              { key: "no", dataIndex: "line_no", title: "#", width: 40, render: (v) => <span className="sf-num text-ink-3">{faDigits(v)}</span> },
              { key: "t", title: "شرح", render: (_, l: any) => (
                <div className="sf-gdl">
                  <div className="t">{l.kind === "coin" ? `${l.title ?? l.coin_name} × ${faDigits(D(l.qty).toString())}` : l.title ?? LINE_LABEL[l.kind]}</div>
                  <div className="m">
                    {[
                      `${LINE_LABEL[l.kind]}${l.kind === "bulk" ? `، ${formTitle(l.form)}` : ""}${kind === "melt" ? (l.direction === "out" ? " (ورودی)" : " (حاصل)") : ""}`,
                      l.tag_no ? <span key="tag">{l.kind === "bar" ? "شمش" : "اتیکت"} <span className="sf-docno">{faDigits(l.tag_no)}</span></span> : null,
                      l.kind === "bar" && (l.serial_no || l.extra?.bar?.serial_no) ? <bdi key="sn" dir="ltr">{l.serial_no || l.extra?.bar?.serial_no}</bdi> : null,
                      l.kind === "bar" ? l.brand || l.extra?.bar?.brand || null : null,
                      l.direction === "in" && (l.kind === "coin" || l.kind === "bar") && l.description && !D(l.discount ?? 0).isZero() ? `کسر: ${l.description}` : null,
                      l.category_name,
                      l.assay_no ? `انگ ${l.assay_no}` : null,
                      l.item_status && l.kind === "piece" ? ITEM_STATUS[l.item_status]?.[0] ?? l.item_status : null,
                    ].filter(Boolean).map((x, i) => <span key={i}>{i ? "، " : ""}{x}</span>)}
                  </div>
                </div>
              ) },
              { key: "f", dataIndex: "fineness", title: "عیار", render: (v, l: any) => <KaratText fineness={v ?? 750} coin={l.kind === "coin"} /> },
              { key: "w", dataIndex: "weight", title: "وزن (گرم)", className: "sf-num", render: (v, l: any) => (l.kind === "coin" ? <span className="sf-zero">—</span> : (
                <div className="sf-gdl">
                  <span className="sf-num">{gw(v)}</span>
                  {!D(l.weight750 ?? 0).eq(D(v ?? 0)) ? <span className="m">۷۵۰: <span className="sf-num">{gw(l.weight750)}</span></span> : null}
                </div>
              )) },
              ...(money
                ? [
                    ...(lines.some((l: any) => l.kind === "coin" || (l.gram_price && d.gram18 && !D(l.gram_price).eq(D(d.gram18))))
                      ? [{ key: "gp", dataIndex: "gram_price", title: "نرخ", className: "sf-num", render: (v: string) => <Money v={v ?? 0} zero="—" /> }]
                      : []),
                    ...(has("gold_value") ? [{ key: "gv", dataIndex: "gold_value", title: "ارزش طلا", className: "sf-num", render: (v: string) => <Money v={v} zero="—" /> }] : []),
                    ...(has("wage") ? [{ key: "wg", title: "اجرت", className: "sf-num", render: (_: unknown, l: any) => (D(l.wage).isZero() ? <span className="sf-zero">—</span> : <div className="sf-gdl"><Money v={l.wage} /><div className="m">{wageText(l.wage_type, l.wage_value)}</div></div>) }] : []),
                    ...(kind === "sale" ? [
                      ...(has("profit") ? [{ key: "pr", dataIndex: "profit", title: "سود", className: "sf-num", render: (v: string) => <Money v={v} zero="—" /> }] : []),
                      ...(has("discount") ? [{ key: "ds", dataIndex: "discount", title: "تخفیف", className: "sf-num", render: (v: string) => <Money v={v} zero="—" /> }] : []),
                      ...(has("tax") ? [{ key: "tx", dataIndex: "tax", title: "مالیات", className: "sf-num", render: (v: string) => <Money v={v} zero="—" /> }] : []),
                    ] : []),
                    ...(has("stone") ? [{ key: "st", dataIndex: "stone", title: "سنگ", className: "sf-num", render: (v: string) => <Money v={v} zero="—" /> }] : []),
                    ...(kind === "buyback" && has("discount") ? [{ key: "dd", title: "کسر", className: "sf-num", render: (_: unknown, l: any) => <Money v={l.discount} zero="—" /> }] : []),
                    { key: "tt", dataIndex: "total", title: "جمع", className: "sf-num", render: (v: string, l: any) => (
                      <div className="sf-gdl">
                        <Money v={v} zero="—" className="font-medium" />
                        {d.status === "posted" && !D(l.cost ?? 0).isZero() ? <span className="m">بهای دفتری <Money v={l.cost} /></span> : null}
                      </div>
                    ) },
                  ]
                : []),
              ...(!money && d.status === "posted" && has("cost") ? [{ key: "cost", dataIndex: "cost", title: "بهای دفتری", className: "sf-num", render: (v: string | null) => <Money v={v ?? 0} zero="—" /> }] : []),
            ]}
          />
        </Section>
        <div className="mt-4 grid items-start gap-4 md:grid-cols-2">
          {money ? (
            <Section title="مبالغ">
              <div className="sf-sums">
              {[
                ["ارزش طلا", d.gold_value], ["اجرت", d.wage], ["سود", d.profit], ["تخفیف", d.discount], ["مالیات", d.tax], ["سنگ", d.stone],
                ["طلای مستعمل", d.old_value], ["جمع سند", d.total],
                ...(kind === "sale" && !D(d.old_value).isZero() ? [["خالص قابل دریافت", D(d.total).minus(D(d.old_value)).toString()]] : []),
              ].filter(([, v]) => !D(v).isZero()).map(([k, v]) => (
                <div key={k} className={`r ${k === "جمع سند" || k === "خالص قابل دریافت" ? "is-total" : ""}`}><span>{k}</span><span className="n"><Money v={k === "تخفیف" || k === "طلای مستعمل" ? D(v).neg().toString() : v} /></span></div>
              ))}
              </div>
            </Section>
          ) : null}
          <Section title="تسویه">
            <div className="sf-sums is-flat">
            {s.mode ? <div className="r"><span>نوع</span><span className="n">{s.mode === "weight" ? "وزنی (طلا به طلا)" : "ریالی"}</span></div> : null}
            {s.cash ? <div className="r"><span>نقد{names.cash ? <span className="why">{names.cash}</span> : null}</span><span className="n"><Money v={s.cash.amount} /></span></div> : null}
            {s.pos ? <div className="r"><span>کارتخوان{names.pos ? <span className="why">{names.pos}</span> : null}</span><span className="n"><Money v={s.pos.amount} /></span></div> : null}
            {s.bank ? <div className="r"><span>بانک{names.bank ? <span className="why">{names.bank}</span> : null}</span><span className="n"><Money v={s.bank.amount} /></span></div> : null}
            {s.remaining && !D(s.remaining).isZero() ? <div className="r is-total"><span>مانده به حساب طرف</span><span className="n"><Money v={s.remaining} /></span></div> : null}
            {s.consumed_weight750 ? <div className="r"><span>وزن مصرفی کارگاه</span><span className="n">{gw(s.consumed_weight750)}<span className="sf-unit">{"\u00a0"}گرم</span></span></div> : null}
            {s.close_workshop ? <div className="r is-sub"><span>مانده‌ی کارگاه تسویه شد (مابقی به افت)</span><span className="n" /></div> : null}
            {!s.mode && !s.cash && !s.pos && !s.bank && (!s.remaining || D(s.remaining).isZero()) ? <div className="r is-sub"><span>{money ? "بدون پرداخت" : "سند وزنی است"}</span><span className="n" /></div> : null}
            </div>
            {d.description ? <div className="mt-3 text-[13px] text-ink-2">توضیحات: {d.description}</div> : null}
          </Section>
        </div>
      </div>
      <PrintArea doc={d} format={format} />
    </div>
  );
}
