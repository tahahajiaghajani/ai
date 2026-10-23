"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Input } from "@/components/admin/ui";
import { latinDigits, num } from "@/lib/format";

/** A whole number shown with Persian digits; accepts Persian or Latin digits while typing. */
export function CountInput({
  value,
  onChange,
  signed = false,
  ...rest
}: { value: number; onChange: (v: number) => void; signed?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  // the text being typed (so "-" or an empty field stay visible until the number is complete)
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      {...rest}
      type="text"
      inputMode={signed ? "text" : "numeric"}
      value={draft ?? num(value, "fa")}
      onChange={(e) => {
        const raw = latinDigits(e.target.value).replace(/[−–]/g, "-");
        const neg = signed && raw.trim().startsWith("-");
        const digits = raw.replace(/[^\d]/g, "").slice(0, 7);
        setDraft(num(`${neg ? "-" : ""}${digits}`, "fa"));
        onChange((neg && digits ? -1 : 1) * (digits ? Number(digits) : 0));
      }}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => {
        setDraft(null);
        rest.onBlur?.(e);
      }}
    />
  );
}
