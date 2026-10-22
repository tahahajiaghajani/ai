"use client";

import { deleteChats, reviewChat } from "@/app/actions/admin";
import { useAction } from "@/components/admin/toast";

export function ChatReviewButtons({ id, reviewed, cleanup }: { id?: string; reviewed?: boolean; cleanup?: boolean }) {
  const { pending, run } = useAction();
  if (cleanup)
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const days = prompt("گفتگوهای قدیمی‌تر از چند روز حذف شوند؟", "90");
          if (days) run(() => deleteChats({ olderThanDays: Number(days) }));
        }}
        className="inline-flex h-10 items-center rounded-full border border-line px-4 text-sm text-muted hover:text-fg"
      >
        پاک‌سازی گفتگوهای قدیمی
      </button>
    );
  return (
    <button type="button" disabled={pending} onClick={() => run(() => reviewChat(id!, !reviewed), { silent: true })} className="inline-flex h-10 items-center rounded-full border border-line px-4 text-sm text-muted hover:text-fg">
      {reviewed ? "برگرداندن به بررسی‌نشده" : "✓ بررسی شد"}
    </button>
  );
}
