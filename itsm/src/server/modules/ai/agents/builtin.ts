// The built-in agents (docs/spec/AI.md §11.8, catalogue AI-074…077): seeded switched off, each with a Persian goal, the
// tools it needs, «فقط پیشنهاد» autonomy and the ITSM roles the studio suggests for its principal. An organisation
// switches one on after giving it a principal; it may change everything (goal, tools, autonomy, budgets, guardrails).
// The tools are names of generated record tools (they exist only while the principal may read / write the table) and
// skills the agent may run as tools (`skill:<key>`).
import { registerAgent } from "./registry";

let installed = false;

export function installBuiltinAgents(): void {
  if (installed) return;
  installed = true;

  registerAgent({
    key: "incident_triage",
    name: "تریاژ رخداد",
    description: "رخداد تازه را می‌خواند؛ دسته، اثر، فوریت و گروه پشتیبانی پیشنهاد می‌کند و رخدادهای مشابه و مقاله‌های مرتبط را در یادداشتی داخلی می‌آورد.",
    module: "incident",
    goal: [
      "رخداد تازه‌ای را که در «رکورد» آمده تریاژ کن:",
      "۱. آن را با get_incident بخوان و با skill_incident_triage پیشنهاد دسته، اثر، فوریت و گروه بگیر.",
      "۲. رخدادهای مشابه اخیر را با search_incident و مقاله‌های مرتبط را با search_knowledge پیدا کن.",
      "۳. با draft_update_incident فقط فیلدهایی را پیشنهاد کن که خالی‌اند یا آشکارا نادرست‌اند (دسته، اثر، فوریت، گروه).",
      "۴. یک یادداشت داخلی کوتاه (draft_journal_entry با kind=work_note) بنویس: شمارهٔ رخدادهای مشابه، مقاله‌ها و دلیل پیشنهادها.",
      "وضعیت رخداد را عوض نکن و به درخواست‌کننده پاسخ نده.",
    ].join("\n"),
    tables: ["incident"],
    triggers: ["event", "manual"],
    events: ["created"],
    tools: ["get_incident", "search_incident", "skill:incident.triage", "search_knowledge", "draft_update_incident", "draft_journal_entry"],
    autonomy: "suggest",
    tier: "fast",
    forbidden_states: ["incident:closed", "incident:canceled"],
    principal_roles: ["agent"],
  });

  registerAgent({
    key: "incident_resolution",
    name: "دستیار حل رخداد",
    description: "از مقاله‌های دانش و رخدادهای حل‌شدهٔ مشابه، گام‌های پیشنهادی حل را در یادداشتی داخلی می‌نویسد.",
    module: "incident",
    goal: [
      "برای رخدادی که در «رکورد» آمده گام‌های حل پیشنهاد کن:",
      "۱. رخداد و تاریخچه‌اش را با get_incident و history_incident بخوان.",
      "۲. مقاله‌های مرتبط را با search_knowledge و رخدادهای حل‌شدهٔ مشابه را با search_incident پیدا کن.",
      "۳. گام‌ها را به ترتیب، کوتاه و قابل‌اجرا در یک یادداشت داخلی (draft_journal_entry با kind=work_note) بنویس و برای هر گام منبعش (شمارهٔ مقاله یا رخداد) را بیاور.",
      "اگر منبعی پیدا نشد، همین را بگو و چیزی نساز.",
    ].join("\n"),
    tables: ["incident"],
    triggers: ["manual", "conversation"],
    tools: ["get_incident", "history_incident", "search_incident", "search_knowledge", "skill:incident.resolution", "draft_journal_entry"],
    autonomy: "suggest",
    principal_roles: ["agent"],
  });

  registerAgent({
    key: "major_incident_comms",
    name: "اطلاع‌رسانی رخداد عمده",
    description: "در فاصله‌های منظم برای هر رخداد عمدهٔ باز پیش‌نویس به‌روزرسانی ذی‌نفعان را آماده می‌کند تا مدیر رخداد عمده بازبینی و منتشر کند.",
    module: "incident",
    goal: [
      "برای رخداد عمده‌ای که در «رکورد» آمده پیش‌نویس به‌روزرسانی ذی‌نفعان آماده کن:",
      "۱. رخداد و یادداشت‌ها و پاسخ‌های اخیرش را با get_incident و history_incident بخوان.",
      "۲. با skill_incident_stakeholder_update متن به‌روزرسانی را بنویس: وضعیت کنونی، اثر بر کاربران، کارهای در جریان و زمان به‌روزرسانی بعدی.",
      "۳. متن را در یک یادداشت داخلی (draft_journal_entry با kind=work_note) با عنوان «پیش‌نویس اطلاع‌رسانی» پیشنهاد کن؛ خودت چیزی برای کاربران نفرست.",
      "اگر از آخرین به‌روزرسانی چیز تازه‌ای رخ نداده، فقط همین را گزارش کن.",
    ].join("\n"),
    tables: ["incident"],
    triggers: ["schedule", "manual"],
    schedule_minutes: 60,
    schedule_filter: { f: "major_state", op: "eq", v: "accepted" },
    tools: ["get_incident", "history_incident", "skill:incident.stakeholder_update", "draft_journal_entry"],
    autonomy: "suggest",
    principal_roles: ["incident_manager"],
  });

  registerAgent({
    key: "change_precab",
    name: "بازبین تغییر پیش از CAB",
    description: "تغییر را پیش از جلسهٔ CAB می‌خواند و خطر، کمبودهای برنامهٔ اجرا، آزمون و بازگشت و تداخل‌ها را در یادداشتی داخلی خلاصه می‌کند.",
    module: "change",
    goal: [
      "تغییری را که در «رکورد» آمده پیش از CAB بازبینی کن:",
      "۱. آن را با get_change_request بخوان؛ برنامه‌های اجرا، آزمون، بازگشت و اطلاع‌رسانی را بسنج و هر کمبود را دقیق نام ببر.",
      "۲. روایت خطر را با skill_change_risk_narrative و تداخل‌ها را با skill_change_conflicts بگیر.",
      "۳. همه را در یک یادداشت داخلی (draft_journal_entry با kind=work_note) با سه بخش «خطر»، «کمبودهای برنامه» و «تداخل‌ها» پیشنهاد کن.",
      "تغییر را تأیید یا رد نکن و وضعیتش را عوض نکن.",
    ].join("\n"),
    tables: ["change_request"],
    triggers: ["event", "manual"],
    events: ["state_changed"],
    tools: ["get_change_request", "history_change_request", "search_change_request", "skill:change.risk_narrative", "skill:change.conflicts", "draft_journal_entry"],
    autonomy: "suggest",
    tier: "reasoning",
    forbidden_tables: ["approval"],
    principal_roles: ["change_manager"],
  });

  registerAgent({
    key: "request_fulfilment",
    name: "دستیار انجام درخواست",
    description: "قلم درخواست‌شدهٔ تازه را می‌خواند، گروه انجام‌دهنده را پیشنهاد می‌کند و درخواست‌های مشابه و راهنماهای انجام را در یادداشتی داخلی می‌آورد.",
    module: "request",
    goal: [
      "قلم درخواست‌شده‌ای را که در «رکورد» آمده برای انجام آماده کن:",
      "۱. آن را با get_request_item بخوان (پاسخ‌های حساس و محرمانه هرگز به تو نمی‌رسد و نباید بپرسی).",
      "۲. اقلام مشابه انجام‌شده را با search_request_item و راهنماهای انجام را با search_knowledge پیدا کن.",
      "۳. اگر گروه انجام‌دهنده خالی است، آن را با draft_update_request_item پیشنهاد کن.",
      "۴. یک یادداشت داخلی (draft_journal_entry با kind=work_note) با گام‌های انجام و منابع بنویس.",
    ].join("\n"),
    tables: ["request_item"],
    triggers: ["event", "manual"],
    events: ["created"],
    tools: ["get_request_item", "search_request_item", "search_knowledge", "draft_update_request_item", "draft_journal_entry"],
    autonomy: "suggest",
    tier: "fast",
    forbidden_fields: ["answers", "private_answers", "secret_answers"],
    principal_roles: ["agent"],
  });

  registerAgent({
    key: "knowledge_gaps",
    name: "یابندهٔ شکاف دانش",
    description: "هر روز مشکل‌های پرتکرار رخدادها را که مقاله‌ای ندارند پیدا می‌کند و برای هر کدام شکاف دانشی با طرح پیشنهادی مقاله پیشنهاد می‌دهد.",
    module: "knowledge",
    goal: [
      "شکاف‌های دانش را پیدا کن:",
      "۱. با aggregate_incident دسته‌ها و موضوع‌های پرتکرار رخدادهای سی روز گذشته را بشمار.",
      "۲. برای هر موضوع پرتکرار با search_knowledge بسنج که مقالهٔ منتشرشده‌ای آن را پوشش می‌دهد یا نه.",
      "۳. برای حداکثر سه موضوع بی‌مقاله، با draft_create_kb_gap یک شکاف دانش با عنوان روشن و طرح پیشنهادی مقاله (بخش‌ها و گام‌ها) پیشنهاد کن؛ با search_kb_gap مطمئن شو تکراری نیست.",
    ].join("\n"),
    tables: [],
    triggers: ["schedule", "manual"],
    schedule_minutes: 1440,
    tools: ["aggregate_incident", "search_incident", "search_knowledge", "search_kb_article", "search_kb_gap", "draft_create_kb_gap"],
    autonomy: "suggest",
    tier: "reasoning",
    budgets: { max_steps: 12, max_actions: 3 },
    principal_roles: ["agent", "knowledge_manager"],
  });

  registerAgent({
    key: "cmdb_quality",
    name: "کیفیت دادهٔ پیکربندی",
    description: "پیکربندی‌های تکراری و کهنه (دیرزمانی کشف‌نشده) را پیدا می‌کند و اصلاح آن‌ها را پیشنهاد می‌دهد.",
    module: "cmdb",
    goal: [
      "کیفیت دادهٔ پیکربندی را بسنج:",
      "۱. با search_ci و aggregate_ci پیکربندی‌های هم‌نام یا با شمارهٔ سریال یکسان و پیکربندی‌هایی را که بیش از نود روز کشف نشده‌اند پیدا کن.",
      "۲. برای هر مورد مشکوک آن را با get_ci بخوان و فقط وقتی مطمئنی، اصلاح را با draft_update_ci (مثلاً وضعیت کارکرد) یا پیوند تکراری را با draft_link_records پیشنهاد کن.",
      "۳. در پایان فهرست کوتاهی از یافته‌ها و دلیل هر پیشنهاد بنویس.",
      "هرگز پیکربندی‌ای را حذف نکن.",
    ].join("\n"),
    tables: [],
    triggers: ["schedule", "manual"],
    schedule_minutes: 1440,
    tools: ["search_ci", "aggregate_ci", "get_ci", "skill:cmdb.duplicate", "draft_update_ci", "draft_link_records"],
    autonomy: "suggest",
    budgets: { max_steps: 12, max_actions: 10 },
    principal_roles: ["configuration_manager"],
  });

  registerAgent({
    key: "sla_watcher",
    name: "پاسدار توافق سطح خدمت",
    description: "هر ساعت رخدادهای بازی را که موعد توافقشان نزدیک است یا گذشته پیدا می‌کند و برای هر کدام یادداشت یادآوری برای کارشناس مسئول پیشنهاد می‌دهد.",
    module: "incident",
    goal: [
      "رخدادهای در خطر را پیدا کن:",
      "۱. با search_incident رخدادهای باز را بیاب که موعد توافق (sla_due) آن‌ها در دو ساعت آینده است یا گذشته، مرتب بر پایهٔ موعد.",
      "۲. برای حداکثر ده مورد، یک یادداشت داخلی کوتاه (draft_journal_entry با kind=work_note) بنویس: موعد، آنچه مانده و پیشنهاد گام بعد؛ مسئول با این یادداشت باخبر می‌شود.",
      "برای رخدادی که در یک ساعت گذشته یادداشت یادآوری گرفته دوباره ننویس.",
    ].join("\n"),
    tables: [],
    triggers: ["schedule", "manual"],
    schedule_minutes: 60,
    tools: ["search_incident", "get_incident", "history_incident", "draft_journal_entry"],
    autonomy: "suggest",
    tier: "fast",
    budgets: { max_steps: 10, max_actions: 10 },
    principal_roles: ["agent"],
  });

  registerAgent({
    key: "shift_handover",
    name: "تحویل شیفت",
    description: "در پایان هر شیفت گزارش تحویل می‌سازد: رخدادهای باز مهم، رخدادهای عمده، تیکت‌های در خطر و کارهای ناتمام.",
    module: "incident",
    goal: [
      "گزارش تحویل شیفت بنویس:",
      "۱. با skill_incident_handover خلاصهٔ شیفت را بگیر و با search_incident و aggregate_incident رخدادهای باز با اولویت ۱ و ۲، رخدادهای عمده و تیکت‌های در خطر را بشمار.",
      "۲. گزارش را در چهار بخش کوتاه بنویس: «مهم‌ترین‌ها»، «رخدادهای عمده»، «در خطر» و «کارهای ناتمام»، با شمارهٔ هر تیکت.",
      "چیزی را تغییر نده؛ گزارش پایانی تو همان خروجی اجراست.",
    ].join("\n"),
    tables: [],
    triggers: ["schedule", "manual", "conversation"],
    schedule_minutes: 480,
    tools: ["skill:incident.handover", "search_incident", "aggregate_incident"],
    autonomy: "suggest",
    budgets: { max_actions: 0 },
    principal_roles: ["agent"],
  });
}
