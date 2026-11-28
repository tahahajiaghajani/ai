// The three editions, named as the product names them (docs/SERVER_FA.md §۱, the sign-in pages' AuthLayout): «نسخهٔ وب»
// (Vercel + Supabase), «نسخهٔ ویندوز» (the Windows app — on its own, or linked to the web version or to an organisation's
// server edition) and «نسخهٔ سرور» (Windows Server on the organisation's intranet, whose data stays on that server).
// /api/meta says which one answers (`edition`; `mode` alone from a server older than the field), and a Windows app says
// what it is linked to (`desktop.cloud.edition`, learnt from the server it syncs with; unknown reads as the web version,
// as every link did before). Every place that tells the editions apart asks here.
import type { Meta } from "./session";

export type Edition = "web" | "desktop" | "server";

/** Which edition answers: the Windows app whatever it is linked to, else the server edition, else the web version. */
export function editionOf(meta: Pick<Meta, "mode" | "edition"> | null | undefined): Edition {
  if (meta?.mode === "desktop") return "desktop";
  return meta?.edition === "server" ? "server" : "web";
}

/** «نسخهٔ وب»، «نسخهٔ ویندوز»، «نسخهٔ سرور». */
export const EDITION_NAMES: Record<Edition, string> = { web: "نسخهٔ وب", desktop: "نسخهٔ ویندوز", server: "نسخهٔ سرور" };

/** The word beside a version number («سرور · ۱٫۱٫۵»). */
export const EDITION_WORDS: Record<Edition, string> = { web: "وب", desktop: "ویندوز", server: "سرور" };

/** The sidebar footer of an edition that keeps no copy to sync: its name, and where its data is. */
export function installationState(e: Exclude<Edition, "desktop">): { word: string; detail: string } {
  return e === "server"
    ? { word: EDITION_NAMES.server, detail: "داده‌ها روی سرور سازمان می‌مانند." }
    : { word: EDITION_NAMES.web, detail: "داده‌ها مستقیم در فضای ابری ذخیره می‌شوند." };
}

/** What a Windows app is linked to: the organisation's server edition, else the web version (also when not yet known). */
export const linkedEdition = (cloud: { edition?: string | null } | null | undefined): "web" | "server" => (cloud?.edition === "server" ? "server" : "web");

/** How this installation runs («درباره» ← «اجرا»): its edition, and for a linked Windows app what it syncs with. */
export function runsAs(meta: Pick<Meta, "mode" | "edition" | "desktop"> | null | undefined): string {
  const e = editionOf(meta);
  if (e !== "desktop") return EDITION_NAMES[e];
  const cloud = meta?.desktop?.cloud;
  return cloud?.linked ? `برنامهٔ ویندوز، هم‌گام با ${EDITION_NAMES[linkedEdition(cloud)]}` : "برنامهٔ ویندوز";
}
