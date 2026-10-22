"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { Copy } from "@/content/fa";
import type { Lang } from "@/lib/i18n";
import { closeTicket, replyTicket } from "@/app/actions/support";
import { Button, Spinner, Textarea } from "@/components/ui/field";
import { Icon } from "@/components/site/icons";

/** Reply box, close / resolve actions, satisfaction rating and live refresh. */
export function TicketActions({ lang, t, code, k, status, rating }: { lang: Lang; t: Copy["ticket"]; code: string; k: string; status: string; rating: number | null }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [stars, setStars] = useState(0);
  const [note, setNote] = useState("");
  const [rated, setRated] = useState(Boolean(rating));

  // keep the thread fresh while the page is visible
  useEffect(() => {
    const id = window.setInterval(() => document.visibilityState === "visible" && router.refresh(), 20000);
    return () => window.clearInterval(id);
  }, [router]);

  const closed = status === "closed";
  const canRate = (status === "resolved" || status === "closed") && !rated;

  return (
    <div className="space-y-5">
      {canRate && (
        <div className="card p-6">
          <h3 className="font-bold">{t.rateTitle}</h3>
          <div className="mt-3 flex gap-1.5" dir="ltr">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setStars(n)} aria-label={String(n)} className={`text-3xl transition ${n <= stars ? "text-warning" : "text-white/15 hover:text-white/30"}`}>
                ★
              </button>
            ))}
          </div>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.rateNote} className="mt-4 !min-h-20" maxLength={500} />
          <div className="mt-4 flex justify-end">
            <Button
              disabled={!stars || pending}
              onClick={() =>
                start(async () => {
                  const r = await closeTicket({ code, key: k, status: status === "closed" ? "closed" : "resolved", rating: stars, note, lang });
                  if (r.ok) setRated(true);
                })
              }
            >
              {t.rateSend}
            </Button>
          </div>
        </div>
      )}
      {rated && (status === "resolved" || status === "closed") && <p className="text-center text-sm text-success">{t.rated}</p>}

      {closed ? (
        <p className="rounded-2xl border border-line bg-ink-2 px-5 py-4 text-sm text-muted">{t.closedNote}</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            start(async () => {
              const r = await replyTicket({ code, key: k, body, lang });
              if (!r.ok) return setError(r.error);
              setBody("");
              router.refresh();
            });
          }}
          className="card p-5 sm:p-6"
        >
          <label htmlFor="reply" className="mb-2 block text-sm font-semibold">
            {t.reply}
          </label>
          <Textarea id="reply" value={body} onChange={(e) => setBody(e.target.value)} placeholder={t.replyPh} rows={4} maxLength={6000} dir="auto" required />
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {status !== "resolved" && (
                <Button
                  type="button"
                  variant="soft"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await closeTicket({ code, key: k, status: "resolved", lang });
                      router.refresh();
                    })
                  }
                >
                  <Icon name="check" className="size-4 text-success" />
                  {t.resolved}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    await closeTicket({ code, key: k, status: "closed", lang });
                    router.refresh();
                  })
                }
              >
                {t.close}
              </Button>
            </div>
            <Button type="submit" disabled={pending || body.trim().length < 2}>
              {pending ? (
                <>
                  <Spinner />
                  {t.sending}
                </>
              ) : (
                t.send
              )}
            </Button>
          </div>
        </form>
      )}
      <p className="text-center text-xs text-faint">{t.live}</p>
    </div>
  );
}
