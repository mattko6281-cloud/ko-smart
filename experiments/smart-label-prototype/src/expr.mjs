// 수식 파서 (eval/Function 미사용). 지원: 숫자, x/\x, + - * / ^, 괄호/중괄호, 암묵 곱(옵션). 함수/미지수는 미지원 → null.

function tokenize(s, implicit) {
  const toks = []; let i = 0;
  const src = s.replace(/\\x/g, "x").replace(/\s+/g, "");
  while (i < src.length) {
    const c = src[i];
    if (/[0-9.]/.test(c)) { let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++; toks.push({ t: "n", v: Number(src.slice(i, j)) }); i = j; }
    else if (c === "x") { toks.push({ t: "x" }); i++; }
    else if ("+-*/^".includes(c)) { toks.push({ t: "o", v: c }); i++; }
    else if ("({".includes(c)) { toks.push({ t: "(" }); i++; }
    else if (")}".includes(c)) { toks.push({ t: ")" }); i++; }
    else return null; // 미지원 문자(함수명, 매개변수 등)
  }
  if (implicit) { // 암묵 곱 삽입: (n|x|')') 다음에 (n|x|'(')
    const out = [];
    for (let k = 0; k < toks.length; k++) {
      const a = toks[k], b = toks[k + 1]; out.push(a);
      if (b && (a.t === "n" || a.t === "x" || a.t === ")") && (b.t === "n" || b.t === "x" || b.t === "(") && !(a.t === "n" && b.t === "n")) out.push({ t: "o", v: "*" });
    }
    return out;
  }
  return toks;
}

function parse(toks) {
  let p = 0;
  const peek = () => toks[p];
  function expr() { let l = term(); while (peek() && peek().t === "o" && (peek().v === "+" || peek().v === "-")) { const op = toks[p++].v; const r = term(); const a = l; l = op === "+" ? (x) => a(x) + r(x) : (x) => a(x) - r(x); } return l; }
  function term() { let l = unary(); while (peek() && peek().t === "o" && (peek().v === "*" || peek().v === "/")) { const op = toks[p++].v; const r = unary(); const a = l; l = op === "*" ? (x) => a(x) * r(x) : (x) => a(x) / r(x); } return l; }
  function unary() { if (peek() && peek().t === "o" && (peek().v === "-" || peek().v === "+")) { const op = toks[p++].v; const u = unary(); return op === "-" ? (x) => -u(x) : u; } return power(); }
  function power() { const b = atom(); if (peek() && peek().t === "o" && peek().v === "^") { p++; const e = unary(); return (x) => Math.pow(b(x), e(x)); } return b; }
  function atom() {
    const t = toks[p++];
    if (!t) throw new Error("eof");
    if (t.t === "n") return () => t.v;
    if (t.t === "x") return (x) => x;
    if (t.t === "(") { const e = expr(); if (!toks[p] || toks[p].t !== ")") throw new Error("paren"); p++; return e; }
    throw new Error("bad token");
  }
  const f = expr();
  if (p !== toks.length) throw new Error("trailing");
  return f;
}

/** TikZ plot 식 → f(x) | null */
export function compileExpr(s) { try { const t = tokenize(s, false); return t ? parse(t) : null; } catch { return null; } }

/** 라벨 TeX("y=-3x^2+27") → f(x) | null. 매개변수(a,b,m,n,k)가 있으면 null. */
export function compileLabelFunction(label) {
  try {
    let s = label.replace(/\$/g, "").replace(/\\displaystyle|\\rm|\\mathrm/g, "");
    const m = /^\s*y\s*=(.*)$/.exec(s.replace(/\s+/g, "")); if (!m) return null;
    const t = tokenize(m[1], true); return t ? parse(t) : null;
  } catch { return null; }
}
