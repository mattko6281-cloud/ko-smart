// 일반형/매개변수 함수식 및 분수·소수 동치 수식 매칭 모듈 (v0.2.1)
// 지원 대상:
//  1) 분수·소수 동치 수치 함수식 (numeric-equivalent-match / expr-match):
//     - \frac{1}{2}, \dfrac{1}{2}, \tfrac{1}{2}, \cfrac{1}{2}, 0.5, 1/2, (1/2) 등 동등한 수치 계수 인식
//     - \displaystyle, \textstyle, \rm, \mathrm{...}, \left, \right 등 조판 명령이 수식 비교에 영향을 주지 않도록 분리 처리
//     - 중첩 중괄호/복합 분수식(\frac{x^{2}+1}{2}, \frac{1}{2}(x-1)^{2}, \frac{\frac{1}{2}x}{3} 등)을 균형 괄호 파서로 안전 변환 (원본 라벨 문자열은 절대 수정하지 않음)
//  2) 일반형/매개변수 함수식 구조 매칭 (structural-match):
//     - y=ax^2, y=a(x-p)^2+q, y=a(x-b)^2, y=mx+n, y=ax+b, y=ax^2+bx+c, x=k 및 분수 계수가 결합된 혼합형

import { minDistPolylines } from "../../smart-label-engine/src/geometry.mjs";
import { compileExpr } from "../../smart-label-prototype/src/expr.mjs";

const EPS = 1e-4;
const r2 = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

/**
 * 문자열 s 의 openIdx 위치에 있는 '{' 와 짝이 맞는 '}' 의 인덱스를 반환한다 (실패 시 -1).
 */
