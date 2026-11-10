// HTTP client for the API (same origin on web and desktop). Errors carry the server's Persian
// message so screens can show it as is.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(params?: Query): string {
  if (!params) return "";
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

/**
 * Sensitive administration answers 401 `reauth_required` once the sign-in is older than the organisation allows: the
 * registered handler (ReauthGate) asks for the password or Windows and resolves true when the session is confirmed
 * again — the request is then sent once more.
 */
type ReauthHandler = (details: unknown) => Promise<boolean>;
let reauthHandler: ReauthHandler | null = null;
export function setReauthHandler(h: ReauthHandler | null): void {
  reauthHandler = h;
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query, retried = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}${qs(query)}`, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "network", "ارتباط با سرور برقرار نشد؛ اتصال را بررسی کنید");
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = data?.error;
    if (res.status === 401 && e?.code === "reauth_required" && reauthHandler && !retried) {
      if (await reauthHandler(e.details)) return request<T>(method, path, body, query, true);
    }
    // only a missing or ended session signs the screens out (not a refused password or a re-authentication)
    if (res.status === 401 && (e?.code ?? "unauthorized") === "unauthorized" && path !== "/auth/login" && path !== "/auth/me") window.dispatchEvent(new CustomEvent("itsm:unauthorized"));
    throw new ApiError(res.status, e?.code ?? "error", e?.message ?? `خطای ${res.status}`, e?.details);
  }
  return data as T;
}

/**
 * POST whose answer is a stream (server-sent events): resolves with the open Response as soon as the headers
 * arrive, so the caller reads the body as it comes. A refused request fails like the JSON calls (ApiError with
 * the server's Persian message, 401 → `itsm:unauthorized`); an abort through `signal` rejects with its AbortError.
 */
async function openStream(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body ?? {}),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError(0, "network", "ارتباط با سرور برقرار نشد؛ اتصال را بررسی کنید");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    const e = data?.error;
    if (res.status === 401) window.dispatchEvent(new CustomEvent("itsm:unauthorized"));
    throw new ApiError(res.status, e?.code ?? "error", e?.message ?? `خطای ${res.status}`, e?.details);
  }
  if (!res.body) throw new ApiError(0, "network", "پاسخ سرور خوانده نشد؛ دوباره تلاش کنید");
  return res;
}

export const api = {
  get: <T = any>(path: string, query?: Query) => request<T>("GET", path, undefined, query),
  post: <T = any>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  put: <T = any>(path: string, body: unknown = {}) => request<T>("PUT", path, body),
  patch: <T = any>(path: string, body: unknown = {}) => request<T>("PATCH", path, body),
  del: <T = any>(path: string) => request<T>("DELETE", path),
  stream: (path: string, body: unknown = {}, signal?: AbortSignal) => openStream(path, body, signal),
};

/** The sign-in-free API of public pages: `publicApi.get("/status/<key>")` → /api/public/status/<key> (rate limited). */
export const publicApi = {
  get: <T = any>(path: string, query?: Query) => api.get<T>(`/public${path}`, query),
};

/** Organisation-scoped client: `orgApi(id).get("/data/party")` → /api/o/:id/data/party */
export function orgApi(orgId: string) {
  const p = (path: string) => `/o/${orgId}${path}`;
  return {
    get: <T = any>(path: string, query?: Query) => api.get<T>(p(path), query),
    post: <T = any>(path: string, body: unknown = {}) => api.post<T>(p(path), body),
    put: <T = any>(path: string, body: unknown = {}) => api.put<T>(p(path), body),
    patch: <T = any>(path: string, body: unknown = {}) => api.patch<T>(p(path), body),
    del: <T = any>(path: string) => api.del<T>(p(path)),
    stream: (path: string, body: unknown = {}, signal?: AbortSignal) => api.stream(p(path), body, signal),
  };
}
export type OrgApi = ReturnType<typeof orgApi>;

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "خطای ناشناخته";
}
