// The route-level pages of the record UI, loaded lazily by `module.tsx` (the list and record pages and everything
// under them stay out of the app's first bundle).
import type { ReactNode } from "react";
import { useParams } from "react-router";
import type { ListPreset, RecordExtensions } from "./extensions";
import { RecordList } from "./list/RecordList";
import { RecordPage } from "./page/RecordPage";

export function ListRoute({ table, title, preset, actions }: { table?: string; title?: ReactNode; preset?: ListPreset; actions?: ReactNode }) {
  const p = useParams();
  const t = table ?? p.table ?? "";
  return <RecordList key={t} table={t} title={title} preset={preset} actions={actions} />;
}

export function PageRoute({ table, id, extensions }: { table?: string; id?: string; extensions?: RecordExtensions }) {
  const p = useParams();
  const t = table ?? p.table ?? "";
  const rid = id ?? p.id ?? "";
  return <RecordPage key={`${t}:${rid}`} table={t} id={rid} extensions={extensions} />;
}
