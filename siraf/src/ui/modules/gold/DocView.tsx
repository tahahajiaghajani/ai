// A gold document (the voucher screen links here): header, lines with weights, values and the
// posted costs, settlement, its voucher, printing and the lifecycle actions.
import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Dropdown, Spin, Table, Tag } from "antd";
import { PrinterOutlined, EditOutlined, StopOutlined, CheckCircleOutlined, DeleteOutlined, MoreOutlined, FileTextOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader, Section } from "../../components/layout";
import { JDate, JDateTime, Money } from "../../components/display";
import { D } from "@shared/money";
import { faDigits, formatNumber, formatWeight } from "@shared/format";
import { KIND_PATH, KINDS, StatusOf, ITEM_STATUS, formTitle, wageText, type DocKind } from "./shared";
import { PrintArea, printSheet, type PrintFormat } from "./Invoice";

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
  if (q.isLoading) return <div className="grid h-64 place-content-center"><Spin /></div>;
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
    <div>
      <PageHeader
        back={`/${orgId}/gold/docs`}
        title={`${rule.title} شماره‌ی ${faDigits(d.no)}`}
        subtitle={<>تاریخ <JDate v={d.date} />، ثبت <JDateTime v={d.created_at} />{d.created_by_name ? `، ${d.created_by_name}` : ""}</>}
        extra={<StatusOf s={d.status} />}
        actions={
          <>
            {kind === "sale" ? (
              <>
                <Button icon={<PrinterOutlined />} onClick={() => print("a5")}>فاکتور A5</Button>
                <Button icon={<PrinterOutlined />} onClick={() => print("receipt")}>رسید ۸۰ میلی‌متری</Button>
              </>
            ) : (
              <Button icon={<PrinterOutlined />} onClick={() => print("a5")}>چاپ</Button>
            )}
            {can("gold", "edit") && d.status !== "cancelled" ? <Button icon={<EditOutlined />} onClick={() => nav(`/${orgId}/${KIND_PATH[kind]}/${d.id}`)}>ویرایش</Button> : null}
            {can("gold", "edit") && d.status !== "posted" ? <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => run("post")}>ثبت</Button> : null}
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  ...(d.voucher ? [{ key: "v", icon: <FileTextOutlined />, label: `سند حسابداری ${faDigits(d.voucher.no)}`, onClick: () => nav(`/${orgId}/accounting/vouchers/${d.voucher.id}`) }] : []),
                  ...(can("gold", "edit") && d.status === "posted" ? [{ key: "c", icon: <StopOutlined />, danger: true, label: "ابطال سند", onClick: () => run("cancel") }] : []),
                  ...(can("gold", "full") ? [{ key: "d", icon: <DeleteOutlined />, danger: true, label: "حذف سند", onClick: () => run("delete") }] : []),
                ],
              }}
            >
              <Button icon={<MoreOutlined />} aria-label="بیشتر" />
            </Dropdown>
          </>
        }
      />
      <div className="no-print">
        {d.status === "cancelled" ? <Alert className="!mb-3" type="error" showIcon title="این سند باطل شده است و اثری در حساب‌ها و موجودی ندارد." /> : null}
        <div className="mb-3 grid gap-3 md:grid-cols-4">
          <Info k={rule.partyLabel || "طرف حساب"} v={d.party ? <Link to={`/${orgId}/parties/${d.party.id}`}>{d.party.name}</Link> : d.buyer?.name ?? "—"} />
          <Info k="گرم ۱۸ / مظنه" v={d.gram18 ? <span className="num">{formatNumber(d.gram18)} / {formatNumber(d.mazaneh ?? 0)}</span> : "—"} />
          <Info k="وزن ۷۵۰ خروجی / ورودی" v={<span className="num">{formatWeight(d.weight_out)} / {formatWeight(d.weight_in)}</span>} />
          <Info k="سند حسابداری" v={d.voucher ? <Link to={`/${orgId}/accounting/vouchers/${d.voucher.id}`} className="num">{faDigits(d.voucher.no)}</Link> : "—"} />
        </div>
        <Section title="ردیف‌ها" bodyClass="p-0">
          <Table
            className="tz-table"
            size="small"
            rowKey="id"
            pagination={false}
            scroll={{ x: "max-content" }}
            dataSource={d.lines}
            columns={[
              { key: "no", dataIndex: "line_no", title: "#", render: (v) => <span className="num">{faDigits(v)}</span> },
              { key: "k", title: "نوع", render: (_, l: any) => <Tag variant="filled" className="!m-0">{LINE_LABEL[l.kind]}{l.kind === "bulk" ? `، ${formTitle(l.form)}` : ""}{kind === "melt" ? (l.direction === "out" ? " (ورودی)" : " (حاصل)") : ""}</Tag> },
              { key: "t", title: "شرح", render: (_, l: any) => (
                <div>
                  <div>{l.kind === "coin" ? `${l.title ?? l.coin_name} × ${faDigits(D(l.qty).toString())}` : l.title}</div>
                  <div className="text-[11px] text-muted">
                    {l.tag_no ? <span className="num">اتیکت {faDigits(l.tag_no)}</span> : null}
                    {l.category_name ? `، ${l.category_name}` : ""}
                    {l.assay_no ? `، انگ ${l.assay_no}` : ""}
                    {l.item_status && l.kind === "piece" ? <>، {ITEM_STATUS[l.item_status]?.[0] ?? l.item_status}</> : null}
                  </div>
                </div>
              ) },
              { key: "f", dataIndex: "fineness", title: "عیار", render: (v) => <span className="num">{faDigits(D(v ?? 750).toString())}</span> },
              { key: "w", dataIndex: "weight", title: "وزن", align: "left", render: (v, l: any) => (l.kind === "coin" ? "—" : <span className="num">{formatWeight(v)}</span>) },
              { key: "w750", dataIndex: "weight750", title: "۷۵۰", align: "left", render: (v, l: any) => (l.kind === "coin" ? "—" : <span className="num">{formatWeight(v)}</span>) },
              ...(money
                ? [
                    { key: "gp", dataIndex: "gram_price", title: "قیمت", align: "left" as const, render: (v: string) => <Money v={v ?? 0} zero="—" /> },
                    { key: "gv", dataIndex: "gold_value", title: "ارزش طلا", align: "left" as const, render: (v: string) => <Money v={v} zero="—" /> },
                    { key: "wg", title: "اجرت", align: "left" as const, render: (_: unknown, l: any) => (D(l.wage).isZero() ? "—" : <div><Money v={l.wage} /><div className="text-[10px] text-muted">{wageText(l.wage_type, l.wage_value)}</div></div>) },
                    ...(kind === "sale" ? [
                      { key: "pr", dataIndex: "profit", title: "سود", align: "left" as const, render: (v: string) => <Money v={v} zero="—" /> },
                      { key: "ds", dataIndex: "discount", title: "تخفیف", align: "left" as const, render: (v: string) => <Money v={v} zero="—" /> },
                      { key: "tx", dataIndex: "tax", title: "مالیات", align: "left" as const, render: (v: string) => <Money v={v} zero="—" /> },
                    ] : []),
                    ...(kind === "buyback" ? [{ key: "dd", title: "کسر", align: "left" as const, render: (_: unknown, l: any) => <Money v={l.discount} zero="—" /> }] : []),
                    { key: "tt", dataIndex: "total", title: "جمع", align: "left" as const, render: (v: string) => <b><Money v={v} /></b> },
                  ]
                : []),
              ...(d.status === "posted" ? [{ key: "cost", dataIndex: "cost", title: "بهای دفتری", align: "left" as const, render: (v: string | null) => <Money v={v ?? 0} zero="—" /> }] : []),
            ]}
          />
        </Section>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {money ? (
            <Section title="مبالغ">
              {[
                ["ارزش طلا", d.gold_value], ["اجرت", d.wage], ["سود", d.profit], ["تخفیف", d.discount], ["مالیات", d.tax], ["سنگ", d.stone],
                ["طلای مستعمل", d.old_value], ["جمع سند", d.total],
                ...(kind === "sale" && !D(d.old_value).isZero() ? [["خالص قابل دریافت", D(d.total).minus(D(d.old_value)).toString()]] : []),
              ].filter(([, v]) => !D(v).isZero()).map(([k, v]) => (
                <div key={k} className="flex justify-between py-0.5 text-sm"><span className="text-muted">{k}</span><Money v={v} /></div>
              ))}
            </Section>
          ) : null}
          <Section title="تسویه">
            {s.mode ? <div className="flex justify-between py-0.5 text-sm"><span className="text-muted">نوع</span><span>{s.mode === "weight" ? "وزنی (طلا به طلا)" : "ریالی"}</span></div> : null}
            {s.cash ? <div className="flex justify-between py-0.5 text-sm"><span className="text-muted">نقد {names.cash ? `(${names.cash})` : ""}</span><Money v={s.cash.amount} /></div> : null}
            {s.pos ? <div className="flex justify-between py-0.5 text-sm"><span className="text-muted">کارتخوان {names.pos ? `(${names.pos})` : ""}</span><Money v={s.pos.amount} /></div> : null}
            {s.bank ? <div className="flex justify-between py-0.5 text-sm"><span className="text-muted">بانک {names.bank ? `(${names.bank})` : ""}</span><Money v={s.bank.amount} /></div> : null}
            {s.remaining && !D(s.remaining).isZero() ? <div className="flex justify-between py-0.5 text-sm font-bold"><span>مانده به حساب طرف</span><Money v={s.remaining} /></div> : null}
            {s.consumed_weight750 ? <div className="flex justify-between py-0.5 text-sm"><span className="text-muted">وزن مصرفی کارگاه</span><span className="num">{formatWeight(s.consumed_weight750)}</span></div> : null}
            {s.close_workshop ? <div className="text-xs text-muted">مانده‌ی کارگاه تسویه شد (مابقی به افت)</div> : null}
            {!s.mode && !s.cash && !s.pos && !s.bank && (!s.remaining || D(s.remaining).isZero()) ? <div className="text-sm text-muted">{money ? "بدون پرداخت" : "سند وزنی است"}</div> : null}
            {d.description ? <div className="mt-2 text-sm">توضیحات: {d.description}</div> : null}
          </Section>
        </div>
      </div>
      <PrintArea doc={d} format={format} />
    </div>
  );
}

function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="tz-card px-3 py-2">
      <div className="text-[11px] text-muted">{k}</div>
      <div className="mt-0.5 text-sm font-semibold">{v}</div>
    </div>
  );
}
