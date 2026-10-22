import { requireAdminPage } from "@/lib/admin-auth";
import { getSettingsFresh } from "@/lib/settings";
import { env } from "@/lib/env";
import { PageTitle } from "@/components/admin/ui";
import { AiForm, ChatForm, SupportForm } from "@/components/admin/ai-forms";

export default async function AiPage() {
  await requireAdminPage();
  const s = await getSettingsFresh();
  const { apiKeyEnc, ...ai } = s.ai;
  return (
    <>
      <PageTitle title="هوش مصنوعی" sub="مدل پاسخ‌گوی دستیار، رفتار گفتگو و قابلیت‌های هوشمند پشتیبانی." />
      <div className="grid gap-6 xl:grid-cols-2">
        <AiForm initial={{ ...ai, hasKey: Boolean(apiKeyEnc) }} envKey={Boolean(env.geminiKey)} />
        <div className="space-y-6">
          <ChatForm initial={s.chat} />
          <SupportForm initial={s.support} />
        </div>
      </div>
    </>
  );
}
