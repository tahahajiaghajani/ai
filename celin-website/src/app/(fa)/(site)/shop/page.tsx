import type { Metadata } from "next";
import { ShopPage } from "@/components/pages/shop-page";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("fa", { path: "/shop", title: "همه‌ی زیورآلات", description: "انگشتر، گردنبند، گوشواره، دستبند و سرویس سلین؛ نگین‌های درخشان با تراش اتمی، مخراج‌کاری دقیق و آبکاری رودیوم و طلا." });

export default function Page() {
  return <ShopPage lang="fa" />;
}
