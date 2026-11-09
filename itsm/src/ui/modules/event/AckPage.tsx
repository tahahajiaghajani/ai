// The acknowledgement page of a page (/p/ack/:token, no sign-in): what the paged person was called for — the alert's
// message, number, severity and state, never people or ids — and one button that acknowledges it on their behalf.
// Acknowledging needs the button (a link preview or a mail scanner opening the link never acknowledges anything).
import { useState } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { Check } from "lucide-react";
import { ApiError } from "../../lib/api";
import { ICON14 } from "../../components/blocks";
import { Chip, EmptyState, Loader } from "../../components/display";
import { ackApi, type AckView } from "./api";
import { severityTone } from "./model";
import "./event.css";

export default function AckPage() {
  const { token = "" } = useParams();
  const q = useQuery({ queryKey: ["public-ack", token], queryFn: () => ackApi.view(token), retry: (n, e) => !(e instanceof ApiError && (e.status === 404 || e.status === 429)) && n < 2 });
  const [done, setDone] = useState<AckView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (q.isLoading) return <Loader />;
  const v = done ?? q.data;
  if (!v) return <EmptyState title="این پیوند فراخوان معتبر نیست" description="پیوند عوض شده یا منقضی شده است؛ هشدار را در برنامه باز کنید." />;
  const ack = async () => {
    setBusy(true);
    setError(null);
    try {
      setDone(await ackApi.ack(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "تأیید انجام نشد");
    } finally {
      setBusy(false);
    }
  };
  // the link acts once: only while its page still waits for an answer and the alert for an acknowledgement
  const waiting = ["open", "flapping", "snoozed", "maintenance"].includes(v.state) && !v.expired && ["queued", "sent"].includes(v.page_state);
  return (
    <div className="ev-ack">
      <div className="ev-ack-card">
        <span className="ds-num ltr text-[12.5px] text-ink-3">{v.number}</span>
        <h1>{v.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={severityTone(v.severity)}>{v.severity_label}</Chip>
          <span className="text-[13px] text-ink-2">وضعیت: {v.state_label}</span>
        </div>
        {done?.changed ? (
          <p className="m-0 text-[14px] text-in">هشدار تأیید شد؛ ارتقا متوقف شد و تیم می‌داند شما پیگیری می‌کنید.</p>
        ) : v.expired ? (
          <p className="m-0 text-[13px] text-ink-2">مهلت این پیوند گذشته است؛ هشدار را در برنامه باز کنید.</p>
        ) : waiting ? (
          <Button type="primary" size="large" icon={<Check {...ICON14} />} loading={busy} onClick={ack}>
            تأیید هشدار
          </Button>
        ) : v.page_state === "acknowledged" ? (
          <p className="m-0 text-[13px] text-ink-2">این فراخوان را پیش‌تر تأیید کرده‌اید.</p>
        ) : (
          <p className="m-0 text-[13px] text-ink-2">این فراخوان دیگر منتظر پاسخ نیست؛ هشدار را در برنامه باز کنید.</p>
        )}
        {error ? <p className="m-0 text-[13px] text-danger">{error}</p> : null}
      </div>
    </div>
  );
}
