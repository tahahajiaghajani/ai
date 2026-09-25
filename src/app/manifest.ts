import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TaskFlow AI — اتوماسیون هوشمند کارها",
    short_name: "TaskFlow",
    description: "مدیریت و اتوماسیون چندعاملی تسک‌ها با Gemini و Claude",
    start_url: "/",
    display: "standalone",
    dir: "rtl",
    lang: "fa",
    background_color: "#070a14",
    theme_color: "#6d4aff",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
