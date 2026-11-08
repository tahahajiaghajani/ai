// The engine's public error: AI cannot answer now (with the normalised kind for the Persian text).
import type { AiErrorKind } from "@shared/ai/types";
import { AppError } from "../../http/errors";

export class AiUnavailableError extends Error {
  constructor(public kind: AiErrorKind, message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

const STATUS: Partial<Record<AiErrorKind, number>> = { not_configured: 403, disabled: 403, budget: 403, rate: 429, quota: 429, invalid: 400 };

/**
 * AI cannot answer a plain JSON request: an HTTP error whose code is `ai_<kind>` and whose details carry the kind,
 * so the UI shows the Persian title and remedy of that kind.
 */
export function aiHttpError(kind: AiErrorKind, message: string): AppError {
  return new AppError(STATUS[kind] ?? 503, `ai_${kind}`, message, { kind });
}
