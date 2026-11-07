// «اسناد هوشمند» (docs/spec/AI.md §6): the library of document collections (each with its own sharing), uploads with
// their reading status, the document viewer (text by page, the cited passage highlighted), «پرسش از اسناد» over chosen
// collections, and «پرسش از هوش مصنوعی» over every source the member may read — also a row of the command palette.
// Collections use the generic record pages (form with sharing rules); documents open in the viewer.
import { lazy } from "react";
import { BookOpenText, FileSearch, Library, MessageSquareText, Sparkles } from "lucide-react";
import { recordModule, RecordPageRoute } from "../../records/module";
import { registerRecordExtensions } from "../../records/extensions";
import { recordSearch } from "../../records/module";

const LibraryPage = lazy(() => import("./Library"));
const Viewer = lazy(() => import("./Viewer"));
const AskPage = lazy(() => import("./AskPage"));

// links to documents (search, references, citations) open the viewer
registerRecordExtensions("doc_document", { path: "docs/d" });

const S = "دانش و اسناد";

export const docsUi = recordModule({
  key: "docs",
  spaceKey: "home",
  group: { key: "docs", label: "اسناد هوشمند" },
  tables: [
    {
      table: "doc_collection",
      path: "docs/collections",
      label: "مجموعه‌های اسناد",
      noun: "مجموعهٔ اسناد",
      icon: Library,
      section: S,
      hidden: true,
      keywords: "پوشه اشتراک خصوصی گروه واحد سند",
      extensions: {
        policies: [
          { key: "docs:groups", when: { f: "sharing", op: "ne", v: "groups" }, actions: [{ field: "share_groups", visible: false }] },
          { key: "docs:units", when: { f: "sharing", op: "ne", v: "units" }, actions: [{ field: "share_units", visible: false }] },
          { key: "docs:secret", when: { f: "classification", op: "eq", v: "secret" }, actions: [{ field: "ai_enabled", readonly: true }], message: "اسناد «سری» در پاسخ‌های هوش مصنوعی به کار نمی‌روند.", tone: "info" },
        ],
      },
    },
  ],
  nav: [
    { key: "docs:library", label: "اسناد هوشمند", path: "docs", icon: BookOpenText, section: S, area: "ai", keywords: "سند PDF ورد اکسل بارگذاری کتابخانه مجموعه دانش" },
    { key: "docs:ask", label: "پرسش از اسناد", path: "docs/ask", icon: MessageSquareText, section: S, area: "ai", keywords: "پرسش پاسخ منبع ارجاع سند هوش مصنوعی" },
    { key: "ai:ask", label: "پرسش از هوش مصنوعی", path: "ask", icon: Sparkles, area: "ai", action: true, keywords: "پرسش پاسخ جست‌وجو منبع ارجاع هوش مصنوعی" },
  ],
  routes: [
    { path: "docs", element: <LibraryPage /> },
    { path: "docs/ask", element: <AskPage mode="docs" /> },
    { path: "docs/d/:id", element: <Viewer /> },
    { path: "docs/d/:id/edit", element: <RecordPageRoute table="doc_document" /> },
    { path: "ask", element: <AskPage mode="all" /> },
  ],
  searches: [
    recordSearch("doc_document", { group: "اسناد", icon: FileSearch, area: "ai" }),
    {
      key: "ai:ask",
      group: "هوش مصنوعی",
      icon: Sparkles,
      area: "ai",
      minLength: 3,
      async run(_api, q) {
        return [{ id: "ask", label: `پرسش از هوش مصنوعی: «${q.trim().slice(0, 80)}»`, meta: "پاسخ با ارجاع به منابع شما", path: `ask?q=${encodeURIComponent(q.trim().slice(0, 500))}` }];
      },
    },
  ],
  segments: { docs: "home", ask: "home" },
});
