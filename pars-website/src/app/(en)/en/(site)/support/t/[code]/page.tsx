import type { Metadata } from "next";
import { TicketPage } from "@/components/support/ticket-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Page({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ k?: string }> }) {
  const { code } = await params;
  const { k } = await searchParams;
  return <TicketPage lang="en" code={decodeURIComponent(code)} k={k ?? ""} />;
}
