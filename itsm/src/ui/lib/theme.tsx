// The theme provider (design system: src/ui/ds/README.md). Based on the design system's drop-in
// ThemeProvider: a three-way preference (system, light, dark) stored under "itsm.theme", the resolved mode on
// <html data-theme>, antd 6 in RTL with fa_IR inside <StyleProvider layer>, and bottom-left toasts.
// It keeps the API the app already uses: useTheme().dark and useTheme().toggle().
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { App as AntApp, ConfigProvider, type ThemeConfig } from "antd";
import { StyleProvider } from "@ant-design/cssinjs";
import faIR from "antd/locale/fa_IR";
import { dsConfig, DS_PALETTE, type DsMode } from "../ds/ds-theme";

export type ThemePref = "system" | "light" | "dark";
export type { DsMode };

/** localStorage key of the preference. index.html reads the same key before first paint. */
export const THEME_KEY = "itsm.theme";

const media = () => window.matchMedia("(prefers-color-scheme: dark)");
const resolve = (p: ThemePref): DsMode => (p === "system" ? (media().matches ? "dark" : "light") : p);
const isPref = (v: unknown): v is ThemePref => v === "system" || v === "light" || v === "dark";

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (isPref(v)) return v;
  } catch {
    /* private window or blocked storage */
  }
  return "system";
}

export interface ThemeValue {
  /** What the user chose: follow the OS, or a fixed theme. */
  pref: ThemePref;
  /** The theme in effect now. */
  mode: DsMode;
  setPref: (p: ThemePref) => void;
  /** Same as mode === "dark" (kept for the existing screens). */
  dark: boolean;
  /** Switch to the other theme and keep it (a fixed light or dark preference). */
  toggle: () => void;
}

const Ctx = createContext<ThemeValue>({ pref: "system", mode: "light", setPref: () => {}, dark: false, toggle: () => {} });

// LEGACY (remove with the old shell): today's sidebar still renders <Menu theme="dark"> on the dark legacy sidebar
// (--tz-sidebar). The design system styles only the light menu, so antd would fall back to its navy dark menu;
// these tokens give that menu warm ink tones until the shell is rebuilt on the canvas sidebar (components.md §1.2).
function legacyDarkMenu(mode: DsMode): NonNullable<ThemeConfig["components"]>["Menu"] {
  const dark = mode === "dark";
  return {
    darkItemBg: "transparent",
    darkSubMenuItemBg: "transparent",
    darkPopupBg: dark ? DS_PALETTE.dark.raised : "#2B2622",
    darkItemColor: "#D3CEC8",
    darkItemHoverColor: "#FFFFFF",
    darkItemHoverBg: "rgba(255,248,236,0.06)",
    darkItemSelectedBg: "rgba(255,248,236,0.11)",
    darkItemSelectedColor: "#FFFFFF",
    darkGroupTitleColor: "#BAB5AF",
    darkDangerItemColor: DS_PALETTE.dark.danger,
  };
}

function config(mode: DsMode) {
  const c = dsConfig(mode);
  const theme = c.theme ?? {};
  return {
    ...c,
    theme: { ...theme, components: { ...theme.components, Menu: { ...theme.components?.Menu, ...legacyDarkMenu(mode) } } },
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPref] = useState<ThemePref>(readPref);
  const [mode, setMode] = useState<DsMode>(() => resolve(pref));
  useEffect(() => {
    const apply = () => setMode(resolve(pref));
    apply();
    try {
      localStorage.setItem(THEME_KEY, pref);
    } catch {
      /* private window */
    }
    if (pref !== "system") return;
    const m = media();
    m.addEventListener("change", apply);
    return () => m.removeEventListener("change", apply);
  }, [pref]);
  useEffect(() => {
    document.documentElement.dataset.theme = mode; // tokens.css follows this attribute
    // the browser / title-bar colour follows the theme in effect, not only the OS preference
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => (m.content = DS_PALETTE[mode].canvas));
  }, [mode]);
  const cfg = useMemo(() => config(mode), [mode]);
  const value = useMemo<ThemeValue>(
    () => ({ pref, mode, setPref, dark: mode === "dark", toggle: () => setPref(mode === "dark" ? "light" : "dark") }),
    [pref, mode],
  );
  return (
    <Ctx.Provider value={value}>
      <StyleProvider layer>
        <ConfigProvider {...cfg} locale={faIR}>
          {/* toasts: bottom-left (the end corner in RTL), at most 3; `message` is not used for confirmations */}
          <AntApp notification={{ placement: "bottomLeft", maxCount: 3, duration: 4 }} message={{ maxCount: 1, top: 64 }}>
            {children}
          </AntApp>
        </ConfigProvider>
      </StyleProvider>
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);
