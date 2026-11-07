// The record UI kit: everything a module needs to build its screens on engine tables (docs/spec/UI_RECORDS.md).
export { RecordList, type RecordListProps } from "./list/RecordList";
export { RecordPage, type RecordPageProps } from "./page/RecordPage";
export { RecordForm } from "./page/RecordForm";
export { RecordHeader, SlaChips } from "./page/RecordHeader";
export { ActivityStream } from "./page/ActivityStream";
export { SidePanel, SideCard } from "./page/SidePanel";
export { TransitionDialog, needsDialog } from "./page/TransitionDialog";
export { ConflictDialog } from "./page/ConflictDialog";
export { KanbanBoard, Card as RecordCard } from "./board/KanbanBoard";
export { CalendarView } from "./board/CalendarView";
export { TimelineView } from "./board/TimelineView";
export { FilterBuilder } from "./filter/FilterBuilder";
export { FieldInput, DateTimeInput, DurationInput } from "./fields/FieldInput";
export { FieldValue, ChoiceTag, UserChip, RecordNo, RefLink, RecordMarkdown, plainExcerpt } from "./fields/display";
export { RecordSelect, UserSelect } from "./fields/RecordSelect";
export { MarkdownEditor } from "./fields/MarkdownEditor";
export { ImportRecords, exportList } from "./list/transfer";
export {
  registerRecordExtensions, extensionsFor, tablePath, recordPath, newRecordPath, setPolicySource, setHolidaySource,
  type RecordExtensions, type ListPreset, type RecordContext, type ComposerContext, type SidePanelWidget, type RecordTab, type MoreAction, type BulkAction, type Holiday,
} from "./extensions";
export { recordModule, recordSearch, RecordListRoute, RecordPageRoute, type RecordModuleSpec, type RecordTableEntry } from "./module";
export {
  useSchema, useTableDefs, useTableDef, useRecordList, useRecord, useAggregate, useActivity, useLinks, useAttachments, useViews, useRecordActions, useViewActions, useMe, useRefreshSchema, keys as recordKeys,
} from "./data/hooks";
export { recordsApi, uploadAttachment, attachmentUrl } from "./data/api";
export type { UiPolicy, UiPolicyAction, FormState } from "./model/policies";
export type { RecordRow, RecordMeta, RecordResult, TableMeta, DisplayMap, ListQuery, ViewRow } from "./model/types";
