// The window's cache filled once per build (desktop/src/main.ts, docs/PERFORMANCE_FA.md §17).
//
// The local server keeps the build's hashed files (/assets/) in the window's cache for good, but a route opened for the
// first time still asks for its code — 62 files for an incident record — and those requests wait in Chromium's six
// connections behind the page's own API calls on a local server busy with them: desktop-e2e on this box, the
// administrator's first incident record: its files p50 1.1 s, max 2.0 s; the member's visit, from the cache: p50 7 ms.
// Once the window has been on screen a while, the page itself asks for every hashed file, two at a time and at low
// priority, reading each to the end (a response not read to the end is not kept whole); the main process remembers the
// build (a hash of its file list) in window.json. The page asks, not the main process: Chromium partitions its cache by
// the page's site.

/** The build's hashed code and styles in the renderer's assets folder. */
export function warmable(files: string[]): string[] {
  return files.filter((f) => /\.(js|css)$/.test(f) && !/[/\\]/.test(f)).sort();
}

/** The script the main process runs in the app's page: resolves to how many files it read. */
export function warmScript(files: string[], parallel = 2): string {
  return `(async (files, parallel) => {
  let next = 0, read = 0;
  const one = async () => {
    while (next < files.length) {
      const f = files[next++];
      try {
        const r = await fetch("/assets/" + f, { priority: "low", credentials: "same-origin" });
        if (r.ok) { await r.arrayBuffer(); read++; }
      } catch (e) { /* the next one */ }
    }
  };
  await Promise.all(Array.from({ length: parallel }, one));
  return read;
})(${JSON.stringify(files)}, ${Math.max(1, Math.trunc(parallel))})`;
}
