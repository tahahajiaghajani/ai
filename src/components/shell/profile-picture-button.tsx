"use client";
import * as React from "react";
import { Camera } from "lucide-react";
import { Avatar, Button } from "@/components/ui/primitives";
import { ProfilePictureDialog } from "@/components/shell/shell-parts";

/** Avatar + "change picture" button for pages without the account menu (e.g. waiting for approval). */
export function ProfilePictureButton({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex flex-col items-center gap-3">
      <Avatar name={name} src={avatarUrl} size={72} />
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Camera className="size-4" /> {avatarUrl ? "تغییر تصویر پروفایل" : "افزودن تصویر پروفایل"}
      </Button>
      <ProfilePictureDialog open={open} onOpenChange={setOpen} name={name} current={avatarUrl} />
    </div>
  );
}
