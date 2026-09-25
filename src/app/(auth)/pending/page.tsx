import { redirect } from "next/navigation";
import { Hourglass, LogOut } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/primitives";

export const metadata = { title: "در انتظار تایید" };

export default async function PendingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.profile.status === "active") redirect("/");
  return (
    <div className="text-center">
      <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-primary-soft text-primary">
        <Hourglass className="size-8" />
      </div>
      <h1 className="mt-6 text-2xl font-black">حساب شما در انتظار تایید است</h1>
      <p className="mt-3 text-sm leading-7 text-muted">
        {user.profile.full_name} عزیز، ثبت‌نام شما انجام شد و برای مدیر ارسال شد. پس از تایید می‌توانید تسک ثبت کنید. این صفحه را بعداً دوباره باز کنید.
      </p>
      <form action={signOutAction} className="mt-8">
        <Button variant="secondary" type="submit">
          <LogOut className="size-4" /> خروج
        </Button>
      </form>
    </div>
  );
}
