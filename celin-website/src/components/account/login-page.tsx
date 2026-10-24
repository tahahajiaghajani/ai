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

/**
 * /account/login: sign in · create account · sign in with a Pro code. Signed-in visitors go straight on.
 * Two arches side by side on one sill: the doorway with the forms, and the house's picture (desktop).
 */
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
      <ArchLines count={5} className="pointer-events-none absolute inset-x-0 -bottom-24 mx-auto h-[115%] w-[min(1500px,180vw)] opacity-35" />
      <div className="container-lux relative grid items-end gap-14 pt-14 pb-20 sm:pt-20 lg:grid-cols-12 lg:gap-10 lg:pt-24 lg:pb-24">
        <div className="mx-auto w-full max-w-[27rem] lg:col-span-5 lg:mx-0 lg:max-w-none xl:col-span-4 xl:col-start-2">
          <AuthForms lang={lang} tab={tab} next={next} contact={contact} />
        </div>
        {side && (
          <div className="relative hidden self-end lg:col-span-6 lg:col-start-7 lg:block xl:col-span-5 xl:col-start-7">
            <div className="relative mx-auto w-[min(100%,440px)]" data-cursor="view">
              <Arch media={side.media} lang={lang} sizes="(min-width: 1440px) 440px, 36vw" ring="copper" keystone unveil sparkle={10} parallax={5} />
            </div>
            <p className="title-section mt-9 text-center text-metal metal-live">{common[lang].brand.line}</p>
          </div>
        )}
      </div>
    </main>
  );
}
