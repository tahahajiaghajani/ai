/**
 * Track record from the company's official profile (software, consulting and training), shown on /records.
 * Each item carries both languages. Only verified entries belong here.
 */

type T = { fa: string; en: string };
export type RecordItem = { org: T; detail?: T[]; count?: number };
export type RecordGroup = { title: T; items: RecordItem[] };

const o = (fa: string, en: string): T => ({ fa, en });

export const SOFTWARE: RecordItem[] = [
  { org: o("بانک ملت", "Bank Mellat"), detail: [o("EPM برای مدیریت برنامه‌های عملیاتی ادارات ستادی", "EPM for headquarters' operational programs"), o("«سایمپ»: مدیریت درخواست‌ها و قراردادهای فناوری اطلاعات (معاونت فناوری اطلاعات)", "«Saymp»: IT request and contract management (IT deputy)")] },
  { org: o("بانک تجارت", "Bank Tejarat"), detail: [o("EPM برای معاونت فناوری اطلاعات، شرکت‌های هلدینگ تفتا و ادارات ستادی", "EPM for the IT deputy, Tafta holding companies and headquarters"), o("«سماپ»: مدیریت درخواست‌ها و قراردادهای فناوری اطلاعات (معاونت فناوری اطلاعات)", "«Samap»: IT request and contract management (IT deputy)")] },
  { org: o("بانک ملی ایران", "Bank Melli Iran"), detail: [o("EPM برای برنامه‌ریزی و کنترل پروژه‌های ادارات ستادی و معاونت فناوری اطلاعات", "EPM for planning and control of headquarters and IT deputy projects")] },
  { org: o("بانک رفاه کارگران", "Refah Kargaran Bank"), detail: [o("EPM برای برنامه‌ریزی و کنترل ادارات ستادی و معاونت فناوری اطلاعات", "EPM for planning and control of headquarters and the IT deputy"), o("سامانه‌ی ارزیابی عملکرد ادارات ستادی", "Headquarters performance evaluation system")] },
  { org: o("بانک سپه", "Bank Sepah"), detail: [o("EPM برای برنامه‌های عملیاتی ادارات ستادی", "EPM for headquarters' operational programs"), o("سامانه‌ی مدیریت برنامه‌های شعب و مناطق", "Branch and regional program management system")] },
  { org: o("بانک آینده", "Ayandeh Bank"), detail: [o("EPM برای شرکت‌های زیرمجموعه و ادارات ستادی", "EPM for subsidiaries and headquarters")] },
  { org: o("پست بانک", "Post Bank of Iran"), detail: [o("EPM برای ارزیابی برنامه‌های عملیاتی ادارات ستادی", "EPM for evaluating headquarters' operational programs")] },
  { org: o("بانک شهر", "Bank Shahr"), detail: [o("EPM برای ارزیابی برنامه‌های عملیاتی ادارات ستادی", "EPM for evaluating headquarters' operational programs")] },
  { org: o("قرارگاه خاتم‌الانبیاء – گروه تخصصی شهید رجائی", "Khatam al-Anbiya HQ – Shahid Rajaei Group"), detail: [o("EPM و EPPM برای پروژه‌های عمرانی و نفت و گاز", "EPM and EPPM for construction and oil & gas projects"), o("داشبورد عملکرد مالی پروژه‌ها", "Project financial performance dashboard")] },
  { org: o("شرکت مدیریت شبکه برق ایران", "Iran Grid Management Co. (IGMC)"), detail: [o("EPM برای ارزیابی برنامه‌های عملیاتی ادارات ستادی", "EPM for evaluating headquarters' operational programs")] },
  { org: o("شرکت علوم سبز", "Oloum Sabz"), detail: [o("EPM برای مدیریت پروژه‌ها", "EPM for project management"), o("سامانه‌ی مدیریت قراردادها", "Contract management system"), o("داشبورد تجمیعی وظایف، تایم‌شیت، منابع انسانی و ارزیابی عملکرد", "Integrated dashboard for tasks, timesheets, HR and performance evaluation")] },
  { org: o("شرکت صنایع بهساز ملت", "Behsaz Mellat Industries"), detail: [o("EPM برای ارزیابی برنامه‌های عملیاتی ادارات ستادی", "EPM for evaluating headquarters' operational programs")] },
  { org: o("هلدینگ بهسازان ملت", "Behsazan Mellat Holding"), detail: [o("داشبورد و گزارش پروژه‌ها و درخواست‌ها", "Project and request dashboards and reports")] },
  { org: o("شرکت مهندسی صنعتی فهامه", "Fahameh Industrial Engineering"), detail: [o("EPM برای پروژه‌های نظارت بانک صنعت و معدن (واحد نظارت)", "EPM for Bank of Industry and Mine supervision projects (supervision unit)"), o("سامانه‌ی مدیریت مستندات (واحد FS)", "Document management system (FS unit)")] },
  { org: o("شرکت مهندسی سیستم یاس ارغوانی", "Yas Arghavani Systems Engineering"), detail: [o("EPM برای ارزیابی برنامه‌های عملیاتی ادارات ستادی", "EPM for evaluating headquarters' operational programs")] },
  { org: o("بیمه تجارت نو", "Tejarat Now Insurance"), detail: [o("EPM برای ارزیابی برنامه‌های عملیاتی ادارات ستادی", "EPM for evaluating headquarters' operational programs")] },
  { org: o("شرکت ایز ایران", "Iz Iran"), detail: [o("EPM برای پروژه‌های فناوری اطلاعات", "EPM for IT projects")] },
  { org: o("ساپکو", "SAPCO"), detail: [o("EPM برای پروژه‌های صنعتی خودروسازی", "EPM for automotive industrial projects")] },
  { org: o("شرکت برازش صنعت", "Barazesh Sanat"), detail: [o("EPM برای برنامه‌ریزی و کنترل پروژه‌های صنعتی خودروسازی", "EPM for planning and control of automotive industrial projects")] },
  { org: o("شرکت زیست دارو درمان پارس", "Zist Daru Darman Pars"), detail: [o("EPM برای پروژه‌های دارویی", "EPM for pharmaceutical projects")] },
];

