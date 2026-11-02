// Crypto wallets: live on-chain balance next to the book balance and the difference, recent
// transactions, refresh one or all, and the usual create/edit/delete of the wallet entity.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Drawer, Dropdown, Table, Tooltip } from "antd";
import { Copy, Ellipsis, Link, Pencil, Plus, RefreshCw, Trash2, TriangleAlert, WalletCards } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { EntityForm } from "../../components/data";
import { Chip, EmptyState, Money, StatCard } from "../../components/display";
import { ENTITIES, CHAINS } from "@shared/entities";
import { D } from "@shared/money";
import { faDigits, formatNumber, maskMiddle } from "@shared/format";
import { formatJalaliDateTime } from "@shared/jalali";
import { ago, CurrencyChip, EXPLORER, FxAmount } from "./shared";

interface WalletRow {
  id: string;
  name: string;
  chain: string;
  address: string;
  kind: string;
  currency_id: string;
  currency_code: string;
  currency_decimals: number;
  owner_name: string | null;
  last_balance: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  auto_check: boolean;
  book_balance: string;
  book_value: string;
  difference: string | null;
}

const KIND_FA: Record<string, string> = { hot: "داغ", cold: "سرد", exchange: "اکسچنج", customer: "مشتری" };

export default function Wallets() {
  const { api, can } = useOrg();
  const qc = useQueryClient();
  const n = useNotify();
  const [editing, setEditing] = useState<Record<string, any> | null | undefined>(undefined);
  const [txs, setTxs] = useState<Record<string, any[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["fx-wallets"], queryFn: () => api.get<{ rows: WalletRow[] }>("/fx/wallets") });
  const rows = q.data?.rows ?? [];

  const refreshOne = async (w: WalletRow) => {
    setBusy(w.id);
    try {
      const r = await api.post(`/fx/wallets/${w.id}/refresh`);
      if (r.error) n.warn(`${w.name}: ${r.error}`);
      else n.ok(`${w.name}: ${r.message}`);
      setTxs((m) => ({ ...m, [w.id]: r.txs ?? [] }));
      qc.invalidateQueries({ queryKey: ["fx-wallets"] });
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(null);
    }
  };
  const all = useAction(() => api.post("/fx/wallets/refresh-all"), {
    invalidate: [["fx-wallets"], ["fx-summary"]],
    onSuccess: (r: any) => (r.failed ? n.warn(`${faDigits(r.checked)} کیف‌پول بررسی شد؛ ${faDigits(r.failed)} مورد پاسخ نداد`) : n.ok(`${faDigits(r.checked)} کیف‌پول بررسی شد`)),
  });
  const del = useAction((id: string) => api.del(`/data/wallet/${id}`), { success: "کیف‌پول حذف شد", invalidate: [["fx-wallets"], ["options", "wallet"]] });

  // totals per asset (our wallets only)
  const totals = useMemo(() => {
    const m = new Map<string, { code: string; dp: number; live: ReturnType<typeof D>; book: ReturnType<typeof D>; value: ReturnType<typeof D>; unchecked: number }>();
    for (const w of rows.filter((x) => x.kind !== "customer")) {
      const t = m.get(w.currency_id) ?? { code: w.currency_code, dp: Number(w.currency_decimals ?? 8), live: D(0), book: D(0), value: D(0), unchecked: 0 };
      if (w.last_balance === null) t.unchecked += 1;
      t.live = t.live.plus(D(w.last_balance ?? 0));
      t.book = t.book.plus(D(w.book_balance));
      t.value = t.value.plus(D(w.book_value));
      m.set(w.currency_id, t);
    }
    return [...m.values()];
  }, [rows]);

  return (
    <div>
      <PageHeader
        title="کیف‌پول‌های رمزارز"
        actions={
          <>
            <Button icon={<Ic icon={RefreshCw} className={all.isPending ? "sf-spin" : undefined} />} loading={all.isPending} onClick={() => all.mutate(undefined)} disabled={!rows.length}>
              بررسی موجودی همه
            </Button>
            {can("fx", "edit") ? <Button type="primary" icon={<Ic icon={Plus} />} onClick={() => setEditing(null)}>کیف‌پول جدید</Button> : null}
          </>
        }
      />
      {totals.length ? (
        <div className="mb-4 grid sm:grid-cols-2 xl:grid-cols-4">
          {totals.map((t) => {
            const diff = t.live.minus(t.book);
            return (
              <StatCard
                key={t.code}
                icon={<span className="sf-cur-av is-sm">{t.code.slice(0, 4)}</span>}
                title="موجودی زنده"
                value={<FxAmount v={t.live.toFixed()} code={t.code} dp={t.dp} />}
                hint={
                  diff.isZero() ? (
                    <span className="inline-flex flex-wrap items-center gap-1">دفتری <FxAmount v={t.book.toFixed()} dp={t.dp} /><span className="sf-sep" aria-hidden />تطبیق دارد</span>
                  ) : (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <Chip tone="warning" fig>اختلاف <bdi dir="ltr">{formatNumber(diff, { dp: t.dp, fa: false })}</bdi></Chip>
                      {t.unchecked ? <span><span className="sf-num">{faDigits(t.unchecked)}</span> بررسی‌نشده</span> : null}
                    </span>
                  )
                }
              />
            );
          })}
        </div>
      ) : null}
      <div className="sf-card">
        <Table<WalletRow>
          className=""
          size="small"
          rowKey="id"
          loading={q.isLoading}
          dataSource={rows}
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: <EmptyState icon={WalletCards} title="هنوز کیف‌پولی ثبت نشده است" action={can("fx", "edit") ? <Button type="primary" onClick={() => setEditing(null)}>ثبت کیف‌پول</Button> : null} /> }}
          expandable={{
            expandedRowRender: (w) => <TxList w={w} txs={txs[w.id]} onLoad={() => refreshOne(w)} loading={busy === w.id} />,
            rowExpandable: (w) => ["BTC", "LTC", "TRON"].includes(w.chain),
          }}
          columns={[
            {
              key: "name",
              title: "کیف‌پول",
              render: (_, w) => (
                <div className="leading-5">
                  <span className="font-medium">{w.name}</span> <span className="text-[12px] text-ink-3">{KIND_FA[w.kind] ?? w.kind}</span>
                  {w.owner_name ? <div className="text-[12px] text-ink-3">صاحب: {w.owner_name}</div> : null}
                </div>
              ),
            },
            { key: "asset", title: "دارایی", render: (_, w) => <span className="flex items-center gap-2"><CurrencyChip c={{ code: w.currency_code, kind: "crypto" }} /><bdi dir="ltr" className="sf-latin text-[12px] text-ink-3">{CHAINS.find((c) => c.value === w.chain)?.label ?? w.chain}</bdi></span> },
            {
              key: "address",
              title: "نشانی",
              render: (_, w) => (
                <span className="flex items-center gap-1">
                  <bdi dir="ltr" className="sf-mono">{maskMiddle(w.address, 6)}</bdi>
                  <Tooltip title="رونوشت نشانی"><Button size="small" type="text" icon={<Ic icon={Copy} size={14} />} onClick={() => navigator.clipboard?.writeText(w.address).then(() => n.note("رونوشت شد."))} aria-label="رونوشت نشانی" /></Tooltip>
                  {EXPLORER[w.chain] ? <Tooltip title="مشاهده در کاوشگر"><Button size="small" type="text" icon={<Ic icon={Link} size={14} />} aria-label="مشاهده در کاوشگر" href={`${EXPLORER[w.chain].address}${w.address}`} target="_blank" /></Tooltip> : null}
                </span>
              ),
            },
            {
              key: "live",
              title: "موجودی زنده",
              className: "sf-num",
              render: (_, w) =>
                w.last_error ? (
                  <Tooltip title={`${w.last_error} — ${formatJalaliDateTime(w.last_checked_at)}`}>
                    <span className="inline-flex items-center gap-1.5 text-[13px] text-danger"><Ic icon={TriangleAlert} size={14} />{w.last_balance !== null ? <FxAmount v={w.last_balance} code={w.currency_code} dp={w.currency_decimals} /> : "بی‌پاسخ"}</span>
                  </Tooltip>
                ) : w.last_balance !== null ? (
                  <Tooltip title={formatJalaliDateTime(w.last_checked_at)}>
                    <span className="leading-5"><FxAmount v={w.last_balance} code={w.currency_code} dp={w.currency_decimals} strong /><span className="flex items-center gap-1.5 text-[12px] text-ink-3"><i className="sf-dot !h-[5px] !w-[5px] text-in" aria-hidden />{ago(w.last_checked_at)}</span></span>
                  </Tooltip>
                ) : (
                  <span className="text-[13px] text-ink-3">بررسی‌نشده</span>
                ),
            },
            { key: "book", title: "موجودی دفتری", className: "sf-num", render: (_, w) => (w.kind === "customer" ? <span className="sf-zero">—</span> : <span className="leading-5"><FxAmount v={w.book_balance} code={w.currency_code} dp={w.currency_decimals} /><span className="block text-[12px] text-ink-3"><Money v={w.book_value} unit /></span></span>) },
            {
              key: "diff",
              title: "اختلاف",
              className: "sf-num",
              render: (_, w) =>
                w.kind === "customer" || w.difference === null ? <span className="sf-zero">—</span> : D(w.difference).isZero() ? <span className="text-[13px] text-in">تطبیق</span> : <Chip tone="warning" fig><bdi dir="ltr">{formatNumber(D(w.difference), { dp: Number(w.currency_decimals ?? 8), fa: false, sign: true })}</bdi></Chip>,
            },
            {
              key: "act",
              width: 90,
              render: (_, w) => (
                <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="بررسی موجودی"><Button size="small" type="text" icon={<Ic icon={RefreshCw} className={busy === w.id ? "sf-spin" : undefined} />} onClick={() => refreshOne(w)} /></Tooltip>
                  {can("fx", "edit") ? (
                    <Dropdown
                      trigger={["click"]}
                      menu={{
                        items: [
                          { key: "edit", icon: <Ic icon={Pencil} />, label: "ویرایش", onClick: () => setEditing(w) },
                          ...(can("fx", "full") ? [{ key: "del", icon: <Ic icon={Trash2} />, danger: true, label: "حذف", onClick: async () => { if (await n.confirm(`حذف «${w.name}»؟`, "اگر گردش حسابداری داشته باشد حذف نمی‌شود.", true)) del.mutate(w.id); } }] : []),
                        ],
                      }}
                    >
                      <Button size="small" type="text" icon={<Ic icon={Ellipsis} />} aria-label="عملیات" />
                    </Dropdown>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      </div>
      <Drawer open={editing !== undefined} onClose={() => setEditing(undefined)} size={720} title={editing?.id ? "ویرایش کیف‌پول" : "کیف‌پول جدید"} destroyOnHidden styles={{ body: { paddingBottom: 0 } }}>
        {editing !== undefined ? (
          <EntityForm
            def={ENTITIES.wallet}
            initial={editing}
            onSaved={() => { setEditing(undefined); qc.invalidateQueries({ queryKey: ["fx-wallets"] }); }}
            onCancel={() => setEditing(undefined)}
          />
        ) : null}
      </Drawer>
    </div>
  );
}

function TxList({ w, txs, onLoad, loading }: { w: WalletRow; txs?: any[]; onLoad: () => void; loading: boolean }) {
  if (!txs) {
    return (
      <div className="py-3 text-center">
        <Button size="small" icon={<Ic icon={RefreshCw} className={loading ? "sf-spin" : undefined} />} onClick={onLoad}>نمایش آخرین تراکنش‌ها</Button>
      </div>
    );
  }
  if (!txs.length) return <div className="py-3 text-center text-[13px] text-ink-3">تراکنشی پیدا نشد.</div>;
  return (
    <div className="grid gap-1 py-1">
      {txs.map((t) => (
        <div key={t.hash} className="flex flex-wrap items-center gap-4 text-[13px]">
          <span className="w-36"><FxAmount v={t.amount} code={w.currency_code} dp={w.currency_decimals} colored /></span>
          <span className="sf-num text-ink-3">{t.time ? formatJalaliDateTime(t.time) : "در صف تأیید"}</span>
          {!t.confirmed ? <Chip tone="warning">تأییدنشده</Chip> : null}
          <a className="sf-mono sf-link" href={EXPLORER[w.chain] ? `${EXPLORER[w.chain].tx}${t.hash}` : undefined} target="_blank" rel="noreferrer">{maskMiddle(t.hash, 8)}</a>
          {t.counterparty ? <bdi dir="ltr" className="sf-mono text-ink-3">{maskMiddle(t.counterparty, 6)}</bdi> : null}
        </div>
      ))}
    </div>
  );
}
