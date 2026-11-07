// /api/o/:org/notify — the notification service's own API (docs/spec/services/notify.md): the caller's inbox (the
// bell and the notification center) and preferences, and for the settings pages the rule list with the built-ins,
// template previews, channel tests, «بررسی صندوق اکنون» and the delivery and e-mail logs. Rules, templates and
// channels themselves are engine tables served by the generic API (/r/notification_rule …).
import { z } from "zod";
import { router, body, query } from "../http/hono";
import { INBOX_KINDS, NOTIFY_EVENT_KEYS, type InboxKind } from "@shared/notify";
import { getPrefs, listInbox, markAllRead, markRead, savePrefs, snooze, unreadCount, MAX_SNOOZE_MS } from "../modules/notify/inbox";
import { checkInbox, deliveryLog, emailLog, inboxStatus, listRules, preview, testChannel, testEmail } from "../modules/notify/admin";

export const notifyRoutes = router();

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");

notifyRoutes.get("/inbox", async (c) => {
  const q = query(
    c,
    z.object({
      kind: z.enum(Object.keys(INBOX_KINDS) as [InboxKind, ...InboxKind[]]).optional(),
      unread: z.enum(["0", "1", "true", "false"]).optional(),
      snoozed: z.enum(["0", "1", "true", "false"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      before: z.string().max(40).optional(),
    }),
  );
  return c.json(await listInbox(c.get("ctx"), { kind: q.kind ?? null, unread: q.unread === "1" || q.unread === "true", snoozed: q.snoozed === "1" || q.snoozed === "true", limit: q.limit, before: q.before ?? null }));
});

notifyRoutes.get("/inbox/count", async (c) => c.json({ unread: await unreadCount(c.get("ctx")) }));

notifyRoutes.post("/inbox/read", async (c) => {
  const b = await body(c, z.object({ ids: z.array(z.string().max(40)).max(200).optional(), all: z.boolean().optional() }));
  const ctx = c.get("ctx");
  if (b.all) await markAllRead(ctx);
  else await markRead(ctx, b.ids ?? []);
  return c.json({ unread: await unreadCount(ctx) });
});

// «بعداً یادآوری کن»: `minutes` from now or an ISO time `until`; neither (or until: null) brings the items back now
notifyRoutes.post("/inbox/snooze", async (c) => {
  const b = await body(
    c,
    z.object({
      ids: z.array(z.string().max(40)).min(1).max(200),
      minutes: z.number().int().min(1).max(MAX_SNOOZE_MS / 60_000).optional(),
      until: z.string().max(40).nullish(),
    }),
  );
  const ctx = c.get("ctx");
  const until = b.minutes ? new Date(Date.now() + b.minutes * 60_000) : b.until ? new Date(b.until) : null;
  const changed = await snooze(ctx, b.ids, until);
  return c.json({ changed, until: until?.toISOString() ?? null, unread: await unreadCount(ctx) });
});

notifyRoutes.get("/prefs", async (c) => c.json({ prefs: await getPrefs(c.get("ctx")) }));

notifyRoutes.put("/prefs", async (c) => {
  const b = await body(
    c,
    z.object({
      optouts: z.array(z.string().max(60)).max(100).optional(),
      digest: z.enum(["none", "hourly", "daily"]).optional(),
      digest_hour: z.number().int().min(0).max(23).optional(),
      quiet_from: z.string().max(5).nullable().optional(),
      quiet_to: z.string().max(5).nullable().optional(),
    }),
  );
  return c.json({ prefs: await savePrefs(c.get("ctx"), b) });
});

notifyRoutes.get("/rules", async (c) => c.json(await listRules(c.get("ctx"))));

notifyRoutes.post("/preview", async (c) => {
  const b = await body(
    c,
    z.object({
      table: z.string().min(1).max(60),
      record_id: UUID.nullish(),
      event: z.enum(NOTIFY_EVENT_KEYS as [string, ...string[]]),
      template_id: UUID.nullish(),
      subject: z.string().max(300).nullish(),
      body: z.string().max(20000).nullish(),
      short_text: z.string().max(500).nullish(),
    }),
  );
  return c.json(await preview(c.get("ctx"), b as Parameters<typeof preview>[1]));
});

notifyRoutes.get("/log", async (c) => {
  const q = query(c, z.object({ status: z.string().max(20).optional(), channel: z.string().max(20).optional(), limit: z.coerce.number().int().min(1).max(200).optional(), before: z.string().max(40).optional() }));
  return c.json(await deliveryLog(c.get("ctx"), q));
});

notifyRoutes.get("/email-log", async (c) => {
  const q = query(c, z.object({ direction: z.enum(["in", "out"]).optional(), status: z.string().max(20).optional(), limit: z.coerce.number().int().min(1).max(200).optional(), before: z.string().max(40).optional() }));
  return c.json(await emailLog(c.get("ctx"), q));
});

notifyRoutes.get("/email-channels/:id/status", async (c) => c.json(await inboxStatus(c.get("ctx"), c.req.param("id"))));

notifyRoutes.post("/email-channels/:id/test", async (c) => {
  const b = await body(c, z.object({ to: z.string().max(254).nullish() }));
  return c.json(await testEmail(c.get("ctx"), c.req.param("id"), b.to ?? null));
});

notifyRoutes.post("/email-channels/:id/check", async (c) => c.json(await checkInbox(c.get("ctx"), c.req.param("id"))));

notifyRoutes.post("/channels/:id/test", async (c) => {
  const b = await body(c, z.object({ to: z.string().max(40).nullish() }));
  return c.json(await testChannel(c.get("ctx"), c.req.param("id"), b.to ?? null));
});
