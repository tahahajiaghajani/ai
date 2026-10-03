import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { listConnections } from "@/lib/connections";
import { SetupClient } from "./setup-client";

export const metadata = { title: "تجربه‌ی کامل اپلیکیشن" };

/** «آیا تجربه‌ی کامل اپلیکیشن را می‌خواهید؟» — what it gives, how to set it up, one-click switch. */
export default async function SetupPage() {
  const me = await requireUser();
  const conns = await listConnections(me.id);
  return (
    <SetupClient
      mode={me.mode}
      guideUrl={env.guideUrl || null}
      done={{ ai: conns.some((c) => c.kind === "ai"), github: conns.some((c) => c.kind === "github"), claude: !!conns.find((c) => c.kind === "github" && (c.config as { claudeCode?: boolean }).claudeCode) }}
    />
  );
}
