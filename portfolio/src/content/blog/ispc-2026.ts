import type { Media, Post } from "@/content/types";

const DIR = "/media/blog/ispc-2026";

const booth: Media = {
  kind: "image",
  src: `${DIR}/taha-booth.webp`,
  w: 1280,
  h: 853,
  tone: "mono",
  focus: "68% 38%",
  blur: "data:image/webp;base64,UklGRloAAABXRUJQVlA4IE4AAADQAQCdASoQAAsAA4BaJQBdgCHaaITV8AD+zGhZx31RtZW27RMLf7C3bcVoa/iz0viZ9Mq/+cwf9uZVNzUW+R4oy25rxo5rdCtS3LjJMAA=",
  alt: {
    fa: "طاها آقاجانی در غرفه‌ی مدیریت پروژه پارس، پیش پس‌زمینه‌ای با نوشته‌های «نوسازی و مهاجرت EPM» و «دموی زنده را از ما بخواهید»",
    en: "Taha Aghajani at the Pars Project Management booth, before a backdrop reading “EPM modernisation and migration” and “Ask us for a live demo”",
  },
  caption: { fa: "در غرفه‌ی مدیریت پروژه پارس", en: "At the Pars Project Management booth" },
};

const poster: Media = {
  kind: "image",
  src: `${DIR}/poster.webp`,
  w: 905,
  h: 1280,
  tone: "mono",
  span: 4,
  blur: "data:image/webp;base64,UklGRlwAAABXRUJQVlA4IFAAAABQAgCdASoLABAAA4BaJYwCsAEWUNLAFQIRxCAA/qw8ZzQUdwWO9LnEvFsouVjn/Uri98Ft4XEbsltNxcoVLI76PRI6f6VmXu1RA/qAx8AAAA==",
  alt: {
    fa: "پوستر نخستین کنگره بین‌المللی پروژه پایدار: «تفکر سبز، پروژه پایدار، دنیای پاک»، ۶ آبان ۱۴۰۵، مرکز همایش‌های بین‌المللی کشتیرانی، با محورهای کنگره و نشان حامیان",
    en: "The poster of the first International Sustainable Project Congress: “Green thinking, sustainable project, clean world”, October 28, 2026, Kashtirani International Conference Centre, with the congress themes and sponsors' logos",
  },
  caption: { fa: "پوستر کنگره", en: "The congress poster" },
};

const keynote: Media = {
  kind: "image",
  src: `${DIR}/keynote.webp`,
  w: 1280,
  h: 853,
  tone: "mono",
  span: 8,
  blur: "data:image/webp;base64,UklGRmQAAABXRUJQVlA4IFgAAADQAQCdASoQAAsAA4BaJagCdAD0skdZIAD+7suMVIvSCNOYUEf73vO0rJL/z2yfIA+vRf55ZFp4OF47Hjv9k2rMJqIF9qlkC4zU4HLma2cBbLIwqkGxzxgA",
  alt: {
    fa: "یکی از سخنرانان پشت تریبون کنگره، کنار پرچم‌ها و صفحه‌ای که زمان، مکان و برگزارکننده‌ی کنگره را نشان می‌دهد",
    en: "A speaker at the congress lectern, beside the flags and a screen showing the congress date, venue and organiser",
  },
  caption: { fa: "یکی از سخنرانی‌های روز کنگره", en: "One of the talks on congress day" },
};

const awards: Media = {
  kind: "image",
  src: `${DIR}/awards.webp`,
  w: 1024,
  h: 683,
  tone: "mono",
  span: 8,
  blur: "data:image/webp;base64,UklGRlYAAABXRUJQVlA4IEoAAACwAQCdASoQAAsAA4BaJZQAAjPfOWSIAP7sR57oKiati9M9DINmt5yN41fPXeCh0R1SwC9oeowceRiOptGOwBWdFK+5uBlyL4AAAA==",
  alt: {
    fa: "آیین پایانی کنگره روی صحنه: اهدای تندیس به یکی از برگزیدگان",
    en: "The closing ceremony on stage: a statue is presented to one of the honourees",
  },
  caption: { fa: "آیین پایانی و اهدای تندیس‌ها", en: "The closing ceremony and its awards" },
};

/**
 * The first post. The congress summary is built from the official catalogue, IPMA Iran's announcements and the
 * post-event reports listed in `sources` (attributed in the text); the Pars booth part is the company's own account.
 * Other people in the photos are never named.
 */
