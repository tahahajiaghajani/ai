// Small, safe bridge from the page to the Windows app (printing, folders, LAN client mode).
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("taraz", {
  isDesktop: true,
  version: process.env.npm_package_version ?? "",
  print: (opts?: { silent?: boolean; printer?: string; landscape?: boolean; pageSize?: string }) => ipcRenderer.invoke("taraz:print", opts ?? {}),
  printers: () => ipcRenderer.invoke("taraz:printers"),
  savePdf: (name: string) => ipcRenderer.invoke("taraz:save-pdf", name),
  openPath: (p: string) => ipcRenderer.invoke("taraz:open-path", p),
  setServer: (url: string | null) => ipcRenderer.invoke("taraz:set-server", url),
  relaunch: () => ipcRenderer.invoke("taraz:relaunch"),
});
