// Small, safe bridge from the page to the Windows app of «سیراف» (printing, folders, LAN client mode).
// The page reads it as `window.itsm` (the name from before the rebrand) or `window.itsm`.
import { contextBridge, ipcRenderer } from "electron";

const bridge = {
  isDesktop: true,
  version: process.env.npm_package_version ?? "",
  print: (opts?: { silent?: boolean; printer?: string; landscape?: boolean; pageSize?: string | { width: number; height: number } }) => ipcRenderer.invoke("itsm:print", opts ?? {}),
  printers: () => ipcRenderer.invoke("itsm:printers"),
  savePdf: (name: string) => ipcRenderer.invoke("itsm:save-pdf", name),
  openPath: (p: string) => ipcRenderer.invoke("itsm:open-path", p),
  setServer: (url: string | null) => ipcRenderer.invoke("itsm:set-server", url),
  relaunch: () => ipcRenderer.invoke("itsm:relaunch"),
};
contextBridge.exposeInMainWorld("taraz", bridge);
contextBridge.exposeInMainWorld("siraf", bridge);

// Theme: the page keeps the preference in localStorage["itsm.theme"] and the theme in effect on <html data-theme>
// (src/ui/lib/theme.tsx). Report both to the main process so the title bar, the window canvas behind the page and the
// next start (no white flash) follow the app.
function reportTheme() {
  let pref: string | null = null;
  try {
    pref = localStorage.getItem("itsm.theme");
  } catch {
    /* storage can be blocked */
  }
  const mode = document.documentElement.getAttribute("data-theme");
  if (mode !== "light" && mode !== "dark") return;
  ipcRenderer.send("itsm:theme", { pref: pref ?? "system", mode });
}
let last = "";
function watchTheme() {
  const send = () => {
    const key = `${document.documentElement.getAttribute("data-theme")}|${(() => {
      try {
        return localStorage.getItem("itsm.theme");
      } catch {
        return "";
      }
    })()}`;
    if (key === last) return;
    last = key;
    reportTheme();
  };
  send();
  new MutationObserver(send).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  // a change of preference that keeps the same theme (e.g. dark → system while the system is dark) changes no attribute,
  // and the page's own localStorage writes raise no event here: look again now and then (one storage read)
  window.addEventListener("storage", send);
  setInterval(send, 1500);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchTheme, { once: true });
else watchTheme();
