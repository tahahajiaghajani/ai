// Surveys (PTL-038 CSAT and its variants CES/NPS, PTL-039 XLA micro-surveys, PTL-040 campaigns):
//   · triggers — a record of a configured table that reaches «حل شد» or «بسته شد» invites its requester (the first
//     requester field), when the trigger's condition holds, the record falls in the sample, the person was not asked
//     by the same survey within the cool-down and the record has no invitation yet. Invitations are made where
//     notifications are delivered (`actsHere`: the web version, or a Windows app not linked to one), so a synced
//     record never invites twice.
//   · invitations — `survey_invitation` rows written by the module, announced with `notifyPeople` (in-app and e-mail,
//     rendered under the invitee's access); the template block `{{block.survey_link}}` puts the signed single-use link
//     (/p/survey/<token>: the organisation and the invitation under an HMAC of the runtime's secret) and the portal page
//     into the message for the invitee only.
//   · answering — in the portal (signed in, the invitee only) or by the signed link (no sign-in); answers are checked
//     (`checkSurveyAnswers`), the metrics computed (`responseMetrics`), the invitation marked answered in the same
//     transaction (a second answer is refused), and — for a named response — the satisfaction written back to the
//     record when its table keeps one (incident: satisfaction; requested item: rating). An anonymous survey stores no
//     respondent, invitation or record on the response.
//   · campaigns — «ارسال به مخاطبان» invites the active members of a survey's audience once each.
//   · results — aggregates in SQL over the responses the caller may read (`aggregate` with their context).
import { createHmac, timingSafeEqual } from "node:crypto";
import { checkSurveyAnswers, csatPctOf, npsOf, responseMetrics, sampled, type QuestionKind, type QuestionMetric, type SurveyQuestion } from "@shared/portal/logic";
import type { SurveyResults, SurveyView } from "@shared/portal/api";
import type { Cond } from "@shared/model/conditions";
import { tableDef } from "@shared/tables";
import type { Ctx, ServerConfig } from "../../context";
import type { Tx } from "../../db";
import { aggregate, createIn, onRecordEvent, orgSchema, systemCtx, updateIn, validationError, type RecordEvent } from "../../engine";
import type { JobContext } from "../../jobs";
import { AppError, bad, forbidden, notFound } from "../../http/errors";
import { actsHere, notifyPeople, registerTemplateBlock } from "../notify";
import { DAY_MS, isUuid, liveRow, liveRows, logPortalEvent, managesSurveys, sysOf, type Row } from "./common";
import { requesterFields } from "./items";

// ---------------------------------------------------------------------------------------------------------------
// Signed links

