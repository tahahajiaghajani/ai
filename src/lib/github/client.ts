import "server-only";
import { Octokit } from "@octokit/rest";
import { env } from "@/lib/env";
import { sleep } from "@/lib/utils";

let octo: Octokit | null = null;

export function gh(): Octokit {
  if (!env.githubToken) throw new Error("GITHUB_TOKEN تنظیم نشده است");
  if (!octo) octo = new Octokit({ auth: env.githubToken, userAgent: "taskflow-ai" });
  return octo;
}

let ownerCache: string | null = null;

export async function githubOwner(): Promise<string> {
  if (env.githubOwner) return env.githubOwner;
  if (ownerCache) return ownerCache;
  const { data } = await gh().rest.users.getAuthenticated();
  ownerCache = data.login;
  return ownerCache;
}

export type RepoRef = {
  owner: string;
  repo: string;
};

export async function repoRef(which: "workspace" | "app"): Promise<RepoRef> {
  return { owner: await githubOwner(), repo: which === "workspace" ? env.githubWorkspaceRepo : env.githubAppRepo };
}

const branchCache = new Map<string, string>();

export async function defaultBranch(ref: RepoRef): Promise<string> {
  const key = `${ref.owner}/${ref.repo}`;
  const hit = branchCache.get(key);
  if (hit) return hit;
  const { data } = await gh().rest.repos.get(ref);
  branchCache.set(key, data.default_branch);
  return data.default_branch;
}

export function repoUrl(ref: RepoRef, path?: string, branch = "main") {
  const base = `https://github.com/${ref.owner}/${ref.repo}`;
  return path ? `${base}/tree/${branch}/${encodeURI(path)}` : base;
}

export interface CommitFile {
  path: string;
  /** string = utf-8 text, Uint8Array = binary, null = delete */
  content: string | Uint8Array | null;
}

/**
 * Commit many files in a single commit using the Git Data API.
 * Retries when the branch moved underneath us (e.g. a runner pushed concurrently).
 */
