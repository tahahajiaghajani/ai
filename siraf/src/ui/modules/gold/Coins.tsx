// «سکه‌ها»: the coin catalogue of the business by family — stock by count with its gold content,
// today's buy and sell price, the bubble over the gold on both bases, book value — with the kardex
// of each coin, editing, labels and adding the standard catalogue.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Drawer, Dropdown, Segmented, Table, Tooltip } from "antd";
import { CircleDollarSign, Coins as CoinsIcon, Ellipsis, Gem, ListPlus, Pencil, Plus, Printer, ScrollText, Weight } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, JDate, Money, StatCard } from "../../components/display";
import { ToggleChip } from "../../components/inputs";
import { D } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { FAMILY_TITLES, PRICING_MODE_TITLES, STANDARD_CATALOGUE, variantChips } from "@shared/gold-catalogue";
import { gw, KINDS, KIND_PATH, SplitButton, useCatalogue, type CatalogueRow, type DocKind } from "./shared";
import { ProductForm } from "./ProductForm";
import { PrintLabelsModal, coinLabel, type LabelItem } from "./Labels";
import { useNavigate } from "react-router";

/** A bubble percent with its sign; the world basis in the tooltip. */
export function BubbleCell({ b }: { b: CatalogueRow["bubble"] }) {
  if (!b?.domestic) return <span className="sf-zero">—</span>;
  const tip = (
    <div className="grid gap-1 text-[12px]">
      <span>حباب نسبت به طلای داخل: <span className="sf-num">{formatNumber(b.domestic, { dp: 2 })}٪</span> (<span className="sf-num">{formatNumber(b.domestic_amount ?? 0)}</span>)</span>
      {b.world ? <span>نسبت به انس جهانی: <span className="sf-num">{formatNumber(b.world, { dp: 2 })}٪</span></span> : null}
    </div>
  );
  return (
    <Tooltip title={tip}>
      <span className="sf-num">{formatNumber(b.domestic, { dp: 2 })}٪</span>
    </Tooltip>
  );
}

