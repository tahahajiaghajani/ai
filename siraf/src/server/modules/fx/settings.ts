// Exchange settings (settings.fx of the organisation): price providers and their order, board
// margin, live refresh interval, KYC threshold, overdraft rule and custom price sources.
import type { Ctx } from "../../context";
import { bad } from "../../http/errors";
import { D, isNumeric } from "@shared/money";
import { fxSettings, PROVIDERS, type CustomSource, type FxSettings } from "./common";
import { safeExternalUrl } from "./net";

export function readSettings(ctx: Ctx) {
  ctx.need("fx", "view");
  const s = fxSettings(ctx.org);
  // custom URLs may carry the owner's API keys
  const full = ctx.can("fx", "full");
  return { settings: full ? s : { ...s, custom: s.custom.map((c) => ({ ...c, url: "" })) }, providers: PROVIDERS, can_edit: full };
}

export interface SettingsPatch {
  providers?: string[];
  margin_pct?: string | number | null;
  refresh_seconds?: number | null;
  kyc_threshold?: string | number | null;
  allow_negative?: boolean;
  custom?: { code: string; url: string; path: string; unit: "base" | "usd"; factor?: string | number | null }[];
}

export async function writeSettings(ctx: Ctx, patch: SettingsPatch) {
  ctx.need("fx", "full");
  const current = fxSettings(ctx.org);
  const next: FxSettings = { ...current };
  if (patch.providers) {
    const ids = patch.providers.filter((p, i, a) => PROVIDERS.some((x) => x.id === p) && a.indexOf(p) === i);
    if (!ids.length) throw bad("دست‌کم یک منبع قیمت را انتخاب کنید");
    next.providers = ids;
  }
  if (patch.margin_pct !== undefined && patch.margin_pct !== null) {
    if (!isNumeric(patch.margin_pct) || D(patch.margin_pct).lt(0) || D(patch.margin_pct).gt(50)) throw bad("حاشیه‌ی نرخ باید بین ۰ تا ۵۰ درصد باشد");
    next.margin_pct = D(patch.margin_pct).toFixed();
  }
  if (patch.refresh_seconds !== undefined && patch.refresh_seconds !== null) {
    const n = Number(patch.refresh_seconds);
    if (!Number.isFinite(n) || n < 10 || n > 3600) throw bad("بازه‌ی به‌روزرسانی باید بین ۱۰ ثانیه تا یک ساعت باشد");
    next.refresh_seconds = Math.round(n);
  }
  if (patch.kyc_threshold !== undefined) {
    if (patch.kyc_threshold === null || patch.kyc_threshold === "" || D(patch.kyc_threshold).isZero()) next.kyc_threshold = null;
    else if (!isNumeric(patch.kyc_threshold) || D(patch.kyc_threshold).lt(0)) throw bad("سقف احراز هویت معتبر نیست");
    else next.kyc_threshold = D(patch.kyc_threshold).toFixed();
  }
  if (patch.allow_negative !== undefined) next.allow_negative = !!patch.allow_negative;
  if (patch.custom) {
    next.custom = patch.custom.map((c, i): CustomSource => {
      const code = String(c.code ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9.-]{2,12}$/.test(code)) throw bad(`منبع سفارشی ${i + 1}: نماد ارز معتبر نیست`);
      // an empty URL from a reader without access keeps the stored one
      const url = String(c.url ?? "").trim() || current.custom.find((x) => x.code === code)?.url || "";
      const problem = safeExternalUrl(url);
      if (problem) throw bad(`منبع سفارشی ${code}: ${problem}`);
      const path = String(c.path ?? "").trim();
      if (!path) throw bad(`منبع سفارشی ${code}: مسیر عدد در پاسخ JSON را وارد کنید`);
      if (c.factor !== undefined && c.factor !== null && c.factor !== "" && (!isNumeric(c.factor) || D(c.factor).lte(0))) throw bad(`منبع سفارشی ${code}: ضریب معتبر نیست`);
      return { code, url, path, unit: c.unit === "usd" ? "usd" : "base", factor: c.factor ? D(c.factor).toFixed() : null };
    });
  }
  await ctx.write((tx) =>
    tx.query(`update tz_orgs set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('fx', $2::jsonb), origin = $3 where id = $1`, [ctx.org.id, next, ctx.cfg.origin]),
  );
  ctx.org.settings = { ...(ctx.org.settings ?? {}), fx: next as never };
  return readSettings(ctx);
}