export function findBalancedBrace(s, openIdx) {
  if (s[openIdx] !== "{") return -1;
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * TeX 명령어 뒤의 단일 인자({ ... } 또는 단일 문자/숫자)를 추출한다.
 * @returns {{arg: string, nextIdx: number} | null}
 */
function readTexArg(s, startIdx) {
  let i = startIdx;
  while (i < s.length && /\s/.test(s[i])) i++;
  if (i >= s.length) return null;
  if (s[i] === "{") {
    const closeIdx = findBalancedBrace(s, i);
    if (closeIdx === -1) return null;
    return { arg: s.slice(i + 1, closeIdx), nextIdx: closeIdx + 1 };
  }
  // 중괄호 없는 약식 표기 (예: \frac12 의 '1', '2')
  if (s[i] === "\\") {
    const m = /^\\[a-zA-Z]+/.exec(s.slice(i));
    if (!m) return null;
    return { arg: m[0], nextIdx: i + m[0].length };
  }
  return { arg: s[i], nextIdx: i + 1 };
}

/**
 * 단일 인자 조판 래퍼(\mathrm{...}, \mathbf{...}, \mathit{...}, \text{...} 등)를 균형 중괄호 기준으로 벗겨낸다.
 */
function unwrapFontCommands(input) {
  let s = input;
  const cmdRe = /\\(?:mathrm|mathbf|mathit|mathsf|mathtt|textrm|textbf|textit|text|mbox)\b/;
  let safety = 0;
  while (safety++ < 50) {
    const m = cmdRe.exec(s);
    if (!m) break;
    const argStart = m.index + m[0].length;
    const parsed = readTexArg(s, argStart);
    if (!parsed) break;
    s = s.slice(0, m.index) + parsed.arg + s.slice(parsed.nextIdx);
  }
  return s;
}

/**
 * \frac, \dfrac, \tfrac, \cfrac 를 균형 중괄호 기반으로 재귀 변환하여 ((분자)/(분모)) 형태로 만든다.
 * 단순 정규식 치환이 아니므로 분자·분모 내부에 x^{2}, 중첩 분수, 괄호식이 있어도 손상되지 않는다.
 */
function replaceFractionsBalanced(input) {
  let s = input;
  const fracRe = /\\(?:d|t|c)?frac(?![a-zA-Z])/;
  let safety = 0;
  while (safety++ < 100) {
    const m = fracRe.exec(s);
    if (!m) break;
    const afterCmd = m.index + m[0].length;
    const numParsed = readTexArg(s, afterCmd);
    if (!numParsed) return { ok: false, text: s, error: "분수 명령(\\frac/\\dfrac/\\tfrac)의 분자 중괄호가 닫히지 않았거나 누락됨" };
    const denParsed = readTexArg(s, numParsed.nextIdx);
    if (!denParsed) return { ok: false, text: s, error: "분수 명령(\\frac/\\dfrac/\\tfrac)의 분모 중괄호가 닫히지 않았거나 누락됨" };

    const innerNum = replaceFractionsBalanced(numParsed.arg);
    if (!innerNum.ok) return innerNum;
    const innerDen = replaceFractionsBalanced(denParsed.arg);
    if (!innerDen.ok) return innerDen;

    const replacement = `((${innerNum.text})/(${innerDen.text}))`;
    s = s.slice(0, m.index) + replacement + s.slice(denParsed.nextIdx);
  }
  return { ok: true, text: s, error: null };
}

/**
 * 지수 표기 ^{...} 또는 _ 아래첨자 표기를 균형 중괄호 기반으로 변환한다.
 */
function replaceSuperscriptsBalanced(input) {
  let s = "";
  let i = 0;
  while (i < input.length) {
    if (input[i] === "^" && input[i + 1] === "{") {
      const closeIdx = findBalancedBrace(input, i + 1);
      if (closeIdx === -1) return { ok: false, text: input, error: "지수(^{...})의 중괄호가 닫히지 않음" };
      const inner = replaceSuperscriptsBalanced(input.slice(i + 2, closeIdx));
      if (!inner.ok) return inner;
      s += `^(${inner.text})`;
      i = closeIdx + 1;
    } else {
      s += input[i];
      i++;
    }
  }
  return { ok: true, text: s, error: null };
}

/**
 * TeX 라벨 문자열을 수학적 비교 전용 내부 문자열로 정규화한다.
 * (원본 노드의 label 문자열은 절대 변경하지 않는다.)
 */
export function normalizeMathLabelWithStatus(rawLabel) {
  if (!rawLabel || typeof rawLabel !== "string") {
    return { ok: false, normalized: "", error: "빈 라벨 문자열" };
  }
  let s = String(rawLabel)
    .replace(/\$/g, "")
    .replace(/\u2212/g, "-") // 유니코드 마이너스
    .replace(/\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle|rm|bf|it|normalfont)\b/g, "")
    .replace(/\\(?:left|right|[bB]ig{1,2}l?|[bB]ig{1,2}r?|[bB]ig{1,2})\b/g, "")
    .replace(/\\(?:cdot|times)\b/g, "*")
    .replace(/\\(?:,|;|:|!|quad|qquad)\b/g, "")
    .replace(/\\[ ,;!]/g, "");

  s = unwrapFontCommands(s);

  const fracRes = replaceFractionsBalanced(s);
  if (!fracRes.ok) {
    return { ok: false, normalized: fracRes.text, error: fracRes.error };
  }
  s = fracRes.text;

  const supRes = replaceSuperscriptsBalanced(s);
  if (!supRes.ok) {
    return { ok: false, normalized: supRes.text, error: supRes.error };
  }
  s = supRes.text.replace(/\s+/g, "");

  // 남아있는 미지원 백슬래시 명령어가 있는지 확인
  const leftoverCmd = /\\[a-zA-Z]+/.exec(s);
  if (leftoverCmd) {
    return { ok: false, normalized: s, error: `지원되지 않는 TeX 명령어 포함(${leftoverCmd[0]})` };
  }

  // 중괄호가 남아있으면 소괄호로 통일하되 짝 검사
  let depth = 0;
  let normParens = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(" || ch === "{") {
      depth++;
      normParens += "(";
    } else if (ch === ")" || ch === "}") {
      depth--;
      if (depth < 0) return { ok: false, normalized: s, error: "닫는 괄호/중괄호 개수가 맞지 않음" };
      normParens += ")";
    } else {
      normParens += ch;
    }
  }
  if (depth !== 0) {
    return { ok: false, normalized: normParens, error: "여는 괄호/중괄호가 닫히지 않음" };
  }

  return { ok: true, normalized: normParens, error: null };
}

export function normalizeMathLabel(rawLabel) {
  return normalizeMathLabelWithStatus(rawLabel).normalized;
}

/**
 * 암묵 곱(*) 삽입:
 * - 숫자, 변수(x 또는 매개변수), ')' 뒤에 변수(x 또는 매개변수)나 '(' 가 오는 경우 '*' 삽입
 * - ')' 뒤에 숫자가 오는 경우 '*' 삽입
 */
export function insertImplicitMultiplication(rhs) {
  let out = "";
  for (let i = 0; i < rhs.length; i++) {
    const a = rhs[i], b = rhs[i + 1];
    out += a;
    if (!b) continue;
    const aIsNum = /[0-9.]/.test(a);
    const aIsVar = /[a-zA-Z]/.test(a);
    const aIsClose = a === ")";
    const bIsNum = /[0-9.]/.test(b);
    const bIsVar = /[a-zA-Z]/.test(b);
    const bIsOpen = b === "(";
    const prevIsCaret = rhs[i - 1] === "^";

    if ((aIsNum || aIsVar || aIsClose) && (bIsVar || bIsOpen) && !(aIsNum && bIsNum)) {
      out += "*";
    } else if (aIsClose && bIsNum && !prevIsCaret) {
      out += "*";
    }
  }
  return out;
}

