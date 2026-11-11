# دستورالعمل نصب «کاریز» در بانک — ویندوز سرور، شبکهٔ داخلی، بدون اینترنت

این دستورالعمل برای تیم فناوری اطلاعات بانک است و گام‌به‌گام همان کاری را می‌گوید که شبیه‌سازی خودکار نصب بانک (CI، کار `bank-sim`) روی یک ویندوز سرور بی‌اینترنت انجام داد و گذراند؛ نتیجه، زمان‌ها و محدودیت‌های آن شبیه‌سازی در [qa/BANK_SIM_FA.md](qa/BANK_SIM_FA.md) است. جزئیات هر بخش در دو راهنمای اصلی آمده و این‌جا فقط ترتیب کار و فرمان‌هاست:

- [SERVER_FA.md](SERVER_FA.md) — نسخهٔ سرور: اندازهٔ سخت‌افزار، ویژگی‌های MSI، گواهی، دیوارهٔ آتش، راه‌اندازی نخست، فهرست مجاز، پشتیبان، ارتقا، پایش، امن‌سازی، `kariz.json` و `karizctl`.
- [AD_FA.md](AD_FA.md) — Active Directory: حساب خدمت، گروه‌ها، LDAPS، نگاشت نقش‌ها، ورود خودکار ویندوز (SSO)، GPO مرورگرها.

نام‌های نمونه: سرور `KARIZ-SRV01` با نشانی `10.20.30.40`، نام سامانه `kariz.bank.local`، کنترل‌کنندهٔ دامنه `dc1.bank.local`، رلهٔ ایمیل `smtp.bank.local`، دامنهٔ `CORP` (`corp.bank.local`). همه را با نام‌های بانک عوض کنید.

---

## ۱. پیش‌نیازها (پیش از روز نصب)

### ۱-۱. سرور

| | حداقل (آزمایشی، تا ۳۰۰ کاربر هم‌زمان) | پیشنهاد بانک (تا ۲٬۰۰۰ کاربر هم‌زمان) |
|---|---|---|
| ویندوز | Windows Server 2019، 2022 یا 2025 (۶۴ بیتی، x64)، به‌روز، عضو دامنه | همان |
| پردازنده | ۴ vCPU | ۱۶ vCPU |
| حافظه | ۱۶ گیگابایت | ۶۴ گیگابایت |
| دیسک داده | ۱۰۰ گیگابایت SSD (درایو جدا، مثلاً `D:`) | ۵۰۰ گیگابایت NVMe |
| پشتیبان | پوشهٔ اشتراکی روی سرور دیگر (`\\backup01\kariz`) | همان، با نگه‌داری بیرون از مرکز داده |

جدول کامل اندازه‌ها و تنظیم خودکار PostgreSQL: [SERVER_FA.md](SERVER_FA.md) بخش ۳. شبیه‌سازی روی ۴ پردازنده و ۱۶ گیگابایت (Windows Server 2025) اجرا شد.

- PowerShell باید اسکریپت محلی اجرا کند: اگر سیاست گروهی «Turn on Script Execution» روی `AllSigned` یا خاموش است، برای این سرور `RemoteSigned` بگذارید (MSI پیش از کپی فایل‌ها همین را می‌سنجد).
- ضدویروس: پوشه‌های `C:\Program Files\Kariz` و پوشهٔ داده را از «Controlled Folder Access» مستثنا کنید؛ پوشهٔ `db` (فایل‌های PostgreSQL) را از اسکن هم‌زمان مستثنا کنید (سفارش خود PostgreSQL). پیوست‌ها جدا با ضدویروس سامانه اسکن می‌شوند ([SERVER_FA.md](SERVER_FA.md) بخش ۲۰، `antivirus`).
- درگاه ۸۰ را چه کسی گرفته؟ `netsh http show servicestate` و `Get-NetTCPConnection -State Listen -LocalPort 80,443`. اگر IIS یا سرویس دیگری ویندوز (HTTP.sys، «System») آن‌ها را گرفته است، نسخهٔ ۱٫۱ خودش درگاه آزاد بعدی را برمی‌دارد (۸۰۸۰ / ۸۴۴۳)؛ اگر نشانی باید بی‌درگاه (`https://kariz.bank.local`) باشد، ۴۴۳ را آزاد نگه دارید.

