import type { Metadata } from "next";

export const metadata: Metadata = { title: "مدیریت", robots: { index: false, follow: false } };

export default function AdminRoot({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[100dvh]">{children}</div>;
}
