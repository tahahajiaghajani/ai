/** Choices offered for Claude Code runs (Settings default and per-send override). */

export const CLAUDE_MODELS: { value: string; label: string }[] = [
  { value: "", label: "پیش‌فرض حساب" },
  { value: "opus", label: "Opus — قوی‌ترین" },
  { value: "sonnet", label: "Sonnet — سریع‌تر، مصرف کمتر" },
  { value: "haiku", label: "Haiku — سریع و سبک" },
  { value: "opusplan", label: "Opus Plan — برنامه با Opus، اجرا با Sonnet" },
  { value: "fable", label: "Fable — روی پلن Pro از اعتبار اضافه مصرف می‌کند" },
];

export const CLAUDE_EFFORTS: { value: string; label: string }[] = [
  { value: "", label: "پیش‌فرض مدل" },
  { value: "low", label: "کم — سریع" },
  { value: "medium", label: "متوسط" },
  { value: "high", label: "زیاد" },
  { value: "xhigh", label: "خیلی زیاد" },
  { value: "max", label: "حداکثر — دقیق‌ترین، کندترین" },
];

export const CLAUDE_THINKING: { value: "auto" | "on" | "off"; label: string }[] = [
  { value: "auto", label: "تطبیقی (پیشنهادی)" },
  { value: "on", label: "همیشه روشن" },
  { value: "off", label: "خاموش" },
];

export const CLAUDE_THINKING_HINT =
  "مدل‌های جدید (Opus، Sonnet، Fable) همیشه به‌صورت تطبیقی فکر می‌کنند و عمق فکر را effort تعیین می‌کند؛ «همیشه روشن/خاموش» فقط روی مدل‌های قدیمی‌تر اثر دارد.";