### ۱-۲. نام DNS

در DNS داخلی رکورد `A` بسازید: `kariz.bank.local` ← `10.20.30.40`. از یک رایانهٔ شعبه بیازمایید: `Resolve-DnsName kariz.bank.local`.

### ۱-۳. گواهی از CA بانک (با درخواست CSR روی خود سرور)

کلید خصوصی روی همین سرور ساخته می‌شود و هرگز جای دیگری نمی‌رود. روی سرور، در PowerShell با «Run as administrator»:

```powershell
New-Item -ItemType Directory -Force C:\certs | Out-Null
@'
[Version]
Signature="$Windows NT$"
[NewRequest]
Subject = "CN=kariz.bank.local, O=Bank, C=IR"
KeyAlgorithm = RSA
KeyLength = 2048
HashAlgorithm = sha256
Exportable = TRUE
MachineKeySet = TRUE
RequestType = PKCS10
KeyUsage = 0xa0
[EnhancedKeyUsageExtension]
OID = 1.3.6.1.5.5.7.3.1
[Extensions]
2.5.29.17 = "{text}"
_continue_ = "dns=kariz.bank.local&"
_continue_ = "ipaddress=10.20.30.40"
'@ | Set-Content C:\certs\kariz.inf -Encoding ASCII
certreq -new C:\certs\kariz.inf C:\certs\kariz.csr
```

`kariz.csr` را برای تیم CA بفرستید (الگوی «Web Server»؛ اگر AD CS در دسترس است: `certreq -submit -attrib "CertificateTemplate:WebServer" C:\certs\kariz.csr C:\certs\kariz.cer`). گواهی صادرشده را بپذیرید و با زنجیره‌اش به PFX با گذرواژه صادر کنید:

```powershell
certreq -accept C:\certs\kariz.cer
$c = Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.Subject -like 'CN=kariz.bank.local*' } | Sort-Object NotAfter -Descending | Select-Object -First 1
Export-PfxCertificate -Cert $c -FilePath C:\certs\kariz.pfx -Password (Read-Host -AsSecureString 'PFX password') -ChainOption BuildChain
```

- نام سامانه باید در **Subject Alternative Name** باشد (نه فقط CN). IP در SAN اختیاری است.
- ریشهٔ CA بانک باید در «Trusted Root Certification Authorities» همهٔ رایانه‌ها **و خود این سرور** نصب باشد (معمولاً با GPO). بیازمایید: `certutil -verify C:\certs\kariz.cer` باید «Leaf certificate revocation check passed» یا دست‌کم زنجیرهٔ کامل تا ریشه را نشان دهد.
- این PFX در شبیه‌سازی دقیقاً همین‌گونه (PowerShell، `-ChainOption BuildChain`) ساخته و پذیرفته شد.

### ۱-۴. دیوارهٔ آتش شبکه

| جهت | از ← به | درگاه | کاربرد |
|---|---|---|---|
| ورودی | رایانه‌های کارکنان و شعبه‌ها ← سرور | TCP 443 | سامانه (HTTPS) |
| ورودی (اختیاری) | همان ← سرور | TCP 80 | فقط انتقال به HTTPS؛ یا با `HTTPPORT=0` بسته |
| خروجی | سرور ← کنترل‌کننده‌های دامنه | TCP 636 (LDAPS) یا 389 (StartTLS) | ورود و همگام‌سازی AD |
| خروجی | سرور ← رلهٔ ایمیل | TCP 25 یا 587 | اعلان‌ها |
| خروجی | سرور ← DNS داخلی | UDP/TCP 53 | نام‌ها |
| خروجی (اختیاری) | سرور ← سرور پشتیبان | TCP 445 | `\\backup01\kariz` |
| خروجی (اختیاری) | سرور ← سرور مدل هوش مصنوعی | درگاه آن سرور | Ollama / vLLM |

