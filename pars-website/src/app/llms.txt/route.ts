import { env } from "@/lib/env";
import { CONTACT_ENTRY_ID, getKnowledge } from "@/lib/knowledge";
import { getSettings } from "@/lib/settings";

export const revalidate = 3600;

/** A plain-text brief for AI answer engines (generated from the same knowledge the assistant uses). */
export async function GET() {
  const [{ entries }, { site }] = await Promise.all([getKnowledge(), getSettings()]);
  const u = env.siteUrl;
  const body = [
    "# Pars Project Management (مدیریت پروژه پارس)",
    "",
    "> Enterprise project & portfolio management systems (EPM/EPPM), management software (request & contract management, performance evaluation, dashboards) and AI agents for banks and large organizations in Iran. Founded 2010 (1389 SH); systems running at 20 banks and organizations. Tagline: Where management meets intelligence — «جایی که مدیریت و هوش به هم می‌رسند».",
    "",
    "## Links",
    `- [Home (Persian)](${u}/)`,
    `- [Home (English)](${u}/en)`,
    `- [Support & ticketing](${u}/support)`,
    "",
    "## Contact",
    `- Email: ${site.contact.email}`,
    ...site.contact.phones.map((p) => `- Phone: ${p}`),
    `- Address: ${site.contact.addressEn}`,
    "",
    "## Knowledge",
    ...entries.filter((e) => e.enabled && e.id !== CONTACT_ENTRY_ID).map((e) => `### ${e.title}\n${e.body.trim()}\n`),
  ].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
