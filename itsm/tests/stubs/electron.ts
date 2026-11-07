// Stand-in for the `electron` package in tests. Electron is installed only for the Windows build
// (itsm/desktop), not with the project's own dependencies, so tests that load the main process
// mock this module with vi.mock("electron", …) (vitest.config.mts points `electron` here).
export {};