**هیچ** دسترسی دیگری لازم نیست — نه اینترنت، نه به‌روزرسانی، نه مجوز، نه سرور تلهمتری. شبیه‌سازی همهٔ ترافیک خروجی را جز شبکهٔ داخلی بست و ثابت کرد هیچ فرایند سامانه (Node.js، PostgreSQL، سرویس‌ها) حتی تلاشی برای اتصال به بیرون نکرد. PostgreSQL فقط روی `127.0.0.1` گوش می‌دهد؛ درگاه آن را باز نکنید.

### ۱-۵. Active Directory

طبق [AD_FA.md](AD_FA.md) بخش ۱ و ۲: حساب خدمت فقط‌خواندنی (`svc-kariz-ldap`)، گروه‌های `Kariz-Agents` (و زیرگروه‌ها)، `Kariz-Admins`، `Kariz-Auditors`؛ LDAPS روی کنترل‌کننده‌ها با گواهی از همان CA بانک؛ فایل Base-64 ریشهٔ CA (`bank-root-ca.cer`) آماده برای چسباندن در منبع. از سرور بیازمایید: `Test-NetConnection dc1.bank.local -Port 636`.

### ۱-۶. رلهٔ ایمیل

در Exchange (یا رلهٔ SMTP بانک) یک Receive Connector بسازید که فقط از نشانی سرور (`10.20.30.40`) پیام بپذیرد و relay کند؛ نشانی فرستنده مثلاً `kariz@bank.local`. **STARTTLS روی ۵۸۷ با گواهی CA بانک توصیه می‌شود**: از نسخهٔ ۱٫۱ سرویس سامانه به CAهای ویندوز اعتماد می‌کند و بی‌تنظیم دیگری کار می‌کند (نسخهٔ ۱٫۰ نمی‌کرد؛ [SERVER_FA.md](SERVER_FA.md) بخش ۱۱). از سرور بیازمایید: `Test-NetConnection smtp.bank.local -Port 587`.

---

## ۲. آوردن فایل نصب به سرور بی‌اینترنت

۱. `Kariz-Server-<نسخه>.msi` را از صفحهٔ Releases (روی رایانه‌ای که اینترنت دارد) بگیرید و چکیدهٔ SHA-256 آن را با چکیدهٔ صفحهٔ انتشار مقایسه کنید.
۲. با روال انتقال امن بانک (رسانهٔ اسکن‌شده) روی سرور، مثلاً در `C:\Install`، بگذارید و دوباره بسنجید:

```powershell
Get-FileHash C:\Install\Kariz-Server-1.1.0.msi -Algorithm SHA256
Unblock-File C:\Install\Kariz-Server-1.1.0.msi
```

همه‌چیز (Node.js، PostgreSQL ۱۷، pgvector، WinSW، محیط اجرای Visual C++) درون MSI است؛ هیچ دانلودی هنگام نصب انجام نمی‌شود.

---

## ۳. نصب

از Command Prompt یا PowerShell با «Run as administrator» (گذرواژهٔ PFX فقط در همین خط می‌آید و در هیچ گزارشی نوشته نمی‌شود):

```
msiexec /i C:\Install\Kariz-Server-1.1.0.msi /qn /l*v C:\Install\kariz-install.log HOSTNAME=kariz.bank.local DATADIR=D:\Kariz CERTPATH=C:\certs\kariz.pfx CERTPASSWORD=********
```

