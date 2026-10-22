"use client";

import { useState } from "react";
import { createUserAccount, deleteUserAccount, setUserDisabled, setUserPassword, setUserRole } from "@/app/actions/users";
import type { UserRow } from "@/lib/users";
import { formatDate } from "@/lib/i18n";
import { Button, Input, Select, Spinner } from "@/components/ui/field";
import { Empty, Panel } from "@/components/admin/ui";
import { useAction } from "@/components/admin/toast";

const fa = (n: number) => new Intl.NumberFormat("fa-IR").format(n);

export function UsersManager({ rows, meId }: { rows: UserRow[]; meId: string | null }) {
  const [q, setQ] = useState("");
  const shown = rows.filter((u) => !q.trim() || `${u.name} ${u.email} ${u.organization}`.toLowerCase().includes(q.trim().toLowerCase()));
  const admins = rows.filter((u) => u.role === "admin").length;
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی نام، ایمیل یا سازمان…" aria-label="جستجوی کاربران" className="h-11 min-w-48 flex-1 rounded-full border border-line bg-ink-2 px-4 text-sm outline-none focus:border-violet/60" />
          <span className="text-xs text-muted">
            {fa(rows.length)} کاربر · {fa(admins)} مدیر
          </span>
        </div>
        {shown.length === 0 ? (
          <Empty>{rows.length ? "کاربری با این جستجو پیدا نشد." : "هنوز کسی ثبت‌نام نکرده است."}</Empty>
        ) : (
          <ul className="space-y-2.5">
            {shown.map((u) => (
              <UserCard key={u.id} u={u} self={u.id === meId} />
            ))}
          </ul>
        )}
      </div>
      <div className="xl:sticky xl:top-8 xl:self-start">
        <NewUser />
      </div>
    </div>
  );
}

function UserCard({ u, self }: { u: UserRow; self: boolean }) {
  const { pending, run } = useAction();
  return (
    <li className={`card p-5 ${u.disabled ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{u.name || "—"}</span>
            {u.role === "admin" && <span className="rounded-full bg-violet/15 px-2 py-0.5 text-[11px] text-violet">مدیر</span>}
            {u.disabled && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[11px] text-danger">غیرفعال</span>}
            {self && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-muted">شما</span>}
          </div>
          <div className="ltr mt-1 truncate text-sm text-muted rtl:text-right">{u.email}</div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-faint">
            {u.organization && <span>{u.organization}</span>}
            {u.phone && <span className="ltr">{u.phone}</span>}
            <span>عضویت: {formatDate(u.created_at, "fa", false)}</span>
            <span>آخرین ورود: {u.last_sign_in_at ? formatDate(u.last_sign_in_at, "fa") : "—"}</span>
            <span>{fa(u.tickets)} درخواست</span>
          </div>
        </div>
        {pending && <Spinner />}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {!self && (
          <Button variant="soft" disabled={pending} onClick={() => run(() => setUserRole(u.id, u.role === "admin" ? "user" : "admin"))}>
            {u.role === "admin" ? "برداشتن دسترسی مدیر" : "مدیر کردن"}
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            const p = window.prompt("رمز تازه برای این کاربر (دست‌کم ۸ نویسه):");
            if (p) run(() => setUserPassword(u.id, p));
          }}
        >
          تعیین رمز تازه
        </Button>
        {!self && (
          <Button variant="ghost" disabled={pending} onClick={() => run(() => setUserDisabled(u.id, !u.disabled))}>
            {u.disabled ? "فعال کردن" : "غیرفعال کردن"}
          </Button>
        )}
        {!self && (
          <Button
            variant="ghost"
            disabled={pending}
            className="text-danger"
            onClick={() => window.confirm(`حساب ${u.email} برای همیشه حذف شود؟ درخواست‌هایش در پنل می‌ماند.`) && run(() => deleteUserAccount(u.id))}
          >
            حذف
          </Button>
        )}
      </div>
    </li>
  );
}

function NewUser() {
  const { pending, run } = useAction();
  return (
    <Panel title="کاربر تازه" sub="برای همکاران یا مشتریانی که خودشان ثبت‌نام نمی‌کنند.">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          run(
            () =>
              createUserAccount({
                name: String(fd.get("name") ?? ""),
                email: String(fd.get("email") ?? ""),
                password: String(fd.get("password") ?? ""),
                role: fd.get("role") === "admin" ? "admin" : "user",
              }),
            { onOk: () => form.reset() },
          );
        }}
      >
        <Input name="name" placeholder="نام و نام خانوادگی" aria-label="نام" required />
        <Input name="email" type="email" placeholder="ایمیل" aria-label="ایمیل" dir="ltr" required />
        <Input name="password" type="text" placeholder="رمز عبور (دست‌کم ۸ نویسه)" aria-label="رمز عبور" dir="ltr" minLength={8} autoComplete="off" required />
        <Select name="role" aria-label="نقش" defaultValue="user">
          <option value="user">کاربر</option>
          <option value="admin">مدیر</option>
        </Select>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Spinner /> : null} ساخت کاربر
        </Button>
      </form>
    </Panel>
  );
}
