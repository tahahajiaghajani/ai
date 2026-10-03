import { requireOwner } from "@/lib/auth";
import { getBanner } from "@/lib/banner";
import { BannerEditor } from "./banner-editor";

export const metadata = { title: "اطلاعیه" };

export default async function BannerPage() {
  await requireOwner();
  const banner = await getBanner(true);
  return <BannerEditor initial={banner} />;
}