- درگاه‌ها را ندهید تا خودکار انتخاب شوند (۴۴۳ و ۸۰، یا اگر گرفته‌اند ۸۴۴۳ / ۸۰۸۰)؛ نشانی نهایی در `D:\Kariz\setup-url.txt` و در رویداد ۱۰۰۰ گزارش Application (منبع `Kariz`) است.
- اگر نصب شکست خورد: دلیل در `D:\Kariz\logs\install-error.txt` و رویداد ۱۰۰۱ است ([SERVER_FA.md](SERVER_FA.md) بخش ۵ و ۱۸).
- پس از نصب، PFX را از `C:\certs` به جای امن ببرید یا پاک کنید (نسخهٔ نصب‌شده در `D:\Kariz\tls` است و فقط مدیران، SYSTEM و حساب سرویس به آن دسترسی دارند).

بلافاصله بسنجید:

```powershell
karizctl status
Get-CimInstance Win32_Service -Filter "Name like 'Kariz%'" | Select-Object Name, State, StartName
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 443,80,8443,8080,5432
```

انتظار: `KarizDB` و `KarizApp` با حساب‌های `NT SERVICE\KarizDB` و `NT SERVICE\KarizApp` در حال اجرا؛ PostgreSQL فقط روی `127.0.0.1`.

---

## ۴. راه‌اندازی نخست

۱. روی خود سرور (یا رایانهٔ مدیر) `D:\Kariz\setup-url.txt` را بخوانید (فقط مدیران) و نشانی را در مرورگر باز کنید. نباید هیچ هشدار گواهی ببینید؛ اگر دیدید، ریشهٔ CA روی آن رایانه نصب نیست یا نام سامانه در SAN گواهی نیست.
۲. گام‌ها ([SERVER_FA.md](SERVER_FA.md) بخش ۸): سازمان و مدیر (حساب اضطراری)، نشانی و گواهی (گواهی بانک باید «گواهی کنونی» نشان داده شود)، ایمیل (`smtp.bank.local`، درگاه ۵۸۷، STARTTLS، فرستنده `kariz@bank.local`) و در «میزبان‌های مجاز دیگر» نام کنترل‌کننده‌های دامنه (`dc1.bank.local dc2.bank.local`)، پوشهٔ پشتیبان (`\\backup01\kariz`).
۳. **کد بازیابی** را در گاوصندوق نگه دارید.
۴. نشانی راه‌اندازی یک‌بارمصرف است؛ پس از پایان کار نمی‌کند و `setup-url.txt` پاک می‌شود.

پیش‌فرض‌های ماژول‌ها (کاتالوگ، پایگاه‌های دانش، تقویم‌ها) از ۱٫۱ بلافاصله ساخته می‌شوند.

---

## ۵. Active Directory و ورود یکپارچه

۱. اگر کنترل‌کننده‌ها را در راه‌اندازی نخست به فهرست مجاز نیفزودید: `karizctl allow add dc1.bank.local` (و هر کنترل‌کنندهٔ دیگر).
۲. «یکپارچه‌سازی ← فهرست کاربران (LDAP و SCIM)» ← منبع LDAP، با جدول [AD_FA.md](AD_FA.md) بخش ۳: `ldaps://dc1.bank.local:636`، رمزنگاری LDAPS، **گواهی ریشهٔ سازمان** (متن PEM فایل `bank-root-ca.cer`)، حساب خدمت، ریشهٔ جست‌وجو، دامنه‌ها (`CORP`، `corp.bank.local`)، نگاشت `Kariz-Agents` ← نقش `agent` و گروه میز خدمت.
۳. «آزمایش اتصال» ← «آزمایش ورود» با نام یک کارشناس ← «تأیید منبع با دسترسی من» (هویت دوباره پرسیده می‌شود) ← روشن کردن «ورود با حساب سازمانی».
۴. از یک رایانهٔ شعبه با `CORP\<نام>` و گذرواژهٔ دامنه وارد شوید و ببینید نقش درست را گرفته است. از این پس صفحهٔ ورود با «حساب سازمانی» باز می‌شود؛ حساب اضطراری مدیر و اعضایی که با دست ساخته شده‌اند زبانهٔ «ایمیل و رمز عبور» را برمی‌گزینند (شبیه‌سازی هر دو راه را سنجید).
۵. ورود خودکار ویندوز (Kerberos/SSO): [AD_FA.md](AD_FA.md) بخش ۵ (SPN، GPO مرورگرها). این بخش در شبیه‌سازی آزموده نشد (دامنهٔ واقعی لازم دارد).
۶. سیاست نشست و حساب‌های اضطراری: [AD_FA.md](AD_FA.md) بخش ۶.

