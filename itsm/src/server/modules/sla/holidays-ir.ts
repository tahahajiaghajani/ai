// The official holidays of Iran for 1404–1406 (Jalali), bundled with the app and seeded into the holiday set «ir» of
// every new organisation (src/server/modules/sla/calendars.ts). Only the per-year lists of the research file
// (holidays-ir.json, `years`) are copied here; its `special_closures` (one-off government closures) are not.
// Lunar dates of 1406 are predictions (`predicted: true`, two with an `alternative` day): the admin marks them
// confirmed once the official calendar of 1406 is published. Every row stays editable by the organisation.
// One entry per date; occasions that share a day are joined with " / ". Generated — edit the data, not the shape.

export interface BundledHoliday {
  /** Jalali date YYYY-MM-DD */
  jalali: string;
  /** Gregorian date YYYY-MM-DD */
  gregorian: string;
  title: string;
  kind: "solar" | "lunar";
  /** the lunar date (AH, YYYY-MM-DD) of a lunar occasion */
  hijri?: string;
  /** a predicted lunar date (not yet in an official calendar) */
  predicted?: boolean;
  /** the other day the occasion may fall on */
  alternative?: { jalali: string; gregorian: string };
  note?: string;
}

export const IR_HOLIDAYS: Record<number, BundledHoliday[]> = {
  1404: [
    { jalali: "1404-01-01", gregorian: "2025-03-21", title: "عید نوروز", kind: "solar" },
    { jalali: "1404-01-02", gregorian: "2025-03-22", title: "عید نوروز / شهادت امام علی (ع)", kind: "solar", hijri: "1446-09-21" },
    { jalali: "1404-01-03", gregorian: "2025-03-23", title: "عید نوروز", kind: "solar" },
    { jalali: "1404-01-04", gregorian: "2025-03-24", title: "عید نوروز", kind: "solar" },
    { jalali: "1404-01-11", gregorian: "2025-03-31", title: "عید سعید فطر", kind: "lunar", hijri: "1446-10-01" },
    { jalali: "1404-01-12", gregorian: "2025-04-01", title: "روز جمهوری اسلامی / تعطیل به مناسبت عید سعید فطر", kind: "solar", hijri: "1446-10-02" },
    { jalali: "1404-01-13", gregorian: "2025-04-02", title: "روز طبیعت (سیزده‌به‌در)", kind: "solar" },
    { jalali: "1404-02-04", gregorian: "2025-04-24", title: "شهادت امام جعفر صادق (ع)", kind: "lunar", hijri: "1446-10-25" },
    { jalali: "1404-03-14", gregorian: "2025-06-04", title: "رحلت امام خمینی (ره)", kind: "solar" },
    { jalali: "1404-03-15", gregorian: "2025-06-05", title: "قیام ۱۵ خرداد", kind: "solar" },
    { jalali: "1404-03-16", gregorian: "2025-06-06", title: "عید سعید قربان", kind: "lunar", hijri: "1446-12-10" },
    { jalali: "1404-03-24", gregorian: "2025-06-14", title: "عید سعید غدیر خم", kind: "lunar", hijri: "1446-12-18" },
    { jalali: "1404-04-14", gregorian: "2025-07-05", title: "تاسوعای حسینی", kind: "lunar", hijri: "1447-01-09" },
    { jalali: "1404-04-15", gregorian: "2025-07-06", title: "عاشورای حسینی", kind: "lunar", hijri: "1447-01-10" },
    { jalali: "1404-05-23", gregorian: "2025-08-14", title: "اربعین حسینی", kind: "lunar", hijri: "1447-02-20" },
    { jalali: "1404-05-31", gregorian: "2025-08-22", title: "رحلت پیامبر اکرم (ص) و شهادت امام حسن مجتبی (ع)", kind: "lunar", hijri: "1447-02-28" },
    { jalali: "1404-06-02", gregorian: "2025-08-24", title: "شهادت امام رضا (ع)", kind: "lunar", hijri: "1447-02-30" },
    { jalali: "1404-06-10", gregorian: "2025-09-01", title: "شهادت امام حسن عسکری (ع)", kind: "lunar", hijri: "1447-03-08" },
    { jalali: "1404-06-19", gregorian: "2025-09-10", title: "میلاد پیامبر اکرم (ص) و امام جعفر صادق (ع)", kind: "lunar", hijri: "1447-03-17" },
    { jalali: "1404-09-03", gregorian: "2025-11-24", title: "شهادت حضرت فاطمه زهرا (س)", kind: "lunar", hijri: "1447-06-03" },
    { jalali: "1404-10-13", gregorian: "2026-01-03", title: "ولادت امام علی (ع) و روز پدر", kind: "lunar", hijri: "1447-07-13" },
    { jalali: "1404-10-27", gregorian: "2026-01-17", title: "مبعث پیامبر اکرم (ص)", kind: "lunar", hijri: "1447-07-27" },
    { jalali: "1404-11-15", gregorian: "2026-02-04", title: "ولادت حضرت قائم (عج) و جشن نیمه شعبان", kind: "lunar", hijri: "1447-08-15" },
    { jalali: "1404-11-22", gregorian: "2026-02-11", title: "پیروزی انقلاب اسلامی", kind: "solar" },
    { jalali: "1404-12-20", gregorian: "2026-03-11", title: "شهادت امام علی (ع)", kind: "lunar", hijri: "1447-09-21" },
    { jalali: "1404-12-29", gregorian: "2026-03-20", title: "روز ملی شدن صنعت نفت", kind: "solar" },
  ],
  1405: [
    { jalali: "1405-01-01", gregorian: "2026-03-21", title: "عید نوروز / عید سعید فطر", kind: "solar", hijri: "1447-10-01" },
    { jalali: "1405-01-02", gregorian: "2026-03-22", title: "عید نوروز / تعطیل به مناسبت عید سعید فطر", kind: "solar", hijri: "1447-10-02" },
    { jalali: "1405-01-03", gregorian: "2026-03-23", title: "عید نوروز", kind: "solar" },
    { jalali: "1405-01-04", gregorian: "2026-03-24", title: "عید نوروز", kind: "solar" },
    { jalali: "1405-01-12", gregorian: "2026-04-01", title: "روز جمهوری اسلامی", kind: "solar" },
    { jalali: "1405-01-13", gregorian: "2026-04-02", title: "روز طبیعت (سیزده‌به‌در)", kind: "solar" },
    { jalali: "1405-01-25", gregorian: "2026-04-14", title: "شهادت امام جعفر صادق (ع)", kind: "lunar", hijri: "1447-10-25" },
    { jalali: "1405-03-06", gregorian: "2026-05-27", title: "عید سعید قربان", kind: "lunar", hijri: "1447-12-10" },
    { jalali: "1405-03-14", gregorian: "2026-06-04", title: "رحلت امام خمینی (ره) / عید سعید غدیر خم", kind: "solar", hijri: "1447-12-18" },
    { jalali: "1405-03-15", gregorian: "2026-06-05", title: "قیام ۱۵ خرداد", kind: "solar" },
    { jalali: "1405-04-03", gregorian: "2026-06-24", title: "تاسوعای حسینی", kind: "lunar", hijri: "1448-01-09" },
    { jalali: "1405-04-04", gregorian: "2026-06-25", title: "عاشورای حسینی", kind: "lunar", hijri: "1448-01-10" },
    { jalali: "1405-05-13", gregorian: "2026-08-04", title: "اربعین حسینی", kind: "lunar", hijri: "1448-02-20" },
    { jalali: "1405-05-21", gregorian: "2026-08-12", title: "رحلت پیامبر اکرم (ص) و شهادت امام حسن مجتبی (ع)", kind: "lunar", hijri: "1448-02-28" },
    { jalali: "1405-05-22", gregorian: "2026-08-13", title: "شهادت امام رضا (ع)", kind: "lunar", hijri: "1448-02-29" },
    { jalali: "1405-05-30", gregorian: "2026-08-21", title: "شهادت امام حسن عسکری (ع)", kind: "lunar", hijri: "1448-03-08" },
    { jalali: "1405-06-08", gregorian: "2026-08-30", title: "میلاد پیامبر اکرم (ص) و امام جعفر صادق (ع)", kind: "lunar", hijri: "1448-03-17" },
    { jalali: "1405-08-22", gregorian: "2026-11-13", title: "شهادت حضرت فاطمه زهرا (س)", kind: "lunar", hijri: "1448-06-03" },
    { jalali: "1405-10-02", gregorian: "2026-12-23", title: "ولادت امام علی (ع) و روز پدر", kind: "lunar", hijri: "1448-07-13" },
    { jalali: "1405-10-16", gregorian: "2027-01-06", title: "مبعث پیامبر اکرم (ص)", kind: "lunar", hijri: "1448-07-27" },
    { jalali: "1405-11-04", gregorian: "2027-01-24", title: "ولادت حضرت قائم (عج) و جشن نیمه شعبان", kind: "lunar", hijri: "1448-08-15" },
    { jalali: "1405-11-22", gregorian: "2027-02-11", title: "پیروزی انقلاب اسلامی", kind: "solar" },
    { jalali: "1405-12-09", gregorian: "2027-02-28", title: "شهادت امام علی (ع)", kind: "lunar", hijri: "1448-09-21" },
    { jalali: "1405-12-19", gregorian: "2027-03-10", title: "عید سعید فطر", kind: "lunar", hijri: "1448-10-01" },
    { jalali: "1405-12-20", gregorian: "2027-03-11", title: "تعطیل به مناسبت عید سعید فطر", kind: "lunar", hijri: "1448-10-02" },
    { jalali: "1405-12-29", gregorian: "2027-03-20", title: "روز ملی شدن صنعت نفت", kind: "solar" },
  ],
  1406: [
    { jalali: "1406-01-01", gregorian: "2027-03-21", title: "عید نوروز", kind: "solar" },
    { jalali: "1406-01-02", gregorian: "2027-03-22", title: "عید نوروز", kind: "solar" },
    { jalali: "1406-01-03", gregorian: "2027-03-23", title: "عید نوروز", kind: "solar" },
    { jalali: "1406-01-04", gregorian: "2027-03-24", title: "عید نوروز", kind: "solar" },
    { jalali: "1406-01-12", gregorian: "2027-04-01", title: "روز جمهوری اسلامی", kind: "solar" },
    { jalali: "1406-01-13", gregorian: "2027-04-02", title: "روز طبیعت (سیزده‌به‌در)", kind: "solar" },
    { jalali: "1406-01-14", gregorian: "2027-04-03", title: "شهادت امام جعفر صادق (ع)", kind: "lunar", hijri: "1448-10-25", note: "از تقویم رسمی ۱۴۰۵ نتیجه شده است (۱ شوال ۱۴۴۸ = ۱۹ اسفند ۱۴۰۵)" },
    { jalali: "1406-02-27", gregorian: "2027-05-17", title: "عید سعید قربان", kind: "lunar", hijri: "1448-12-10", predicted: true },
    { jalali: "1406-03-04", gregorian: "2027-05-25", title: "عید سعید غدیر خم", kind: "lunar", hijri: "1448-12-18", predicted: true },
    { jalali: "1406-03-14", gregorian: "2027-06-04", title: "رحلت امام خمینی (ره)", kind: "solar" },
    { jalali: "1406-03-15", gregorian: "2027-06-05", title: "قیام ۱۵ خرداد", kind: "solar" },
    { jalali: "1406-03-24", gregorian: "2027-06-14", title: "تاسوعای حسینی", kind: "lunar", hijri: "1449-01-09", predicted: true },
    { jalali: "1406-03-25", gregorian: "2027-06-15", title: "عاشورای حسینی", kind: "lunar", hijri: "1449-01-10", predicted: true },
    { jalali: "1406-05-03", gregorian: "2027-07-25", title: "اربعین حسینی", kind: "lunar", hijri: "1449-02-20", predicted: true },
    { jalali: "1406-05-11", gregorian: "2027-08-02", title: "رحلت پیامبر اکرم (ص) و شهادت امام حسن مجتبی (ع)", kind: "lunar", hijri: "1449-02-28", predicted: true },
    { jalali: "1406-05-12", gregorian: "2027-08-03", title: "شهادت امام رضا (ع)", kind: "lunar", hijri: "1449-02-29", predicted: true },
    { jalali: "1406-05-20", gregorian: "2027-08-11", title: "شهادت امام حسن عسکری (ع)", kind: "lunar", hijri: "1449-03-08", predicted: true },
    { jalali: "1406-05-29", gregorian: "2027-08-20", title: "میلاد پیامبر اکرم (ص) و امام جعفر صادق (ع)", kind: "lunar", hijri: "1449-03-17", predicted: true },
    { jalali: "1406-08-11", gregorian: "2027-11-02", title: "شهادت حضرت فاطمه زهرا (س)", kind: "lunar", hijri: "1449-06-03", predicted: true, alternative: { jalali: "1406-08-12", gregorian: "2027-11-03" } },
    { jalali: "1406-09-21", gregorian: "2027-12-12", title: "ولادت امام علی (ع) و روز پدر", kind: "lunar", hijri: "1449-07-13", predicted: true },
    { jalali: "1406-10-05", gregorian: "2027-12-26", title: "مبعث پیامبر اکرم (ص)", kind: "lunar", hijri: "1449-07-27", predicted: true },
    { jalali: "1406-10-23", gregorian: "2028-01-13", title: "ولادت حضرت قائم (عج) و جشن نیمه شعبان", kind: "lunar", hijri: "1449-08-15", predicted: true, alternative: { jalali: "1406-10-22", gregorian: "2028-01-12" } },
    { jalali: "1406-11-22", gregorian: "2028-02-11", title: "پیروزی انقلاب اسلامی", kind: "solar" },
    { jalali: "1406-11-28", gregorian: "2028-02-17", title: "شهادت امام علی (ع)", kind: "lunar", hijri: "1449-09-21", predicted: true },
    { jalali: "1406-12-08", gregorian: "2028-02-27", title: "عید سعید فطر", kind: "lunar", hijri: "1449-10-01", predicted: true },
    { jalali: "1406-12-09", gregorian: "2028-02-28", title: "تعطیل به مناسبت عید سعید فطر", kind: "lunar", hijri: "1449-10-02", predicted: true },
    { jalali: "1406-12-29", gregorian: "2028-03-19", title: "روز ملی شدن صنعت نفت", kind: "solar" },
  ],
};

/** The Jalali years bundled with this version. */
export const IR_HOLIDAY_YEARS = Object.keys(IR_HOLIDAYS).map(Number).sort((a, b) => a - b);
