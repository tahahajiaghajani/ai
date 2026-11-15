// The portal home's card of what waits for the person in «گردش‌کارها» (design F §5 «Navigation»; package F7): shown only
// when something waits — my open steps and my pending record approvals, the first three, each opening its form (or the
// portal's approval page), and «همه» to the portal's «گردش‌کارها».
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { faDigits } from "@shared/format";
import { useOrg } from "../../../lib/org";
import { Chip } from "../../../components/display";
import { USER_KEYS, userApi } from "./api";
import { inboxRowView, PORTAL_WF_PATH } from "./model";

const SHOWN = 3;

export default function PortalCard() {
  const { api, orgId } = useOrg();
  const inbox = useQuery({ queryKey: USER_KEYS.inbox(orgId), queryFn: () => userApi.inbox(api), staleTime: 30_000, retry: false });
  const data = inbox.data;
  if (!data || !data.rows.length) return null;
  const now = Date.now();
  const rows = data.rows.slice(0, SHOWN).map((r) => inboxRowView(r, data.display, PORTAL_WF_PATH, now));
  return (
    <section className="pt-section" aria-labelledby="pt-wf-waiting">
      <div className="pt-section-h">
        <h2 id="pt-wf-waiting">{`گردش‌کارهای منتظر شما (${faDigits(data.rows.length)})`}</h2>
        <Link className="ds-link" to={`/${orgId}/${PORTAL_WF_PATH}`}>
          همه
        </Link>
      </div>
      <div className="pt-card is-flush">
        <ul className="pt-list">
          {rows.map((v) => (
            <li key={v.key}>
              <Link to={`/${orgId}/${v.link}`} className="pt-row">
                <span className="pt-row-b">
                  <span className="pt-row-t">{v.title}</span>
                  <span className="pt-row-m">
                    <span>{v.source}</span>
                    <span>{v.step}</span>
                  </span>
                </span>
                {v.due ? <Chip tone={v.due.tone === "neutral" ? "neutral" : v.due.tone === "warning" ? "warning" : "danger"}>{v.due.text}</Chip> : <Chip tone={v.kind ? "info" : "accent"} dot={false}>{v.kind ?? v.action}</Chip>}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
