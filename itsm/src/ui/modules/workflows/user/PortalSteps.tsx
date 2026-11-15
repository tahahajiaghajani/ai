// «گردش‌کارهای منتظر شما» in the portal's «کارهای من» (design F §5 «Navigation»; package F7): my open process steps —
// a case returned to me for correction, an approval or a review waiting for me — each opening its form in the portal,
// with the step, its action, its notes («به جانشینی از …»، «در دست …»، «در صف ارسال») and the due pill, and «همه» to the
// portal's «گردش‌کارها». The portal lists record approvals itself; nothing waiting: no section. Loads with its page.
import { Link } from "react-router";
import { Waypoints } from "lucide-react";
import { useOrg } from "../../../lib/org";
import { Chip } from "../../../components/display";
import { I16, Section } from "../../portal/parts";
import { inboxRowView, PORTAL_WF_PATH, waitingSteps } from "./model";
import { useInbox } from "./waiting";

export default function PortalSteps() {
  const { orgId } = useOrg();
  const data = useInbox().data;
  const steps = waitingSteps(data);
  if (!data || !steps.length) return null;
  const now = Date.now();
  return (
    <Section
      title="گردش‌کارهای منتظر شما"
      id="pt-wf-steps"
      more={
        <Link className="ds-link" to={`/${orgId}/${PORTAL_WF_PATH}`}>
          همه
        </Link>
      }
    >
      <div className="pt-card is-flush">
        <ul className="pt-list">
          {steps.map((r) => {
            const v = inboxRowView(r, data.display, PORTAL_WF_PATH, now);
            return (
              <li key={v.key}>
                <Link to={`/${orgId}/${v.link}`} className="pt-row">
                  <Waypoints {...I16} aria-hidden className="text-ink-3" />
                  <span className="pt-row-b">
                    <span className="pt-row-t">{v.title}</span>
                    <span className="pt-row-m">
                      <span>{v.source}</span>
                      <span>{`${v.action ? `${v.action}: ` : ""}${v.step}`}</span>
                      {v.notes.map((x) => (
                        <span key={x}>{x}</span>
                      ))}
                    </span>
                  </span>
                  {v.due ? <Chip tone={v.due.tone === "neutral" ? "neutral" : v.due.tone === "warning" ? "warning" : "danger"}>{v.due.text}</Chip> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}
