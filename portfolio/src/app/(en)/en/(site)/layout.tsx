import { SiteShell } from "@/components/site/site-shell";

export default function EnSite({ children }: { children: React.ReactNode }) {
  return <SiteShell lang="en">{children}</SiteShell>;
}
