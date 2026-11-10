// The formula of a performance indicator: a small, safe arithmetic language over the names of its aggregates
// (`breached / total * 100`, `(resolved - reopened) / resolved * 100`, `max(0, target - open)`). Numbers, names,
// + - * / and parentheses, unary minus, and the functions min, max, abs, round(x, digits), ifnull(x, y). A missing
// value (null) makes the result null, and so does a division by zero — a KPI with no denominator has no value, not
// zero. Parsed once (no eval, no property access), evaluated many times; pure, shared by the server and the designer.

export type FormulaNode =
  | { t: "num"; v: number }
  | { t: "var"; name: string }
  | { t: "neg"; x: FormulaNode }
  | { t: "bin"; op: "+" | "-" | "*" | "/"; a: FormulaNode; b: FormulaNode }
  | { t: "call"; fn: FormulaFn; args: FormulaNode[] };

export type FormulaFn = "min" | "max" | "abs" | "round" | "ifnull";
const FNS: Record<FormulaFn, [number, number]> = { min: [1, 10], max: [1, 10], abs: [1, 1], round: [1, 2], ifnull: [2, 2] };

export class FormulaError extends Error {}

type Tok = { k: "num"; v: number } | { k: "id"; v: string } | { k: "op"; v: string };

const MAX_LENGTH = 500;

function tokenize(src: string): Tok[] {
  if (src.length > MAX_LENGTH) throw new FormulaError(`فرمول بلندتر از ${MAX_LENGTH} نویسه است`);
  // Persian and Arabic digits and the Persian decimal separator are accepted
  const s = src.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/٫/g, ".").replace(/×/g, "*").replace(/÷/g, "/");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(s.slice(i)) ?? /^\d+\.?/.exec(s.slice(i));
      if (!m) throw new FormulaError(`عدد نامعتبر در «${s.slice(i, i + 8)}»`);
      const v = Number(m[0]);
      if (!Number.isFinite(v)) throw new FormulaError(`عدد نامعتبر «${m[0]}»`);
      out.push({ k: "num", v });
      i += m[0].length;
      continue;
    }
    if (/[a-z_]/i.test(c)) {
      const m = /^[a-z_][a-z0-9_]*/i.exec(s.slice(i))!;
      out.push({ k: "id", v: m[0].toLowerCase() });
      i += m[0].length;
      continue;
    }
    if ("+-*/(),".includes(c)) {
      out.push({ k: "op", v: c });
      i++;
      continue;
    }
    throw new FormulaError(`نویسهٔ «${c}» در فرمول مجاز نیست`);
  }
  return out;
}

/** Parse a formula (throws FormulaError with a Persian message). */
export function parseFormula(src: string): FormulaNode {
  const toks = tokenize(String(src ?? "").trim());
  if (!toks.length) throw new FormulaError("فرمول خالی است");
  let at = 0;
  let depth = 0;
  const peek = () => toks[at];
  const isOp = (v: string) => peek()?.k === "op" && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`«${v}» انتظار می‌رفت`);
    at++;
  };
  const expr = (): FormulaNode => {
    if (++depth > 40) throw new FormulaError("فرمول بیش از حد تودرتو است");
    let a = term();
    while (isOp("+") || isOp("-")) {
      const op = (toks[at++] as { v: "+" | "-" }).v;
      a = { t: "bin", op, a, b: term() };
    }
    depth--;
    return a;
  };
  const term = (): FormulaNode => {
    let a = unary();
    while (isOp("*") || isOp("/")) {
      const op = (toks[at++] as { v: "*" | "/" }).v;
      a = { t: "bin", op, a, b: unary() };
    }
    return a;
  };
  const unary = (): FormulaNode => {
    if (isOp("-")) {
      at++;
      return { t: "neg", x: unary() };
    }
    if (isOp("+")) {
      at++;
      return unary();
    }
    return primary();
  };
  const primary = (): FormulaNode => {
    const t = peek();
    if (!t) throw new FormulaError("فرمول ناتمام است");
    if (t.k === "num") {
      at++;
      return { t: "num", v: t.v };
    }
    if (t.k === "id") {
      at++;
      if (isOp("(")) {
        if (!(t.v in FNS)) throw new FormulaError(`تابع «${t.v}» شناخته نیست (min، max، abs، round، ifnull)`);
        at++;
        const args: FormulaNode[] = [];
        if (!isOp(")")) {
          args.push(expr());
          while (isOp(",")) {
            at++;
            args.push(expr());
          }
        }
        expect(")");
        const [lo, hi] = FNS[t.v as FormulaFn];
        if (args.length < lo || args.length > hi) throw new FormulaError(`تابع «${t.v}» ${lo === hi ? lo : `${lo} تا ${hi}`} ورودی می‌گیرد`);
        return { t: "call", fn: t.v as FormulaFn, args };
      }
      return { t: "var", name: t.v };
    }
    if (isOp("(")) {
      at++;
      const x = expr();
      expect(")");
      return x;
    }
    throw new FormulaError(`«${t.v}» در این جا انتظار نمی‌رفت`);
  };
  const node = expr();
  if (at < toks.length) throw new FormulaError(`بخش «${toks.slice(at).map((t) => String(t.v)).join(" ")}» اضافه است`);
  return node;
}

