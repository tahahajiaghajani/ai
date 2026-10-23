"use client";

import { useRouter } from "next/navigation";
import { accountCopy } from "@/content/copy/account";
import type { Lang } from "@/lib/format";
import { CodeInput } from "@/components/pro/code-input";

/** «کد دارید؟» on the account's Pro page: the code field on its own (the code may have come by SMS first). */
export function ProCodeEntry({ lang }: { lang: Lang }) {
  const c = accountCopy(lang).membership;
  const router = useRouter();
  return (
    <section aria-labelledby="pro-code-entry" className="border-t border-line pt-10">
      <h2 id="pro-code-entry" className="display text-2xl">
        {c.haveCode}
      </h2>
      <div className="mt-6 max-w-md">
        <CodeInput lang={lang} onDone={() => router.refresh()} />
      </div>
    </section>
  );
}
