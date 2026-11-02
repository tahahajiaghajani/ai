// «راهنما»: getting started, keyboard shortcuts and the how-tos people ask about most.
import type { ReactNode } from "react";
import { Collapse } from "antd";
import { Link } from "react-router";
import { PageHeader } from "../../components/layout";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { faDigits } from "@shared/format";
import { APP_NAME, APP_VERSION } from "@shared/constants";

function Kbd({ children }: { children: ReactNode }) {
  return <span className="tz-kbd ltr">{children}</span>;
}

const SHORTCUTS: [ReactNode, string][] = [
  [<><Kbd>Ctrl</Kbd> + <Kbd>K</Kbd></>, "جستجوی سراسری: رفتن به هر صفحه، شخص یا کالا"],
  [<Kbd>Enter</Kbd>, "رفتن به خانه‌ی بعد در سند، فاکتور و دریافت و پرداخت"],
  [<Kbd>F2</Kbd>, "ثبت سند یا فاکتور"],
  [<><Kbd>Alt</Kbd> + <Kbd>F2</Kbd></>, "ثبت و شروع سند تازه (دریافت و پرداخت)"],
  [<><Kbd>Alt</Kbd> + <Kbd>N</Kbd></>, "ردیف تازه در سند حسابداری و فاکتور"],
  [<Kbd>F4</Kbd>, "رفتن به خانه‌ی اسکن بارکد در فاکتور"],
  [<><Kbd>+</Kbd> یا <Kbd>*</Kbd></>, "در خانه‌ی مبلغ: افزودن سه صفر (۲۵۰ ← ۲۵۰٬۰۰۰)"],
  [<Kbd>=</Kbd>, "در مبلغ سند حسابداری: مبلغی که سند را تراز می‌کند"],
  [<><Kbd>Alt</Kbd> + <Kbd>↑</Kbd> / <Kbd>↓</Kbd></>, "در خانه‌ی تاریخ: روز بعد / روز قبل"],
];

const DATE_INPUTS = ["۱۴۰۵/۰۲/۱۵ یا ۱۴۰۵۰۲۱۵", "۲/۱۵ (امسال)", "۱۵ (همین ماه)", "امروز، دیروز، فردا"];

