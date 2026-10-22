import { requireAdminPage } from "@/lib/admin-auth";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { listUsers } from "@/lib/users";
import { DbMissing, Empty, PageTitle } from "@/components/admin/ui";
import { UsersManager } from "@/components/admin/users-manager";

export const dynamic = "force-dynamic";

export default async function UsersAdmin() {
  await requireAdminPage();
  if (!db()) {
    return (
      <>
        <PageTitle title="کاربران" />
        <DbMissing />
      </>
    );
  }
  const [rows, me] = await Promise.all([listUsers(), currentUser()]);
  return (
    <>
      <PageTitle title="کاربران" sub="حساب‌هایی که در سایت ثبت‌نام کرده‌اند؛ نقش مدیر، غیرفعال‌سازی و رمز تازه." />
      {rows === null ? (
        <Empty>
          جدول حساب‌ها هنوز ساخته نشده است. از «اتصالات» فایل SQL <span className="ltr font-mono">20261022160000_pars_accounts.sql</span> را کپی و در Supabase اجرا کنید.
        </Empty>
      ) : (
        <UsersManager rows={rows} meId={me?.id ?? null} />
      )}
    </>
  );
}
