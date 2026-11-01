// Receipt / payment / transfer editor. Header (date, party or counter account, description), the
// lines grid (or the transfer form), allocations to invoices, totals with the amount in words and
// an A5 slip to print. F2 saves, Alt+F2 saves and starts a new one.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Dropdown, Input, Spin, Switch, Tag, Tooltip } from "antd";
import { DeleteOutlined, FileTextOutlined, MoreOutlined, PlusOutlined, PrinterOutlined, SaveOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { useHotkey, useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { AccountSelect, DateInput, DetailSelect, PartySelect, type Opt } from "../../components/inputs";
import { Balance, JDateTime, Money } from "../../components/display";
import { faDigits } from "@shared/format";
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
  if (!isNew && q.isLoading) return <div className="grid h-64 place-content-center"><Spin /></div>;
  if (!isNew && (q.error || !q.data)) return <Alert type="error" showIcon title={q.error ? errorText(q.error) : "سند پیدا نشد"} />;
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
        setDescription((d) => d || `بابت فاکتور شماره‌ی ${faDigits(inv.no)}`);
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
      n.ok(`${KIND_TITLE[kind]} شماره‌ی ${faDigits(r.doc.no)} ثبت شد`);
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
  useHotkey("alt+f2", () => saveRef.current("new"), []);

  const remove = async () => {
    if (!doc) return;
    if (!(await n.confirm(`حذف ${KIND_TITLE[kind]} شماره‌ی ${faDigits(doc.no)}؟`, "سند حسابداری و چک‌های ثبت‌شده در این سند هم حذف می‌شوند.", true))) return;
    try {
      await api.del(`/treasury/docs/${doc.id}`);
      n.ok("سند حذف شد");
      for (const key of [["table"], ["treasury-summary"], ["treasury-balances"], ["treasury-cheques"], ["dashboard"], ["goods-invoice"], ["goods-party"]]) qc.invalidateQueries({ queryKey: key });
      nav(`/${orgId}/${KIND_PATH[kind]}`);
    } catch (e) {
      n.error(e);
    }
  };

  const title = doc ? `${KIND_TITLE[kind]} شماره‌ی ${faDigits(doc.no)}` : `${KIND_TITLE[kind]} جدید`;
  const pb = balance.data;
  const needDetail = useAccount && account && account.detail_mode && account.detail_mode !== "none";

  return (
    <div>
      <PageHeader
        back={`/${orgId}/${KIND_PATH[kind]}`}
        title={title}
        subtitle={
          doc ? (
            <>
              ثبت: <JDateTime v={doc.created_at} />
              {doc.created_by_name ? ` · ${doc.created_by_name}` : ""}
            </>
          ) : (
            "Enter: خانه‌ی بعد · F2: ثبت · Alt+F2: ثبت و سند جدید"
          )
        }
        extra={
          doc?.voucher_id && can("accounting", "view") ? (
            <Link to={`/${orgId}/accounting/vouchers/${doc.voucher_id}`}>
              <Tag variant="filled" color="purple" className="!m-0 cursor-pointer">
                <FileTextOutlined /> سند حسابداری {doc.voucher_no ? faDigits(doc.voucher_no) : ""}
              </Tag>
            </Link>
          ) : null
        }
        actions={
          <>
            {!readonly ? (
              <>
                <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => save("stay")}>
                  ثبت <span className="tz-kbd ltr ms-1 !bg-transparent !text-white/80">F2</span>
                </Button>
                <Tooltip title="Alt+F2">
                  <Button icon={<PlusOutlined />} disabled={saving} onClick={() => save("new")}>
                    ثبت و جدید
                  </Button>
                </Tooltip>
              </>
            ) : null}
            <Button icon={<PrinterOutlined />} onClick={() => (doc && !dirty ? window.print() : readonly ? window.print() : save("print"))}>
              {doc && !dirty ? "چاپ رسید" : readonly ? "چاپ" : "ثبت و چاپ"}
            </Button>
            {doc ? (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    { key: "new", icon: <PlusOutlined />, label: `${KIND_TITLE[kind]} جدید`, onClick: () => nav(`/${orgId}/treasury/docs/new?kind=${kind}&n=${Date.now()}`) },
                    ...(can("treasury", "full") && !closed ? [{ key: "del", icon: <DeleteOutlined />, danger: true, label: "حذف سند", onClick: remove }] : []),
                  ],
                }}
              >
                <Button icon={<MoreOutlined />} aria-label="بیشتر" />
              </Dropdown>
            ) : null}
          </>
        }
      />

      {closed ? <Alert className="!mb-4" type="warning" showIcon title="سال مالی این سند بسته شده است و سند فقط قابل مشاهده است." /> : null}

      <div className="no-print tz-card p-4">
        <div className={`mb-4 grid gap-3 ${kind === "transfer" ? "md:grid-cols-[160px_1fr]" : "md:grid-cols-[160px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]"}`}>
          <div>
            <div className="mb-1 text-xs text-muted">تاریخ</div>
            <DateInput value={date} onChange={(v) => { setDate(v); setDirty(true); }} disabled={readonly} />
          </div>
          {kind !== "transfer" ? (
            <div>
              <div className="mb-1 flex items-center text-xs text-muted">
                {kind === "receipt" ? "دریافت از" : "پرداخت به"}
                {pb && partyId ? (
                  <span className="ms-auto">
                    مانده‌ی حساب: <Balance v={pb.balance} />
                  </span>
                ) : null}
              </div>
              <PartySelect
                className="w-full"
                value={partyId}
                disabled={readonly}
                allowClear
                autoFocus={!doc}
                onChange={(id, o) => {
                  setPartyId(id);
                  setPartyName(o?.label ?? null);
                  setAllocs({});
                  setDirty(true);
                }}
              />
              {pb && partyId && (pb.cheques.received_open.count || pb.cheques.bounced.count || pb.cheques.issued_open.count) ? (
                <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                  {pb.cheques.received_open.count ? (
                    <Tag variant="filled" color="cyan" className="!m-0">
                      چک دریافتی جاری: {faDigits(pb.cheques.received_open.count)} · <Money v={pb.cheques.received_open.sum} />
                    </Tag>
                  ) : null}
                  {pb.cheques.bounced.count ? (
                    <Tag variant="filled" color="error" className="!m-0">
                      چک برگشتی: {faDigits(pb.cheques.bounced.count)} · <Money v={pb.cheques.bounced.sum} />
                    </Tag>
                  ) : null}
                  {pb.cheques.issued_open.count ? (
                    <Tag variant="filled" color="gold" className="!m-0">
                      چک پرداختی جاری: {faDigits(pb.cheques.issued_open.count)} · <Money v={pb.cheques.issued_open.sum} />
                    </Tag>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {kind !== "transfer" ? (
            <div>
              <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                <Switch size="small" checked={useAccount} disabled={readonly} onChange={(v) => { setUseAccount(v); setDirty(true); }} />
                ثبت در حساب دیگر (به جای حساب شخص)
              </div>
              {useAccount ? (
                <div className="grid gap-1">
                  <AccountSelect
                    className="w-full"
                    value={account?.id ?? null}
                    disabled={readonly}
                    placeholder={kind === "receipt" ? "مثلاً درآمد متفرقه، پیش‌دریافت…" : "مثلاً اجاره، هزینه‌های متفرقه…"}
                    onChange={(id, o) => {
                      setAccount(id ? o ?? { id, label: "" } : null);
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
                      onChange={(v) => { setDetailId(v); setDirty(true); }}
                    />
                  ) : null}
                </div>
              ) : (
                <div className="tz-soft px-3 py-1.5 text-xs text-muted">
                  {!partyId
                    ? "شخص را انتخاب کنید یا حساب دیگری (مثلاً درآمد یا هزینه) را برگزینید"
                    : kind === "receipt"
                      ? "از طلب ما از این شخص کم می‌شود (حساب‌های دریافتنی)"
                      : "از بدهی ما به این شخص کم می‌شود (حساب‌های پرداختنی)"}
                </div>
              )}
            </div>
          ) : null}
          <div>
            <div className="mb-1 text-xs text-muted">شرح</div>
            <Input.TextArea
              autoSize={{ minRows: 1, maxRows: 3 }}
              value={description}
              disabled={readonly}
              onChange={(e) => { setDescription(e.target.value); setDirty(true); }}
              placeholder="بابت…"
            />
          </div>
        </div>

        {kind === "transfer" ? (
          <TransferForm lines={lines} setLines={setLines} readonly={readonly} />
        ) : (
          <LinesGrid kind={kind} lines={lines} setLines={setLines} readonly={readonly} hasParty={!!partyId} />
        )}

        {kind !== "transfer" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <span className="text-sm text-muted">جمع {KIND_TITLE[kind]}:</span>
            <span className="text-lg font-bold">
              <Money v={total.toString()} unit />
            </span>
            {total.gt(0) ? <span className="text-xs text-muted">{amountToWords(total, unit)}</span> : null}
          </div>
        ) : null}
      </div>

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
