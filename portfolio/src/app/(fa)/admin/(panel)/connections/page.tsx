import { requireAdmin } from "@/lib/admin-auth";
import { connectionReport, publicSettings } from "@/lib/connections";
import { ghConfigured } from "@/lib/github";
import { loadSettings } from "@/lib/settings";
import { DEFAULT_SETTINGS } from "@/lib/settings-types";
import { ConnectionsBoard } from "@/components/admin/connections";

export default async function Connections() {
  await requireAdmin(); // the layout check alone does not stop this page from rendering
  const [report, stored] = await Promise.all([
    connectionReport(),
    // null = could not be read: the forms then refuse to save, so a GitHub hiccup never overwrites the real settings
    ghConfigured() ? loadSettings().then((s) => s.settings).catch(() => null) : Promise.resolve(DEFAULT_SETTINGS),
  ]);
  const settings = stored ?? DEFAULT_SETTINGS;
  return (
    <>
      <h1 className="mb-3 text-3xl font-bold">اتصالات</h1>
      <p className="mb-8 max-w-[70ch] text-sm leading-relaxed text-muted">وضعیت مخزن داده، هوش مصنوعی، اعلان‌ها، امنیت و میزبانی؛ هر جا ممکن است همین‌جا وصل و آزمایش کنید.</p>
      <ConnectionsBoard report={report} settings={publicSettings(settings)} loaded={stored !== null} />
    </>
  );
}
