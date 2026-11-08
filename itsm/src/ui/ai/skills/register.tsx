// The AI skills on every record page (docs/spec/AI.md §11): the «هوش مصنوعی» side panel, the composer's AI menu and
// the writing tools of rich-text fields. Light: the panel and the menus load with their first use.
import { lazy, Suspense } from "react";
import { registerFieldAssist, registerRecordExtensions } from "../../records/extensions";

const RecordAiPanel = lazy(() => import("./RecordAiPanel"));
const ComposerAi = lazy(() => import("./InlineAi").then((m) => ({ default: m.ComposerAi })));
const FieldAi = lazy(() => import("./InlineAi").then((m) => ({ default: m.FieldAi })));

registerRecordExtensions("*", {
  sidePanels: [
    {
      key: "ai:skills",
      title: "هوش مصنوعی",
      order: 15,
      // members who may use AI (the server's record meta): what each skill reads is decided by their own access —
      // an approver who reads the record only through the approver grant runs skills on it too (field groups apply)
      when: (ctx) => !!(ctx.meta as Record<string, unknown>).ai_skills,
      participants: true,
      render: (ctx) => (
        <Suspense fallback={null}>
          <RecordAiPanel ctx={ctx} />
        </Suspense>
      ),
    },
  ],
  aiDraft: (c) => (
    <Suspense fallback={null}>
      <ComposerAi c={c} />
    </Suspense>
  ),
});

registerFieldAssist((p) => (
  <Suspense fallback={null}>
    <FieldAi {...p} />
  </Suspense>
));
