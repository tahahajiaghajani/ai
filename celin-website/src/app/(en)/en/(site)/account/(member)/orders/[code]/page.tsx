import type { Metadata } from "next";
import { OrderPage, orderCodeParam } from "@/components/account/order-page";
import { accountCopy } from "@/content/copy/account";
import { memberMetadata } from "@/lib/member";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  return memberMetadata(accountCopy("en").meta.order(orderCodeParam(code)));
}

export default function Page({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <OrderPage lang="en" params={params} searchParams={searchParams} />;
}
