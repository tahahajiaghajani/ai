// /api/o/:org/process — workflows «گردش‌کارها» (design F §4, §5, §8.3–8.6, package F4c). The services are
// src/server/modules/process/{publish,hub,api}/*; who may is checked there (and by the record engine they read through).
//   The administrator's side:
//   GET    /process/hub                           the nine kinds, counts, links, notices      process_design read | settings edit
//   POST   /process/hub/roles/:key/work           «افزودن حق»: a customised role gains work create          users admin
//   POST   /process/defs                          a new process (an empty draft)                     process_design create
//   GET    /process/defs/:id                      the designer's view: draft, problems, rights           process_design read
//   PUT    /process/defs/:id/draft                the autosave (draft, name, icon, category, description)  process_design write
//   GET    /process/defs/:id/diff                 what «انتشار» would publish                             process_design read
//   POST   /process/defs/:id/publish              «انتشار» (re-authentication)                         process_design approve
//   POST   /process/defs/:id/retire               «بازنشسته‌کردن» (re-authentication)                   process_design approve
//   GET    /process/defs/:id/versions             «نسخه‌ها» with their diffs                              process_design read
//   POST   /process/defs/:id/versions/:vid/restore «بازگرداندن به پیش‌نویس»                            process_design write
//   The people's side (one call per page):
//   GET    /process/inbox                         «کارتابل»: my steps and my record approvals
//   GET    /process/inbox/count                   the nav count
//   GET    /process/done                          «انجام‌شده‌ها»
//   GET    /process/mine                          «گردش‌کارهای من»
//   GET    /process/defs/:key/view                the diagram, my queues and the start form
//   GET    /process/cases                         «پرونده‌ها» (?process=&state=&step=&requester=&unit=&from=&to=&mine=&q=&page=&size=)
//   GET    /process/cases/:id                     the case: diagram, values, my steps, actions, history
//   GET    /process/cases/:id/print               the printable view's data
//   POST   /process/start                         «آغاز پرونده» (JSON, or multipart: `payload` + `files`)
//   POST   /process/tasks/:id/submit              «انجام مرحله» (JSON, or multipart: `payload` + `files`)
//   POST   /process/tasks/:id/claim               «برداشتن کار» (DELETE: put it back)
//   POST   /process/cases/:id/reassign|pause|resume|cancel|resume-from   the managers' actions (cancel: also the requester's)
//   POST   /process/cases/:id/reresolve           «دوباره پیدا کردن انجام‌دهنده» of a waiting step (managers; 1.1.5)
import { z } from "zod";
import { bodyLimit } from "hono/body-limit";
import { router, body, query, type C } from "../http/hono";
import { AppError, bad } from "../http/errors";
import { needRecentAuthOf } from "../auth/policy";
import type { UploadFile } from "../engine";
import { processHub, grantWorkCreate } from "../modules/process/hub";
import {
  createProcess, processDetail, processVersions, publishPreview, publishProcess, restoreVersion, retireProcess, saveDraft,
} from "../modules/process/publish";
import {
  caseDetail, casePrint, casesList, cancelCaseAs, claimStep, doneSteps, inbox, inboxCount, myProcesses, pauseCase, processView, reassignStep, reresolveStep, resumeCase,
  resumeFrom, startProcess, submitStep,
} from "../modules/process/api";

export const processRoutes = router();

const UPLOAD_LIMIT = 101 * 1024 * 1024;
const tooLarge = () => {
  throw new AppError(413, "too_large", "حجم پیوست‌ها بیش از حد مجاز است");
};