export default function Help() {
  const { org } = useOrg();
  const { meta } = useSession();
  const to = (p: string) => `/${org.id}/${p}`;
  const desktop = meta?.mode === "desktop";

  const items = [
    {
      key: "start",
      label: "شروع کار در پنج قدم",
      children: (
        <ol className="list-decimal space-y-2 ps-5 leading-7">
          <li>
            اطلاعات کسب‌وکار، لوگو، نرخ مالیات و ماژول‌ها: <Link to={to("settings/org")}>تنظیمات کسب‌وکار</Link>
          </li>
          <li>
            تعریف‌ها: <Link to={to("parties")}>اشخاص</Link>، صندوق و بانک، کالاها یا اجناس طلا یا ارزها — یکی‌یکی، یا همه با هم از
            اکسل (دکمه‌ی <span className="font-medium">ورود از اکسل</span> بالای هر فهرست).
          </li>
          <li>
            مانده‌های اول دوره: یک <Link to={to("accounting/vouchers/new")}>سند حسابداری</Link> با نوع «افتتاحیه» (موجودی صندوق و
            بانک، طلب و بدهی اشخاص، سرمایه).
          </li>
          <li>کار روزانه: فاکتور، دریافت و پرداخت، چک، فروش طلا، معامله‌ی ارز و حواله — سند حسابداری هر کدام خودکار ثبت می‌شود.</li>
          <li>
            گزارش‌ها: <Link to={to("reports/trial-balance")}>تراز آزمایشی</Link>، دفتر کل و معین، مانده‌ی اشخاص، سود و زیان و
            ترازنامه؛ همه با خروجی اکسل و چاپ.
          </li>
        </ol>
      ),
    },
    {
      key: "keys",
      label: "میانبرهای صفحه‌کلید و ورود تاریخ",
      children: (
        <div className="grid gap-6 md:grid-cols-[1fr_260px]">
          <table className="w-full text-sm">
            <tbody>
              {SHORTCUTS.map(([k, d], i) => (
                <tr key={i} className="border-b border-[var(--tz-line)] last:border-0">
                  <td className="w-44 py-2 whitespace-nowrap">{k}</td>
                  <td className="py-2">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="tz-soft p-3 text-sm leading-7">
            <div className="mb-1 font-semibold">نوشتن تاریخ</div>
            {DATE_INPUTS.map((d) => (
              <div key={d}>{d}</div>
            ))}
            <div className="text-muted mt-2 text-xs">ارقام فارسی و انگلیسی هر دو پذیرفته می‌شوند.</div>
          </div>
        </div>
      ),
    },
    {
      key: "import",
      label: "ورود اطلاعات از اکسل",
      children: (
        <ul className="list-disc space-y-2 ps-5 leading-7">
          <li>در فهرست اشخاص، کالاها، اجناس طلا، ارزها و… دکمه‌ی «ورود از اکسل» را بزنید. «فایل نمونه» ستون‌های قابل ورود را دارد.</li>
          <li>ردیف اول فایل عنوان ستون‌هاست؛ ستون‌ها خودکار با فیلدها جور می‌شوند و می‌توانید تغییرشان دهید.</li>
          <li>
            «بررسی بدون ثبت» همه‌ی ردیف‌ها را بدون ذخیره بررسی می‌کند. ردیف‌های خطادار وارد نمی‌شوند و «فایل خطاها» را برای اصلاح
            دریافت می‌کنید.
          </li>
          <li>
            مبالغ با ارقام فارسی و جداکننده، تاریخ شمسی، گزینه‌ها با همان عنوان برنامه (مثلاً «مشتری، تأمین‌کننده») و گروه و واحد با
            نام پذیرفته می‌شوند؛ گروه یا واحدی که وجود ندارد ساخته می‌شود.
          </li>
          <li>با تیک «اگر کد از قبل وجود داشت، به‌روزرسانی شود» می‌توانید قیمت‌ها را دسته‌جمعی از اکسل به‌روز کنید.</li>
        </ul>
      ),
    },
    {
      key: "sync",
      label: "نسخه‌ی ویندوز و هم‌گامی با نسخه‌ی وب",
      children: (
        <ul className="list-disc space-y-2 ps-5 leading-7">
          <li>نسخه‌ی ویندوز بدون اینترنت کامل کار می‌کند؛ داده‌ها روی همان رایانه در پایگاه‌داده‌ی داخلی ذخیره می‌شوند.</li>
          <li>
            برای یکی شدن با نسخه‌ی وب: در برنامه‌ی ویندوز «تنظیمات ← نسخه‌ی ویندوز» نشانی سایت و ایمیل و رمز حساب وب را بدهید و کسب‌وکار
            را انتخاب کنید. از آن پس هر تغییر در چند ثانیه به طرف دیگر می‌رسد و نبود اینترنت فقط هم‌گامی را عقب می‌اندازد.
          </li>
          <li>اگر یک سند هم‌زمان در دو جا ویرایش شود، آخرین ویرایش می‌ماند و در گزارش رویدادها دیده می‌شود.</li>
          <li>چند رایانه یا گوشی در یک فروشگاه: «حالت شبکه» در همان صفحه؛ بقیه با نشانی رایانه‌ی اصلی به آن وصل می‌شوند.</li>
          <li>پشتیبان خودکار هر ۶ ساعت و کمی پس از هر بار باز کردن برنامه گرفته می‌شود؛ از همان صفحه می‌توانید پشتیبان بگیرید یا برگردانید.</li>
          {!desktop ? (
            <li>
              فایل نصب ویندوز در صفحه‌ی Releases مخزن GitHub برنامه است (Siraf-Setup). آن را روی فلش هم می‌توانید ببرید و روی هر
              رایانه اجرا کنید.
            </li>
          ) : null}
        </ul>
      ),
    },
    {
      key: "shop",
      label: "اتصال به فروشگاه اینترنتی (ووکامرس، شاپیفای و سایت‌های دیگر)",
      children: (
        <ol className="list-decimal space-y-2 ps-5 leading-7">
          <li>
            در نسخه‌ی وب، <Link to={to("settings/integrations")}>اتصال به فروشگاه اینترنتی</Link> ← «اتصال تازه». نشانی Webhook و
            کلید را کپی کنید.
          </li>
          <li>
            ووکامرس: پیشخوان وردپرس ← ووکامرس ← پیکربندی ← پیشرفته ← Webhooks ← افزودن؛ موضوع «Order created» (و در صورت نیاز
            «Order updated»)، نشانی تحویل = نشانی Webhook، رمز = کلید.
          </li>
          <li>شاپیفای: Settings ← Notifications ← Webhooks؛ رویداد «Order creation» با قالب JSON و همان نشانی؛ کلید امضای شاپیفای را در سیراف وارد کنید.</li>
          <li>هر سفارش، فاکتور فروش می‌شود. مشتری با ایمیل یا موبایل پیدا یا ساخته می‌شود؛ کالا با SKU، بارکد، کد یا نام پیدا می‌شود و کالای ناشناخته به‌صورت «خدمت» ساخته می‌شود تا حسابدار بررسی کند.</li>
          <li>برنامه‌های دیگر می‌توانند با «کلید API» فهرست کالا و اشخاص را بخوانند و فاکتور ثبت کنند.</li>
        </ol>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="راهنما" subtitle={`${APP_NAME} ${faDigits(APP_VERSION)}`} />
      <div className="tz-card p-2 md:p-3">
        <Collapse ghost defaultActiveKey={["start", "keys"]} items={items} />
      </div>
    </div>
  );
}
