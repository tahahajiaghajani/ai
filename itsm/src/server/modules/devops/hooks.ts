// Hooks of DevOps (same transaction as the write):
//   devops_connection   the release manager's definition (DEV-029): a webhook key on create, the secret's rotation
//                       time, the environment map checked
//   dev_repository,     the release manager maps them to services and teams (the pipelines create them on first
//   dev_pipeline        sight, as the system)
//   dev_event, dev_commit, dev_pull_request, dev_build   machine data: only the ingestion writes them
//   change_gate         opened by pipelines only; a person's decision is the release manager's (gate.ts)
import { registerHooks, type WriteArgs } from "../../engine";
import { bad, forbidden } from "../../http/errors";
import { gateBefore } from "./gate";
import { managesReleases, randomKey, type Row } from "./common";

async function managerOnly(w: WriteArgs): Promise<void> {
  if (w.trusted || w.ctx.actor === "system") return;
  if (!(await managesReleases(w.tx, w.ctx))) throw forbidden(`«${w.def.label}» را مدیر انتشار تعریف می‌کند`);
}

function machineOnly(w: WriteArgs): void {
  if (w.trusted || w.ctx.actor === "system") return;
  if (w.op === "delete") return;
  throw forbidden(`«${w.def.plural}» را ابزارهای دواپس می‌فرستند و دستی ثبت یا ویرایش نمی‌شوند`);
}

export function installDevopsHooks(): (() => void)[] {
  return [
    registerHooks("devops_connection", {
      async beforeWrite(w) {
        await managerOnly(w);
        if (w.op === "delete") return;
        if (w.op === "create" && !w.next.hook_key) w.next.hook_key = randomKey();
        if (w.changed.has("secret") && w.op !== "create") w.next.secret_rotated_at = new Date().toISOString();
        if (w.op === "create" && w.next.secret) w.next.secret_rotated_at = new Date().toISOString();
        const map = w.next.env_map;
        if (map !== null && map !== undefined && (typeof map !== "object" || Array.isArray(map) || Object.values(map as Row).some((v) => typeof v !== "string"))) {
          throw bad("نگاشت نام محیط‌ها باید شیئی از «نام در ابزار» به «کلید محیط» باشد");
        }
      },
    }),
    registerHooks("dev_repository", { beforeWrite: (w) => managerOnly(w) }),
    registerHooks("dev_pipeline", { beforeWrite: (w) => managerOnly(w) }),
    registerHooks("dev_event", { beforeWrite: machineOnly }),
    registerHooks("dev_commit", { beforeWrite: machineOnly }),
    registerHooks("dev_pull_request", { beforeWrite: machineOnly }),
    registerHooks("dev_build", { beforeWrite: machineOnly }),
    registerHooks("change_gate", {
      async beforeWrite(w) {
        if (w.op === "update" && !w.trusted && w.ctx.actor !== "system") {
          // a person adds a reason; the evidence and its hashes never change
          for (const f of ["evidence", "evidence_hash", "prev_hash", "connection_id", "environment_id", "change_id"]) if (w.changed.has(f)) throw forbidden("شواهد دروازهٔ استقرار تغییر نمی‌کند");
        }
        if (w.op === "delete" && w.ctx.actor !== "system") throw forbidden("دروازه‌های استقرار پاک نمی‌شوند");
        await gateBefore(w);
      },
    }),
  ];
}
