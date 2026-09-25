import "server-only";
import { errorMessage } from "@/lib/utils";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

/** Run a server action body and turn exceptions into a serializable error. */
export async function act<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    // redirect()/notFound() must propagate
    if (err && typeof err === "object" && "digest" in err && String((err as { digest?: string }).digest).startsWith("NEXT_")) throw err;
    console.error(err);
    return { ok: false, error: errorMessage(err) };
  }
}
