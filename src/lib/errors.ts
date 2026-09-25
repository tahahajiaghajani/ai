/** Provider hit a quota: the job should pause and resume automatically at `until`. */
export class RateLimitError extends Error {
  constructor(
    public provider: "gemini" | "claude",
    public until: Date,
    public scope: "provider" | "model",
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

export function isNamed(err: unknown, name: string): boolean {
  return err instanceof Error && err.name === name;
}