export const CONSULTING: RecordGroup[] = [
  {
    title: o("عارضه‌یابی سیستم مدیریت پروژه", "Project management system assessment"),
    items: [
      { org: o("بانک ملت", "Bank Mellat") },
      { org: o("پتروشیمی تبریز", "Tabriz Petrochemical") },
      { org: o("شرکت گاز خراسان شمالی", "North Khorasan Gas Co.") },
      { org: o("شرکت شهرک‌های صنعتی ایران", "Iran Industrial Estates Co.") },
      { org: o("پتروشیمی فجر ۲", "Fajr 2 Petrochemical") },
      { org: o("صنایع الکترونیک زعیم", "Zaeim Electronic Industries") },
      { org: o("آب و فاضلاب خراسان", "Khorasan Water & Wastewater") },
      { org: o("توزیع برق کرمان", "Kerman Power Distribution") },
    ],
  },
  {
    title: o("طراحی سیستم برنامه‌ریزی و کنترل پروژه", "Project planning & control system design"),
    items: [
      { org: o("بیمه پارسیان", "Parsian Insurance") },
      { org: o("مدیریت شبکه برق ایران", "Iran Grid Management Co.") },
      { org: o("پارس خودرو", "Pars Khodro") },
      { org: o("شرکت سپاسد", "Sepasad") },
      { org: o("بانک ملت (بر اساس استاندارد PMBOK)", "Bank Mellat (PMBOK-based)") },
      { org: o("قرارگاه خاتم‌الانبیاء – گروه تخصصی شهید رجائی", "Khatam al-Anbiya HQ – Shahid Rajaei Group") },
      { org: o("سازمان توسعه برق ایران", "Iran Power Development Co.") },
      { org: o("آب و فاضلاب مشهد", "Mashhad Water & Wastewater") },
      { org: o("توزیع برق فارس", "Fars Power Distribution") },
    ],
  },
];