/**
 * 라벨 수식을 수치 함수로 분석·컴파일하고, 파싱 성공 여부와 동치성 메타데이터를 반환한다.
 */
export function analyzeNumericLabelExpression(rawLabel) {
  const hasRawFrac = /\\(?:d|t|c)?frac\b/.test(String(rawLabel || ""));
  const normStatus = normalizeMathLabelWithStatus(rawLabel);
  if (!normStatus.ok) {
    return {
      parseOk: false,
      isEquation: false,
      lhs: null,
      normalizedExpr: normStatus.normalized,
      compiledExpr: null,
      fn: null,
      hasFractionOrDivision: hasRawFrac,
      hasSymbolicParams: false,
      parseError: normStatus.error,
    };
  }

  const norm = normStatus.normalized;
  const eqMatch = /^([xy])=(.+)$/.exec(norm);
  if (!eqMatch) {
    return {
      parseOk: false,
      isEquation: false,
      lhs: null,
      normalizedExpr: norm,
      compiledExpr: null,
      fn: null,
      hasFractionOrDivision: hasRawFrac,
      hasSymbolicParams: false,
      parseError: "y=... 또는 x=... 형태의 방정식이 아님",
    };
  }

  const lhs = eqMatch[1];
  const rhs = eqMatch[2];
  const hasDivision = hasRawFrac || rhs.includes("/");
  const otherVars = [...new Set((rhs.match(/[a-zA-Z]/g) || []).filter((ch) => ch !== "x"))];
  const hasSymbolicParams = otherVars.length > 0;

  if (lhs === "x") {
    // x = 상수 (예: x = -2, x = \frac{1}{2})
    if (!hasSymbolicParams && !rhs.includes("x")) {
      const fnConst = compileExpr(insertImplicitMultiplication(rhs));
      let val = null;
      if (fnConst) {
        try { val = fnConst(0); } catch { val = null; }
      }
      if (val !== null && Number.isFinite(val)) {
        return {
          parseOk: true,
          isEquation: true,
          lhs: "x",
          constantX: val,
          normalizedExpr: norm,
          compiledExpr: rhs,
          fn: null,
          hasFractionOrDivision: hasDivision,
          hasSymbolicParams: false,
          parseError: null,
        };
      }
    }
    return {
      parseOk: hasSymbolicParams,
      isEquation: true,
      lhs: "x",
      constantX: null,
      normalizedExpr: norm,
      compiledExpr: null,
      fn: null,
      hasFractionOrDivision: hasDivision,
      hasSymbolicParams,
      symbolicVars: otherVars,
      parseError: hasSymbolicParams ? null : "x=... 우변의 수치 계산 실패",
    };
  }

  // lhs === "y"
  const multRhs = insertImplicitMultiplication(rhs);
  if (hasSymbolicParams) {
    return {
      parseOk: true,
      isEquation: true,
      lhs: "y",
      normalizedExpr: norm,
      compiledExpr: multRhs,
      fn: null,
      hasFractionOrDivision: hasDivision,
      hasSymbolicParams: true,
      symbolicVars: otherVars,
      parseError: null,
    };
  }

  const fn = compileExpr(multRhs);
  if (!fn) {
    return {
      parseOk: false,
      isEquation: true,
      lhs: "y",
      normalizedExpr: norm,
      compiledExpr: multRhs,
      fn: null,
      hasFractionOrDivision: hasDivision,
      hasSymbolicParams: false,
      parseError: `수치 함수식 컴파일 실패(${multRhs})`,
    };
  }

  // 샘플 점에서 유한한 값인지 확인
  let evalOk = true;
  for (const testX of [-1.3, -0.5, 0.5, 1.3]) {
    try {
      const v = fn(testX);
      if (!Number.isFinite(v)) { evalOk = false; break; }
    } catch {
      evalOk = false;
      break;
    }
  }
  if (!evalOk) {
    return {
      parseOk: false,
      isEquation: true,
      lhs: "y",
      normalizedExpr: norm,
      compiledExpr: multRhs,
      fn: null,
      hasFractionOrDivision: hasDivision,
      hasSymbolicParams: false,
      parseError: `수치 함수식 평가 중 비유한값(0 나누기 등) 발생(${multRhs})`,
    };
  }

  return {
    parseOk: true,
    isEquation: true,
    lhs: "y",
    normalizedExpr: norm,
    compiledExpr: multRhs,
    fn,
    hasFractionOrDivision: hasDivision,
    hasSymbolicParams: false,
    parseError: null,
  };
}

