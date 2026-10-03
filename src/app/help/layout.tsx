import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/shell/app-shell";

/** Help for everyone, in the frame of the user's mode. */
export default async function HelpLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  return <AppShell me={me}>{children}</AppShell>;
}
