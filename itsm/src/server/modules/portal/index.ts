// The self-service portal and its channels (docs/modules/portal_FA.md): tables in src/shared/tables/portal.ts, pure
// logic and contracts in src/shared/portal, screens in src/ui/modules/portal (the requester's portal in its own light
// shell, the public pages, the administrators' pages), HTTP API in src/server/routes/portal.ts.
// `installPortalModule()` (once per process, src/server/routes/modules.ts, after the virtual agent) wires it in:
//   · hooks of its tables (hooks.ts)
//   · survey triggers on record events and the `{{block.survey_link}}` template block (surveys.ts)
//   · the messaging connectors' job (channels.ts), the daily sweep (expired invitations, old deliveries, used codes,
//     the event stream past 180 days) and the seed of a new organisation (seed.ts)
//   · its AI skills with rule-based fallbacks (ai.ts): portal.search_answer, portal.reply_suggest
// Extension points: `registerPortalItems` (another department's requester-facing table in «درخواست‌های من»).
import type { Ctx } from "../../context";
import { systemCtx } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { registerOrgSeed } from "../orgs/service";
import { SEED_DELAY_MS } from "../sla";
import { installPortalHooks } from "./hooks";
import { installSurveys, expireInvitations } from "./surveys";
import { installChannels, cleanChannels } from "./channels";
import { installPortalSkills } from "./ai";
import { seedPortalDefaultsWith, type SeedCounts } from "./seed";
import { DAY_MS } from "./common";

export const JOB_SEED = "portal.seed";
export const JOB_SWEEP = "portal.sweep";

/** Add the defaults of the portal to an organisation (as the system; idempotent). */
export async function seedPortalDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return seedPortalDefaultsWith(sys, opts);
}

/** The daily sweep of an organisation (see the file's head). */
export async function portalSweep(sys: Ctx): Promise<{ expired: number }> {
  const expired = await expireInvitations(sys);
  await cleanChannels(sys);
  await sys.db.query(`delete from sm_portal_events where org_id = $1 and at < now() - interval '180 days'`, [sys.org.id]);
  return { expired };
}

/** Queue the daily sweep (once per organisation while one is queued). */
export const ensurePortalSweep = (q: Ctx["db"], orgId: string) => enqueue(q, { kind: JOB_SWEEP, orgId, delayMs: DAY_MS, dedupeKey: JOB_SWEEP, maxAttempts: 3 });

let installed = false;
export function installPortalModule(): void {
  if (installed) return;
  installed = true;
  installPortalHooks();
  installSurveys();
  installChannels();
  installPortalSkills();
  registerJobHandler(JOB_SEED, async (job, jctx) => {
    if (!job.org_id) return;
    await seedPortalDefaults(jctx.cfg, job.org_id);
    await ensurePortalSweep(jctx.db, job.org_id);
  });
  registerJobHandler(JOB_SWEEP, async (job, jctx) => {
    if (!job.org_id) return;
    const sys = await systemCtx(jctx.cfg, job.org_id);
    await portalSweep(sys);
    return { again: DAY_MS };
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: JOB_SEED, orgId, delayMs: SEED_DELAY_MS + 120_000, dedupeKey: JOB_SEED, maxAttempts: 5 }).then(() => undefined));
}

export { seedPortalDefaultsIn, seedPortalDefaultsWith, PORTAL_SEED_VERSION, PRIVACY_NOTICE, type SeedCounts } from "./seed";
export { registerPortalItems, registerPortalLink, moduleLinksFor, portalItemTables, managesPortal, managesSurveys, managesChannels, publishesKnowledge, logEvent, logPortalEvent, type PortalItemTable, type PortalModuleLink } from "./common";
export { portalConfig, portalsFor, currentPortal, choosePortal, favoritesOf, toggleFavorite, publishLayout, portalLogo } from "./config";
export { portalHome, catalogPage, topicPage, quickLinks, topics, trendingItemIds, recentItemIds } from "./home";
export { myItems, ticketView, replyToTicket, ticketAction, managesPeople, requesterFields } from "./items";
export { portalSearch } from "./search";
export { portalTodo, approvalDetail } from "./todo";
export {
  surveyToken, readSurveyToken, surveyLink, surveyQuestions, surveyView, publicSurveyView, submitSurvey, submitPublicSurvey, sendCampaign, surveyResults, recordSurveys, pendingInvitations, surveyOnStateChange, expireInvitations,
} from "./surveys";
export { newChannelSecret, rotateChannelKey, registerChannelWebhook, channelLog, newLinkCode, myIdentities, unlinkIdentity, receiveHook, verifyHook, processChannelMessage, hookUrl, JOB_MESSAGE, MAX_HOOK_BYTES } from "./channels";
export { publicKbHome, publicKbSearch, publicKbArticle, publicKbVote, publications, setPublication, slugOf, idOfSlug, PUBLIC_BASE, publicArticles } from "./publickb";
export { widgetConfig, widgetSearch, widgetScript, widgetSnippet, rotateWidgetKey } from "./widget";
export { searchAnswer, replySuggestions, ruleAnswer, ruleReplies, PORTAL_SKILLS } from "./ai";
export { portalAnalytics } from "./analytics";