/**
 * 분수(\frac, \dfrac, \tfrac) 등을 포함한 수치형 y=f(x) 라벨을 함수로 컴파일 (미지수가 있으면 null)
 */
export function compileNumericLabelFunction(rawLabel) {
  const res = analyzeNumericLabelExpression(rawLabel);
  return res.parseOk && res.fn ? res.fn : null;
}

/**
 * plot 문장의 수학적 구조(차수, 이차/일차/상수 계수 a,b,c, 꼭짓점 p,q, 대칭축 x=p 등)를 수치 피팅으로 추출한다.
 */
export function analyzePlotMathStructure(stmt) {
  if (!stmt || stmt.type !== "plot" || !stmt.fn || !Array.isArray(stmt.domain) || stmt.domain.length < 2) {
    return null;
  }
  const [d0, d1] = stmt.domain;
  if (!(Number.isFinite(d0) && Number.isFinite(d1)) || Math.abs(d1 - d0) < 1e-6) return null;

  const xs = [0, 0.25, 0.5, 0.75, 1].map((t) => d0 + (d1 - d0) * t);
  const ys = [];
  for (const x of xs) {
    let y;
    try { y = stmt.fn(x); } catch { return null; }
    if (!Number.isFinite(y)) return null;
    ys.push(y);
  }

  const x0 = xs[0], x1 = xs[2], x2 = xs[4];
  const y0 = ys[0], y1 = ys[2], y2 = ys[4];
  const denom0 = (x0 - x1) * (x0 - x2);
  const denom1 = (x1 - x0) * (x1 - x2);
  const denom2 = (x2 - x0) * (x2 - x1);
  if (Math.abs(denom0) < 1e-12 || Math.abs(denom1) < 1e-12 || Math.abs(denom2) < 1e-12) return null;

  const l0 = y0 / denom0, l1 = y1 / denom1, l2 = y2 / denom1_fix(x2, x0, x1, denom2);
  const A = l0 + l1 + l2;
  const B = -(l0 * (x1 + x2) + l1 * (x0 + x2) + l2 * (x0 + x1));
  const C = l0 * x1 * x2 + l1 * x0 * x2 + l2 * x0 * x1;

  let maxResidual = 0;
  for (let i = 0; i < xs.length; i++) {
    const pred = A * xs[i] * xs[i] + B * xs[i] + C;
    maxResidual = Math.max(maxResidual, Math.abs(ys[i] - pred));
  }
  if (maxResidual > 1e-3) {
    return { kind: "non-polynomial", degree: null, maxResidual };
  }

  if (Math.abs(A) > EPS) {
    const p = -B / (2 * A);
    const q = C - (B * B) / (4 * A);
    return {
      kind: "quadratic",
      degree: 2,
      a: r2(A),
      b: r2(B),
      c: r2(C),
      rawA: A,
      rawB: B,
      rawC: C,
      vertex: [r2(p), r2(q)],
      rawVertex: [p, q],
      axisOfSymmetryX: r2(p),
      aSign: A > 0 ? 1 : -1,
      vertexAtOrigin: Math.abs(p) <= EPS && Math.abs(q) <= EPS,
      vertexOnXAxis: Math.abs(q) <= EPS && Math.abs(p) > EPS,
      vertexOnYAxis: Math.abs(p) <= EPS && Math.abs(q) > EPS,
      passesOrigin: Math.abs(C) <= EPS,
      yMin: Math.min(...ys),
      yMax: Math.max(...ys),
    };
  }

  if (Math.abs(B) > EPS) {
    return {
      kind: "linear",
      degree: 1,
      m: r2(B),
      n: r2(C),
      rawM: B,
      rawN: C,
      mSign: B > 0 ? 1 : -1,
      passesOrigin: Math.abs(C) <= EPS,
      xIntercept: r2(-C / B),
      yIntercept: r2(C),
      yMin: Math.min(...ys),
      yMax: Math.max(...ys),
    };
  }

  return {
    kind: "constant",
    degree: 0,
    c: r2(C),
    rawC: C,
  };
}

function denom1_fix(_x2, _x0, _x1, denom2) {
  return denom2;
}

/**
 * 구조 템플릿 파싱 전에 순수 수치 분수 부분식 ((1)/(2)) 등을 소수 문자열로 접어준다(fold).
 */
