// «وضعیت پایش» as a button of another module's page (design A §15, §20: the ATM fleet page opens the board on its
// ATMs). Shown only where the board is: the web version and the server edition, for those who may open it.
import { useNavigate } from "react-router";
import { Button } from "antd";
import { Activity } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { STATUS_READS, type BoardChip } from "./model";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export function StatusBoardLink({ chip }: { chip?: BoardChip }) {
  const { orgId, allows } = useOrg();
  const { meta } = useSession();
  const nav = useNavigate();
  if (meta?.mode !== "cloud" || !allows(STATUS_READS)) return null;
  return (
    <Button icon={<Activity {...I16} />} onClick={() => nav(`/${orgId}/discovery/status${chip ? `?chip=${chip}` : ""}`)}>
      وضعیت پایش
    </Button>
  );
}
