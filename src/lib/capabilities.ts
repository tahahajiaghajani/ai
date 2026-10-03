import "server-only";
import { cache } from "react";
import { db } from "@/lib/supabase/admin";
import { getUserConfig, stageModel, type DispatchDefaults } from "@/lib/settings";
import { listConnections, type GithubConfig } from "@/lib/connections";
import { workflowChoices } from "@/lib/workflow/registry";
import type { SessionUser } from "@/lib/auth";
import type { Capabilities } from "@/lib/types";

/**
 * What a user can use right now. Without AI connections the AI parts are disabled; with AI but no
 * GitHub, projects, knowledge and graphs are disabled while pre-work and main work still run.
 */
export const capabilities = cache(async (user: SessionUser): Promise<Capabilities> => {
  const [conns, cfg] = await Promise.all([listConnections(user.id), getUserConfig(user.id)]);
  const ai = conns.filter((c) => c.kind === "ai");
  const gh = conns.find((c) => c.kind === "github");
  const ghCfg = (gh?.config ?? {}) as GithubConfig;
  const has = (id: string | null) => !!id && ai.some((c) => c.id === id);
  const claudeCode = !!gh && !!ghCfg.claudeCode;
  const engine = cfg.stages.main.engine;
  return {
    mode: user.mode,
    isOwner: user.isOwner,
    ai: ai.length,
    prework: has(stageModel(cfg, "prework").connectionId),
    main: engine === "claude_code" ? claudeCode : has(cfg.stages.main.connectionId),
    github: !!gh && !!ghCfg.repo && gh.status !== "error",
    claudeCode,
    mainEngine: engine,
  };
});

/** Defaults and choices of the "send to pre-work / main work" dialogs. */
export async function dispatchDefaults(user: SessionUser): Promise<DispatchDefaults> {
  const [cfg, caps, workflows, projects] = await Promise.all([
    getUserConfig(user.id),
    capabilities(user),
    workflowChoices(user.id),
    db().from("projects").select("id, name, slug, file_count").eq("owner_id", user.id).order("updated_at", { ascending: false }),
  ]);
  return {
    caps,
    prework: cfg.prework.defaultPrompt,
    main: cfg.main.defaultPrompt,
    claude: { model: cfg.claude.model, effort: cfg.claude.effort, thinking: cfg.claude.thinking },
    engine: cfg.stages.main.engine,
    workflows,
    projects: ((projects.data ?? []) as { id: string; name: string; slug: string; file_count: number }[]).map((p) => ({ id: p.id, name: p.name, slug: p.slug, files: p.file_count })),
  };
}