function foldConstantNumericFractions(s) {
  return s.replace(/\(\(([-+]?(?:\d+\.?\d*|\.\d+))\)\/\(([-+]?(?:\d+\.?\d*|\.\d+))\)\)/g, (all, num, den) => {
    const d = Number(den);
    if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return all;
    const v = Number(num) / d;
    return String(Math.round(v * 1e6) / 1e6);
  });
}

/**
 * 일반형/매개변수 수식 라벨의 구조 템플릿 파싱
 */
export function parseLabelStructureTemplate(rawLabel) {
  const normStatus = normalizeMathLabelWithStatus(rawLabel);
  if (!normStatus.ok || !normStatus.normalized) return null;
  const norm = foldConstantNumericFractions(normStatus.normalized).replace(/\^\(2\)/g, "^2");

  // 수치형 함수(미지수 없음)는 expr-match / numeric-equivalent-match 대상이므로 제외
  if (compileNumericLabelFunction(rawLabel)) return null;

  const SYM = String.raw`[a-zA-Z]`;
  const NUM = String.raw`(?:\d+\.?\d*|\.\d+)`;
  const COEF = String.raw`[-+]?(?:${NUM}|${SYM})`;

  // 1) 수직선: x=k, x=a 등
  if (new RegExp(String.raw`^x=[-+]?${SYM}(?:_\d+)?$`).test(norm)) {
    return {
      template: "vertical-symbolic",
      desc: `수직선(${norm})`,
      degree: null,
      strokeKindRequired: "verticalLine",
    };
  }

  if (!norm.startsWith("y=")) return null;
  const rhs = norm.slice(2);

  // 2) y = ax^2 형태 (예: y=ax^2, y=-ax^2, y=kx^2)
  const mQuadOrigin = new RegExp(String.raw`^([-+]?)(${SYM})x\^2$`).exec(rhs);
  if (mQuadOrigin) {
    return {
      template: "quad-origin",
      desc: `원점 꼭짓점 이차함수(${norm})`,
      degree: 2,
      paramLead: mQuadOrigin[2],
      explicitMinus: mQuadOrigin[1] === "-",
      requireVertexAtOrigin: true,
    };
  }

  // 3) y = a(x - p)^2 형태 (예: y=a(x-b)^2, y=a(x-p)^2, y=a(x+b)^2, 또는 a나 p가 숫자/분수인 혼합형)
  const mQuadXVertex = new RegExp(String.raw`^(${COEF})?\(x([-+])(${NUM}|${SYM})\)\^2$`).exec(rhs);
  if (mQuadXVertex) {
    const leadRaw = mQuadXVertex[1] || "";
    const signOp = mQuadXVertex[2];
    const shiftRaw = mQuadXVertex[3];
    const fixedA = leadRaw && /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(leadRaw) ? Number(leadRaw) : null;
    const fixedP = /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(shiftRaw)
      ? (signOp === "-" ? Number(shiftRaw) : -Number(shiftRaw))
      : null;
    return {
      template: "quad-xvertex",
      desc: `x축 꼭짓점 이차함수(${norm})`,
      degree: 2,
      requireVertexOnXAxis: true,
      fixedA,
      fixedP,
    };
  }

  // 4) y = a(x - p)^2 + q 형태 (예: y=a(x-p)^2+q, y=a(x-b)^2+c, 또는 일부 상수가 숫자/분수인 혼합형)
  const mQuadVertex = new RegExp(String.raw`^(${COEF})?\(x([-+])(${NUM}|${SYM})\)\^2([-+])(${NUM}|${SYM})$`).exec(rhs);
  if (mQuadVertex) {
    const leadRaw = mQuadVertex[1] || "";
    const signP = mQuadVertex[2];
    const pRaw = mQuadVertex[3];
    const signQ = mQuadVertex[4];
    const qRaw = mQuadVertex[5];
    const fixedA = leadRaw && /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(leadRaw) ? Number(leadRaw) : null;
    const fixedP = /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(pRaw) ? (signP === "-" ? Number(pRaw) : -Number(pRaw)) : null;
    const fixedQ = /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(qRaw) ? (signQ === "+" ? Number(qRaw) : -Number(qRaw)) : null;
    return {
      template: "quad-vertex",
      desc: `표준형 이차함수(${norm})`,
      degree: 2,
      fixedA,
      fixedP,
      fixedQ,
    };
  }

  // 5) y = ax^2 + q 형태 (일차항 없이 상수항만 있는 이차함수: 대칭축 x=0, q!=0)
  const mQuadYVertex = new RegExp(String.raw`^(${COEF})?x\^2([-+])(${NUM}|${SYM})$`).exec(rhs);
  if (mQuadYVertex) {
    const leadRaw = mQuadYVertex[1] || "";
    const signQ = mQuadYVertex[2];
    const qRaw = mQuadYVertex[3];
    const fixedA = leadRaw === "-" ? -1 : leadRaw === "+" || leadRaw === "" ? null : /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(leadRaw) ? Number(leadRaw) : null;
    const fixedQ = /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(qRaw) ? (signQ === "+" ? Number(qRaw) : -Number(qRaw)) : null;
    return {
      template: "quad-yvertex",
      desc: `y축 꼭짓점 이차함수(${norm})`,
      degree: 2,
      requireVertexOnYAxis: true,
      requireVertexNotAtOrigin: true,
      fixedA,
      fixedQ,
    };
  }

  // 6) y = ax^2 + bx + c 형태 (예: y=ax^2+bx+c, y=-x^2+ax+b, y=ax^2+bx+8 등)
  const mQuadGeneral = new RegExp(String.raw`^(${COEF}|[-+])?x\^2([-+])(${COEF})?x(?:([-+])(${NUM}|${SYM}))?$`).exec(rhs);
  if (mQuadGeneral) {
    const aRaw = mQuadGeneral[1] || "";
    const signB = mQuadGeneral[2];
    const bRaw = mQuadGeneral[3] || "";
    const signC = mQuadGeneral[4] || null;
    const cRaw = mQuadGeneral[5] || null;

    let fixedA = null;
    if (aRaw === "-") fixedA = -1;
    else if (/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(aRaw)) fixedA = Number(aRaw);

    let fixedB = null;
    if (/^(?:\d+\.?\d*|\.\d+)$/.test(bRaw)) fixedB = signB === "-" ? -Number(bRaw) : Number(bRaw);

    let fixedC = cRaw === null ? 0 : null;
    if (cRaw !== null && /^(?:\d+\.?\d*|\.\d+)$/.test(cRaw)) {
      fixedC = signC === "-" ? -Number(cRaw) : Number(cRaw);
    }

    return {
      template: "quad-general",
      desc: `일반형 이차함수(${norm})`,
      degree: 2,
      fixedA,
      fixedB,
      fixedC,
    };
  }

  // 7) y = mx 형태 (원점 지나는 일차함수: y=mx, y=ax, y=kx)
  const mLinOrigin = new RegExp(String.raw`^([-+]?)(${SYM})x$`).exec(rhs);
  if (mLinOrigin) {
    return {
      template: "linear-origin",
      desc: `원점 통과 일차함수(${norm})`,
      degree: 1,
      requirePassesOrigin: true,
    };
  }

  // 8) y = mx + n 또는 y = ax + b 형태 (일차함수 일반형)
  const mLinGeneral = new RegExp(String.raw`^(${COEF}|[-+])?x([-+])(${NUM}|${SYM})$`).exec(rhs);
  if (mLinGeneral) {
    const mRaw = mLinGeneral[1] || "";
    const signN = mLinGeneral[2];
    const nRaw = mLinGeneral[3];

    let fixedM = null;
    if (mRaw === "-") fixedM = -1;
    else if (/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(mRaw)) fixedM = Number(mRaw);

    let fixedN = null;
    if (/^(?:\d+\.?\d*|\.\d+)$/.test(nRaw)) {
      fixedN = signN === "-" ? -Number(nRaw) : Number(nRaw);
    }

    return {
      template: "linear-general",
      desc: `일반형 일차함수(${norm})`,
      degree: 1,
      fixedM,
      fixedN,
    };
  }

  return null;
}

