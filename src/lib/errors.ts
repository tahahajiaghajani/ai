/** A connection hit a quota: the job pauses and resumes automatically at `until`. */
export class RateLimitError extends Error {
  constructor(
    /** the user's AI connection (null for Claude Code in GitHub Actions) */
    public connectionId: string | null,
    public until: Date,
    public scope: "connection" | "model",
    public reason: string,
    public model?: string,
  ) {
    super(reason);
    this.name = "RateLimitError";
  }
}

/** The serverless time budget is about to run out; progress was saved, continue next tick. */
export class DeadlineError extends Error {
  constructor(message = "بودجه‌ی زمانی این اجرا تمام شد؛ ادامه در اجرای بعدی") {
    super(message);
    this.name = "DeadlineError";
  }
}

/** Temporary failure (network, 5xx, overloaded). Retry after `delayMs`. */
export class TransientError extends Error {
  constructor(
    message: string,
    public delayMs = 30_000,
  ) {
    super(message);
    this.name = "TransientError";
  }
}

/** Retrying cannot help (invalid key, unknown model, missing connection): the job fails right away. */
export class FatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalError";
  }
}

export function isNamed(err: unknown, name: string): boolean {
  return err instanceof Error && err.name === name;
}
