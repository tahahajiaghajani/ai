// The virtual agent («دستیار مجازی») — public API (docs/spec/AI.md §11.9, catalogue AI-058…064):
//   virtualAgent(ctx)                           the typed adapter the portal and messaging channels call (@shared/ai/va)
//   vaStart / vaSend / vaHandoff / vaEnd / …    the conversation API, always with the requester's context
//   topicsOf / seedTopics / ruleRoute          topics and routing
// `installVirtualAgent()` (src/server/routes/modules.ts) registers its model features under the «دستیار مجازی» switch.
// The tables' guards are registered with the agents' (../agents/hooks.ts).
import { registerAiFeaturePrefix } from "../settings";

export { virtualAgent, vaStart, vaSend, vaHandoff, vaEnd, vaMessages, vaConversations } from "./brain";
export { topicsOf, seedTopics, ruleRoute, numberIn, intentRoute, BUILTIN_TOPICS, type Topic } from "./topics";

let installed = false;
export function installVirtualAgent(): void {
  if (installed) return;
  installed = true;
  registerAiFeaturePrefix("va:", "virtual_agent");
}
