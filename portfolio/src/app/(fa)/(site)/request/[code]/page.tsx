import type { Metadata } from "next";
import { Tracking } from "@/components/request/tracking";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "پیگیری درخواست", robots: { index: false, follow: false } };

export default async function Page({ params, searchParams }: PageProps<"/request/[code]">) {
  const { code } = await params;
  const { k } = await searchParams;
  return <Tracking lang="fa" code={code} k={typeof k === "string" ? k : undefined} />;
}