/**
 * 라벨의 구조 템플릿과 개별 곡선(stroke + mathStructure)의 정합성 검사
 */
export function checkStructuralCompatibility(tpl, stroke, mathStruct, node) {
  if (!tpl || !stroke) return { compatible: false, reason: "템플릿 또는 곡선 없음" };

  if (tpl.template === "vertical-symbolic") {
    const pts = stroke.pts || [];
    if (pts.length < 2) return { compatible: false, reason: "점 부족" };
    const dx = Math.abs(pts[pts.length - 1][0] - pts[0][0]);
    const dy = Math.abs(pts[pts.length - 1][1] - pts[0][1]);
    if (dx <= 1.0 && dy >= 5.0) {
      return { compatible: true, details: "수직선 기하 구조 일치" };
    }
    return { compatible: false, reason: "수직선이 아님" };
  }

  if (!mathStruct || mathStruct.degree !== tpl.degree) {
    return { compatible: false, reason: `차수 불일치(요구 degree=${tpl.degree}, 곡선 degree=${mathStruct ? mathStruct.degree : "null"})` };
  }

  if (tpl.degree === 2) {
    if (tpl.requireVertexAtOrigin && !mathStruct.vertexAtOrigin) {
      return { compatible: false, reason: `꼭짓점이 원점(0,0)이 아님(현재 꼭짓점=(${mathStruct.vertex[0]}, ${mathStruct.vertex[1]}))` };
    }
    if (tpl.requireVertexOnXAxis && !mathStruct.vertexOnXAxis) {
      return { compatible: false, reason: `꼭짓점이 x축 위(p!=0, q=0)가 아님(현재 꼭짓점=(${mathStruct.vertex[0]}, ${mathStruct.vertex[1]}))` };
    }
    if (tpl.requireVertexOnYAxis && !mathStruct.vertexOnYAxis) {
      return { compatible: false, reason: `꼭짓점이 y축 위(p=0, q!=0)가 아님(현재 꼭짓점=(${mathStruct.vertex[0]}, ${mathStruct.vertex[1]}))` };
    }
    if (tpl.fixedA !== null && tpl.fixedA !== undefined && Math.abs(mathStruct.rawA - tpl.fixedA) > 1e-3) {
      return { compatible: false, reason: `이차항 계수 불일치(요구 a=${tpl.fixedA}, 곡선 a=${mathStruct.a})` };
    }
    if (tpl.fixedB !== null && tpl.fixedB !== undefined && Math.abs(mathStruct.rawB - tpl.fixedB) > 1e-3) {
      return { compatible: false, reason: `일차항 계수 불일치(요구 b=${tpl.fixedB}, 곡선 b=${mathStruct.b})` };
    }
    if (tpl.fixedC !== null && tpl.fixedC !== undefined && Math.abs(mathStruct.rawC - tpl.fixedC) > 1e-3) {
      return { compatible: false, reason: `상수항 불일치(요구 c=${tpl.fixedC}, 곡선 c=${mathStruct.c})` };
    }
    if (tpl.fixedP !== null && tpl.fixedP !== undefined && Math.abs(mathStruct.rawVertex[0] - tpl.fixedP) > 1e-3) {
      return { compatible: false, reason: `대칭축 불일치(요구 p=${tpl.fixedP}, 곡선 p=${mathStruct.vertex[0]})` };
    }
    if (tpl.fixedQ !== null && tpl.fixedQ !== undefined && Math.abs(mathStruct.rawVertex[1] - tpl.fixedQ) > 1e-3) {
      return { compatible: false, reason: `꼭짓점 y좌표 불일치(요구 q=${tpl.fixedQ}, 곡선 q=${mathStruct.vertex[1]})` };
    }

    if (tpl.requireVertexAtOrigin && node && (node.at || node.bbox)) {
      const cy = node.at ? node.at[1] : (node.bbox.y0 + node.bbox.y1) / 2;
      if (mathStruct.aSign > 0 && cy < -15) {
        return { compatible: false, reason: `원점 꼭짓점 이차함수 부호/위치 상충(곡선 a=${mathStruct.a}>0 상반평면, 라벨 y=${r2(cy)}pt 하반평면)` };
      }
      if (mathStruct.aSign < 0 && cy > 15) {
        return { compatible: false, reason: `원점 꼭짓점 이차함수 부호/위치 상충(곡선 a=${mathStruct.a}<0 하반평면, 라벨 y=${r2(cy)}pt 상반평면)` };
      }
    }

    return {
      compatible: true,
      details: `이차함수 구조 일치(a=${mathStruct.a}, 꼭짓점=(${mathStruct.vertex[0]}, ${mathStruct.vertex[1]}), 대칭축 x=${mathStruct.axisOfSymmetryX})`,
    };
  }

  if (tpl.degree === 1) {
    if (tpl.requirePassesOrigin && !mathStruct.passesOrigin) {
      return { compatible: false, reason: `원점(0,0)을 지나지 않음(y절편=${mathStruct.n})` };
    }
    if (tpl.fixedM !== null && tpl.fixedM !== undefined && Math.abs(mathStruct.rawM - tpl.fixedM) > 1e-3) {
      return { compatible: false, reason: `기울기 불일치(요구 m=${tpl.fixedM}, 직선 m=${mathStruct.m})` };
    }
    if (tpl.fixedN !== null && tpl.fixedN !== undefined && Math.abs(mathStruct.rawN - tpl.fixedN) > 1e-3) {
      return { compatible: false, reason: `y절편 불일치(요구 n=${tpl.fixedN}, 직선 n=${mathStruct.n})` };
    }
    return {
      compatible: true,
      details: `일차함수 구조 일치(기울기 m=${mathStruct.m}, y절편 n=${mathStruct.n})`,
    };
  }

  return { compatible: false, reason: "지원되지 않는 차수" };
}