/** A JSON body, or a multipart one with the JSON under `payload` and the files under `files` (`{ upload: n }`). */
async function payloadOf(c: C): Promise<{ payload: Record<string, unknown>; files: UploadFile[] }> {
  const type = c.req.header("content-type") ?? "";
  if (!type.includes("multipart/form-data")) return { payload: ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>, files: [] };
  const form = await c.req.parseBody({ all: true }).catch(() => {
    throw bad("فرم فرستاده‌شده خوانده نشد");
  });
  let payload: Record<string, unknown> = {};
  try {
    payload = typeof form.payload === "string" ? (JSON.parse(form.payload) as Record<string, unknown>) : {};
  } catch {
    throw bad("بخش «payload» فرم JSON معتبر نیست");
  }
  const list = (Array.isArray(form.files) ? form.files : form.files ? [form.files] : []).filter((f): f is File => typeof f !== "string");
  const files: UploadFile[] = [];
  for (const f of list.slice(0, 50)) files.push({ name: f.name, type: f.type, data: new Uint8Array(await f.arrayBuffer()) });
  return { payload, files };
}

const values = z.record(z.string(), z.unknown()).optional();
const startInput = z.object({
  process: z.string().trim().min(1).max(60),
  values,
  requested_for: z.string().uuid().nullish(),
  case_id: z.string().uuid().nullish(),
});
const submitInput = z.object({
  outcome: z.enum(["submitted", "approved", "rejected", "returned"]).nullish(),
  comment: z.string().max(2000).nullish(),
  values,
  return_to: z.string().max(40).nullish(),
});
const note = z.object({ comment: z.string().max(1000).nullish() });

// ----- the administrator's side -------------------------------------------------------------------------------

processRoutes.get("/hub", async (c) => c.json(await processHub(c.get("ctx"))));

processRoutes.post("/hub/roles/:key/work", async (c) => {
  const ctx = c.get("ctx");
  needRecentAuthOf(c, ctx);
  return c.json({ role: await grantWorkCreate(ctx, c.req.param("key")) });
});

processRoutes.post("/defs", async (c) => {
  const input = await body(
    c,
    z.object({
      name: z.string().trim().min(1).max(120),
      key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, "کلید با حرف لاتین کوچک شروع می‌شود و فقط حرف، رقم و _ دارد"),
      icon: z.string().max(40).nullish(),
      category: z.string().max(80).nullish(),
      description: z.string().max(2000).nullish(),
      draft: z.unknown().optional(),
    }),
  );
  return c.json(await createProcess(c.get("ctx"), input), 201);
});

processRoutes.get("/defs/:id", async (c) => c.json(await processDetail(c.get("ctx"), c.req.param("id"))));

processRoutes.put("/defs/:id/draft", bodyLimit({ maxSize: 2 * 1024 * 1024, onError: tooLarge }), async (c) => {
  const input = await body(
    c,
    z.object({
      draft: z.unknown(),
      name: z.string().trim().min(1).max(120).optional(),
      icon: z.string().max(40).nullish(),
      category: z.string().max(80).nullish(),
      description: z.string().max(2000).nullish(),
      version: z.number().int().optional(),
    }),
  );
  return c.json(await saveDraft(c.get("ctx"), c.req.param("id"), input));
});

processRoutes.get("/defs/:id/diff", async (c) => c.json(await publishPreview(c.get("ctx"), c.req.param("id"))));

processRoutes.post("/defs/:id/publish", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ note: z.string().max(300).nullish() }));
  needRecentAuthOf(c, ctx);
  return c.json(await publishProcess(ctx, c.req.param("id"), input));
});

processRoutes.post("/defs/:id/retire", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ note: z.string().max(300).nullish() }));
  needRecentAuthOf(c, ctx);
  return c.json(await retireProcess(ctx, c.req.param("id"), input));
});

processRoutes.get("/defs/:id/versions", async (c) => c.json(await processVersions(c.get("ctx"), c.req.param("id"))));

processRoutes.post("/defs/:id/versions/:vid/restore", async (c) => c.json(await restoreVersion(c.get("ctx"), c.req.param("id"), c.req.param("vid"))));

// ----- the people's side ------------------------------------------------------------------------------------------

