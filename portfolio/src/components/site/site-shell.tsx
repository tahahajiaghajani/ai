import type { Lang } from "@/lib/i18n";
import { ui } from "@/content/ui";
import { MotionProvider } from "@/components/fx/motion";
import { Cursor } from "@/components/fx/cursor";
import { Preloader } from "@/components/fx/preloader";
import { Header } from "@/components/site/header";
import { Footer } from "@/components/site/footer";
import { ChatLauncher } from "@/components/chat/chat-launcher";
import { ChatProvider } from "@/components/chat/chat-context";
import { PROJECTS } from "@/content/projects";

export function SiteShell({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[90] focus:rounded-full focus:bg-fg focus:px-4 focus:py-2 focus:text-bg">
        {ui.nav.skip[lang]}
      </a>
      <Preloader lang={lang} />
      <ChatProvider lang={lang} works={PROJECTS.map((p) => ({ slug: p.slug, title: p.title[lang] }))}>
        <MotionProvider>
          <Header lang={lang} />
          <main id="main">{children}</main>
          <Footer lang={lang} />
          <ChatLauncher lang={lang} />
        </MotionProvider>
      </ChatProvider>
      <Cursor />
    </>
  );
}
