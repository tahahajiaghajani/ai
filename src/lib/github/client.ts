import "server-only";
import { createHash } from "node:crypto";
import { Octokit } from "@octokit/rest";
import { env } from "@/lib/env";
import { githubConnection, type GithubConfig } from "@/lib/connections";
import { FatalError } from "@/lib/errors";
import { sleep } from "@/lib/utils";

const clients = new Map<string, Octokit>();

export function octokitFor(token: string): Octokit {
  let c = clients.get(token);
  if (!c) {
    c = new Octokit({ auth: token, userAgent: "taskflow-ai" });
    clients.set(token, c);
  }
  return c;
}

/** A repository plus the client (token) that may write to it. */
export interface Repo {
  gh: Octokit;
  owner: string;
  repo: string;
}

const ref = (r: Repo) => ({ owner: r.owner, repo: r.repo });

/** The user's own workspace repository (their knowledge, projects and task records). */
export async function userRepo(userId: string): Promise<Repo> {
  const conn = await githubConnection(userId);
  const cfg = (conn?.config ?? {}) as GithubConfig;
  if (!conn || !cfg.owner || !cfg.repo) throw new FatalError("GitHub این کاربر وصل نیست؛ در «تنظیمات ← اتصال‌ها» GitHub را وصل کنید");
  return { gh: octokitFor(conn.secret), owner: cfg.owner, repo: cfg.repo };
}

export async function userRepoOrNull(userId: string): Promise<Repo | null> {
  try {
    return await userRepo(userId);
  } catch {
    return null;
  }
}

let appOwner: string | null = null;

/** The app's own repository (owner only: self-upgrade), with GITHUB_TOKEN from the environment. */
export async function appRepo(): Promise<Repo> {
  if (!env.githubToken) throw new Error("GITHUB_TOKEN برای مخزن اپ تنظیم نشده است (فقط برای ارتقای خودکار لازم است)");
  const gh = octokitFor(env.githubToken);
  if (!appOwner) appOwner = env.githubOwner || (await gh.rest.users.getAuthenticated()).data.login;
  return { gh, owner: appOwner, repo: env.githubAppRepo };
}

const branchCache = new Map<string, string>();

export async function defaultBranch(r: Repo): Promise<string> {
  const key = `${r.owner}/${r.repo}`;
  const hit = branchCache.get(key);
  if (hit) return hit;
  const { data } = await r.gh.rest.repos.get(ref(r));
  branchCache.set(key, data.default_branch);
  return data.default_branch;
}

export function repoUrl(r: Pick<Repo, "owner" | "repo">, path?: string, branch = "main") {
  const base = `https://github.com/${r.owner}/${r.repo}`;
  return path ? `${base}/tree/${branch}/${path.split("/").map(encodeURIComponent).join("/")}` : base;
}

/** Git's blob id of some content (lets the index know a file's version without asking GitHub). */
export function blobSha(content: string | Uint8Array): string {
  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
  return createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
}

export interface CommitFile {
  path: string;
  /** string = utf-8 text, Uint8Array = binary, null = delete */
  content: string | Uint8Array | null;
}

/**
 * Commit many files in a single commit using the Git Data API. Text goes inline in the tree;
 * binaries become blobs first. Retries when the branch moved underneath us.
 */