processRoutes.get("/inbox", async (c) => c.json(await inbox(c.get("ctx"))));
processRoutes.get("/inbox/count", async (c) => c.json(await inboxCount(c.get("ctx"))));
processRoutes.get("/done", async (c) => {
  const q = query(c, z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }));
  return c.json(await doneSteps(c.get("ctx"), q));
});
processRoutes.get("/mine", async (c) => c.json(await myProcesses(c.get("ctx"))));
processRoutes.get("/defs/:key/view", async (c) => c.json(await processView(c.get("ctx"), c.req.param("key"))));

processRoutes.get("/cases", async (c) => {
  const q = query(
    c,
    z.object({
      process: z.string().max(60).optional(),
      state: z.string().max(200).optional(),
      step: z.string().max(40).optional(),
      requester: z.string().uuid().optional(),
      unit: z.string().uuid().optional(),
      from: z.string().max(40).optional(),
      to: z.string().max(40).optional(),
      mine: z.enum(["1", "true", "0", "false"]).optional(),
      q: z.string().max(200).optional(),
      page: z.coerce.number().int().min(1).max(10_000).optional(),
      size: z.coerce.number().int().min(1).max(200).optional(),
    }),
  );
  return c.json(
    await casesList(c.get("ctx"), {
      ...q,
      state: q.state ? q.state.split(",").map((s) => s.trim()).filter(Boolean) : null,
      mine: q.mine === "1" || q.mine === "true",
    }),
  );
});

processRoutes.get("/cases/:id", async (c) => c.json(await caseDetail(c.get("ctx"), c.req.param("id"))));
processRoutes.get("/cases/:id/print", async (c) => c.json(await casePrint(c.get("ctx"), c.req.param("id"))));

processRoutes.post("/start", bodyLimit({ maxSize: UPLOAD_LIMIT, onError: tooLarge }), async (c) => {
  const { payload, files } = await payloadOf(c);
  const input = startInput.parse(payload);
  return c.json(await startProcess(c.get("ctx"), { ...input, files }), 201);
});

processRoutes.post("/tasks/:id/submit", bodyLimit({ maxSize: UPLOAD_LIMIT, onError: tooLarge }), async (c) => {
  const { payload, files } = await payloadOf(c);
  const input = submitInput.parse(payload);
  return c.json(await submitStep(c.get("ctx"), c.req.param("id"), { ...input, files }));
});

processRoutes.post("/tasks/:id/claim", async (c) => c.json(await claimStep(c.get("ctx"), c.req.param("id"))));
processRoutes.delete("/tasks/:id/claim", async (c) => c.json(await claimStep(c.get("ctx"), c.req.param("id"), { release: true })));

processRoutes.post("/cases/:id/reassign", async (c) => {
  const input = await body(c, z.object({ step: z.string().min(1).max(40), task: z.string().uuid().nullish(), to: z.array(z.string().uuid()).min(1).max(50), comment: z.string().max(1000).nullish() }));
  return c.json(await reassignStep(c.get("ctx"), c.req.param("id"), input));
});
processRoutes.post("/cases/:id/reresolve", async (c) => {
  const input = await body(c, z.object({ step: z.string().min(1).max(40), rules: z.enum(["case", "current"]).optional() }));
  return c.json(await reresolveStep(c.get("ctx"), c.req.param("id"), input));
});
processRoutes.post("/cases/:id/pause", async (c) => c.json(await pauseCase(c.get("ctx"), c.req.param("id"), await body(c, note))));
processRoutes.post("/cases/:id/resume", async (c) => c.json(await resumeCase(c.get("ctx"), c.req.param("id"), await body(c, note))));
processRoutes.post("/cases/:id/cancel", async (c) => c.json(await cancelCaseAs(c.get("ctx"), c.req.param("id"), await body(c, note))));
processRoutes.post("/cases/:id/resume-from", async (c) => {
  const input = await body(c, z.object({ node: z.string().min(1).max(40), comment: z.string().max(1000).nullish() }));
  return c.json(await resumeFrom(c.get("ctx"), c.req.param("id"), input));
});
