// The ITSM access model shared by the server and the UI (docs/spec/ACCESS.md): areas, scopes, grants, roles, the
// built-in role catalogue and the in-memory evaluator. Imported by the UI: keep it free of server imports.
export * from "./areas";
export * from "./model";
export * from "./builtins";
export * from "./evaluate";
