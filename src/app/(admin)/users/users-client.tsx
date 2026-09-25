"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, MoreHorizontal, ShieldCheck, UserCheck, UserPlus, UserX } from "lucide-react";
import { Avatar, Badge, Button, Card, CardHeader, Field, Input } from "@/components/ui/primitives";
import { Menu, Modal } from "@/components/ui/overlays";
import { createUserAction, resetUserPasswordAction, setUserRoleAction, setUserStatusAction } from "@/app/actions/admin";
import { formatJalali, timeAgo } from "@/lib/jalali";
import { faNum } from "@/lib/utils";
import type { Profile } from "@/lib/types";

export function UsersClient({ me, profiles, stats }: { me: string; profiles: Profile[]; stats: Record<string, { total: number; open: number }> }) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [resetFor, setResetFor] = React.useState<Profile | null>(null);
  const [form, setForm] = React.useState({ full_name: "", email: "", password: "", org_unit: "", phone: "" });
  const [pw, setPw] = React.useState("");
  const pending = profiles.filter((p) => p.status === "pending");
  const rest = profiles.filter((p) => p.status !== "pending");

  const act = async (p: Promise<{ ok: boolean; error?: string }>, msg: string) => {
    const r = await p;
    if (r.ok) {
      toast.success(msg);
      router.refresh();
    } else toast.error(r.error ?? "خطا");
    return r.ok;
  };

  const row = (p: Profile) => (
    <div key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      <Avatar name={p.full_name ?? p.email ?? "?"} src={p.avatar_url} size={38} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-bold">
          {p.full_name}
          {p.role === "admin" ? <Badge tone="violet">مدیر</Badge> : null}
          {p.status === "disabled" ? <Badge tone="danger">غیرفعال</Badge> : null}
        </p>
        <p className="ltr truncate text-start text-xs text-muted">{p.email}</p>
        <p className="text-xs text-faint">
          {p.org_unit ?? "—"} · عضویت {formatJalali(p.created_at)} {p.last_seen_at ? `· آخرین بازدید ${timeAgo(p.last_seen_at)}` : ""}
        </p>
      </div>
      <div className="text-center text-xs text-muted">
        <p className="text-lg font-black text-fg">{faNum(stats[p.id]?.open ?? 0)}</p>
        باز از {faNum(stats[p.id]?.total ?? 0)}
      </div>
      {p.status === "pending" ? (
        <div className="flex gap-2">
          <Button size="sm" variant="success" onClick={() => act(setUserStatusAction(p.id, "active"), "حساب فعال شد")}>
            <UserCheck className="size-4" /> تایید
          </Button>
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => act(setUserStatusAction(p.id, "disabled"), "رد شد")}>
            <UserX className="size-4" /> رد
          </Button>
        </div>
      ) : p.id !== me ? (
        <Menu
          trigger={
            <Button size="icon" variant="ghost" aria-label="عملیات">
              <MoreHorizontal className="size-5" />
            </Button>
          }
          items={[
            p.status === "active"
              ? { label: "غیرفعال کردن", icon: <UserX className="size-4" />, onSelect: () => void act(setUserStatusAction(p.id, "disabled"), "غیرفعال شد"), danger: true }
              : { label: "فعال کردن", icon: <UserCheck className="size-4" />, onSelect: () => void act(setUserStatusAction(p.id, "active"), "فعال شد") },
            p.role === "admin"
              ? { label: "تبدیل به تسک‌دهنده", icon: <ShieldCheck className="size-4" />, onSelect: () => void act(setUserRoleAction(p.id, "requester"), "نقش تغییر کرد") }
              : { label: "تبدیل به مدیر", icon: <ShieldCheck className="size-4" />, onSelect: () => void act(setUserRoleAction(p.id, "admin"), "نقش تغییر کرد") },
            { label: "تعیین رمز عبور جدید", icon: <KeyRound className="size-4" />, onSelect: () => setResetFor(p) },
          ]}
        />
      ) : (
        <Badge>شما</Badge>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">کاربران</h1>
          <p className="mt-1 text-sm text-muted">تسک‌دهنده‌ها پس از ثبت‌نام تا تایید شما فقط صفحه‌ی انتظار را می‌بینند. می‌توانید مستقیماً هم برایشان حساب بسازید.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <UserPlus className="size-4" /> ساخت حساب تسک‌دهنده
        </Button>
      </div>

      {pending.length ? (
        <Card className="border-amber-500/40">
          <CardHeader title={`درخواست‌های عضویت (${faNum(pending.length)})`} subtitle="قبل از تایید، هویت فرد را بررسی کنید" />
          <div className="divide-y divide-line">{pending.map(row)}</div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={`همه‌ی کاربران (${faNum(rest.length)})`} />
        <div className="divide-y divide-line">{rest.map(row)}</div>
      </Card>

      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="ساخت حساب تسک‌دهنده"
        description="حساب فوراً فعال می‌شود؛ ایمیل و رمز را به فرد بدهید (نیازی به ایمیل تایید نیست)."
        footer={
          <Button onClick={async () => {
            const ok = await act(createUserAction(form), "حساب ساخته شد");
            if (ok) {
              setCreating(false);
              setForm({ full_name: "", email: "", password: "", org_unit: "", phone: "" });
            }
          }}>
            ساخت حساب
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="نام و نام خانوادگی" required>
            <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </Field>
          <Field label="واحد / بانک / سازمان">
            <Input value={form.org_unit} onChange={(e) => setForm({ ...form, org_unit: e.target.value })} />
          </Field>
          <Field label="ایمیل" required>
            <Input type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="موبایل">
            <Input dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="رمز عبور اولیه" required hint="حداقل ۸ کاراکتر" className="sm:col-span-2">
            <Input dir="ltr" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!resetFor}
        onOpenChange={(o) => !o && setResetFor(null)}
        title={`رمز جدید برای ${resetFor?.full_name ?? ""}`}
        footer={
          <Button onClick={async () => {
            if (resetFor && (await act(resetUserPasswordAction(resetFor.id, pw), "رمز عبور تغییر کرد"))) {
              setResetFor(null);
              setPw("");
            }
          }}>
            ذخیره
          </Button>
        }
      >
        <Field label="رمز عبور جدید" hint="حداقل ۸ کاراکتر">
          <Input dir="ltr" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
