// «راهنما»: getting started, keyboard shortcuts, the how-tos people ask about most, and «دربارهٔ …» (the version and
// the open-source font licences). Every page's explanations live here instead of on the page itself; modules add
// their own articles here when they arrive.
import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { PageHeader } from "../../components/layout";
import { Wordmark, BrandTile } from "../../components/brand";
import { APP_NAME, APP_NAME_EN, APP_TAGLINE, APP_VERSION } from "@shared/constants";
import { ROLES, type Role } from "@shared/permissions";
import { Keys, Version } from "../../components/blocks";

const SHORTCUTS: [string[][], string][] = [
  [[["Ctrl", "K"]], "جست‌وجوی سراسری: هر صفحه یا فرمان"],
  [[["Ctrl", "J"]], "باز و بسته کردن «دستیار»"],
  [[["Alt", "↑"], ["Alt", "↓"]], "در خانهٔ تاریخ: روز بعد یا روز قبل"],
  [[["+"], ["*"]], "در خانهٔ عدد: سه صفر (۲۵۰ ← ۲۵۰٬۰۰۰)"],
  [[["J"], ["K"]], "در فهرست‌ها: ردیف بعد یا قبل؛ Enter باز می‌کند"],
  [[["X"]], "در فهرست‌ها: انتخاب ردیف برای کار گروهی (Esc لغو انتخاب)"],
  [[["/"]], "در فهرست‌ها: رفتن به جست‌وجو"],
  [[["Alt", "S"]], "در رکورد: ذخیرهٔ ویرایش (Esc انصراف)"],
  [[["Ctrl", "Enter"]], "در رکورد: فرستادن پاسخ یا ثبت یادداشت داخلی"],
  [[["@"]], "در یادداشت: نام بردن از همکار"],
];

const DATE_INPUTS = ["۱۴۰۵/۰۲/۱۵ یا ۱۴۰۵۰۲۱۵", "۲/۱۵ (امسال)", "۱۵ (همین ماه)", "امروز، دیروز، فردا"];

const FONTS: { name: string; role: string; by: string; file: string; latin?: boolean }[] = [
  { name: "آراد", role: "متن و عنوان‌ها", by: "محمد درویشی · The Arad Project Authors", file: "OFL-Arad.txt" },
  { name: "DS Num (برگرفته از وزیرمتن)", role: "همهٔ عددها", by: "The Vazirmatn Project Authors", file: "OFL-Vazirmatn.txt" },
  { name: "Geist و Geist Mono", role: "متن لاتین و کدها", by: "Vercel و basement.studio", file: "OFL-Geist.txt", latin: true },
];

const ROLE_ORDER: Role[] = ["owner", "admin", "member", "viewer"];

function Article({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <article id={id} className="blk-art" style={{ scrollMarginTop: 72 }}>
      <h2>{title}</h2>
      {children}
    </article>
  );
}

