import { requireFull } from "@/lib/auth";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireFull();
  return <AppShell me={me}>{children}</AppShell>;
}
