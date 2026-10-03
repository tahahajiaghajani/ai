"use client";
import * as React from "react";
import { markReleaseSeen } from "@/components/shell/shell-parts";

/** Opening the help clears the "new" dot next to «راهنما». */
export function MarkReleaseSeen() {
  React.useEffect(() => markReleaseSeen(), []);
  return null;
}
