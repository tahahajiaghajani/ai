#!/usr/bin/env node
/**
 * TaskFlow AI — GitHub Actions runner helper.
 *
 * Talks to the TaskFlow app (job spec, live events, final result), runs Claude Code headless
 * with a live activity stream, keeps Claude sessions per task so related tasks continue the
 * same project, updates the data map (manifest.json) and commits the results.
 *
 * Subcommands:
 *   spec | inputs | restore-session | run-claude | finalize | upgrade | graphify | kb "<query>" | notify-push
 *
 * Only Node.js built-ins are used on purpose (no npm install needed on the runner).
 */
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const APP_URL = (process.env.TASKFLOW_APP_URL || "").replace(/\/$/, "");
const SECRET = process.env.TASKFLOW_RUNNER_SECRET || "";
const JOB_ID = process.env.TASKFLOW_JOB_ID || "";
const TMP = process.env.RUNNER_TEMP || os.tmpdir();
const SPEC_FILE = path.join(TMP, "taskflow-spec.json");
const RESULT_FILE = path.join(TMP, "taskflow-result.json");
const REPO = process.cwd();

const LIMIT_RE =
  /(hit your (session|weekly|opus|sonnet|fable|usage|individual usage)? ?limit|usage limit reached|rate[_ ]limit|request rejected \(429\)|temporarily limiting requests|spend limit)/i;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function log(...args) {
  console.log("[taskflow]", ...args);
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function api(pathname, { method = "GET", body, raw = false, attempts = 4 } = {}) {
  if (!APP_URL || !SECRET) throw new Error("TASKFLOW_APP_URL / TASKFLOW_RUNNER_SECRET are not set");
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${APP_URL}${pathname}`, {
        method,
        headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status >= 500) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      if (raw) return res;
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { text };
      }
      return { status: res.status, data };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

const queue = [];
let flushing = null;

function emit(event) {
  queue.push(event);
  if (queue.length >= 25) void flush();
}

async function flush() {
  if (flushing) return flushing;
  if (!queue.length) return;
  const batch = queue.splice(0, queue.length);
  flushing = api("/api/runner/events", { method: "POST", body: { job_id: JOB_ID, events: batch } })
    .catch((err) => log("event post failed:", err.message))
    .finally(() => {
      flushing = null;
    });
  return flushing;
}

function readSpec() {
  return JSON.parse(fs.readFileSync(SPEC_FILE, "utf-8"));
}

function clip(value, n) {
  const s = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Keep events small: tool results and file contents are truncated before being sent. */
function slimEvent(ev) {
  const copy = JSON.parse(JSON.stringify(ev));
  const content = copy?.message?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === "tool_result") block.content = clip(block.content, 3000);
      if (block.type === "tool_use" && block.input) {
        for (const key of ["content", "new_string", "old_string"]) {
          if (typeof block.input[key] === "string") block.input[key] = clip(block.input[key], 4000);
        }
        if (Array.isArray(block.input.edits)) block.input.edits = block.input.edits.slice(0, 3).map((e) => ({ ...e, old_string: clip(e.old_string, 400), new_string: clip(e.new_string, 1200) }));
      }
      if (block.type === "text") block.text = clip(block.text, 8000);
      if (block.type === "thinking") block.thinking = clip(block.thinking, 3000);
    }
  }
  if (typeof copy.result === "string") copy.result = clip(copy.result, 12000);
  delete copy.usage;
  return copy;
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

function trySh(cmd, args, opts = {}) {
  try {
    return sh(cmd, args, opts);
  } catch (err) {
    return null;
  }
}

async function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

function gitCommitAndPush(message, branch, { exclude = [] } = {}) {
  sh("git", ["config", "user.name", "TaskFlow Runner"]);
  sh("git", ["config", "user.email", "taskflow-runner@users.noreply.github.com"]);
  sh("git", ["add", "-A", "--", ".", ...exclude.map((e) => `:!${e}`)]);
  const staged = trySh("git", ["diff", "--cached", "--name-only"]) || "";
  if (!staged) return { sha: null, files: [] };
  sh("git", ["commit", "-m", message]);
  const files = staged.split("\n").filter(Boolean);
  for (let i = 0; i < 5; i++) {
    try {
      sh("git", ["pull", "--rebase", "--autostash", "origin", branch]);
    } catch (err) {
      log("pull --rebase failed:", err.message);
    }
    try {
      sh("git", ["push", "origin", `HEAD:${branch}`]);
      return { sha: sh("git", ["rev-parse", "HEAD"]), files };
    } catch (err) {
      log(`push attempt ${i + 1} failed:`, err.message);
    }
  }
  throw new Error("git push failed after retries");
}

function currentBranch() {
  return process.env.GITHUB_REF_NAME || trySh("git", ["rev-parse", "--abbrev-ref", "HEAD"]) || "main";
}

function commitUrl(sha) {
  const repo = process.env.GITHUB_REPOSITORY;
  return sha && repo ? `https://github.com/${repo}/commit/${sha}` : null;
}

// ---------------------------------------------------------------------------
// subcommands
// ---------------------------------------------------------------------------
async function cmdSpec() {
  const { status, data } = await api(`/api/runner/jobs/${JOB_ID}`);
  if (status !== 200) {
    log("job not runnable:", JSON.stringify(data));
    setOutput("skip", "true");
    return;
  }
  fs.writeFileSync(SPEC_FILE, JSON.stringify(data, null, 2));
  setOutput("skip", "false");
  setOutput("kind", data.kind);
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;
  emit({ type: "run_started", run_id: process.env.GITHUB_RUN_ID || "local", run_url: runUrl });
  emit({ type: "log", title: `runner آماده است (${data.kind}${data.task_code ? ` — ${data.task_code}` : ""})` });
  await flush();
}

async function cmdInputs() {
  const spec = readSpec();
  for (const item of spec.remote_inputs || []) {
    const target = path.join(REPO, item.path);
    if (fs.existsSync(target)) continue;
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const res = await fetch(item.url);
    if (!res.ok) {
      emit({ type: "log", level: "warning", title: `دانلود فایل ${path.basename(item.path)} ناموفق بود (${res.status})` });
      continue;
    }
    await fsp.writeFile(target, Buffer.from(await res.arrayBuffer()));
    emit({ type: "log", title: `فایل ورودی دانلود شد: ${item.path}` });
  }
  await flush();
}

function sessionDir(spec) {
  return spec.task_path ? path.join(REPO, spec.task_path, ".claude-session") : null;
}

async function cmdRestoreSession() {
  const spec = readSpec();
  const dir = sessionDir(spec);
  if (!spec.resume_session_id || !dir) return;
  const file = path.join(dir, `${spec.resume_session_id}.jsonl`);
  const metaFile = path.join(dir, "session.json");
  if (!fs.existsSync(file)) {
    log("session file not found; starting a fresh session");
    return;
  }
  const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf-8")) : {};
  const projectDir = meta.project_dir || REPO.replace(/[^a-zA-Z0-9]/g, "-");
  const target = path.join(os.homedir(), ".claude", "projects", projectDir);
  await fsp.mkdir(target, { recursive: true });
  await fsp.copyFile(file, path.join(target, `${spec.resume_session_id}.jsonl`));
  emit({ type: "log", title: "جلسه‌ی قبلی Claude برای ادامه‌ی همان پروژه بازیابی شد" });
  await flush();
}

function claudeEnv() {
  const env = { ...process.env, DISABLE_AUTOUPDATER: "1", CI: "true" };
  for (const key of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]) if (!env[key]) delete env[key];
  delete env.TASKFLOW_RUNNER_SECRET;
  return env;
}

