"use client";
import * as React from "react";
import { toast } from "sonner";
import { Bot, GitBranch, History, Pencil, Plus, RotateCcw, Sparkles, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card, Field, Input, Select, Switch, Textarea } from "@/components/ui/primitives";
import { Modal, Tabs } from "@/components/ui/overlays";
import { WorkflowEditor } from "@/components/workflow/workflow-editor";
import { deleteAgentAction, deleteWorkflowAction, restoreDefaultWorkflowsAction, saveAgentAction } from "@/app/actions/workflows";
import { CLAUDE_EFFORTS, CLAUDE_MODELS, CLAUDE_THINKING } from "@/lib/claude/options";
import { cn, faNum } from "@/lib/utils";
import { AGENT_TYPE_META, newId, STAGE_LABEL, type AgentDef, type AgentType, type Stage, type WorkflowDef } from "@/lib/workflow/types";

const ICON = { gemini: Sparkles, router: GitBranch, claude: Bot };
const COLORS = ["#8b5cf6", "#7c3aed", "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#f97316", "#ec4899"];

const EMPTY_AGENT: AgentDef = {
  id: "",
  name: "",
  description: "",
  type: "gemini",
  prompt: "",
  output: "text",
  maxFiles: 3,
  attachments: true,
  knowledge: false,
  thinking: "MEDIUM",
  models: [],
  color: COLORS[0],
};