/**
 * 미배정 함수식 라벨들에 대해 구조적 매칭(structural-match)을 수행한다.
 */
export function runStructuralMatching(scene, unclaimedNodes, claimedStrokeIndices, classifyStrokeKindFn) {
  const results = new Map();
  const strokes = Array.isArray(scene && scene.strokes) ? scene.strokes : [];

  const plotCandidates = [];
  for (const s of strokes) {
    if (!s || s.kind === "axis" || claimedStrokeIndices.has(s.index)) continue;
    const strokeKind = classifyStrokeKindFn(s);
    const mathStruct = s.stmt && s.stmt.type === "plot" ? analyzePlotMathStructure(s.stmt) : null;
    plotCandidates.push({ stroke: s, strokeKind, mathStruct });
  }

  const nodeAnalyses = unclaimedNodes.map((n) => {
    const tpl = parseLabelStructureTemplate(n.label);
    const anchor = n.at || n.inlineAnchor || n.anchor || (n.bbox ? [(n.bbox.x0 + n.bbox.x1) / 2, (n.bbox.y0 + n.bbox.y1) / 2] : null);
    if (!tpl) {
      return { node: n, tpl: null, compatible: [], anchor };
    }
    const compatible = [];
    for (const cand of plotCandidates) {
      if (claimedStrokeIndices.has(cand.stroke.index)) continue;
      if (tpl.template !== "vertical-symbolic" && (!cand.stroke.stmt || cand.stroke.stmt.type !== "plot")) continue;
      const chk = checkStructuralCompatibility(tpl, cand.stroke, cand.mathStruct, n);
      if (chk.compatible) {
        const distPt = anchor
          ? r2(minDistPolylines([{ pts: [anchor, anchor], closed: false }], [{ pts: cand.stroke.pts, closed: false }]))
          : null;
        compatible.push({ ...cand, details: chk.details, distancePt: distPt });
      }
    }
    return { node: n, tpl, compatible, anchor };
  });

  const strokeContenders = new Map();
  for (const na of nodeAnalyses) {
    if (na.compatible.length === 1) {
      const idx = na.compatible[0].stroke.index;
      strokeContenders.set(idx, (strokeContenders.get(idx) || 0) + 1);
    }
  }

  for (const na of nodeAnalyses) {
    const { node: n, tpl, compatible } = na;
    if (!tpl) continue;

    if (compatible.length === 1) {
      const match = compatible[0];
      const contenders = strokeContenders.get(match.stroke.index) || 0;
      if (contenders > 1) {
        results.set(n.id, {
          how: "ambiguous-structural",
          stroke: match.stroke,
          strokeKind: match.strokeKind,
          confirmed: false,
          uncertain: true,
          nonMoveCategory: "매칭 불확실",
          template: tpl.template,
          templateDesc: tpl.desc,
          candidateCount: contenders,
          candidateStrokes: [match.stroke.index],
          reason: `동일한 ${tpl.desc} 곡선(#${match.stroke.index})에 대응 가능한 일반형 라벨이 ${contenders}개 존재하여 확정할 수 없음. 자동 이동 차단.`,
        });
        continue;
      }

      claimedStrokeIndices.add(match.stroke.index);
      results.set(n.id, {
        how: "structural-match",
        stroke: match.stroke,
        strokeKind: match.strokeKind,
        confirmed: true,
        uncertain: false,
        nonMoveCategory: null,
        template: tpl.template,
        templateDesc: tpl.desc,
        mathStructure: match.mathStruct,
        distancePt: match.distancePt,
        reason: `${tpl.desc} 구조 분석 결과 미배정 곡선 중 유일한 후보(#${match.stroke.index}: ${match.details})로 확정됨`,
      });
    } else if (compatible.length >= 2) {
      const sortedByDist = [...compatible].sort((a, b) => (a.distancePt ?? Infinity) - (b.distancePt ?? Infinity));
      const nearest = sortedByDist[0];
      const kindKo = tpl.degree === 2 ? "일반형 이차함수" : tpl.degree === 1 ? "일반형 일차함수" : "일반형 수식";
      results.set(n.id, {
        how: "ambiguous-structural",
        stroke: nearest.stroke,
        strokeKind: nearest.strokeKind,
        confirmed: false,
        uncertain: true,
        nonMoveCategory: "매칭 불확실",
        template: tpl.template,
        templateDesc: tpl.desc,
        candidateCount: compatible.length,
        candidateStrokes: compatible.map((c) => c.stroke.index),
        distancePt: nearest.distancePt,
        reason: `${kindKo} 후보가 ${compatible.length}개 존재하여 대응 곡선을 확정할 수 없음. 자동 이동 차단.`,
      });
    }
  }

  return results;
}