/** Run Claude Code once, streaming every event to the app. */
function runClaudeOnce({ prompt, resume, model, maxTurns, effort, thinking }) {
  return new Promise((resolve) => {
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", "--max-turns", String(maxTurns || 250)];
    if (resume) args.push("--resume", resume);
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);
    // Newer models always think adaptively (effort sets the depth); "on"/"off" matter for older ones.
    if (thinking === "on") args.push("--settings", JSON.stringify({ alwaysThinkingEnabled: true }));
    const env = claudeEnv();
    if (thinking === "off") env.MAX_THINKING_TOKENS = "0";
    const child = spawn("claude", args, { cwd: REPO, env, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.end(prompt);

    let sessionId = null;
    let result = null;
    let stderr = "";
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.session_id) sessionId = ev.session_id;
      if (ev.type === "result") result = ev;
      if (["system", "assistant", "user", "result"].includes(ev.type)) emit({ type: "claude", event: slimEvent(ev) });
    });
    child.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-8000);
      process.stderr.write(d);
    });
    const timer = setInterval(() => {
      emit({ type: "heartbeat" });
      void flush();
    }, 2_000);
    child.on("close", (code) => {
      clearInterval(timer);
      resolve({ code, sessionId, result, stderr });
    });
  });
}

async function cmdRunClaude() {
  const spec = readSpec();
  const opts = { prompt: spec.prompt, model: spec.model, maxTurns: spec.max_turns, effort: spec.effort, thinking: spec.thinking };
  emit({ type: "log", title: `Claude: مدل ${spec.model || "پیش‌فرض حساب"}${spec.effort ? ` · effort ${spec.effort}` : ""}${spec.thinking && spec.thinking !== "auto" ? ` · thinking ${spec.thinking}` : ""}` });
  let out = await runClaudeOnce({ ...opts, resume: spec.resume_session_id });
  if (spec.resume_session_id && !out.result && /no conversation found|session.*not found|could not resume/i.test(out.stderr)) {
    emit({ type: "log", level: "warning", title: "ادامه‌ی جلسه‌ی قبلی ممکن نشد؛ شروع جلسه‌ی جدید" });
    out = await runClaudeOnce({ ...opts, resume: null });
  }
  await flush();
  fs.writeFileSync(RESULT_FILE, JSON.stringify(out, null, 2));
  log(`claude exited with code ${out.code}`);
}