---

## ۶. چک‌لیست وارسی پس از نصب

هر بند را تیک بزنید؛ همهٔ این‌ها در شبیه‌سازی خودکار سنجیده شد.

- [ ] `karizctl status`: هر دو سرویس روشن، آمادگی «ok»، نسخهٔ درست، گواهی بانک با تاریخ انقضا.
- [ ] از رایانهٔ شعبه: `https://kariz.bank.local` بی‌هشدار باز می‌شود؛ `http://kariz.bank.local` به HTTPS می‌رود.
- [ ] TLS: فقط ۱٫۲ و ۱٫۳ (برای نمونه با `Test-NetConnection` یا ابزار اسکن امنیتی بانک)؛ سرآیند HSTS هست.
- [ ] PostgreSQL از شبکه در دسترس نیست: از رایانهٔ دیگر `Test-NetConnection 10.20.30.40 -Port 5432` ناموفق.
- [ ] جز درگاه‌های پیکربندی‌شده هیچ درگاهی از فرایندهای سامانه باز نیست (`Get-NetTCPConnection -State Listen`).
- [ ] دسترسی پوشهٔ داده (`icacls D:\Kariz`): فقط Administrators، SYSTEM و حساب‌های سرویس؛ هیچ «Users»، «Everyone» یا «Authenticated Users». `kariz-admin.json` فقط Administrators و SYSTEM.
- [ ] پوشهٔ برنامه (`icacls "C:\Program Files\Kariz"`) برای Users فقط خواندنی است.
- [ ] یک رخداد با پیوست بسازید و به یک کارشناس ارجاع دهید: ایمیل اعلان می‌رسد («گزارش ارسال»: «ارسال‌شده»).
- [ ] ورود با حساب AD کار می‌کند و نقش‌ها درست‌اند؛ گذرواژهٔ غلط رد می‌شود.
- [ ] «مدیریت سامانه ← سلامت سرور»: همهٔ بررسی‌ها سبز، «تلاش‌های ردشدهٔ خروجی» خالی.
- [ ] `karizctl backup` موفق و «بررسی‌شده»؛ پوشهٔ پشتیبان روی سرور دیگر.
- [ ] `karizctl diagnostics` بسته‌ای بدون رمز می‌سازد (برای پشتیبانی).

---

## ۷. پشتیبان‌گیری و بازیابی (DR)

- پشتیبان خودکار هر شب ۰۱:۳۰ (`backup.time`)، ۱۴ نسخه (`backup.keep`)، به `backup.dir`؛ حساب `NT SERVICE\KarizApp` روی سرور دیگر به‌صورت `CORP\KARIZ-SRV01$` دیده می‌شود و باید اجازهٔ نوشتن داشته باشد.
- پشتیبان دستی پیش از هر تغییر مهم: `karizctl backup`؛ فهرست: `karizctl backups`.
- **تمرین بازیابی هر فصل** روی سرور آزمایشی (یا همین سرور در پنجرهٔ نگهداری):

```
karizctl restore D:\Kariz\backups\itsm-manual-20261110-220000 --yes
```

