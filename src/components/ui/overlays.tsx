"use client";
import * as React from "react";
import { Dialog as D, Tabs as T, DropdownMenu as DM, Popover as P, Direction } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function RtlProvider({ children }: { children: React.ReactNode }) {
  return <Direction.Provider dir="rtl">{children}</Direction.Provider>;
}

// ---------------------------------------------------------------- Dialog (centered on desktop, bottom sheet on mobile)
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const width = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl", xl: "sm:max-w-5xl" }[size];
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] data-[state=open]:animate-[float-in_.2s_ease]" />
        <D.Content
          dir="rtl"
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border border-line bg-elevated shadow-pop outline-none",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl",
            "data-[state=open]:animate-float-in",
            width,
          )}
        >
          <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-line-strong sm:hidden" />
          <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4 sm:px-6 sm:pt-5">
            <div>
              <D.Title className="text-lg font-extrabold">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{String(title)}</D.Description>}
            </div>
            <D.Close className="rounded-xl p-2 text-muted hover:bg-surface-muted hover:text-fg" aria-label="بستن">
              <X className="size-5" />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 sm:px-6">{children}</div>
          {footer ? <div className="safe-bottom flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3 sm:px-6">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// ---------------------------------------------------------------- Side drawer (task quick view)
export function Drawer({ open, onOpenChange, children, title }: { open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode; title: string }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <D.Content
          dir="rtl"
          className="fixed inset-y-0 left-0 z-50 flex w-full max-w-2xl flex-col border-r border-line bg-elevated shadow-pop outline-none data-[state=open]:animate-float-in"
        >
          <D.Title className="sr-only">{title}</D.Title>
          <D.Description className="sr-only">{title}</D.Description>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export const DrawerClose = D.Close;

// ---------------------------------------------------------------- Tabs
export function Tabs({
  value,
  onValueChange,
  defaultValue,
  items,
  className,
  listClassName,
}: {
  value?: string;
  onValueChange?: (v: string) => void;
  defaultValue?: string;
  items: { value: string; label: React.ReactNode; content: React.ReactNode; badge?: React.ReactNode }[];
  className?: string;
  listClassName?: string;
}) {
  return (
    <T.Root dir="rtl" value={value} onValueChange={onValueChange} defaultValue={defaultValue ?? items[0]?.value} className={className}>
      <T.List className={cn("flex gap-1 overflow-x-auto rounded-2xl border border-line bg-surface p-1 [scrollbar-width:none]", listClassName)}>
        {items.map((it) => (
          <T.Trigger
            key={it.value}
            value={it.value}
            className="flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold text-muted transition data-[state=active]:bg-surface-strong data-[state=active]:text-fg data-[state=active]:shadow-card"
          >
            {it.label}
            {it.badge}
          </T.Trigger>
        ))}
      </T.List>
      {items.map((it) => (
        <T.Content key={it.value} value={it.value} className="mt-4 outline-none data-[state=active]:animate-float-in">
          {it.content}
        </T.Content>
      ))}
    </T.Root>
  );
}

// ---------------------------------------------------------------- Dropdown
export function Menu({ trigger, items, align = "end" }: { trigger: React.ReactNode; items: ({ label: React.ReactNode; icon?: React.ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean } | "sep")[]; align?: "start" | "end" }) {
  return (
    <DM.Root dir="rtl">
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} sideOffset={6} className="z-50 min-w-48 rounded-2xl border border-line bg-elevated p-1.5 shadow-pop data-[state=open]:animate-float-in">
          {items.map((it, i) =>
            it === "sep" ? (
              <DM.Separator key={i} className="my-1 h-px bg-line" />
            ) : (
              <DM.Item
                key={i}
                disabled={it.disabled}
                onSelect={it.onSelect}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-muted",
                  it.danger && "text-danger",
                )}
              >
                {it.icon}
                {it.label}
              </DM.Item>
            ),
          )}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

// ---------------------------------------------------------------- Popover
export function Pop({ trigger, children, open, onOpenChange, className }: { trigger: React.ReactNode; children: React.ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void; className?: string }) {
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content dir="rtl" sideOffset={8} align="end" className={cn("z-50 rounded-2xl border border-line bg-elevated p-3 shadow-pop data-[state=open]:animate-float-in", className)}>
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
