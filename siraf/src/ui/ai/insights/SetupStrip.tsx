// The AI status strip on the dashboard, for members who manage AI (ai:full) only: AI is not set up yet, a connection
// needs attention, or the budget stopped it. A deliberate «خاموش» shows nothing. «بعداً» hides the set-up prompt on
// this device; problems always show.
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "antd";
import { CircleAlert, Wallet } from "lucide-react";
import { AiIcon } from "../../components/shell/icons";
import { aiErrorText } from "@shared/ai/errors";
import { useOrg } from "../../lib/org";
import { useAiStatus } from "../kit/hooks";
import { stripOf } from "../kit/model";

const LATER = "siraf.ai.setup-later";

function laterSet(orgId: string): boolean {
  try {
    return localStorage.getItem(`${LATER}.${orgId}`) === "1";
  } catch {
    return false;
  }
}

export function SetupStrip() {
  const { orgId, can } = useOrg();
  const nav = useNavigate();
  const q = useAiStatus(can("ai", "full"));
  const [later, setLater] = useState(() => laterSet(orgId));
  const s = q.data;
  const kind = stripOf(s);
  if (!s || !kind || (kind === "setup" && later)) return null;
  const go = (p: string) => () => nav(`/${orgId}/settings/ai${p}`);
  const err = kind === "problem" && s.kind ? aiErrorText(s.kind, { canManage: true, desktop: s.mode === "desktop" }) : null;
  const view =
    kind === "setup"
      ? {
          icon: AiIcon,
          title: "هوش مصنوعی را راه‌اندازی کنید",
          text: "با کلید API یکی از سرویس‌ها، دستیار، تحلیل گزارش‌ها، خواندن فاکتور از عکس و پیش‌بینی‌ها به کار می‌افتد.",
          action: (
            <Button type="primary" onClick={go("?add=1")}>
              راه‌اندازی هوش مصنوعی
            </Button>
          ),
        }
      : kind === "budget"
        ? {
            icon: Wallet,
            title: "بودجهٔ هوش مصنوعی تمام شده است",
            text: "تا دورهٔ بعد درخواستی به مدل‌ها فرستاده نمی‌شود؛ بینش‌ها بدون مدل ادامه دارند.",
            action: <Button onClick={go("?tab=usage")}>مصرف و بودجه</Button>,
          }
        : {
            icon: CircleAlert,
            title: err?.title ?? "هوش مصنوعی پاسخ نمی‌دهد",
            text: s.remedy_fa ?? err?.remedy ?? s.message_fa ?? "",
            action: <Button onClick={go("")}>بررسی اتصال‌ها</Button>,
          };
  return (
    <section className="db-card ai-strip" aria-label={view.title}>
      <span className="ai-strip-ic" aria-hidden>
        <view.icon size={20} strokeWidth={1.4} absoluteStrokeWidth />
      </span>
      <div className="ai-strip-t">
        <b>{view.title}</b>
        <span>{view.text}</span>
      </div>
      <div className="ai-strip-x">
        {kind === "setup" ? (
          <Button
            type="text"
            onClick={() => {
              try {
                localStorage.setItem(`${LATER}.${orgId}`, "1");
              } catch {
                /* blocked storage: hide for this visit only */
              }
              setLater(true);
            }}
          >
            بعداً
          </Button>
        ) : null}
        {view.action}
      </div>
    </section>
  );
}
