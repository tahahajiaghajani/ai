import { requireAdminPage } from "@/lib/admin-auth";
import { connectionReport, migrationSql } from "@/lib/connections";
import { getSettingsFresh } from "@/lib/settings";
import { DEFAULT_SETTINGS } from "@/lib/settings-types";
import { PageTitle } from "@/components/admin/ui";
import { ConnectionsBoard } from "@/components/admin/connections";

export const dynamic = "force-dynamic";

export default async function Connections() {
  await requireAdminPage();
  const report = await connectionReport();
  const sql = await migrationSql(report.supabase.missingFiles);
  const s = report.supabase.reachable ? await getSettingsFresh().catch(() => DEFAULT_SETTINGS) : DEFAULT_SETTINGS;
  const { apiKeyEnc, ...ai } = s.ai;
  const { botTokenEnc, ...notify } = s.notify;
  return (
    <>
      <PageTitle title="اتصالات" sub="وضعیت پایگاه داده، هوش مصنوعی، اعلان‌ها، ایمیل و امنیت؛ هر جا ممکن است، همین‌جا وصل و آزمایش کنید." />
      <ConnectionsBoard report={report} sql={sql} ai={{ ...ai, hasKey: !report.ai.keyUnreadable && Boolean(apiKeyEnc) }} notify={{ ...notify, hasToken: Boolean(botTokenEnc) }} />
    </>
  );
}
