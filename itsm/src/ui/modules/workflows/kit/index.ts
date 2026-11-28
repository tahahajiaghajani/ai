// The workflows UI kit (design F §8, package F5k): what the admin pages (F5, F6) and the user pages (F7) build on.
// Import from here, e.g. `import { ProcessCanvas, StepLegend } from "../../kit"`. The canvas pulls in @xyflow/react:
// load the pages that use it lazily (the module's routes.tsx files do).
export { ProcessCanvas, PROCESS_NODE_MIME, type ProcessCanvasProps } from "./ProcessCanvas";
export { StepLegend, StepList, StepStatusBadge, usedStatuses, type StepListProps } from "./StepLegend";
export { RightsMatrix, type RightsMatrixProps } from "./RightsMatrix";
export { PositionPicker, heldIn, type PositionPickerProps } from "./PositionPicker";
export { AssigneePicker, AssigneeRules, type AssigneeContext, type AssigneePickerProps } from "./AssigneePicker";
export { FilesInput, FilesValue, RecordFilesInput, type FileItem, type FilesFieldLike, type FilesInputProps } from "./FilesInput";
export { ProcessNodeIcon, StepStatusIcon } from "./icons";
export { kitApi, ESTIMATE_GATES, type EstimateResult, type HolderRow, type MemberRow, type PositionRow } from "./api";
export { DEMO_PEOPLE_GATES, DEMO_PEOPLE_KEY, DemoTag, demoSet, isDemo, useDemoPeople } from "./demo";
export { MemberSelect, type MemberSelectProps } from "./MemberSelect";
export * from "./model";
