// The sign-in page picks its form only once the server has said which ways in are open, and never swaps it under someone
// typing. Bank-sim run 43180784825: right after the demo purge the server answered GET /api/auth/options late; the page
// had shown the e-mail form, the administrator's address was typed into it, the answer then switched the page to
// «حساب سازمانی», and the address went to the domain sign-in («این دامنه برای ورود تعریف نشده است»).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { firstSignInWay, signInForm } from "../src/ui/pages/auth/signInForm";

describe("the sign-in page's form", () => {
  it("shows no form while the ways in are unknown", () => {
    expect(signInForm(false, false, null, null)).toBeNull();
    expect(signInForm(false, true, null, null)).toBeNull();
    // even a pick cannot show a form before the answer
    expect(signInForm(false, true, "local", null)).toBeNull();
  });

  it("opens on the organisation's account when Active Directory sign-in is on, on e-mail and password otherwise", () => {
    expect(signInForm(true, true, null, firstSignInWay(true))).toBe("directory");
    expect(signInForm(true, false, null, firstSignInWay(false))).toBe("local");
  });

  it("keeps the first answer's form when a later answer differs (no swap under someone typing)", () => {
    // first answer: no directory → e-mail form; a refetch then reports the directory: the e-mail form stays
    expect(signInForm(true, true, null, firstSignInWay(false))).toBe("local");
  });

  it("follows the person's own pick", () => {
    expect(signInForm(true, true, "local", "directory")).toBe("local");
    expect(signInForm(true, true, "directory", "local")).toBe("directory");
  });

  it("never shows the domain form without a directory", () => {
    expect(signInForm(true, false, "directory", "directory")).toBe("local");
    expect(signInForm(true, false, null, "directory")).toBe("local");
  });

  it("is what Login.tsx renders: a placeholder until the answer, then the chosen form", () => {
    const src = readFileSync(join(__dirname, "../src/ui/pages/auth/Login.tsx"), "utf8");
    expect(src).toMatch(/const known = !options\.isPending/);
    expect(src).toMatch(/signInForm\(known, !!directory, way, first\.current\)/);
    expect(src).toMatch(/if \(current === null\) \{[\s\S]*?<Skeleton/);
    // the old rule (way ?? (directory ? "directory" : "local")) swapped the form when the answer arrived
    expect(src).not.toMatch(/way \?\? \(directory \? "directory" : "local"\)/);
  });
});
