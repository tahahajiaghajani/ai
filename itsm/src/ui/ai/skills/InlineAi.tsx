// Inline AI (catalogue AI-026/027/028): the composer's «هوش مصنوعی» menu — a draft of the reply (the «پاسخ» tab; only
// public text reached the model) or of the internal note, then the writing tools on what is being written (improve,
// shorten, formal, tone, translate) — and the same writing tools in the toolbar of every rich-text field. The result
// replaces the text in the editor; nothing is posted or saved until the person does it, and the editor shows that the
// text came from AI until it is edited.
import "./skills.css";
import { useState } from "react";
import { Button, Dropdown, Tooltip, type MenuProps } from "antd";
import { Sparkles } from "lucide-react";
import type { SkillCard } from "@shared/ai/skills";
import { SKILL_AI_LABEL } from "@shared/ai/skills";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { ICON14 } from "../../components/blocks";
import type { ComposerContext, FieldAssistContext } from "../../records/extensions";
import { skillsApi, useRecordSkills, useTextSkills } from "./api";
import { composerSkills, fieldSkills, insertableText } from "./model";

const TONES = [
  { key: "friendly", label: "لحن دوستانه" },
  { key: "sympathetic", label: "لحن همدلانه" },
  { key: "neutral", label: "لحن خنثی" },
];
const LANGS = [
  { key: "en", label: "ترجمه به انگلیسی" },
  { key: "fa", label: "ترجمه به فارسی" },
];

/** Menu items of the writing tools (tone and translation open their variants). */
function toolItems(tools: SkillCard[], hasText: boolean): MenuProps["items"] {
  return tools.map((t) => {
    if (t.key === "text.tone") return { key: t.key, label: t.name, disabled: !hasText || !t.available, children: TONES.map((x) => ({ key: `${t.key}|tone=${x.key}`, label: x.label })) };
    if (t.key === "text.translate") return { key: t.key, label: t.name, disabled: !hasText || !t.available, children: LANGS.map((x) => ({ key: `${t.key}|language=${x.key}`, label: x.label })) };
    return { key: t.key, label: t.name, disabled: !hasText || !t.available, title: t.available ? t.description : (t.reason ?? undefined) };
  });
}

function parseKey(k: string): { key: string; params: Record<string, string> } {
  const [key, rest] = k.split("|");
  const params: Record<string, string> = {};
  if (rest) {
    const [name, value] = rest.split("=");
    params[name] = value;
  }
  return { key, params };
}

function AiMenu({ items, busy, onPick, aiText }: { items: MenuProps["items"]; busy: boolean; onPick: (k: string) => void; aiText: boolean }) {
  if (!items?.length) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <Dropdown trigger={["click"]} menu={{ items, onClick: (e) => onPick(String(e.key)) }} disabled={busy}>
        <Tooltip title="هوش مصنوعی">
          <Button size="small" type="text" loading={busy} aria-label="هوش مصنوعی" icon={<Sparkles {...ICON14} />} />
        </Tooltip>
      </Dropdown>
      {aiText ? (
        <span className="text-[11px] text-ink-3" role="status">
          {SKILL_AI_LABEL}
        </span>
      ) : null}
    </span>
  );
}

/** The composer slot `aiDraft`. */
export function ComposerAi({ c }: { c: ComposerContext }) {
  const { api, can } = useOrg();
  const n = useNotify();
  const enabled = can("ai", "view") && !!(c.record.meta as Record<string, unknown>).ai_skills;
  const record = useRecordSkills(c.record.table, String(c.record.row.id), enabled);
  const [busy, setBusy] = useState(false);
  const [inserted, setInserted] = useState<string | null>(null);
  if (!enabled || !record.data) return null;
  const { drafts, tools } = composerSkills(record.data.skills, c.kind);
  const hasText = c.text.trim().length > 1;
  const items: MenuProps["items"] = [
    ...drafts.map((d) => ({ key: d.key, label: d.name, disabled: !d.available, title: d.available ? d.description : (d.reason ?? undefined) })),
    ...(drafts.length && tools.length ? [{ type: "divider" as const }] : []),
    ...(toolItems(tools, hasText) ?? []),
  ];
  const pick = async (k: string) => {
    const { key, params } = parseKey(k);
    const draft = drafts.some((d) => d.key === key);
    setBusy(true);
    try {
      const r = await skillsApi.run(api, key, draft ? { table: c.record.table, id: String(c.record.row.id), params: c.text.trim() ? { notes: c.text.trim().slice(0, 1000) } : {}, propose: false } : { text: c.text, params, propose: false });
      const text = insertableText(r).trim();
      if (!text) return n.error(new Error("پاسخی ساخته نشد"));
      c.setText(text);
      setInserted(text);
      n.ok(r.fallback ? "متن با قاعده ساخته شد؛ پیش از فرستادن بازبینی کنید" : "متن هوش مصنوعی درج شد؛ پیش از فرستادن بازبینی کنید");
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  return <AiMenu items={items} busy={busy} onPick={(k) => void pick(k)} aiText={inserted !== null && inserted === c.text.trim()} />;
}

/** The tools of a rich-text field (registered with `registerFieldAssist`). */
export function FieldAi(p: FieldAssistContext) {
  const { api, can } = useOrg();
  const n = useNotify();
  const enabled = can("ai", "view");
  const text = useTextSkills(enabled);
  const [busy, setBusy] = useState(false);
  const [inserted, setInserted] = useState<string | null>(null);
  if (!enabled || !text.data) return null;
  const tools = fieldSkills(text.data.skills);
  if (!tools.length) return null;
  const pick = async (k: string) => {
    const { key, params } = parseKey(k);
    setBusy(true);
    try {
      const r = await skillsApi.run(api, key, { text: p.value, params, propose: false });
      const out = insertableText(r).trim();
      if (!out) return n.error(new Error("پاسخی ساخته نشد"));
      p.setValue(out);
      setInserted(out);
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  return <AiMenu items={toolItems(tools, p.value.trim().length > 1)} busy={busy} onPick={(k) => void pick(k)} aiText={inserted !== null && inserted === p.value.trim()} />;
}
