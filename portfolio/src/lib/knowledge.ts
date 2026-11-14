import "server-only";
import { unstable_cache } from "next/cache";
import { env } from "@/lib/env";
import { getFile, ghConfigured, GhError } from "@/lib/github";
import { KNOWLEDGE_FILE, parseKnowledgeFile } from "@/lib/knowledge-file";
import type { KnowledgeEntry } from "@/lib/retrieval";
import { PROFILE, EXPERTISE, METHOD } from "@/content/profile";
import { PROJECTS } from "@/content/projects";
import { JOURNEY } from "@/content/journey";
import { ORGS } from "@/content/orgs";
import { FACTS } from "@/content/facts";
import { PRODUCTS } from "@/content/products";
import { POSTS } from "@/content/blog";

const strip = (s: string) => s.replace(/\*\*/g, "").replace(/`/g, "");

/** Two things the content deliberately leaves unsaid; the assistant must not fill them in. */
const UNDATED =
  "Engagements marked Earlier are finished, and their dates are not published: never say they are ongoing, and never state or guess their dates, length or order.";
const ITSM_UNSTATED =
  "Nothing here says which product, vendor or technology the Bank of Industry and Mine's ITSM system is built on, or whether it is related to Kariz. Never say or imply that it is Kariz or any other product on this site, never describe it with Kariz's features, dates, stack or links, and never deny a relation either: if asked, say you do not have that information. Do not raise the comparison yourself.";

/**
 * The assistant's knowledge is the site itself: profile, expertise, every case study, the journey and a set of
 * extra facts — so what the chat says never drifts from what the pages say. Owner-added facts from knowledge.md in
 * the private data repository are appended (optional).
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

  // a short pinned line, so "what do you sell / what products" always finds both, whatever else is retrieved
  add({
    id: "products",
    pinned: true,
    title: "Taha's own products / محصولات طاها",
    tags: ["products", "محصول", "محصولات", ...PRODUCTS.flatMap((x) => [x.name.en, x.name.fa])],
    body: [
      ...PRODUCTS.map((x) => `- ${x.name.en} (${x.name.fa}) [[product:${x.slug}]]: ${x.category.en.replace(/^Product · /, "")} — ${x.tagline.en}. Web version (live): ${x.editions.find((e) => e.href)?.href}. ${x.editions.filter((e) => !e.href).map((e) => e.kind).join(" and ")} edition(s) locked: contact Taha to use them.`),
      "The web versions open to everyone; the Windows (and, for Kariz, server) editions are provided by arrangement: the visitor contacts Taha ([[action:ticket]] or [[action:contact]]). Never share installer or download links.",
    ].join("\n"),
  });
  for (const x of PRODUCTS) {
    const web = x.editions.find((e) => e.href);
    add({
      id: `product-${x.slug}`,
      pinned: false,
      title: `Product: ${x.name.en} / ${x.name.fa} [[product:${x.slug}]]`,
      tags: [...x.tags, ...x.stack, x.category.en, x.category.fa],
      body: [
        `Home-page section: /#${x.slug} (Persian) and /en#${x.slug} (English). Marker to link it: [[product:${x.slug}]]`,
        `${x.category.en} / ${x.category.fa}. Tagline: ${x.tagline.en} / ${x.tagline.fa}`,
        `Summary: ${x.summary.en}`,
        `Editions: ${x.editions.map((e) => `${e.kind}${e.href ? ` (live: ${e.href})` : " (locked: contact Taha)"} — ${e.note.en}`).join("; ")}`,
        `Features: ${x.features.en.join("; ")}`,
        `Role: ${x.role.en}. Built: ${x.period.en}. Status: ${x.status.en}.`,
        `Stack: ${x.stack.join(", ")}`,
        x.note ? `Note: ${x.note.en}` : "",
        web ? `To try it, open the web version: ${web.href}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }
  for (const p of POSTS) {
    add({
      id: `post-${p.slug}`,
      pinned: false,
      title: `Blog post: ${p.title.en} / ${p.title.fa} [[post:${p.slug}]]`,
      tags: p.tags,
      body: [
        `Blog post page: /blog/${p.slug} (Persian) and /en/blog/${p.slug} (English), published ${p.date.slice(0, 10)}. Marker to link it: [[post:${p.slug}]]`,
        `Summary: ${p.dek.en} / ${p.dek.fa}`,
        ...p.facts.map((f) => `${f.k.en}: ${f.v.en}`),
        ...p.blocks.flatMap((b) => (b.kind === "text" ? [`${b.heading ? `${b.heading.en}: ` : ""}${strip(b.text.en)}`] : b.kind === "list" ? [`${b.heading?.en ?? ""}: ${b.items.en.join("; ")}`] : [])),
      ].join("\n"),
    });
  }

  add({
    id: "journey",
    pinned: true,
    title: "Career and education / سوابق و تحصیلات",
    tags: ["career", "experience", "education", "سابقه", "تحصیلات", "دانشگاه", "university", "bank", "banks", "بانک", "FDE", "ITSM", ...ORGS.flatMap((o) => [o.name.en, o.name.fa])],
    body: [
      ...JOURNEY.map((r) => {
        const org = ORGS.find((o) => o.key === r.org);
        return `- ${r.period.en}${r.current ? " (current)" : ""}: ${r.title.en} (${r.title.fa})${org ? ` — ${org.name.en} / ${org.name.fa}` : ""}. ${r.body.en}`;
      }),
      UNDATED,
      ITSM_UNSTATED,
    ].join("\n"),
  });

  const banks = ORGS.filter((o) => o.bank);
  add({
    id: "banks",
    pinned: false,
    title: "Banks Taha has worked with / بانک‌هایی که طاها با آن‌ها کار کرده",
    tags: ["bank", "banks", "banking", "بانک", "بانک‌ها", "بانکی", "client", "clients", "مشتری", "کارفرما", ...banks.flatMap((o) => [o.name.en, o.name.fa])],
    body: [
      `Taha has worked for or with ${banks.length} banks: ${banks.filter((o) => o.current).length} now, the others earlier.`,
      ...banks.map((o) => `- ${o.name.en} (${o.name.fa}), ${o.current ? "current" : "earlier, finished"}: ${o.relation.en} / ${o.relation.fa}`),
      UNDATED,
      ITSM_UNSTATED,
      "Details of each engagement are in the career entry. Bank systems' internal details stay confidential.",
    ].join("\n"),
  });

  for (const f of FACTS) add({ id: f.id, pinned: f.pinned ?? false, title: f.title, tags: f.tags, body: f.body });
  return out;
}

async function loadExtra(_repo: string): Promise<KnowledgeEntry[]> {
  if (!ghConfigured()) throw new GhError("not configured", 0);
  const f = await getFile(KNOWLEDGE_FILE);
  return (f ? parseKnowledgeFile(f.text) : []).map((x, i) => ({ id: `extra-${i}`, title: x.title, body: x.body, tags: x.tags, pinned: false, enabled: true, sort: 1000 + i }));
}

// failures throw and are never cached; a save in the panel refreshes the tag at once
const cachedExtra = unstable_cache(loadExtra, ["portfolio-knowledge-v2"], { tags: ["knowledge"], revalidate: 300 });

export async function getKnowledge(): Promise<KnowledgeEntry[]> {
  let extra: KnowledgeEntry[] = [];
  if (ghConfigured()) {
    try {
      extra = await cachedExtra(env.githubRepo);
    } catch (e) {
      console.error("[knowledge] extra facts unavailable", e instanceof Error ? e.message : e);
    }
  }
  return [...siteKnowledge(), ...extra];
}
