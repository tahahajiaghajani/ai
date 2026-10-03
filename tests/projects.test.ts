import { describe, expect, it } from "vitest";
import { fileKind, isTextPath, mentionedFiles, mentionedProject, projectSlug, safeProjectPath, skipOnImport } from "@/lib/projects/paths";
import { extractImports, extractSymbols, resolveImport } from "@/lib/projects/symbols";

describe("project paths", () => {
  it("accepts only relative paths inside the project", () => {
    expect(safeProjectPath("src/app.ts")).toBe("src/app.ts");
    expect(safeProjectPath("./src//app.ts")).toBe("src/app.ts");
    expect(safeProjectPath("src\\\\Audit.cs")).toBe("src/Audit.cs");
    expect(safeProjectPath("../secret")).toBeNull();
    expect(safeProjectPath("a/../../b")).toBeNull();
    expect(safeProjectPath(".git/config")).toBeNull();
    expect(safeProjectPath(".taskflow/KNOWLEDGE.md")).toBeNull();
    expect(safeProjectPath(".taskflow/KNOWLEDGE.md", { allowMeta: true })).toBe(".taskflow/KNOWLEDGE.md");
    expect(safeProjectPath("")).toBeNull();
  });

  it("makes latin folder names and classifies files", () => {
    expect(projectSlug("Renew App 2")).toBe("renew-app-2");
    expect(projectSlug("پروژه")).toMatch(/^project-[a-z0-9]+$/);
    expect(fileKind("src/Audit.cs")).toBe("code");
    expect(fileKind("docs/guide.pdf")).toBe("doc");
    expect(fileKind("data.xlsx")).toBe("data");
    expect(isTextPath("src/Audit.cs")).toBe(true);
    expect(isTextPath("docs/guide.pdf")).toBe(false);
    expect(skipOnImport("node_modules/x/index.js")).toBe(true);
    expect(skipOnImport("app/bin/Debug/a.dll")).toBe(true);
    expect(skipOnImport("src/binary-search.ts")).toBe(false);
  });
});

describe("what a prompt names", () => {
  const paths = ["src/Audit.cs", "src/index.ts", "lib/index.ts", "README.md", "app/page.tsx"];

  it("finds files by name or full path", () => {
    expect(mentionedFiles("در پروژه renew فایل audit.cs باگ دارد", paths)).toEqual(["src/Audit.cs"]);
    expect(mentionedFiles("فایل app/page.tsx و README.md را درست کن", paths)).toEqual(["app/page.tsx", "README.md"]);
    expect(mentionedFiles("کل پروژه را بررسی کن", paths)).toEqual([]);
    // a longer word is not a mention
    expect(mentionedFiles("myaudit.cs.bak", paths)).toEqual([]);
  });

  it("finds the one project the prompt names", () => {
    const projects = [
      { slug: "renew", name: "Renew" },
      { slug: "crm", name: "CRM سازمان" },
    ];
    expect(mentionedProject("در پروژه renew فایل audit.cs باگ دارد", projects)?.slug).toBe("renew");
    expect(mentionedProject("در پروژه CRM سازمان گزارش بساز", projects)?.slug).toBe("crm");
    expect(mentionedProject("یک باگ در renewal", projects)).toBeNull();
    expect(mentionedProject("renew و crm را مقایسه کن", projects)).toBeNull();
  });
});

describe("file map", () => {
  it("extracts main symbols and imports", () => {
    const ts = `import { x } from "./util";\nimport React from "react";\nexport function save() {}\nexport class Audit {}\nexport const total = 1;`;
    expect(extractSymbols("a.ts", ts)).toEqual(expect.arrayContaining(["save", "Audit", "total"]));
    expect(extractImports("a.ts", ts)).toEqual(expect.arrayContaining(["./util", "react"]));
    const cs = `using System;\nnamespace Renew {\n  public class Audit {\n    public void Save() {}\n  }\n}`;
    expect(extractSymbols("Audit.cs", cs)).toEqual(expect.arrayContaining(["Audit"]));
  });

  it("resolves relative imports to project files", () => {
    const paths = new Set(["src/app.ts", "src/util/index.ts", "src/audit.tsx"]);
    expect(resolveImport("src/app.ts", "./util", paths)).toBe("src/util/index.ts");
    expect(resolveImport("src/app.ts", "./audit", paths)).toBe("src/audit.tsx");
    expect(resolveImport("src/app.ts", "react", paths)).toBeNull();
    expect(resolveImport("src/app.ts", "./missing", paths)).toBeNull();
  });
});
