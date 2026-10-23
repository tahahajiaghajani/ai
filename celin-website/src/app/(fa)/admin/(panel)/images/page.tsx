import { requireAdminPage } from "@/lib/admin-auth";
import { listLibrary } from "@/lib/admin-media";
import { db } from "@/lib/db";
import { getSlotsFresh } from "@/lib/slots";
import { SLOTS } from "@/content/slots";
import { SEED_MEDIA } from "@/content/seed-media";
import type { Media } from "@/lib/media";
import { DbMissing, PageHeader, Tabs } from "@/components/admin/ui";
import { SlotsBoard, type SlotInfo } from "@/components/admin/site-images";
import { MediaLibrary } from "@/components/admin/media-library";

export const metadata = { title: "تصاویر سایت" };

export default async function ImagesPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  await requireAdminPage();
  const tab = (await searchParams).tab === "library" ? "library" : "slots";
  const tabs = (
    <Tabs
      active={tab}
      items={[
        { key: "slots", label: "تصاویر طراحی سایت", href: "/admin/images?tab=slots", count: SLOTS.length },
        { key: "library", label: "کتابخانه‌ی تصاویر", href: "/admin/images?tab=library" },
      ]}
    />
  );
  if (!db())
    return (
      <>
        <PageHeader title="تصاویر سایت" />
        {tabs}
        <DbMissing />
      </>
    );

  if (tab === "library") {
    const items = await listLibrary();
    return (
      <>
        <PageHeader title="تصاویر سایت" />
        {tabs}
        {items === null ? <DbMissing /> : <MediaLibrary items={items} />}
      </>
    );
  }

  const slots = await getSlotsFresh();
  const defs: SlotInfo[] = SLOTS.map(({ key, page, section, ratio, mobileRatio, mobile, hint, image, texts }) => ({ key, page, section, ratio, mobileRatio, mobile, hint, image, texts }));
  const defaults: Record<string, Media> = Object.fromEntries(SLOTS.map((s) => [s.key, SEED_MEDIA[s.image]]));
  return (
    <>
      <PageHeader title="تصاویر سایت" />
      {tabs}
      <SlotsBoard defs={defs} slots={slots} defaults={defaults} />
    </>
  );
}