export default function Help() {
  const { org } = useOrg();
  const { meta } = useSession();
  const loc = useLocation();
  const to = (p: string) => `/${org.id}/${p}`;
  const desktop = meta?.mode === "desktop";

  // a link like /help#ai lands on its article
  useEffect(() => {
    if (!loc.hash) return;
    requestAnimationFrame(() => document.getElementById(loc.hash.slice(1))?.scrollIntoView({ block: "start" }));
  }, [loc.hash]);

  const toc: [string, string][] = [
    ["start", "شروع کار"],
    ["keys", "میانبرها و ورود تاریخ"],
    ["members", "اعضا و نقش‌ها"],
    ["access", "دسترسی به رکوردها"],
    ["sync", "نسخهٔ ویندوز و هم‌گامی"],
    ["ai", "هوش مصنوعی رایگان و محلی"],
    ["integrations", "وب‌هوک و API"],
    ["about", `دربارهٔ ${APP_NAME}`],
  ];

  return (
    <div>
      <PageHeader title="راهنما" subtitle={<span>{APP_NAME} <Version v={APP_VERSION} /></span>} />
      <div className="blk-help">
        <div className="blk-card">
          <Article id="start" title="شروع کار در چهار قدم">
            <ol className="blk-steps">
              <li>
                نام، لوگو و منطقهٔ زمانی سازمان: <Link className="ds-link" to={to("settings/org")}>تنظیمات سازمان</Link>
              </li>
              <li>
                همکاران را با ایمیل اضافه کنید و نقش هر کدام را تعیین کنید: <Link className="ds-link" to={to("settings/users")}>کاربران و دسترسی‌ها</Link>
              </li>
              <li>
                یک اتصال هوش مصنوعی بسازید (رایگان یا محلی، پایین‌تر): <Link className="ds-link" to={to("settings/ai")}>تنظیمات هوش مصنوعی</Link>
              </li>
              <li>برای کار بی‌اینترنت یا در شبکهٔ داخلی، برنامهٔ ویندوز را نصب کنید و به همین نسخه وصل کنید.</li>
            </ol>
          </Article>

          <Article id="keys" title="میانبرهای صفحه‌کلید">
            <div>
              {SHORTCUTS.map(([groups, d], i) => (
                <div key={i} className="blk-keyrow">
                  <span>
                    {groups.map((g, j) => (
                      <span key={j} className="inline-flex items-center gap-1.5">
                        {j ? <span>یا</span> : null}
                        <Keys k={g} />
                      </span>
                    ))}
                  </span>
                  <span>{d}</span>
                </div>
              ))}
            </div>
            <div className="blk-well mt-5">
              <div className="blk-f-l mb-1">نوشتن تاریخ</div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-[14px] leading-7">
                {DATE_INPUTS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="blk-f-h mt-1">ارقام فارسی و انگلیسی هر دو پذیرفته می‌شوند. میانبرها روی صفحه‌کلید فارسی هم کار می‌کنند.</div>
            </div>
          </Article>

          <Article id="members" title="اعضا و نقش‌ها">
            <ul>
              {ROLE_ORDER.map((r) => (
                <li key={r}>
                  <b>{ROLES[r].title}</b>: {ROLES[r].about}
                </li>
              ))}
              <li>مالک می‌تواند دسترسی هر عضو را بخش به بخش کم یا زیاد کند. زیر مالک، هیچ‌کس نقش و دسترسی خودش را عوض نمی‌کند و دسترسی‌ای بیشتر از دسترسی خودش نمی‌دهد.</li>
              <li>مدیر سامانه (سازندهٔ نخستین حساب) عضو سازمان‌ها نیست؛ فقط با «حالت پشتیبانی» زمان‌دار و ثبت‌شده در گزارش رویدادها وارد سازمانی می‌شود.</li>
            </ul>
          </Article>

          <Article id="access" title="دسترسی به رکوردها">
            <ul>
              <li>هر رکورد از آنِ درخواست‌دهنده، ذی‌نفع، ثبت‌کننده، کارشناس و پیگیری‌کنندگان آن است و آن‌ها همیشه آن را می‌بینند. نقش‌ها («تنظیمات ← سازمان و دسترسی ← نقش‌ها و مجوزها») می‌گویند هر کس در هر حوزه چه رکوردهای دیگری را می‌بیند و تغییر می‌دهد: مال خودش، گروه‌هایش، واحدش، واحد و زیرمجموعه‌ها، دامنه یا همه.</li>
              <li>مدیر یک واحد رکوردهای افراد واحد و زیرمجموعه‌ها را می‌بیند و مدیر مستقیم رکوردهای زیردستانش را؛ جانشینِ عضوی که خارج از دفتر است، رکوردهای ارجاع‌شده به او را.</li>
              <li>فضای کاری امن، گروه محدود و رکورد محرمانه را فقط اعضای خودشان (و افراد خود رکورد) می‌بینند، حتی اگر نقشی «همه» را ببیند. فیلدهای مالی، شخصی، داخلی، منابع انسانی و امنیتی فقط برای نقش‌هایی است که گروه آن فیلد را دارند.</li>
              <li>اگر کسی رکوردی را نمی‌بیند، در «بررسی دسترسی» علت را لایه‌به‌لایه ببینید. عضو بدون نقش، با دسترسی نقش عضویت خود کار می‌کند («حالت پیشین»).</li>
            </ul>
          </Article>

          <Article id="sync" title="نسخهٔ ویندوز و هم‌گامی با نسخهٔ وب">
            <ul>
              <li>نسخهٔ ویندوز بدون اینترنت کامل کار می‌کند؛ داده‌ها روی همان رایانه در پایگاه‌دادهٔ داخلی ذخیره می‌شوند.</li>
              <li>برای یکی شدن با نسخهٔ وب: در برنامهٔ ویندوز «تنظیمات ← نسخهٔ ویندوز» نشانی سایت و ایمیل و رمز حساب وب را بدهید و سازمان را انتخاب کنید. از آن پس هر تغییر در چند ثانیه به طرف دیگر می‌رسد و نبود اینترنت فقط هم‌گامی را عقب می‌اندازد.</li>
              <li>اگر یک رکورد هم‌زمان در دو جا ویرایش شود، آخرین ویرایش می‌ماند و در گزارش رویدادها دیده می‌شود.</li>
              <li>چند رایانه یا گوشی در یک دفتر: «حالت شبکه» در همان صفحه؛ بقیه با نشانی رایانهٔ اصلی به آن وصل می‌شوند.</li>
              <li>پشتیبان خودکار هر ۶ ساعت و کمی پس از هر بار باز کردن برنامه گرفته می‌شود؛ از همان صفحه پشتیبان بگیرید یا برگردانید.</li>
              {!desktop ? <li>فایل نصب ویندوز در صفحهٔ Releases مخزن GitHub برنامه است ({APP_NAME_EN}-Setup). آن را روی فلش هم می‌توانید ببرید و روی هر رایانه اجرا کنید.</li> : null}
            </ul>
          </Article>

          <Article id="ai" title="هوش مصنوعی رایگان و محلی">
            <ol className="blk-steps">
              <li>
                Gemini رایگان: با یک حساب Google در <bdi dir="ltr" className="ds-mono">aistudio.google.com</bdi> ← API Keys ← Create API key. AI Studio از اینترنت ایران باز نمی‌شود و Google استفاده را به کشورهای پشتیبانی‌شده محدود کرده است؛ پذیرفتن شرایطش با مالک سازمان است.
              </li>
              <li>
                {desktop ? "در نسخهٔ وب" : "در"} <Link className="ds-link" to={to("settings/ai")}>تنظیمات هوش مصنوعی</Link> ← «افزودن اتصال» ← «Gemini (Google AI Studio)». کلید را بچسبانید، «طرح رایگان سرویس» را روشن کنید و «ذخیره» را بزنید.
              </li>
              <li>مدل‌های رایگان به‌ترتیب گذاشته می‌شوند و هر کدام سقف روزانهٔ خودش را دارد. وقتی سهم یکی تمام شد، بعدی پاسخ می‌دهد.</li>
              <li>در طرح رایگان، Google از داده‌ها برای بهبود محصولاتش استفاده می‌کند؛ در «قابلیت‌ها و حریم خصوصی» گزینهٔ «پوشاندن اطلاعات شخصی» را نگه دارید.</li>
              <li>
                مدل محلی (بی‌اینترنت، داده از رایانه بیرون نمی‌رود): Ollama یا LM Studio را نصب کنید، یک مدل بگیرید (مثلاً <bdi dir="ltr" className="ds-mono">ollama pull qwen3:8b</bdi>) و اتصال «Ollama — مدل محلی» را بسازید.
              </li>
              <li>نسخهٔ ویندوز در ایران: Gemini از اینترنت ایران پاسخ نمی‌دهد. در «قابلیت‌ها و حریم خصوصی»، «استفاده از اتصال‌های نسخهٔ وب» را روشن کنید، یا از درگاه‌های ایرانی سازگار با OpenAI و مدل محلی کمک بگیرید.</li>
            </ol>
          </Article>

          <Article id="integrations" title="وب‌هوک و API">
            <ol className="blk-steps">
              <li>
                در نسخهٔ وب، <Link className="ds-link" to={to("settings/integrations")}>اتصال‌ها و API</Link> ← «وب‌هوک تازه». نشانی وب‌هوک و کلید امضا را رونوشت کنید (کلید فقط یک بار نشان داده می‌شود).
              </li>
              <li>
                سامانهٔ فرستنده رویداد را به‌صورت JSON با روش POST به همان نشانی می‌فرستد، با سرآیند <bdi dir="ltr" className="ds-mono">X-Signature</bdi> (HMAC-SHA256 بدنه با کلید، به شکل hex یا <bdi dir="ltr" className="ds-mono">sha256=…</bdi>) یا در صورت ناچاری <bdi dir="ltr" className="ds-mono">X-Webhook-Secret</bdi> (خود کلید، فقط روی HTTPS).
              </li>
              <li>
                موضوع رویداد از سرآیند <bdi dir="ltr" className="ds-mono">X-Topic</bdi> یا فیلد <bdi dir="ltr" className="ds-mono">topic</bdi>/<bdi dir="ltr" className="ds-mono">event</bdi>/<bdi dir="ltr" className="ds-mono">type</bdi> خوانده می‌شود و شناسهٔ رویداد از <bdi dir="ltr" className="ds-mono">X-Event-Id</bdi> یا <bdi dir="ltr" className="ds-mono">id</bdi>؛ ارسال دوباره با همان شناسه یک بار ثبت می‌شود.
              </li>
              <li>رویدادی که هنوز بخشی برای پردازشش نیست، «دریافت شد» می‌ماند و بعداً با «تلاش دوباره» پردازش می‌شود.</li>
              <li>
                برنامه‌های دیگر با «کلید API» و سرآیند <bdi dir="ltr" className="ds-mono">Authorization: Bearer sm_…</bdi> به <bdi dir="ltr" className="ds-mono">/api/v1</bdi> وصل می‌شوند؛ <bdi dir="ltr" className="ds-mono">GET /api/v1/ping</bdi> سازمان کلید را برمی‌گرداند.
              </li>
              <li>در برنامهٔ ویندوز وب‌هوک ساخته نمی‌شود: سامانهٔ فرستنده به یک نشانی اینترنتی نیاز دارد، پس آن را در نسخهٔ وب بسازید.</li>
            </ol>
          </Article>
        </div>

        <aside className="blk-toc">
          <nav className="blk-card py-2" aria-label="فهرست راهنما">
            {toc.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="blk-toc-a" onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); history.replaceState(null, "", `#${id}`); }}>
                {label}
              </a>
            ))}
          </nav>

          <section id="about" className="blk-card overflow-hidden" style={{ scrollMarginTop: 72 }}>
            <div className="blk-about-h">
              <BrandTile size={44} />
              <div>
                <Wordmark size={24} tone="white" />
                <small>{APP_TAGLINE}</small>
              </div>
            </div>
            <div className="blk-card-b">
              <dl className="blk-dl" style={{ ["--cols" as string]: 2 }}>
                <div>
                  <dt>نسخه</dt>
                  <dd><Version v={APP_VERSION} /></dd>
                </div>
                <div>
                  <dt>اجرا</dt>
                  <dd>{desktop ? "برنامهٔ ویندوز" : "نسخهٔ وب"}</dd>
                </div>
                <div className="is-wide">
                  <dt>نام لاتین</dt>
                  <dd><bdi dir="ltr" className="ds-latin" style={{ fontWeight: 600, letterSpacing: "-.025em" }}>{APP_NAME_EN}</bdi></dd>
                </div>
              </dl>
              <div className="blk-sheet-sec" style={{ marginBlockStart: 20 }}>قلم‌ها</div>
              <div>
                {FONTS.map((f) => (
                  <div key={f.file} className="blk-lic">
                    <span className="min-w-0">
                      <b className="block">{f.name}</b>
                      <span className="block blk-3" style={{ fontSize: 12 }}>{f.role}</span>
                      <span className="block blk-3" style={{ fontSize: 12 }}>
                        {f.latin ? f.by : <bdi dir="ltr" className="ds-latin">{f.by}</bdi>}
                      </span>
                    </span>
                    <span className="ds-end">
                      <a className="blk-lnk" href={`/fonts/ds/${f.file}`} target="_blank" rel="noreferrer">
                        <bdi dir="ltr" className="ds-latin">SIL OFL 1.1</bdi>
                      </a>
                    </span>
                  </div>
                ))}
              </div>
              <div className="blk-f-h mt-3">هر سه قلم آزاد و متن‌باز با «پروانهٔ قلم آزاد SIL»، نسخهٔ ۱٫۱ منتشر شده‌اند و متن کامل پروانه همراه برنامه است.</div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
