import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "مدیریت سلین",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminRoot({ children }: { children: React.ReactNode }) {
  return children;
}
