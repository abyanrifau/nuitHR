/**
 * Pay item formulas, such as IF(unapproved_absences >= 3, amount * 0.5, amount).
 *
 * Nothing here runs the formula as code. It is read character by character
 * into a small tree that only knows numbers, the pay variables, + - * /,
 * comparisons and the functions IF, AND, OR, MIN, MAX and ROUND. The
 * database calculates that tree (private.pay_eval), so payroll and the test
 * panel always give the same answer. Used in the browser (checking as you
 * type) and on the server (before anything is saved).
 */

export const PAY_VARIABLES = [
  { key: "basic_salary", label: "Basic salary", hint: "The person's basic salary for the month" },
  { key: "amount", label: "Amount", hint: "This item's amount (or the person's own amount), or its result before the rules" },
  { key: "days_in_month", label: "Days in the month", hint: "Calendar days in the pay period" },
  { key: "working_days", label: "Working days", hint: "Working days in the pay period, from their schedule, less public holidays" },
  { key: "days_present", label: "Days present", hint: "Working days attended; a half day counts as half" },
  { key: "unapproved_absences", label: "Unapproved absences", hint: "Working days missed without approved time off" },
  { key: "approved_absences", label: "Approved absences", hint: "Working days on approved time off" },
  { key: "half_days", label: "Half days", hint: "Days marked as half days" },
  { key: "late_count", label: "Times late", hint: "Days they arrived late" },
  { key: "early_leaves", label: "Early leaves", hint: "Days they left early" },
  { key: "consecutive_unapproved_absences", label: "Unapproved absences in a row", hint: "Longest run of unapproved absences (rest days and holidays don't break a run)" },
  { key: "overtime_hours", label: "Overtime hours", hint: "Overtime that counts for pay (approved, within the monthly limit)" },
  { key: "unpaid_leave_days", label: "Unpaid leave days", hint: "Working days on approved unpaid time off" },
  { key: "years_of_service", label: "Years of service", hint: "Full years since they joined, at the end of the period" },
] as const;

export type PayVariable = (typeof PAY_VARIABLES)[number]["key"];
const VARIABLES = new Set<string>(PAY_VARIABLES.map((v) => v.key));

const FUNCTIONS: Record<string, { min: number; max: number; hint: string }> = {
  IF: { min: 3, max: 3, hint: "IF(condition, value if true, value if false)" },
  AND: { min: 2, max: 10, hint: "AND(condition, condition, …)" },
  OR: { min: 2, max: 10, hint: "OR(condition, condition, …)" },
  MIN: { min: 2, max: 10, hint: "MIN(a, b, …)" },
  MAX: { min: 2, max: 10, hint: "MAX(a, b, …)" },
  ROUND: { min: 1, max: 2, hint: "ROUND(value) or ROUND(value, decimals)" },
};
export const FORMULA_FUNCTIONS = Object.entries(FUNCTIONS).map(([name, f]) => ({ name, hint: f.hint }));

/** The tree the database calculates. The first element says what the node is. */
export type Node =
  | ["num", number]
  | ["var", string]
  | ["neg", Node]
  | ["+" | "-" | "*" | "/" | ">" | ">=" | "<" | "<=" | "=" | "!=", Node, Node]
  | ["IF", Node, Node, Node]
  | ["AND" | "OR" | "MIN" | "MAX", ...Node[]]
  | ["ROUND", Node]
  | ["ROUND", Node, Node];

export type ParseResult = { ok: true; ast: Node } | { ok: false; error: string; at: number };

type Tok = { t: "num"; v: number; at: number } | { t: "id"; v: string; at: number } | { t: "op"; v: string; at: number } | { t: "end"; at: number };

class FormulaError extends Error {
  constructor(
    message: string,
    public at: number,
  ) {
    super(message);
  }
}

function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function suggest(name: string) {
  const all = [...VARIABLES, ...Object.keys(FUNCTIONS)];
  // "lates" → late_count, "absences" → unapproved_absences
  const stem = name.toLowerCase().replace(/s$/, "");
  const near = stem.length >= 3 ? [...VARIABLES].find((k) => k.startsWith(stem) || k.includes(`_${stem}`) || k.endsWith(stem)) : undefined;
  if (near) return ` Did you mean ${near}?`;
  const best = all.map((k) => [k, distance(name.toLowerCase(), k.toLowerCase())] as const).sort((x, y) => x[1] - y[1])[0];
  return best && best[1] <= Math.max(2, Math.floor(name.length / 3)) ? ` Did you mean ${best[0]}?` : "";
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const at = i + 1;
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const text = src.slice(i, j);
      if (!/^(\d+(\.\d+)?|\.\d+)$/.test(text)) throw new FormulaError(`"${text}" isn't a number.`, at);
      out.push({ t: "num", v: Number(text), at });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j), at });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if ([">=", "<=", "!=", "<>", "=="].includes(two)) {
      out.push({ t: "op", v: two === "<>" ? "!=" : two === "==" ? "=" : two, at });
      i += 2;
      continue;
    }
    if ("+-*/()<>=,".includes(c)) {
      out.push({ t: "op", v: c, at });
      i++;
      continue;
    }
    if (c === "%") throw new FormulaError("Use * 0.5 for 50% (the % sign isn't used).", at);
    throw new FormulaError(`"${c}" can't be used in a formula.`, at);
  }
  out.push({ t: "end", at: src.length + 1 });
  return out;
}

