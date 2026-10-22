import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "مدیریت پروژه پارس — Pars Project Management",
    short_name: "Pars",
    description: "جایی که مدیریت و هوش به هم می‌رسند.",
    start_url: "/",
    display: "standalone",
    background_color: "#07061a",
    theme_color: "#07061a",
    lang: "fa",
    dir: "rtl",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