export default function Coins() {
  const { api, orgId, can } = useOrg();
  const nav = useNavigate();
  const cat = useCatalogue("coin");
  const [family, setFamily] = useState<string>("all");
  const [held, setHeld] = useState(false);
  const [editing, setEditing] = useState<CatalogueRow | null | undefined>(undefined);
  const [kardex, setKardex] = useState<CatalogueRow | null>(null);
  const [labels, setLabels] = useState<LabelItem[] | null>(null);
  const seed = useAction(() => api.post<{ added: number }>("/gold/catalogue/seed"), {
    success: (r) => (r.added ? `${faDigits(r.added)} سکه و شمش استاندارد افزوده شد` : "همه‌ی سکه‌ها و شمش‌های استاندارد موجود است"),
    invalidate: [["gold-catalogue"], ["gold-coins"]],
  });
  const all = cat.data?.rows ?? [];
  const keys = new Set(all.map((r) => r.rate_key));
  const missing = STANDARD_CATALOGUE.filter((e) => e.kind === "coin" && !keys.has(e.key)).length;
  const rows = useMemo(
    () => all.filter((r) => (family === "all" || r.gold_meta.family === family) && (held ? D(r.qty).gt(0) : r.is_active || D(r.qty).gt(0))),
    [all, family, held],
  );
  const total = (f: (r: CatalogueRow) => string | null) => rows.reduce((a, r) => a.plus(D(f(r) ?? 0)), D(0));
  const families = [...new Set(all.map((r) => r.gold_meta.family ?? "other"))];
  const doc = (kind: DocKind) => nav(`/${orgId}/${KIND_PATH[kind]}/new`);
  return (
    <div>
      <PageHeader
        title="سکه‌ها"
        actions={
          can("gold", "edit") ? (
            <SplitButton
              type="primary"
              icon={<Ic icon={Plus} />}
              onClick={() => doc("purchase")}
              items={[
                { key: "buyback", label: KINDS.buyback.title, onClick: () => doc("buyback") },
                { key: "opening", label: "موجودی اول دوره", onClick: () => doc("opening") },
                ...(can("gold", "full") ? [{ type: "divider" as const }, { key: "new", icon: <Ic icon={CoinsIcon} />, label: "تعریف سکه‌ی جدید", onClick: () => setEditing(null) }] : []),
                ...(can("gold", "full") && missing ? [{ key: "seed", icon: <Ic icon={ListPlus} />, label: `افزودن ${faDigits(missing)} سکه‌ی استاندارد`, onClick: () => seed.mutate(undefined) }] : []),
              ]}
            >
              خرید سکه
            </SplitButton>
          ) : null
        }
      />
      <div className="mb-4 grid sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="تعداد سکه" icon={<Ic icon={CoinsIcon} />} value={<span className="sf-num">{formatNumber(total((r) => r.qty))}</span>} />
        <StatCard title="طلای خالص" icon={<Ic icon={Weight} />} value={<span className="sf-num">{gw(total((r) => r.pure))}</span>} hint={<>معادل ۷۵۰: <span className="sf-num">{gw(total((r) => r.weight750))}</span></>} />
        <StatCard
          title="ارزش به قیمت خرید امروز"
          icon={<Ic icon={CircleDollarSign} />}
          value={rows.some((r) => r.buy_value && D(r.qty).gt(0)) ? <Money v={total((r) => r.buy_value)} /> : <span className="sf-zero">—</span>}
          hint={<>به قیمت فروش: <Money v={total((r) => r.sell_value)} /></>}
        />
        <StatCard title="بهای دفتری" icon={<Ic icon={Gem} />} value={<Money v={total((r) => r.value)} />} />
      </div>
      <div className="sf-filters">
        <Segmented value={family} onChange={(v) => setFamily(String(v))} options={[{ value: "all", label: "همه" }, ...families.map((f) => ({ value: f, label: FAMILY_TITLES[f] ?? f }))]} />
        <ToggleChip on={held} onChange={setHeld}>فقط موجودها</ToggleChip>
      </div>
      <div className="sf-card">
        {!cat.isLoading && !all.length ? (
          <EmptyState
            title="هنوز سکه‌ای تعریف نشده است."
            action={can("gold", "full") ? <Button type="primary" icon={<Ic icon={ListPlus} />} loading={seed.isPending} onClick={() => seed.mutate(undefined)}>افزودن سکه‌های استاندارد</Button> : undefined}
          />
        ) : (
          <Table
            size="small"
            rowKey="id"
            loading={cat.isLoading}
            dataSource={rows}
            pagination={false}
            scroll={{ x: "max-content" }}
            rowClassName={(r) => (!r.is_active ? "row-muted" : "")}
            onRow={(r) => ({ onDoubleClick: () => setKardex(r) })}
            columns={[
              {
                key: "name", title: "سکه", render: (_, r) => (
                  <div className="leading-5">
                    <div>{r.name}</div>
                    <div className="flex flex-wrap gap-1 pt-0.5">{variantChips(r.gold_meta).map((c) => <Chip key={c} dot={false}>{c}</Chip>)}</div>
                  </div>
                ),
              },
              { key: "qty", dataIndex: "qty", title: "موجودی", className: "sf-num", render: (v) => (D(v).isZero() ? <span className="sf-zero">—</span> : <span className="sf-num">{formatNumber(v)}</span>) },
              { key: "sell", dataIndex: "sell", title: "فروش امروز", className: "sf-num", render: (v) => <Money v={v ?? 0} zero="—" /> },
              { key: "buy", dataIndex: "buy", title: "خرید امروز", className: "sf-num", render: (v) => <Money v={v ?? 0} zero="—" /> },
              { key: "bub", title: "حباب", className: "sf-num", render: (_, r) => <BubbleCell b={r.bubble} /> },
              { key: "pure", dataIndex: "pure", title: "طلای خالص", className: "sf-num", render: (v) => (D(v).isZero() ? <span className="sf-zero">—</span> : <span className="sf-num">{gw(v)}</span>) },
              { key: "w", dataIndex: "gold_weight", title: "وزن", className: "sf-num", render: (v) => <span className="sf-num">{gw(v ?? 0)}</span> },
              { key: "f", dataIndex: "fineness", title: "عیار", className: "sf-num", render: (v) => <span className="sf-num">{faDigits(D(v ?? 0).toString())}</span> },
              { key: "avg", dataIndex: "avg_cost", title: "میانگین بها", className: "sf-num", render: (v) => <Money v={v ?? 0} zero="—" /> },
              { key: "fam", title: "خانواده", render: (_, r) => <span className="text-ink-2">{FAMILY_TITLES[r.gold_meta.family ?? "other"]}</span> },
              { key: "mode", title: "قیمت", render: (_, r) => <span className="text-[13px] text-ink-3">{PRICING_MODE_TITLES[r.gold_meta.pricing_mode ?? "board"]}</span> },
              {
                key: "act", width: 44, fixed: "end" as const, render: (_, r) => (
                  <span className="sf-row-act" onClick={(e) => e.stopPropagation()}>
                    <Dropdown
                      trigger={["click"]}
                      menu={{
                        items: [
                          { key: "k", icon: <Ic icon={ScrollText} />, label: "کاردکس", onClick: () => setKardex(r) },
                          ...(can("gold", "full") ? [{ key: "e", icon: <Ic icon={Pencil} />, label: "ویرایش", onClick: () => setEditing(r) }] : []),
                          { key: "p", icon: <Ic icon={Printer} />, label: "چاپ برچسب", onClick: () => setLabels([coinLabel(r)]) },
                        ],
                      }}
                    >
                      <Button type="text" size="small" icon={<Ic icon={Ellipsis} />} aria-label="عملیات" />
                    </Dropdown>
                  </span>
                ),
              },
            ]}
          />
        )}
      </div>
      {editing !== undefined ? <ProductForm kind="coin" product={editing} open onClose={() => setEditing(undefined)} /> : null}
      <Kardex coin={kardex} onClose={() => setKardex(null)} />
      <PrintLabelsModal open={!!labels} onClose={() => setLabels(null)} items={labels ?? []} />
    </div>
  );
}

