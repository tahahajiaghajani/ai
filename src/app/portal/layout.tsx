import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/shell/app-shell";

/** The simple app (give, track and update tasks). Full-mode users see these pages in the full frame. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  return <AppShell me={me}>{children}</AppShell>;
}
