// What a page shows when it throws while rendering. Without a boundary React unmounts the whole app — the sidebar,
// the header and every other page go blank until a reload (docs/qa/CLICKTHROUGH.md). The boundary keeps the shell:
// only the page is replaced by the empty state of components.md §7 with «تلاش دوباره» (renders the page again) and
// «بازگشت به پیشخوان». App.tsx wraps every page of the organisation in one and the whole app in another (sign-in
// pages, the platform console, published pages).
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "antd";
import { TriangleAlert, RotateCw } from "lucide-react";

export interface CrashState {
  error: Error | null;
}

/** The text of what was thrown, for the «جزئیات» line (never the stack). */
export function crashMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return typeof error === "string" ? error : "خطای ناشناخته";
}

/** An error boundary around one page (or the whole app with `home`). */
export class PageBoundary extends Component<{ children: ReactNode; home?: string | null }, CrashState> {
  state: CrashState = { error: null };

  static getDerivedStateFromError(error: unknown): CrashState {
    return { error: error instanceof Error ? error : new Error(crashMessage(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // stays in the console (and in the click-through crawler's report) with the component stack
    console.error("page crashed:", error, info.componentStack ?? "");
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const home = this.props.home;
    return (
      <div className="sh-empty ds-enter" role="alert" data-crash="">
        <span className="sh-empty-tile" aria-hidden>
          <TriangleAlert size={28} strokeWidth={1.4} absoluteStrokeWidth />
        </span>
        <h1 className="sh-empty-t">این صفحه با خطا روبه‌رو شد</h1>
        <p className="sh-empty-d">دوباره امتحان کنید؛ اگر باز هم دیدید، نشانی صفحه و متن زیر را برای پشتیبانی بفرستید.</p>
        <p className="sh-empty-d ds-ltr" dir="ltr">{crashMessage(error)}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="primary" icon={<RotateCw size={16} strokeWidth={1.4} absoluteStrokeWidth />} onClick={() => this.setState({ error: null })}>
            تلاش دوباره
          </Button>
          {home !== null ? (
            <Button href={home ?? "/"}>بازگشت به پیشخوان</Button>
          ) : null}
        </div>
      </div>
    );
  }
}
