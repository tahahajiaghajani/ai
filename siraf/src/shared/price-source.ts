// Custom price sources that need an API key (gold board «منبع دلخواه», exchange board «منابع سفارشی»). The key
// itself stays on the server of each runtime (src/server/modules/fx/source-keys.ts). The settings, which sync between
// the web version and the Windows app, keep only where it goes:
//   header  the name of the request header that carries it (EZRate, Servix: X-API-Key), or
//   {key}   a placeholder in the URL (Navasan: https://api.navasan.tech/latest/?api_key={key}).
// A key belongs to the origin of its source's URL (https://api.ezrate.me) and is never sent anywhere else.
// A source may also name itself next to its prices (label and link): free plans such as EZRate's ask for it.
// Pure: shared by the server and the settings dialogs.

export const KEY_PLACEHOLDER = "{key}";

/** Request headers a key may not ride in: they frame or route the request, or carry other credentials. */
const FORBIDDEN_HEADER = /^(?:host|cookie2?|set-cookie2?|content-.*|connection|keep-alive|proxy-.*|te|trailer|transfer-encoding|upgrade|expect)$/i;
/** An HTTP token (RFC 9110 §5.6.2). */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Why `name` cannot carry a key (null when it can: X-API-Key, Authorization, apikey …). */
export function headerNameProblem(name: string): string | null {
  const raw = String(name ?? "");
  if (/[\r\n]/.test(raw)) return "نام سرآیند نباید شکست خط داشته باشد";
  const n = raw.trim();
  if (!n) return "نام سرآیند را بنویسید";
  if (n.length > 64) return "نام سرآیند بیش از ۶۴ نویسه است";
  if (!TOKEN.test(n)) return `نام سرآیند «${n}» معتبر نیست؛ فقط حروف لاتین، رقم و خط تیره (مثل X-API-Key)`;
  if (FORBIDDEN_HEADER.test(n)) return `سرآیند «${n}» برای فرستادن کلید مجاز نیست`;
  return null;
}

/** The origin a source's URL is fetched from, {key} left unfilled («https://api.ezrate.me»); null for no URL. */
export function sourceOrigin(url: string | null | undefined): string | null {
  try {
    const u = new URL(String(url ?? "").trim().split(KEY_PLACEHOLDER).join("k"));
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** The host of an origin or URL for messages («api.ezrate.me»). */
export function hostOf(url: string): string {
  try {
    return new URL(String(url).split(KEY_PLACEHOLDER).join("k")).host;
  } catch {
    return String(url);
  }
}

/** Does this source send a key (a header name, or {key} in its URL)? */
export function needsKey(src: { url?: string | null; header?: string | null }): boolean {
  return !!String(src.header ?? "").trim() || String(src.url ?? "").includes(KEY_PLACEHOLDER);
}

/**
 * Why a source cannot carry a key (null when it can, or sends none): the address must be https, and {key} may sit only
 * in the path or the query — never in the site's name, a port, a user name or the part after «#».
 */
export function keyedUrlProblem(url: string): string | null {
  const raw = String(url ?? "").trim();
  let a: URL;
  let b: URL;
  try {
    a = new URL(raw.split(KEY_PLACEHOLDER).join("a"));
    b = new URL(raw.split(KEY_PLACEHOLDER).join("b"));
  } catch {
    return "نشانی معتبر نیست";
  }
  if (a.protocol !== "https:") return "کلید فقط به نشانی https فرستاده می‌شود";
  if (a.origin !== b.origin || a.username || a.password || b.username || b.password || a.hash !== b.hash) {
    return "{key} فقط در مسیر یا پارامترهای نشانی می‌آید، نه در نام سایت";
  }
  return null;
}

/** A pasted key without line breaks, tabs and invisible marks; inner spaces stay («Bearer ezr_live_…»). */
export function cleanSourceKey(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/[\r\n\t\p{Cf}]/gu, "").trim();
}

/** Why a cleaned key cannot be sent in a header or a URL (null when it can). */
export function sourceKeyProblem(key: string): string | null {
  if (key.length < 8) return "کلید واردشده کوتاه است";
  if (key.length > 1000) return "کلید واردشده بیش از اندازه بلند است";
  if (!/^[\x20-\x7e]+$/.test(key)) return "کلید فقط حروف لاتین، رقم و نشانه دارد";
  return null;
}

/** The name a source shows next to its prices («EZRate»): one line of at most 40 characters, null when empty. */
export function cleanSourceLabel(v: unknown): string | null {
  const s = String(v ?? "")
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
  return s || null;
}

/** The link of a source's name: an https address of at most 300 characters (anything else: null). */
export function cleanSourceLink(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s || s.length > 300) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && !u.username && !u.password ? s : null;
  } catch {
    return null;
  }
}
