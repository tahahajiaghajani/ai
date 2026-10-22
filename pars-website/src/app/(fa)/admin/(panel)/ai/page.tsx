import { requireAdminPage } from "@/lib/admin-auth";
import { getSettingsFresh } from "@/lib/settings";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { PageTitle } from "@/components/admin/ui";
import { AiForm, ChatForm, SupportForm } from "@/components/admin/ai-forms";

export default async function AiPage() {
  await requireAdminPage();
  const s = await getSettingsFresh();
  const { apiKeyEnc, ...ai } = s.ai;
  const readable = Boolean(apiKeyEnc && decrypt(apiKeyEnc));
  return (
    <>
      <PageTitle title="هوش مصنوعی" sub="مدل پاسخ‌گوی دستیار، رفتار گفتگو و قابلیت‌های هوشمند پشتیبانی." />
      <div className="grid gap-6 xl:grid-cols-2">
        <AiForm initial={{ ...ai, hasKey: readable, keyUnreadable: Boolean(apiKeyEnc) && !readable }} envKey={Boolean(env.geminiKey)} />
        <div className="space-y-6">
          <ChatForm initial={s.chat} />
          <SupportForm initial={s.support} />
        </div>
      </div>
    </>
  );
}
