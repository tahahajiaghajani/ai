import { Empty, LinkButton, PageHeader } from "@/components/admin/ui";

/** notFound() inside the panel (an unknown order, product or member): stays in the panel, in Persian. */
export default function AdminNotFound() {
  return (
    <>
      <PageHeader title="پیدا نشد" />
      <Empty
        title="این مورد پیدا نشد"
        action={
          <LinkButton href="/admin" icon="dashboard">
            بازگشت به پیشخوان
          </LinkButton>
        }
      >
        ممکن است حذف شده باشد یا نشانی آن درست نباشد. از فهرست سفارش‌ها، محصولات یا کاربران دوباره انتخاب کنید.
      </Empty>
    </>
  );
}
