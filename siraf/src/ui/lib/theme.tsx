import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ConfigProvider, theme as antTheme, App as AntApp } from "antd";
import { StyleProvider } from "@ant-design/cssinjs";
import faIR from "antd/locale/fa_IR";

interface ThemeValue {
  dark: boolean;
  toggle: () => void;
}
const Ctx = createContext<ThemeValue>({ dark: false, toggle: () => {} });

const FONT = 'Vazirmatn, system-ui, "Segoe UI", Tahoma, sans-serif';

function antConfig(dark: boolean) {
  const primary = dark ? "#22a6c4" : "#0e7490";
  return {
    algorithm: dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: {
      colorPrimary: primary,
      colorInfo: primary,
      colorSuccess: dark ? "#22c55e" : "#15803d",
      colorWarning: "#d97706",
      colorError: dark ? "#f87171" : "#dc2626",
      colorLink: primary,
      borderRadius: 8,
      borderRadiusLG: 12,
      fontFamily: FONT,
      fontSize: 13,
      controlHeight: 34,
      colorBgLayout: dark ? "#0a111c" : "#f4f6f9",
      colorBgContainer: dark ? "#101a29" : "#ffffff",
      colorBgElevated: dark ? "#142235" : "#ffffff",
      colorBorder: dark ? "#2a3b52" : "#d4d9e2",
      colorBorderSecondary: dark ? "#1e2b3d" : "#e5e8ee",
      colorText: dark ? "#e2e8f0" : "#0f172a",
      colorTextSecondary: dark ? "#94a3b8" : "#64748b",
      wireframe: false,
    },
    components: {
      Layout: { siderBg: "transparent", headerBg: "transparent", bodyBg: dark ? "#0a111c" : "#f4f6f9" },
      Menu: {
        darkItemBg: "transparent",
        darkSubMenuItemBg: "transparent",
        darkPopupBg: dark ? "#0c1624" : "#102a43",
        darkItemSelectedBg: "rgba(19,163,196,0.22)",
        darkItemSelectedColor: "#ffffff",
        darkItemColor: "#c7d3e0",
        darkItemHoverBg: "rgba(255,255,255,0.06)",
        itemBorderRadius: 8,
        itemMarginInline: 8,
        itemHeight: 38,
        subMenuItemBorderRadius: 8,
        fontSize: 13,
      },
      Table: {
        headerBg: dark ? "#0d1623" : "#f8fafc",
        headerColor: dark ? "#94a3b8" : "#64748b",
        rowHoverBg: dark ? "#132033" : "#f1f7f9",
        cellPaddingBlockSM: 6,
        cellPaddingInlineSM: 8,
        cellPaddingBlock: 10,
        borderColor: dark ? "#1e2b3d" : "#e5e8ee",
      },
      Card: { headerFontSize: 14 },
      Button: { fontWeight: 500, primaryShadow: "none", defaultShadow: "none" },
      Tabs: { horizontalMargin: "0 0 12px 0" },
      Form: { itemMarginBottom: 14, verticalLabelPadding: "0 0 4px" },
      Modal: { titleFontSize: 15 },
      Tag: { defaultBg: dark ? "#142235" : "#f1f5f9" },
    },
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem("taraz.theme", dark ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }, [dark]);
  const value = useMemo(() => ({ dark, toggle: () => setDark((d) => !d) }), [dark]);
  return (
    <Ctx.Provider value={value}>
      <StyleProvider layer>
        <ConfigProvider direction="rtl" locale={faIR} theme={antConfig(dark)}>
          <AntApp message={{ top: 64, maxCount: 3 }} notification={{ placement: "bottomLeft" }}>
            {children}
          </AntApp>
        </ConfigProvider>
      </StyleProvider>
    </Ctx.Provider>
  );
}

export function useTheme() {
  return useContext(Ctx);
}
