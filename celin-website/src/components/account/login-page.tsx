import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import type { Lang } from "@/lib/format";
import { safeNextPath, storeContact } from "@/lib/member";
import { getSlots } from "@/lib/slots";
import { Picture } from "@/components/ui/picture";
import { AuthForms, type AuthTab } from "@/components/account/auth-forms";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** /account/login: sign in · create account · sign in with a Pro code. Signed-in visitors go straight on. */
export async function LoginPage({ lang, searchParams }: { lang: Lang; searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const next = safeNextPath(one(sp.next), lang);
  const t = one(sp.tab);
  const tab: AuthTab = t === "signup" || t === "code" ? t : "signin";
  if (await currentUser()) redirect(next);
  const [slots, contact] = await Promise.all([getSlots(), storeContact()]);
  const side = slots["auth.side"];
  return (
    <main className="container-lux pt-8 pb-20 sm:pt-12 lg:pt-16 lg:pb-28">
      <div className="grid items-start gap-16 lg:grid-cols-12">
        <div className="mx-auto w-full max-w-md lg:col-span-5 lg:mx-0 lg:max-w-none xl:col-span-4 xl:col-start-2">
          <AuthForms lang={lang} tab={tab} next={next} contact={contact} />
        </div>
        {side && (
          <div className="hidden lg:col-span-6 lg:col-start-7 lg:block xl:col-span-5 xl:col-start-7">
            <Picture media={side.media} lang={lang} ratio="3/4" sizes="(min-width: 1440px) 560px, 40vw" className="max-w-[640px]" />
          </div>
        )}
      </div>
    </main>
  );
}
