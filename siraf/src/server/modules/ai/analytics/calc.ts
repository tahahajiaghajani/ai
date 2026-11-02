// Safe decimal calculator for the assistant's `calculate` tool: + − × ÷, parentheses, unary
// minus, percent (۲۰٪ = 0.2) and Persian scale words (هزار، میلیون، میلیارد، تریلیون). A tiny
// recursive-descent parser over decimal.js — no eval, no functions, no variables. Accepts Persian
// and Arabic digits, the Persian thousands separator «٬» and decimal separator «٫».
import { D, normalizeDigits } from "@shared/money";

type Dec = ReturnType<typeof D>;

export class CalcError extends Error {}

type Tok = { t: "num"; v: Dec } | { t: "op"; v: "+" | "-" | "*" | "/" } | { t: "(" } | { t: ")" } | { t: "%" } | { t: "scale"; v: Dec };

const SCALES: [string, string][] = [
  ["تریلیون", "1e12"],
  ["میلیارد", "1e9"],
  ["میلیون", "1e6"],
  ["هزار", "1e3"],
  ["درصد", "%"],
];

const MAX_LEN = 500;
const MAX_DEPTH = 24;

function tokenize(input: string): Tok[] {
  const s = normalizeDigits(input).replace(/[‌‏‎]/g, "").trim();
  if (!s) throw new CalcError("عبارتی برای محاسبه نیست");
  if (s.length > MAX_LEN) throw new CalcError("عبارت بیش از حد طولانی است");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.٫]/.test(c)) {
      let j = i;
      let raw = "";
      // digits with thousands separators (, ٬ _ and spaces between digit groups) and one decimal point
      while (j < s.length && /[0-9.٫,٬_]/.test(s[j])) {
        raw += s[j];
        j++;
      }
      const num = raw.replace(/[,٬_]/g, "").replace(/٫/g, ".");
      if (!/^(\d+\.?\d*|\.\d+)$/.test(num)) throw new CalcError(`عدد «${raw}» معتبر نیست`);
      out.push({ t: "num", v: D(num) });
      i = j;
      continue;
    }
    if ("+-−–".includes(c)) {
      out.push({ t: "op", v: c === "+" ? "+" : "-" });
      i++;
      continue;
    }
    if ("*×xX".includes(c)) {
      out.push({ t: "op", v: "*" });
      i++;
      continue;
    }
    if ("/÷".includes(c)) {
      out.push({ t: "op", v: "/" });
      i++;
      continue;
    }
    if (c === "(" || c === ")") {
      out.push({ t: c });
      i++;
      continue;
    }
    if (c === "%" || c === "٪") {
      out.push({ t: "%" });
      i++;
      continue;
    }
    const word = SCALES.find(([w]) => s.startsWith(w, i));
    if (word) {
      out.push(word[1] === "%" ? { t: "%" } : { t: "scale", v: D(word[1]) });
      i += word[0].length;
      continue;
    }
    throw new CalcError(`نویسهٔ «${c}» در عبارت مجاز نیست؛ فقط عدد، + − × ÷، پرانتز و درصد`);
  }
  if (out.length > 200) throw new CalcError("عبارت بیش از حد طولانی است");
  return out;
}

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}

  parse(): Dec {
    const v = this.expr(0);
    if (this.i < this.toks.length) throw new CalcError("عبارت کامل نیست یا نویسهٔ اضافه دارد");
    return v;
  }

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private expr(depth: number): Dec {
    let v = this.term(depth);
    for (let t = this.peek(); t && t.t === "op" && (t.v === "+" || t.v === "-"); t = this.peek()) {
      this.i++;
      const r = this.term(depth);
      v = t.v === "+" ? v.plus(r) : v.minus(r);
    }
    return v;
  }

  private term(depth: number): Dec {
    let v = this.unary(depth);
    for (let t = this.peek(); t && t.t === "op" && (t.v === "*" || t.v === "/"); t = this.peek()) {
      this.i++;
      const r = this.unary(depth);
      if (t.v === "/") {
        if (r.isZero()) throw new CalcError("تقسیم بر صفر");
        v = v.div(r);
      } else v = v.times(r);
    }
    return v;
  }

  private unary(depth: number): Dec {
    const t = this.peek();
    if (t && t.t === "op" && (t.v === "-" || t.v === "+")) {
      this.i++;
      const v = this.unary(depth);
      return t.v === "-" ? v.neg() : v;
    }
    return this.postfix(depth);
  }

  private postfix(depth: number): Dec {
    let v = this.primary(depth);
    for (let t = this.peek(); t && (t.t === "%" || t.t === "scale"); t = this.peek()) {
      this.i++;
      v = t.t === "%" ? v.div(100) : v.times(t.v);
    }
    return v;
  }

  private primary(depth: number): Dec {
    if (depth > MAX_DEPTH) throw new CalcError("پرانتزها بیش از حد تودرتو هستند");
    const t = this.peek();
    if (!t) throw new CalcError("عبارت ناقص است");
    if (t.t === "num") {
      this.i++;
      return t.v;
    }
    if (t.t === "(") {
      this.i++;
      const v = this.expr(depth + 1);
      if (this.peek()?.t !== ")") throw new CalcError("پرانتز بسته نشده است");
      this.i++;
      return v;
    }
    throw new CalcError("عبارت معتبر نیست");
  }
}

/** Evaluate an arithmetic expression exactly. Throws CalcError with a Persian message. */
export function evaluate(expression: string): Dec {
  return new Parser(tokenize(expression)).parse();
}
