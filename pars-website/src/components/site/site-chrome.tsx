import type { ReactNode } from "react";
import { copy, href, type Lang } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { Header } from "@/components/site/header";
import { Footer } from "@/components/site/footer";
import { DemoSheet } from "@/components/site/demo-sheet";
import { ChatProvider } from "@/components/chat/chat-context";
import { AdminShortcut } from "@/components/site/admin-shortcut";

/** Header, footer, the assistant and the demo sheet around every public page. */
export async function SiteChrome({ lang, children }: { lang: Lang; children: ReactNode }) {
  const t = copy(lang);
  const s = await getSettings();
  return (
    <ChatProvider
      lang={lang}
      t={t.chat}
      greeting={lang === "fa" ? s.chat.greetingFa : s.chat.greetingEn}
      suggestions={lang === "fa" ? s.chat.suggestionsFa : s.chat.suggestionsEn}
      supportHref={href(lang, "/support")}
      contactHref={`${href(lang, "/")}#contact`}
    >
      <Header lang={lang} t={t} />
      <main id="main">{children}</main>
      <Footer lang={lang} t={t} site={s.site} />
      <DemoSheet lang={lang} t={t.demos} customHref={`${href(lang, "/support")}?category=demo`} />
      <AdminShortcut label={t.nav.admin} />
    </ChatProvider>
  );
}
