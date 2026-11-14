// «موارد منتظر شما» (design F §5, package F7): the home page's card of what waits for me — my open process steps and my
// pending record approvals, the same list as «کارتابل» (GET /process/inbox), the first five by due time, each opening
// its form or record. Nothing waiting: no card. The portal's home shows its own card (./portal.tsx).
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { faDigits } from "@shared/format";
import { useOrg } from "../../../lib/org";
import { Card } from "../../../components/blocks";
import { Chip } from "../../../components/display";
import { USER_KEYS, userApi } from "./api";
import { inboxRowView, WF_PATH } from "./model";

const SHOWN = 5;

export default function HomeWidget() {
  const { api, orgId } = useOrg();
  const inbox = useQuery({ queryKey: USER_KEYS.inbox(orgId), queryFn: () => userApi.inbox(api), staleTime: 30_000, retry: false });
  const data = inbox.data;
  if (!data || !data.rows.length) return null;
  const now = Date.now();
  const rows = data.rows.slice(0, SHOWN).map((r) => inboxRowView(r, data.display, WF_PATH, now));
  return (
    <Card
      title="موارد منتظر شما"
      meta={<span className="ds-num">{faDigits(data.rows.length)}</span>}
      tools={<Link to={`/${orgId}/${WF_PATH}`}>همه در «کارتابل»</Link>}
      flush
      className="wfu-home"
    >
      <ul className="wfu-home-list">
        {rows.map((v) => (
          <li key={v.key}>
            <Link to={`/${orgId}/${v.link}`} className="wfu-home-row">
              <span className="wfu-home-t">{v.title}</span>
              <span className="wfu-home-m">
                <Chip tone={v.kind ? "info" : "accent"} dot={false}>
                  {v.kind ?? v.action}
                </Chip>
                <span>{v.step}</span>
                {v.due ? <Chip tone={v.due.tone === "neutral" ? "neutral" : v.due.tone === "warning" ? "warning" : "danger"}>{v.due.text}</Chip> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
