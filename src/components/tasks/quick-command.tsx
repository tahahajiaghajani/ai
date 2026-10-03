"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Bot, FileText, Paperclip, Send, Sparkles, Wand2 } from "lucide-react";
import { Button, Textarea } from "@/components/ui/primitives";
import { Combobox } from "@/components/ui/combobox";
import { FileDropzone, useUploads } from "@/components/ui/file-dropzone";
import { quickCommandAction } from "@/app/actions/tasks";
import { projectFilesAction } from "@/app/actions/projects";
import { cn, faNum } from "@/lib/utils";
import type { DispatchDefaults } from "@/lib/settings";

/**
 * «دستور سریع»: one prompt (also from the phone) becomes a task for yourself and runs right away.
 * The project and the files the prompt names are found automatically — «در پروژه renew فایل
 * audit.cs باگ دارد» — or can be picked by hand.
 */
export function QuickCommand({ userId, defaults, projectId: fixedProject, className, compact }: { userId: string; defaults: DispatchDefaults; projectId?: string; className?: string; compact?: boolean }) {
  const router = useRouter();
  const [prompt, setPrompt] = React.useState("");
  const [projectId, setProjectId] = React.useState(fixedProject ?? "");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [files, setFiles] = React.useState<{ path: string; summary: string | null; symbols: string[] }[] | null>(null);
  const [stage, setStage] = React.useState<"main" | "prework">("main");
  const [attach, setAttach] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [dropKey, setDropKey] = React.useState(0);
  const uploads = useUploads();
  const ready = stage === "main" ? defaults.caps.main : defaults.caps.prework;

  React.useEffect(() => {
    setSelected([]);
    if (!projectId) {
      setFiles(null);
      return;
    }
    let live = true;
    void projectFilesAction(projectId).then((r) => live && setFiles(r.ok ? r.data : []));
    return () => {
      live = false;
    };
  }, [projectId]);

  const send = async () => {
    if (!prompt.trim() || uploads.blocker) return;
    setBusy(true);
    const r = await quickCommandAction({ prompt, projectId: projectId || null, selected, files: uploads.files, stage });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(`${r.data.code} ساخته و ${stage === "main" ? "برای کار اصلی" : "برای پیش‌کار"} ارسال شد${r.data.project ? ` — پروژه‌ی «${r.data.project}» از متن تشخیص داده شد` : ""}`);
    setPrompt("");
    setSelected([]);
    setAttach(false);
    setDropKey((k) => k + 1);
    router.push(`/tasks/${r.data.id}`);
  };

  if (!defaults.caps.ai) {
    return (
      <div className={cn("rounded-2xl border border-dashed border-line p-4 text-sm text-muted", className)}>
        <Wand2 className="me-1 inline size-4" /> دستور سریع با هوش مصنوعی ·{" "}
        <Link href="/settings#connections" className="font-bold text-primary">
          اتصال کلید
        </Link>
      </div>
    );
  }

  return (
    <div className={cn("rounded-2xl border border-line bg-surface-strong p-3 shadow-card sm:p-4", className)}>
      <p className="mb-2 flex items-center gap-2 text-sm font-extrabold">
        <Wand2 className="size-4 text-primary" /> دستور سریع
      </p>
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
        }}
        className={cn("leading-7", compact ? "min-h-20" : "min-h-24")}
        placeholder={fixedProject ? "مثلاً: در فایل audit.cs متد Save باگ دارد؛ پیدا و درستش کن" : "مثلاً: در پروژه renew فایل audit.cs باگ دارد؛ پیدا و درستش کن"}
        dir="auto"
      />
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {!fixedProject && defaults.caps.github ? (
          <Combobox
            options={defaults.projects.map((p) => ({ value: p.id, label: p.name, hint: `${p.slug} · ${faNum(p.files)} فایل`, keywords: p.slug }))}
            value={projectId ? [projectId] : []}
            onChange={(v) => setProjectId(v[0] ?? "")}
            placeholder="پروژه: تشخیص خودکار از متن"
            searchPlaceholder="جستجوی پروژه…"
          />
        ) : null}
        {projectId ? (
          <Combobox
            multiple
            options={(files ?? []).map((f) => ({ value: f.path, label: f.path, ltr: true, hint: f.summary ?? undefined, keywords: f.symbols.join(" "), icon: <FileText className="size-3.5" /> }))}
            value={selected}
            onChange={setSelected}
            disabled={!files?.length}
            placeholder={files === null ? "در حال خواندن فایل‌ها…" : "فایل‌ها: از متن پیدا می‌شوند (اختیاری)"}
            searchPlaceholder="نام فایل، خلاصه یا نام تابع…"
          />
        ) : null}
      </div>
      {attach ? (
        <div className="mt-2">
          <FileDropzone key={dropKey} userId={userId} onChange={uploads.onChange} compact label="فایل‌های جدید برای همین دستور" />
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-line bg-surface p-0.5 text-xs font-bold">
          {(
            [
              { k: "main", label: "کار اصلی", icon: <Bot className="size-3.5" /> },
              { k: "prework", label: "پیش‌کار", icon: <Sparkles className="size-3.5" /> },
            ] as const
          ).map((o) => (
            <button key={o.k} type="button" onClick={() => setStage(o.k)} className={cn("flex items-center gap-1 rounded-lg px-2.5 py-1.5", stage === o.k ? "bg-surface-strong text-fg shadow-card" : "text-muted")}>
              {o.icon} {o.label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setAttach((v) => !v)}>
          <Paperclip className="size-4" /> فایل
        </Button>
        <Button className="ms-auto" loading={busy} disabled={!prompt.trim() || !!uploads.blocker || !ready} title={uploads.blocker ?? (!ready ? "اتصال این مرحله آماده نیست" : undefined)} onClick={() => void send()}>
          <Send className="size-4" /> اجرا
        </Button>
      </div>
      {!ready ? (
        <Link href="/settings#stages" className="mt-2 block text-xs font-semibold text-amber-700 dark:text-amber-300">
          مدل {stage === "main" ? "کار اصلی" : "پیش‌کار"} انتخاب نشده ←
        </Link>
      ) : null}
    </div>
  );
}