export async function commitFiles(r: Repo, files: CommitFile[], message: string, branch?: string): Promise<{ sha: string; url: string } | null> {
  if (!files.length) return null;
  const br = branch ?? (await defaultBranch(r));
  const entries = [];
  for (let i = 0; i < files.length; i += 8) {
    entries.push(
      ...(await Promise.all(
        files.slice(i, i + 8).map(async (f) => {
          if (f.content === null) return { path: f.path, mode: "100644" as const, type: "blob" as const, sha: null };
          if (typeof f.content === "string") return { path: f.path, mode: "100644" as const, type: "blob" as const, content: f.content };
          const blob = await r.gh.rest.git.createBlob({ ...ref(r), content: Buffer.from(f.content).toString("base64"), encoding: "base64" });
          return { path: f.path, mode: "100644" as const, type: "blob" as const, sha: blob.data.sha };
        }),
      )),
    );
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    let baseSha: string | null = null;
    let baseTree: string | undefined;
    try {
      const head = await r.gh.rest.git.getRef({ ...ref(r), ref: `heads/${br}` });
      baseSha = head.data.object.sha;
      baseTree = (await r.gh.rest.git.getCommit({ ...ref(r), commit_sha: baseSha })).data.tree.sha;
    } catch (err) {
      // an empty repository has no branch yet: the first commit creates it
      if ((err as { status?: number }).status !== 409 && (err as { status?: number }).status !== 404) throw err;
    }
    // deleting a path that does not exist makes the whole tree request fail: drop those on an empty repo
    const tree = await r.gh.rest.git.createTree({ ...ref(r), ...(baseTree ? { base_tree: baseTree } : {}), tree: baseTree ? entries : entries.filter((e) => e.sha !== null) });
    const commit = await r.gh.rest.git.createCommit({ ...ref(r), message, tree: tree.data.sha, parents: baseSha ? [baseSha] : [] });
    try {
      if (baseSha) await r.gh.rest.git.updateRef({ ...ref(r), ref: `heads/${br}`, sha: commit.data.sha, force: false });
      else await r.gh.rest.git.createRef({ ...ref(r), ref: `refs/heads/${br}`, sha: commit.data.sha });
      return { sha: commit.data.sha, url: `https://github.com/${r.owner}/${r.repo}/commit/${commit.data.sha}` };
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 422 || status === 409) {
        await sleep(800 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error("کامیت در GitHub به دلیل تغییر هم‌زمان شاخه ناموفق بود");
}

export async function getFileBytes(r: Repo, path: string, branch?: string): Promise<Buffer | null> {
  try {
    const { data } = await r.gh.rest.repos.getContent({ ...ref(r), path, ref: branch });
    if (Array.isArray(data) || data.type !== "file") return null;
    if ("content" in data && data.content) return Buffer.from(data.content, "base64");
    // files over 1MB come without inline content
    const blob = await r.gh.rest.git.getBlob({ ...ref(r), file_sha: data.sha });
    return Buffer.from(blob.data.content, "base64");
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

export async function getFileText(r: Repo, path: string, branch?: string): Promise<string | null> {
  const bytes = await getFileBytes(r, path, branch);
  return bytes ? bytes.toString("utf-8") : null;
}

export async function getBlobBytes(r: Repo, sha: string): Promise<Buffer> {
  const blob = await r.gh.rest.git.getBlob({ ...ref(r), file_sha: sha });
  return Buffer.from(blob.data.content, "base64");
}

export interface TreeItem {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha: string;
}

export async function listTree(r: Repo, prefix = "", branch?: string): Promise<TreeItem[]> {
  try {
    const br = branch ?? (await defaultBranch(r));
    const { data } = await r.gh.rest.git.getTree({ ...ref(r), tree_sha: br, recursive: "true" });
    const dir = prefix.endsWith("/") ? prefix : `${prefix}/`;
    return (data.tree as TreeItem[]).filter((t) => !prefix || t.path === prefix || t.path.startsWith(dir));
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404 || status === 409) return [];
    throw err;
  }
}

export async function repoExists(r: Repo): Promise<boolean> {
  try {
    await r.gh.rest.repos.get(ref(r));
    return true;
  } catch (err) {
    if ((err as { status?: number }).status === 404) return false;
    throw err;
  }
}

/** Creates the repository (private) in the token owner's account when it does not exist. */
export async function ensureRepo(r: Repo, description: string): Promise<boolean> {
  if (await repoExists(r)) return false;
  const me = await r.gh.rest.users.getAuthenticated();
  if (me.data.login.toLowerCase() === r.owner.toLowerCase()) {
    await r.gh.rest.repos.createForAuthenticatedUser({ name: r.repo, private: true, auto_init: true, description });
  } else {
    await r.gh.rest.repos.createInOrg({ org: r.owner, name: r.repo, private: true, auto_init: true, description });
  }
  for (let i = 0; i < 10; i++) {
    if (await repoExists(r)) break;
    await sleep(1000);
  }
  branchCache.delete(`${r.owner}/${r.repo}`);
  return true;
}

export async function dispatchWorkflow(r: Repo, workflow: string, inputs: Record<string, string>, branch?: string) {
  const br = branch ?? (await defaultBranch(r));
  await r.gh.rest.actions.createWorkflowDispatch({ ...ref(r), workflow_id: workflow, ref: br, inputs });
}

export async function getRun(r: Repo, runId: number) {
  const { data } = await r.gh.rest.actions.getWorkflowRun({ ...ref(r), run_id: runId });
  return data;
}

export async function cancelRun(r: Repo, runId: number) {
  await r.gh.rest.actions.cancelWorkflowRun({ ...ref(r), run_id: runId });
}

export async function listWorkflowFiles(r: Repo): Promise<string[]> {
  try {
    const { data } = await r.gh.rest.actions.listRepoWorkflows({ ...ref(r), per_page: 100 });
    return data.workflows.map((w) => w.path.split("/").pop() ?? w.path);
  } catch {
    return [];
  }
}

export async function listSecretNames(r: Repo): Promise<string[]> {
  try {
    const { data } = await r.gh.rest.actions.listRepoSecrets({ ...ref(r), per_page: 100 });
    return data.secrets.map((s) => s.name);
  } catch {
    return [];
  }
}

/** Create/update an Actions secret (encrypted with the repo public key; never stored by the app). */
export async function setRepoSecret(r: Repo, name: string, value: string) {
  const sodiumMod = await import("libsodium-wrappers");
  const sodium = (sodiumMod as unknown as { default?: typeof sodiumMod }).default ?? sodiumMod;
  await sodium.ready;
  const { data: key } = await r.gh.rest.actions.getRepoPublicKey(ref(r));
  const binKey = sodium.from_base64(key.key, sodium.base64_variants.ORIGINAL);
  const encrypted = sodium.crypto_box_seal(sodium.from_string(value), binKey);
  await r.gh.rest.actions.createOrUpdateRepoSecret({
    ...ref(r),
    secret_name: name,
    encrypted_value: sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL),
    key_id: key.key_id,
  });
}

export async function deleteRepoSecret(r: Repo, name: string) {
  try {
    await r.gh.rest.actions.deleteRepoSecret({ ...ref(r), secret_name: name });
  } catch {
    /* not set */
  }
}

/** Login and classic-token scopes of a token (null = invalid). */
export async function tokenInfo(token: string): Promise<{ login: string; scopes: string[] } | null> {
  try {
    const res = await octokitFor(token).rest.users.getAuthenticated();
    const scopes = String(res.headers["x-oauth-scopes"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return { login: res.data.login, scopes };
  } catch {
    return null;
  }
}

/** Preview deployment URL that Vercel reports back to GitHub for a commit. */
export async function previewUrlForSha(r: Repo, sha: string): Promise<string | null> {
  try {
    const { data: deployments } = await r.gh.rest.repos.listDeployments({ ...ref(r), sha, per_page: 10 });
    for (const d of deployments) {
      const { data: statuses } = await r.gh.rest.repos.listDeploymentStatuses({ ...ref(r), deployment_id: d.id, per_page: 5 });
      const ok = statuses.find((s) => s.state === "success" && (s.environment_url || s.target_url));
      if (ok) return ok.environment_url || ok.target_url || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}