export async function commitFiles(ref: RepoRef, files: CommitFile[], message: string, branch?: string): Promise<{ sha: string; url: string } | null> {
  if (!files.length) return null;
  const octokit = gh();
  const br = branch ?? (await defaultBranch(ref));

  // Blobs for binary files are created once and reused across retries.
  const entries = await Promise.all(
    files.map(async (f) => {
      if (f.content === null) return { path: f.path, mode: "100644" as const, type: "blob" as const, sha: null };
      if (typeof f.content === "string") return { path: f.path, mode: "100644" as const, type: "blob" as const, content: f.content };
      const blob = await octokit.rest.git.createBlob({ ...ref, content: Buffer.from(f.content).toString("base64"), encoding: "base64" });
      return { path: f.path, mode: "100644" as const, type: "blob" as const, sha: blob.data.sha };
    }),
  );

  for (let attempt = 0; attempt < 4; attempt++) {
    const head = await octokit.rest.git.getRef({ ...ref, ref: `heads/${br}` });
    const baseSha = head.data.object.sha;
    const baseCommit = await octokit.rest.git.getCommit({ ...ref, commit_sha: baseSha });
    const tree = await octokit.rest.git.createTree({ ...ref, base_tree: baseCommit.data.tree.sha, tree: entries });
    const commit = await octokit.rest.git.createCommit({ ...ref, message, tree: tree.data.sha, parents: [baseSha] });
    try {
      await octokit.rest.git.updateRef({ ...ref, ref: `heads/${br}`, sha: commit.data.sha, force: false });
      return { sha: commit.data.sha, url: `https://github.com/${ref.owner}/${ref.repo}/commit/${commit.data.sha}` };
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

export async function getFileText(ref: RepoRef, path: string, branch?: string): Promise<string | null> {
  try {
    const { data } = await gh().rest.repos.getContent({ ...ref, path, ref: branch });
    if (Array.isArray(data) || data.type !== "file") return null;
    if ("content" in data && data.content) return Buffer.from(data.content, "base64").toString("utf-8");
    // Large files (>1MB) come without inline content.
    const blob = await gh().rest.git.getBlob({ ...ref, file_sha: data.sha });
    return Buffer.from(blob.data.content, "base64").toString("utf-8");
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

/** Raw bytes of a repository file (null when it does not exist). */
export async function getFileBytes(ref: RepoRef, path: string, branch?: string): Promise<Buffer | null> {
  try {
    const { data } = await gh().rest.repos.getContent({ ...ref, path, ref: branch });
    if (Array.isArray(data) || data.type !== "file") return null;
    if ("content" in data && data.content) return Buffer.from(data.content, "base64");
    const blob = await gh().rest.git.getBlob({ ...ref, file_sha: data.sha });
    return Buffer.from(blob.data.content, "base64");
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

export interface TreeItem {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha: string;
}

export async function listTree(ref: RepoRef, prefix = "", branch?: string): Promise<TreeItem[]> {
  const br = branch ?? (await defaultBranch(ref));
  try {
    const { data } = await gh().rest.git.getTree({ ...ref, tree_sha: br, recursive: "true" });
    return (data.tree as TreeItem[]).filter((t) => !prefix || t.path === prefix || t.path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
  } catch (err) {
    if ((err as { status?: number }).status === 404 || (err as { status?: number }).status === 409) return [];
    throw err;
  }
}

export async function repoExists(ref: RepoRef): Promise<boolean> {
  try {
    await gh().rest.repos.get(ref);
    return true;
  } catch (err) {
    if ((err as { status?: number }).status === 404) return false;
    throw err;
  }
}

export async function ensureRepo(ref: RepoRef, description: string): Promise<boolean> {
  if (await repoExists(ref)) return false;
  const me = await gh().rest.users.getAuthenticated();
  if (me.data.login.toLowerCase() === ref.owner.toLowerCase()) {
    await gh().rest.repos.createForAuthenticatedUser({ name: ref.repo, private: true, auto_init: true, description });
  } else {
    await gh().rest.repos.createInOrg({ org: ref.owner, name: ref.repo, private: true, auto_init: true, description });
  }
  for (let i = 0; i < 10; i++) {
    if (await repoExists(ref)) break;
    await sleep(1000);
  }
  return true;
}

export async function dispatchWorkflow(ref: RepoRef, workflow: string, inputs: Record<string, string>, branch?: string) {
  const br = branch ?? (await defaultBranch(ref));
  await gh().rest.actions.createWorkflowDispatch({ ...ref, workflow_id: workflow, ref: br, inputs });
}

export async function getRun(ref: RepoRef, runId: number) {
  const { data } = await gh().rest.actions.getWorkflowRun({ ...ref, run_id: runId });
  return data;
}

export async function listWorkflowFiles(ref: RepoRef): Promise<string[]> {
  try {
    const { data } = await gh().rest.actions.listRepoWorkflows({ ...ref, per_page: 100 });
    return data.workflows.map((w) => w.path.split("/").pop() ?? w.path);
  } catch {
    return [];
  }
}

export async function listSecretNames(ref: RepoRef): Promise<string[]> {
  try {
    const { data } = await gh().rest.actions.listRepoSecrets({ ...ref, per_page: 100 });
    return data.secrets.map((s) => s.name);
  } catch {
    return [];
  }
}

/** Create/update an Actions secret (value is encrypted with the repo public key, never stored by us). */
export async function setRepoSecret(ref: RepoRef, name: string, value: string) {
  const sodiumMod = await import("libsodium-wrappers");
  const sodium = (sodiumMod as unknown as { default?: typeof sodiumMod }).default ?? sodiumMod;
  await sodium.ready;
  const { data: key } = await gh().rest.actions.getRepoPublicKey(ref);
  const binKey = sodium.from_base64(key.key, sodium.base64_variants.ORIGINAL);
  const encrypted = sodium.crypto_box_seal(sodium.from_string(value), binKey);
  await gh().rest.actions.createOrUpdateRepoSecret({
    ...ref,
    secret_name: name,
    encrypted_value: sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL),
    key_id: key.key_id,
  });
}

export async function tokenInfo(): Promise<{ login: string; scopes: string[] } | null> {
  try {
    const res = await gh().rest.users.getAuthenticated();
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
export async function previewUrlForSha(ref: RepoRef, sha: string): Promise<string | null> {
  try {
    const { data: deployments } = await gh().rest.repos.listDeployments({ ...ref, sha, per_page: 10 });
    for (const d of deployments) {
      const { data: statuses } = await gh().rest.repos.listDeploymentStatuses({ ...ref, deployment_id: d.id, per_page: 5 });
      const ok = statuses.find((s) => s.state === "success" && (s.environment_url || s.target_url));
      if (ok) return ok.environment_url || ok.target_url || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}
