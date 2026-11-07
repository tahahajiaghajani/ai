// Record extensions of the channel tables, kept light for the module's index: the widgets themselves load with the
// record page (ChannelWidgets.tsx). New SMS gateways can start from a preset: `…/new?kind=sms&preset=kavenegar`.
import { lazy, Suspense } from "react";
import { SMS_PRESETS } from "@shared/notify";
import type { RecordExtensions } from "../../records/extensions";

const EmailChannelActions = lazy(() => import("./ChannelWidgets").then((m) => ({ default: m.EmailChannelActions })));
const InboxStatusPanel = lazy(() => import("./ChannelWidgets").then((m) => ({ default: m.InboxStatusPanel })));
const ChannelActions = lazy(() => import("./ChannelWidgets").then((m) => ({ default: m.ChannelActions })));

export const emailChannelExtensions: RecordExtensions = {
  headerActions: (ctx) => (
    <Suspense fallback={null}>
      <EmailChannelActions ctx={ctx} />
    </Suspense>
  ),
  sidePanels: [
    {
      key: "notify-inbox",
      title: "دریافت ایمیل",
      order: 5,
      when: (ctx) => !!ctx.row.id && !!ctx.row.inbound,
      render: (ctx) => (
        <Suspense fallback={null}>
          <InboxStatusPanel id={ctx.row.id} />
        </Suspense>
      ),
    },
  ],
};

/** Defaults of a new channel from the address: `kind`, and an SMS `preset`. */
export function channelDefaults(search: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const kind = search.get("kind");
  if (kind && /^[a-z]+$/.test(kind)) out.kind = kind;
  const preset = SMS_PRESETS[search.get("preset") ?? ""];
  if (preset) {
    const { label, ...fields } = preset;
    Object.assign(out, { kind: "sms", name: label, ...fields });
  }
  return out;
}

export const channelExtensions: RecordExtensions = {
  headerActions: (ctx) => (
    <Suspense fallback={null}>
      <ChannelActions ctx={ctx} />
    </Suspense>
  ),
  defaults: channelDefaults,
};
