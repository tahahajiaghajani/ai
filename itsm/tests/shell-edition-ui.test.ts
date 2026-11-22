// The three editions, each named as itself (the owner's click-through of 1.1.5: on the organisation's server the sidebar
// footer said «نسخهٔ وب · داده‌ها مستقیم در فضای ابری ذخیره می‌شوند.» and the home card «وب · ۱٫۱٫۵»). Every place that
// tells the editions apart asks src/ui/lib/edition.ts: the footer (components/shell/sync.tsx), the home card, «درباره»,
// the platform console and the Windows app's own pages — the Windows app by what its link reaches
// (`desktop.cloud.edition`, learnt from the server: tests/sync-link-edition.test.ts).
import { describe, it, expect } from "vitest";
import { syncStateOf, type LocalSync } from "../src/ui/components/shell/sync";
import { EDITION_NAMES, EDITION_WORDS, editionOf, installationState, linkedEdition, runsAs } from "../src/ui/lib/edition";
import type { Meta } from "../src/ui/lib/session";

type M = Pick<Meta, "mode" | "edition" | "desktop">;
const web: M = { mode: "cloud", edition: "web", desktop: null };
const server: M = { mode: "cloud", edition: "server", desktop: null };
/** a Windows app, on its own or linked to what `edition` names (undefined: a link made before the app asked) */
const windows = (cloud: { linked: boolean; edition?: "web" | "server" | null }): M => ({ mode: "desktop", edition: "desktop", desktop: { cloud } as unknown as Meta["desktop"] });
const NOW = Date.parse("2026-11-22T08:00:00Z");
const sync = (s: Partial<LocalSync>): LocalSync => ({ linked: true, running: false, online: true, pending: 0, last_sync_at: "2026-11-22T07:59:30Z", last_error: null, ...s });

describe("each edition names itself", () => {
  it("which edition answers: the server edition by its own word, an older server without the field as the web version", () => {
    expect(editionOf(web)).toBe("web");
    expect(editionOf(server)).toBe("server");
    expect(editionOf(windows({ linked: true, edition: "server" }))).toBe("desktop");
    expect(editionOf({ mode: "cloud" })).toBe("web");
    expect(editionOf(undefined)).toBe("web");
    // the home card's «سرور · ۱٫۱٫۵»
    expect(EDITION_WORDS[editionOf(server)]).toBe("سرور");
    expect(EDITION_WORDS[editionOf(web)]).toBe("وب");
    expect(EDITION_WORDS[editionOf(windows({ linked: false }))]).toBe("ویندوز");
    expect(EDITION_NAMES).toEqual({ web: "نسخهٔ وب", desktop: "نسخهٔ ویندوز", server: "نسخهٔ سرور" });
  });

  it("the footer of the server edition: «نسخهٔ سرور», its data on the organisation's server — never the web version's words", () => {
    const s = syncStateOf(server, undefined, NOW);
    expect(s).toMatchObject({ tone: "web", word: "نسخهٔ سرور", meta: null, detail: "داده‌ها روی سرور سازمان می‌مانند." });
    expect(JSON.stringify(s)).not.toMatch(/نسخهٔ وب|فضای ابری/);
    expect(installationState("server")).toEqual({ word: "نسخهٔ سرور", detail: "داده‌ها روی سرور سازمان می‌مانند." });
    // the web version as before
    expect(syncStateOf(web, undefined, NOW)).toMatchObject({ tone: "web", word: "نسخهٔ وب", detail: "داده‌ها مستقیم در فضای ابری ذخیره می‌شوند." });
  });

  it("a Windows app says how its copy stands against what it is linked to: the server edition or the web version", () => {
    // on its own: either can be linked
    const alone = syncStateOf(windows({ linked: false }), sync({ linked: false }), NOW);
    expect(alone).toMatchObject({ tone: "local", word: "روی همین رایانه" });
    expect(alone.detail).toContain("نسخهٔ وب یا سرور سازمان");
    // linked to the organisation's server
    const toServer = windows({ linked: true, edition: "server" });
    expect(syncStateOf(toServer, sync({ online: false, pending: 2 }), NOW)).toMatchObject({ tone: "offline", word: "بی‌اتصال به سرور" });
    const live = syncStateOf(toServer, sync({}), NOW);
    expect(live).toMatchObject({ tone: "live", word: "هم‌گام", meta: "همین حالا" });
    expect(live.detail).toMatch(/^آخرین هم‌گامی با نسخهٔ سرور: /);
    // linked to the web version, and a link made before the app asked (as every link did then)
    for (const m of [windows({ linked: true, edition: "web" }), windows({ linked: true })]) {
      expect(syncStateOf(m, sync({ online: false }), NOW).word).toBe("بی‌اینترنت");
      expect(syncStateOf(m, sync({}), NOW).detail).toMatch(/^آخرین هم‌گامی با نسخهٔ وب: /);
    }
    expect(linkedEdition({ edition: "server" })).toBe("server");
    expect(linkedEdition({ edition: null })).toBe("web");
    expect(linkedEdition(null)).toBe("web");
  });

  it("«درباره» ← «اجرا»: the edition, and for a linked Windows app what it syncs with", () => {
    expect(runsAs(server)).toBe("نسخهٔ سرور");
    expect(runsAs(web)).toBe("نسخهٔ وب");
    expect(runsAs(windows({ linked: false, edition: null }))).toBe("برنامهٔ ویندوز");
    expect(runsAs(windows({ linked: true, edition: "server" }))).toBe("برنامهٔ ویندوز، هم‌گام با نسخهٔ سرور");
    expect(runsAs(windows({ linked: true, edition: "web" }))).toBe("برنامهٔ ویندوز، هم‌گام با نسخهٔ وب");
  });
});