function Kardex({ coin, onClose }: { coin: CatalogueRow | null; onClose: () => void }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["gold-kardex", orgId, coin?.id], enabled: !!coin, queryFn: () => api.get<{ rows: any[]; balance: { qty: string; value: string } }>(`/gold/coins/${coin!.id}/kardex`) });
  return (
    <Drawer open={!!coin} onClose={onClose} size={760} title={coin ? `کاردکس ${coin.name}` : ""} destroyOnHidden>
      {q.data && !q.data.rows.length ? <EmptyState compact title="این سکه هنوز گردشی ندارد." /> : (
        <Table
          size="small"
          rowKey={(r: any) => `${r.doc_id}-${r.date}-${r.qty}`}
          loading={q.isLoading}
          dataSource={q.data?.rows ?? []}
          pagination={false}
          onRow={(r: any) => ({ onClick: () => nav(`/${orgId}/gold/docs/${r.doc_id}`), className: "cursor-pointer" })}
          columns={[
            { key: "d", dataIndex: "date", title: "تاریخ", render: (v) => <JDate v={v} /> },
            { key: "k", title: "سند", render: (_, r: any) => <span>{KINDS[r.kind as DocKind]?.title ?? r.kind} <span className="sf-num">{faDigits(r.no)}</span></span> },
            { key: "p", dataIndex: "party_name", title: "طرف حساب", render: (v) => <span className="text-ink-2">{v ?? "—"}</span> },
            { key: "in", title: "ورود", className: "sf-num", render: (_, r: any) => (D(r.qty).gt(0) ? <span className="sf-num">{formatNumber(r.qty)}</span> : null) },
            { key: "out", title: "خروج", className: "sf-num", render: (_, r: any) => (D(r.qty).lt(0) ? <span className="sf-num">{formatNumber(D(r.qty).abs())}</span> : null) },
            { key: "u", dataIndex: "unit_cost", title: "بهای واحد", className: "sf-num", render: (v) => <Money v={D(v).toDecimalPlaces(0).toString()} /> },
            { key: "b", dataIndex: "balance_qty", title: "مانده", className: "sf-num", render: (v) => <span className="sf-num">{formatNumber(v)}</span> },
            { key: "bv", dataIndex: "balance_value", title: "ارزش مانده", className: "sf-num", render: (v) => <Money v={v} /> },
          ]}
        />
      )}
    </Drawer>
  );
}
