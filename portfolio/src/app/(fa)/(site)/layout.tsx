import { SiteShell } from "@/components/site/site-shell";

export default function FaSite({ children }: { children: React.ReactNode }) {
  return <SiteShell lang="fa">{children}</SiteShell>;
}
