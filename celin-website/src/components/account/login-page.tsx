import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import type { Lang } from "@/lib/format";
import { safeNextPath, storeContact } from "@/lib/member";
import { getSlots } from "@/lib/slots";
import { common } from "@/content/copy/common";
import { Arch } from "@/components/fx/arch";
import { ArchLines } from "@/components/fx/arch-lines";
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
    <main className="relative isolate overflow-clip bg-mesh-bone">
      <div className="container-lux grid items-center gap-14 pt-10 pb-20 sm:pt-14 lg:min-h-[calc(100svh-var(--header-h))] lg:grid-cols-12 lg:gap-10 lg:py-16">
        <div className="relative mx-auto w-full max-w-md lg:col-span-5 lg:mx-0 lg:max-w-none xl:col-span-4 xl:col-start-2">
          <div className="frame-metal relative bg-porcelain/85 p-6 shadow-[0_40px_80px_-50px_rgb(26_19_16/0.45)] [--frame:var(--metal-copper)] sm:p-10">
            <AuthForms lang={lang} tab={tab} next={next} contact={contact} />
          </div>
        </div>
        {side && (
          <div className="relative hidden lg:col-span-6 lg:col-start-7 lg:block xl:col-span-5 xl:col-start-7">
            <ArchLines count={4} className="pointer-events-none absolute inset-x-[-16%] bottom-[12%] top-[-6%] h-[94%] w-[132%]" />
            <div className="relative mx-auto w-[min(100%,480px)]" data-cursor="view">
              <Arch media={side.media} lang={lang} sizes="(min-width: 1440px) 480px, 36vw" ring="copper" keystone unveil sparkle={10} parallax={5} />
            </div>
            <p className="display mt-10 text-center text-3xl font-bold text-metal metal-live">{common[lang].brand.line}</p>
          </div>
        )}
      </div>
    </main>
  );
}
