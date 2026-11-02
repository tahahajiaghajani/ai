// Receipt / payment / transfer editor. Header (date, party or counter account, description), the
// lines grid (or the transfer form), allocations to invoices, totals with the amount in words and
// an A5 slip to print. F2 or Ctrl+Enter saves, Alt+F2 saves and starts a new one.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dropdown, Input, Switch } from "antd";
import { CircleAlert, Ellipsis, ListPlus, Plus, Printer, Trash2 } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useHotkey, useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { AccountSelect, DateInput, DetailSelect, PartySelect, type Opt } from "../../components/inputs";
import { Balance, Chip, EmptyState, JDateTime, Skeleton } from "../../components/display";
import { faDigits, formatNumber } from "@shared/format";
import { todayISO } from "@shared/jalali";
import { amountToWords } from "@shared/words";
import { D } from "@shared/money";
import { isUuid } from "@shared/id";
import { KIND_PATH, KIND_TITLE, type DocKind, type Method } from "./labels";
import { blankLine, isEmptyLine, lineFromDoc, linePayload, lineTotals, recall, type Line } from "./editor";
import { LinesGrid } from "./LinesGrid";
import { TransferForm } from "./TransferForm";
import { PrintSlip } from "./PrintSlip";
import { Allocations } from "./Allocations";
import { Amt, BtnKeys, Card, Field, ICON, Keys, Note, docNo } from "../reports/kit";

export default function DocEditor() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const { api } = useOrg();
  const isNew = !id || id === "new";
  // the editor is keyed by the data version: a refetch (after saving) reloads it with fresh ids
  const q = useQuery({
    queryKey: ["treasury-doc", id],
    queryFn: () => api.get(`/treasury/docs/${id}`).then((r) => r.doc),
    enabled: !isNew,
    refetchOnReconnect: false,
  });
  if (!isNew && q.isLoading)
    return (
      <div>
        <PageHeader back title="سند" />
        <Card>
          <Skeleton rows={6} />
        </Card>
      </div>
    );
  if (!isNew && (q.error || !q.data))
    return (
      <div>
        <PageHeader back title="سند" />
        <Card>
          <EmptyState icon={CircleAlert} title="بارگذاری انجام نشد" description={q.error ? errorText(q.error) : "سند پیدا نشد."} action={<Button onClick={() => q.refetch()}>تلاش دوباره</Button>} />
        </Card>
      </div>
    );
  const param = sp.get("kind");
  const kind: DocKind = isNew ? (param === "payment" || param === "transfer" ? param : "receipt") : q.data.kind;
  return <Editor key={isNew ? `new-${kind}-${sp.get("n") ?? ""}` : `${id}-${q.dataUpdatedAt}`} kind={kind} doc={isNew ? null : q.data} />;
}

function initialLines(kind: DocKind, doc: any | null): Line[] {
  if (doc) return doc.lines.map(lineFromDoc);
  if (kind === "transfer") {
    const out = blankLine("transfer", "bank", "out");
    const inn = blankLine("transfer", "cash", "in");
    return [out, inn];
  }
  const method = (recall(`method.${kind}`) as Method | null) ?? "cash";
  return [blankLine(kind, method)];
}

