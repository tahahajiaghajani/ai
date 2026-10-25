import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import type { KnowledgeEntry } from "@/lib/retrieval";
import { PROFILE, EXPERTISE, METHOD } from "@/content/profile";
import { PROJECTS } from "@/content/projects";
import { JOURNEY } from "@/content/journey";
import { ORGS } from "@/content/orgs";
import { FACTS } from "@/content/facts";

const strip = (s: string) => s.replace(/\*\*/g, "").replace(/`/g, "");

/**
 * The assistant's knowledge is the site itself: profile, expertise, every case study, the journey and a set of
 * extra facts — so what the chat says never drifts from what the pages say. Owner-added facts from the database
 * are appended (Supabase table portfolio_knowledge, optional).
 */
export function siteKnowledge(): KnowledgeEntry[] {
  const out: KnowledgeEntry[] = [];
  let sort = 0;
  const add = (e: Omit<KnowledgeEntry, "enabled" | "sort">) => out.push({ ...e, enabled: true, sort: sort++ });

  add({
    id: "profile",
    pinned: true,
    title: "Who is Taha Aghajani / طاها آقاجانی کیست",
    tags: ["about", "bio", "درباره", "معرفی", "who"],
    body: [
      `Name: ${PROFILE.name.en} (${PROFILE.name.fa}); born ${PROFILE.born.en} (${PROFILE.born.fa}); based in ${PROFILE.city.en}.`,
      `Roles: ${PROFILE.roles.en.join(" · ")} / ${PROFILE.roles.fa.join(" · ")}.`,
      PROFILE.intro.en,
      PROFILE.intro.fa,
      PROFILE.manifesto.en,
      PROFILE.manifesto.fa,
    ].join("\n"),
  });
  add({
    id: "contact",
    pinned: true,
    title: "Contact / راه‌های تماس",
    tags: ["contact", "تماس", "email", "ایمیل", "phone", "تلفن", "telegram", "تلگرام"],
    body: [
      `- Email: ${PROFILE.contact.email}`,
      `- Phone / تلفن: ${PROFILE.contact.phoneDisplay.en} (${PROFILE.contact.phoneDisplay.fa})`,
      `- Telegram / تلگرام: the same number (${PROFILE.contact.telegram})`,
      `- GitHub: ${PROFILE.contact.github}`,
      "- The fastest way to start a project or ask for a demo is the request form on this site («شروع همکاری» / Start a project): it is triaged by AI and gives a tracking code.",
    ].join("\n"),
  });

  for (const x of EXPERTISE) {
    add({ id: `expertise-${x.key}`, pinned: false, title: `Expertise: ${x.title.en} / ${x.title.fa}`, tags: x.tags, body: `${x.body.en}\n${x.body.fa}` });
  }
  add({
    id: "method",
    pinned: false,
    title: "How Taha works (forward-deployed engineering) / روش کار",
    tags: ["process", "method", "FDE", "روش", "فرایند"],
    body: METHOD.map((m, i) => `${i + 1}. ${m.title.en} / ${m.title.fa}: ${m.body.en} ${m.body.fa}`).join("\n"),
  });

  for (const p of PROJECTS) {
    add({
      id: `project-${p.slug}`,
      pinned: false,
      title: `Project: ${p.title.en} / ${p.title.fa} [[work:${p.slug}]]`,
      tags: [...p.stack, ...p.disciplines, p.kicker.en, p.kicker.fa],
      body: [
        `Case study page: /work/${p.slug} (Persian) and /en/work/${p.slug} (English). Marker to link it: [[work:${p.slug}]]`,
        `Summary: ${p.oneLiner.en} / ${p.oneLiner.fa}`,
        `Context: ${p.context.en} / ${p.context.fa}. Role: ${p.role.en} / ${p.role.fa}. Period: ${p.period.en}. Status: ${p.status.en}.`,
        `Challenge: ${strip(p.challenge.en)}`,
        `Approach: ${strip(p.approach.en)}`,
        `Features: ${p.features.en.join("; ")}`,
        p.outcomes.length ? `Outcomes: ${p.outcomes.map((o) => `${o.value.en} ${o.label.en}`).join("; ")}` : "",
        `Stack: ${p.stack.join(", ")}`,
        p.note ? `Note: ${p.note.en}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  add({
    id: "journey",
    pinned: true,
    title: "Career and education / سوابق و تحصیلات",
    tags: ["career", "experience", "education", "سابقه", "تحصیلات", "دانشگاه", "university", "Pars", "پارس", "Tejarat", "تجارت"],
    body: JOURNEY.map((r) => {
      const org = ORGS.find((o) => o.key === r.org);
      return `- ${r.period.en}: ${r.title.en} (${r.title.fa})${org ? ` — ${org.name.en} / ${org.name.fa}` : ""}. ${r.body.en}`;
    }).join("\n"),
  });

  for (const f of FACTS) add({ id: f.id, pinned: f.pinned ?? false, title: f.title, tags: f.tags, body: f.body });
  return out;
}

interface Row {
  id: string;
  title: string;
  body: string;
  tags: string[] | null;
  enabled: boolean;
}

async function loadExtra(): Promise<KnowledgeEntry[]> {
  const c = db();
  if (!c) return [];
  const { data, error } = await c.from("portfolio_knowledge").select("id,title,body,tags,enabled").eq("enabled", true).order("created_at");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((r, i) => ({ id: r.id, title: r.title, body: r.body, tags: r.tags ?? [], pinned: false, enabled: true, sort: 1000 + i }));
}

const cachedExtra = unstable_cache(loadExtra, ["portfolio-knowledge-v1"], { tags: ["knowledge"], revalidate: 300 });

export async function getKnowledge(): Promise<KnowledgeEntry[]> {
  let extra: KnowledgeEntry[] = [];
  try {
    extra = await cachedExtra();
  } catch (e) {
    console.error("[knowledge] extra facts unavailable", e);
  }
  return [...siteKnowledge(), ...extra];
}
