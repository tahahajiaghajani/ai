"use client";

import { ErrorView } from "@/components/pages/error-view";

/** A page of the site failed to render: the header and footer stay, the page offers to try again. */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorView lang="fa" error={error} retry={retry} />;
}