const uuidBytes = (id: string) => Buffer.from(id.replace(/-/g, ""), "hex");
const uuidOfBytes = (b: Buffer) => {
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const macOf = (secret: string, orgId: string, id: string) => createHmac("sha256", secret).update(`portal.survey:${orgId}:${id}`).digest().subarray(0, 18).toString("base64url");

/** The signed single-use link token of an invitation (organisation, invitation, HMAC). */
export function surveyToken(cfg: Pick<ServerConfig, "secret">, orgId: string, invitationId: string): string {
  return `${Buffer.concat([uuidBytes(orgId), uuidBytes(invitationId)]).toString("base64url")}.${macOf(cfg.secret, orgId, invitationId)}`;
}

/** The organisation and invitation a token names, when its signature holds. */
export function readSurveyToken(cfg: Pick<ServerConfig, "secret">, token: string): { orgId: string; invitationId: string } | null {
  const m = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{24})$/.exec(String(token ?? ""));
  if (!m) return null;
  const raw = Buffer.from(m[1], "base64url");
  if (raw.length !== 32) return null;
  const orgId = uuidOfBytes(raw.subarray(0, 16));
  const invitationId = uuidOfBytes(raw.subarray(16, 32));
  const want = Buffer.from(macOf(cfg.secret, orgId, invitationId));
  const got = Buffer.from(m[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { orgId, invitationId };
}

/** The address of the signed link (absolute when the web version's address is known). */
export function surveyLink(cfg: Partial<ServerConfig> & Pick<ServerConfig, "secret">, orgId: string, invitationId: string): string {
  const base = (cfg.publicUrl ?? "").replace(/\/+$/, "");
  return `${base}/p/survey/${surveyToken(cfg, orgId, invitationId)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Definitions

const QUESTION_KINDS = new Set(["rating", "faces", "nps", "ces", "scale10", "choice", "multi", "yes_no", "minutes", "text"]);

/** A survey's questions in order (as the system: the respondent sees what the survey asks). */
export async function surveyQuestions(q: Ctx["db"] | Tx, sys: Ctx, surveyId: string): Promise<SurveyQuestion[]> {
  const rows = await liveRows(q, sys, "survey_question", { f: "survey_id", op: "eq", v: surveyId }, { order: "t.sort_order, t.created_at", limit: 50 });
  return rows.map((r) => ({
    id: String(r.id),
    label: String(r.label ?? ""),
    kind: (QUESTION_KINDS.has(String(r.kind)) ? r.kind : "text") as QuestionKind,
    metric: (String(r.metric ?? "none") || "none") as QuestionMetric,
    required: r.required === true,
    options: Array.isArray(r.options) ? (r.options as string[]) : [],
    help: (r.help as string) ?? null,
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Invitations

const nowIso = () => new Date().toISOString();

/** Invite one person (as the system, inside `tx`): the invitation row and its notification. */
export async function inviteIn(
  tx: Tx,
  sys: Ctx,
  survey: Row,
  user: string,
  about: { table: string; id: string; number: string | null; title: string; group: string | null; trigger: string | null; channels?: string[] } | null,
): Promise<Row> {
  const days = Math.min(365, Math.max(1, Number(survey.expires_days ?? 14)));
  const title = about ? `${String(survey.name)}: ${[about.number, about.title].filter(Boolean).join(" — ")}`.slice(0, 250) : String(survey.name).slice(0, 250);
  const inv = await createIn(
    tx,
    sys,
    "survey_invitation",
    {
      title,
      survey_id: survey.id,
      trigger_id: about?.trigger ?? null,
      user_id: user,
      group_id: about?.group ?? null,
      table_key: about?.table ?? null,
      record_id: about?.id ?? null,
      record_number: about?.number ?? null,
      status: "pending",
      sent_at: nowIso(),
      expires_at: new Date(Date.now() + days * DAY_MS).toISOString(),
    },
    { trusted: true },
  );
  const channels = (about?.channels?.length ? about.channels : ["in_app", "email"]).filter((c) => c === "in_app" || c === "email") as ("in_app" | "email")[];
  await notifyPeople(tx, sys.org.id, {
    table: "survey_invitation",
    id: String(inv.id),
    users: [user],
    event: "custom",
    label: "دعوت به نظرسنجی",
    subject: about ? "نظر شما دربارهٔ {{record.display}}" : "نظرسنجی: {{record.display}}",
    body: about
      ? "رسیدگی به درخواست شما به پایان رسید. در کمتر از یک دقیقه بگویید چگونه بود؛ پاسخ شما به بهتر شدن خدمت کمک می‌کند.\n\n{{block.survey_link}}"
      : "نظر شما برای ما مهم است. لطفاً به این نظرسنجی کوتاه پاسخ دهید.\n\n{{block.survey_link}}",
    channels,
    source: "نظرسنجی",
  });
  return inv;
}

/** The record's first requester who is an active member that can sign in (service accounts are never surveyed). */
async function respondentOf(sys: Ctx, table: string, row: Row): Promise<string | null> {
  const def = tableDef(table);
  if (!def) return null;
  for (const f of requesterFields(def)) {
    const v = row[f];
    const id = Array.isArray(v) ? v[0] : v;
    if (!isUuid(id)) continue;
    const m = await sys.db.one<{ ok: number }>(
      `select 1 as ok from sm_org_members m join sm_users u on u.id = m.user_id
       where m.org_id = $1 and m.user_id = $2 and m.is_active and m.deleted_at is null and not u.disabled and u.email not like '%.invalid'`,
      [sys.org.id, id],
    );
    if (m) return String(id);
  }
  return null;
}

/** React to a record reaching «حل شد» or «بسته شد»: the survey triggers of its table (see the file's head). */
export async function surveyOnStateChange(e: RecordEvent, jctx: JobContext): Promise<number> {
  if (!actsHere(jctx.cfg)) return 0;
  if (e.to_category !== "resolved" && e.to_category !== "closed") return 0;
  if (e.table.startsWith("survey") || e.table === "portal_pref") return 0;
  const sys = await systemCtx(jctx.cfg as ServerConfig, e.org_id);
  const triggers = await liveRows(sys.db, sys, "survey_trigger", { and: [{ f: "active", op: "eq", v: true }, { f: "table_key", op: "eq", v: e.table }, { f: "fire_on", op: "eq", v: e.to_category }] }, { limit: 50 });
  if (!triggers.length) return 0;
  const schema = await orgSchema(sys);
  const def = schema.def(e.table);
  if (!def || def.virtual) return 0;
  let invited = 0;
  for (const t of triggers) {
    const survey = await liveRow(sys.db, sys, "survey", t.survey_id);
    if (!survey || survey.active === false) continue;
    // the condition and the record in one read (the engine's SQL form of the condition)
    const where: Cond = t.condition && typeof t.condition === "object" ? { and: [{ f: "id", op: "eq", v: e.id }, t.condition as Cond] } : { f: "id", op: "eq", v: e.id };
    const [row] = await liveRows(sys.db, sys, e.table, where, { limit: 1 }).catch(() => [] as Row[]);
    if (!row) continue;
    if (!sampled(`${e.id}:${t.id}`, Number(t.sample_pct ?? 100))) continue;
    const user = await respondentOf(sys, e.table, row);
    if (!user) continue;
    const done = await sys.write(async (tx) => {
      const [dup] = await liveRows(tx, sys, "survey_invitation", { and: [{ f: "survey_id", op: "eq", v: survey.id }, { f: "table_key", op: "eq", v: e.table }, { f: "record_id", op: "eq", v: e.id }] }, { limit: 1 });
      if (dup) return false;
      const cool = Math.max(0, Number(t.cooldown_days ?? 7));
      if (cool) {
        const since = new Date(Date.now() - cool * DAY_MS).toISOString();
        const [recent] = await liveRows(tx, sys, "survey_invitation", { and: [{ f: "survey_id", op: "eq", v: survey.id }, { f: "user_id", op: "eq", v: user }, { f: "sent_at", op: "gte", v: since }] }, { limit: 1 });
        if (recent) return false;
      }
      const group = def.scope?.group && isUuid(row[def.scope.group]) ? String(row[def.scope.group]) : null;
      const title = String(row[def.fields.some((f) => f.name === "short_description") ? "short_description" : def.display] ?? "");
      await inviteIn(tx, sys, survey, user, { table: e.table, id: e.id, number: (row.number as string) ?? e.number ?? null, title, group, trigger: String(t.id), channels: Array.isArray(t.channels) ? (t.channels as string[]) : undefined });
      return true;
    });
    if (done) invited++;
  }
  return invited;
}

/** The caller's pending, unexpired invitations. */
export async function pendingInvitations(ctx: Ctx): Promise<Row[]> {
  if (ctx.actor === "system") return [];
  return liveRows(ctx.db, sysOf(ctx), "survey_invitation", { and: [{ f: "user_id", op: "eq", v: ctx.user.id }, { f: "status", op: "eq", v: "pending" }, { f: "expires_at", op: "gt", v: nowIso() }] }, { order: "t.sent_at desc", limit: 50 });
}

/** The caller's pending invitation about a record, if any. */
export async function pendingInvitationFor(ctx: Ctx, table: string, id: string): Promise<string | null> {
  if (ctx.actor === "system") return null;
  const [r] = await liveRows(ctx.db, sysOf(ctx), "survey_invitation", { and: [{ f: "user_id", op: "eq", v: ctx.user.id }, { f: "table_key", op: "eq", v: table }, { f: "record_id", op: "eq", v: id }, { f: "status", op: "eq", v: "pending" }, { f: "expires_at", op: "gt", v: nowIso() }] }, { limit: 1 });
  return r ? String(r.id) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Answering

async function viewOf(sys: Ctx, inv: Row, withRecord: boolean): Promise<SurveyView> {
  const survey = await liveRow(sys.db, sys, "survey", inv.survey_id);
  if (!survey) throw notFound("نظرسنجی پیدا نشد");
  return {
    invitation: { id: String(inv.id), status: String(inv.status ?? "pending"), expires_at: (inv.expires_at as string) ?? null, answered_at: (inv.answered_at as string) ?? null },
    survey: { name: String(survey.name ?? ""), kind: String(survey.kind ?? "csat"), intro: (survey.intro as string) ?? null, thanks: (survey.thanks as string) ?? null, anonymous: survey.anonymous === true },
    questions: await surveyQuestions(sys.db, sys, String(survey.id)),
    record: withRecord && inv.table_key && isUuid(inv.record_id) ? { table: String(inv.table_key), id: String(inv.record_id), number: (inv.record_number as string) ?? null, title: String(inv.title ?? "") } : null,
  };
}

/** The invitee's survey in the portal (an invitation of someone else answers «پیدا نشد»). */
export async function surveyView(ctx: Ctx, invitationId: string): Promise<SurveyView> {
  const sys = sysOf(ctx);
  const inv = await liveRow(ctx.db, sys, "survey_invitation", invitationId);
  if (!inv || inv.user_id !== ctx.user.id) throw notFound("نظرسنجی پیدا نشد");
  return viewOf(sys, inv, true);
}

/** The survey of a signed link (no sign-in; nothing about the record). */
export async function publicSurveyView(cfg: ServerConfig, token: string): Promise<SurveyView> {
  const t = readSurveyToken(cfg, token);
  if (!t) throw notFound("پیوند نظرسنجی معتبر نیست");
  const sys = await systemCtx(cfg, t.orgId).catch(() => null);
  if (!sys) throw notFound("پیوند نظرسنجی معتبر نیست");
  const inv = await liveRow(sys.db, sys, "survey_invitation", t.invitationId);
  if (!inv) throw notFound("پیوند نظرسنجی معتبر نیست");
  return viewOf(sys, inv, false);
}

/** Store one answer of an invitation (see the file's head); returns the survey's closing words. */
async function answer(sys: Ctx, invitationId: string, raw: Record<string, unknown>, channel: string, actor: string | null): Promise<{ thanks: string }> {
  const inv0 = await liveRow(sys.db, sys, "survey_invitation", invitationId);
  if (!inv0) throw notFound("نظرسنجی پیدا نشد");
  const survey = await liveRow(sys.db, sys, "survey", inv0.survey_id);
  if (!survey) throw notFound("نظرسنجی پیدا نشد");
  const questions = await surveyQuestions(sys.db, sys, String(survey.id));
  const { clean, problems } = checkSurveyAnswers(questions, raw ?? {});
  if (Object.keys(problems).length) throw validationError(problems);
  const metrics = responseMetrics(questions, clean, Number(survey.satisfied_from ?? 4));
  const anonymous = survey.anonymous === true;
  await sys.write(async (tx) => {
    const inv = await liveRow(tx, sys, "survey_invitation", invitationId);
    if (!inv) throw notFound("نظرسنجی پیدا نشد");
    if (inv.status === "answered") throw new AppError(409, "conflict", "به این نظرسنجی پیش‌تر پاسخ داده‌اید؛ سپاسگزاریم");
    if (inv.status !== "pending") throw new AppError(410, "gone", "مهلت این نظرسنجی گذشته است");
    if (inv.expires_at && Date.parse(String(inv.expires_at)) < Date.now()) {
      await updateIn(tx, sys, "survey_invitation", invitationId, { status: "expired" }, { trusted: true });
      throw new AppError(410, "gone", "مهلت این نظرسنجی گذشته است");
    }
    const at = nowIso();
    let service: string | null = null;
    if (!anonymous && inv.table_key && isUuid(inv.record_id)) {
      const rec = await liveRow(tx, sys, String(inv.table_key), inv.record_id).catch(() => null);
      service = rec && isUuid(rec.service_id) ? String(rec.service_id) : null;
    }
    await createIn(
      tx,
      sys,
      "survey_response",
      {
        title: anonymous ? String(survey.name) : String(inv.title ?? survey.name),
        survey_id: survey.id,
        invitation_id: anonymous ? null : inv.id,
        respondent_id: anonymous ? null : inv.user_id,
        group_id: inv.group_id ?? null,
        table_key: anonymous ? null : (inv.table_key ?? null),
        record_id: anonymous ? null : (inv.record_id ?? null),
        record_number: anonymous ? null : (inv.record_number ?? null),
        service_id: service,
        channel,
        answers: clean,
        csat: metrics.csat,
        satisfied: metrics.satisfied,
        nps: metrics.nps,
        ces: metrics.ces,
        happiness: metrics.happiness,
        lost_minutes: metrics.lost_minutes,
        score: metrics.score,
        comment: metrics.comment,
        // an anonymous answer keeps only its day
        submitted_at: anonymous ? `${at.slice(0, 10)}T00:00:00.000Z` : at,
      },
      { trusted: true },
    );
    await updateIn(tx, sys, "survey_invitation", invitationId, { status: "answered", answered_at: at }, { trusted: true });
    await updateIn(tx, sys, "survey", String(survey.id), { response_count: Number(survey.response_count ?? 0) + 1 }, { trusted: true });
    // the satisfaction on the record itself, when its table keeps one (a named answer only)
    if (!anonymous && metrics.csat !== null && inv.table_key && isUuid(inv.record_id)) {
      const def = tableDef(String(inv.table_key));
      const field = def?.fields.find((f) => f.name === "satisfaction") ? "satisfaction" : def?.fields.find((f) => f.name === "rating" && f.type === "rating") ? "rating" : null;
      const note = def?.fields.find((f) => f.name === "satisfaction_comment") ? "satisfaction_comment" : def?.fields.find((f) => f.name === "feedback" && f.type === "text") ? "feedback" : null;
      if (field) {
        const values: Row = { [field]: metrics.csat };
        if (note && metrics.comment) values[note] = metrics.comment.slice(0, 2000);
        await updateIn(tx, sys, String(inv.table_key), String(inv.record_id), values, { trusted: true, allowLocked: true, keepVersion: true }).catch(() => undefined);
      }
    }
  });
  await logPortalEvent(sys.db, sys.org.id, anonymous ? null : actor, { kind: "survey", channel: channel === "email" ? "public" : "portal", value: metrics.score ?? null, ref_table: "survey", ref_id: String(survey.id) }, sys.cfg.log);
  return { thanks: String(survey.thanks ?? "از وقتی که گذاشتید سپاسگزاریم.") };
}

/** Answer in the portal (the invitee, signed in). */
export async function submitSurvey(ctx: Ctx, invitationId: string, answers: Record<string, unknown>, channel: "portal" | "chat" | "messenger" = "portal"): Promise<{ thanks: string }> {
  const sys = sysOf(ctx);
  const inv = await liveRow(ctx.db, sys, "survey_invitation", invitationId);
  if (!inv || inv.user_id !== ctx.user.id) throw notFound("نظرسنجی پیدا نشد");
  return answer(sys, invitationId, answers, channel, ctx.user.id);
}

/** Answer by the signed link (no sign-in). */
export async function submitPublicSurvey(cfg: ServerConfig, token: string, answers: Record<string, unknown>): Promise<{ thanks: string }> {
  const t = readSurveyToken(cfg, token);
  if (!t) throw notFound("پیوند نظرسنجی معتبر نیست");
  const sys = await systemCtx(cfg, t.orgId);
  return answer(sys, t.invitationId, answers, "email", null);
}

// ---------------------------------------------------------------------------------------------------------------
// Campaigns (PTL-040)

/** Active members of a survey's audience (everyone when it names nobody), at most 5 000, never service accounts. */
async function audienceMembers(sys: Ctx, survey: Row): Promise<string[]> {
  const ids = (f: string) => (Array.isArray(survey[f]) ? (survey[f] as string[]).filter(isUuid) : []);
  const units = ids("aud_units");
  const groups = ids("aud_groups");
  const locations = ids("aud_locations");
  const users = ids("aud_users");
  const members = await sys.db.query<{ user_id: string }>(
    `select m.user_id from sm_org_members m join sm_users u on u.id = m.user_id
     where m.org_id = $1 and m.is_active and m.deleted_at is null and not u.disabled and u.email not like '%.invalid' limit 20000`,
    [sys.org.id],
  );
  const active = new Set(members.map((m) => String(m.user_id)));
  if (!units.length && !groups.length && !locations.length && !users.length) return [...active].slice(0, 5000);
  const out = new Set<string>(users.filter((u) => active.has(u)));
  if (units.length || locations.length) {
    const under = async (table: string, roots: string[]) => {
      if (!roots.length) return new Set<string>();
      const rows = await liveRows(sys.db, sys, table, null, { limit: 10_000 });
      return new Set(rows.filter((r) => roots.some((root) => String(r.path ?? "").includes(`/${root}/`) || r.id === root)).map((r) => String(r.id)));
    };
    const unitSet = await under("org_unit", units);
    const locSet = await under("location", locations);
    for (const p of await liveRows(sys.db, sys, "member_profile", null, { limit: 20_000 })) {
      const u = String(p.user_id ?? "");
      if (!active.has(u)) continue;
      if ((p.org_unit_id && unitSet.has(String(p.org_unit_id))) || (p.location_id && locSet.has(String(p.location_id)))) out.add(u);
    }
  }
  if (groups.length) {
    const today = Date.now();
    for (const gm of await liveRows(sys.db, sys, "group_member", { f: "group_id", op: "in", v: groups }, { limit: 20_000 })) {
      const u = String(gm.user_id ?? "");
      if (!active.has(u) || gm.kind === "observer") continue;
      if (gm.valid_from && Date.parse(String(gm.valid_from)) > today) continue;
      if (gm.valid_to && Date.parse(String(gm.valid_to)) < today) continue;
      out.add(u);
    }
  }
  return [...out].slice(0, 5000);
}

/** Invite a survey's audience once each (those already invited — pending or answered — are skipped). */
export async function sendCampaign(ctx: Ctx, surveyId: string): Promise<{ invited: number; skipped: number }> {
  if (!(await managesSurveys(ctx))) throw forbidden("ارسال نظرسنجی با مدیران نظرسنجی است");
  const sys = sysOf(ctx);
  const survey = await liveRow(ctx.db, sys, "survey", surveyId);
  if (!survey) throw notFound("نظرسنجی پیدا نشد");
  if (survey.active === false) throw bad("نظرسنجی خاموش است؛ نخست آن را فعال کنید");
  if (!(await surveyQuestions(ctx.db, sys, surveyId)).length) throw bad("این نظرسنجی هنوز پرسشی ندارد");
  const people = await audienceMembers(sys, survey);
  const already = new Set((await liveRows(ctx.db, sys, "survey_invitation", { and: [{ f: "survey_id", op: "eq", v: surveyId }, { f: "status", op: "in", v: ["pending", "answered"] }] }, { limit: 20_000 })).map((r) => String(r.user_id)));
  const todo = people.filter((p) => !already.has(p));
  for (let i = 0; i < todo.length; i += 200) {
    const batch = todo.slice(i, i + 200);
    await ctx.write(async (tx) => {
      for (const u of batch) await inviteIn(tx, sys, survey, u, null);
    });
  }
  await ctx.write((tx) => updateIn(tx, sys, "survey", surveyId, { sent_at: nowIso(), sent_count: Number(survey.sent_count ?? 0) + todo.length }, { trusted: true }));
  return { invited: todo.length, skipped: people.length - todo.length };
}

/** Pending invitations past their date become «منقضی شد» (the sweep). */
export async function expireInvitations(sys: Ctx): Promise<number> {
  const rows = await liveRows(sys.db, sys, "survey_invitation", { and: [{ f: "status", op: "eq", v: "pending" }, { f: "expires_at", op: "lt", v: nowIso() }] }, { limit: 500 });
  if (!rows.length) return 0;
  await sys.write(async (tx) => {
    for (const r of rows) await updateIn(tx, sys, "survey_invitation", String(r.id), { status: "expired" }, { trusted: true });
  });
  return rows.length;
}

// ---------------------------------------------------------------------------------------------------------------
// Results (PTL-038 «results on the record and in reports»)

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

/** The results of a survey (or of every survey) over the last `days`, from the responses the caller may read. */
export async function surveyResults(ctx: Ctx, opts: { survey?: string | null; days?: number }): Promise<SurveyResults> {
  const days = Math.min(730, Math.max(7, Math.round(opts.days ?? 90)));
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const surveyRow = isUuid(opts.survey) ? await liveRow(ctx.db, ctx, "survey", opts.survey).catch(() => null) : null;
  if (opts.survey && !surveyRow) throw notFound("نظرسنجی پیدا نشد");
  const base: Cond[] = [{ f: "submitted_at", op: "gte", v: since }];
  if (surveyRow) base.push({ f: "survey_id", op: "eq", v: surveyRow.id });
  const filter: Cond = { and: base };
  const agg = (groupBy: Parameters<typeof aggregate>[2]["groupBy"], metrics: Parameters<typeof aggregate>[2]["metrics"], extra?: Cond) =>
    aggregate(ctx, "survey_response", { filter: extra ? { and: [...base, extra] } : filter, groupBy, metrics, limit: 400 });
  const [totals, csatRows, npsRows, months, groups] = await Promise.all([
    agg([], [{ fn: "count" }, { fn: "avg", field: "csat" }, { fn: "avg", field: "ces" }, { fn: "avg", field: "happiness" }, { fn: "avg", field: "lost_minutes" }]),
    agg(["csat"], [{ fn: "count" }], { f: "csat", op: "nempty" }),
    agg(["nps"], [{ fn: "count" }], { f: "nps", op: "nempty" }),
    agg([{ field: "submitted_at", bucket: "month" }], [{ fn: "count" }, { fn: "avg", field: "csat" }]),
    agg(["group_id"], [{ fn: "count" }]),
  ]);
  const satisfiedFrom = Number(surveyRow?.satisfied_from ?? 4);
  const csatDist = [0, 0, 0, 0, 0];
  const csatValues: number[] = [];
  for (const r of csatRows.rows) {
    const v = Number(r.keys[0]);
    const n = Number(r.values.count ?? 0);
    if (v >= 1 && v <= 5) {
      csatDist[v - 1] += n;
      for (let i = 0; i < n; i++) csatValues.push(v);
    }
  }
  const npsDist = Array.from({ length: 11 }, () => 0);
  const npsValues: number[] = [];
  for (const r of npsRows.rows) {
    const v = Number(r.keys[0]);
    const n = Number(r.values.count ?? 0);
    if (v >= 0 && v <= 10) {
      npsDist[v] += n;
      for (let i = 0; i < n; i++) npsValues.push(v);
    }
  }
  // the CSAT % of each month needs the satisfied count: one more grouping by month and satisfied
  const monthSat = await agg([{ field: "submitted_at", bucket: "month" }, "satisfied"], [{ fn: "count" }], { f: "csat", op: "nempty" });
  const satByMonth = new Map<string, { yes: number; all: number }>();
  for (const r of monthSat.rows) {
    const k = String(r.keys[0]);
    const cur = satByMonth.get(k) ?? { yes: 0, all: 0 };
    const n = Number(r.values.count ?? 0);
    cur.all += n;
    if (r.keys[1] === true || r.keys[1] === "true") cur.yes += n;
    satByMonth.set(k, cur);
  }
  const npsMonth = await agg([{ field: "submitted_at", bucket: "month" }, "nps"], [{ fn: "count" }], { f: "nps", op: "nempty" });
  const npsByMonth = new Map<string, number[]>();
  for (const r of npsMonth.rows) {
    const k = String(r.keys[0]);
    const arr = npsByMonth.get(k) ?? [];
    for (let i = 0; i < Number(r.values.count ?? 0); i++) arr.push(Number(r.keys[1]));
    npsByMonth.set(k, arr);
  }
  const groupSat = await agg(["group_id", "satisfied"], [{ fn: "count" }], { f: "csat", op: "nempty" });
  const satByGroup = new Map<string, { yes: number; all: number }>();
  for (const r of groupSat.rows) {
    const k = String(r.keys[0] ?? "");
    const cur = satByGroup.get(k) ?? { yes: 0, all: 0 };
    const n = Number(r.values.count ?? 0);
    cur.all += n;
    if (r.keys[1] === true || r.keys[1] === "true") cur.yes += n;
    satByGroup.set(k, cur);
  }
  const invited = await aggregate(ctx, "survey_invitation", { filter: { and: [{ f: "sent_at", op: "gte", v: since }, ...(surveyRow ? [{ f: "survey_id", op: "eq" as const, v: surveyRow.id }] : [])] }, groupBy: [], metrics: [{ fn: "count" }] }).catch(() => null);
  const invitedN = Number(invited?.totals.count ?? 0);
  const responses = Number(totals.totals.count ?? 0);
  const comments = await liveRows(ctx.db, ctx, "survey_response", { and: [...base, { f: "comment", op: "nempty" }] }, { order: "t.submitted_at desc", limit: 30 }).catch(() => [] as Row[]);
  const pct = (x: { yes: number; all: number } | undefined) => (x && x.all ? Math.round((x.yes / x.all) * 100) : null);
  return {
    survey: surveyRow ? { id: String(surveyRow.id), name: String(surveyRow.name), kind: String(surveyRow.kind) } : null,
    days,
    totals: {
      invited: invitedN,
      responses,
      rate: invitedN ? Math.round((Math.min(responses, invitedN) / invitedN) * 100) : null,
      csat_pct: csatPctOf(csatValues, satisfiedFrom),
      csat_avg: num(totals.totals["avg:csat"]) === null ? null : Number(Number(totals.totals["avg:csat"]).toFixed(2)),
      nps: npsOf(npsValues),
      ces_avg: num(totals.totals["avg:ces"]) === null ? null : Number(Number(totals.totals["avg:ces"]).toFixed(2)),
      happiness_avg: num(totals.totals["avg:happiness"]) === null ? null : Number(Number(totals.totals["avg:happiness"]).toFixed(1)),
      lost_minutes_avg: num(totals.totals["avg:lost_minutes"]) === null ? null : Math.round(Number(totals.totals["avg:lost_minutes"])),
    },
    trend: months.rows.map((r) => {
      const k = String(r.keys[0]);
      return { period: k, label: r.labels[0] ?? k, responses: Number(r.values.count ?? 0), csat_pct: pct(satByMonth.get(k)), nps: npsOf(npsByMonth.get(k) ?? []) };
    }),
    distribution: { csat: csatDist, nps: npsDist },
    groups: groups.rows.map((r) => {
      const k = r.keys[0] === null || r.keys[0] === undefined ? null : String(r.keys[0]);
      return { id: k, name: k ? (groups.display[k] ?? r.labels[0] ?? "—") : "بدون گروه", responses: Number(r.values.count ?? 0), csat_pct: pct(satByGroup.get(k ?? "")) };
    }),
    comments: comments.map((c) => ({ id: String(c.id), at: String(c.submitted_at ?? c.created_at ?? ""), csat: typeof c.csat === "number" ? c.csat : null, comment: String(c.comment ?? ""), record_number: (c.record_number as string) ?? null })),
  };
}

/** The responses about one record the caller may read (the record page's «نظرسنجی» panel). */
export async function recordSurveys(ctx: Ctx, table: string, id: string): Promise<{ responses: { id: string; title: string; csat: number | null; score: number | null; comment: string | null; at: string | null }[] }> {
  const rows = await liveRows(ctx.db, ctx, "survey_response", { and: [{ f: "table_key", op: "eq", v: table }, { f: "record_id", op: "eq", v: id }] }, { order: "t.submitted_at desc", limit: 20 }).catch(() => [] as Row[]);
  return { responses: rows.map((r) => ({ id: String(r.id), title: String(r.title ?? ""), csat: typeof r.csat === "number" ? r.csat : null, score: typeof r.score === "number" ? r.score : null, comment: (r.comment as string) ?? null, at: (r.submitted_at as string) ?? null })) };
}

// ---------------------------------------------------------------------------------------------------------------
// Wiring

let installed = false;
export function installSurveys(): void {
  if (installed) return;
  installed = true;
  onRecordEvent("portal.surveys", async (e, jctx) => {
    await surveyOnStateChange(e, jctx);
  }, { kinds: ["record.state_changed"] });
  // the signed link and the portal page, for the invitee only
  registerTemplateBlock("survey_link", {
    label: "پیوند پاسخ به نظرسنجی",
    description: "پیوند امضاشده و یک‌بارمصرف نظرسنجی برای دعوت‌شده",
    tables: ["survey_invitation"],
    fields: ["user_id", "status"],
    async render({ ctx, id, row, link }) {
      if (row.user_id !== ctx.user.id || row.status !== "pending") return null;
      const signed = surveyLink(ctx.cfg, ctx.org.id, id);
      const portal = link(`portal/surveys/${id}`);
      const direct = /^https?:\/\//.test(signed) ? signed : portal;
      return { markdown: `[پاسخ به نظرسنجی](${direct})`, text: `پاسخ به نظرسنجی: ${direct}` };
    },
  });
}
