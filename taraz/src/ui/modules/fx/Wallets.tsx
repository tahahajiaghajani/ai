// Crypto wallets: live on-chain balance next to the book balance and the difference, recent
// transactions, refresh one or all, and the usual create/edit/delete of the wallet entity.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Drawer, Dropdown, Table, Tag, Tooltip } from "antd";
import { PlusOutlined, SyncOutlined, EditOutlined, DeleteOutlined, MoreOutlined, CopyOutlined, LinkOutlined, CheckCircleOutlined, WarningOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { EntityForm } from "../../components/data";
import { EmptyState, Money, StatCard } from "../../components/display";
import { ENTITIES, CHAINS } from "@shared/entities";
import { D } from "@shared/money";
import { faDigits, maskMiddle } from "@shared/format";
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
            <Button icon={<SyncOutlined spin={all.isPending} />} loading={all.isPending} onClick={() => all.mutate(undefined)} disabled={!rows.length}>
              بررسی موجودی همه
            </Button>
            {can("fx", "edit") ? <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>کیف‌پول جدید</Button> : null}
          </>
        }
      />
      {totals.length ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {totals.map((t) => {
            const diff = t.live.minus(t.book);
            return (
              <StatCard
                key={t.code}
                title={<span className="flex items-center gap-1.5"><CurrencyChip c={{ code: t.code, kind: "crypto" }} /> موجودی زنده / دفتری</span>}
                value={<span><FxAmount v={t.live.toFixed()} dp={t.dp} /> <span className="text-xs text-muted">/ <FxAmount v={t.book.toFixed()} dp={t.dp} /></span></span>}
                hint={diff.isZero() ? <>تطبیق دارد · ارزش دفتری <Money v={t.value.toFixed()} /></> : <span className="text-warn">اختلاف <FxAmount v={diff.toFixed()} dp={t.dp} />{t.unchecked ? ` · ${faDigits(t.unchecked)} بررسی‌نشده` : ""}</span>}
                tone={diff.isZero() ? "ok" : "gold"}
              />
            );
          })}
        </div>
      ) : null}
      <div className="tz-card p-3 md:p-4">
        <Table<WalletRow>
          className="tz-table"
          size="small"
          rowKey="id"
          loading={q.isLoading}
          dataSource={rows}
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: <EmptyState title="هنوز کیف‌پولی ثبت نشده است" action={can("fx", "edit") ? <Button type="primary" onClick={() => setEditing(null)}>ثبت کیف‌پول</Button> : null} /> }}
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
                  <b>{w.name}</b> <Tag variant="filled" className="!m-0 !text-[10px]">{KIND_FA[w.kind] ?? w.kind}</Tag>
                  {w.owner_name ? <div className="text-[11px] text-muted">صاحب: {w.owner_name}</div> : null}
                </div>
              ),
            },
            { key: "asset", title: "دارایی", render: (_, w) => <span className="flex items-center gap-1"><CurrencyChip c={{ code: w.currency_code, kind: "crypto" }} /> <span className="ltr text-[11px] text-muted">{CHAINS.find((c) => c.value === w.chain)?.label ?? w.chain}</span></span> },
            {
              key: "address",
              title: "نشانی",
              render: (_, w) => (
                <span className="flex items-center gap-1">
                  <span className="ltr font-mono text-xs">{maskMiddle(w.address, 6)}</span>
                  <Tooltip title="کپی نشانی"><Button size="small" type="text" icon={<CopyOutlined />} onClick={() => navigator.clipboard?.writeText(w.address).then(() => n.ok("نشانی کپی شد"))} /></Tooltip>
                  {EXPLORER[w.chain] ? <Tooltip title="مشاهده در کاوشگر"><Button size="small" type="text" icon={<LinkOutlined />} href={`${EXPLORER[w.chain].address}${w.address}`} target="_blank" /></Tooltip> : null}
                </span>
              ),
            },
            {
              key: "live",
              title: "موجودی زنده",
              align: "left",
              render: (_, w) =>
                w.last_error ? (
                  <Tooltip title={`${w.last_error} — ${formatJalaliDateTime(w.last_checked_at)}`}>
                    <span className="text-xs text-bad"><WarningOutlined /> {w.last_balance !== null ? <FxAmount v={w.last_balance} dp={w.currency_decimals} /> : "خطا"}</span>
                  </Tooltip>
                ) : w.last_balance !== null ? (
                  <Tooltip title={formatJalaliDateTime(w.last_checked_at)}>
                    <span><FxAmount v={w.last_balance} dp={w.currency_decimals} strong /> <span className="block text-[10px] text-muted">{ago(w.last_checked_at)}</span></span>
                  </Tooltip>
                ) : (
                  <span className="text-xs text-muted">بررسی نشده</span>
                ),
            },
            { key: "book", title: "موجودی دفتری", align: "left", render: (_, w) => (w.kind === "customer" ? <span className="text-muted">—</span> : <span><FxAmount v={w.book_balance} dp={w.currency_decimals} /> <span className="block text-[10px] text-muted"><Money v={w.book_value} /></span></span>) },
            {
              key: "diff",
              title: "اختلاف",
              align: "left",
              render: (_, w) =>
                w.kind === "customer" || w.difference === null ? <span className="text-muted">—</span> : D(w.difference).isZero() ? <span className="text-xs text-ok"><CheckCircleOutlined /> تطبیق</span> : <FxAmount v={w.difference} dp={w.currency_decimals} colored />,
            },
            {
              key: "act",
              width: 90,
              render: (_, w) => (
                <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="بررسی موجودی"><Button size="small" type="text" icon={<SyncOutlined spin={busy === w.id} />} onClick={() => refreshOne(w)} /></Tooltip>
                  {can("fx", "edit") ? (
                    <Dropdown
                      trigger={["click"]}
                      menu={{
                        items: [
                          { key: "edit", icon: <EditOutlined />, label: "ویرایش", onClick: () => setEditing(w) },
                          ...(can("fx", "full") ? [{ key: "del", icon: <DeleteOutlined />, danger: true, label: "حذف", onClick: async () => { if (await n.confirm(`حذف «${w.name}»؟`, "اگر گردش حسابداری داشته باشد حذف نمی‌شود.", true)) del.mutate(w.id); } }] : []),
                        ],
                      }}
                    >
                      <Button size="small" type="text" icon={<MoreOutlined />} aria-label="عملیات" />
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
      <div className="py-2 text-center">
        <Button size="small" icon={<SyncOutlined spin={loading} />} onClick={onLoad}>نمایش آخرین تراکنش‌ها</Button>
      </div>
    );
  }
  if (!txs.length) return <div className="py-2 text-center text-xs text-muted">تراکنشی پیدا نشد</div>;
  return (
    <div className="grid gap-1 py-1">
      {txs.map((t) => (
        <div key={t.hash} className="flex flex-wrap items-center gap-3 text-xs">
          <span className={`w-28 ${D(t.amount).gt(0) ? "tz-pos" : "tz-neg"}`}><FxAmount v={t.amount} code={w.currency_code} dp={w.currency_decimals} /></span>
          <span className="num text-muted">{t.time ? formatJalaliDateTime(t.time) : "در صف تأیید"}</span>
          {!t.confirmed ? <Tag color="orange" variant="filled" className="!m-0">تأییدنشده</Tag> : null}
          <a className="ltr font-mono" href={EXPLORER[w.chain] ? `${EXPLORER[w.chain].tx}${t.hash}` : undefined} target="_blank" rel="noreferrer">{maskMiddle(t.hash, 8)}</a>
          {t.counterparty ? <span className="ltr font-mono text-muted">{maskMiddle(t.counterparty, 6)}</span> : null}
        </div>
      ))}
    </div>
  );
}
