import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CaseStudy } from "@/components/work/case-study";
import { PROJECTS, getProject } from "@/content/projects";
import { pageAlternates } from "@/lib/seo";

export function generateStaticParams() {
  return PROJECTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/en/work/[slug]">): Promise<Metadata> {
  const p = getProject((await params).slug);
  if (!p) return {};
  return { title: p.title.en, description: p.oneLiner.en, alternates: pageAlternates("en", `/work/${p.slug}`) };
}

export default async function Page({ params }: PageProps<"/en/work/[slug]">) {
  const p = getProject((await params).slug);
  if (!p) notFound();
  return <CaseStudy p={p} lang="en" />;
}