export const TRAINING: RecordGroup[] = [
  {
    title: o("استاندارد مدیریت پروژه PMBOK", "PMBOK project management standard"),
    items: [
      { org: o("بانک ملت", "Bank Mellat"), count: 6 },
      { org: o("بانک ملی ایران", "Bank Melli Iran"), count: 6 },
      { org: o("قرارگاه خاتم‌الانبیاء – گروه تخصصی شهید رجائی", "Khatam al-Anbiya HQ – Shahid Rajaei Group"), count: 4 },
      { org: o("پست بانک", "Post Bank of Iran"), count: 4 },
      { org: o("شرکت ملی مناطق نفت‌خیز جنوب", "National Iranian South Oil Co. (NISOC)"), count: 4 },
      { org: o("بانک رفاه کارگران", "Refah Kargaran Bank"), count: 2 },
      { org: o("بانک سپه", "Bank Sepah"), count: 2 },
      { org: o("شرکت تعمیرات نیروگاهی", "Power plant repairs company"), count: 2 },
      { org: o("بانک تجارت", "Bank Tejarat"), count: 2 },
      { org: o("شرکت مپنا", "MAPNA") },
      { org: o("شرکت جهان کوثر", "Jahan Kowsar") },
      { org: o("مرکز تحقیقات سایپا", "SAIPA Research Center") },
      { org: o("شرکت پارس بنای صدر", "Pars Banaye Sadr") },
      { org: o("شرکت نفت و گاز پارس (POGC)", "Pars Oil & Gas Co. (POGC)") },
      { org: o("شرکت ملی پخش و پالایش", "National Iranian Oil Refining & Distribution Co.") },
      { org: o("پژوهشگاه صنایع هوایی", "Aviation Industries Research Institute") },
      { org: o("پتروشیمی فجر ۲", "Fajr 2 Petrochemical") },
      { org: o("پژوهشکده‌ی حمل و نقل وزارت راه", "Transportation Research Institute, Ministry of Roads") },
    ],
  },
  {
    title: o("نرم‌افزار مدیریت پروژه MSP", "MSP project management software"),
    items: [
      { org: o("بانک ملت", "Bank Mellat"), count: 6 },
      { org: o("پست بانک", "Post Bank of Iran"), count: 4 },
      { org: o("بانک رفاه کارگران", "Refah Kargaran Bank"), count: 3 },
      { org: o("بانک سپه", "Bank Sepah"), count: 2 },
      { org: o("بانک تجارت", "Bank Tejarat"), count: 1 },
      { org: o("شرکت سازه گستر سایپا", "Sazeh Gostar SAIPA") },
      { org: o("ساپکو", "SAPCO") },
      { org: o("شرکت پارس ژنراتور", "Pars Generator") },
      { org: o("شرکت ایران تایر", "Iran Tire") },
      { org: o("شرکت مس سرچشمه", "Sarcheshmeh Copper") },
      { org: o("بنیاد مسکن", "Bonyad Maskan (Housing Foundation)") },
      { org: o("دانشگاه علم و صنعت ایران", "Iran University of Science and Technology") },
      { org: o("شرکت معدن طلای موته اصفهان", "Mouteh Gold Mine, Isfahan") },
    ],
  },
  {
    title: o("نرم‌افزار مدیریت پروژه Primavera P6", "Primavera P6"),
    items: [
      { org: o("فاز ۲ پارس جنوبی (شرکت توتال)", "South Pars Phase 2 (Total)") },
      { org: o("ساپکو", "SAPCO") },
      { org: o("شرکت سپاسد", "Sepasad") },
      { org: o("شرکت ایران شایانیک", "Iran Shayanik") },
      { org: o("شرکت سایپا", "SAIPA") },
      { org: o("سرآمدسازان شرق", "Saramadsazan Shargh") },
      { org: o("گسترش انفورماتیک ایران", "Gostaresh Informatic Iran") },
      { org: o("مطالعات استراتژیک حامی", "Hami Strategic Studies") },
    ],
  },
  {
    title: o("دوره‌ی کاربردی برنامه‌ریزی و کنترل پروژه", "Applied project planning & control"),
    items: [
      { org: o("شرکت پوشش پرشیا", "Pooshesh Persia") },
      { org: o("شرکت آب و فاضلاب مشهد", "Mashhad Water & Wastewater") },
      { org: o("جهاد خودکفایی سپاه", "Sepah Self-Sufficiency Jihad") },
      { org: o("استانداری خراسان رضوی", "Khorasan Razavi Governorate") },
      { org: o("فولادسازان گستر ایران", "Fooladsazan Gostar Iran") },
    ],
  },
  {
    title: o("دانشگاه", "University"),
    items: [{ org: o("دانشکده‌ی مدیریت دانشگاه تهران", "University of Tehran, Faculty of Management"), detail: [o("PMBOK 7 برای دانشجویان MBA مدیریت پروژه (گروه ۵۰)", "PMBOK 7 for project management MBA students (cohort 50)")] }],
  },
];

/** Clients listed on the company's earlier website (engagement type not stated). */
export const OTHER_CLIENTS: T[] = [
  o("ایران خودرو", "Iran Khodro"),
  o("گروه بهمن", "Bahman Group"),
  o("امداد خودرو سایپا", "SAIPA Emdad Khodro"),
  o("ماشین‌سازی اراک", "Machine Sazi Arak"),
  o("کولر هوایی آبان", "Aban Air Cooler (AAC)"),
  o("ذوب آهن اصفهان", "Esfahan Steel Company"),
  o("شرکت ملی گاز ایران", "National Iranian Gas Company"),
  o("سازمان منطقه‌ی ویژه‌ی اقتصادی انرژی پارس", "Pars Special Economic Energy Zone"),
  o("سازمان بورس و اوراق بهادار", "Securities and Exchange Organization"),
];