function Editor({ kind, doc }: { kind: DocKind; doc: any | null }) {
  const { api, orgId, can, unit, has } = useOrg();
  const n = useNotify();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  // settling an invoice from the goods module: ?party=…&invoice=…
  const presetParty = !doc && kind !== "transfer" && isUuid(sp.get("party")) ? sp.get("party") : null;
  const presetInvoice = presetParty && isUuid(sp.get("invoice")) ? sp.get("invoice") : null;
  const closed = doc?.fiscal_year_status === "closed";
  const readonly = !can("treasury", "edit") || closed;

  const [date, setDate] = useState<string | null>(doc?.date ?? todayISO());
  const [partyId, setPartyId] = useState<string | null>(doc?.party_id ?? presetParty);
  const [partyName, setPartyName] = useState<string | null>(doc?.party_name ?? null);
  const [useAccount, setUseAccount] = useState<boolean>(!!doc?.account_id);
  const [account, setAccount] = useState<Opt | null>(
    doc?.account_id ? { id: doc.account_id, label: doc.account_name, sub: doc.account_code, detail_mode: doc.account_detail_mode, detail_kinds: doc.account_detail_kinds } : null,
  );
  const [detailId, setDetailId] = useState<string | null>(doc?.detail_id ?? null);
  const [description, setDescription] = useState<string>(doc?.description ?? "");
  const [lines, setLinesState] = useState<Line[]>(() => initialLines(kind, doc));
  const [allocs, setAllocs] = useState<Record<string, string | null>>(() => Object.fromEntries((doc?.allocs ?? []).map((a: any) => [a.invoice_id, a.amount])));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const setLines = (fn: (ls: Line[]) => Line[]) => {
    setLinesState(fn);
    setDirty(true);
  };

  const balance = useQuery({
    queryKey: ["treasury-party-balance", partyId],
    queryFn: () => api.get(`/treasury/party-balance/${partyId}`),
    enabled: !!partyId && kind !== "transfer",
  });

  // fill the invoice's remaining amount once (first line and its allocation)
  const preset = useRef(false);
  useEffect(() => {
    if (!presetInvoice || !partyId || preset.current) return;
    preset.current = true;
    api
      .get<{ rows: any[] }>("/treasury/invoices", { party_id: partyId, kind })
      .then(({ rows }) => {
        const inv = rows.find((r) => r.id === presetInvoice);
        if (!inv) return;
        const left = D(inv.total).minus(D(inv.allocated));
        if (left.lte(0)) return;
        setAllocs({ [inv.id]: left.toString() });
        setLinesState((ls) => ls.map((l, i) => (i === 0 && !l.amount ? { ...l, amount: left.toString() } : l)));
        setDescription((d) => d || `بابت فاکتور ${docNo(inv.no)}`);
        setDirty(true);
      })
      .catch(() => undefined);
  }, [presetInvoice, partyId, kind, api]);

  // with a single active cash box / bank account, new lines start with it
  const singles = useQuery({
    queryKey: ["treasury-singles"],
    queryFn: async () => {
      const [boxes, banks] = await Promise.all([api.get("/data/cash_box/options"), api.get("/data/bank_account/options")]);
      const one = (o: { options: Opt[] }) => (o.options.length === 1 ? o.options[0] : null);
      return { box: one(boxes), bank: one(banks) };
    },
    staleTime: 300_000,
    enabled: !readonly,
  });
  const autoFilled = useRef(new Set<string>());
  useEffect(() => {
    const one = singles.data;
    if (!one || readonly) return;
    let changed = false;
    const next = lines.map((l) => {
      if (l.locked || autoFilled.current.has(l.key)) return l;
      if (l.method === "cash" && !l.cash_box_id && one.box) {
        autoFilled.current.add(l.key);
        changed = true;
        return { ...l, cash_box_id: one.box.id, names: { ...l.names, src: one.box.label } };
      }
      if ((l.method === "bank" || l.method === "card") && !l.bank_account_id && one.bank) {
        autoFilled.current.add(l.key);
        changed = true;
        return { ...l, bank_account_id: one.bank.id, names: { ...l.names, src: one.bank.label } };
      }
      return l;
    });
    if (changed) setLinesState(next);
  }, [lines, singles.data, readonly]);

  const totals = useMemo(() => lineTotals(lines), [lines]);
  const total = kind === "transfer" ? D(lines[0]?.amount) : totals.amount;
  const showAllocs = has("goods") && kind !== "transfer" && !!partyId;

  // print right after the first save of a new document (navigation carries the request)
  const printed = useRef(false);
  useEffect(() => {
    if (doc && (loc.state as { print?: boolean } | null)?.print && !printed.current) {
      printed.current = true;
      setTimeout(() => window.print(), 300);
      nav(loc.pathname, { replace: true, state: null });
    }
  }, [doc, loc.state, loc.pathname, nav]);

  const save = async (after: "stay" | "new" | "print" = "stay") => {
    if (readonly || saving) return;
    if (!date) return n.warn("تاریخ را وارد کنید");
    const real = kind === "transfer" ? lines : lines.filter((l) => !isEmptyLine(l));
    if (!real.length) return n.warn("دست‌کم یک ردیف با مبلغ وارد کنید");
    setSaving(true);
    try {
      const body = {
        kind,
        date,
        party_id: kind === "transfer" ? null : partyId,
        account_id: kind !== "transfer" && useAccount ? account?.id ?? null : null,
        detail_id: kind !== "transfer" && useAccount ? detailId : null,
        description: description.trim() || null,
        lines: real.map(linePayload),
        allocs: showAllocs
          ? Object.entries(allocs)
              .filter(([, v]) => D(v).gt(0))
              .map(([invoice_id, amount]) => ({ invoice_id, amount }))
          : [],
      };
      const r = doc ? await api.put(`/treasury/docs/${doc.id}`, body) : await api.post("/treasury/docs", body);
      n.ok(`${KIND_TITLE[kind]} ${docNo(r.doc.no)} ثبت شد.`);
      setDirty(false);
      for (const key of [["table"], ["treasury-doc", r.doc.id], ["treasury-summary"], ["treasury-balances"], ["treasury-cheques"], ["treasury-book"], ["treasury-party-balance"], ["treasury-open-invoices"], ["dashboard"], ["goods-invoice"], ["goods-party"]]) {
        qc.invalidateQueries({ queryKey: key });
      }
      if (after === "new") nav(`/${orgId}/treasury/docs/new?kind=${kind}&n=${Date.now()}`);
      else if (!doc) nav(`/${orgId}/treasury/docs/${r.doc.id}`, { replace: true, state: after === "print" ? { print: true } : null });
      else if (after === "print") setTimeout(() => window.print(), 300);
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useHotkey("f2", () => saveRef.current("stay"), []);
  useHotkey("ctrl+enter", () => saveRef.current("stay"), []);
  useHotkey("alt+f2", () => saveRef.current("new"), []);

  const remove = async () => {
    if (!doc) return;
    if (!(await n.confirm(`حذف ${KIND_TITLE[kind]} ${docNo(doc.no)}؟`, "سند حسابداری و چک‌های ثبت‌شده در این سند هم حذف می‌شوند.", true))) return;
    try {
      await api.del(`/treasury/docs/${doc.id}`);
      n.ok(`${KIND_TITLE[kind]} ${docNo(doc.no)} حذف شد.`);
      for (const key of [["table"], ["treasury-summary"], ["treasury-balances"], ["treasury-cheques"], ["dashboard"], ["goods-invoice"], ["goods-party"]]) qc.invalidateQueries({ queryKey: key });
      nav(`/${orgId}/${KIND_PATH[kind]}`);
    } catch (e) {
      n.error(e);
    }
  };

  const title = doc ? `${KIND_TITLE[kind]} ${docNo(doc.no)}` : `${KIND_TITLE[kind]} جدید`;
  const pb = balance.data;
  const needDetail = useAccount && account && account.detail_mode && account.detail_mode !== "none";
  const net = kind === "receipt" ? total.minus(totals.fee) : total.plus(totals.fee);
  const chq = pb && partyId ? pb.cheques : null;

  return (
    <div>
      <PageHeader
        back={`/${orgId}/${KIND_PATH[kind]}`}
        title={title}
        subtitle={
          doc ? (
            <span className="inline-flex flex-wrap items-center gap-x-2">
              <span>
                ثبت <JDateTime v={doc.created_at} />
                {doc.created_by_name ? `، ${doc.created_by_name}` : ""}
              </span>
              {doc.voucher_id && can("accounting", "view") ? (
                <>
                  <span className="bk-sep" />
                  <Link className="sf-link" to={`/${orgId}/accounting/vouchers/${doc.voucher_id}`}>
                    سند حسابداری {doc.voucher_no ? docNo(doc.voucher_no) : ""}
                  </Link>
                </>
              ) : null}
              {dirty ? (
                <>
                  <span className="bk-sep" />
                  <Chip tone="neutral">تغییرات ثبت‌نشده</Chip>
                </>
              ) : null}
            </span>
          ) : null
        }
        actions={
          <>
            <Dropdown
              trigger={["click"]}
              rootClassName="sf-glass"
              menu={{
                items: [
                  ...(!readonly ? [{ key: "savenew", icon: <ListPlus {...ICON} />, label: <span className="flex items-center gap-4">ثبت و سند جدید <span className="sf-end"><Keys k={["Alt", "F2"]} /></span></span>, onClick: () => save("new") }] : []),
                  ...(doc ? [{ key: "new", icon: <Plus {...ICON} />, label: `${KIND_TITLE[kind]} جدید`, onClick: () => nav(`/${orgId}/treasury/docs/new?kind=${kind}&n=${Date.now()}`) }] : []),
                  ...(doc && can("treasury", "full") && !closed ? [{ type: "divider" as const }, { key: "del", icon: <Trash2 {...ICON} />, danger: true, label: "حذف سند", onClick: remove }] : []),
                ],
              }}
            >
              <Button type="text" icon={<Ellipsis {...ICON} />} aria-label="بیشتر" />
            </Dropdown>
            <Button icon={<Printer {...ICON} />} disabled={saving} onClick={() => (doc && !dirty ? window.print() : readonly ? window.print() : save("print"))}>
              {doc && !dirty ? "چاپ رسید" : readonly ? "چاپ" : "ثبت و چاپ"}
            </Button>
            {!readonly ? (
              <Button type="primary" loading={saving} onClick={() => save("stay")}>
                {saving ? "در حال ثبت…" : "ثبت"}
                <BtnKeys k={["F2"]} />
              </Button>
            ) : null}
          </>
        }
      />

      {closed ? <Note tone="warning" className="no-print mb-4"><b>سال مالی این سند بسته شده است</b>؛ سند فقط دیدنی است.</Note> : null}

      <section className="bk-card no-print">
        <div className={`bk-fields ${kind === "transfer" ? "bk-dh-t" : "bk-dh"}`}>
          <Field label="تاریخ">
            <DateInput value={date} onChange={(v) => { setDate(v); setDirty(true); }} disabled={readonly} />
          </Field>
          {kind !== "transfer" ? (
            <Field
              label={kind === "receipt" ? "دریافت از" : "پرداخت به"}
              extra={pb && partyId ? <>مانده <Balance v={pb.balance} /></> : null}
              hint={
                chq && (chq.received_open.count || chq.bounced.count || chq.issued_open.count) ? (
                  <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                    {chq.bounced.count ? (
                      <Chip tone="danger" fig>
                        {faDigits(chq.bounced.count)} چک برگشتی، {formatNumber(chq.bounced.sum)}
                      </Chip>
                    ) : null}
                    {chq.received_open.count ? (
                      <span className="sf-num">
                        {faDigits(chq.received_open.count)} چک دریافتی جاری، <Amt v={chq.received_open.sum} />
                      </span>
                    ) : null}
                    {chq.issued_open.count ? (
                      <span className="sf-num">
                        {faDigits(chq.issued_open.count)} چک پرداختی جاری، <Amt v={chq.issued_open.sum} />
                      </span>
                    ) : null}
                  </span>
                ) : null
              }
            >
              <PartySelect
                className="w-full"
                value={partyId}
                disabled={readonly}
                allowClear
                autoFocus={!doc}
                onChange={(pid, o) => {
                  setPartyId(pid);
                  setPartyName(o?.label ?? null);
                  setAllocs({});
                  setDirty(true);
                }}
              />
            </Field>
          ) : null}
          {kind !== "transfer" ? (
            <Field
              label="ثبت در حساب"
              extra={
                <label className="inline-flex cursor-pointer items-center gap-2">
                  حساب دیگر
                  <Switch size="small" checked={useAccount} disabled={readonly} onChange={(x) => { setUseAccount(x); setDirty(true); }} />
                </label>
              }
            >
              {useAccount ? (
                <div className="grid gap-2">
                  <AccountSelect
                    className="w-full"
                    value={account?.id ?? null}
                    disabled={readonly}
                    placeholder={kind === "receipt" ? "درآمد متفرقه، پیش‌دریافت…" : "اجاره، هزینه‌های متفرقه…"}
                    onChange={(aid, o) => {
                      setAccount(aid ? o ?? { id: aid, label: "" } : null);
                      setDetailId(null);
                      setDirty(true);
                    }}
                  />
                  {needDetail ? (
                    <DetailSelect
                      className="w-full"
                      value={detailId}
                      kinds={account?.detail_kinds}
                      disabled={readonly}
                      allowClear
                      placeholder={account?.detail_mode === "required" && !partyId ? "تفصیلی (الزامی)" : "تفصیلی (پیش‌فرض: شخص)"}
                      onChange={(x) => { setDetailId(x); setDirty(true); }}
                    />
                  ) : null}
                </div>
              ) : (
                <div className="bk-f-ro">
                  {!partyId ? "حساب شخص" : kind === "receipt" ? "حساب‌های دریافتنی شخص" : "حساب‌های پرداختنی شخص"}
                </div>
              )}
            </Field>
          ) : null}
          <Field label="شرح">
            <Input.TextArea
              autoSize={{ minRows: 1, maxRows: 3 }}
              value={description}
              disabled={readonly}
              onChange={(e) => { setDescription(e.target.value); setDirty(true); }}
              placeholder="بابت…"
            />
          </Field>
        </div>

        {kind === "transfer" ? (
          <TransferForm lines={lines} setLines={setLines} readonly={readonly} />
        ) : (
          <LinesGrid kind={kind} lines={lines} setLines={setLines} readonly={readonly} hasParty={!!partyId} />
        )}

        {kind !== "transfer" ? (
          <div className="bk-foot">
            <div>
              <small>جمع {KIND_TITLE[kind]}</small>
              <b>
                {total.isZero() ? <span className="sf-zero">—</span> : <><Amt v={total.toString()} /> <span className="sf-unit">{unit}</span></>}
              </b>
            </div>
            {totals.fee.gt(0) ? (
              <>
                <div className="bk-foot-sm">
                  <small>کارمزد بانکی</small>
                  <b><Amt v={totals.fee.toString()} /></b>
                </div>
                <div className="bk-foot-sm">
                  <small>{kind === "receipt" ? "خالص پس از کارمزد" : "جمع با کارمزد"}</small>
                  <b><Amt v={net.toString()} /></b>
                </div>
              </>
            ) : null}
            {total.gt(0) ? <span className="bk-foot-w">{amountToWords(total, unit)}</span> : null}
          </div>
        ) : null}
      </section>

      {showAllocs ? (
        <div className="no-print">
          <Allocations
            kind={kind}
            partyId={partyId!}
            docId={doc?.id ?? null}
            total={total.toString()}
            value={allocs}
            onChange={(v) => { setAllocs(v); setDirty(true); }}
            readonly={readonly}
          />
        </div>
      ) : null}

      <PrintSlip
        kind={kind}
        no={doc?.no ?? null}
        date={date}
        partyName={partyName ?? balance.data?.party?.name ?? null}
        accountName={useAccount ? account?.label ?? null : null}
        description={description}
        lines={kind === "transfer" ? lines : lines.filter((l) => !isEmptyLine(l))}
      />
    </div>
  );
}
