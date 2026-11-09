// The website widget (PTL-025, PTL-033): one script tag puts a help button on another site. Guests search the
// knowledge the organisation published without sign-in (the widget's publication); «گفتگو با دستیار» opens the
// portal's chat in a small window of this app, where the person signs in and talks to the SAME virtual agent with
// their own access (a third-party frame would not carry the session). The script and its configuration are public;
// a search must come from one of the widget's allowed sites (the Origin header, exact scheme, host and port) and is
// answered with that origin only. Colours follow the design system's palette (the script runs outside the app, so
// it carries plain values).
import { randomBytes } from "node:crypto";
import { originAllowed, originOf } from "@shared/portal/logic";
import type { PublicKbCard, WidgetConfig } from "@shared/portal/api";
import { DS_PALETTE } from "../../../ui/ds/ds-palette";
import type { Ctx, ServerConfig } from "../../context";
import { systemCtx, updateIn } from "../../engine";
import { forbidden, notFound } from "../../http/errors";
import { liveRow, managesChannels, sysOf, type Row } from "./common";
import { publicationToken, publicKbSearch } from "./publickb";

const P = DS_PALETTE.light;
/** The named colours of the app (records.css `data-c`) as plain values for the script. */
const HUES: Record<string, string> = {
  red: P.danger, orange: P.warning ?? P.danger, gold: P.chart[1], green: P.in, teal: P.chart[2], blue: P.chart[7], indigo: P.chart[4], purple: P.chart[0], magenta: P.chart[3], gray: P.text3,
};

interface Opened {
  sys: Ctx;
  row: Row;
}

async function openWidget(cfg: ServerConfig, key: string): Promise<Opened> {
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) throw notFound("ابزارک پیدا نشد");
  const hit = await cfg.db.one<{ id: string; org_id: string }>(`select id, org_id from sm_portal_widgets where widget_key = $1 and deleted_at is null limit 1`, [key]).catch(() => null);
  if (!hit) throw notFound("ابزارک پیدا نشد");
  const sys = await systemCtx(cfg, hit.org_id);
  const row = await liveRow(sys.db, sys, "portal_widget", hit.id);
  if (!row || row.active === false) throw notFound("ابزارک پیدا نشد");
  return { sys, row };
}

const base = (cfg: Partial<ServerConfig>) => (cfg.publicUrl ?? "").replace(/\/+$/, "");

/** The widget's public configuration. */
export async function widgetConfig(cfg: ServerConfig, key: string): Promise<WidgetConfig> {
  const { sys, row } = await openWidget(cfg, key);
  const token = await publicationToken(sys, row.publication_id);
  return {
    title: String(row.title ?? "راهنما و پشتیبانی"),
    greeting: String(row.greeting ?? ""),
    accent: HUES[String(row.accent ?? "indigo")] ?? HUES.indigo,
    consent: (row.consent as string) ?? null,
    search: !!token,
    chat_url: row.chat !== false ? `${base(cfg)}/${sys.org.id}/portal/chat?embed=1` : null,
    kb_url: token ? `${base(cfg)}/p/kb/${token}` : null,
  };
}

/** A guest's search from an allowed site: the widget's public knowledge, with each hit's public address. */
export async function widgetSearch(cfg: ServerConfig, key: string, origin: string | null | undefined, q: string): Promise<{ origin: string; hits: (PublicKbCard & { url: string })[] }> {
  const { sys, row } = await openWidget(cfg, key);
  const allowed = Array.isArray(row.allowed_origins) ? (row.allowed_origins as string[]) : [];
  if (!originAllowed(origin, allowed)) throw forbidden("این وب‌سایت اجازهٔ استفاده از ابزارک را ندارد");
  const token = await publicationToken(sys, row.publication_id);
  if (!token) return { origin: originOf(origin)!, hits: [] };
  const r = await publicKbSearch(cfg, token, q, null, "widget");
  return { origin: originOf(origin)!, hits: r.hits.slice(0, 6).map((h) => ({ ...h, url: `${base(cfg)}/p/kb/${token}/a/${h.slug}` })) };
}

/** The allowed origin of a request (for the CORS answer), or null. */
export async function widgetOrigin(cfg: ServerConfig, key: string, origin: string | null | undefined): Promise<string | null> {
  try {
    const { row } = await openWidget(cfg, key);
    const allowed = Array.isArray(row.allowed_origins) ? (row.allowed_origins as string[]) : [];
    return originAllowed(origin, allowed) ? originOf(origin) : null;
  } catch {
    return null;
  }
}

/** A new key for a widget (the embed snippet changes; the old one stops at once). Connector administrators. */
export async function rotateWidgetKey(ctx: Ctx, id: string): Promise<{ key: string; snippet: string }> {
  if (!managesChannels(ctx)) throw forbidden("ابزارک وب‌سایت را مدیران اتصال‌ها تنظیم می‌کنند");
  const sys = sysOf(ctx);
  const row = await liveRow(ctx.db, sys, "portal_widget", id);
  if (!row) throw notFound("ابزارک پیدا نشد");
  const key = randomBytes(18).toString("base64url");
  await ctx.write((tx) => updateIn(tx, sys, "portal_widget", id, { widget_key: key }, { trusted: true }));
  return { key, snippet: widgetSnippet(ctx.cfg, key) };
}

