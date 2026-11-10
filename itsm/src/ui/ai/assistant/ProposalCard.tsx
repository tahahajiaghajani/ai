// A draft the assistant prepared. Nothing is written until a permitted person confirms it here (the server re-checks
// the record's own permission, runs the module's normal service and records it in the audit log); «ویرایش در فرم»
// opens the same data in the module's own form instead. The card is drawn from the stored proposal, not from the
// model's words. A batch shows its count and a sample of rows; once applied, every row's result. An agent's proposal
// names the agent; someone who may see but not decide it (the inbox) gets the card without its buttons.
import { useState } from "react";
import { Button } from "antd";
import { UserPlus, FilePen, CircleCheck, TriangleAlert, ArrowUpLeft, Bot, Layers, type LucideIcon } from "lucide-react";
import type { AiProposal } from "@shared/ai/types";
import { useNotify } from "../../lib/hooks";
import { fa, jDayMonth, jTime } from "../../lib/fa";
import { Chip, type ChipTone } from "../../components/display";
import { Ic } from "../../components/shell/icons";
import { safePath } from "../markdown/links";
import { useAiClient } from "./useAi";

// icons of proposal kinds; the platform proposes nothing itself, modules add theirs (anything else shows a draft)
const KIND_ICON: Record<string, LucideIcon> = {
  member: UserPlus,
};

const STATUS: Record<AiProposal["status"], [string, ChipTone]> = {
  proposed: ["در انتظار تأیید", "warning"],
  executing: ["در حال ثبت", "neutral"],
  executed: ["ثبت شد", "in"],
  rejected: ["رد شد", "neutral"],
  expired: ["منقضی شد", "neutral"],
  failed: ["ثبت نشد", "danger"],
};

function until(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = jDayMonth(d) === jDayMonth(new Date());
  return sameDay ? `تا ساعت ${jTime(d)} امروز معتبر است` : `تا ${jDayMonth(d)}، ساعت ${jTime(d)} معتبر است`;
}

