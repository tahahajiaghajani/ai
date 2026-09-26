"use client";
import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Button, Field, Input } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { deleteProjectAction } from "@/app/actions/tasks";
import { faNum } from "@/lib/utils";
import type { Task } from "@/lib/types";

/** Confirmation for deleting a whole project; the admin types the project code to confirm. */
export function DeleteProjectDialog({ task, open, onOpenChange, onDeleted }: { task: Task; open: boolean; onOpenChange: (o: boolean) => void; onDeleted?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [root, setRoot] = React.useState<{ code: string; title: string; count: number } | null>(null);
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setTyped("");
    const rootId = task.root_id ?? task.id;
    const sb = supabaseBrowser();
    void Promise.all([
      sb.from("tasks").select("code, title").eq("id", rootId).maybeSingle<{ code: string; title: string }>(),
      sb.from("tasks").select("id", { count: "exact", head: true }).eq("root_id", rootId),
    ]).then(([r, c]) => setRoot({ code: r.data?.code ?? task.code, title: r.data?.title ?? task.title, count: 1 + (c.count ?? 0) }));
  }, [open, task.id, task.root_id, task.code, task.title]);

  const remove = async () => {
    setBusy(true);
    const r = await deleteProjectAction(task.id, typed);
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    const d = r.data;
    toast.success(`پروژه‌ی ${d.code} حذف شد: ${faNum(d.tasks)} تسک، ${faNum(d.files)} فایل، ${faNum(d.knowledge)} مورد دانش، ${faNum(d.github)} فایل در GitHub`);
    for (const w of d.warnings) toast.warning(w);
    onOpenChange(false);
    onDeleted?.();
    if (pathname.startsWith("/tasks/")) router.push("/dashboard");
    else router.refresh();
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="حذف کامل پروژه"
      description="این کار برگشت‌پذیر نیست."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
          <Button variant="danger" loading={busy} disabled={!root || typed.trim() !== root.code} onClick={() => void remove()}>
            <Trash2 className="size-4" /> حذف همیشگی
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm leading-7">
        <p>
          پروژه‌ی <b className="ltr inline-block">{root?.code ?? "…"}</b> «{root?.title ?? task.title}»
          {root && root.count > 1 ? ` همراه ${faNum(root.count - 1)} تسک مرتبط` : ""} و همه‌ی این موارد حذف می‌شوند:
        </p>
        <ul className="list-disc space-y-0.5 ps-5 text-muted">
          <li>تسک‌ها، لاگ‌ها، اجراها و گفت‌وگوهای Gemini و Claude</li>
          <li>فایل‌های بارگذاری‌شده و فایل‌های خروجی</li>
          <li>دانش استخراج‌شده از این پروژه در پایگاه دانش</li>
          <li>پوشه‌ی پروژه و یادداشت‌های دانش آن در مخزن GitHub</li>
        </ul>
        <Field label={<>برای تایید، کد پروژه (<span className="ltr inline-block">{root?.code ?? "…"}</span>) را بنویسید</>}>
          <Input dir="ltr" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={root?.code} />
        </Field>
      </div>
    </Modal>
  );
}
