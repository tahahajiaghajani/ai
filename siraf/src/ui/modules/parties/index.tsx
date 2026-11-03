import { lazy, useEffect, useState } from "react";
import { Drawer } from "antd";
import { Users, UsersRound } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import type { AiCaptureResult } from "@shared/ai/types";
import { ENTITIES } from "@shared/entities";
import type { NavGroup, AppRoute } from "../registry";
import { EntityForm, EntityPage } from "../../components/data";
import { useOrg } from "../../lib/org";
import { toLatinDigits } from "../../lib/fa";
import { AiCaptureButton } from "../../ai/capture/AiCaptureButton";
import { captureDay, markOf, val } from "../../ai/capture/apply";
import { AiReviewBar, type ReviewEntry } from "../../ai/kit/AiMark";

const PartyProfile = lazy(() => import("./PartyProfile"));

/** A new person from a national ID card («خواندن از تصویر»): the form opens prefilled, with what to check above it. */
function fromIdCard(r: AiCaptureResult): { initial: Record<string, unknown>; entries: ReviewEntry[]; warnings: string[] } {
  const f = r.fields;
  const first = val(f, "first_name");
  const last = val(f, "last_name");
  const nid = val(f, "national_id");
  const birth = captureDay(val(f, "birth_date"));
  const initial: Record<string, unknown> = {
    kind: "person",
    name: [first, last].filter(Boolean).join(" ") || null,
    first_name: first,
    last_name: last,
    father_name: val(f, "father_name"),
    national_id: nid ? toLatinDigits(nid).replace(/\D/g, "") : null,
    birth_date: birth,
    id_doc_type: "national_card",
    id_doc_no: nid ? toLatinDigits(nid).replace(/\D/g, "") : null,
  };
  const entries: ReviewEntry[] = [];
  for (const [key, label] of [["first_name", "نام"], ["last_name", "نام خانوادگی"], ["father_name", "نام پدر"], ["national_id", "کد ملی"], ["birth_date", "تاریخ تولد"]] as const) {
    const m = markOf(f, key);
    if (m) entries.push({ key, label, value: val(f, key) ?? "", mark: m });
  }
  return { initial, entries, warnings: r.warnings };
}

/** «ویرایش در فرم» of the assistant's party draft: parties?new=1&name=…&kind=…&mobile=…&national_id=…&economic_code=… */
function fromQuery(sp: URLSearchParams): ReturnType<typeof fromIdCard> | null {
  if (sp.get("new") !== "1") return null;
  const kind = sp.get("kind") === "company" ? "company" : "person";
  const pick = (k: string) => sp.get(k)?.trim() || null;
  return { initial: { kind, name: pick("name"), mobile: pick("mobile"), national_id: pick("national_id"), economic_code: pick("economic_code") }, entries: [], warnings: [] };
}

function PartiesPage() {
  const nav = useNavigate();
  const { orgId, can } = useOrg();
  const [sp, setSp] = useSearchParams();
  const [card, setCard] = useState<ReturnType<typeof fromIdCard> | null>(() => (can("parties", "edit") ? fromQuery(sp) : null));
  // the prefill is read once; the address goes back to the plain list
  useEffect(() => {
    if (sp.get("new") === "1") setSp({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fromDraft = !!card && !card.entries.length && !card.warnings.length && !("id_doc_type" in card.initial);
  return (
    <>
      <EntityPage
        entity="party"
        onOpen={(r) => nav(`/${orgId}/parties/${r.id}`)}
        rowActions={(r) => [{ key: "open", label: "پرونده و صورتحساب", onClick: () => nav(`/${orgId}/parties/${r.id}`) }]}
        drawerWidth={820}
        headerActions={can("parties", "edit") ? <AiCaptureButton kind="id_card" label="از روی کارت ملی" onResult={(r) => setCard(fromIdCard(r))} compact /> : null}
      />
      <Drawer open={!!card} onClose={() => setCard(null)} size={560} placement="left" closable={{ placement: "end" }} title={fromDraft ? "شخص جدید" : "شخص جدید از روی کارت ملی"} destroyOnHidden styles={{ body: { paddingBottom: 0 } }}>
        {card ? (
          <>
            <div className="mb-4">
              <AiReviewBar entries={card.entries} warnings={card.warnings} onDone={() => setCard((c) => (c ? { ...c, entries: [], warnings: [] } : c))} />
            </div>
            <EntityForm def={ENTITIES.party} initial={card.initial} onSaved={(row) => (setCard(null), row?.id ? nav(`/${orgId}/parties/${row.id}`) : undefined)} onCancel={() => setCard(null)} />
          </>
        ) : null}
      </Drawer>
    </>
  );
}

export const partiesNav: Omit<NavGroup, "icon" | "space"> = {
  key: "parties",
  label: "اشخاص",
  items: [
    { key: "parties", label: "اشخاص", path: "parties", area: "parties", icon: Users, common: true, keywords: "مشتری تأمین‌کننده طرف حساب" },
    { key: "party-groups", label: "گروه‌های اشخاص", path: "parties/groups", area: "parties", icon: UsersRound, section: "تعریف‌ها" },
  ],
};

export const partiesRoutes: AppRoute[] = [
  { path: "parties", element: <PartiesPage /> },
  { path: "parties/groups", element: <EntityPage entity="party_group" /> },
  { path: "parties/:id", element: <PartyProfile /> },
];
