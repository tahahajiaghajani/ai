import "server-only";
import { db } from "@/lib/db";

export async function logChat(row: {
  id: string;
  session_id: string;
  lang: string;
  question: string;
  answer: string;
  unknown: boolean;
  model: string;
  visitor: string;
}): Promise<void> {
  const c = db();
  if (!c) return;
  await c.from("pars_chat_logs").insert({ ...row, question: row.question.slice(0, 4000), answer: row.answer.slice(0, 12000) });
}
