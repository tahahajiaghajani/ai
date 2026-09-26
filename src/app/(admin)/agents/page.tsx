import { requireAdmin } from "@/lib/auth";
import { agentPrompt, getAgents, getWorkflows } from "@/lib/workflow/registry";
import { AgentsStudio } from "./agents-studio";

export const metadata = { title: "ایجنت‌ها و ورکفلوها" };

export default async function AgentsPage() {
  const [, [agents, workflows]] = await Promise.all([requireAdmin(), Promise.all([getAgents(), getWorkflows()])]);
  const prompts = Object.fromEntries(await Promise.all(agents.map(async (a) => [a.id, await agentPrompt(a)] as const)));
  return <AgentsStudio initial={{ agents, workflows, prompts }} />;
}
