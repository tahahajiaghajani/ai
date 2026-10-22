import { env } from "@/lib/env";
import { getKnowledge } from "@/lib/knowledge";
import { getSettings } from "@/lib/settings";

export const revalidate = 3600;

/** A plain-text brief for AI answer engines (generated from the same knowledge the assistant uses). */
export async function GET() {
  const [{ entries }, { site }] = await Promise.all([getKnowledge(), getSettings()]);
  const u = env.siteUrl;
  const body = [
    "# Pars Project Management (مدیریت پروژه پارس)",
    "",
    "> Enterprise project & portfolio management systems (EPM/EPPM), custom enterprise software and AI agents for banks and large organizations in Iran. 15+ years of experience. Tagline: Where management meets intelligence — «جایی که مدیریت و هوش به هم می‌رسند».",
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
    ...entries.filter((e) => e.enabled).map((e) => `### ${e.title}\n${e.body.trim()}\n`),
  ].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
