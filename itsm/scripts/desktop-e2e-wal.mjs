// The Windows app's database log as desktop-e2e watches it while the app runs (docs/qa/PERFORMANCE_E2E_FA.md §1-5):
// the size of pg_wal on disk — what a crash or a forced quit would replay, and what a backup carries — and the
// checkpoints the app logged, by reason.
//
// It must be measured while the app runs. Once the app closes, its close checkpoint, PostgreSQL's shutdown checkpoint
// and the next start's checkpoint trim pg_wal to max_wal_size (a start parameter of every PGlite data folder,
// src/server/db/wal.ts) whatever happened before: 64 MB after the run says nothing about the runtime scheduler, which
// alone keeps the log bounded while the app is open (PGlite has no checkpointer).
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SEGMENT = /^[0-9A-F]{24}$/;
const MB = 1048576;

/**
 * pg_wal of a data folder now: its segment files and their size in MB, or null while there is none (a first start
 * still writing the folder). A segment recycled or removed between the listing and its stat is skipped.
 */
export function walNow(dbDir) {
  let names;
  try {
    names = readdirSync(join(dbDir, "pg_wal"));
  } catch {
    return null;
  }
  let bytes = 0;
  let segments = 0;
  for (const f of names) {
    if (!SEGMENT.test(f)) continue;
    try {
      bytes += statSync(join(dbDir, "pg_wal", f)).size;
      segments++;
    } catch {
      /* recycled or removed meanwhile */
    }
  }
  return { mb: Math.round(bytes / MB), segments };
}

/** The peak of pg_wal over the samples taken while the app runs, overall and per phase of the run. */
export class WalWatch {
  constructor(dbDir, now = () => Date.now()) {
    this.dbDir = dbDir;
    this.now = now;
    this.t0 = now();
    this.samples = 0;
    this.peak = null;
    this.byPhase = {};
  }

  /** One look (the run's 1 s sampler, and named moments such as «after the demo pack»); null while there is no pg_wal. */
  sample(phase) {
    const w = walNow(this.dbDir);
    if (!w) return null;
    this.samples++;
    const at_s = Math.round((this.now() - this.t0) / 1000);
    if (!this.peak || w.mb > this.peak.mb) this.peak = { ...w, phase, at_s };
    const key = String(phase).split(":")[0];
    this.byPhase[key] = Math.max(this.byPhase[key] ?? 0, w.mb);
    return { ...w, at_s };
  }

  summary() {
    return {
      samples: this.samples,
      peak_mb: this.peak?.mb ?? null,
      peak_segments: this.peak?.segments ?? null,
      peak_phase: this.peak?.phase ?? null,
      peak_at_s: this.peak?.at_s ?? null,
      peak_mb_by_phase: { ...this.byPhase },
    };
  }
}

/**
 * The checkpoints the app logged, by reason — app.log lines of src/server/db/wal.ts as the local server prints them:
 * «[server] [itsm] database checkpoint { reason: 'volume', ms: 182, wal_mb: 38.9 }». Failures («database checkpoint
 * failed», «… before close failed») are not checkpoints.
 */
export function checkpointReasons(text) {
  const out = {};
  for (const m of String(text ?? "").matchAll(/database checkpoint \{\s*["']?reason["']?:\s*["']([a-z_]+)["']/g)) out[m[1]] = (out[m[1]] ?? 0) + 1;
  return out;
}

/** Checkpoints the runtime scheduler took while the app ran: after enough log («volume») or time («age») — not at open, before a backup or a close, or after migrations. */
export const runtimeCheckpoints = (reasons) => (reasons?.volume ?? 0) + (reasons?.age ?? 0);