async function saveSession(spec, sessionId) {
  const dir = sessionDir(spec);
  if (!dir || !sessionId) return;
  const root = path.join(os.homedir(), ".claude", "projects");
  const files = (await walk(root)).filter((f) => path.basename(f) === `${sessionId}.jsonl`);
  if (!files.length) return;
  await fsp.mkdir(dir, { recursive: true });
  for (const old of await fsp.readdir(dir)) if (old.endsWith(".jsonl")) await fsp.rm(path.join(dir, old));
  await fsp.copyFile(files[0], path.join(dir, `${sessionId}.jsonl`));
  await fsp.writeFile(
    path.join(dir, "session.json"),
    JSON.stringify({ session_id: sessionId, project_dir: path.basename(path.dirname(files[0])), saved_at: new Date().toISOString() }, null, 2),
  );
}

function roleOf(rel) {
  const name = path.basename(rel).toUpperCase();
  if (name === "EXPLANATION.MD") return "explanation";
  if (name === "CHANGELOG.MD") return "changelog";
  if (name === "FILES.MD") return "data-map";
  return "final";
}

async function updateManifest(spec) {
  const base = path.join(REPO, spec.task_path);
  const manifestPath = path.join(base, "manifest.json");
  if (!fs.existsSync(manifestPath)) return;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const iteration = Number((spec.iteration_path || "").split("/").pop()?.split("_")[0]) || 1;
  const now = new Date().toISOString();
  const finals = (await walk(path.join(base, "final"))).map((f) => path.relative(REPO, f).split(path.sep).join("/"));
  const byPath = new Map((manifest.files || []).map((f) => [f.path, f]));
  for (const p of finals) {
    const prev = byPath.get(p);
    byPath.set(p, { ...(prev || {}), path: p, role: prev?.role || roleOf(p), agent: "Claude (کار اصلی)", iteration: prev?.iteration || iteration, updated_at: now, description: prev?.description || "خروجی نهایی" });
  }
  for (const [p] of byPath) if (p.startsWith(`${spec.task_path}/final/`) && !finals.includes(p)) byPath.delete(p);
  manifest.files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  manifest.iterations = manifest.iterations || [];
  let it = manifest.iterations.find((i) => i.seq === iteration);
  if (!it) {
    it = { seq: iteration, code: spec.task_code, title: "", relation: null, folder: spec.iteration_path };
    manifest.iterations.push(it);
  }
  it.main = { job_id: spec.job_id, completed_at: now, status: "done" };
  manifest.updated_at = now;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const readmePath = path.join(base, "README.md");
  if (fs.existsSync(readmePath)) {
    const table = finals
      .map((p) => `| \`${p.replace(`${spec.task_path}/`, "")}\` | ${roleOf(p)} |`)
      .join("\n");
    const section = `<!-- final:start -->\n## خروجی نهایی (Claude)\n\n| مسیر | نقش |\n|---|---|\n${table || "| — | — |"}\n<!-- final:end -->`;
    let readme = fs.readFileSync(readmePath, "utf-8");
    readme = /<!-- final:start -->[\s\S]*<!-- final:end -->/.test(readme)
      ? readme.replace(/<!-- final:start -->[\s\S]*<!-- final:end -->/, section)
      : `${readme.trim()}\n\n${section}\n`;
    fs.writeFileSync(readmePath, readme);
  }
}