/** Reads a formula into its tree, or explains the first problem and where it is (character position). */
export function parseFormula(src: string): ParseResult {
  const text = (src ?? "").trim();
  if (!text) return { ok: false, error: "Type a formula.", at: 1 };
  if (text.length > 500) return { ok: false, error: "Keep the formula under 500 characters.", at: 501 };
  let toks: Tok[];
  try {
    toks = tokenize(text);
  } catch (e) {
    const fe = e as FormulaError;
    return { ok: false, error: `${fe.message} (character ${fe.at})`, at: fe.at };
  }
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek().t === "op" && (peek() as { v: string }).v === v;
  const expect = (v: string, what: string) => {
    if (!isOp(v)) throw new FormulaError(`Expected ${what}`, peek().at);
    p++;
  };

  const compare = (): Node => {
    if (++depth > 40) throw new FormulaError("This formula is nested too deeply.", peek().at);
    let left = additive();
    const t = peek();
    if (t.t === "op" && [">", ">=", "<", "<=", "=", "!="].includes(t.v)) {
      p++;
      const right = additive();
      left = [t.v as ">", left, right];
      const n = peek();
      if (n.t === "op" && [">", ">=", "<", "<=", "=", "!="].includes(n.v))
        throw new FormulaError("Compare two things at a time; use AND(a > 1, a < 5) for a range.", n.at);
    }
    depth--;
    return left;
  };
  const additive = (): Node => {
    let left = multiplicative();
    while (isOp("+") || isOp("-")) {
      const op = (toks[p++] as { v: "+" | "-" }).v;
      left = [op, left, multiplicative()];
    }
    return left;
  };
  const multiplicative = (): Node => {
    let left = unary();
    while (isOp("*") || isOp("/")) {
      const op = (toks[p++] as { v: "*" | "/" }).v;
      left = [op, left, unary()];
    }
    return left;
  };
  const unary = (): Node => {
    if (isOp("-")) {
      p++;
      return ["neg", unary()];
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    return primary();
  };
  const primary = (): Node => {
    const t = peek();
    if (t.t === "num") {
      p++;
      return ["num", t.v];
    }
    if (t.t === "op" && t.v === "(") {
      p++;
      const inner = compare();
      expect(")", `a closing bracket ")" at character ${peek().at}`);
      return inner;
    }
    if (t.t === "id") {
      p++;
      const upper = t.v.toUpperCase();
      if (isOp("(")) {
        const fn = FUNCTIONS[upper];
        if (!fn) throw new FormulaError(`${t.v} isn't a function you can use.${suggest(t.v)} Allowed: IF, AND, OR, MIN, MAX, ROUND.`, t.at);
        p++;
        const args: Node[] = [];
        if (!isOp(")")) {
          args.push(compare());
          while (isOp(",")) {
            p++;
            args.push(compare());
          }
        }
        expect(")", `a closing bracket ")" or a comma at character ${peek().at}`);
        if (args.length < fn.min || args.length > fn.max)
          throw new FormulaError(`${upper} needs ${fn.min === fn.max ? fn.min : `${fn.min} to ${fn.max}`} values: ${fn.hint}.`, t.at);
        return [upper, ...args] as Node;
      }
      if (FUNCTIONS[upper]) throw new FormulaError(`${upper} needs brackets: ${FUNCTIONS[upper].hint}.`, t.at);
      const name = t.v.toLowerCase();
      if (!VARIABLES.has(name)) throw new FormulaError(`"${t.v}" isn't a variable.${suggest(t.v)}`, t.at);
      return ["var", name];
    }
    if (t.t === "end") throw new FormulaError("The formula ends too early.", t.at);
    throw new FormulaError(`Unexpected "${(t as { v: string }).v}"`, t.at);
  };

  try {
    const ast = compare();
    if (peek().t !== "end") {
      const t = peek() as { v: string; at: number };
      throw new FormulaError(`Unexpected "${t.v}". Is an operator such as * or a comma missing?`, t.at);
    }
    return { ok: true, ast };
  } catch (e) {
    const fe = e as FormulaError;
    const msg = fe.message.includes("character") ? fe.message : `${fe.message} (character ${fe.at})`;
    return { ok: false, error: msg, at: fe.at };
  }
}

/** Every variable a formula uses (to explain the result). */
export function formulaVariables(node: Node, out = new Set<string>()): Set<string> {
  if (node[0] === "var") out.add(node[1] as string);
  else if (node[0] !== "num") for (const child of node.slice(1)) formulaVariables(child as Node, out);
  return out;
}
