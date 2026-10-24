"use client";

import { useRouter } from "next/navigation";
import { accountCopy } from "@/content/copy/account";
import { commonCopy } from "@/content/copy/common";
import type { Lang } from "@/lib/format";
import { ProCodeCeremony } from "@/components/pro/ceremony";
import type { StoreContactInfo } from "@/components/account/contact";

/** «کد دارید؟» on the account's Pro page: the code ceremony on its own (the code may have come by SMS first). */
export function ProCodeEntry({ lang, contact }: { lang: Lang; contact?: StoreContactInfo }) {
  const c = accountCopy(lang).membership;
  const router = useRouter();
  return (
    <section aria-label={c.haveCode} className="pt-4">
      <ProCodeCeremony lang={lang} title={c.haveCode} lead={commonCopy(lang).proSheet.lead} contact={contact} onDone={() => router.refresh()} className="mx-auto w-full max-w-[27rem]" />
    </section>
  );
}
