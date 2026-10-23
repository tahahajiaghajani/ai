"use client";

import { useEffect } from "react";
import { readAllMessages } from "@/app/actions/account";
import { sessionChanged } from "@/components/pro/session";

/** Marks the inbox read once the page is open (the header dot and the sidebar count follow). */
export function MarkMessagesRead() {
  useEffect(() => {
    let live = true;
    readAllMessages()
      .then((r) => {
        if (live && r.ok) void sessionChanged();
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return null;
}
