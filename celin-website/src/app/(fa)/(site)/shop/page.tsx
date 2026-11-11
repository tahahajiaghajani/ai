import type { Metadata } from "next";
import { ShopPage } from "@/components/pages/shop-page";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("fa", { path: "/shop", title: "همه‌ی زیورآلات", description: "انگشتر، گردنبند، گوشواره، دستبند و سرویس سلین؛ نگین‌های درخشان با تراش مشابه برلیان، مخراج‌کاری دقیق و آبکاری رودیوم، طلا و شامپاین گلد." });

export default function Page() {
  return <ShopPage lang="fa" />;
}
