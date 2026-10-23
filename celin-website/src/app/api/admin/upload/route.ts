import { isAdmin } from "@/lib/admin-auth";
import { storeUpload } from "@/lib/admin-media";
import { UserError } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Picture upload from the admin panel: the browser sends the resized widths of one picture as
 * multipart fields "w<width>" plus its size, preview and alt texts. Admin only.
 */
export async function POST(req: Request) {
  const headers = { "cache-control": "no-store" };
  if (!(await isAdmin())) return Response.json({ ok: false, error: "نشست شما منقضی شده است؛ دوباره وارد شوید." }, { status: 401, headers });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "فایل دریافت نشد (حجم زیاد یا اتصال قطع شد)." }, { status: 400, headers });
  }
  const files: { width: number; data: Uint8Array }[] = [];
  for (const [key, value] of form.entries()) {
    const m = /^w(\d{2,4})$/.exec(key);
    if (!m || typeof value === "string") continue;
    files.push({ width: Number(m[1]), data: new Uint8Array(await value.arrayBuffer()) });
  }
  const num = (k: string) => Number(form.get(k) ?? 0);
  const str = (k: string) => String(form.get(k) ?? "");
  try {
    const media = await storeUpload({
      files,
      width: num("width"),
      height: num("height"),
      placeholder: str("placeholder"),
      alt_fa: str("alt_fa"),
      alt_en: str("alt_en"),
      focal_x: num("focal_x") || 50,
      focal_y: num("focal_y") || 50,
    });
    return Response.json({ ok: true, media }, { headers });
  } catch (e) {
    const msg = e instanceof UserError ? e.message : e instanceof Error && e.message === "unauthorized" ? "نشست شما منقضی شده است." : "بارگذاری انجام نشد؛ دوباره امتحان کنید.";
    if (!(e instanceof UserError)) console.error("[upload]", e);
    return Response.json({ ok: false, error: msg }, { status: 400, headers });
  }
}