بازگردانی نخست یک پشتیبان ایمنی می‌گیرد، سرویس برنامه را می‌بندد، پایگاه داده را در پایگاه تازه‌ای بازمی‌گرداند و جایگزین می‌کند (پایگاه پیشین با نام `kariz_before_restore_<زمان>` می‌ماند)، پیوست‌ها را برمی‌گرداند و سرویس را روشن می‌کند. پشتیبان نسخهٔ قدیم‌تر روی نسخهٔ تازه هم بازمی‌گردد و ساختار پایگاه داده خودکار به‌روز می‌شود (شبیه‌سازی پشتیبان ۱٫۰ را روی ۱٫۱ بازگرداند).

- **RPO** (دادهٔ ازدست‌رفته) = زمان از آخرین پشتیبان؛ با پشتیبان شبانه تا ۲۴ ساعت. اگر کمتر می‌خواهید، پشتیبان دستی را با زمان‌بند ویندوز چند بار در روز بگیرید (`install.ps1 -RegisterBackupTask` یا وظیفهٔ خودتان با `karizctl backup`).
- **RTO** (زمان بازگشت): در شبیه‌سازی با دادهٔ کم (پشتیبان ۳ مگابایتی) ۹ ثانیه فرمان و ۱۶ ثانیه تا آمادگی و وارسی بود ([qa/BANK_SIM_FA.md](qa/BANK_SIM_FA.md) سناریوی ۱۱)؛ با دادهٔ واقعی بانک چند برابر است: آن را در تمرین فصلی بسنجید و ثبت کنید.
- **کلید رمزنگاری را جدا نگه دارید.** پشتیبان، پایگاه داده و پیوست‌هاست؛ رمزهای ذخیره‌شده در آن (گذرواژهٔ SMTP، حساب خدمت AD، کلیدهای هوش مصنوعی و وب‌هوک‌ها) با کلید `secret` فایل `D:\Kariz\kariz.json` قفل شده‌اند و این کلید عمداً درون پشتیبان نیست. پس از نصب (و پس از هر تغییر گذرواژه‌های پایگاه داده) یک نسخه از `kariz.json` و `kariz-admin.json` را در گاوصندوق رمزهای بانک بگذارید، نه کنار پشتیبان‌ها.
- **خرابی کامل سرور:** ویندوز تازه ← همین نصب (بخش ۳، با همان `HOSTNAME` و گواهی) ← راه‌اندازی نخست را **انجام ندهید** ← سرویس‌ها را ببندید (`karizctl stop`)، مقدار `secret` را از نسخهٔ گاوصندوق در `kariz.json` تازه بگذارید ← پوشهٔ پشتیبان را از سرور پشتیبان کپی کنید و `karizctl restore <پوشه> --yes` ← `karizctl status` و چک‌لیست بخش ۶. اگر کلید را برنگردانید، `karizctl restore` هشدار می‌دهد که رمزهای ذخیره‌شده باز نمی‌شوند؛ آن‌گاه گذرواژه‌های SMTP و AD و کلیدهای دیگر را در تنظیمات دوباره وارد کنید.
---

## ۸. ارتقا

۱. پشتیبان دستی و یادداشت نسخهٔ فعلی (`karizctl status`).
۲. MSI تازه را مانند بخش ۲ بیاورید و بسنجید.
۳. در پنجرهٔ نگهداری، **بدون هیچ ویژگی**:

```
msiexec /i C:\Install\Kariz-Server-1.1.0.msi /qn /l*v C:\Install\kariz-upgrade.log
```

نصب‌کننده پشتیبان ایمنی (`itsm-pre-upgrade-<زمان>`) می‌گیرد، فایل‌ها را جایگزین می‌کند، ساختار پایگاه داده را به‌روز می‌کند و سرویس‌ها را روشن می‌کند. درگاه‌ها، گواهی، نشانی، فهرست مجاز، پوشهٔ داده و همهٔ تنظیمات می‌مانند (شبیه‌سازی ارتقای ۱٫۰ به ۱٫۱ همین را سنجید).
۴. پس از ارتقا: `karizctl status` (نسخهٔ تازه)، ورود یک کارشناس و یک کاربر AD، یک رخداد آزمایشی، «سلامت سرور». قاعدهٔ دیوارهٔ آتش از نو ساخته می‌شود: اگر آن را به Domain محدود کرده بودید، دوباره محدود کنید.
۵. بازگشت در صورت مشکل: [SERVER_FA.md](SERVER_FA.md) بخش ۱۴.

