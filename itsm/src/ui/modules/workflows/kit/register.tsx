// The kit's pieces in every record form (design F §3.1, §12.1 «FieldInput / display»): the position picker for every
// reference to a position («نقش سازمانی»), and the files input and display of the «پیوست» widget (`files`). Imported once
// by the module (../index.tsx). The files parts load on first use.
import { lazy, Suspense } from "@ui/lib/lazy";
import { registerRefPicker, registerWidget } from "../../../records/extensions";
import { PositionPicker } from "./PositionPicker";

const RecordFilesInput = lazy(() => import("./FilesInput").then((m) => ({ default: m.RecordFilesInput })));
const FilesValue = lazy(() => import("./FilesInput").then((m) => ({ default: m.FilesValue })));

registerRefPicker("position", (p) => (
  <PositionPicker value={p.value} onChange={p.onChange} multiple={p.multiple} disabled={p.disabled} placeholder={p.placeholder} allowClear={p.allowClear} autoFocus={p.autoFocus} aria-label={p["aria-label"]} />
));

registerWidget("files", {
  input: (p) => (
    <Suspense fallback={null}>
      <RecordFilesInput table={p.table} recordId={p.recordId} value={p.value} onChange={(ids) => p.onChange(ids)} field={p.field} disabled={p.disabled} id={p.id} status={p.status} aria-label={p["aria-label"]} />
    </Suspense>
  ),
  display: (p) => (
    <Suspense fallback={null}>
      <FilesValue value={p.value} display={p.display} compact={p.compact} />
    </Suspense>
  ),
});
