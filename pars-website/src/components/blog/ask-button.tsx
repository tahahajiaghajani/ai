"use client";

import { useChat } from "@/components/chat/chat-context";

/** Opens the site assistant (e.g. under an article). */
export function AskButton({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const { show } = useChat();
  return (
    <button type="button" onClick={show} className={className}>
      {children}
    </button>
  );
}