export const ispc2026: Post = {
  slug: "ispc-2026",
  date: "2026-11-11T09:00:00+03:30",
  kicker: { fa: "رویداد · مدیریت پروژه و پایداری", en: "Event · Project management & sustainability" },
  title: {
    fa: "نخستین کنگره بین‌المللی پروژه پایدار، از غرفه‌ی پارس",
    en: "The first International Sustainable Project Congress, from the Pars booth",
  },
  dek: {
    fa: "ششم آبان ۱۴۰۵، یک روز برای مدیریت پروژه و پایداری: آنچه کنگره دنبال می‌کرد، آنچه از روزش گزارش شد، و روز ما در غرفه‌ی مدیریت پروژه پارس با مدیران؛ از مشاوره و آموزش تا گیمیفیکیشن و معرفی و فروش محصولات.",
    en: "October 28, 2026, a day for project management and sustainability: what the congress set out to do, what was reported from the day, and our day with managers at the Pars Project Management booth, from consulting and training to gamification and product sales.",
  },
  cover: booth,
  og: `${DIR}/og.jpg`,
  facts: [
    { k: { fa: "زمان", en: "When" }, v: { fa: "چهارشنبه ۶ آبان ۱۴۰۵، ساعت ۸ تا ۱۸", en: "Wednesday, October 28, 2026, 8:00–18:00" } },
    { k: { fa: "مکان", en: "Where" }, v: { fa: "مرکز همایش‌های بین‌المللی کشتیرانی، لویزان، تهران", en: "Kashtirani International Conference Centre, Lavizan, Tehran" } },
    { k: { fa: "برگزارکننده", en: "Organiser" }, v: { fa: "شرکت مدیریت پروژه سبز پایا؛ اطلاع‌رسانی: انجمن مدیریت پروژه ایران", en: "Paya Green Project Management; announced by IPMA Iran" } },
    { k: { fa: "حضور ما", en: "Our part" }, v: { fa: "غرفه‌ی مدیریت پروژه پارس", en: "The Pars Project Management booth" } },
  ],
  blocks: [
    {
      kind: "text",
      text: {
        fa: "نخستین کنگره بین‌المللی پروژه پایدار (ISPC) با شعار «تفکر سبز، پروژه پایدار، دنیای پاک» روز چهارشنبه ۶ آبان ۱۴۰۵ در مرکز همایش‌های بین‌المللی کشتیرانی در لویزان تهران برگزار شد؛ رویدادی یک‌روزه در دو حوزه‌ای که کمتر کنار هم دیده می‌شوند: مدیریت پروژه و پایداری. میزبان کنگره شرکت مدیریت پروژه سبز پایا بود و انجمن مدیریت پروژه ایران اطلاع‌رسانی آن را بر عهده داشت. کنگره نخست برای مهر و سپس برای بهمن ۱۴۰۴ اعلام شده بود و سرانجام در آبان ۱۴۰۵ برگزار شد.\n\nهدفی که برگزارکنندگان از پیش اعلام کرده بودند روشن بود: «تبادل دانش، بررسی اصول پایداری در مدیریت پروژه و ارائه‌ی نمونه‌های عملی». پرسش اصلی این بود که پایداری چطور از یک شعار به بخشی از نظام راهبری پروژه‌ها بدل می‌شود: در اهداف و راهبرد سازمان‌ها، در شایستگی‌های مدیران و تیم‌های پروژه، در استانداردها و روش‌ها، و در گزارش‌هایی که از پروژه‌ها نوشته می‌شود.",
        en: "The first International Sustainable Project Congress (ISPC), under the tagline “Green thinking, sustainable project, clean world”, took place on Wednesday, October 28, 2026, at the Kashtirani International Conference Centre in Lavizan, Tehran: a one-day event in two fields that rarely sit together, project management and sustainability. It was hosted by Paya Green Project Management, and the Iran Project Management Association (IPMA Iran) published its announcements. First announced for autumn 2025 and then for January 2026, it finally took place in October 2026.\n\nThe organisers' stated aim was plain: “knowledge exchange, examining sustainability principles in project management, and presenting practical examples”. The underlying question was how sustainability turns from a slogan into part of how projects are governed: in organisations' goals and strategy, in the competencies of project managers and teams, in standards and methods, and in the reports written about projects.",
      },
    },
    { kind: "gallery", items: [poster, keynote] },
    {
      kind: "list",
      heading: { fa: "محورهای کنگره", en: "The congress themes" },
      items: {
        fa: [
          "توسعه‌ی پایدار؛ مفهوم، تعریف و برداشت‌ها",
          "پایداری و رویکردهای نوین",
          "شایستگی‌های پایداری مدیران و تیم‌های پروژه",
          "پایداری در پروژه؛ استانداردها، متدولوژی‌ها و رویکردها",
          "فرهنگ سازمانی پایدار، آموزش و ارزش‌ها",
          "گزارش‌نویسی، تجربه‌ها و درس‌آموخته‌های پایداری پروژه",
          "و برای نخستین بار: ارزیابی پروژه‌های پایدار",
        ],
        en: [
          "Sustainable development: concept, definitions and interpretations",
          "Sustainability and new approaches",
          "Sustainability competencies of project managers and teams",
          "Sustainability in projects: standards, methodologies and approaches",
          "Sustainable organisational culture, education and values",
          "Reporting, experience and lessons learned in project sustainability",
          "And, for the first time: the assessment of sustainable projects",
        ],
      },
    },
    {
      kind: "text",
      heading: { fa: "از سبز کم‌رنگ تا سبز پررنگ", en: "From pale green to deep green" },
      text: {
        fa: "به گزارش نشان تجارت از روز کنگره، یکی از سخنرانی‌های کلیدی با عنوان «از سبز کم‌رنگ تا سبز پررنگ» پایداریِ نمایشی را نقد کرد: پروژه‌ای که فقط برچسب سبز می‌خورد با پروژه‌ای که پایداری در تصمیم‌ها و معیارهایش نشسته فرق دارد. سخنرانی دیگری مدیریت پروژه را در «نسل چهارم مدیریت و مهندسی سبز» بررسی کرد، و میزگردی به «مدیریت پروژه پایدار مبتنی بر هوش مصنوعی» پرداخت؛ موضوعی که برای ما، که هوش مصنوعی را به سامانه‌های مدیریت پروژه می‌آوریم، از همه نزدیک‌تر بود.\n\nکنار سخنرانی‌ها، کنگره بخشی برای ارزیابی پروژه‌های پایدار داشت. مدل این ارزیابی، **P5 Impact Assessment**، پنج بُعد را با هم می‌سنجد: انسان (People)، محیط زیست (Planet)، اقتصاد (Prosperity)، فرایند (Processes) و محصول (Products)؛ و پروژه‌ی ارزیابی‌شده گزارشی از نقاط قوت، ریسک‌ها و اقدام‌های بهبود می‌گیرد.",
        en: "According to Neshan Tejarat's report from the day, one of the keynotes, “From pale green to deep green”, took aim at sustainability for show: a project that merely carries a green label is not the same as one whose decisions and measures are built on sustainability. Another talk placed project management in “the fourth generation of green management and engineering”, and a round-table took up “AI-based sustainable project management”, the topic closest to us, since bringing AI into project-management systems is what we do.\n\nAlongside the talks, the congress had a section for assessing sustainable projects. Its model, the **P5 Impact Assessment**, weighs five dimensions together: People, Planet, Prosperity, Processes and Products; an assessed project receives a report of its strengths, risks and improvement actions.",
      },
    },
    { kind: "figure", media: awards },
    {
      kind: "text",
      heading: { fa: "آیین پایانی", en: "The closing ceremony" },
      text: {
        fa: "در آیین پایانی از چهره‌ها و شرکت‌های برگزیده قدردانی شد. به گزارش گروه مپنا، تندیس مدیریت پروژه پایدار سبز به پروژه‌ی «گلخانه هوشمند مپنا اگرید» از شرکت مپنا توسعه ۳ رسید؛ پروژه‌ای که بر پایه‌ی همان مدل P5 ارزیابی شده بود.",
        en: "The closing ceremony honoured selected figures and companies. According to MAPNA Group, the Green Sustainable Project Management statue went to MAPNA Toseh 3's “MAPNA AGRID” smart-greenhouse project, which had been assessed on the same P5 model.",
      },
    },
    {
      kind: "text",
      heading: { fa: "غرفه‌ی مدیریت پروژه پارس", en: "The Pars Project Management booth" },
      text: {
        fa: "ما در مدیریت پروژه پارس، با غرفه‌ای در کنگره، یک روز کامل را با مدیران گذراندیم: مدیران پروژه، مدیران دفاتر مدیریت پروژه و مدیران ارشد سازمان‌ها. کار غرفه چهار بخش داشت:\n- **مشاوره:** گفت‌وگوی رودررو درباره‌ی نظام مدیریت پروژه‌ی هر سازمان، از ارزیابی وضع موجود تا نوسازی و مهاجرت سامانه‌های EPM، و اینکه هوش مصنوعی کجای این نظام واقعاً به کار می‌آید.\n- **آموزش:** رویکردهای برنامه‌ریزی و کنترل پروژه و دوره‌های آموزشی پارس برای مدیران و تیم‌های پروژه.\n- **گیمیفیکیشن:** بازی‌وارسازی، تا مفاهیم و عادت‌های مدیریت پروژه در تیم‌ها و میان مدیران ملموس و ماندگار شود.\n- **معرفی و فروش محصولات:** دموی زنده‌ی سامانه‌های پارس و دستیار هوشمند پروژه برای مدیران، و گفت‌وگو درباره‌ی استقرار آن‌ها در سازمانشان.\n\nبیشتر گفت‌وگوها همان‌جا، پای دمو، شکل گرفت: مدیری مسئله‌ی واقعی سازمانش را می‌گفت و ما آن را روی سامانه نشان می‌دادیم. پیوند پایداری و مدیریت پروژه از نگاه ما همین‌جاست: داده‌ی درست، تصمیم شفاف و گزارشی که بتوان به آن اعتماد کرد.",
        en: "At Pars Project Management we spent the whole day at our booth with managers: project managers, PMO heads and senior executives. The booth did four things:\n- **Consulting:** face-to-face conversations about each organisation's project-management system, from assessing where it stands to modernising and migrating EPM platforms, and where AI genuinely helps in it.\n- **Training:** approaches to project planning and control, and Pars's courses for managers and project teams.\n- **Gamification:** game design that makes project-management ideas and habits tangible and lasting for teams and managers.\n- **Products:** live demos of the Pars systems and the AI project copilot for managers, and conversations about rolling them out in their organisations.\n\nMost conversations happened right there at the demo: a manager described a real problem in their organisation and we showed it on the system. That, to us, is where sustainability and project management meet: sound data, transparent decisions and reports people can trust.",
      },
    },
    {
      kind: "quote",
      text: { fa: "دموی زنده را از ما بخواهید", en: "Ask us for a live demo" },
      cite: { fa: "نوشته‌ی پشت غرفه‌ی پارس", en: "On the back wall of the Pars booth" },
    },
  ],
  tags: [
    "کنگره", "کنگره بین‌المللی پروژه پایدار", "پروژه پایدار", "پایداری", "ISPC", "congress", "sustainability", "sustainable project",
    "غرفه", "booth", "نمایشگاه", "exhibition", "پارس", "Pars", "مدیریت پروژه پارس", "مشاوره", "consulting", "آموزش", "training",
    "گیمیفیکیشن", "gamification", "بازی‌وارسازی", "محصولات", "products", "EPM", "P5", "مپنا", "MAPNA", "پایا", "Paya", "IPMA",
    "رویداد", "event", "وبلاگ", "blog", "۱۴۰۵", "آبان",
  ],
  related: ["pars-suite-copilot", "pars-ai-first"],
  sources: [
    { label: { fa: "کاتالوگ کنگره (انجمن مدیریت پروژه ایران)", en: "Congress catalogue (IPMA Iran, in Persian)" }, href: "https://ipma.ir/files/uploadFiles/1760527795.pdf" },
    { label: { fa: "اطلاعیه‌ی کنگره، انجمن مدیریت پروژه ایران", en: "Congress announcement, IPMA Iran" }, href: "https://ipma.ir/news/484" },
    { label: { fa: "نشست شورای سیاست‌گذاری کنگره، انجمن مدیریت پروژه ایران", en: "The congress policy-council meeting, IPMA Iran" }, href: "https://ipma.ir/news/440" },
    { label: { fa: "نشان تجارت: «نخستین کنگره بین‌المللی پروژه پایدار برگزار شد»", en: "Neshan Tejarat: report from the congress (in Persian)" }, href: "https://neshanetejarat.ir/fa/news/78484/" },
    { label: { fa: "گروه مپنا: اهدای تندیس مدیریت پروژه پایدار سبز", en: "MAPNA Group: the Green Sustainable Project Management statue (in Persian)" }, href: "https://mapnagroup.com/67635/" },
  ],
  note: {
    fa: "خلاصه‌ی کنگره از منابع بالا گردآوری شده است؛ بخش غرفه روایت خود ما از آن روز است. عکس‌ها از روز کنگره‌اند.",
    en: "The congress summary is compiled from the sources above; the booth section is our own account of the day. The photos are from congress day.",
  },
};
