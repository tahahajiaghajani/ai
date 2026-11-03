// The conversation switcher: the person's own conversations, newest first, pinned ones on top; search, rename, pin
// and delete. It takes the panel's body while open (the same on a phone and on a wide screen).
import { useEffect, useMemo, useRef, useState } from "react";
import { Dropdown, Input, type MenuProps } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, MoreHorizontal, Pencil, Pin, PinOff, Search, Trash2 } from "lucide-react";
import type { AiThreadSummary } from "@shared/ai/types";
import { jDayMonth, jTime } from "../../lib/fa";
import { useDebounced, useNotify } from "../../lib/hooks";
import { useOrg } from "../../lib/org";
import { Ic } from "../../components/shell/icons";
import { groupThreads } from "./threads-model";
import { useAiClient, useThreads } from "./useAi";

const DAY = 86_400_000;

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return Date.now() - d.getTime() < DAY && d.getDate() === new Date().getDate() ? jTime(d) : jDayMonth(d);
}

function Row({ t, active, onOpen, onRename, onPin, onDelete }: { t: AiThreadSummary; active: boolean; onOpen: () => void; onRename: (title: string) => Promise<void>; onPin: () => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(t.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const save = async () => {
    const v = draft.trim();
    setEditing(false);
    if (v && v !== t.title) await onRename(v);
  };

  const menu: MenuProps = {
    items: [
      { key: "pin", icon: <Ic icon={t.pinned ? PinOff : Pin} />, label: t.pinned ? "برداشتن سنجاق" : "سنجاق کردن", onClick: onPin },
      {
        key: "rename",
        icon: <Ic icon={Pencil} />,
        label: "تغییر نام",
        onClick: () => {
          setDraft(t.title);
          setEditing(true);
        },
      },
      { type: "divider" },
      { key: "delete", icon: <Ic icon={Trash2} />, label: "حذف", danger: true, onClick: onDelete },
    ],
  };

  if (editing)
    return (
      <div className="sa-th-r is-edit">
        <input
          ref={input}
          className="sa-th-in"
          value={draft}
          maxLength={120}
          dir="auto"
          aria-label="نام گفت‌وگو"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setEditing(false);
            }
          }}
        />
      </div>
    );
  return (
    <div className={`sa-th-r ${active ? "is-on" : ""}`}>
      <button type="button" className="sa-th-b" aria-current={active ? "true" : undefined} onClick={onOpen}>
        <span className="sa-th-t" dir="auto">
          {t.title || "گفت‌وگوی بی‌نام"}
        </span>
        <span className="sa-th-m sf-num">{when(t.updated_at)}</span>
      </button>
      <Dropdown trigger={["click"]} menu={menu} rootClassName="sf-glass sh-menu sh-menu-strong" placement="bottomLeft">
        <button type="button" className="sh-icon-btn sh-icon-sm sa-th-more" aria-label={`کارهای «${t.title}»`}>
          <Ic icon={MoreHorizontal} />
        </button>
      </Dropdown>
    </div>
  );
}

export function Threads({ activeId, onOpen, onDeleted }: { activeId: string | null; onOpen: (id: string) => void; onDeleted: (id: string) => void }) {
  const { orgId } = useOrg();
  const client = useAiClient();
  const qc = useQueryClient();
  const n = useNotify();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 220);
  const threads = useThreads(true, dq);
  const groups = useMemo(() => groupThreads(threads.data ?? []), [threads.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["ai", orgId, "threads"] });

  const patchLocal = (id: string, patch: Partial<AiThreadSummary>) =>
    qc.setQueriesData<AiThreadSummary[]>({ queryKey: ["ai", orgId, "threads"] }, (old) => old?.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const rename = async (t: AiThreadSummary, title: string) => {
    patchLocal(t.id, { title });
    try {
      await client.rename(t.id, title);
    } catch (e) {
      n.error(e);
    }
    void refresh();
  };
  const pin = async (t: AiThreadSummary) => {
    patchLocal(t.id, { pinned: !t.pinned });
    try {
      await client.pin(t.id, !t.pinned);
    } catch (e) {
      n.error(e);
    }
    void refresh();
  };
  const remove = async (t: AiThreadSummary) => {
    if (!(await n.confirm(`حذف گفت‌وگوی «${t.title || "بی‌نام"}»؟`, "پرسش‌ها و پاسخ‌های این گفت‌وگو دیگر دیده نمی‌شوند.", true))) return;
    try {
      await client.remove(t.id);
      qc.setQueriesData<AiThreadSummary[]>({ queryKey: ["ai", orgId, "threads"] }, (old) => old?.filter((x) => x.id !== t.id));
      onDeleted(t.id);
    } catch (e) {
      n.error(e);
    }
  };

  return (
    <div className="sa-th">
      <div className="sa-th-s">
        <Input
          autoFocus
          allowClear
          value={q}
          onChange={(e) => setQ(e.target.value)}
          prefix={<Ic icon={Search} />}
          placeholder="جست‌وجو در گفت‌وگوها"
          aria-label="جست‌وجو در گفت‌وگوها"
        />
      </div>
      <div className="sa-th-l">
        {threads.isLoading ? (
          <div className="sa-card-skel" aria-busy="true" aria-label="در حال بارگذاری">
            {[78, 56, 70, 48, 64].map((w, i) => (
              <i key={i} className="sf-skel" style={{ inlineSize: `${w}%` }} />
            ))}
          </div>
        ) : threads.isError ? (
          <div className="sa-th-empty">فهرست گفت‌وگوها خوانده نشد.</div>
        ) : !groups.length ? (
          <div className="sa-th-empty">
            <Ic icon={MessageSquare} size={20} />
            {dq ? "گفت‌وگویی با این عبارت پیدا نشد." : "هنوز گفت‌وگویی نیست."}
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="sa-th-g" aria-label={g.label}>
              <h3 className="sa-th-gh">{g.label}</h3>
              {g.items.map((t) => (
                <Row key={t.id} t={t} active={t.id === activeId} onOpen={() => onOpen(t.id)} onRename={(title) => rename(t, title)} onPin={() => void pin(t)} onDelete={() => void remove(t)} />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