function AgentEditor({
  agent,
  prompt,
  open,
  onOpenChange,
  onSaved,
}: {
  agent: AgentDef | null;
  prompt: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: (agents: AgentDef[], prompts: Record<string, string>) => void;
}) {
  const [a, setA] = React.useState<AgentDef>(agent ?? EMPTY_AGENT);
  const [text, setText] = React.useState(prompt);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setA(agent ?? EMPTY_AGENT);
      setText(prompt);
    }
  }, [open, agent, prompt]);
  const set = (patch: Partial<AgentDef>) => setA((prev) => ({ ...prev, ...patch }));
  const isNew = !agent;

  const save = async () => {
    if (!a.name.trim()) return toast.error("نام ایجنت را بنویسید");
    if (a.type !== "claude" && !text.trim()) return toast.error("پرامپت (نقش و دستورالعمل) ایجنت را بنویسید");
    setBusy(true);
    const r = await saveAgentAction(a, text);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(isNew ? "ایجنت ساخته شد" : "ایجنت ذخیره شد");
    onSaved(r.data.agents, r.data.prompts);
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={isNew ? "ایجنت جدید" : `ویرایش «${agent?.name}»`}
      description={agent?.builtin ? "ایجنت پیش‌فرض: تنظیمات و پرامپتش قابل تغییر است؛ هر تغییر پرامپت یک نسخه‌ی جدید در «یادگیری و پرامپت‌ها» می‌سازد." : "هر تغییر پرامپت یک نسخه‌ی جدید در «یادگیری و پرامپت‌ها» می‌سازد و قابل بازگشت است."}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            ذخیره
          </Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="نام" required>
              <Input value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="مثلاً بازبین کد SharePoint" />
            </Field>
            <Field label="نوع">
              <Select value={a.type} disabled={!isNew} onChange={(e) => set({ type: e.target.value as AgentType })}>
                {(Object.keys(AGENT_TYPE_META) as AgentType[]).map((t) => (
                  <option key={t} value={t}>
                    {AGENT_TYPE_META[t].label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="text-xs text-muted">{AGENT_TYPE_META[a.type].hint}</p>
          <Field label="توضیح کوتاه (در فهرست ایجنت‌ها)">
            <Input value={a.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <Field
            label={a.type === "claude" ? "دستورالعمل این مرحله برای Claude (اختیاری)" : "پرامپت: نقش و دستورالعمل ایجنت"}
            hint={
              a.type === "router"
                ? "ایجنت شرط باید با «بله» یا «خیر» تصمیم بگیرد؛ بنویسید چه چیزی را بسنجد."
                : a.type === "claude"
                  ? "به پرامپت اصلی Claude (درخواست شما، دستور کار و فایل‌ها) اضافه می‌شود."
                  : "درخواست، دستور مدیر، خروجی مراحل قبل و (در صورت فعال بودن) فایل‌ها و دانش مرتبط خودکار داده می‌شوند."
            }
          >
            <Textarea className="min-h-72 font-mono text-[13px] leading-7" dir="auto" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        </div>
        <div className="space-y-3">
          <Field label="رنگ">
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" aria-label={c} onClick={() => set({ color: c })} className={cn("size-7 rounded-full border-2", a.color === c ? "border-fg" : "border-transparent")} style={{ background: c }} />
              ))}
            </div>
          </Field>
          {a.type !== "claude" ? (
            <>
              <Field label="مدل‌های Gemini" hint="خالی = مدل‌های تنظیمات؛ auto = جدیدترین Flash رایگان">
                <Input dir="ltr" value={(a.models ?? []).join(", ")} placeholder="auto" onChange={(e) => set({ models: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
              </Field>
              <Field label="سطح تفکر">
                <Select value={a.thinking ?? "MEDIUM"} onChange={(e) => set({ thinking: e.target.value as AgentDef["thinking"] })}>
                  <option value="LOW">کم (سریع)</option>
                  <option value="MEDIUM">متوسط</option>
                  <option value="HIGH">زیاد (دقیق)</option>
                </Select>
              </Field>
              {a.type === "gemini" ? (
                <Field label="خروجی">
                  <Select value={a.output ?? "text"} onChange={(e) => set({ output: e.target.value as "text" | "files" })}>
                    <option value="text">متن (Markdown)</option>
                    <option value="files">چند فایل</option>
                  </Select>
                </Field>
              ) : null}
              {a.type === "gemini" && a.output === "files" ? (
                <Field label="حداکثر تعداد فایل">
                  <Input type="number" min={1} max={10} value={a.maxFiles ?? 3} onChange={(e) => set({ maxFiles: Number(e.target.value) })} />
                </Field>
              ) : null}
              <div className="space-y-2.5 pt-1">
                <Switch checked={!!a.attachments} onChange={(v) => set({ attachments: v })} label="فایل‌های پیوست تسک را ببیند" />
                <Switch checked={!!a.knowledge} onChange={(v) => set({ knowledge: v })} label="دانش مرتبط (RAG) را ببیند" />
                <Switch checked={!!a.useSearch} onChange={(v) => set({ useSearch: v })} label="جستجوی گوگل" />
              </div>
            </>
          ) : (
            <>
              <Field label="مدل Claude" hint="«مطابق ارسال» = همان که هنگام ارسال یا در تنظیمات انتخاب شده">
                <Select value={a.claude?.model ?? ""} onChange={(e) => set({ claude: { ...a.claude, model: e.target.value } })}>
                  <option value="">مطابق ارسال</option>
                  {CLAUDE_MODELS.filter((m) => m.value).map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Effort">
                <Select value={a.claude?.effort ?? ""} onChange={(e) => set({ claude: { ...a.claude, effort: e.target.value } })}>
                  <option value="">مطابق ارسال</option>
                  {CLAUDE_EFFORTS.filter((m) => m.value).map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Thinking">
                <Select value={a.claude?.thinking ?? ""} onChange={(e) => set({ claude: { ...a.claude, thinking: e.target.value as "" | "auto" | "on" | "off" } })}>
                  <option value="">مطابق ارسال</option>
                  {CLAUDE_THINKING.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function AgentsStudio({ initial }: { initial: { agents: AgentDef[]; workflows: WorkflowDef[]; prompts: Record<string, string> } }) {
  const [agents, setAgents] = React.useState(initial.agents);
  const [prompts, setPrompts] = React.useState(initial.prompts);
  const [workflows, setWorkflows] = React.useState(initial.workflows);
  const [drafts, setDrafts] = React.useState<WorkflowDef[]>([]);
  const [current, setCurrent] = React.useState<string | undefined>(() => initial.workflows.find((w) => w.stage === "prework" && w.isDefault)?.id ?? initial.workflows[0]?.id);
  const [tab, setTab] = React.useState("workflows");
  const [editing, setEditing] = React.useState<{ agent: AgentDef | null } | null>(null);

  const all = [...workflows, ...drafts.filter((d) => !workflows.some((w) => w.id === d.id))];
  const wf = all.find((w) => w.id === current) ?? all[0];
  const usage = (id: string) => workflows.filter((w) => w.nodes.some((n) => n.agentId === id));

  const create = (stage: Stage, base?: WorkflowDef) => {
    const draft: WorkflowDef = base
      ? { ...base, id: newId("wf-"), name: `${base.name} (کپی)`, isDefault: false, builtin: false }
      : { id: newId("wf-"), name: `ورکفلوی جدید ${STAGE_LABEL[stage]}`, stage, nodes: [], edges: [] };
    setDrafts((d) => [...d, draft]);
    setCurrent(draft.id);
  };

  const remove = async (target: WorkflowDef) => {
    if (!workflows.some((w) => w.id === target.id)) {
      setDrafts((d) => d.filter((x) => x.id !== target.id));
      setCurrent(workflows[0]?.id);
      return;
    }
    if (!window.confirm(`ورکفلوی «${target.name}» حذف شود؟`)) return;
    const r = await deleteWorkflowAction(target.id);
    if (!r.ok) return toast.error(r.error);
    setWorkflows(r.data.workflows);
    setCurrent(r.data.workflows.find((w) => w.stage === target.stage)?.id);
    toast.success("ورکفلو حذف شد");
  };

  const workflowsTab = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["prework", "main"] as Stage[]).map((stage) => (
          <div key={stage} className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-line bg-surface p-1.5">
            <span className="px-2 text-xs font-bold text-muted">{STAGE_LABEL[stage]}</span>
            {all
              .filter((w) => w.stage === stage)
              .map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setCurrent(w.id)}
                  className={cn("flex items-center gap-1 rounded-xl px-3 py-1.5 text-sm font-semibold transition", w.id === wf?.id ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-muted")}
                >
                  {w.isDefault ? <Star className="size-3.5 fill-current text-warning" /> : null}
                  {w.name}
                  {!workflows.some((x) => x.id === w.id) ? <span className="text-[10px] text-warning">(ذخیره نشده)</span> : null}
                </button>
              ))}
            <Button size="sm" variant="ghost" onClick={() => create(stage)}>
              <Plus className="size-4" /> جدید
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="ms-auto"
          onClick={async () => {
            const r = await restoreDefaultWorkflowsAction();
            if (!r.ok) return toast.error(r.error);
            setWorkflows(r.data.workflows);
            toast.success("ورکفلوهای پیش‌فرض برگشتند");
          }}
        >
          <RotateCcw className="size-4" /> بازگردانی پیش‌فرض‌ها
        </Button>
      </div>
      {wf ? (
        <WorkflowEditor
          key={wf.id}
          workflow={wf}
          agents={agents}
          onSaved={(list, id) => {
            setWorkflows(list);
            setDrafts((d) => d.filter((x) => x.id !== id));
            setCurrent(id);
          }}
          onDuplicate={(w) => create(w.stage, w)}
          onDelete={(w) => void remove(w)}
          onEditAgent={(id) => setEditing({ agent: agents.find((a) => a.id === id) ?? null })}
        />
      ) : null}
    </div>
  );

  const agentsTab = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted">ایجنت‌ها «پرامپت + تنظیمات» قابل استفاده در هر ورکفلو هستند. تغییر یک ایجنت در همه‌ی ورکفلوهایی که از آن استفاده می‌کنند اعمال می‌شود.</p>
        <Button className="ms-auto" onClick={() => setEditing({ agent: null })}>
          <Plus className="size-4" /> ایجنت جدید
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => {
          const Icon = ICON[a.type];
          const used = usage(a.id);
          return (
            <Card key={a.id} className="flex flex-col p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: a.color ?? AGENT_TYPE_META[a.type].color }}>
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold">{a.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge tone={a.type === "claude" ? "orange" : a.type === "router" ? "cyan" : "violet"}>{AGENT_TYPE_META[a.type].label}</Badge>
                    {a.builtin ? <Badge>پیش‌فرض</Badge> : null}
                    {a.output === "files" ? <Badge tone="info">چند فایل</Badge> : null}
                  </div>
                </div>
              </div>
              <p className="mt-3 flex-1 text-xs leading-6 text-muted">{a.description || "—"}</p>
              <p className="mt-2 text-[11px] text-faint">{used.length ? `در ${faNum(used.length)} ورکفلو: ${used.map((w) => w.name).join("، ")}` : "در هیچ ورکفلویی استفاده نشده"}</p>
              <div className="mt-3 flex gap-1.5 border-t border-line pt-3">
                <Button size="sm" variant="secondary" onClick={() => setEditing({ agent: a })}>
                  <Pencil className="size-4" /> ویرایش
                </Button>
                <Link href={`/learning?agent=${encodeURIComponent(a.id)}`}>
                  <Button size="sm" variant="ghost">
                    <History className="size-4" /> نسخه‌ها
                  </Button>
                </Link>
                {!a.builtin ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ms-auto text-danger"
                    onClick={async () => {
                      if (!window.confirm(`ایجنت «${a.name}» حذف شود؟`)) return;
                      const r = await deleteAgentAction(a.id);
                      if (!r.ok) return toast.error(r.error);
                      setAgents(r.data.agents);
                      toast.success("ایجنت حذف شد");
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black">ایجنت‌ها و ورکفلوها</h1>
        <p className="mt-1 text-sm text-muted">
          برای پیش‌کار و کار اصلی ورکفلو بسازید: ایجنت‌ها را اضافه و به هم وصل کنید؛ شاخه‌های موازی هم‌زمان اجرا می‌شوند و «شرط» مسیر را انتخاب می‌کند. ورکفلوی پیش‌فرض هر مرحله هنگام ارسال از پیش انتخاب شده است.
        </p>
      </div>
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "workflows", label: "ورکفلوها", content: workflowsTab },
          { value: "agents", label: `ایجنت‌ها (${faNum(agents.length)})`, content: agentsTab },
        ]}
      />
      <AgentEditor
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        agent={editing?.agent ?? null}
        prompt={editing?.agent ? prompts[editing.agent.id] ?? editing.agent.prompt : ""}
        onSaved={(list, p) => {
          setAgents(list);
          setPrompts(p);
        }}
      />
    </div>
  );
}