---

## ۹. حذف

```
msiexec /x C:\Install\Kariz-Server-1.1.0.msi /qn                (داده‌ها می‌مانند؛ نصب دوباره همه را برمی‌گرداند)
msiexec /x C:\Install\Kariz-Server-1.1.0.msi /qn REMOVEDATA=1   (داده‌ها هم پاک می‌شوند)
```

پیش از `REMOVEDATA=1` یک پشتیبان بیرون از سرور داشته باشید. آنچه می‌ماند: [SERVER_FA.md](SERVER_FA.md) بخش ۱۹.

---

## ۱۰. عیب‌یابی

| نشانه | علت و کار |
|---|---|
| نصب با `port 80 is already used by System` متوقف شد (نسخهٔ ۱٫۰) | HTTP.sys ویندوز درگاه ۸۰ را گرفته (`netsh http show servicestate`)؛ نسخهٔ ۱٫۱ خودش ۸۰۸۰ را برمی‌دارد؛ در ۱٫۰ `HTTPPORT=8080` بدهید |
| مرورگر هشدار گواهی می‌دهد | ریشهٔ CA بانک روی آن رایانه نیست، یا نام سامانه در SAN گواهی نیست، یا گواهی خودامضای موقت هنوز به کار است (`karizctl status`؛ `karizctl rotate-cert --pfx … --password …`) |
| ایمیل نمی‌رسد؛ «گزارش ارسال»: `self-signed certificate in certificate chain` | سرور به گواهی رله اعتماد ندارد: ریشهٔ CA بانک را در «Trusted Root Certification Authorities» خود سرور نصب کنید و `karizctl restart` (نسخهٔ ۱٫۱)؛ در ۱٫۰ درگاه ۲۵ بدون رمزنگاری یا ارتقا |
| ایمیل نمی‌رسد؛ «دسترسی به … در حالت شبکهٔ بسته مجاز نیست» | `karizctl allow add smtp.bank.local` |
| «آزمایش اتصال» AD: نام میزبان و `karizctl allow add` | کنترل‌کننده در فهرست مجاز نیست |
| «آزمایش اتصال» AD: خطای گواهی | گواهی ریشه در منبع چسبانده نشده یا نام سرور در گواهی DC نیست ([AD_FA.md](AD_FA.md) بخش ۸) |
| کاتالوگ یا پایگاه دانش خالی است درست پس از راه‌اندازی (نسخهٔ ۱٫۰) | پیش‌فرض‌ها ده دقیقه بعد می‌آیند؛ «افزودن پیش‌فرض‌ها» همان صفحه |
| `KarizDB` را جدا متوقف کردید و سامانه باز نمی‌شود | `Restart-Service KarizDB -Force` سرویس وابستهٔ `KarizApp` را هم دوباره روشن می‌کند (در شبیه‌سازی سامانه ۶ ثانیه بعد آماده بود)، ولی `Stop-Service KarizDB -Force` و سپس `Start-Service KarizDB` برنامه را خاموش می‌گذارد؛ `Start-Service KarizApp` یا از اول `karizctl restart` |
| فرایند PostgreSQL از کار افتاد | سرویس `KarizDB` پس از ۱۰ ثانیه خودش دوباره روشن می‌شود و برنامه بی‌دخالت ادامه می‌دهد (در شبیه‌سازی سنجیده شد) |
| بقیه | [SERVER_FA.md](SERVER_FA.md) بخش ۱۸ و [AD_FA.md](AD_FA.md) بخش ۸؛ برای پشتیبانی `karizctl diagnostics` |