export function ProposalCard({
  proposal,
  onChange,
  onNavigate,
  canDecide = true,
}: {
  proposal: AiProposal;
  onChange: (p: AiProposal) => void;
  onNavigate: (path: string, state?: unknown) => void;
  /** false: shown to someone who may not apply or refuse it (no buttons) */
  canDecide?: boolean;
}) {
  const client = useAiClient();
  const n = useNotify();
  const [busy, setBusy] = useState<"confirm" | "reject" | null>(null);
  const expired = proposal.status === "proposed" && new Date(proposal.expires_at).getTime() < Date.now();
  const status: AiProposal["status"] = expired ? "expired" : proposal.status;
  const [label, tone] = STATUS[status] ?? STATUS.proposed;
  const Icon = KIND_ICON[proposal.kind] ?? FilePen;
  const edit = safePath(proposal.edit_path);
  const result = proposal.result ? safePath(proposal.result.path) : null;
  const open = status === "proposed";
  // a proposal on a record: only those who work the record (and, when it is routed, those it is routed to) decide it
  const decidable = canDecide && proposal.can_decide !== false;
  const outcome = proposal.outcome ?? null;

  const decide = async (what: "confirm" | "reject") => {
    if (busy) return;
    setBusy(what);
    try {
      const next = what === "confirm" ? await client.confirm(proposal.id) : await client.reject(proposal.id);
      const p = next ?? { ...proposal, status: what === "confirm" ? ("executed" as const) : ("rejected" as const) };
      onChange(p);
      if (what === "confirm") {
        const to = p.result ? safePath(p.result.path) : null;
        n.ok(p.status === "executed" ? "پیش‌نویس ثبت شد" : "درخواست ثبت فرستاده شد", to ? { action: { label: "باز کردن", onClick: () => onNavigate(to) } } : undefined);
      }
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={`sa-card sa-prop is-${status}`} aria-label={proposal.title_fa}>
      <header className="sa-prop-h">
        <span className="sa-prop-ic" aria-hidden>
          <Ic icon={Icon} />
        </span>
        <span className="sa-prop-t">{proposal.title_fa}</span>
        <Chip tone={tone}>{label}</Chip>
      </header>
      {proposal.agent || typeof proposal.count === "number" ? (
        <div className="sa-prop-tags">
          {proposal.agent ? (
            <span className="sa-prop-tag">
              <Ic icon={Bot} size={14} />
              عامل «{proposal.agent.name}»
            </span>
          ) : null}
          {typeof proposal.count === "number" ? (
            <span className="sa-prop-tag ds-num">
              <Ic icon={Layers} size={14} />
              {fa(proposal.count)} رکورد
            </span>
          ) : null}
        </div>
      ) : null}
      {proposal.summary_fa ? <p className="sa-prop-s">{proposal.summary_fa}</p> : null}
      {proposal.preview.length ? (
        <dl className="sa-prop-kv">
          {proposal.preview.map((r, i) => (
            <div key={i}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {proposal.lines?.length ? (
        <div className="sa-tbl-wrap sa-prop-lines" tabIndex={0} role="region" aria-label="ردیف‌ها">
          <table className="sa-tbl">
            {proposal.line_headers?.length ? (
              <thead>
                <tr>
                  {proposal.line_headers.map((h, i) => (
                    <th key={i} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {proposal.lines.map((l, i) => (
                <tr key={i}>
                  {l.cells.map((c, k) => (
                    <td key={k} className={/^[\s\d۰-۹٬,٫.\-−٪%]+$/.test(c) ? "ds-num" : undefined}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {proposal.warnings?.length ? (
        <ul className="sa-prop-warn">
          {proposal.warnings.map((w, i) => (
            <li key={i}>
              <i className="ds-nuqta" aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      ) : null}
      {outcome ? (
        <div className="sa-prop-out" role="region" aria-label="نتیجهٔ هر ردیف">
          <div className="sa-prop-out-h ds-num">
            {fa(outcome.ok)} ثبت شد{outcome.failed ? ` · ${fa(outcome.failed)} ثبت نشد` : ""}
          </div>
          <ul>
            {outcome.rows.slice(0, 50).map((r, i) => (
              <li key={i} className={r.ok ? "is-ok" : "is-bad"}>
                <Ic icon={r.ok ? CircleCheck : TriangleAlert} size={14} />
                {r.path && safePath(r.path) ? (
                  <button type="button" className="sa-mini" onClick={() => onNavigate(safePath(r.path)!)}>
                    {r.label}
                  </button>
                ) : (
                  <span>{r.label}</span>
                )}
                {r.message ? <span className="sa-prop-out-m">{r.message}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <footer className="sa-prop-f">
        {open && !decidable ? (
          <div className="sa-prop-done is-quiet">
            {proposal.agent
              ? "کسانی که این پیشنهاد به آن‌ها سپرده شده و روی این رکورد کار می‌کنند آن را اعمال یا رد می‌کنند."
              : "کسانی که روی این رکورد کار می‌کنند این پیشنهاد را اعمال یا رد می‌کنند."}
          </div>
        ) : open ? (
          <>
            <div className="sa-prop-act">
              <Button type="primary" size="small" loading={busy === "confirm"} disabled={!!busy} onClick={() => decide("confirm")}>
                تأیید و ثبت پیش‌نویس
              </Button>
              {edit ? (
                <Button size="small" disabled={!!busy} onClick={() => onNavigate(edit, { aiActionId: proposal.id })}>
                  ویرایش در فرم
                </Button>
              ) : null}
              <Button type="text" size="small" loading={busy === "reject"} disabled={!!busy} onClick={() => decide("reject")}>
                رد
              </Button>
            </div>
            <div className="sa-prop-exp">{until(proposal.expires_at)}</div>
          </>
        ) : status === "executed" ? (
          <div className="sa-prop-done">
            <Ic icon={CircleCheck} />
            <span>{proposal.result ? `ثبت شد: ${proposal.result.label}` : "پیش‌نویس ثبت شد."}</span>
            {result ? (
              <button type="button" className="sa-mini" onClick={() => onNavigate(result)}>
                <Ic icon={ArrowUpLeft} size={14} />
                باز کردن
              </button>
            ) : null}
          </div>
        ) : status === "failed" ? (
          <div className="sa-prop-done is-bad">
            <Ic icon={TriangleAlert} />
            <span>{proposal.error || "ثبت نشد؛ داده‌ها را در فرم بررسی کنید."}</span>
            {edit ? (
              <button type="button" className="sa-mini" onClick={() => onNavigate(edit, { aiActionId: proposal.id })}>
                ویرایش در فرم
              </button>
            ) : null}
          </div>
        ) : (
          <div className="sa-prop-done is-quiet">{status === "rejected" ? "این پیش‌نویس رد شد؛ چیزی ثبت نشد." : status === "expired" ? "مهلت تأیید این پیش‌نویس گذشته است؛ دوباره بخواهید." : "در حال ثبت…"}</div>
        )}
      </footer>
    </section>
  );
}
