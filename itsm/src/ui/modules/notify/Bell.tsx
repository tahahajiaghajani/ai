// The bell in the top bar: the caller's unread count (refreshed by «زنده» when anything changes) and the notification
// center, a drawer loaded on first open. Kept light: it is part of the first bundle.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Tooltip } from "antd";
import { Bell } from "lucide-react";
import { faDigits } from "@shared/format";
import { Ic } from "../../components/shell/icons";
import { useUnreadCount } from "./api";
import "./notify.css";

const NotificationCenter = lazy(() => import("./NotificationCenter"));

const badge = (n: number) => (n > 99 ? `${faDigits("99")}+` : faDigits(String(n)));

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const count = useUnreadCount();
  const unread = count.data?.unread ?? 0;
  // announce new items to screen readers (not the first load)
  const [said, setSaid] = useState("");
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (count.data === undefined) return;
    if (last.current !== null && unread > last.current) setSaid(`${faDigits(String(unread - last.current))} اعلان تازه`);
    last.current = unread;
  }, [count.data, unread]);

  const label = unread ? `اعلان‌ها، ${faDigits(String(unread))} خوانده‌نشده` : "اعلان‌ها";
  return (
    <>
      <Tooltip title="اعلان‌ها" mouseEnterDelay={0.4}>
        <button
          type="button"
          className="sh-icon-btn nf-bell"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            setMounted(true);
            setOpen(true);
          }}
        >
          <Ic icon={Bell} />
          {unread ? (
            <span className="nf-badge" aria-hidden>
              {badge(unread)}
            </span>
          ) : null}
        </button>
      </Tooltip>
      <span className="ds-sr" aria-live="polite">
        {said}
      </span>
      {mounted ? (
        <Suspense fallback={null}>
          <NotificationCenter open={open} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}