/** Names a formula reads. */
export function formulaVars(node: FormulaNode, out = new Set<string>()): Set<string> {
  switch (node.t) {
    case "var":
      out.add(node.name);
      break;
    case "neg":
      formulaVars(node.x, out);
      break;
    case "bin":
      formulaVars(node.a, out);
      formulaVars(node.b, out);
      break;
    case "call":
      for (const a of node.args) formulaVars(a, out);
      break;
  }
  return out;
}

/** Why a formula is not valid for these part names (Persian), or null. */
export function formulaProblem(src: string, names: string[]): string | null {
  try {
    const node = parseFormula(src);
    const known = new Set(names.map((n) => n.toLowerCase()));
    for (const v of formulaVars(node)) if (!known.has(v)) return `«${v}» در فرمول هست اما سنجه‌ای با این نام تعریف نشده است`;
    return null;
  } catch (e) {
    return e instanceof FormulaError ? e.message : "فرمول معتبر نیست";
  }
}

/** Evaluate with the parts' values (null propagates; ÷0 → null; ifnull replaces a null). */
export function evalFormula(node: FormulaNode, vars: Record<string, number | null | undefined>): number | null {
  const ev = (n: FormulaNode): number | null => {
    switch (n.t) {
      case "num":
        return n.v;
      case "var": {
        const v = vars[n.name];
        return v === null || v === undefined || !Number.isFinite(v) ? null : v;
      }
      case "neg": {
        const x = ev(n.x);
        return x === null ? null : -x;
      }
      case "bin": {
        const a = ev(n.a);
        const b = ev(n.b);
        if (a === null || b === null) return null;
        if (n.op === "+") return a + b;
        if (n.op === "-") return a - b;
        if (n.op === "*") return a * b;
        return b === 0 ? null : a / b;
      }
      case "call": {
        if (n.fn === "ifnull") {
          const a = ev(n.args[0]);
          return a === null ? ev(n.args[1]) : a;
        }
        const xs = n.args.map(ev);
        if (xs.some((x) => x === null)) return null;
        const v = xs as number[];
        if (n.fn === "min") return Math.min(...v);
        if (n.fn === "max") return Math.max(...v);
        if (n.fn === "abs") return Math.abs(v[0]);
        const d = Math.max(0, Math.min(6, Math.trunc(v[1] ?? 0)));
        const f = 10 ** d;
        return Math.round(v[0] * f) / f;
      }
    }
  };
  const r = ev(node);
  return r === null || !Number.isFinite(r) ? null : r;
}

/** Parse and evaluate in one go (null when the formula is invalid). */
export function computeFormula(src: string, vars: Record<string, number | null | undefined>): number | null {
  try {
    return evalFormula(parseFormula(src), vars);
  } catch {
    return null;
  }
}
