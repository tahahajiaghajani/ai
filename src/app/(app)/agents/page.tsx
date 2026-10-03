import { requireFull } from "@/lib/auth";
import { listConnections, type AiConfig } from "@/lib/connections";
import { agentPrompt, getAgents, getWorkflows } from "@/lib/workflow/registry";
import { AgentsStudio } from "./agents-studio";

export const metadata = { title: "ایجنت‌ها" };

export default async function AgentsPage(props: PageProps<"/agents">) {
  const me = await requireFull();
  const { tab } = await props.searchParams;
  const [agents, workflows, conns] = await Promise.all([getAgents(me.id), getWorkflows(me.id), listConnections(me.id)]);
  const prompts = Object.fromEntries(await Promise.all(agents.map(async (a) => [a.id, await agentPrompt(me.id, a)] as const)));
  // model names of the user's connections, suggested in the agent editor
  const models = [...new Set(conns.filter((c) => c.kind === "ai").flatMap((c) => (c.config as AiConfig).models ?? []))].sort();
  return <AgentsStudio initial={{ agents, workflows, prompts }} models={models} tab={tab === "agents" ? "agents" : "workflows"} />;
}
