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

const LINE_LABEL: Record<string, string> = { piece: "جنس", bulk: "وزنی", old: "مستعمل", coin: "سکه" };

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
            <div><dt>وزن ۷۵۰ خروجی</dt><dd className="sf-num">{gw(d.weight_out)}</dd></div>
            <div><dt>وزن ۷۵۰ ورودی</dt><dd className="sf-num">{gw(d.weight_in)}</dd></div>
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
            dataSource={d.lines}
            columns={[
              { key: "no", dataIndex: "line_no", title: "#", render: (v) => <span className="sf-num">{faDigits(v)}</span> },
              { key: "k", title: "نوع", render: (_, l: any) => <span className="text-ink-2">{LINE_LABEL[l.kind]}{l.kind === "bulk" ? `، ${formTitle(l.form)}` : ""}{kind === "melt" ? (l.direction === "out" ? " (ورودی)" : " (حاصل)") : ""}</span> },
              { key: "t", title: "شرح", render: (_, l: any) => (
                <div>
                  <div>{l.kind === "coin" ? `${l.title ?? l.coin_name} × ${faDigits(D(l.qty).toString())}` : l.title}</div>
                  <div className="text-xs text-ink-3">
                    {l.tag_no ? <span>اتیکت <span className="sf-docno">{faDigits(l.tag_no)}</span></span> : null}
                    {l.category_name ? `، ${l.category_name}` : ""}
                    {l.assay_no ? `، انگ ${l.assay_no}` : ""}
                    {l.item_status && l.kind === "piece" ? <>، {ITEM_STATUS[l.item_status]?.[0] ?? l.item_status}</> : null}
                  </div>
                </div>
              ) },
              { key: "f", dataIndex: "fineness", title: "عیار", render: (v, l: any) => <KaratText fineness={v ?? 750} coin={l.kind === "coin"} /> },
              { key: "w", dataIndex: "weight", title: "وزن", className: "sf-num", render: (v, l: any) => (l.kind === "coin" ? "—" : <span className="sf-num">{gw(v)}</span>) },
              { key: "w750", dataIndex: "weight750", title: "۷۵۰", className: "sf-num", render: (v, l: any) => (l.kind === "coin" ? "—" : <span className="sf-num">{gw(v)}</span>) },
              ...(money
                ? [
                    { key: "gp", dataIndex: "gram_price", title: "قیمت", className: "sf-num", render: (v: string) => <Money v={v ?? 0} zero="—" /> },
                    { key: "gv", dataIndex: "gold_value", title: "ارزش طلا", className: "sf-num", render: (v: string) => <Money v={v} zero="—" /> },
                    { key: "wg", title: "اجرت", className: "sf-num", render: (_: unknown, l: any) => (D(l.wage).isZero() ? "—" : <div><Money v={l.wage} /><div className="text-xs text-ink-3">{wageText(l.wage_type, l.wage_value)}</div></div>) },
                    ...(kind === "sale" ? [
                      { key: "pr", dataIndex: "profit", title: "سود", className: "sf-num", render: (v: string) => <Money v={v} zero="—" /> },
                      { key: "ds", dataIndex: "discount", title: "تخفیف", className: "sf-num", render: (v: string) => <Money v={v} zero="—" /> },
                      { key: "tx", dataIndex: "tax", title: "مالیات", className: "sf-num", render: (v: string) => <Money v={v} zero="—" /> },
                    ] : []),
                    ...(kind === "buyback" ? [{ key: "dd", title: "کسر", className: "sf-num", render: (_: unknown, l: any) => <Money v={l.discount} zero="—" /> }] : []),
                    { key: "tt", dataIndex: "total", title: "جمع", className: "sf-num", render: (v: string) => <Money v={v} className="font-medium" /> },
                  ]
                : []),
              ...(d.status === "posted" ? [{ key: "cost", dataIndex: "cost", title: "بهای دفتری", className: "sf-num", render: (v: string | null) => <Money v={v ?? 0} zero="—" /> }] : []),
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
