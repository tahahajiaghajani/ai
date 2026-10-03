import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Task Flow",
    short_name: "Task Flow",
    description: "تسک‌دهی و انجام هوشمند کارها — By Taha Aghajani",
    start_url: "/",
    display: "standalone",
    dir: "rtl",
    lang: "fa",
    background_color: "#060A13",
    theme_color: "#0B1222",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