function classify(out) {
  const text = `${out?.result?.result || ""}\n${out?.stderr || ""}`;
  if (LIMIT_RE.test(text)) return { status: "rate_limited", error: clip(text, 4000) };
  if (!out || !out.result) return { status: "error", error: clip(out?.stderr || "Claude هیچ نتیجه‌ای برنگرداند", 4000) };
  if (out.result.is_error || (out.result.subtype && out.result.subtype !== "success")) return { status: "error", error: clip(text, 4000) };
  return { status: "success" };
}

async function cmdFinalize() {
  const spec = readSpec();
  const out = fs.existsSync(RESULT_FILE) ? JSON.parse(fs.readFileSync(RESULT_FILE, "utf-8")) : null;
  const verdict = classify(out);
  let commit = { sha: null, files: [] };
  try {
    await saveSession(spec, out?.sessionId);
    if (verdict.status === "success") await updateManifest(spec);
    commit = gitCommitAndPush(
      verdict.status === "success" ? spec.commit_message : `${spec.commit_message} (نیمه‌کاره: ${verdict.status})`,
      currentBranch(),
    );
    if (commit.sha) emit({ type: "log", title: `${commit.files.length} فایل در GitHub commit شد`, detail: commitUrl(commit.sha) });
  } catch (err) {
    emit({ type: "log", level: "error", title: "ذخیره/commit نتایج ناموفق بود", detail: String(err.message || err) });
  }
  emit({
    type: "result",
    status: verdict.status,
    error: verdict.error,
    summary: clip(out?.result?.result || "", 30000),
    session_id: out?.sessionId || null,
    commit_sha: commit.sha,
    commit_url: commitUrl(commit.sha),
    files_changed: commit.files,
  });
  await flush();
}

