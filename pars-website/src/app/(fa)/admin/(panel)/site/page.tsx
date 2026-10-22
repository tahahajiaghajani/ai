import { requireAdminPage } from "@/lib/admin-auth";
import { getSettingsFresh } from "@/lib/settings";
import { PageTitle } from "@/components/admin/ui";
import { NotifyForm, SiteForm } from "@/components/admin/site-forms";

export default async function SitePage() {
  await requireAdminPage();
  const s = await getSettingsFresh();
  const { botTokenEnc, ...notify } = s.notify;
  return (
    <>
      <PageTitle title="محتوای سایت" sub="معرفی مدیرعامل، اطلاعات تماس، آمار صفحه‌ی اول و اعلان‌های تیکت. پس از ذخیره، صفحه‌ها بلافاصله به‌روز می‌شوند." />
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <SiteForm initial={s.site} />
        <NotifyForm initial={{ ...notify, hasToken: Boolean(botTokenEnc) }} />
      </div>
    </>
  );
}
