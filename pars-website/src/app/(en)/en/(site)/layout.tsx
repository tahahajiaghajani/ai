import { SiteChrome } from "@/components/site/site-chrome";

export default function EnSite({ children }: { children: React.ReactNode }) {
  return <SiteChrome lang="en">{children}</SiteChrome>;
}
