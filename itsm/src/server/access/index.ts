// The ITSM access model on the server (docs/spec/ACCESS.md). `installAccessModel()` makes it the engine's access
// provider and registers its hooks; the app does it once when it is created (src/server/routes/modules.ts), so the
// web version, the Windows app and the tests all run with it. Everything else that decides who sees what — API
// routes, reports, search, notifications, sync and the AI layer — goes through these functions, never around them.
import { setAccessProvider, access } from "./provider";
import { itsmProvider } from "./itsm";
import { installAccessHooks } from "./hooks";

export { itsmProvider } from "./itsm";
export { readSql, writeSql, registerParticipantSource, type ParticipantSource } from "./predicate";
export { prepareSubject, subjectOf, snapshotFor, loadOrgSnapshot, accessSettings, buildSubject, clearAccessCaches, type AccessSettings, type Snapshot } from "./subject";
export { installAccessHooks, checkGrantable } from "./hooks";
export * from "./service";

let installed = false;

/** Make the ITSM access model the engine's provider (idempotent). */
export function installAccessModel(): void {
  installAccessHooks();
  if (installed && access() === itsmProvider) return;
  installed = true;
  setAccessProvider(itsmProvider);
}