async function cmdUpgrade() {
  const spec = readSpec();
  const base = process.env.TASKFLOW_BASE_BRANCH || currentBranch();
  const branch = spec.branch || `upgrade/${JOB_ID.slice(0, 8)}`;
  try {
    sh("git", ["checkout", "-B", branch]);
    let out = await runClaudeOnce({ prompt: spec.prompt, resume: null, model: spec.model, maxTurns: spec.max_turns, effort: spec.effort, thinking: spec.thinking });
    let verdict = classify(out);
    // Self-healing: build must pass; feed errors back to the same Claude session (max 2 rounds).
    for (let round = 0; verdict.status === "success" && round < 3; round++) {
      emit({ type: "log", title: "بررسی کیفیت: typecheck و build" });
      await flush();
      const check = spawnSyncSafe("npm", ["run", "typecheck"]) || spawnSyncSafe("npm", ["run", "build"]);
      if (!check) {
        emit({ type: "log", title: "typecheck و build با موفقیت پاس شد" });
        break;
      }
      if (round === 2) {
        verdict = { status: "error", error: `build پس از دو بار اصلاح هنوز خطا دارد:\n${check}` };
        break;
      }
      emit({ type: "log", level: "warning", title: "build خطا داشت؛ Claude در حال اصلاح است", detail: clip(check, 3000) });
      out = await runClaudeOnce({
        prompt: `بررسی کیفیت خطا داد. این خطاها را کامل برطرف کن (بدون حذف قابلیت‌ها):\n\n${clip(check, 12000)}`,
        resume: out.sessionId,
        model: spec.model,
        maxTurns: 80,
        effort: spec.effort,
        thinking: spec.thinking,
      });
      verdict = classify(out);
    }
    if (verdict.status !== "success") {
      emit({ type: "result", status: verdict.status, error: verdict.error, summary: clip(out?.result?.result || "", 4000), session_id: out?.sessionId });
      await flush();
      return;
    }
    const commit = gitCommitAndPush(spec.commit_message, branch, { exclude: [".upgrade-inputs"] });
    if (!commit.sha) {
      emit({ type: "result", status: "success", summary: "تغییری لازم نبود", branch, files_changed: [] });
      await flush();
      return;
    }
    const pr = await createPullRequest({ branch, base, title: spec.commit_message, body: `${out?.result?.result || ""}\n\n---\nساخته‌شده به صورت خودکار توسط بخش «ارتقا»ی TaskFlow AI.` });
    emit({
      type: "result",
      status: "success",
      summary: clip(out?.result?.result || "", 6000),
      session_id: out?.sessionId,
      commit_sha: commit.sha,
      commit_url: commitUrl(commit.sha),
      branch,
      pr_url: pr?.html_url || null,
      pr_number: pr?.number || null,
      files_changed: commit.files,
    });
  } catch (err) {
    emit({ type: "result", status: "error", error: String(err.message || err) });
  }
  await flush();
}

function spawnSyncSafe(cmd, args) {
  try {
    execFileSync(cmd, args, { cwd: REPO, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
    return null;
  } catch (err) {
    return `${err.stdout || ""}\n${err.stderr || ""}`.trim().slice(-12000) || String(err.message);
  }
}

async function createPullRequest({ branch, base, title, body }) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return null;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" };
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls`, { method: "POST", headers, body: JSON.stringify({ title, head: branch, base, body }) });
  if (res.ok) return res.json();
  if (res.status === 422) {
    const [owner] = repo.split("/");
    const existing = await fetch(`https://api.github.com/repos/${repo}/pulls?head=${owner}:${encodeURIComponent(branch)}&state=open`, { headers });
    const list = existing.ok ? await existing.json() : [];
    return list[0] || null;
  }
  throw new Error(`ساخت Pull Request ناموفق بود: ${res.status} ${await res.text()}`);
}

