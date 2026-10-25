import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CaseStudy } from "@/components/work/case-study";
import { PROJECTS, getProject } from "@/content/projects";
import { pageMetadata } from "@/lib/seo";

// only the registered case studies exist: any other slug is a 404 at routing, served by the global not-found page
export const dynamicParams = false;

export function generateStaticParams() {
  return PROJECTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/en/work/[slug]">): Promise<Metadata> {
  const p = getProject((await params).slug);
  if (!p) return {};
  return pageMetadata("en", `/work/${p.slug}`, p.title.en, p.oneLiner.en);
}

export default async function Page({ params }: PageProps<"/en/work/[slug]">) {
  const p = getProject((await params).slug);
  if (!p) notFound();
  return <CaseStudy p={p} lang="en" />;
}
