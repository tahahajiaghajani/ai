// Small parts the portal's pages share: the page head (it names the page for the window title), a record's stage chip
// and row, a service tile with its favourite star, the empty state of a list, a section with its heading.
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Button, Tooltip } from "antd";
import { ArrowRight, Star } from "lucide-react";
import { usePageTitle } from "../../components/shell/context";
import { Chip, EmptyState } from "../../components/display";
import { formatJalali } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { iconOf } from "../request/icons";
import type { ItemLite, PortalTicketCard } from "./api";
import { ago, STAGE_CHIP, ticketPath, portalPath } from "./model";

export const I16 = { size: 16, strokeWidth: 1.5, absoluteStrokeWidth: true } as const;
export const I20 = { size: 20, strokeWidth: 1.5, absoluteStrokeWidth: true } as const;

export function PageHead({ title, sub, back, actions }: { title: string; sub?: ReactNode; back?: { to: string; label: string }; actions?: ReactNode }) {
  usePageTitle(title);
  return (
    <div>
      {back ? (
        <Link to={back.to} className="pt-back">
          <ArrowRight {...I16} />
          {back.label}
        </Link>
      ) : null}
      <div className="pt-page-h">
        <div>
          <h1>{title}</h1>
          {sub ? <p>{sub}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Section({ title, more, children, id }: { title: string; more?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="pt-section" aria-labelledby={id}>
      <div className="pt-section-h">
        <h2 id={id}>{title}</h2>
        {more}
      </div>
      {children}
    </section>
  );
}

export function StageChip({ card }: { card: Pick<PortalTicketCard, "stage" | "stage_label" | "state_label"> }) {
  return (
    <Chip tone={STAGE_CHIP[card.stage]} title={card.state_label}>
      {card.stage_label}
    </Chip>
  );
}

/** One record in a list: its kind and number, the title, the stage and how long ago it moved. */
export function TicketRow({ card, showFor }: { card: PortalTicketCard; showFor?: boolean }) {
  const { orgId } = useOrg();
  return (
    <Link to={ticketPath(orgId, card.table, card.id)} className="pt-row">
      <div className="pt-row-b">
        <span className="pt-row-t">{card.title || card.number}</span>
        <span className="pt-row-m">
          <span>{card.kind_label}</span>
          {card.number ? <bdi className="ltr">{card.number}</bdi> : null}
          {showFor && card.for_name ? <span>برای {card.for_name}</span> : null}
          {card.updated_at ? <span title={formatJalali(card.updated_at.slice(0, 10))}>{ago(card.updated_at)}</span> : null}
        </span>
      </div>
      <StageChip card={card} />
    </Link>
  );
}

/** A catalogue item as a tile; with `onFavorite`, a star toggles it among the person's favourites. */
export function ItemTile({ item, onFavorite }: { item: ItemLite; onFavorite?: (on: boolean) => void }) {
  const { orgId } = useOrg();
  const Icon = iconOf(item.icon);
  return (
    <div className="relative">
      <Link to={portalPath(orgId, `items/${item.id}`)} className="pt-tile">
        <span className="pt-tile-ic" aria-hidden>
          <Icon {...I20} />
        </span>
        <span className="pt-tile-b">
          <span className="pt-tile-t">{item.name}</span>
          {item.short_description ? <span className="pt-tile-d">{item.short_description}</span> : null}
          {item.promise ? <span className="pt-tile-m">{item.promise}</span> : null}
        </span>
      </Link>
      {onFavorite ? (
        <Tooltip title={item.favorite ? "برداشتن از برگزیده‌ها" : "افزودن به برگزیده‌ها"}>
          <Button
            className="pt-fav"
            size="small"
            type="text"
            aria-pressed={!!item.favorite}
            aria-label={item.favorite ? `برداشتن «${item.name}» از برگزیده‌ها` : `افزودن «${item.name}» به برگزیده‌ها`}
            icon={<Star {...I16} fill={item.favorite ? "currentColor" : "none"} />}
            onClick={() => onFavorite(!item.favorite)}
          />
        </Tooltip>
      ) : null}
    </div>
  );
}

export function Empty({ title, text, action, icon }: { title: string; text?: ReactNode; action?: ReactNode; icon?: Parameters<typeof EmptyState>[0]["icon"] }) {
  return <EmptyState compact title={title} description={text} action={action} icon={icon} primary />;
}
