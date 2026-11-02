// «راهنما»: getting started, keyboard shortcuts, the how-tos people ask about most, and «دربارهٔ سیراف» (the version
// and the open-source font licences). Every page's explanations live here instead of on the page itself.
import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { PageHeader } from "../../components/layout";
import { Wordmark, SirafTile } from "../../components/brand";
import { APP_NAME, APP_NAME_EN, APP_TAGLINE, APP_VERSION } from "@shared/constants";
import { Keys, Version } from "../reports/kit";

const SHORTCUTS: [string[][], string][] = [
  [[["Ctrl", "K"]], "جست‌وجوی سراسری: هر صفحه، شخص، سند یا فرمان"],
  [[["Ctrl", "J"]], "باز و بسته کردن «دستیار سیراف»"],
  [[["Enter"]], "خانهٔ بعد در سند، فاکتور و دریافت و پرداخت"],
  [[["F2"], ["Ctrl", "Enter"]], "ثبت سند یا فاکتور"],
  [[["Alt", "F2"]], "ثبت و شروع سند تازه (دریافت و پرداخت)"],
  [[["Alt", "N"]], "ردیف تازه در سند و فاکتور؛ سند تازه در فهرست‌ها"],
  [[["↑"], ["↓"]], "در جدول سند: همان ستون در ردیف بالا یا پایین"],
  [[["="]], "در مبلغ سند حسابداری: مبلغی که سند را تراز می‌کند (Space در خانهٔ خالی هم)"],
  [[["Ctrl", "D"]], "در سند حسابداری: همان خانهٔ ردیف بالا"],
  [[["Ctrl", "Delete"]], "در سند حسابداری: حذف ردیف"],
  [[["F4"]], "خانهٔ اسکن بارکد در فاکتور"],
  [[["+"], ["*"]], "در خانهٔ مبلغ: سه صفر (۲۵۰ ← ۲۵۰٬۰۰۰)"],
  [[["Alt", "↑"], ["Alt", "↓"]], "در خانهٔ تاریخ: روز بعد یا روز قبل"],
];

const DATE_INPUTS = ["۱۴۰۵/۰۲/۱۵ یا ۱۴۰۵۰۲۱۵", "۲/۱۵ (امسال)", "۱۵ (همین ماه)", "امروز، دیروز، فردا"];

const FONTS: { name: string; role: string; by: string; file: string; latin?: boolean }[] = [
  { name: "وزیرمتن", role: "متن و ارقام", by: "The Vazirmatn Project Authors", file: "OFL-Vazirmatn.txt" },
  { name: "آراد", role: "عنوان‌ها و نام سیراف", by: "The Arad Project Authors", file: "OFL-Arad.txt" },
  { name: "Geist و Geist Mono", role: "متن لاتین و کدها", by: "Vercel و basement.studio", file: "OFL-Geist.txt", latin: true },
];