async function cmdGraphify() {
  const spec = readSpec();
  const g = spec.graphify || {};
  const dir = path.join(REPO, g.path || spec.task_path || ".");
  if (!fs.existsSync(dir)) {
    emit({ type: "result", status: "error", error: `پوشه‌ی ${g.path} وجود ندارد` });
    await flush();
    return;
  }
  const env = { ...process.env, GOOGLE_API_KEY: process.env.GEMINI_API_KEY || "" };
  const attempts = [];
  if (g.mode === "gemini" && process.env.GEMINI_API_KEY) attempts.push(["extract", ".", "--backend", "gemini", "--model", g.model || "gemini-flash-latest", "--max-concurrency", "1"]);
  attempts.push(["extract", ".", "--code-only"]);
  let ok = false;
  let lastErr = "";
  for (const args of attempts) {
    emit({ type: "log", title: `اجرای graphify ${args.slice(2).join(" ")}` });
    await flush();
    try {
      execFileSync("graphify", args, { cwd: dir, env, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 25 * 60_000 });
      ok = true;
      break;
    } catch (err) {
      lastErr = `${err.stdout || ""}\n${err.stderr || ""}`.slice(-3000) || err.message;
    }
  }
  // graphify writes graphify-out/ next to where it runs; make sure it lives inside the task folder.
  const rootOut = path.join(REPO, "graphify-out");
  if (ok && !fs.existsSync(path.join(dir, "graphify-out")) && fs.existsSync(rootOut) && dir !== REPO) {
    await fsp.rename(rootOut, path.join(dir, "graphify-out"));
  }
  let commit = { sha: null, files: [] };
  if (ok) {
    try {
      // graphify-out/cache and cost.json are excluded through .gitignore
      commit = gitCommitAndPush(spec.commit_message, currentBranch());
    } catch (err) {
      lastErr = err.message;
      ok = false;
    }
  }
  emit({ type: "result", status: ok ? "success" : "error", summary: ok ? `graph.json و GRAPH_REPORT.md ساخته شد` : undefined, error: ok ? undefined : lastErr, commit_sha: commit.sha, commit_url: commitUrl(commit.sha) });
  await flush();
}

async function cmdKb(query) {
  if (!query) {
    console.log('usage: node .github/scripts/taskflow.mjs kb "پرسش"');
    return;
  }
  const res = await api(`/api/runner/knowledge?q=${encodeURIComponent(query)}&k=6`, { raw: true });
  console.log(await res.text());
}

async function cmdNotifyPush() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return;
  const ev = JSON.parse(fs.readFileSync(eventPath, "utf-8"));
  const commits = (ev.commits || []).filter((c) => !String(c.message || "").startsWith("[TaskFlow"));
  if (!commits.length) return;
  const files = [...new Set(commits.flatMap((c) => [...(c.added || []), ...(c.modified || []), ...(c.removed || [])]))];
  await api("/api/runner/events", {
    method: "POST",
    body: { push: { ref: ev.ref, files, commits: commits.map((c) => ({ message: c.message, url: c.url, author: c.author?.name })) } },
  });
}

// ---------------------------------------------------------------------------
const [cmd, ...rest] = process.argv.slice(2);
const commands = {
  spec: cmdSpec,
  inputs: cmdInputs,
  "restore-session": cmdRestoreSession,
  "run-claude": cmdRunClaude,
  finalize: cmdFinalize,
  upgrade: cmdUpgrade,
  graphify: cmdGraphify,
  kb: () => cmdKb(rest.join(" ")),
  "notify-push": cmdNotifyPush,
};

if (!commands[cmd]) {
  console.error(`unknown command: ${cmd}\n${Object.keys(commands).join(" | ")}`);
  process.exit(2);
}
commands[cmd]()
  .then(() => flush())
  .catch(async (err) => {
    console.error(err);
    if (JOB_ID && cmd !== "kb" && cmd !== "notify-push") {
      emit({ type: "log", level: "error", title: `خطای runner در مرحله‌ی ${cmd}`, detail: String(err.stack || err) });
      if (cmd === "spec" || cmd === "finalize") emit({ type: "result", status: "error", error: String(err.message || err) });
      await flush();
    }
    process.exit(cmd === "run-claude" ? 0 : 1);
  });
