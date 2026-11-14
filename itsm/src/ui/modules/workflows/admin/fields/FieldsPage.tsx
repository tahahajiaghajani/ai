// «فیلدها» (design F §8.1, package F5; D13 — it takes over settings/fields and settings/choices): the field library,
// the field types, the choice lists and every table's fields, as four tabs kept in the address (`?tab=`; old links
// `?table=` and settings/choices?list= open their tab). Each tab is offered as its API is: the library and the types
// to `process_design` readers and `settings` editors, the lists and the tables' fields to `settings` readers; writes
// as the server allows them. A row opens a side sheet (a full page on phones), kept in `?field=` / `?ftype=`.
import { useCallback, useState } from "react";
import { useSearchParams } from "react-router";
import { Button, Select, Tabs } from "antd";
import { Plus, Shapes } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { faDigits } from "@shared/format";
import { useOrg } from "../../../../lib/org";
import { useIsPhone, useNotify } from "../../../../lib/hooks";
import { PageHeader } from "../../../../components/layout";
import { EmptyState } from "../../../../components/display";
import { FIELD_KEYS, fieldsApi } from "./api";
import { FIELDS_TABS, fieldsAccess, tabOf, visibleTabs, type FieldsTab } from "./model";
import { Library } from "./Library";
import { Types } from "./Types";
import { ChoiceLists } from "./ChoiceLists";
import { TableFields } from "./TableFields";
import { FieldSheet } from "./FieldSheet";
import { TypeSheet, type TypeSheetTarget } from "./TypeSheet";
import { I16 } from "./parts";
import "../../../../records/records.css";
import "./fields.css";

export default function FieldsPage() {
  const org = useOrg();
  const { api, orgId } = org;
  const n = useNotify();
  const phone = useIsPhone();
  const access = fieldsAccess(org);
  const visible = visibleTabs(access);
  const [params, setParams] = useSearchParams();
  const tab = tabOf(params, visible);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [choicesDirty, setChoicesDirty] = useState(false);
  const library = useQuery({ queryKey: FIELD_KEYS.library(orgId), queryFn: () => fieldsApi.library(api), enabled: access.designRead, staleTime: 30_000 });
  const types = useQuery({ queryKey: FIELD_KEYS.types(orgId), queryFn: () => fieldsApi.types(api), enabled: access.designRead, staleTime: 60_000 });
  const unit = useQuery({ queryKey: FIELD_KEYS.unit(orgId), queryFn: () => fieldsApi.moneyUnit(api), enabled: access.designRead, staleTime: 300_000 });
  const fields = library.data?.fields;

  const patch = useCallback(
    (set: Record<string, string | null>) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          for (const [k, v] of Object.entries(set)) {
            if (v === null) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const switchTab = async (k: string) => {
    if (tab === "choices" && choicesDirty && !(await n.confirm("تغییرهای گزینه‌ها ذخیره نشده‌اند؛ برویم؟", "آنچه در این فهرست تغییر داده‌اید از دست می‌رود.", true, "رفتن بدون ذخیره"))) return;
    setChoicesDirty(false);
    patch({ tab: k, field: null, ftype: null });
  };
  // the sheets: ?field=<id>|new (a library field), ?ftype=<id>|new|b:<key> (a field type)
  const fieldParam = params.get("field");
  const typeParam = params.get("ftype");
  const typeTarget: TypeSheetTarget | null = !typeParam ? null : typeParam.startsWith("b:") ? { builtin: typeParam.slice(2) } : { id: typeParam === "new" ? null : typeParam };
  const fieldId = fieldParam && fieldParam !== "new" ? fieldParam : null;

  if (!tab) return <EmptyState title="به «فیلدها» دسترسی ندارید" description="دیدن و تغییر فیلدها با طراحان فرم و گردش‌کار و مدیران تنظیمات سازمان است." />;
  const designTab = tab === "library" || tab === "types";
  const tabs = FIELDS_TABS.filter((t) => visible.includes(t.key));
  return (
    <div className="rk-admin wff-page">
      <PageHeader
        title="فیلدها"
        subtitle={fields ? `${faDigits(fields.length)} فیلد` : undefined}
        actions={
          designTab ? (
            access.designWrite ? (
              <>
                <Button icon={<Shapes {...I16} />} onClick={() => patch({ ftype: "new", field: null })}>
                  نوع فیلد تازه
                </Button>
                <Button type="primary" icon={<Plus {...I16} />} onClick={() => patch({ field: "new", ftype: null })}>
                  فیلد تازه
                </Button>
              </>
            ) : null
          ) : (
            <span ref={setSlot} className="wff-slot" />
          )
        }
      />
      {phone ? (
        // four tabs do not fit a phone's width: a select keeps every part one tap away
        <Select className="wff-tabsel" value={tab} onChange={switchTab} options={tabs.map((t) => ({ value: t.key, label: t.label }))} aria-label="بخش «فیلدها»" />
      ) : (
        <Tabs activeKey={tab} onChange={switchTab} items={tabs.map((t) => ({ key: t.key, label: t.label }))} />
      )}
      {tab === "library" ? (
        <Library rows={fields} loading={library.isLoading} canWrite={access.designWrite} onOpen={(id) => patch({ field: id })} onNew={() => patch({ field: "new" })} />
      ) : tab === "types" ? (
        <Types types={types.data} loading={types.isLoading} onOpenBuiltin={(k) => patch({ ftype: `b:${k}` })} onOpenType={(id) => patch({ ftype: id })} />
      ) : tab === "choices" ? (
        <ChoiceLists editable={access.choicesWrite} slot={slot} onDirty={setChoicesDirty} />
      ) : (
        <TableFields access={access} library={fields} slot={slot} />
      )}
      {fieldParam && access.designRead && (fieldParam !== "new" || access.designWrite) ? (
        <FieldSheet
          key={fieldParam}
          id={fieldId}
          entry={fields?.find((f) => f.id === fieldId) ?? null}
          library={fields ?? []}
          types={types.data}
          unit={unit.data ?? "rial"}
          access={access}
          onClose={() => patch({ field: null })}
          onSaved={(id) => patch({ field: id })}
        />
      ) : null}
      {typeTarget && access.designRead && ("builtin" in typeTarget || typeTarget.id || access.designWrite) ? (
        <TypeSheet key={typeParam} target={typeTarget} types={types.data} unit={unit.data ?? "rial"} access={access} onClose={() => patch({ ftype: null })} onSaved={() => patch({ ftype: null })} />
      ) : null}
    </div>
  );
}

export type { FieldsTab };