function Article({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <article id={id} className="bk-art" style={{ scrollMarginTop: 72 }}>
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

  // a link like /help#fiscal lands on its article
  useEffect(() => {
    if (!loc.hash) return;
    requestAnimationFrame(() => document.getElementById(loc.hash.slice(1))?.scrollIntoView({ block: "start" }));
  }, [loc.hash]);

  const toc: [string, string][] = [
    ["start", "شروع کار"],
    ["keys", "میانبرها و ورود تاریخ"],
    ["vouchers", "سند و تراز"],
    ["fiscal", "بستن سال مالی"],
    ["import", "ورود از اکسل"],
    ["sync", "نسخهٔ ویندوز و هم‌گامی"],
    ["shop", "فروشگاه اینترنتی"],
    ["about", `دربارهٔ ${APP_NAME}`],
  ];

  return (
    <div>
      <PageHeader title="راهنما" subtitle={<span>{APP_NAME} <Version v={APP_VERSION} /></span>} />
      <div className="bk-help">
        <div className="bk-card">
          <Article id="start" title="شروع کار در پنج قدم">
            <ol className="bk-steps">
              <li>
                اطلاعات کسب‌وکار، لوگو، نرخ مالیات و بخش‌ها: <Link className="sf-link" to={to("settings/org")}>تنظیمات کسب‌وکار</Link>
              </li>
              <li>
                تعریف‌ها: <Link className="sf-link" to={to("parties")}>اشخاص</Link>، صندوق و بانک، کالاها یا اجناس طلا یا ارزها؛ یکی‌یکی، یا همه با هم از اکسل (دکمهٔ «ورود از اکسل» بالای هر فهرست).
              </li>
              <li>
                مانده‌های اول دوره: یک <Link className="sf-link" to={to("accounting/vouchers/new")}>سند حسابداری</Link> با نوع «افتتاحیه» (موجودی صندوق و بانک، طلب و بدهی اشخاص، سرمایه).
              </li>
              <li>کار روزانه: فاکتور، دریافت و پرداخت، چک، فروش طلا، معاملهٔ ارز و حواله؛ سند حسابداری هر کدام خودکار ثبت می‌شود.</li>
              <li>
                گزارش‌ها: <Link className="sf-link" to={to("reports/trial-balance")}>تراز آزمایشی</Link>، دفتر کل و معین، ماندهٔ اشخاص، سود و زیان و ترازنامه؛ همه با خروجی اکسل و چاپ.
              </li>
            </ol>
          </Article>

          <Article id="keys" title="میانبرهای صفحه‌کلید">
            <div>
              {SHORTCUTS.map(([groups, d], i) => (
                <div key={i} className="bk-keyrow">
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
            <div className="bk-well mt-5">
              <div className="bk-f-l mb-1">نوشتن تاریخ</div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-[14px] leading-7">
                {DATE_INPUTS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="bk-f-h mt-1">ارقام فارسی و انگلیسی هر دو پذیرفته می‌شوند. میانبرها روی صفحه‌کلید فارسی هم کار می‌کنند.</div>
            </div>
          </Article>

          <Article id="vouchers" title="سند حسابداری و تراز">
            <ul>
              <li>هر ردیف سند یا بدهکار است یا بستانکار؛ با نوشتن در یکی، دیگری پاک می‌شود.</li>
              <li>تا جمع بدهکار و بستانکار برابر نشود، کنار «جمع» اختلاف را می‌بینید. وقتی برابر شد، سند «می‌نشیند»: خط جمع کامل می‌شود و «سند تراز است» می‌آید.</li>
              <li>«=» در خانهٔ مبلغ، همان مبلغی را می‌نویسد که سند را تراز می‌کند.</li>
              <li>اسناد خودکار (از فاکتور، دریافت و پرداخت، چک و…) فقط از سند مبدأشان تغییر می‌کنند.</li>
              <li>در گزارش‌ها مانده با ستون «تشخیص» (بد یا بس) می‌آید و منفی‌ها در صورت‌های مالی داخل پرانتز.</li>
            </ul>
          </Article>

          <Article id="fiscal" title="بستن سال مالی">
            <ul>
              <li>با بستن سال، حساب‌های درآمد و هزینه به «خلاصهٔ سود و زیان» بسته می‌شوند و سود یا زیان به «سود و زیان انباشته» می‌رود.</li>
              <li>سند اختتامیه صادر می‌شود و همان مانده‌ها، همراه با مبالغ ارزی و وزن طلا، با سند افتتاحیه به سال بعد منتقل می‌شوند.</li>
              <li>اسناد پیش‌نویس باید پیش از بستن ثبت یا حذف شوند.</li>
              <li>
                هر وقت لازم شد می‌توانید سال را دوباره باز کنید: <Link className="sf-link" to={to("accounting/fiscal-years")}>سال‌های مالی</Link>
              </li>
            </ul>
          </Article>

          <Article id="import" title="ورود اطلاعات از اکسل">
            <ul>
              <li>در فهرست اشخاص، کالاها، اجناس طلا، ارزها و… دکمهٔ «ورود از اکسل» را بزنید. «فایل نمونه» ستون‌های قابل ورود را دارد.</li>
              <li>ردیف اول فایل عنوان ستون‌هاست؛ ستون‌ها خودکار با فیلدها جور می‌شوند و می‌توانید تغییرشان دهید.</li>
              <li>«بررسی بدون ثبت» همهٔ ردیف‌ها را بدون ذخیره بررسی می‌کند. ردیف‌های خطادار وارد نمی‌شوند و «فایل خطاها» را برای اصلاح دریافت می‌کنید.</li>
              <li>مبالغ با ارقام فارسی و جداکننده، تاریخ شمسی، گزینه‌ها با همان عنوان برنامه (مثلاً «مشتری، تأمین‌کننده») و گروه و واحد با نام پذیرفته می‌شوند؛ گروه یا واحدی که وجود ندارد ساخته می‌شود.</li>
              <li>با تیک «اگر کد از قبل وجود داشت، به‌روزرسانی شود» قیمت‌ها را دسته‌جمعی از اکسل به‌روز کنید.</li>
            </ul>
          </Article>

          <Article id="sync" title="نسخهٔ ویندوز و هم‌گامی با نسخهٔ وب">
            <ul>
              <li>نسخهٔ ویندوز بدون اینترنت کامل کار می‌کند؛ داده‌ها روی همان رایانه در پایگاه‌دادهٔ داخلی ذخیره می‌شوند.</li>
              <li>برای یکی شدن با نسخهٔ وب: در برنامهٔ ویندوز «تنظیمات ← نسخهٔ ویندوز» نشانی سایت و ایمیل و رمز حساب وب را بدهید و کسب‌وکار را انتخاب کنید. از آن پس هر تغییر در چند ثانیه به طرف دیگر می‌رسد و نبود اینترنت فقط هم‌گامی را عقب می‌اندازد.</li>
              <li>اگر یک سند هم‌زمان در دو جا ویرایش شود، آخرین ویرایش می‌ماند و در گزارش رویدادها دیده می‌شود.</li>
              <li>چند رایانه یا گوشی در یک فروشگاه: «حالت شبکه» در همان صفحه؛ بقیه با نشانی رایانهٔ اصلی به آن وصل می‌شوند.</li>
              <li>پشتیبان خودکار هر ۶ ساعت و کمی پس از هر بار باز کردن برنامه گرفته می‌شود؛ از همان صفحه پشتیبان بگیرید یا برگردانید.</li>
              {!desktop ? <li>فایل نصب ویندوز در صفحهٔ Releases مخزن GitHub برنامه است (Siraf-Setup). آن را روی فلش هم می‌توانید ببرید و روی هر رایانه اجرا کنید.</li> : null}
            </ul>
          </Article>

          <Article id="shop" title="اتصال به فروشگاه اینترنتی">
            <ol className="bk-steps">
              <li>
                در نسخهٔ وب، <Link className="sf-link" to={to("settings/integrations")}>اتصال‌ها و API</Link> ← «اتصال تازه». نشانی Webhook و کلید را رونوشت کنید.
              </li>
              <li>ووکامرس: پیشخوان وردپرس ← ووکامرس ← پیکربندی ← پیشرفته ← Webhooks ← افزودن؛ موضوع «Order created» (و در صورت نیاز «Order updated»)، نشانی تحویل = نشانی Webhook، رمز = کلید، نسخهٔ API: WP REST API v3.</li>
              <li>شاپیفای: Settings ← Notifications ← Webhooks؛ رویداد «Order creation» با قالب JSON و همان نشانی؛ کلید امضای شاپیفای را هنگام ساخت اتصال در سیراف وارد کنید.</li>
              <li>
                سایت دیگر: سفارش را به‌صورت JSON با سرآیند <bdi dir="ltr" className="sf-mono">X-Taraz-Signature</bdi> (HMAC-SHA256 بدنه با کلید) یا <bdi dir="ltr" className="sf-mono">X-Taraz-Secret</bdi> بفرستید.
              </li>
              <li>در برنامهٔ ویندوز اتصال ساخته نمی‌شود: سایت سفارش را به یک نشانی اینترنتی می‌فرستد، پس اتصال را در نسخهٔ وب بسازید؛ فاکتورهای ساخته‌شده با هم‌گامی به برنامهٔ ویندوز هم می‌رسند.</li>
              <li>هر سفارش، فاکتور فروش می‌شود. مشتری با ایمیل یا همراه پیدا یا ساخته می‌شود؛ کالا با SKU، بارکد، کد یا نام پیدا می‌شود و کالای ناشناخته به‌صورت «خدمت» ساخته می‌شود تا حسابدار بررسی کند.</li>
              <li>برنامه‌های دیگر با «کلید API» فهرست کالا و اشخاص را می‌خوانند و فاکتور ثبت می‌کنند.</li>
            </ol>
          </Article>
        </div>

        <aside className="bk-toc">
          <nav className="bk-card py-2" aria-label="فهرست راهنما">
            {toc.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="bk-toc-a" onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); history.replaceState(null, "", `#${id}`); }}>
                {label}
              </a>
            ))}
          </nav>

          <section id="about" className="bk-card overflow-hidden" style={{ scrollMarginTop: 72 }}>
            <div className="bk-about-h">
              <SirafTile size={44} />
              <div>
                <Wordmark size={24} tone="white" />
                <small>{APP_TAGLINE}</small>
              </div>
            </div>
            <div className="bk-card-b">
              <dl className="bk-dl" style={{ ["--cols" as string]: 2 }}>
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
                  <dd><bdi dir="ltr" className="sf-latin" style={{ fontWeight: 600, letterSpacing: "-.025em" }}>{APP_NAME_EN}</bdi></dd>
                </div>
              </dl>
              <div className="bk-sheet-sec" style={{ marginBlockStart: 20 }}>قلم‌ها</div>
              <div>
                {FONTS.map((f) => (
                  <div key={f.file} className="bk-lic">
                    <span className="min-w-0">
                      <b className="block">{f.name}</b>
                      <span className="block bk-3" style={{ fontSize: 12 }}>{f.role}</span>
                      <span className="block bk-3" style={{ fontSize: 12 }}>
                        {f.latin ? f.by : <bdi dir="ltr" className="sf-latin">{f.by}</bdi>}
                      </span>
                    </span>
                    <span className="sf-end">
                      <a className="bk-lnk" href={`/fonts/siraf/${f.file}`} target="_blank" rel="noreferrer">
                        <bdi dir="ltr" className="sf-latin">SIL OFL 1.1</bdi>
                      </a>
                    </span>
                  </div>
                ))}
              </div>
              <div className="bk-f-h mt-3">هر سه قلم آزاد و متن‌باز با «پروانهٔ قلم آزاد SIL»، نسخهٔ ۱٫۱ منتشر شده‌اند و متن کامل پروانه همراه برنامه است.</div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