/** The script tag a site adds. */
export function widgetSnippet(cfg: Partial<ServerConfig>, key: string): string {
  return `<script src="${base(cfg)}/api/public/portal/widget/${key}.js" async></script>`;
}

/**
 * The widget's script: a button at the bottom start corner (RTL), a small panel with the greeting, a search over
 * the public knowledge (when the widget has one) and «گفتگو با دستیار» opening the portal's chat window. Plain DOM in
 * a shadow root (the host page's styles stay out), no dependencies, text set with textContent only.
 */
export function widgetScript(key: string): string {
  const k = JSON.stringify(key);
  return `(function(){"use strict";
var KEY=${k};var me=document.currentScript;var API=(me&&me.src?me.src.replace(/\\/api\\/public\\/portal\\/widget\\/.*$/,""):"")+"/api/public/portal/widget/"+KEY;
if(window.__itsmWidget)return;window.__itsmWidget=1;
function el(t,c,txt){var e=document.createElement(t);if(c)e.className=c;if(txt!=null)e.textContent=txt;return e;}
fetch(API+"/config").then(function(r){return r.ok?r.json():null}).then(function(cfg){if(!cfg)return;
var host=el("div");host.style.cssText="position:fixed;inset-inline-start:20px;bottom:20px;z-index:2147483000";document.body.appendChild(host);
var root=host.attachShadow?host.attachShadow({mode:"open"}):host;
var st=el("style");st.textContent=":host{all:initial}*{box-sizing:border-box;font-family:Vazirmatn,Tahoma,sans-serif}.b{inline-size:52px;block-size:52px;border-radius:50%;border:0;cursor:pointer;color:#fff;background:"+cfg.accent+";box-shadow:0 6px 18px rgba(0,0,0,.18);font-size:22px}.p{position:absolute;inset-inline-start:0;bottom:64px;inline-size:min(340px,calc(100vw - 40px));max-block-size:70vh;overflow:auto;background:${P.surface};color:${P.text};border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.18);padding:16px;direction:rtl;display:none}.p.o{display:block}h2{margin:0 0 6px;font-size:16px}p{margin:0 0 10px;font-size:13px;color:${P.text2};line-height:1.7}input{inline-size:100%;block-size:38px;border:1px solid ${P.line3};border-radius:10px;padding:0 10px;font-size:14px;direction:rtl}ul{list-style:none;margin:10px 0;padding:0}li{margin:0 0 8px}a{color:"+cfg.accent+";font-size:14px;text-decoration:none}a:hover{text-decoration:underline}small{display:block;color:${P.text3};font-size:12px;margin-top:2px}.c{inline-size:100%;block-size:40px;border:0;border-radius:10px;background:"+cfg.accent+";color:#fff;font-size:14px;cursor:pointer;margin-top:6px}.n{font-size:11px;color:${P.text3};margin-top:8px}";
root.appendChild(st);
var btn=el("button","b","؟");btn.setAttribute("aria-label",cfg.title);btn.setAttribute("aria-expanded","false");
var panel=el("div","p");panel.setAttribute("role","dialog");panel.setAttribute("aria-label",cfg.title);
panel.appendChild(el("h2",null,cfg.title));if(cfg.greeting)panel.appendChild(el("p",null,cfg.greeting));
if(cfg.search){var inp=el("input");inp.type="search";inp.placeholder="جست‌وجو در راهنما…";inp.setAttribute("aria-label","جست‌وجو در راهنما");var ul=el("ul");ul.setAttribute("aria-live","polite");var t=0;
inp.addEventListener("input",function(){clearTimeout(t);var q=inp.value.trim();if(q.length<2){ul.textContent="";return}t=setTimeout(function(){fetch(API+"/search",{method:"POST",headers:{"content-type":"text/plain"},body:JSON.stringify({q:q})}).then(function(r){return r.ok?r.json():{hits:[]}}).then(function(d){ul.textContent="";if(!d.hits.length){ul.appendChild(el("li",null,"چیزی پیدا نشد؛ با دستیار گفتگو کنید."));return}d.hits.forEach(function(h){var li=el("li");var a=el("a",null,h.title);a.href=h.url;a.target="_blank";a.rel="noopener";li.appendChild(a);if(h.summary)li.appendChild(el("small",null,h.summary));ul.appendChild(li)})}).catch(function(){})},350)});
panel.appendChild(inp);panel.appendChild(ul);if(cfg.kb_url){var all=el("a",null,"همهٔ راهنماها");all.href=cfg.kb_url;all.target="_blank";all.rel="noopener";panel.appendChild(all)}}
if(cfg.chat_url){var chat=el("button","c","گفتگو با دستیار");chat.addEventListener("click",function(){window.open(cfg.chat_url,"itsm-chat","width=420,height=640")});panel.appendChild(chat)}
if(cfg.consent)panel.appendChild(el("div","n",cfg.consent));
btn.addEventListener("click",function(){var o=panel.classList.toggle("o");btn.setAttribute("aria-expanded",o?"true":"false");if(o&&inp)inp.focus()});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&panel.classList.contains("o")){panel.classList.remove("o");btn.setAttribute("aria-expanded","false");btn.focus()}});
root.appendChild(panel);root.appendChild(btn);}).catch(function(){});})();`;
}
