import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import type { Lang } from "@/lib/format";
import { href } from "@/lib/i18n";
import { loginPath } from "@/lib/member";
import { unreadCount } from "@/lib/messages";
import { proStatus } from "@/lib/pro";
import { AccountSidebar } from "@/components/account/account-nav";

async function Sidebar({ lang }: { lang: Lang }) {
  const me = await currentUser();
  // the page's own check usually answers first (it knows the exact path to come back to)
  if (!me) redirect(loginPath(lang, href(lang, "/account")));
  const [pro, unread] = await Promise.all([proStatus(me.id), unreadCount(me.id)]);
  return <AccountSidebar lang={lang} initial={{ name: me.name, pro: pro.active, unread }} />;
}

/**
 * Frame of the account area: a sticky 256px sidebar at the inline start on desktop, nothing around the
 * page on phones (the account home is the menu there). Every page checks the session itself as well.
 * The whole area is dense UI, so it reads in the UI face (Vazirmatn) rather than the running-text Naskh.
 */
export function AccountShell({ lang, children }: { lang: Lang; children: ReactNode }) {
  return (
    <div className="container-lux font-ui pt-4 pb-24 sm:pt-8 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-14 lg:pt-12 lg:pb-32 xl:gap-20">
      <aside className="hidden lg:block">
        <div className="sticky top-[calc(var(--header-h)+2.5rem)]">
          <Suspense fallback={<div className="h-[28rem]" aria-hidden />}>
            <Sidebar lang={lang} />
          </Suspense>
        </div>
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  );
}
