// ============================================================================
// KO-SMART 스마트 라벨 1차 중간 개선 — Unit 2 / 2+: 함수 표현식 및 매칭 범위 확장
// ============================================================================
// 세부 하위 단위(Sub-Units):
//  - Sub-Unit 2a (u2a):
//      * y=f(x), y=g(x) 단일 추상 함수 라벨 매칭 (복수 추상 라벨일 때는 자동 이동 차단)
//      * y=f(1), y=f(a) 상수 함수값 수평선(degree=0) 전용 매칭
//  - Sub-Unit 2b (u2b):
//      * y=x+k, y=-x+a 등에서 생략된 1차항 계수(+1, -1) 및 2차항 계수(+1, -1) 인식
//  - Sub-Unit 2c (u2c):
//      * TikZ plot 수식의 pow(base, exp) 함수 파싱 및 정의역 가드(음수 밑 + 비정수 지수 -> NaN)
//  - Sub-Unit 2d (u2d):
//      * 지수·로그 함수 수치 파싱: plot 의 ln(u), exp(u) 및 라벨의 \ln, \log_b(...) 변환
//      * 로그 진수(u > 0) 및 밑(b > 0, b != 1) 정의역 엄격 검사 (위반 시 NaN)
//      * 지수 구조 템플릿(y = a^x + b 등, a > 0, a != 1) 매칭 및 \log, \ln 글리프 확인 확장
//  - Sub-Unit 2e (u2e):
//      * 삼각함수·pi 수치 파싱: plot 의 sin/cos/tan(TikZ 기본 degree 모드), deg(...), 접미사 r(라디안),
//        라벨의 \sin, \cos, \tan(표준 라디안 모드), \pi, \sqrt{...}
//      * 탄젠트 점근선(|cos| < 1e-3 -> NaN) 가드 및 동일 주기함수 다중 브랜치(tan x 등) 매칭
//      * \sin, \cos, \tan, \pi, \alpha, \beta 등 확장 글리프 확인
//      * \begin{scope} \clip (...) rectangle (...); \end{scope} 가시 영역 폴리라인 클리핑
// ============================================================================

import { minDistPolylines } from "../../../../experiments/smart-label-engine/src/geometry.mjs";
import { expectedGlyphChars, normalizeSvgChars } from "../../../../experiments/smart-label-engine/src/tikz-nodes.mjs";
import { compileExpr as v01CompileExpr, compileLabelFunction as v01CompileLabelFunction } from "../../../../experiments/smart-label-prototype/src/expr.mjs";
import {
  findBalancedBrace,
  normalizeMathLabelWithStatus as v021NormalizeMathLabelWithStatus,
  analyzeNumericLabelExpression as v021AnalyzeNumericLabelExpression,
  analyzePlotMathStructure as v021AnalyzePlotMathStructure,
  parseLabelStructureTemplate as v021ParseLabelStructureTemplate,
  checkStructuralCompatibility as v021CheckStructuralCompatibility,
} from "../../../../experiments/smart-label-prototype-v021/src/structural-match.mjs";
import {
  PARAMS,
  classifyStrokeKind,
  endInfo,
  selectPreferredEnd,
  evaluateKeep,
  computeShiftForMove,
  clearanceToStroke,
  bboxGapRect,
} from "../../../../experiments/smart-label-prototype-v021/src/algorithm.mjs";
import {
  extractNumericConstantY,
  findMatchingHorizontalLineStrokesUnit3C,
  findMatchingVerticalLineStrokesUnit3C,
  classifyAxisParallelLineLabelUnit3C,
  planHorizontalLineLabelUnit3C,
  planVerticalLineLabelUnit3C,
} from "./unit3c-axis-lines.mjs";

const EPS = 1e-4;
const r2 = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

export const DEFAULT_UNIT2_FLAGS = {
  u2a: true, // y=f(x) 단일 추상 곡선 & y=f(1) 수평 상수선
  u2b: true, // y=x+k 생략된 +1/-1 계수
  u2c: true, // pow(base, exp) 파서
  u2d: true, // 지수·로그(ln, \log_b, y=a^x+b) 파싱 및 매칭
  u2e: true, // 삼각함수(sin, cos, tan, deg, r) 및 pi/sqrt 파싱·매칭 + scope clip 반영
  u3c: true, // Unit 3-C: 수평선(y=상수) 우측 끝(node[right]) 및 수직선(x=상수) 하단/상단 끝 표준 배치
  enableJointAxisOpt: true, // 함수식 라벨 배치와 축 길이 연장량의 공동 최적화
  enableAxisVarTheta: true, // CASE-008: 가로축 변수가 \theta 일 때만 \theta -> x 정규화
  enableSimpleFunctionLhs: true, // CASE-015: 단순 f(x)=... / g(x)=... 좌변 -> y=... 정규화
  enableResidualSingleCurve: true, // CASE-002: 구체 함수식 확정 후 남은 1:1 파생 추상 함수(y=-f'(x) 등) 잔여 곡선 매칭
  enableDiagonalSvgRecovery: true, // 대각 앵커(below left 등) + scale>=1.8 제한적 SVG 노드 복구
  enableRightAxisTipLineBelow: true, // 우측 x축 화살표 끝점 근방에서 우하향하는 감소 직선의 하단 여유 배치(후보 A)
  enableStep2MultiAbstractAnalysis: true, // CASE-004, CASE-010 등 다중 추상 함수 전역 1:1 매칭 및 3유형 안전 분류
  multiAbstractAction: "hold", // "hold" (기본값: 원본 유지) | "recommend" (사용자 추천 승인) | "swap" (사용자 교환 승인)
  allowFiniteSampleDerivativeType1: false, // 유한 샘플 수치 미분만으로 유형 1 자동 확정을 확대하지 않음 (기본 false -> 유형 2/Hold 처리)
};

function resolveFlags(flags = {}) {
  return { ...DEFAULT_UNIT2_FLAGS, ...(flags || {}) };
}

const DIAGONAL_ANCHOR_POSITIONS_UNIT2 = new Set([
  "below left",
  "below right",
  "above left",
  "above right",
  "north east",
  "north west",
  "south east",
  "south west",
]);

export function recoverDiagonalAnchorSvgNodesUnit2(scene, flags = DEFAULT_UNIT2_FLAGS) {
  const F = resolveFlags(flags);
  if (F.enableDiagonalSvgRecovery === false) return [];
  if (!scene || !scene.ok || !scene.analysis || !scene.geom) return [];
  const matching = scene.analysis.matching;
  if (!matching || !matching.sequentialTrusted) return [];

  const geomNodes = scene.geom.nodes || [];
  const anLabels = scene.analysis.labels || [];
  const claimedSvgIndices = new Set(
    (scene.nodes || [])
      .map((n) => n.svgIndex)
      .filter((idx) => idx !== null && idx !== undefined)
  );
  const recovered = [];

  for (let idx = 0; idx < (scene.nodes || []).length; idx++) {
    const n = scene.nodes[idx];
    if (!n || n.usable || n.fallbackAnchorFromBBox) continue;
    if (n.svgIndex !== null && n.svgIndex !== undefined) continue;
    if (n.kind === "inline" || !n.at || !n.label) continue;

    const posNorm = String(n.position || "").trim().replace(/\s+/g, " ");
    if (!DIAGONAL_ANCHOR_POSITIONS_UNIT2.has(posNorm)) continue;
    const hasSmallInnerSep = /inner\s+sep\s*=\s*([0-9.]+)\s*pt/.exec(String(n.optionsRaw || ""));
    if (hasSmallInnerSep && Number(hasSmallInnerSep[1]) <= 2.2) continue;

    const candSvg = geomNodes[idx];
    if (!candSvg || !candSvg.supported || candSvg.empty || !candSvg.bboxTikz) continue;
    if (claimedSvgIndices.has(candSvg.index)) continue;

    const scaleX = candSvg.scaleX || scene.units?.everyNodeScale || 1;
    const scaleY = candSvg.scaleY || scene.units?.everyNodeScale || 1;
    if (Math.min(scaleX, scaleY) < 1.8) continue;

    const expGlyph = expectedGlyphChars(n.label);
    const gotGlyph = normalizeSvgChars(candSvg.chars || "");
    if (!expGlyph.reliable || !gotGlyph || expGlyph.normalized.length < 3) continue;
    if (expGlyph.normalized !== gotGlyph) continue;

    const otherSameGlyphUnclaimed = geomNodes.filter(
      (g) =>
        g.index !== candSvg.index &&
        !claimedSvgIndices.has(g.index) &&
        normalizeSvgChars(g.chars || "") === gotGlyph
    );
    if (otherSameGlyphUnclaimed.length > 0) continue;

    const dxShift = (n.xshift || 0) * scaleX;
    const dyShift = (n.yshift || 0) * scaleY;
    const expectedPt = [n.at[0] + dxShift, n.at[1] + dyShift];
    const bb = candSvg.bboxTikz;
    const dx = Math.max(bb.x0 - expectedPt[0], 0, expectedPt[0] - bb.x1);
    const dy = Math.max(bb.y0 - expectedPt[1], 0, expectedPt[1] - bb.y1);
    const distPt = Math.hypot(dx, dy);

    const cx = (bb.x0 + bb.x1) / 2;
    const cy = (bb.y0 + bb.y1) / 2;
    const wantsLeft = posNorm.includes("left") || posNorm.includes("east");
    const wantsRight = posNorm.includes("right") || posNorm.includes("west");
    const wantsBelow = posNorm.includes("below") || posNorm.includes("north");
    const wantsAbove = posNorm.includes("above") || posNorm.includes("south");
    if (wantsLeft && !(cx < expectedPt[0])) continue;
    if (wantsRight && !(cx > expectedPt[0])) continue;
    if (wantsBelow && !(cy < expectedPt[1])) continue;
    if (wantsAbove && !(cy > expectedPt[1])) continue;

    if (dx <= 11.0 && dy <= 11.0 && distPt <= 15.5) {
      n.svgIndex = candSvg.index;
      n.bbox = { ...candSvg.bboxTikz };
      n.scale = [scaleX, scaleY];
      n.confidence = "confirmed";
      n.usable = true;
      n.usableBy = "unit2-diagonal-anchor-scale-order-glyph-confirmed";
      claimedSvgIndices.add(candSvg.index);

      const labEntry = anLabels.find((l) => l.id === n.id);
      if (labEntry && labEntry.matching) {
        labEntry.matching.svgNodeIndex = candSvg.index;
        labEntry.matching.confidence = "confirmed";
        labEntry.matching.usable = true;
      }

      recovered.push({
        id: n.id,
        label: n.label,
        svgIndex: candSvg.index,
        position: posNorm,
        scale: [scaleX, scaleY],
        dxPt: r2(dx),
        dyPt: r2(dy),
        distPt: r2(distPt),
      });
    }
  }

  scene.unit2RecoveredSvgNodes = recovered;
  return recovered;
}

export function detectHorizontalAxisVariableUnit2(scene) {
  if (!scene || !Array.isArray(scene.nodes)) return "x";
  for (const n of scene.nodes) {
    if (n.role === "axisLabel" || (n.stmt && n.stmt.arrow && n.kind === "inline")) {
      const raw0 = String(n.label || "").replace(/\$|\s+/g, "");
      if (raw0 === "\\theta" || raw0 === "theta") return "\\theta";
    }
    if (n.role !== "axisLabel") continue;
    const raw = String(n.label || "").replace(/\$/g, "").trim();
    const pos = n.at || n.inlineAnchor || n.anchor || (n.bbox ? [(n.bbox.x0 + n.bbox.x1) / 2, (n.bbox.y0 + n.bbox.y1) / 2] : null);
    if (pos) {
      const [px, py] = pos;
      if (Math.abs(py) <= Math.abs(px) * 0.5 + 15) {
        if (raw === "\\theta") return "\\theta";
        if (/^[a-zA-Z]$/.test(raw)) return raw;
      }
    }
  }
  const body = String(scene.body || "");
  if (/--\s*\([^)]+\)\s*node\[[^\]]*\]\s*\{\s*\$\\theta\$\s*\}/.test(body)) {
    return "\\theta";
  }
  return "x";
}

export function preprocessLabelForMatchingUnit2(rawLabel, scene, flags = DEFAULT_UNIT2_FLAGS) {
  const F = resolveFlags(flags);
  if (typeof rawLabel !== "string") {
    return { effectiveLabel: rawLabel, notes: [], simpleLhsApplied: false, axisThetaApplied: false };
  }
  let inner = rawLabel.trim();
  const hasDollar = inner.startsWith("$") && inner.endsWith("$") && inner.length >= 2;
  if (hasDollar) inner = inner.slice(1, -1).trim();

  const notes = [];
  let simpleLhsApplied = false;
  let axisThetaApplied = false;

  if (F.enableSimpleFunctionLhs) {
    const mSimpleLhs = /^(?:\\displaystyle\s*)?([fghFGH])\(\s*x\s*\)\s*=(.+)$/.exec(inner);
    if (mSimpleLhs) {
      const fnName = mSimpleLhs[1];
      const rhs = mSimpleLhs[2].trim();
      inner = `y=${rhs}`;
      simpleLhsApplied = true;
      notes.push(`단순 함수 좌변 ${fnName}(x)=... 확인 → 매칭 시 y=... 로 정규화`);
    }
  }

  if (F.enableAxisVarTheta && scene) {
    const horizVar = detectHorizontalAxisVariableUnit2(scene);
    if (horizVar === "\\theta" && /\\theta(?![a-zA-Z])/.test(inner) && !/(?<![a-zA-Z\\])x(?![a-zA-Z])/.test(inner)) {
      const mThetaLhs = /^(?:\\displaystyle\s*)?([fghFGH])\(\s*\\theta\s*\)\s*=(.+)$/.exec(inner);
      if (mThetaLhs && F.enableSimpleFunctionLhs) {
        inner = `y=${mThetaLhs[2].trim()}`;
        simpleLhsApplied = true;
      }
      inner = inner.replace(/\\theta(?![a-zA-Z])/g, " x");
      axisThetaApplied = true;
      notes.push("가로축 변수 \\theta 와 수식 독립변수 \\theta 일치 확인 → 매칭 시 x 로 정규화");
    }
  }

  const effectiveLabel = hasDollar ? `$${inner}$` : inner;
  return { effectiveLabel, notes, simpleLhsApplied, axisThetaApplied };

}

// ============================================================================
// 1. Sub-Unit 2c / 2d / 2e 통합 수식 토크나이저 & 파서 (eval/Function 미사용)
// ============================================================================

function safePow(base, exp) {
  if (!Number.isFinite(base) || !Number.isFinite(exp)) return NaN;
  if (base < 0 && Math.abs(exp - Math.round(exp)) > 1e-9) return NaN;
  if (base === 0 && exp <= 0) return exp === 0 ? 1 : NaN;
  return Math.pow(base, exp);
}

function callUnaryMathFn(fnName, val) {
  if (!Number.isFinite(val)) return NaN;
  switch (fnName) {
    case "ln":
    case "log":
      // 진수 조건: val > 0
      return val > 0 ? Math.log(val) : NaN;
    case "exp":
      return Math.exp(val);
    case "sqrt":
      return val >= 0 ? Math.sqrt(val) : NaN;
    case "abs":
      return Math.abs(val);
    case "deg":
      // TikZ deg(x): 라디안 -> 도(degree)
      return (val * 180) / Math.PI;
    case "rad":
      // TikZ rad(x): 도(degree) -> 라디안
      return (val * Math.PI) / 180;
    case "sin":
      // TikZ plot 기본 sin(d): degree 입력
      return Math.sin((val * Math.PI) / 180);
    case "cos":
      // TikZ plot 기본 cos(d): degree 입력
      return Math.cos((val * Math.PI) / 180);
    case "tan": {
      // TikZ plot 기본 tan(d): degree 입력 + 점근선 가드
      const rad = (val * Math.PI) / 180;
      const c = Math.cos(rad);
      if (Math.abs(c) < 1e-3) return NaN;
      return Math.sin(rad) / c;
    }
    case "sinr":
      // TeX 라벨 표준 라디안 sin
      return Math.sin(val);
    case "cosr":
      // TeX 라벨 표준 라디안 cos
      return Math.cos(val);
    case "tanr": {
      // TeX 라벨 표준 라디안 tan + 점근선 가드
      const c = Math.cos(val);
      if (Math.abs(c) < 1e-3) return NaN;
      return Math.sin(val) / c;
    }
    default:
      return NaN;
  }
}

/**
 * Unit 2 확장 토크나이저:
 * - u2c: pow(a, b) 및 쉼표(,) 토큰 지원
 * - u2d: ln, exp 지원
 * - u2e: pi 상수, sqrt, deg, rad, sin, cos, tan, sinr, cosr, tanr 및 접미사 r(라디안->도) 지원
 */
export function tokenizeExprUnit2(s, implicit = false, flags = DEFAULT_UNIT2_FLAGS) {
  const F = resolveFlags(flags);
  if (typeof s !== "string") return null;

  const allowedFns = new Set();
  if (F.u2c) allowedFns.add("pow");
  if (F.u2d) {
    allowedFns.add("ln");
    allowedFns.add("log");
    allowedFns.add("exp");
  }
  if (F.u2e) {
    allowedFns.add("sqrt");
    allowedFns.add("abs");
    allowedFns.add("deg");
    allowedFns.add("rad");
    allowedFns.add("sin");
    allowedFns.add("cos");
    allowedFns.add("tan");
    allowedFns.add("sinr");
    allowedFns.add("cosr");
    allowedFns.add("tanr");
  }

  // \x 를 변수 x 로 치환하되, 접미사 r (예: \x r, (2*\x) r)을 보존하기 위해 먼저 정리
  const src = s.replace(/\\x\b/g, "x").replace(/\\pi\b/g, "pi").replace(/\s+/g, "");
  const toks = [];
  let i = 0;

  while (i < src.length) {
    const c = src[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const numVal = Number(src.slice(i, j));
      if (!Number.isFinite(numVal)) return null;
      toks.push({ t: "n", v: numVal });
      i = j;
    } else if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      const word = src.slice(i, j);
      if (word === "x") {
        toks.push({ t: "x" });
      } else if (F.u2e && word === "xr") {
        // "\x r" 이 공백 제거로 "xr" 이 된 경우: x 뒤에 접미사 r 연산자
        toks.push({ t: "x" });
        toks.push({ t: "postfix_r" });
      } else if (F.u2e && word === "r" && toks.length > 0 && (toks[toks.length - 1].t === "n" || toks[toks.length - 1].t === "x" || toks[toks.length - 1].t === ")")) {
        toks.push({ t: "postfix_r" });
      } else if (F.u2e && word === "pi") {
        toks.push({ t: "n", v: Math.PI });
      } else if (F.u2e && word === "pir") {
        toks.push({ t: "n", v: Math.PI });
        toks.push({ t: "postfix_r" });
      } else if (allowedFns.has(word)) {
        toks.push({ t: "fn", v: word });
      } else {
        return null; // 미지원 식별자 또는 기호 매개변수
      }
      i = j;
    } else if ("+-*/^".includes(c)) {
      toks.push({ t: "o", v: c });
      i++;
    } else if (c === "," && F.u2c) {
      toks.push({ t: "," });
      i++;
    } else if ("({".includes(c)) {
      toks.push({ t: "(" });
      i++;
    } else if (")}".includes(c)) {
      toks.push({ t: ")" });
      i++;
    } else {
      return null;
    }
  }

  if (implicit) {
    const out = [];
    for (let k = 0; k < toks.length; k++) {
      const a = toks[k];
      const b = toks[k + 1];
      out.push(a);
      if (!b) continue;
      const aEndsValue = a.t === "n" || a.t === "x" || a.t === ")" || a.t === "postfix_r";
      const bStartsValue = b.t === "n" || b.t === "x" || b.t === "(" || b.t === "fn";
      if (aEndsValue && bStartsValue && !(a.t === "n" && b.t === "n")) {
        out.push({ t: "o", v: "*" });
      }
    }
    return out;
  }
  return toks;
}

function parseTokensUnit2(toks) {
  let p = 0;
  const peek = () => toks[p];

  function expr() {
    let l = term();
    while (peek() && peek().t === "o" && (peek().v === "+" || peek().v === "-")) {
      const op = toks[p++].v;
      const r = term();
      const a = l;
      l = op === "+" ? (x) => a(x) + r(x) : (x) => a(x) - r(x);
    }
    return l;
  }

  function term() {
    let l = unary();
    while (peek() && peek().t === "o" && (peek().v === "*" || peek().v === "/")) {
      const op = toks[p++].v;
      const r = unary();
      const a = l;
      l = op === "*" ? (x) => a(x) * r(x) : (x) => {
        const den = r(x);
        return Math.abs(den) < 1e-12 ? NaN : a(x) / den;
      };
    }
    return l;
  }

  function unary() {
    if (peek() && peek().t === "o" && (peek().v === "-" || peek().v === "+")) {
      const op = toks[p++].v;
      const u = unary();
      return op === "-" ? (x) => -u(x) : u;
    }
    return power();
  }

  function power() {
    const b = postfix();
    if (peek() && peek().t === "o" && peek().v === "^") {
      p++;
      const e = unary();
      return (x) => safePow(b(x), e(x));
    }
    return b;
  }

  function postfix() {
    let atomFn = atom();
    while (peek() && peek().t === "postfix_r") {
      p++;
      const prev = atomFn;
      // TikZ 접미사 r: 라디안 값을 degree 로 변환
      atomFn = (x) => (prev(x) * 180) / Math.PI;
    }
    return atomFn;
  }

  function atom() {
    const t = toks[p++];
    if (!t) throw new Error("eof");
    if (t.t === "n") return () => t.v;
    if (t.t === "x") return (x) => x;
    if (t.t === "fn") {
      const fnName = t.v;
      if (!toks[p] || toks[p].t !== "(") throw new Error("fn expects (");
      p++; // consume '('
      const arg1 = expr();
      if (fnName === "pow") {
        if (!toks[p] || toks[p].t !== ",") throw new Error("pow expects ,");
        p++; // consume ','
        const arg2 = expr();
        if (!toks[p] || toks[p].t !== ")") throw new Error("pow expects )");
        p++; // consume ')'
        return (x) => safePow(arg1(x), arg2(x));
      }
      if (!toks[p] || toks[p].t !== ")") throw new Error("fn expects )");
      p++; // consume ')'
      return (x) => callUnaryMathFn(fnName, arg1(x));
    }
    if (t.t === "(") {
      const e = expr();
      if (!toks[p] || toks[p].t !== ")") throw new Error("paren");
      p++;
      return e;
    }
    throw new Error("bad token");
  }

  const f = expr();
  if (p !== toks.length) throw new Error("trailing");
  return f;
}

/**
 * [Unit 2] TikZ plot 수식 컴파일러 (Sub-Unit 2c/2d/2e 플래그 연동)
 */
export function compileExprUnit2(s, flags = DEFAULT_UNIT2_FLAGS) {
  const F = resolveFlags(flags);
  if (!F.u2c && !F.u2d && !F.u2e) {
    return v01CompileExpr(s);
  }
  try {
    const t = tokenizeExprUnit2(s, false, F);
    return t ? parseTokensUnit2(t) : null;
  } catch {
    return null;
  }
}

/**
 * 상수 수식(예: {-pi/2}, {3*pi/2}, {sin(deg(2*pi/8))}, {-sqrt(3)})을 평가하여 수치 반환
 */
export function evalConstantMathExprUnit2(rawExpr, flags = DEFAULT_UNIT2_FLAGS) {
  if (typeof rawExpr === "number") return Number.isFinite(rawExpr) ? rawExpr : null;
  if (typeof rawExpr !== "string") return null;
  let cleaned = rawExpr.trim();
  if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (!cleaned) return null;
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) return Number(cleaned);
  // 변수 x 가 포함된 식은 상수가 아님
  if (/\\x\b|\bx\b/.test(cleaned)) return null;
  const fn = compileExprUnit2(cleaned, flags);
  if (!fn) return null;
  try {
    const val = fn(0);
    return Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

// ============================================================================
// 2. TeX 라벨 정규화 확장 (Sub-Unit 2d 로그/자연로그 & Sub-Unit 2e 삼각/pi/sqrt)
// ============================================================================

function findBalancedParen(s, openIdx) {
  const openCh = s[openIdx];
  const closeCh = openCh === "(" ? ")" : openCh === "{" ? "}" : null;
  if (!closeCh) return -1;
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === openCh) depth++;
    else if (s[i] === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function readTexGroupOrToken(s, startIdx) {
  let i = startIdx;
  while (i < s.length && /\s/.test(s[i])) i++;
  if (i >= s.length) return null;
  if (s[i] === "{" || s[i] === "(") {
    const closeIdx = findBalancedParen(s, i);
    if (closeIdx === -1) return null;
    return { arg: s.slice(i + 1, closeIdx), nextIdx: closeIdx + 1, bracketed: true };
  }
  if (s[i] === "\\") {
    const m = /^\\[a-zA-Z]+/.exec(s.slice(i));
    if (!m) return null;
    return { arg: m[0], nextIdx: i + m[0].length, bracketed: false };
  }
  return { arg: s[i], nextIdx: i + 1, bracketed: false };
}

/**
 * \sin 2x, \tan x 처럼 괄호 없이 쓰인 단항 함수 인자를 읽어낸다 (최상위 + 또는 - 전까지).
 */
function readUnparenthesizedMathArg(s, startIdx) {
  let i = startIdx;
  while (i < s.length && /\s/.test(s[i])) i++;
  if (i >= s.length) return null;
  if (s[i] === "(" || s[i] === "{") {
    return readTexGroupOrToken(s, i);
  }
  let start = i;
  if (s[i] === "+" || s[i] === "-") i++;
  let depth = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "(" || ch === "{") depth++;
    else if (ch === ")" || ch === "}") {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && (ch === "+" || ch === "-" || ch === "=")) {
      break;
    }
    i++;
  }
  const arg = s.slice(start, i).trim();
  if (!arg) return null;
  return { arg, nextIdx: i, bracketed: false };
}

function unwrapFontCommandsUnit2(input) {
  let s = input;
  const cmdRe = /\\(?:mathrm|mathbf|mathit|mathsf|mathtt|textrm|textbf|textit|text|mbox)\b/;
  let safety = 0;
  while (safety++ < 50) {
    const m = cmdRe.exec(s);
    if (!m) break;
    const argStart = m.index + m[0].length;
    const parsed = readTexGroupOrToken(s, argStart);
    if (!parsed) break;
    s = s.slice(0, m.index) + parsed.arg + s.slice(parsed.nextIdx);
  }
  return s;
}

function replaceFractionsBalancedUnit2(input) {
  let s = input;
  const fracRe = /\\(?:d|t|c)?frac(?![a-zA-Z])/;
  let safety = 0;
  while (safety++ < 100) {
    const m = fracRe.exec(s);
    if (!m) break;
    const afterCmd = m.index + m[0].length;
    const numParsed = readTexGroupOrToken(s, afterCmd);
    if (!numParsed) return { ok: false, text: s, error: "분수 명령의 분자 누락" };
    const denParsed = readTexGroupOrToken(s, numParsed.nextIdx);
    if (!denParsed) return { ok: false, text: s, error: "분수 명령의 분모 누락" };

    const innerNum = replaceFractionsBalancedUnit2(numParsed.arg);
    if (!innerNum.ok) return innerNum;
    const innerDen = replaceFractionsBalancedUnit2(denParsed.arg);
    if (!innerDen.ok) return innerDen;

    const replacement = `((${innerNum.text})/(${innerDen.text}))`;
    s = s.slice(0, m.index) + replacement + s.slice(denParsed.nextIdx);
  }
  return { ok: true, text: s, error: null };
}

function replaceSqrtBalancedUnit2(input) {
  let s = input;
  const sqrtRe = /\\sqrt(?![a-zA-Z])/;
  let safety = 0;
  while (safety++ < 50) {
    const m = sqrtRe.exec(s);
    if (!m) break;
    const afterCmd = m.index + m[0].length;
    const argParsed = readTexGroupOrToken(s, afterCmd);
    if (!argParsed) return { ok: false, text: s, error: "\\sqrt 인자 누락" };
    const inner = replaceSqrtBalancedUnit2(argParsed.arg);
    if (!inner.ok) return inner;
    s = s.slice(0, m.index) + `sqrt(${inner.text})` + s.slice(argParsed.nextIdx);
  }
  return { ok: true, text: s, error: null };
}

/**
 * [Sub-Unit 2d] \log_{b}(arg), \log_b(arg), \log(arg), \ln(arg) 변환 및 밑 조건(b > 0, b != 1) 검증
 */
function replaceLogsBalancedUnit2(input) {
  let s = input;
  const logRe = /\\(log|ln)(?![a-zA-Z])/;
  let safety = 0;
  const logMeta = [];

  while (safety++ < 50) {
    const m = logRe.exec(s);
    if (!m) break;
    const cmdName = m[1];
    let p = m.index + m[0].length;
    while (p < s.length && /\s/.test(s[p])) p++;

    let baseStr = cmdName === "ln" ? "e" : "10";
    if (cmdName === "log" && s[p] === "_") {
      p++; // consume '_'
      const baseParsed = readTexGroupOrToken(s, p);
      if (!baseParsed) return { ok: false, text: s, error: "\\log 밑(_) 인자 누락" };
      baseStr = baseParsed.arg.trim();
      p = baseParsed.nextIdx;
    }

    const argParsed = readUnparenthesizedMathArg(s, p);
    if (!argParsed) return { ok: false, text: s, error: `\\${cmdName} 진수 인자 누락` };

    // 수치형 밑인 경우 밑 조건(b > 0, b != 1) 즉시 검증
    if (baseStr !== "e" && /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(baseStr)) {
      const bVal = Number(baseStr);
      if (!(bVal > 0 && Math.abs(bVal - 1) > 1e-9)) {
        return { ok: false, text: s, error: `로그 밑 조건 위반(base=${bVal}: 밑은 1이 아닌 양수여야 함)` };
      }
    }

    let replacement;
    if (cmdName === "ln" || baseStr === "e") {
      replacement = `ln(${argParsed.arg})`;
    } else {
      replacement = `((ln(${argParsed.arg}))/(ln(${baseStr})))`;
    }
    logMeta.push({ cmd: cmdName, base: baseStr, arg: argParsed.arg });
    s = s.slice(0, m.index) + replacement + s.slice(argParsed.nextIdx);
  }

  return { ok: true, text: s, error: null, logMeta };
}

/**
 * [Sub-Unit 2e] \sin, \cos, \tan 변환 (TeX 라벨은 라디안 기준이므로 sinr, cosr, tanr 로 변환)
 */
function replaceTrigBalancedUnit2(input) {
  let s = input;
  const trigRe = /\\(sin|cos|tan)(?![a-zA-Z])/;
  let safety = 0;
  const trigMeta = [];

  while (safety++ < 50) {
    const m = trigRe.exec(s);
    if (!m) break;
    const fnName = m[1];
    const p = m.index + m[0].length;
    const argParsed = readUnparenthesizedMathArg(s, p);
    if (!argParsed) return { ok: false, text: s, error: `\\${fnName} 인자 누락` };
    const replacement = `${fnName}r(${argParsed.arg})`;
    trigMeta.push({ fn: fnName, arg: argParsed.arg });
    s = s.slice(0, m.index) + replacement + s.slice(argParsed.nextIdx);
  }

  return { ok: true, text: s, error: null, trigMeta };
}

function replaceSuperscriptsBalancedUnit2(input) {
  let s = "";
  let i = 0;
  while (i < input.length) {
    if (input[i] === "^" && input[i + 1] === "{") {
      const closeIdx = findBalancedBrace(input, i + 1);
      if (closeIdx === -1) return { ok: false, text: input, error: "지수(^{...})의 중괄호가 닫히지 않음" };
      const inner = replaceSuperscriptsBalancedUnit2(input.slice(i + 2, closeIdx));
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
 * 예약 함수명(ln, log, exp, pow, sqrt, abs, deg, rad, sinr, cosr, tanr, sin, cos, tan, pi)을 보존하며
 * 암묵 곱(*)을 삽입한다.
 */
export function insertImplicitMultiplicationUnit2(rhs) {
  const tokenRe = /(sinr|cosr|tanr|sqrt|pow|exp|deg|rad|abs|sin|cos|tan|log|ln|pi|[0-9]+\.?[0-9]*|\.[0-9]+|[a-zA-Z]|['+\-*/^(),])/g;
  const rawToks = rhs.match(tokenRe);
  if (!rawToks || rawToks.join("") !== rhs) {
    // 폴백
    return rhs;
  }

  const fnNames = new Set(["sinr", "cosr", "tanr", "sqrt", "pow", "exp", "deg", "rad", "abs", "sin", "cos", "tan", "log", "ln"]);
  const isValueToken = (t) => /^[0-9.]/.test(t) || t === "pi" || (/^[a-zA-Z]$/.test(t));

  let out = "";
  for (let i = 0; i < rawToks.length; i++) {
    const a = rawToks[i];
    const b = rawToks[i + 1];
    out += a;
    if (!b) continue;
    const prev = rawToks[i - 1];

    const aEndsVal = isValueToken(a) || a === ")" || a === "'";
    const bStartsVal = isValueToken(b) || fnNames.has(b) || b === "(";

    // 함수명 바로 뒤의 '(' 또는 도함수 기호 f'(x) 뒤의 '(' 는 함수 호출이므로 '*' 삽입 안 함
    if (fnNames.has(a) && b === "(") continue;
    if ((a === "'" || /^[fghFGH]$/.test(a)) && b === "(") continue;
    if (/^[fghFGH]$/.test(a) && b === "'") continue;

    if (aEndsVal && bStartsVal) {
      if (a === ")" && /^[0-9.]/.test(b) && prev === "^") continue;
      out += "*";
    }
  }
  return out;
}

/**
 * [Unit 2] TeX 라벨 정규화 (Sub-Unit 2d / 2e 플래그 반영)
 */
export function normalizeMathLabelWithStatusUnit2(rawLabel, flags = DEFAULT_UNIT2_FLAGS) {
  const F = resolveFlags(flags);
  if (!F.u2d && !F.u2e) {
    return v021NormalizeMathLabelWithStatus(rawLabel);
  }
  if (!rawLabel || typeof rawLabel !== "string") {
    return { ok: false, normalized: "", error: "빈 라벨 문자열" };
  }

  let s = String(rawLabel)
    .replace(/\$/g, "")
    .replace(/\u2212/g, "-")
    .replace(/\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle|rm|bf|it|normalfont)\b/g, "")
    .replace(/\\(?:left|right|[bB]ig{1,2}l?|[bB]ig{1,2}r?|[bB]ig{1,2})\b/g, "")
    .replace(/\\(?:cdot|times)\b/g, "*")
    .replace(/\\(?:,|;|:|!|quad|qquad)\b/g, "")
    .replace(/\\[ ,;!]/g, "");

  s = unwrapFontCommandsUnit2(s);

  if (F.u2e) {
    s = s.replace(/\\pi(?![a-zA-Z])/g, "(pi)");
    const sqrtRes = replaceSqrtBalancedUnit2(s);
    if (!sqrtRes.ok) return { ok: false, normalized: sqrtRes.text, error: sqrtRes.error };
    s = sqrtRes.text;
  }

  const fracRes = replaceFractionsBalancedUnit2(s);
  if (!fracRes.ok) return { ok: false, normalized: fracRes.text, error: fracRes.error };
  s = fracRes.text;

  let logMeta = [];
  if (F.u2d) {
    const logRes = replaceLogsBalancedUnit2(s);
    if (!logRes.ok) return { ok: false, normalized: logRes.text, error: logRes.error };
    s = logRes.text;
    logMeta = logRes.logMeta || [];
  }

  let trigMeta = [];
  if (F.u2e) {
    const trigRes = replaceTrigBalancedUnit2(s);
    if (!trigRes.ok) return { ok: false, normalized: trigRes.text, error: trigRes.error };
    s = trigRes.text;
    trigMeta = trigRes.trigMeta || [];
  }

  const supRes = replaceSuperscriptsBalancedUnit2(s);
  if (!supRes.ok) return { ok: false, normalized: supRes.text, error: supRes.error };
  s = supRes.text.replace(/\s+/g, "");

  const leftoverCmd = /\\[a-zA-Z]+/.exec(s);
  if (leftoverCmd) {
    return { ok: false, normalized: s, error: `지원되지 않는 TeX 명령어 포함(${leftoverCmd[0]})` };
  }

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

  return { ok: true, normalized: normParens, error: null, logMeta, trigMeta };
}

/**
 * 예약 함수명을 제외한 기호 매개변수 문자 추출
 */
function extractSymbolicVarsFromRhs(rhs) {
  const stripped = rhs
    .replace(/\b(?:sinr|cosr|tanr|sqrt|pow|exp|deg|rad|abs|sin|cos|tan|log|ln|pi)\b/g, "")
    .replace(/x/g, "");
  return [...new Set(stripped.match(/[a-zA-Z]/g) || [])];
}

/**
 * [Unit 2] 수치 라벨 표현식 분석기
 */
export function analyzeNumericLabelExpressionUnit2(rawLabel, flags = DEFAULT_UNIT2_FLAGS) {
  const F = resolveFlags(flags);
  if (!F.u2c && !F.u2d && !F.u2e) {
    return v021AnalyzeNumericLabelExpression(rawLabel);
  }

  const hasRawFrac = /\\(?:d|t|c)?frac\b/.test(String(rawLabel || ""));
  const normStatus = normalizeMathLabelWithStatusUnit2(rawLabel, F);
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
  const otherVars = extractSymbolicVarsFromRhs(rhs);
  const hasSymbolicParams = otherVars.length > 0 || rhs.includes("'");

  if (lhs === "x") {
    const multRhs = insertImplicitMultiplicationUnit2(rhs);
    if (!hasSymbolicParams && !/\bx\b/.test(multRhs)) {
      const fnConst = compileExprUnit2(multRhs, F);
      let val = null;
      if (fnConst) {
        try {
          val = fnConst(0);
        } catch {
          val = null;
        }
      }
      if (val !== null && Number.isFinite(val)) {
        return {
          parseOk: true,
          isEquation: true,
          lhs: "x",
          constantX: val,
          normalizedExpr: norm,
          compiledExpr: multRhs,
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
  const multRhs = insertImplicitMultiplicationUnit2(rhs);
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
      logMeta: normStatus.logMeta || [],
      trigMeta: normStatus.trigMeta || [],
      parseError: null,
    };
  }

  const fn = compileExprUnit2(multRhs, F);
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

  // 로그함수 등 정의역이 제한된 함수를 위해 넓은 프로브 점들 중 최소 2개 이상에서 유한값이면 유효로 판정
  const probeXs = [-3.1, -1.3, -0.5, 0.2, 0.5, 1.1, 1.3, 2.3, 4.1, 6.2];
  let finiteCount = 0;
  for (const testX of probeXs) {
    try {
      const v = fn(testX);
      if (Number.isFinite(v)) finiteCount++;
    } catch {
      // ignore
    }
  }
  if (finiteCount < 2) {
    return {
      parseOk: false,
      isEquation: true,
      lhs: "y",
      normalizedExpr: norm,
      compiledExpr: multRhs,
      fn: null,
      hasFractionOrDivision: hasDivision,
      hasSymbolicParams: false,
      parseError: `수치 함수식 정의역 내 유한 평가점 부족(${multRhs})`,
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
    logMeta: normStatus.logMeta || [],
    trigMeta: normStatus.trigMeta || [],
    parseError: null,
  };
}

export function compileNumericLabelFunctionUnit2(rawLabel, flags = DEFAULT_UNIT2_FLAGS) {
  const res = analyzeNumericLabelExpressionUnit2(rawLabel, flags);
  return res.parseOk && res.fn ? res.fn : null;
}

// ============================================================================
// 3. Sub-Unit 2a / 2b / 2d / 2e 구조 템플릿 파싱 및 호환성 검증
// ============================================================================

function foldConstantNumericFractionsUnit2(s) {
  return s.replace(/\(\(([-+]?(?:\d+\.?\d*|\.\d+))\)\/\(([-+]?(?:\d+\.?\d*|\.\d+))\)\)/g, (all, num, den) => {
    const d = Number(den);
    if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return all;
    const v = Number(num) / d;
    return String(Math.round(v * 1e6) / 1e6);
  });
}

/**
 * plot 문장의 수학 구조 분석 (점근선 등으로 일부 샘플이 NaN 이어도 유효 샘플로 분석)
 */
export function analyzePlotMathStructureUnit2(stmt, flags = DEFAULT_UNIT2_FLAGS) {
  const F = resolveFlags(flags);
  if (!stmt || stmt.type !== "plot" || !Array.isArray(stmt.domain) || stmt.domain.length < 2) {
    return null;
  }
  const fn = stmt.fn || compileExprUnit2(stmt.expr, F);
  if (!fn) return null;

  const baseStruct = v021AnalyzePlotMathStructure({ ...stmt, fn });
  if (baseStruct) {
    return { ...baseStruct, expr: stmt.expr || "", fn, domain: stmt.domain };
  }

  // 점근선 근처에서 일부 끝점이 NaN 인 경우 내부 7개 점으로 재시도
  const [d0, d1] = stmt.domain;
  const validPts = [];
  for (let k = 1; k <= 7; k++) {
    const x = d0 + ((d1 - d0) * k) / 8;
    try {
      const y = fn(x);
      if (Number.isFinite(y) && Math.abs(y) < 1e5) validPts.push([x, y]);
    } catch {
      // ignore
    }
  }
  if (validPts.length >= 4) {
    return {
      kind: "non-polynomial",
      degree: null,
      expr: stmt.expr || "",
      fn,
      domain: stmt.domain,
      validSampleCount: validPts.length,
    };
  }
  return null;
}

/**
 * [Unit 2] 구조 템플릿 파서 (u2a, u2b, u2d, u2e 플래그 제어)
 */
export function parseLabelStructureTemplateUnit2(rawLabel, flags = DEFAULT_UNIT2_FLAGS) {
  const F = resolveFlags(flags);

  // 수치형 함수(미지수 없음)는 expr-match 대상이므로 구조 템플릿에서 제외
  if (compileNumericLabelFunctionUnit2(rawLabel, F)) return null;

  // 1) 기존 v0.2.1 구조 템플릿 확인 + Sub-Unit 2b (+1/-1 생략 계수 보정)
  const baseTpl = v021ParseLabelStructureTemplate(rawLabel);
  if (baseTpl) {
    if (F.u2b) {
      const norm = v021NormalizeMathLabelWithStatus(rawLabel).normalized || "";
      const rhs = norm.startsWith("y=") ? norm.slice(2) : "";
      if (baseTpl.template === "linear-general" && baseTpl.fixedM === null) {
        if (/^\+?x[-+]/.test(rhs)) {
          return { ...baseTpl, fixedM: 1 };
        }
      }
      if (baseTpl.template === "quad-general" && baseTpl.fixedA === null) {
        if (/^\+?x\^2[-+]/.test(rhs)) {
          return { ...baseTpl, fixedA: 1 };
        }
      }
    }
    return baseTpl;
  }

  const normStatus = normalizeMathLabelWithStatusUnit2(rawLabel, F);
  if (!normStatus.ok || !normStatus.normalized) return null;
  const norm = foldConstantNumericFractionsUnit2(normStatus.normalized).replace(/\^\(2\)/g, "^2");
  if (!norm.startsWith("y=")) return null;
  const rhs = norm.slice(2);

  // 2) [Sub-Unit 2a] y = f(1), y = f(-2), y = f(a) 등 상수 함수값 수평선 (인자에 x 없음)
  if (F.u2a) {
    const mConstFnCall = /^([-+]?)([fghFGH])\(([^x()]+)\)$/.exec(rhs);
    if (mConstFnCall) {
      const sign = mConstFnCall[1] === "-" ? -1 : 1;
      const fnName = mConstFnCall[2];
      const argRaw = mConstFnCall[3];
      const argNum = /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(argRaw) ? Number(argRaw) : null;
      return {
        template: "horizontal-constant-fn",
        desc: `상수 함수값 수평선(${norm})`,
        degree: 0,
        fnName,
        fnSign: sign,
        argRaw,
        argNum,
        requireHorizontalLine: true,
      };
    }

    // y = f(x), y = g(x), y = h(x) 추상 함수 라벨 (도함수 f'(x)나 부호 변환 -f(x)는 구분 기록)
    const mAbstractFn = /^([fghFGH])\(x\)$/.exec(rhs);
    if (mAbstractFn) {
      return {
        template: "abstract-single-curve",
        desc: `추상 함수 곡선(${norm})`,
        degree: "non-constant-plot",
        fnName: mAbstractFn[1],
        isAbstractFunctionLabel: true,
        requireUniqueNonConstantPlot: true,
      };
    }

    // y = f'(x), y = -f'(x), y = -f(x) 등 파생 추상 함수 표기:
    // 장면 내 추상 함수 라벨 개수 집계에 포함시키되 단독 자동 확정은 보류(ambiguous/uncertain)
    const mDerivedAbstract = /^[-+]?([fghFGH])'?\(x\)$/.exec(rhs);
    if (mDerivedAbstract) {
      return {
        template: "abstract-derived-hold",
        desc: `파생/부호 추상 함수(${norm})`,
        degree: "non-constant-plot",
        fnName: mDerivedAbstract[1],
        isAbstractFunctionLabel: true,
        holdUncertain: true,
      };
    }
  }

  // 3) [Sub-Unit 2d] 지수함수 일반형: y = a^x + b, y = 2^x + b, y = a^(x-p) + q 등
  if (F.u2d) {
    const NUM = String.raw`(?:\d+\.?\d*|\.\d+)`;
    const SYM = String.raw`[a-zA-Z]`;
    // 형태 A: y = (base)^(x, -x, mx, mx±p) ± q (예: y=2^x+b, y=2^{-x}+b, y=a^{-x}+b, y=(0.5)^x+k)
    const mExp = new RegExp(
      String.raw`^(?:([-+]?(?:${NUM}|${SYM}))\*)?\(?(${NUM}|${SYM})\)?\^\(?([-+]?(?:${NUM}\*)?)x(?:([-+])(${NUM}|${SYM}))?\)?(?:([-+])(${NUM}|${SYM}))?$`
    ).exec(rhs);
    if (mExp) {
      const coefRaw = mExp[1] || "";
      const baseRaw = mExp[2];
      const expSlopeRaw = mExp[3] || "";
      const shiftSign = mExp[4] || null;
      const shiftRaw = mExp[5] || null;
      const constSign = mExp[6] || null;
      const constRaw = mExp[7] || null;

      const isNumericBase = /^(?:\d+\.?\d*|\.\d+)$/.test(baseRaw);
      const fixedBase = isNumericBase ? Number(baseRaw) : null;
      // 지수함수 밑 조건: a > 0 && a != 1
      if (fixedBase !== null && !(fixedBase > 0 && Math.abs(fixedBase - 1) > 1e-9)) {
        return null;
      }

      const expSlopeCleaned = expSlopeRaw.replace(/\*$/, "");
      const fixedExpSlope =
        expSlopeCleaned === "" || expSlopeCleaned === "+"
          ? 1
          : expSlopeCleaned === "-"
            ? -1
            : /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(expSlopeCleaned)
              ? Number(expSlopeCleaned)
              : null;
      if (fixedExpSlope !== null && Math.abs(fixedExpSlope) < 1e-9) {
        return null;
      }

      const fixedCoef =
        coefRaw === "" || coefRaw === "+"
          ? 1
          : coefRaw === "-"
            ? -1
            : /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(coefRaw)
              ? Number(coefRaw)
              : null;

      const fixedShiftX =
        shiftRaw === null
          ? 0
          : /^(?:\d+\.?\d*|\.\d+)$/.test(shiftRaw)
            ? shiftSign === "-"
              ? Number(shiftRaw)
              : -Number(shiftRaw)
            : null;

      const fixedConst =
        constRaw === null
          ? 0
          : /^(?:\d+\.?\d*|\.\d+)$/.test(constRaw)
            ? constSign === "-"
              ? -Number(constRaw)
              : Number(constRaw)
            : null;

      return {
        template: "exp-general",
        desc: `지수함수(${norm})`,
        degree: null,
        fixedCoef,
        fixedBase,
        baseRaw,
        fixedExpSlope,
        fixedShiftX,
        fixedConst,
      };
    }

    // 형태 B: 로그함수 일반형 (기호 매개변수가 포함된 \log_a(x+p)+q 등)
    if (normStatus.logMeta && normStatus.logMeta.length === 1) {
      const lm = normStatus.logMeta[0];
      const isNumBase = lm.base === "e" || /^(?:\d+\.?\d*|\.\d+)$/.test(lm.base);
      const fixedBase = lm.base === "e" ? Math.E : isNumBase ? Number(lm.base) : null;
      if (fixedBase !== null && !(fixedBase > 0 && Math.abs(fixedBase - 1) > 1e-9)) {
        return null;
      }
      return {
        template: "log-general",
        desc: `로그함수(${norm})`,
        degree: null,
        fixedBase,
        logMeta: lm,
      };
    }
  }

  // 4) [Sub-Unit 2e] 기호 매개변수가 포함된 삼각함수 일반형 (예: CASE-005 y=6\cos(a(x+\pi/6))+b)
  if (F.u2e && normStatus.trigMeta && normStatus.trigMeta.length === 1) {
    const tm = normStatus.trigMeta[0];
    return {
      template: "trig-general",
      desc: `삼각함수(${norm})`,
      degree: null,
      trigFn: tm.fn, // 'sin' | 'cos' | 'tan'
    };
  }

  return null;
}

/**
 * [Unit 2] 구조 템플릿과 곡선의 수학적 호환성 검사
 */
export function checkStructuralCompatibilityUnit2(tpl, stroke, mathStruct, node, flags = DEFAULT_UNIT2_FLAGS) {
  const F = resolveFlags(flags);
  if (!tpl || !stroke) return { compatible: false, reason: "템플릿 또는 곡선 없음" };

  if (tpl.template === "abstract-derived-hold") {
    return { compatible: false, reason: "파생/부호 추상 함수는 단독 구조 매칭에서 보류" };
  }

  if (F.u2a && tpl.template === "horizontal-constant-fn") {
    if (mathStruct) {
      if (mathStruct.kind === "constant" && mathStruct.degree === 0) {
        return {
          compatible: true,
          details: `수평 상수 함수(y=${mathStruct.c}, degree=0) 구조 일치`,
        };
      }
      return {
        compatible: false,
        reason: `상수 함수(degree=0)가 아님(현재 ${mathStruct.kind}, degree=${mathStruct.degree})`,
      };
    }
    const pts = stroke.pts || [];
    if (pts.length === 2 || (pts.length >= 2 && (!stroke.stmt || stroke.stmt.type !== "plot"))) {
      const dx = Math.abs(pts[pts.length - 1][0] - pts[0][0]);
      const dy = Math.abs(pts[pts.length - 1][1] - pts[0][1]);
      if (dy <= 1.0 && dx >= 5.0) {
        return {
          compatible: true,
          details: `수평 보조선 선분(|dy|=${r2(dy)}pt) 구조 일치`,
        };
      }
    }
    return { compatible: false, reason: "수평선(degree=0)이 아님" };
  }

  if (F.u2a && tpl.template === "abstract-single-curve") {
    if (!stroke.stmt || stroke.stmt.type !== "plot") {
      return { compatible: false, reason: "plot 곡선이 아님" };
    }
    if (mathStruct && mathStruct.degree === 0) {
      return { compatible: false, reason: "수평 상수선(degree=0)은 추상 함수 곡선 y=f(x) 대상에서 제외" };
    }
    return {
      compatible: true,
      isNonlinearCurve: Boolean(
        classifyStrokeKind(stroke) === "functionCurve" &&
          (!mathStruct || (mathStruct.degree !== 0 && mathStruct.degree !== 1))
      ),
      details: `비상수 plot 주요 곡선(${mathStruct ? `${mathStruct.kind}, degree=${mathStruct.degree}` : "plot"}) 후보`,
    };
  }

  if (F.u2d && tpl.template === "exp-general") {
    if (!stroke.stmt || stroke.stmt.type !== "plot" || !mathStruct || mathStruct.kind !== "non-polynomial") {
      return { compatible: false, reason: "비다항(non-polynomial) plot 곡선이 아님" };
    }
    const fn = mathStruct.fn || stroke.stmt.fn;
    const dom = mathStruct.domain || stroke.stmt.domain;
    if (!fn || !Array.isArray(dom) || dom.length < 2) {
      return { compatible: false, reason: "plot 함수 또는 정의역 없음" };
    }

    const expSlope = tpl.fixedExpSlope !== undefined && tpl.fixedExpSlope !== null ? tpl.fixedExpSlope : 1;

    // 1) 만약 밑(fixedBase), 지수 계수(expSlope), 평행이동(fixedShiftX), 계수(fixedCoef)가 알려져 있고 상수항만 미지수인 경우 (예: y = 2^x + b, y = 2^{-x} + b):
    //    st.fn(x) - coef * base^(expSlope * x - shiftX) 가 정의역 전체에서 상수인지 직접 검증!
    if (tpl.fixedBase !== null && tpl.fixedCoef !== null && tpl.fixedShiftX !== null && expSlope !== null) {
      const diffs = [];
      for (let k = 0; k < 5; k++) {
        const x = dom[0] + ((dom[1] - dom[0]) * (k + 0.5)) / 5;
        const yPlot = fn(x);
        const yExp = tpl.fixedCoef * safePow(tpl.fixedBase, expSlope * x - tpl.fixedShiftX);
        if (!Number.isFinite(yPlot) || !Number.isFinite(yExp)) {
          return { compatible: false, reason: "지수함수 정의역 평가 중 비유한값 발생" };
        }
        diffs.push(yPlot - yExp);
      }
      const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      const maxDev = Math.max(...diffs.map((d) => Math.abs(d - meanDiff)));
      if (maxDev <= 1e-3) {
        if (tpl.fixedConst !== null && Math.abs(meanDiff - tpl.fixedConst) > 1e-3) {
          return { compatible: false, reason: `지수함수 상수항 불일치(요구 ${tpl.fixedConst}, 실제 ${r2(meanDiff)})` };
        }
        return {
          compatible: true,
          details: `지수함수 구조 일치(base=${tpl.fixedBase}, expSlope=${expSlope}, 추정 상수항=${r2(meanDiff)}, 편차=${r2(maxDev)})`,
        };
      }
      return { compatible: false, reason: `지수함수 밑(${tpl.fixedBase}) 증가율 불일치(편차=${r2(maxDev)})` };
    }

    // 2) 일반 지수함수 증가율 검증: 등간격 4개 점에서 차분비 (y_{k+1}-y_k)/(y_k-y_{k-1}) = (a^expSlope)^h > 0 일정 여부 확인
    const h = (dom[1] - dom[0]) / 3;
    if (h <= 1e-6) return { compatible: false, reason: "정의역 폭 부족" };
    const ys = [0, 1, 2, 3].map((k) => fn(dom[0] + k * h));
    if (ys.some((y) => !Number.isFinite(y))) return { compatible: false, reason: "비유한 샘플 존재" };
    const d1 = ys[1] - ys[0];
    const d2 = ys[2] - ys[1];
    const d3 = ys[3] - ys[2];
    if (Math.abs(d1) < 1e-6 || Math.abs(d2) < 1e-6) return { compatible: false, reason: "차분 변화량 부족" };
    const r1 = d2 / d1;
    const r2Ratio = d3 / d2;
    if (!(r1 > 0 && Math.abs(r1 - 1) > 1e-3 && Math.abs(r1 - r2Ratio) <= 1e-2)) {
      return { compatible: false, reason: "등비 차분 성질 불만족(지수함수가 아님)" };
    }
    const impliedEffectiveBase = Math.pow(r1, 1 / h);
    if (tpl.fixedBase !== null && expSlope !== null) {
      const expectedEffectiveBase = safePow(tpl.fixedBase, expSlope);
      if (Math.abs(impliedEffectiveBase - expectedEffectiveBase) > 2e-2) {
        return { compatible: false, reason: `지수 밑 불일치(요구 ${r2(expectedEffectiveBase)}, 곡선 ${r2(impliedEffectiveBase)})` };
      }
    }
    return {
      compatible: true,
      details: `지수함수 등비 차분 구조 일치(추정 유효 밑=${r2(impliedEffectiveBase)})`,
    };
  }

  if (F.u2d && tpl.template === "log-general") {
    if (!stroke.stmt || stroke.stmt.type !== "plot" || !mathStruct || mathStruct.kind !== "non-polynomial") {
      return { compatible: false, reason: "비다항 plot 곡선이 아님" };
    }
    const exprStr = String(stroke.stmt.expr || "");
    if (!/\b(?:ln|log)\b/.test(exprStr)) {
      return { compatible: false, reason: "plot 식에 로그(ln/log)가 포함되지 않음" };
    }
    return {
      compatible: true,
      details: `로그함수 plot 식(${exprStr}) 구조 일치`,
    };
  }

  if (F.u2e && tpl.template === "trig-general") {
    if (!stroke.stmt || stroke.stmt.type !== "plot" || !mathStruct || mathStruct.kind !== "non-polynomial") {
      return { compatible: false, reason: "비다항 plot 곡선이 아님" };
    }
    const exprStr = String(stroke.stmt.expr || "");
    if (tpl.trigFn === "tan") {
      if (!/\btan\b/.test(exprStr)) return { compatible: false, reason: "tan plot 식이 아님" };
    } else {
      if (!/\b(?:sin|cos)\b/.test(exprStr)) return { compatible: false, reason: "sin/cos plot 식이 아님" };
    }
    return {
      compatible: true,
      details: `삼각함수(${tpl.trigFn}) plot 식(${exprStr}) 구조 일치`,
    };
  }

  return v021CheckStructuralCompatibility(tpl, stroke, mathStruct, node);
}

/**
 * [Unit 2] 미배정 함수 라벨에 대한 구조 매칭 실행기
 */
export function runStructuralMatchingUnit2(scene, unclaimedNodes, claimedStrokeIndices, classifyStrokeKindFn, flags = DEFAULT_UNIT2_FLAGS) {
  const F = resolveFlags(flags);
  const results = new Map();
  const strokes = Array.isArray(scene && scene.strokes) ? scene.strokes : [];

  const plotCandidates = [];
  for (const s of strokes) {
    if (!s || s.kind === "axis" || claimedStrokeIndices.has(s.index)) continue;
    const strokeKind = classifyStrokeKindFn(s);
    const mathStruct = s.stmt && s.stmt.type === "plot" ? analyzePlotMathStructureUnit2(s.stmt, F) : null;
    plotCandidates.push({ stroke: s, strokeKind, mathStruct });
  }

  // 장면 내 미배정 추상 함수 라벨(y=f(x), y=g(x), y=f'(x) 등) 총 개수 확인
  // 안전 규칙: 추상 함수 라벨이 2개 이상이면(예: CASE-004 의 y=f(x), y=g(x)) 절대 자동 이동하지 않고 차단!
  const nodeTplPairs = unclaimedNodes.map((n) => ({
    node: n,
    tpl: parseLabelStructureTemplateUnit2(n.label, F),
  }));
  const abstractLabelNodes = nodeTplPairs.filter((p) => p.tpl && p.tpl.isAbstractFunctionLabel);

  const nodeAnalyses = nodeTplPairs.map(({ node: n, tpl }) => {
    const anchor = n.at || n.inlineAnchor || n.anchor || (n.bbox ? [(n.bbox.x0 + n.bbox.x1) / 2, (n.bbox.y0 + n.bbox.y1) / 2] : null);
    if (!tpl) {
      return { node: n, tpl: null, compatible: [], anchor };
    }

    // 복수 추상 함수 라벨이 존재하면 모든 추상 함수 라벨을 ambiguous-structural 로 보류
    if (tpl.isAbstractFunctionLabel && abstractLabelNodes.length >= 2) {
      const nonConstPlots = plotCandidates.filter(
        (c) => c.stroke.stmt && c.stroke.stmt.type === "plot" && (!c.mathStruct || c.mathStruct.degree !== 0)
      );
      return {
        node: n,
        tpl,
        compatible: nonConstPlots.map((c) => ({
          ...c,
          details: "복수 추상 함수 라벨 존재로 인해 확정 보류",
          distancePt: anchor
            ? r2(minDistPolylines([{ pts: [anchor, anchor], closed: false }], [{ pts: c.stroke.pts, closed: false }]))
            : null,
        })),
        forceAmbiguousReason: `미배정 추상 함수식 라벨이 ${abstractLabelNodes.length}개(${abstractLabelNodes.map((a) => a.node.trimmed).join(", ")}) 존재하여 대응 곡선을 안전하게 확정할 수 없음. 자동 이동 차단.`,
        anchor,
      };
    }

    if (tpl.holdUncertain) {
      return { node: n, tpl: null, compatible: [], anchor };
    }

    const compatible = [];
    for (const cand of plotCandidates) {
      if (claimedStrokeIndices.has(cand.stroke.index)) continue;
      if (
        tpl.template !== "vertical-symbolic" &&
        tpl.template !== "horizontal-constant-fn" &&
        (!cand.stroke.stmt || cand.stroke.stmt.type !== "plot")
      ) {
        continue;
      }
      const chk = checkStructuralCompatibilityUnit2(tpl, cand.stroke, cand.mathStruct, n, F);
      if (chk.compatible) {
        const distPt = anchor
          ? r2(minDistPolylines([{ pts: [anchor, anchor], closed: false }], [{ pts: cand.stroke.pts, closed: false }]))
          : null;
        compatible.push({ ...cand, isNonlinearCurve: chk.isNonlinearCurve, details: chk.details, distancePt: distPt });
      }
    }

    // [Sub-Unit 2a 보조 규칙]
    // 단일 추상 함수 라벨(y=f(x))인데 미배정 비상수 plot 이 여러 개인 경우(예: CASE-009 의 3차곡선 1개 + 접선 직선 3개):
    // 그중 비선형 곡선(degree >= 2 또는 non-polynomial functionCurve)이 정확히 1개뿐이고 나머지가 모두 직선(degree=1)이면
    // 유일한 비선형 메인 곡선으로 좁혀준다.
    if (tpl.template === "abstract-single-curve" && compatible.length >= 2) {
      const nonlinearOnly = compatible.filter((c) => c.isNonlinearCurve);
      const allOthersLinear = compatible
        .filter((c) => !c.isNonlinearCurve)
        .every((c) => c.strokeKind === "generalLine" || (c.mathStruct && c.mathStruct.degree === 1));
      if (nonlinearOnly.length === 1 && allOthersLinear) {
        return {
          node: n,
          tpl,
          compatible: [
            {
              ...nonlinearOnly[0],
              details: `${nonlinearOnly[0].details} (나머지 미배정 plot 은 모두 직선이므로 유일한 비선형 메인 함수 곡선으로 확정)`,
            },
          ],
          anchor,
        };
      }
    }

    return { node: n, tpl, compatible, anchor };
  });

  const strokeContenders = new Map();
  for (const na of nodeAnalyses) {
    if (!na.forceAmbiguousReason && na.compatible.length === 1) {
      const idx = na.compatible[0].stroke.index;
      strokeContenders.set(idx, (strokeContenders.get(idx) || 0) + 1);
    }
  }

  for (const na of nodeAnalyses) {
    const { node: n, tpl, compatible, forceAmbiguousReason } = na;
    if (!tpl) continue;

    if (forceAmbiguousReason) {
      const sortedByDist = [...compatible].sort((a, b) => (a.distancePt ?? Infinity) - (b.distancePt ?? Infinity));
      const nearest = sortedByDist[0] || null;
      results.set(n.id, {
        how: "ambiguous-structural",
        stroke: nearest ? nearest.stroke : null,
        strokeKind: nearest ? nearest.strokeKind : "unknown",
        confirmed: false,
        uncertain: true,
        nonMoveCategory: "매칭 불확실",
        nonMoveCode: "uncertain-match",
        template: tpl.template,
        templateDesc: tpl.desc,
        candidateCount: compatible.length,
        candidateStrokes: compatible.map((c) => c.stroke.index),
        distancePt: nearest ? nearest.distancePt : null,
        reason: forceAmbiguousReason,
      });
      continue;
    }

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
          nonMoveCode: "uncertain-match",
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
        nonMoveCode: null,
        template: tpl.template,
        templateDesc: tpl.desc,
        mathStructure: match.mathStruct,
        distancePt: match.distancePt,
        reason: `${tpl.desc} 구조 분석 결과 미배정 곡선 중 유일한 후보(#${match.stroke.index}: ${match.details})로 확정됨`,
      });
    } else if (compatible.length >= 2) {
      const sortedByDist = [...compatible].sort((a, b) => (a.distancePt ?? Infinity) - (b.distancePt ?? Infinity));
      const nearest = sortedByDist[0];
      results.set(n.id, {
        how: "ambiguous-structural",
        stroke: nearest.stroke,
        strokeKind: nearest.strokeKind,
        confirmed: false,
        uncertain: true,
        nonMoveCategory: "매칭 불확실",
        nonMoveCode: "uncertain-match",
        template: tpl.template,
        templateDesc: tpl.desc,
        candidateCount: compatible.length,
        candidateStrokes: compatible.map((c) => c.stroke.index),
        distancePt: nearest.distancePt,
        reason: `${tpl.desc} 후보가 ${compatible.length}개 존재하여 대응 곡선을 확정할 수 없음. 자동 이동 차단.`,
      });
    }
  }

  // [구체 함수식 확정 후 1:1 잔여 파생 추상 함수 곡선 소거] (예: CASE-002 의 y=-f'(x)):
  // Sub-Unit 2a 의 abstract-single-curve(y=f(x))와 중복되지 않도록,
  // 오직 파생 추상 함수(abstract-derived-hold: y=-f'(x), y=f'(x), y=-f(x))가 유일한 미배정 추상 라벨이고,
  // 구체 함수식 매칭 이후 남은 미배정 함수 라벨이 정확히 1개이며 남은 비상수 실선 plot 곡선도 정확히 1개일 때만 확정한다.
  if (F.enableResidualSingleCurve !== false && abstractLabelNodes.length === 1) {
    const onlyAbs = abstractLabelNodes[0];
    const remainingNodes = unclaimedNodes.filter((n) => !results.has(n.id));
    if (
      onlyAbs.tpl &&
      onlyAbs.tpl.template === "abstract-derived-hold" &&
      remainingNodes.length === 1 &&
      remainingNodes[0].id === onlyAbs.node.id
    ) {
      const remainingPlotCands = plotCandidates.filter((c) => {
        if (claimedStrokeIndices.has(c.stroke.index)) return false;
        if (!c.stroke.stmt || c.stroke.stmt.type !== "plot") return false;
        if (c.stroke.kind === "dashed" || /\bdashed\b/.test(String(c.stroke.stmt.optsRaw || ""))) return false;
        if (c.mathStruct && c.mathStruct.degree === 0) return false;
        return true;
      });
      if (remainingPlotCands.length === 1) {
        const match = remainingPlotCands[0];
        const n = onlyAbs.node;
        const anchor = n.at || n.inlineAnchor || n.anchor || (n.bbox ? [(n.bbox.x0 + n.bbox.x1) / 2, (n.bbox.y0 + n.bbox.y1) / 2] : null);
        const distPt = anchor
          ? r2(minDistPolylines([{ pts: [anchor, anchor], closed: false }], [{ pts: match.stroke.pts, closed: false }]))
          : null;
        claimedStrokeIndices.add(match.stroke.index);
        results.set(n.id, {
          how: "residual-single-curve",
          stroke: match.stroke,
          strokeKind: match.strokeKind,
          confirmed: true,
          uncertain: false,
          nonMoveCategory: null,
          nonMoveCode: null,
          template: onlyAbs.tpl.template,
          templateDesc: onlyAbs.tpl.desc,
          mathStructure: match.mathStruct,
          distancePt: distPt,
          plotExpr: match.stroke.stmt?.expr || "",
          reason: `구체 함수식 확정 후 남은 유일한 미배정 함수 라벨(${n.trimmed || n.label})과 유일한 미배정 함수 곡선(#${match.stroke.index}: ${match.stroke.stmt?.expr || "plot"}${distPt !== null ? `, 거리 ${distPt}pt` : ""})이 1:1 대응되어 확정됨`,
        });
      }
    }
  }

  if (false) {
    if (false) {
      results.set("__noop__", {
        reason: `${""}`,
      });
    }
  }

  return results;
}

// ============================================================================
// 4. Scope \clip 가시 영역 폴리라인 클리핑 및 Scene 확장 (Sub-Unit 2d / 2e)
// ============================================================================

/**
 * 선분 P0 -> P1 을 직사각형 [xMin, yMin, xMax, yMax] 내부로 Liang-Barsky 클리핑한다.
 */
function clipSegmentToRect(p0, p1, rect) {
  let t0 = 0;
  let t1 = 1;
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const checks = [
    [-dx, p0[0] - rect.x0],
    [dx, rect.x1 - p0[0]],
    [-dy, p0[1] - rect.y0],
    [dy, rect.y1 - p0[1]],
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  if (t0 > t1) return null;
  return [
    [r2(p0[0] + t0 * dx), r2(p0[1] + t0 * dy)],
    [r2(p0[0] + t1 * dx), r2(p0[1] + t1 * dy)],
  ];
}

/**
 * 폴리라인 pts 를 직사각형 rect 내부로 클리핑한다.
 */
export function clipPolylineToRect(pts, rect) {
  if (!Array.isArray(pts) || pts.length < 2 || !rect) return pts;
  const out = [];
  const pushPt = (pt) => {
    if (out.length === 0) {
      out.push(pt);
      return;
    }
    const last = out[out.length - 1];
    if (Math.hypot(last[0] - pt[0], last[1] - pt[1]) > 1e-3) {
      out.push(pt);
    }
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = clipSegmentToRect(pts[i], pts[i + 1], rect);
    if (seg) {
      pushPt(seg[0]);
      pushPt(seg[1]);
    }
  }
  return out.length >= 2 ? out : pts;
}

/**
 * TikZ 본문에서 \begin{scope} ... \clip (x0, y0) rectangle (x1, y1); ... \end{scope} 범위를 찾아
 * 해당 scope 내부에 선언된 plot/draw 스트로크의 폴리라인(pts)을 가시 클립 영역으로 절단한다.
 */
export function applyScopeClippingToScene(scene) {
  if (!scene || !scene.body || !scene.units || !scene.units.xU || !scene.units.yU) return scene;
  const { xU, yU } = scene.units;
  const body = scene.body;
  const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)`;
  const clipRe = new RegExp(
    String.raw`\\clip\s*\(\s*(${NUM})\s*,\s*(${NUM})\s*\)\s*rectangle\s*\(\s*(${NUM})\s*,\s*(${NUM})\s*\)\s*;`,
    "g"
  );

  // \begin{scope} ... \end{scope} 범위 추출
  const scopes = [];
  const scopeOpenRe = /\\begin\{scope\}/g;
  const scopeCloseRe = /\\end\{scope\}/g;
  const opens = [];
  let m;
  while ((m = scopeOpenRe.exec(body)) !== null) opens.push(m.index);
  const closes = [];
  while ((m = scopeCloseRe.exec(body)) !== null) closes.push(m.index + m[0].length);

  // 단순 중첩/순차 매칭
  for (let i = 0; i < Math.min(opens.length, closes.length); i++) {
    scopes.push({ start: opens[i], end: closes[i] });
  }

  const clipRegions = [];
  while ((m = clipRe.exec(body)) !== null) {
    const cIdx = m.index;
    const xa = Number(m[1]) * xU;
    const ya = Number(m[2]) * yU;
    const xb = Number(m[3]) * xU;
    const yb = Number(m[4]) * yU;
    const rect = {
      x0: Math.min(xa, xb),
      y0: Math.min(ya, yb),
      x1: Math.max(xa, xb),
      y1: Math.max(ya, yb),
    };
    const enclosingScope = scopes.find((sc) => cIdx >= sc.start && cIdx <= sc.end);
    clipRegions.push({
      clipIndex: cIdx,
      rangeStart: cIdx,
      rangeEnd: enclosingScope ? enclosingScope.end : body.length,
      isScoped: Boolean(enclosingScope),
      rect,
    });
  }

  if (clipRegions.length === 0) return scene;

  for (const s of scene.strokes || []) {
    if (!s || s.kind === "axis" || !s.stmt || !Array.isArray(s.pts) || s.pts.length < 2) continue;
    // \begin{scope} 내부의 \clip 만 곡선 가시 끝점 절단에 적용 (전역 뷰포트 \clip 은 여백용이므로 scope clip 우선)
    const activeClips = clipRegions.filter(
      (cr) => cr.isScoped && s.stmt.start >= cr.rangeStart && s.stmt.end <= cr.rangeEnd
    );
    if (activeClips.length === 0) continue;
    let pts = s.pts;
    for (const cr of activeClips) {
      pts = clipPolylineToRect(pts, cr.rect);
    }
    if (pts.length >= 2) {
      s.unclippedPts = s.unclippedPts || s.pts;
      s.pts = pts;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) {
        if (p[0] < x0) x0 = p[0];
        if (p[1] < y0) y0 = p[1];
        if (p[0] > x1) x1 = p[0];
        if (p[1] > y1) y1 = p[1];
      }
      s.bbox = { x0, y0, x1, y1 };
      s.clippedByScope = true;
    }
  }
  return scene;
}

/**
 * [Unit 2] buildScene 이후 장면(scene)에 Unit 2 의 파서·글리프 확인·클리핑을 주입한다.
 */
export function enhanceSceneWithUnit2(scene, flags = DEFAULT_UNIT2_FLAGS) {
  const F = resolveFlags(flags);
  if (!scene || !scene.ok) return scene;

  // 1) plot 문장들의 수식 함수(st.fn)를 compileExprUnit2 로 재컴파일
  for (const st of scene.stmts || []) {
    if (st.type === "plot" && st.expr) {
      st.fn = compileExprUnit2(st.expr, F);
    }
  }

  // 2) \begin{scope} \clip 가시 영역 폴리라인 절단 적용
  if (F.u2a || F.u2c || F.u2e) {
    applyScopeClippingToScene(scene);
  }

  // 3) 확장 글리프 일치 확인 (\log, \ln, \sin, \cos, \tan, \pi, \sqrt 등)
  const offset = scene.analysis && scene.analysis.labels ? 0 : 0;
  const anLabels = (scene.analysis && scene.analysis.labels) || [];
  const geomNodes = (scene.geom && scene.geom.nodes) || [];

  for (const n of scene.nodes || []) {
    if (n.usable) continue;
    // Unit 1 의 fallbackAnchorFromBBox 잠금 노드는 절대 usable=true 로 풀지 않음!
    if (n.fallbackAnchorFromBBox) continue;
    if (!n.bbox || n.confidence !== "uncertain") continue;

    const svgNode = n.svgIndex !== null && n.svgIndex !== undefined ? geomNodes[n.svgIndex] : null;
    if (!svgNode || typeof svgNode.chars !== "string" || !n.label) continue;

    let cleaned = n.label
      .replace(/\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle|rm|bf|it|normalfont|mathrm|mathbf|mathit|left|right|[bB]ig{1,2}[lr]?|(?:d|t|c)?frac|cdot|times|,|;|:|!|quad|qquad)\b/g, "");

    if (F.u2d) {
      cleaned = cleaned.replace(/\\(log|ln)\b/g, "$1");
    }
    if (F.u2e) {
      cleaned = cleaned
        .replace(/\\(sin|cos|tan)\b/g, "$1")
        .replace(/\\(?:pi|alpha|beta|gamma|theta|sqrt)\b/g, "");
    }
    cleaned = cleaned.replace(/[$^{}_\s']/g, "");

    if (!/\\[a-zA-Z]+/.test(cleaned)) {
      const expChars = (cleaned.match(/[A-Za-z0-9=+\-().,/]/g) || []).sort().join("");
      const gotChars = (svgNode.chars.replace(/\u2212/g, "-").match(/[A-Za-z0-9=+\-().,/]/g) || []).sort().join("");
      if (expChars.length > 0 && expChars === gotChars) {
        const lab = anLabels.find((l) => l.id === n.id);
        const m = lab ? lab.matching : null;
        const orderEv = m && (m.evidence || []).find((e) => e.type === "order");
        const posEv = m && (m.evidence || []).find((e) => e.type === "position");
        if (n.kind !== "inline" && orderEv && orderEv.result === "consistent" && posEv && posEv.result === "within") {
          n.usable = true;
          n.usableBy = "unit2-extended-tex-glyph-confirmed";
        } else if (n.kind === "inline" && n.stmt && n.stmt.path) {
          const st = (scene.strokes || []).find((s) => s.index === n.stmt.path.index);
          if (st) {
            const dEnd = [st.pts[0], st.pts[st.pts.length - 1]].map((e) =>
              Math.hypot(Math.max(n.bbox.x0 - e[0], 0, e[0] - n.bbox.x1), Math.max(n.bbox.y0 - e[1], 0, e[1] - n.bbox.y1))
            );
            if (Math.min(...dEnd) <= 25) {
              n.usable = true;
              n.usableBy = "unit2-inline-node-at-plot-end";
            }
          }
        }
      }
    }
  }

  scene.compileExpr = (expr) => compileExprUnit2(expr, F);
  scene.compileLabelFunction = (lab) =>
    compileNumericLabelFunctionUnit2(preprocessLabelForMatchingUnit2(lab, scene, F).effectiveLabel, F);
  if (F.enableDiagonalSvgRecovery !== false) {
    recoverDiagonalAnchorSvgNodesUnit2(scene, F);
  }
  return scene;
}

// ============================================================================
// 5. Unit 2 곡선 배정(assignStrokesUnit2) 및 배치 계획(planLabelsUnit2)
// ============================================================================

/**
 * [Unit 2] 라벨 → 곡선/선 배정
 */
export function assignStrokesUnit2(scene, targets, flags = DEFAULT_UNIT2_FLAGS) {
  const F = resolveFlags(flags);
  const res = new Map();
  const claimed = new Set();
  const numAnalyses = new Map();
  const strokes = Array.isArray(scene && scene.strokes) ? scene.strokes : [];
  const strokeOfPath = (p) => (p && p.index !== undefined ? strokes.find((s) => s && s.index === p.index) || null : null);

  const prepMap = new Map();
  const rawTargets = targets;
  targets = rawTargets.map((n) => {
    const prep = preprocessLabelForMatchingUnit2(n.label, scene, F);
    prepMap.set(n.id, prep);
    return { ...n, label: prep.effectiveLabel, _origLabel: n.label };
  });

  // ① 인라인 소속 경로 확인
  var applyAxisRequested = F.applyAxisRequested !== false;
  for (let tIdx = 0; tIdx < targets.length; tIdx++) {
    const n = targets[tIdx];
    if (n.kind === "inline" && n.stmt && n.stmt.path) {
      const st = strokeOfPath(n.stmt.path);
      if (st) {
        const strokeKind = classifyStrokeKind(st);
        res.set(n.id, {
          how: "inline",
          stroke: st,
          strokeKind,
          confirmed: true,
          uncertain: false,
          nonMoveCategory: null,
          nonMoveCode: null,
          reason: `인라인 노드로 곡선/선(#${st.index})에 직접 연결됨`,
        });
        claimed.add(st.index);
      } else {
        res.set(n.id, {
          how: "inline-unlinked",
          stroke: null,
          strokeKind: "unknown",
          confirmed: false,
          uncertain: true,
          nonMoveCategory: "매칭 불확실",
          nonMoveCode: "uncertain-match",
          reason: "인라인 문장의 SVG 경로를 찾지 못함",
        });
      }
    }
  }

  // ② 수식과 곡선의 수치적 대응 확인 (expr-match / numeric-equivalent-match)
  var applyAxisRequested = F.applyAxisRequested !== false;
  for (let tIdx = 0; tIdx < targets.length; tIdx++) {
    const n = targets[tIdx];
    if (res.has(n.id)) continue;
    const numAn = analyzeNumericLabelExpressionUnit2(n.label, F);
    numAnalyses.set(n.id, numAn);
    const f = numAn.fn;

    if (f) {
      const matches = [];
      for (const st of scene.stmts || []) {
        if (st.type === "plot" && st.fn && st.domain && st.path && !claimed.has(st.path.index)) {
          const stroke = strokeOfPath(st.path);
          if (!stroke) continue;
          let validPts = 0;
          let mismatch = false;
          for (let k = 0; k < 7; k++) {
            const x = st.domain[0] + ((st.domain[1] - st.domain[0]) * (k + 0.5)) / 7;
            const yLab = f(x);
            const yPlot = st.fn(x);
            if (!Number.isFinite(yLab) || !Number.isFinite(yPlot)) continue;
            validPts++;
            if (!(Math.abs(yLab - yPlot) < 1e-4)) {
              mismatch = true;
              break;
            }
          }
          if (!mismatch && validPts >= 4) matches.push(stroke);
        }
      }

      if (matches.length === 1) {
        const st = matches[0];
        const plotExpr = st.stmt && st.stmt.expr ? st.stmt.expr : "";
        const isNumericEquiv = Boolean(
          numAn.hasFractionOrDivision ||
            /\d+\.\d+/.test(numAn.normalizedExpr || "") ||
            (plotExpr && (plotExpr.includes("/") || /\d+\.\d+/.test(plotExpr)))
        );
        const how = isNumericEquiv ? "numeric-equivalent-match" : "expr-match";
        res.set(n.id, {
          how,
          stroke: st,
          strokeKind: classifyStrokeKind(st),
          confirmed: true,
          uncertain: false,
          normalizedExpr: numAn.compiledExpr || numAn.normalizedExpr || null,
          plotExpr,
          nonMoveCategory: null,
          nonMoveCode: null,
          reason: isNumericEquiv
            ? `분수·소수 동치 수치 함수식(${numAn.compiledExpr || n.trimmed})이 유일한 plot 곡선(#${st.index}: ${plotExpr})과 수학적으로 일치하여 확정됨`
            : `수치 함수식이 plot 곡선(#${st.index}: ${plotExpr})과 정확히 일치함`,
        });
        claimed.add(st.index);
        continue;
      } else if (matches.length >= 2) {
        // [Sub-Unit 2e] 주기/점근선 함수(예: y=\tan x)가 동일한 plot 수식으로 서로 다른 정의역(disjoint domains)에
        // 나뉘어 그려진 경우: 모든 브랜치가 같은 함수의 주기 가지이므로 가장 가까운 브랜치를 선택하고 모든 가지를 claimed 처리한다.
        const normExpr0 = String(matches[0].stmt?.expr || "").replace(/\s+/g, "");
        const allSamePlotExpr =
          F.u2e &&
          normExpr0.length > 0 &&
          matches.every((mSt) => String(mSt.stmt?.expr || "").replace(/\s+/g, "") === normExpr0);

        if (allSamePlotExpr) {
          const anchor = n.at || n.inlineAnchor || n.anchor || (n.bbox ? [(n.bbox.x0 + n.bbox.x1) / 2, (n.bbox.y0 + n.bbox.y1) / 2] : null);
          let chosen = matches[0];
          if (anchor) {
            let bestDist = Infinity;
            for (const candSt of matches) {
              const d = minDistPolylines([{ pts: [anchor, anchor], closed: false }], [{ pts: candSt.pts, closed: false }]);
              if (d < bestDist) {
                bestDist = d;
                chosen = candSt;
              }
            }
          }
          for (const candSt of matches) claimed.add(candSt.index);
          res.set(n.id, {
            how: "expr-match",
            stroke: chosen,
            strokeKind: classifyStrokeKind(chosen),
            confirmed: true,
            uncertain: false,
            normalizedExpr: numAn.compiledExpr || numAn.normalizedExpr || null,
            plotExpr: chosen.stmt?.expr || "",
            periodicBranches: matches.map((s) => s.index),
            nonMoveCategory: null,
            nonMoveCode: null,
            reason: `동일 주기 함수식(${normExpr0})의 ${matches.length}개 정의역 가지(#${matches.map((s) => s.index).join(", #")}) 중 라벨과 가장 가까운 가지(#${chosen.index})로 확정됨`,
          });
          continue;
        }

        const st = matches[0];
        res.set(n.id, {
          how: "ambiguous-numeric-match",
          stroke: st,
          strokeKind: classifyStrokeKind(st),
          confirmed: false,
          uncertain: true,
          candidateCount: matches.length,
          candidateStrokes: matches.map((s) => s.index),
          normalizedExpr: numAn.compiledExpr || numAn.normalizedExpr || null,
          nonMoveCategory: "매칭 불확실",
          nonMoveCode: "uncertain-match",
          reason: `동일한 수치 함수식에 대응하는 곡선 후보가 ${matches.length}개(#${matches.map((s) => s.index).join(", #")}) 존재하여 확정할 수 없음. 자동 이동 차단.`,
        });
        continue;
      }

      // [Unit 3-C] 수치 상수 수평선 방정식(예: y=4, y=6, y=1/4)이 plot 이 아닌 \draw (...) -- (...); 선분으로 그려진 경우
      const constY = F.u3c ? extractNumericConstantY(numAn) : null;
      if (constY !== null && Number.isFinite(constY) && scene.units && scene.units.yU) {
        const hMatches = findMatchingHorizontalLineStrokesUnit3C(scene, constY, claimed);
        if (hMatches.length === 1) {
          const st = hMatches[0];
          const isHorizEquiv = Boolean(numAn.hasFractionOrDivision || /\d+\.\d+|pi/.test(numAn.normalizedExpr || ""));
          res.set(n.id, {
            how: isHorizEquiv ? "numeric-equivalent-match" : "expr-match",
            stroke: st,
            strokeKind: classifyStrokeKind(st),
            confirmed: true,
            uncertain: false,
            normalizedExpr: `y=${r2(constY)}`,
            nonMoveCategory: null,
            nonMoveCode: null,
            reason: isHorizEquiv
              ? `수치/기호 상수 수평선 방정식(y=${r2(constY)})이 유일한 수평선 선분(#${st.index})과 일치하여 확정됨`
              : `수치 수평선 방정식(y=${r2(constY)})이 수평선 선분(#${st.index})과 정확히 일치함`,
          });
          claimed.add(st.index);
          continue;
        } else if (hMatches.length >= 2) {
          const st = hMatches[0];
          res.set(n.id, {
            how: "ambiguous-numeric-match",
            stroke: st,
            strokeKind: classifyStrokeKind(st),
            confirmed: false,
            uncertain: true,
            candidateCount: hMatches.length,
            candidateStrokes: hMatches.map((s) => s.index),
            nonMoveCategory: "매칭 불확실",
            nonMoveCode: "uncertain-match",
            reason: `동일한 수평선 방정식(y=${r2(constY)})에 대응하는 수평선 선분이 ${hMatches.length}개 존재하여 확정할 수 없음. 자동 이동 차단.`,
          });
          continue;
        }
      }
    }

    // 수치형 수직선 라벨(예: x=-2, x=\frac{1}{2}, x=-\frac{\pi}{2})과 수직선 경로 일치 검사
    const constX =
      numAn.parseOk && numAn.lhs === "x" && typeof numAn.constantX === "number"
        ? numAn.constantX
        : (() => {
            const clean = (n.trimmed || "").replace(/\s+/g, "");
            const vm = /^x=([-+]?(?:\d+\.?\d*|\.\d+))$/.exec(clean);
            return vm ? Number(vm[1]) : null;
          })();
    if (constX !== null && Number.isFinite(constX) && scene.units && scene.units.xU) {
      const xPt = constX * scene.units.xU;
      const vMatches = F.u3c
        ? findMatchingVerticalLineStrokesUnit3C(scene, constX, claimed)
        : strokes.filter(
            (s) => s.kind !== "axis" && !claimed.has(s.index) && classifyStrokeKind(s) === "verticalLine" && Math.abs(s.pts[0][0] - xPt) <= 1.5
          );
      if (vMatches.length === 1) {
        const st = vMatches[0];
        const isVertEquiv = Boolean(numAn.hasFractionOrDivision || /\d+\.\d+|pi/.test(numAn.normalizedExpr || ""));
        res.set(n.id, {
          how: isVertEquiv ? "numeric-equivalent-match" : "expr-match",
          stroke: st,
          strokeKind: "verticalLine",
          confirmed: true,
          uncertain: false,
          normalizedExpr: `x=${r2(constX)}`,
          nonMoveCategory: null,
          nonMoveCode: null,
          reason: isVertEquiv
            ? `수치/기호 상수 수직선 방정식(x=${r2(constX)})이 유일한 수직선 경로(#${st.index})와 일치하여 확정됨`
            : `수치 수직선 방정식이 수직선 경로(#${st.index})와 정확히 일치함`,
        });
        claimed.add(st.index);
        continue;
      } else if (vMatches.length >= 2) {
        const st = vMatches[0];
        res.set(n.id, {
          how: "ambiguous-numeric-match",
          stroke: st,
          strokeKind: "verticalLine",
          confirmed: false,
          uncertain: true,
          candidateCount: vMatches.length,
          candidateStrokes: vMatches.map((s) => s.index),
          nonMoveCategory: "매칭 불확실",
          nonMoveCode: "uncertain-match",
          reason: `동일한 수직선 방정식에 대응하는 수직선 경로가 ${vMatches.length}개 존재하여 확정할 수 없음. 자동 이동 차단.`,
        });
        continue;
      }
    }
  }

  // ③ 일반형/매개변수 수식의 수학적 구조 매칭 (structural-match / ambiguous-structural)
  const unclaimedAfterExact = targets.filter((n) => !res.has(n.id) && (!numAnalyses.has(n.id) || numAnalyses.get(n.id).parseOk));
  if (unclaimedAfterExact.length > 0) {
    const structMap = runStructuralMatchingUnit2(scene, unclaimedAfterExact, claimed, classifyStrokeKind, F);
    for (const [id, info] of structMap.entries()) {
      res.set(id, {
        ...info,
        nonMoveCategory: info.confirmed ? null : "매칭 불확실",
        nonMoveCode: info.confirmed ? null : "uncertain-match",
      });
    }
  }

  // ④ 여전히 미배정된 라벨: 수식 파싱 실패(parse-failure) 구분 및 최근접 추정(nearest-unclaimed)
  const rest = targets.filter((n) => !res.has(n.id));
  const pool = (plotOnly) =>
    strokes.filter(
      (s) => s && s.kind !== "axis" && Array.isArray(s.pts) && s.pts.length >= 2 && !claimed.has(s.index) && (!plotOnly || (s.stmt && s.stmt.type === "plot"))
    );
  for (const n of rest) {
    const numAn = numAnalyses.get(n.id) || analyzeNumericLabelExpressionUnit2(n.label, F);
    const a = n.at || n.inlineAnchor || n.anchor || (n.bbox ? [(n.bbox.x0 + n.bbox.x1) / 2, (n.bbox.y0 + n.bbox.y1) / 2] : null);
    let cands = pool(true);
    if (!cands.length) cands = pool(false);
    let best = null;
    if (a) {
      for (const s of cands) {
        const d = minDistPolylines([{ pts: [a, a], closed: false }], [{ pts: s.pts, closed: false }]);
        if (!best || d < best.d) best = { d, s };
      }
    }
    if (!numAn.parseOk) {
      const strokeKind = best ? classifyStrokeKind(best.s) : "unknown";
      res.set(n.id, {
        how: "parse-failure",
        stroke: best ? best.s : null,
        strokeKind,
        confirmed: false,
        uncertain: true,
        parseError: numAn.parseError,
        nonMoveCategory: "수식 파싱 실패",
        nonMoveCode: "parse-failure",
        reason: `수식 파싱 실패(${numAn.parseError || "문법/명령 오류"})로 대응 그래프를 분석할 수 없음. 자동 이동 차단.`,
      });
      continue;
    }
    if (!a) {
      res.set(n.id, {
        how: "unmatched",
        stroke: null,
        strokeKind: "unknown",
        confirmed: false,
        uncertain: true,
        nonMoveCategory: "매칭 불확실",
        nonMoveCode: "uncertain-match",
        reason: "기준 좌표 없음",
      });
      continue;
    }
    if (best) {
      const strokeKind = classifyStrokeKind(best.s);
      res.set(n.id, {
        how: "nearest-unclaimed",
        stroke: best.s,
        strokeKind,
        confirmed: false,
        uncertain: true,
        distancePt: r2(best.d),
        nonMoveCategory: "매칭 불확실",
        nonMoveCode: "uncertain-match",
        reason: "수식 구조를 확정할 수 없어 최근접 미배정 곡선으로만 추정됨. 자동 이동 차단.",
      });
      claimed.add(best.s.index);
    } else {
      res.set(n.id, {
        how: "unmatched",
        stroke: null,
        strokeKind: "unknown",
        confirmed: false,
        uncertain: true,
        nonMoveCategory: "매칭 불확실",
        nonMoveCode: "uncertain-match",
        reason: "대응 가능한 미배정 곡선/선이 없음",
      });
    }
  }
  for (const [id, info] of res.entries()) {
    const prep = prepMap.get(id);
    if (info && prep && prep.notes && prep.notes.length > 0) {
      info.preprocessNotes = prep.notes;
      info.reason = `[${prep.notes.join("; ")}] ${info.reason || ""}`;
    }
  }

  // ⑤ [Step 2: 다중 추상 함수식(y=f(x), y=g(x) / y=f'(x), y=g'(x) 등) 전역 1:1 매칭 및 3유형 안전 분류]
  // - 구체 함수식 및 1:1 잔여 곡선이 모두 먼저 확정된 이후,
  //   남은 미확정 추상 함수 라벨이 2개 이상인 경우 전역 1:1 이분 매칭 및 7대 신호를 평가한다.
  // - 기본값(multiAbstractAction === "hold")에서는 절대 자동 확정하지 않으며 원본 위치(Hold)를 유지한다.
  // - 오직 유형 2(type2-user-confirm-required)에서 사용자가 명시적으로 "recommend" 또는 "swap"을 승인한 경우에만
  //   해당 1:1 대응 관계를 confirmed=true 로 활성화하여 안전 배치를 계산한다.
  // - 유형 3(type3-hold-only: 3개 이상, 신호 모순, 교점 근방, 마진 부족)에서는 어떤 옵션이 전달되더라도 Hold를 강제한다.
  if (F.enableStep2MultiAbstractAnalysis !== false) {
    const allConfirmedStrokes = new Set();
    for (const [, info] of res.entries()) {
      if (info && info.confirmed && info.stroke) {
        allConfirmedStrokes.add(info.stroke.index);
        if (Array.isArray(info.periodicBranches)) {
          for (const bIdx of info.periodicBranches) allConfirmedStrokes.add(bIdx);
        }
      }
    }

    const unconfirmedAbstractNodes = rawTargets.filter((n) => {
      const info = res.get(n.id);
      if (info && info.confirmed) return false;
      const prep = prepMap.get(n.id) || preprocessLabelForMatchingUnit2(n.label, scene, F);
      const tpl = parseLabelStructureTemplateUnit2(prep.effectiveLabel, F);
      return Boolean(tpl && tpl.isAbstractFunctionLabel);
    });

    if (unconfirmedAbstractNodes.length >= 2) {
      const unclaimedPlotCands = strokes
        .filter((s) => {
          if (!s || s.kind === "axis" || allConfirmedStrokes.has(s.index)) return false;
          if (!s.stmt || s.stmt.type !== "plot") return false;
          if (s.kind === "dashed" || /\bdashed\b/.test(String(s.stmt.optsRaw || ""))) return false;
          const ms = analyzePlotMathStructureUnit2(s.stmt, F);
          if (ms && ms.degree === 0) return false;
          return true;
        })
        .map((s) => ({
          stroke: s,
          strokeKind: classifyStrokeKind(s),
          mathStruct: analyzePlotMathStructureUnit2(s.stmt, F),
        }));

      const step2Analysis = evaluateMultiAbstractMatchingStep2(
        scene,
        unconfirmedAbstractNodes,
        unclaimedPlotCands,
        F
      );
      if (scene) {
        scene.multiAbstractAnalysis = step2Analysis;
        scene.step2MultiAbstractAnalysis = step2Analysis;
      }

      if (step2Analysis) {
        const rawRequestedAction =
          typeof F.multiAbstractAction === "string"
            ? F.multiAbstractAction.toLowerCase()
            : F.step2SwapOrderOverride
            ? "swap"
            : F.applyStep2Tier1AutoConfirm
            ? "recommend"
            : "hold";

        // 유형 3(type3-hold-only)이거나 2:2 쌍이 아닌 경우에는 추천/Swap 요청이 들어와도 무조건 Hold 강제!
        const canUserSelect =
          step2Analysis.supportedPair &&
          (step2Analysis.classificationCode === "type2-user-confirm-required" ||
            step2Analysis.classificationCode === "type1-auto-confirmable");

        const isType1StrictAutoConfirm = Boolean(
          step2Analysis.supportedPair &&
            step2Analysis.classificationCode === "type1-auto-confirmable" &&
            step2Analysis.mathematicallyProven &&
            F.allowFiniteSampleDerivativeType1 === true
        );

        const effectiveAction = !canUserSelect
          ? "hold"
          : rawRequestedAction === "swap"
          ? "swap"
          : rawRequestedAction === "recommend" || isType1StrictAutoConfirm
          ? "recommend"
          : "hold";

        if (step2Analysis.supportedPair) {
          const chosenAssign =
            effectiveAction === "swap"
              ? step2Analysis.swappedAssignment
              : step2Analysis.recommendedAssignment;
          const shouldConfirm = effectiveAction === "recommend" || effectiveAction === "swap";

          for (const pair of chosenAssign.pairs) {
            const stObj = unclaimedPlotCands.find((c) => c.stroke.index === pair.strokeIndex);
            if (!stObj) continue;
            const sigList = [];
            if (pair.inlineOnThisPlot) sigList.push("TikZ 인라인 경로 결합");
            if (pair.signal1OnCurveExact) sigList.push(`곡선 위 점 일치(오차 ${pair.onCurveErrorPt}pt)`);
            if (pair.signal2DomainEndpointMatch) sigList.push(`정의역 끝점 일치(${pair.matchedDomainEnd})`);
            if (pair.signal3OrderMatch) sigList.push("TikZ 선언 순서 일치");
            if (pair.signal4CommentMatch) sigList.push(`주석(${pair.commentHint}) 일치`);
            if (chosenAssign.derivativeProof?.verified) {
              sigList.push(`수치 미분 보조 신호(${chosenAssign.derivativeProof.detail})`);
            }

            const howCode = shouldConfirm
              ? effectiveAction === "swap"
                ? "multi-abstract-user-swap"
                : "multi-abstract-user-recommend"
              : step2Analysis.classificationCode === "type3-hold-only"
              ? "multi-abstract-type3-hold"
              : "ambiguous-structural";

            const reasonText = shouldConfirm
              ? effectiveAction === "swap"
                ? `[유형 2 · 사용자 대응 교환(Swap) 승인] ${pair.label} ↔ 곡선 #${stObj.stroke.index}(${pair.plotExpr || "plot"}, ${pair.curveShape?.kindLabel || "곡선"}) 1:1 교환 대응 적용 (수학적 항등 증명이 아닌 사용자 선택 기준)`
                : `[유형 2 · 사용자 추천 매칭(Recommend) 승인] 전역 1:1 매칭(거리 합 마진 +${step2Analysis.rawDistMarginPt}pt) 및 추정 근거(${sigList.join(", ") || "전역 1:1 거리"})에 따라 ${pair.label} → 곡선 #${stObj.stroke.index}(${pair.plotExpr || "plot"}, ${pair.curveShape?.kindLabel || "곡선"}) 대응 적용 (수학적 증명이 아닌 기하·정의역 추정 근거)`
              : step2Analysis.classificationCode === "type3-hold-only"
              ? `[유형 3 · 원본 유지(Hold) 강제] ${step2Analysis.reason || "신호 모순·교점 근접·마진 부족으로 자동 대응 및 추천 비활성화"}`
              : `[유형 2 · 사용자 확인 필요 (기본값 Hold)] 전역 1:1 추천 후보는 곡선 #${stObj.stroke.index}(${pair.curveShape?.kindLabel || "곡선"}, 마진 +${step2Analysis.rawDistMarginPt}pt, 근거: ${sigList.join(", ") || "전역 거리"})이나 수학적으로 증명된 대응이 아니므로 사용자 명시적 승인 전까지 원본 위치(Hold)를 유지함`;

            res.set(pair.labelId, {
              how: howCode,
              stroke: stObj.stroke,
              strokeKind: stObj.strokeKind,
              confirmed: shouldConfirm,
              uncertain: !shouldConfirm,
              isMultiAbstractPair: true,
              multiAbstractAction: effectiveAction,
              nonMoveCategory: shouldConfirm ? null : "매칭 불확실",
              nonMoveCode: shouldConfirm ? null : "uncertain-match",
              step2ClassificationType: step2Analysis.classificationType,
              step2ClassificationCode: step2Analysis.classificationCode,
              step2MathematicallyProven: step2Analysis.mathematicallyProven,
              step2RequiresUserApproval: step2Analysis.requiresUserApproval,
              step2Tier: step2Analysis.tier,
              step2TierCode: step2Analysis.tierCode,
              step2Signals: sigList,
              step2RawDistMarginPt: step2Analysis.rawDistMarginPt,
              step2RecommendedStroke: step2Analysis.recommendedAssignment.pairs.find(
                (p) => p.labelId === pair.labelId
              )?.strokeIndex ?? null,
              step2SwappedStroke: step2Analysis.swappedAssignment.pairs.find(
                (p) => p.labelId === pair.labelId
              )?.strokeIndex ?? null,
              curveShape: pair.curveShape || null,
              plotExpr: pair.plotExpr || "",
              distancePt: pair.distCurvePt,
              reason: reasonText,
            });
          }
        } else {
          // 3개 이상 다중 추상 함수 또는 비대칭 카디널리티 -> Type 3 강제 Hold
          for (const nd of unconfirmedAbstractNodes) {
            const prev = res.get(nd.id);
            res.set(nd.id, {
              ...(prev || {}),
              how: "multi-abstract-type3-hold",
              stroke: prev?.stroke || null,
              strokeKind: prev?.strokeKind || "unknown",
              confirmed: false,
              uncertain: true,
              isMultiAbstractPair: true,
              multiAbstractAction: "hold",
              nonMoveCategory: "매칭 불확실",
              nonMoveCode: "uncertain-match",
              step2ClassificationType: step2Analysis.classificationType,
              step2ClassificationCode: "type3-hold-only",
              step2MathematicallyProven: false,
              step2RequiresUserApproval: false,
              reason: `[유형 3 · 원본 유지(Hold) 강제] ${step2Analysis.reason}`,
            });
          }
        }
      }
    }
  }

  return res;
}

// ============================================================================
// 5-B. 다중 추상 함수식(y=f(x), y=g(x) / y=f'(x), y=g'(x)) 전역 1:1 매칭 및 3유형 판정기
// ============================================================================

function findActualDrawStartUnit2(body, stmtStart) {
  if (!body || typeof stmtStart !== "number") return stmtStart;
  const tail = body.slice(stmtStart, Math.min(body.length, stmtStart + 400));
  const m = /\\(?:draw|path|fill|filldraw)\b/.exec(tail);
  return m ? stmtStart + m.index : stmtStart;
}

function extractCommentHintForPlotStmtUnit2(body, stmtStart) {
  if (!body || typeof stmtStart !== "number") return null;
  const actualStart = findActualDrawStartUnit2(body, stmtStart);
  const lookbackStart = Math.max(0, actualStart - 220);
  const prefix = body.slice(lookbackStart, actualStart);
  const lines = prefix.split(/\r?\n/).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("%")) {
      const m = /y\s*=\s*([-+]?[fghFGH]'*\(\s*x\s*\))/.exec(trimmed);
      if (m) return `y=${m[1].replace(/\s+/g, "")}`;
    } else {
      break;
    }
  }
  return null;
}

function extractCommentDegreeHintForPlotStmtUnit2(body, stmtStart) {
  if (!body || typeof stmtStart !== "number") return null;
  const actualStart = findActualDrawStartUnit2(body, stmtStart);
  const lookbackStart = Math.max(0, actualStart - 220);
  const prefix = body.slice(lookbackStart, actualStart);
  const lines = prefix.split(/\r?\n/).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("%")) {
      if (/(?:일차|1차|직선|linear)/i.test(trimmed)) return 1;
      if (/(?:이차|2차|포물선|quadratic)/i.test(trimmed)) return 2;
      if (/(?:삼차|3차|cubic)/i.test(trimmed)) return 3;
      if (/(?:사차|4차|quartic)/i.test(trimmed)) return 4;
    } else {
      break;
    }
  }
  return null;
}

export function parseAbstractFunctionSymbolStep2(labelStr) {
  const cleaned = String(labelStr || "")
    .replace(/^\$+|\$+$/g, "")
    .replace(/\\(?:rm|mathrm|mathit|mathbf|displaystyle)\b/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, "");
  const m = /^(?:y=)?([+-])?([fghFGH])('*)?\(x\)$/.exec(cleaned);
  if (!m) {
    return {
      valid: false,
      sign: 1,
      baseSymbol: null,
      derivOrder: 0,
      normalized: cleaned,
    };
  }
  return {
    valid: true,
    sign: m[1] === "-" ? -1 : 1,
    baseSymbol: m[2].toLowerCase(),
    derivOrder: m[3] ? m[3].length : 0,
    normalized: `y=${m[1] === "-" ? "-" : ""}${m[2]}${m[3] || ""}(x)`,
  };
}

export function verifyDerivativeRelationBetweenPlotsStep2(labelA, labelB, candA, candB) {
  const symA = parseAbstractFunctionSymbolStep2(labelA.trimmed || labelA.label);
  const symB = parseAbstractFunctionSymbolStep2(labelB.trimmed || labelB.label);
  if (!symA.valid || !symB.valid || symA.baseSymbol !== symB.baseSymbol) {
    return { verified: false, reason: "서로 다른 독립 추상 함수 기호(미분 종속 관계 없음)" };
  }
  if (Math.abs(symA.derivOrder - symB.derivOrder) !== 1) {
    return { verified: false, reason: "원함수-1계도함수 차수 관계가 아님" };
  }

  const isABase = symA.derivOrder < symB.derivOrder;
  const baseSym = isABase ? symA : symB;
  const derivSym = isABase ? symB : symA;
  const baseCand = isABase ? candA : candB;
  const derivCand = isABase ? candB : candA;

  const fnBase = baseCand?.stroke?.stmt?.fn;
  const fnDeriv = derivCand?.stroke?.stmt?.fn;
  const domBase = baseCand?.stroke?.stmt?.domain;
  const domDeriv = derivCand?.stroke?.stmt?.domain;
  if (typeof fnBase !== "function" || typeof fnDeriv !== "function" || !domBase || !domDeriv) {
    return { verified: false, reason: "plot 수치 함수 또는 정의역 없음" };
  }

  const x0 = Math.max(domBase[0], domDeriv[0]);
  const x1 = Math.min(domBase[1], domDeriv[1]);
  if (!(x1 - x0 >= 0.5)) {
    return { verified: false, reason: "공통 정의역 구간 부족" };
  }

  const signRatio = derivSym.sign / baseSym.sign;
  const h = 1e-4;
  let maxForwardErr = 0;
  let maxReverseErr = 0;
  let validSamples = 0;

  for (let k = 1; k <= 7; k++) {
    const x = x0 + ((x1 - x0) * k) / 8;
    try {
      const dBase = (fnBase(x + h) - fnBase(x - h)) / (2 * h);
      const yDeriv = fnDeriv(x);
      const dDeriv = (fnDeriv(x + h) - fnDeriv(x - h)) / (2 * h);
      const yBase = fnBase(x);
      if (!Number.isFinite(dBase) || !Number.isFinite(yDeriv) || !Number.isFinite(dDeriv) || !Number.isFinite(yBase)) {
        continue;
      }
      validSamples++;
      const errFwd = Math.abs(signRatio * dBase - yDeriv);
      const errRev = Math.abs(signRatio * dDeriv - yBase);
      if (errFwd > maxForwardErr) maxForwardErr = errFwd;
      if (errRev > maxReverseErr) maxReverseErr = errRev;
    } catch {}
  }

  if (validSamples >= 5 && maxForwardErr <= 0.015 && maxReverseErr > 0.1) {
    return {
      verified: true,
      finiteSampleOnly: true,
      proofType: "derivative-finite-sample-match",
      baseLabel: isABase ? labelA.label : labelB.label,
      derivLabel: isABase ? labelB.label : labelA.label,
      baseStrokeIndex: baseCand.stroke.index,
      derivStrokeIndex: derivCand.stroke.index,
      maxForwardErr: r2(maxForwardErr),
      detail: `${isABase ? labelA.trimmed || labelA.label : labelB.trimmed || labelB.label}(곡선 #${baseCand.stroke.index})의 유한 샘플 수치 도함수가 ${isABase ? labelB.trimmed || labelB.label : labelA.trimmed || labelA.label}(곡선 #${derivCand.stroke.index})와 근사 일치(오차 ${r2(maxForwardErr)}, 유한 샘플 추정 근거)`,
    };
  }

  return {
    verified: false,
    maxForwardErr: r2(maxForwardErr),
    reason: `원함수-도함수 미분 관계 불일치(최대 오차 ${r2(maxForwardErr)})`,
  };
}

export function summarizeCurveShapeProfileStep2(cand) {
  const st = cand?.stroke;
  const ms = cand?.mathStruct;
  const fn = st?.stmt?.fn;
  const dom = st?.stmt?.domain;
  const exprStr = String(st?.stmt?.expr || "");
  let degree = ms && typeof ms.degree === "number" ? ms.degree : null;

  if (
    degree === null &&
    typeof fn === "function" &&
    Array.isArray(dom) &&
    dom.length === 2 &&
    dom[1] > dom[0] &&
    !/\b(?:sin|cos|tan|ln|log|exp|sqrt)\b/i.test(exprStr)
  ) {
    try {
      const samples = [0, 1, 2, 3, 4, 5].map((k) => fn(dom[0] + ((dom[1] - dom[0]) * k) / 5));
      if (samples.every((v) => Number.isFinite(v))) {
        const diff = (arr) => arr.slice(1).map((v, i) => v - arr[i]);
        const d1 = diff(samples);
        const d2 = diff(d1);
        const d3 = diff(d2);
        const d4 = diff(d3);
        const maxAbs = (arr) => Math.max(...arr.map((v) => Math.abs(v)));
        const spread = (arr) => Math.max(...arr) - Math.min(...arr);
        if (maxAbs(d3) > 1e-4 && spread(d3) <= 1e-3) {
          degree = 3;
        } else if (maxAbs(d4) > 1e-4 && spread(d4) <= 1e-3) {
          degree = 4;
        }
      }
    } catch {}
  }

  let extremaCount = 0;
  let monotonicity = "unknown";
  if (typeof fn === "function" && Array.isArray(dom) && dom.length === 2 && dom[1] > dom[0]) {
    const N = 32;
    let prevSign = 0;
    let posCount = 0;
    let negCount = 0;
    for (let i = 0; i < N; i++) {
      const u0 = dom[0] + ((dom[1] - dom[0]) * i) / N;
      const u1 = dom[0] + ((dom[1] - dom[0]) * (i + 1)) / N;
      try {
        const dy = fn(u1) - fn(u0);
        if (Math.abs(dy) > 1e-4) {
          const sgn = dy > 0 ? 1 : -1;
          if (sgn > 0) posCount++;
          else negCount++;
          if (prevSign !== 0 && sgn !== prevSign) extremaCount++;
          prevSign = sgn;
        }
      } catch {}
    }
    if (posCount > 0 && negCount === 0) monotonicity = "단조증가";
    else if (negCount > 0 && posCount === 0) monotonicity = "단조감소";
    else if (posCount > 0 && negCount > 0) monotonicity = "비단조(극점 존재)";
  }

  const kindLabel =
    degree === 1
      ? "1차 직선"
      : degree === 2
      ? "2차 포물선"
      : degree === 3
      ? "3차 다항곡선"
      : degree === 4
      ? "4차 다항곡선"
      : ms?.kind === "non-polynomial"
      ? "초월함수 곡선"
      : "일반 plot 곡선";

  return {
    degree,
    kindLabel,
    monotonicity,
    extremaCount,
    summary: `${kindLabel} (${monotonicity}, 정의역 내 극점 ${extremaCount}개)`,
  };
}

export function evaluateMultiAbstractMatchingStep2(
  scene,
  abstractNodes,
  plotCandidates,
  flags = DEFAULT_UNIT2_FLAGS
) {
  const F = resolveFlags(flags);
  if (!scene || !Array.isArray(abstractNodes) || abstractNodes.length < 2) return null;

  const { xU = 28.45, yU = 28.45, everyNodeScale = 2.2 } = scene.units || {};
  const sortedLabels = [...abstractNodes].sort((a, b) => a.start - b.start);
  const sortedStrokes = [...(plotCandidates || [])].sort(
    (a, b) => (a.stroke.stmt?.start || 0) - (b.stroke.stmt?.start || 0)
  );

  // 그래프 스케일(xU, yU) 및 라벨 크기(bbox 높이, nodeScale)에 적응하는 일반화 안전 임계값 계산:
  // - 출발점: 교점 근방 분리 임계값 8.0pt, 전역 1:1 마진 임계값 12.0pt, 곡선 위 점 일치 임계값 1.5pt
  // - 라벨 크기가 크거나(scale > 2.2) 스케일이 다른 도형에서도 오매칭이 발생하지 않도록 비례 보정
  const labelHeights = sortedLabels
    .map((nd) => (nd.bbox ? nd.bbox.y1 - nd.bbox.y0 : 18.0))
    .filter((h) => Number.isFinite(h) && h > 0);
  const avgLabelHeightPt =
    labelHeights.length > 0
      ? r2(labelHeights.reduce((a, b) => a + b, 0) / labelHeights.length)
      : 18.0;
  const nodeScales = sortedLabels
    .map((nd) => (Array.isArray(nd.scale) ? Math.max(nd.scale[0] || 1, nd.scale[1] || 1) : everyNodeScale || 2.2))
    .filter((s) => Number.isFinite(s) && s > 0);
  const avgNodeScale =
    nodeScales.length > 0
      ? r2(nodeScales.reduce((a, b) => a + b, 0) / nodeScales.length)
      : 2.2;

  const scaleRatio = Math.min(1.3, Math.max(0.85, avgNodeScale / 2.2));
  const minIntersectionSepPt = r2(Math.max(8.0, Math.min(14.0, avgLabelHeightPt * 0.42)));
  const minGlobalMarginPt = r2(Math.max(12.0, 12.0 * scaleRatio));
  const onCurveTolPt = r2(Math.max(1.5, Math.min(2.2, 1.5 * Math.max(0.85, Math.min(1.25, yU / 28.45)))));
  const scaleNormalizedThresholds = {
    xUPt: r2(xU),
    yUPt: r2(yU),
    avgNodeScale,
    avgLabelHeightPt,
    minIntersectionSepPt,
    minGlobalMarginPt,
    onCurveTolPt,
    moderateMarginCautionPt: 25.0,
  };

  if (sortedLabels.length !== 2 || sortedStrokes.length !== 2) {
    const reasonMsg =
      sortedLabels.length >= 3
        ? `추상 함수 라벨이 ${sortedLabels.length}개(3개 이상 다중 추상 함수) 존재하여 경우의 수(${sortedLabels.length}!가지) 폭발 및 오매칭 방지를 위해 원본 유지(Hold)를 강제함`
        : `추상 함수 라벨(${sortedLabels.length}개)과 미배정 함수 곡선(${sortedStrokes.length}개)의 개수가 2:2 일대일 구조가 아니어서 원본 유지(Hold)를 강제함`;
    return {
      supportedPair: false,
      classificationType: "Type 3 (원본 유지 — 3개 이상 다중 추상 함수 또는 비대칭 카디널리티 Hold 강제)",
      classificationCode: "type3-hold-only",
      mathematicallyProven: false,
      proofMethod: null,
      requiresUserApproval: false,
      defaultUnapprovedAction: "hold",
      tier: "Tier 3 (Low / Ambiguous - Hold)",
      tierCode: "tier3-hold",
      autoConfirmSafe: false,
      scaleNormalizedThresholds,
      cardinalityInfo: {
        labelCount: sortedLabels.length,
        curveCount: sortedStrokes.length,
      },
      contradictions: [reasonMsg],
      uncertaintyFactors: [reasonMsg],
      reason: reasonMsg,
    };
  }

  const [L0, L1] = sortedLabels;
  const [S0, S1] = sortedStrokes;
  const labels = [L0, L1];
  const strokes = [S0, S1];
  const shapeProfiles = strokes.map((c) => summarizeCurveShapeProfileStep2(c));
  const labelSymbols = labels.map((nd) => parseAbstractFunctionSymbolStep2(nd.trimmed || nd.label));

  const pairMatrix = labels.map((nd, li) => {
    const normLabel = String(nd.trimmed || nd.label || "")
      .replace(/^\$+|\$+$/g, "")
      .replace(/\s+/g, "");
    const anchorPt =
      nd.at ||
      nd.inlineAnchor ||
      nd.anchor ||
      (nd.bbox ? [(nd.bbox.x0 + nd.bbox.x1) / 2, (nd.bbox.y0 + nd.bbox.y1) / 2] : null);
    const mathAt = anchorPt ? [anchorPt[0] / xU, anchorPt[1] / yU] : null;

    let curveVerticalSeparationPtAtX0 = null;
    if (mathAt && strokes[0].stroke.stmt?.fn && strokes[1].stroke.stmt?.fn) {
      try {
        const yA = strokes[0].stroke.stmt.fn(mathAt[0]);
        const yB = strokes[1].stroke.stmt.fn(mathAt[0]);
        if (Number.isFinite(yA) && Number.isFinite(yB)) {
          curveVerticalSeparationPtAtX0 = r2(Math.abs(yA - yB) * yU);
        }
      } catch {}
    }

    return strokes.map((cand, sj) => {
      const st = cand.stroke;
      const fn = st.stmt?.fn;
      const dom = st.stmt?.domain || null;
      const otherSt = strokes[1 - sj].stroke;
      const otherFn = otherSt.stmt?.fn;
      const otherDom = otherSt.stmt?.domain || null;

      const distCurvePt = anchorPt
        ? r2(minDistPolylines([{ pts: [anchorPt, anchorPt], closed: false }], [{ pts: st.pts, closed: false }]))
        : 999;

      let onCurveErrorMath = null;
      let onCurveErrorPt = null;
      let signal1OnCurveExact = false;
      if (mathAt && fn && dom && mathAt[0] >= dom[0] - 0.05 && mathAt[0] <= dom[1] + 0.05) {
        try {
          const yVal = fn(mathAt[0]);
          if (Number.isFinite(yVal)) {
            onCurveErrorMath = r2(Math.abs(mathAt[1] - yVal));
            onCurveErrorPt = r2(Math.abs(mathAt[1] - yVal) * yU);
            if (onCurveErrorPt <= onCurveTolPt) {
              signal1OnCurveExact = true;
            }
          }
        } catch {}
      }

      let isExactPointOnOtherCurve = false;
      if (mathAt && otherFn && otherDom && mathAt[0] >= otherDom[0] - 0.05 && mathAt[0] <= otherDom[1] + 0.05) {
        try {
          const yOther = otherFn(mathAt[0]);
          if (Number.isFinite(yOther) && Math.abs(mathAt[1] - yOther) * yU <= onCurveTolPt) {
            isExactPointOnOtherCurve = true;
          }
        } catch {}
      }

      let signal2DomainEndpointMatch = false;
      let matchedDomainEnd = null;
      if (mathAt && dom && !isExactPointOnOtherCurve) {
        const matchD0 = Math.abs(mathAt[0] - dom[0]) <= 0.02;
        const matchD1 = Math.abs(mathAt[0] - dom[1]) <= 0.02;
        const otherMatchD0 = otherDom ? Math.abs(mathAt[0] - otherDom[0]) <= 0.02 : false;
        const otherMatchD1 = otherDom ? Math.abs(mathAt[0] - otherDom[1]) <= 0.02 : false;
        if (matchD1 && !otherMatchD1) {
          signal2DomainEndpointMatch = true;
          matchedDomainEnd = `d1=${dom[1]}`;
        } else if (matchD0 && !otherMatchD0) {
          signal2DomainEndpointMatch = true;
          matchedDomainEnd = `d0=${dom[0]}`;
        }
      }

      const signal3OrderMatch = li === sj;
      const charGapAfterPlot = nd.start - (st.stmt?.end || 0);
      const signal3AdjacentDecl = charGapAfterPlot >= 0 && charGapAfterPlot <= 80;
      const inlineOnThisPlot = Boolean(
        nd.kind === "inline" &&
          st.stmt &&
          nd.start >= st.stmt.start &&
          nd.end <= st.stmt.end
      );

      const commentHint = extractCommentHintForPlotStmtUnit2(scene.body, st.stmt?.start || 0);
      const signal4CommentMatch = Boolean(commentHint && commentHint === normLabel);
      const commentDegreeHint = extractCommentDegreeHintForPlotStmtUnit2(scene.body, st.stmt?.start || 0);
      const curveDegree = shapeProfiles[sj].degree;
      const commentDegreeConsistent =
        commentDegreeHint === null || curveDegree === null || commentDegreeHint === curveDegree;

      const hasHardMathGeomSignal = signal1OnCurveExact || signal2DomainEndpointMatch || inlineOnThisPlot;

      const effectiveCost = r2(
        distCurvePt -
          (signal1OnCurveExact ? 12.0 : 0) -
          (signal2DomainEndpointMatch ? 10.0 : 0) -
          (inlineOnThisPlot ? 50.0 : 0)
      );

      return {
        labelId: nd.id,
        label: nd.label,
        labelSymbol: labelSymbols[li],
        strokeIndex: st.index,
        plotExpr: st.stmt?.expr || "",
        domain: dom,
        curveShape: shapeProfiles[sj],
        mathAt: mathAt ? [r2(mathAt[0]), r2(mathAt[1])] : null,
        distCurvePt,
        onCurveErrorMath,
        onCurveErrorPt,
        signal1OnCurveExact,
        signal2DomainEndpointMatch,
        matchedDomainEnd,
        signal3OrderMatch,
        signal3AdjacentDecl,
        inlineOnThisPlot,
        charGapAfterPlot,
        commentHint,
        signal4CommentMatch,
        commentDegreeHint,
        commentDegreeConsistent,
        hasHardMathGeomSignal,
        curveVerticalSeparationPtAtX0,
        effectiveCost,
      };
    });
  });

  const derivCheckA = verifyDerivativeRelationBetweenPlotsStep2(L0, L1, S0, S1);
  const derivCheckB = verifyDerivativeRelationBetweenPlotsStep2(L0, L1, S1, S0);

  // 주의: 유한 샘플 수치 미분 일치(derivCheck)는 allowFiniteSampleDerivativeType1 === true 일 때만
  // 수학적 증명으로 취급하며, 기본값(false)에서는 명시적 TikZ 인라인 경로 결합만 수학적/구조적 증명으로 인정한다!
  const isProvenA = Boolean(
    pairMatrix[0][0].inlineOnThisPlot && pairMatrix[1][1].inlineOnThisPlot
  ) || Boolean(F.allowFiniteSampleDerivativeType1 && derivCheckA.verified);
  const isProvenB = Boolean(
    pairMatrix[0][1].inlineOnThisPlot && pairMatrix[1][0].inlineOnThisPlot
  ) || Boolean(F.allowFiniteSampleDerivativeType1 && derivCheckB.verified);

  const assignA = {
    name: "Assignment A (L0→S0, L1→S1)",
    pairs: [pairMatrix[0][0], pairMatrix[1][1]],
    rawDistSumPt: r2(pairMatrix[0][0].distCurvePt + pairMatrix[1][1].distCurvePt),
    effectiveCostSum: r2(
      pairMatrix[0][0].effectiveCost +
        pairMatrix[1][1].effectiveCost -
        (derivCheckA.verified ? 40.0 : 0)
    ),
    hardSignalCount:
      (pairMatrix[0][0].hasHardMathGeomSignal ? 1 : 0) +
      (pairMatrix[1][1].hasHardMathGeomSignal ? 1 : 0) +
      (derivCheckA.verified ? 1 : 0),
    orderConsistent: true,
    commentConsistent:
      (!pairMatrix[0][0].commentHint || pairMatrix[0][0].signal4CommentMatch) &&
      (!pairMatrix[1][1].commentHint || pairMatrix[1][1].signal4CommentMatch) &&
      pairMatrix[0][0].commentDegreeConsistent &&
      pairMatrix[1][1].commentDegreeConsistent,
    derivativeProof: derivCheckA,
    inlineProof: Boolean(pairMatrix[0][0].inlineOnThisPlot || pairMatrix[1][1].inlineOnThisPlot),
    mathematicallyProven: isProvenA,
  };

  const assignB = {
    name: "Assignment B (L0→S1, L1→S0)",
    pairs: [pairMatrix[0][1], pairMatrix[1][0]],
    rawDistSumPt: r2(pairMatrix[0][1].distCurvePt + pairMatrix[1][0].distCurvePt),
    effectiveCostSum: r2(
      pairMatrix[0][1].effectiveCost +
        pairMatrix[1][0].effectiveCost -
        (derivCheckB.verified ? 40.0 : 0)
    ),
    hardSignalCount:
      (pairMatrix[0][1].hasHardMathGeomSignal ? 1 : 0) +
      (pairMatrix[1][0].hasHardMathGeomSignal ? 1 : 0) +
      (derivCheckB.verified ? 1 : 0),
    orderConsistent: false,
    commentConsistent:
      (!pairMatrix[0][1].commentHint || pairMatrix[0][1].signal4CommentMatch) &&
      (!pairMatrix[1][0].commentHint || pairMatrix[1][0].signal4CommentMatch) &&
      pairMatrix[0][1].commentDegreeConsistent &&
      pairMatrix[1][0].commentDegreeConsistent,
    derivativeProof: derivCheckB,
    inlineProof: Boolean(pairMatrix[0][1].inlineOnThisPlot || pairMatrix[1][0].inlineOnThisPlot),
    mathematicallyProven: isProvenB,
  };

  const naiveL0 = pairMatrix[0][0].distCurvePt <= pairMatrix[0][1].distCurvePt ? S0.stroke.index : S1.stroke.index;
  const naiveL1 = pairMatrix[1][0].distCurvePt <= pairMatrix[1][1].distCurvePt ? S0.stroke.index : S1.stroke.index;
  const naiveCollision = naiveL0 === naiveL1;

  const bestAssign = assignA.effectiveCostSum <= assignB.effectiveCostSum ? assignA : assignB;
  const altAssign = bestAssign === assignA ? assignB : assignA;

  const rawDistMarginPt = r2(altAssign.rawDistSumPt - bestAssign.rawDistSumPt);
  const effectiveCostMargin = r2(altAssign.effectiveCostSum - bestAssign.effectiveCostSum);

  const contradictions = [];
  if (rawDistMarginPt < 0 && !bestAssign.mathematicallyProven) {
    contradictions.push(`전역 거리 합(${bestAssign.rawDistSumPt}pt)이 대안 배정(${altAssign.rawDistSumPt}pt)보다 큼`);
  }
  if (altAssign.hardSignalCount > 0 && !bestAssign.mathematicallyProven) {
    contradictions.push(`차순위 배정에도 기하/정의역 신호(${altAssign.hardSignalCount}개)가 존재하여 유일성을 보장할 수 없음`);
  }
  if (!bestAssign.commentConsistent) {
    contradictions.push("TikZ 주석의 함수명/차수 힌트와 기하학적 배정이 서로 모순됨");
  }
  for (const p of bestAssign.pairs) {
    if (p.curveVerticalSeparationPtAtX0 !== null && p.curveVerticalSeparationPtAtX0 < minIntersectionSepPt) {
      contradictions.push(
        `라벨 ${p.label} 의 x좌표에서 두 곡선 간 수직 간격이 ${p.curveVerticalSeparationPtAtX0}pt (< ${minIntersectionSepPt}pt, 교점 근방)로 매우 좁아 오매칭 위험`
      );
    }
  }

  let tier = "Tier 3 (Low / Ambiguous - Hold)";
  let tierCode = "tier3-hold";
  let autoConfirmSafe = false;
  let classificationType = "Type 3 (원본 유지 — 근거 부족·모호·충돌 차단)";
  let classificationCode = "type3-hold-only";
  let mathematicallyProven = false;
  let proofMethod = null;
  let requiresUserApproval = false;
  let defaultUnapprovedAction = "hold";

  if (contradictions.length === 0 && bestAssign.mathematicallyProven) {
    mathematicallyProven = true;
    proofMethod = bestAssign.inlineProof ? "inline-plot-node" : "derivative-pair-verified";
    classificationType = "Type 1 (자동 확정 가능 — 명시적 구조 연결 증명)";
    classificationCode = "type1-auto-confirmable";
    requiresUserApproval = false;
    defaultUnapprovedAction = "auto-confirm";
    tier = "Tier 1 (High Confidence — 명시적 구조 증명 완료)";
    tierCode = "tier1-high";
    autoConfirmSafe = true;
  } else if (
    contradictions.length === 0 &&
    bestAssign.hardSignalCount >= 2 &&
    rawDistMarginPt >= minGlobalMarginPt &&
    effectiveCostMargin >= 30.0
  ) {
    classificationType = "Type 2 (사용자 확인 필요 — 기하·정의역 1:1 강추천 제공, 미승인 시 기본값 Hold)";
    classificationCode = "type2-user-confirm-required";
    mathematicallyProven = false;
    requiresUserApproval = true;
    defaultUnapprovedAction = "hold";
    tier = "Tier 1 (High Confidence — 다중 기하·정의역·전역 1:1 신호 일치, 사용자 승인 대상)";
    tierCode = "tier1-high";
    autoConfirmSafe = false; // 자동 확정 금지 원칙: 사용자 명시적 승인 전에는 자동 확정하지 않음!
  } else if (
    contradictions.length === 0 &&
    rawDistMarginPt >= minGlobalMarginPt &&
    bestAssign.hardSignalCount >= 1
  ) {
    classificationType = "Type 2 (사용자 확인 필요 — 전역 1:1 우세하나 일부 결정적 신호 부족, 기본값 Hold)";
    classificationCode = "type2-user-confirm-required";
    mathematicallyProven = false;
    requiresUserApproval = true;
    defaultUnapprovedAction = "hold";
    tier = "Tier 2 (Medium Confidence — 전역 1:1 우세하나 일부 결정적 신호 부족, 사용자 승인 대상)";
    tierCode = "tier2-medium-approval";
    autoConfirmSafe = false;
  }

  const moderateMarginCaution =
    classificationCode === "type2-user-confirm-required" &&
    rawDistMarginPt < scaleNormalizedThresholds.moderateMarginCautionPt;

  const uncertaintyFactors = [];
  if (!mathematicallyProven) {
    uncertaintyFactors.push(
      `추상 함수 기호(${labels.map((l) => l.trimmed || l.label).join(", ")})는 라벨 수식 내부에 구체 다항식/초월식 계수가 없어 기호 이름만으로는 대수적 항등 증명이 불가능함 (기하·정의역 추정 근거)`
    );
  }
  if (bestAssign.derivativeProof?.verified && !F.allowFiniteSampleDerivativeType1) {
    uncertaintyFactors.push(
      `유한 샘플 수치 미분 일치(${bestAssign.derivativeProof.detail})가 감지되었으나, 유한 좌표 샘플만으로 수학적 항등 증명으로 간주하지 않고 사용자 확인(유형 2, 기본값 Hold)으로 안전 처리함`
    );
  }
  if (naiveCollision) {
    uncertaintyFactors.push(
      `단순 최근접 매칭 적용 시 두 라벨 모두 곡선 #${naiveL0}에 중복 배정되는 기하학적 근접 함정이 존재함 (전역 1:1 이분 매칭으로 중복 배정 방지)`
    );
  }
  if (moderateMarginCaution) {
    uncertaintyFactors.push(
      `전역 1:1 후보 간 점수(거리 합) 차이(+${rawDistMarginPt}pt)가 상대적으로 크지 않으므로(< ${scaleNormalizedThresholds.moderateMarginCautionPt}pt), 반드시 미리보기에서 곡선 개형과 대응 관계를 확인한 뒤 선택해야 함`
    );
  }
  if (rawDistMarginPt < minGlobalMarginPt) {
    uncertaintyFactors.push(
      `전역 1:1 거리 합 마진(${rawDistMarginPt}pt)이 스케일 보정 안전 임계값(${minGlobalMarginPt}pt) 미만으로 두 대안 배정 간 거리 차이가 작아 추천을 차단하고 Hold를 강제함`
    );
  }
  if (bestAssign.hardSignalCount < 2 && !mathematicallyProven) {
    uncertaintyFactors.push(
      `결정적 기하·정의역 신호(곡선 위 점 일치 또는 고유 끝점 일치)가 ${bestAssign.hardSignalCount}/2개임`
    );
  }
  for (const c of contradictions) {
    uncertaintyFactors.push(`모순/위험 감지: ${c}`);
  }

  const reasonSummary =
    classificationCode === "type3-hold-only"
      ? contradictions.length > 0
        ? `신호 모순 또는 교점 근접 감지(${contradictions.join("; ")})로 인해 추천/Swap을 제한하고 원본 유지(Hold)를 강제함`
        : `기하·정의역 결정적 근거 부족(신호 ${bestAssign.hardSignalCount}개, 마진 +${rawDistMarginPt}pt < ${minGlobalMarginPt}pt)으로 인해 원본 유지(Hold)를 강제함`
      : `전역 1:1 매칭 후보(${bestAssign.pairs.map((p) => `${p.label}→#${p.strokeIndex}`).join(", ")}, 마진 +${rawDistMarginPt}pt)가 산출되었으나 수학적 항등 증명이 아니므로 사용자 승인 전까지 기본값 Hold를 유지함`;

  const topSignalTags = [];
  if (bestAssign.pairs.some((p) => p.signal1OnCurveExact)) topSignalTags.push("on-curve-exact");
  if (bestAssign.pairs.some((p) => p.signal2DomainEndpointMatch)) topSignalTags.push("domain-endpoint-match");
  if (bestAssign.pairs.some((p) => p.signal3OrderMatch)) topSignalTags.push("order-match");
  if (bestAssign.pairs.some((p) => p.signal4CommentMatch)) topSignalTags.push("comment-match");
  if (bestAssign.derivativeProof?.verified) topSignalTags.push("derivative-relation-finite-sample-agreement");

  return {
    supportedPair: true,
    classificationType,
    classificationCode,
    mathematicallyProven,
    proofMethod,
    requiresUserApproval,
    defaultUnapprovedAction,
    moderateMarginCaution,
    scaleNormalizedThresholds,
    tier,
    tierCode,
    autoConfirmSafe,
    signals: topSignalTags,
    holdReason: classificationCode === "type3-hold-only" ? reasonSummary : null,
    summaryReason: reasonSummary,
    naiveNearestResult: {
      L0Stroke: naiveL0,
      L1Stroke: naiveL1,
      naiveDuplicateError: naiveCollision,
    },
    rawDistMarginPt,
    effectiveCostMargin,
    contradictions,
    uncertaintyFactors,
    recommendedAssignment: bestAssign,
    swappedAssignment: altAssign,
    pairMatrix,
    reason: reasonSummary,
  };
}

/**
 * [Sub-Unit 2e] 주기 진동 삼각함수(sin, cos) 곡선 상단(극댓값 부근) 무충돌 배치 유지 판정:
 * - sin, cos 곡선은 양 끝점 근처에 보조선/축 눈금이 밀집한 경우가 많아,
 *   원본 라벨이 곡선 상단(yMax 부근)에 무충돌로 배치되어 있고 가장 가까운 곡선 점과도
 *   적절히 인접(<= 12pt)해 있으면 원 위치를 유지한다 (예: CASE-005).
 */
function checkTrigCrestKeep(node, stroke, eval0, P = PARAMS) {
  if (!stroke || !stroke.stmt || stroke.stmt.type !== "plot") return null;
  const exprStr = String(stroke.stmt.expr || "");
  if (!/\b(?:sin|cos)\b/.test(exprStr)) return null;

  const clearanceOk = eval0.minOther >= P.cHard && eval0.own >= P.cOwn && eval0.labelGap >= P.mLabel;
  if (!clearanceOk) return null;

  const sBbox = stroke.bbox;
  if (!sBbox) return null;
  const b = node.bbox;
  const cx = (b.x0 + b.x1) / 2;

  // 라벨이 곡선의 가로 범위 내부에 있고, 라벨 하단(b.y0)이 곡선 최댓값(sBbox.y1) 부근(0pt ~ 10pt)에 위치하며
  // 자기 곡선과의 실제 거리가 너무 멀지 않은(own <= 12pt) 경우에만 극댓값 상단 배치로 인정
  const withinXSpan = cx >= sBbox.x0 && cx <= sBbox.x1;
  const nearCrestY = b.y0 >= sBbox.y1 - 1.5 && b.y0 <= sBbox.y1 + 11.5;
  const closeToCurve = eval0.own >= 0 && eval0.own <= 12.0;

  if (withinXSpan && nearCrestY && closeToCurve) {
    return {
      keep: true,
      currentEnd: 1,
      preferredEnd: 1,
      currentSide: "above",
      endGapPt: r2(eval0.own),
      alpha: 0,
      beta: 0,
      checks: { clearanceOk: true, endOk: true, proximityOk: true, directionOk: true, alignmentOk: true },
      rejectReasons: [],
    };
  }
  return null;
}

/**
 * [Unit 2] 라벨 배치 계획기 (assignStrokesUnit2 + v0.2.1 후보 생성기 결합)
 */
export function planLabelsUnit2(scene, P = PARAMS, axisPt = null, flags = DEFAULT_UNIT2_FLAGS) {
  const F = resolveFlags(flags);
  const plan = { placements: [], skipped: [], advisory: [], notes: [] };
  const targets = scene.nodes.filter((n) => n.role === "function" && n.bbox);
  const fixed = scene.nodes.filter((n) => n.bbox && n.role !== "function" && n.role !== "marker");
  const assigned = assignStrokesUnit2(scene, targets, F);

  const strokesEff = scene.strokes.map((s) => {
    if (s.kind !== "axis" || !axisPt) return s;
    const horizontal = Math.abs(s.pts[0][1] - s.pts[s.pts.length - 1][1]) < 1e-6;
    return {
      ...s,
      pts: horizontal
        ? [[axisPt.left, s.pts[0][1]], [axisPt.right, s.pts[0][1]]]
        : [[s.pts[0][0], axisPt.bottom], [s.pts[0][0], axisPt.top]],
    };
  });

  const placedBoxes = [];
  let content = null;
  const addC = (b) => {
    content = content
      ? { x0: Math.min(content.x0, b.x0), y0: Math.min(content.y0, b.y0), x1: Math.max(content.x1, b.x1), y1: Math.max(content.y1, b.y1) }
      : { ...b };
  };
  for (const s of scene.strokes) if (s.kind !== "axis") for (const p of s.pts) addC({ x0: p[0], y0: p[1], x1: p[0], y1: p[1] });
  for (const n of fixed) if (n.role !== "axisLabel" && n.role !== "origin") addC(n.bbox);

  // [공동 최적화(Joint Optimization)]: 항상 동일한 원본 TikZ의 축 끝 좌표(xl0, xr0, yb0, yt0)를 기준으로
  // 각 라벨 후보에 필요한 추가 축 연장량(marginalAxisExtPt)을 계산하고, 해당 축 연장 시 기존 노드와의 충돌 여부를 검증한다.
  const hasAxes0 = Boolean(
    F.enableJointAxisOpt !== false &&
      scene?.axes?.x &&
      scene?.axes?.y &&
      scene?.units?.xU &&
      scene?.units?.yU
  );
  const xl0 = hasAxes0 ? Math.min(scene.axes.x.from, scene.axes.x.to) * scene.units.xU : -Infinity;
  const xr0 = hasAxes0 ? Math.max(scene.axes.x.from, scene.axes.x.to) * scene.units.xU : Infinity;
  const yb0 = hasAxes0 ? Math.min(scene.axes.y.from, scene.axes.y.to) * scene.units.yU : -Infinity;
  const yt0 = hasAxes0 ? Math.max(scene.axes.y.from, scene.axes.y.to) * scene.units.yU : Infinity;
  const mRightJ = P.margins?.right ?? 16.0;
  const mTopJ = P.margins?.top ?? 18.5;
  const mNegTargetJ = P.negTargetMarginPt ?? 12.0;
  const mNegNearNodeJ = P.negNearNodeMarginPt ?? 4.0;
  const negNearTriggerJ = P.negNodeNearTriggerGapPt ?? 3.5;

  const computeBaseAxisReqPt = () => {
    let reqR = xr0;
    let reqT = yt0;
    let reqL = xl0;
    let reqB = yb0;
    if (!hasAxes0) return { reqL, reqR, reqB, reqT };
    const ign = P.axisIgnoreEndWithin ?? 1.5;
    for (const st of scene.strokes || []) {
      if (!st || st.kind === "axis" || !Array.isArray(st.pts) || st.pts.length === 0) continue;
      let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
      for (const p of st.pts) {
        if (p[0] < sx0) sx0 = p[0];
        if (p[0] > sx1) sx1 = p[0];
        if (p[1] < sy0) sy0 = p[1];
        if (p[1] > sy1) sy1 = p[1];
      }
      const p0 = st.pts[0], p1 = st.pts[st.pts.length - 1];
      const touchesRight = Math.abs(p0[0] - xr0) <= ign || Math.abs(p1[0] - xr0) <= ign;
      const touchesTop = Math.abs(p0[1] - yt0) <= ign || Math.abs(p1[1] - yt0) <= ign;
      if (!touchesRight || sx1 > xr0 + ign) reqR = Math.max(reqR, sx1 + mRightJ);
      if (!touchesTop || sy1 > yt0 + ign) reqT = Math.max(reqT, sy1 + mTopJ);
      if (sx0 - xl0 < -0.5) reqL = Math.min(reqL, sx0 - mNegTargetJ);
      if (sy0 - yb0 < -0.5) reqB = Math.min(reqB, sy0 - mNegTargetJ);
    }
    const applyBoxToAxisReq = (b) => {
      reqR = Math.max(reqR, b.x1 + mRightJ);
      reqT = Math.max(reqT, b.y1 + mTopJ);
      const gapL = b.x0 - xl0;
      const nearX = b.y0 <= 8.0 && b.y1 >= -8.0;
      if (gapL < 0) reqL = Math.min(reqL, b.x0 - mNegTargetJ);
      else if (nearX && gapL < negNearTriggerJ) reqL = Math.min(reqL, b.x0 - mNegNearNodeJ);
      const gapB = b.y0 - yb0;
      if (gapB < 0) reqB = Math.min(reqB, b.y0 - mNegTargetJ);
      else if (gapB < negNearTriggerJ) reqB = Math.min(reqB, b.y0 - mNegNearNodeJ);
    };
    for (const fn of fixed) {
      if (fn.role !== "axisLabel" && fn.role !== "origin") applyBoxToAxisReq(fn.bbox);
    }
    for (const pb of placedBoxes) applyBoxToAxisReq(pb);
    return { reqL, reqR, reqB, reqT };
  };

  const evaluateJointAxisImpact = (bb, baseReq, candMeta = null) => {
    if (!hasAxes0) {
      return {
        marginalExtPt: 0,
        candL: xl0,
        candR: xr0,
        candB: yb0,
        candT: yt0,
        extDirections: [],
      };
    }
    let candR = Math.max(baseReq.reqR, bb.x1 + mRightJ);
    let candT = Math.max(baseReq.reqT, bb.y1 + mTopJ);
    let candL = baseReq.reqL;
    let candB = baseReq.reqB;

    const gapL = bb.x0 - xl0;
    const nearX = bb.y0 <= 8.0 && bb.y1 >= -8.0;
    if (gapL < 0) {
      candL = Math.min(candL, bb.x0 - mNegTargetJ);
    } else if (nearX && gapL < negNearTriggerJ) {
      candL = Math.min(candL, bb.x0 - mNegNearNodeJ);
    }

    const gapB = bb.y0 - yb0;
    if (gapB < 0) candB = Math.min(candB, bb.y0 - mNegTargetJ);
    else if (gapB < negNearTriggerJ) candB = Math.min(candB, bb.y0 - mNegNearNodeJ);

    const extL = Math.max(0, baseReq.reqL - candL);
    const extR = Math.max(0, candR - baseReq.reqR);
    const extB = Math.max(0, baseReq.reqB - candB);
    const extT = Math.max(0, candT - baseReq.reqT);
    const extDirections = [];
    if (extL > 0.5) extDirections.push(`-x(${r2(extL)}pt)`);
    if (extR > 0.5) extDirections.push(`+x(${r2(extR)}pt)`);
    if (extB > 0.5) extDirections.push(`-y(${r2(extB)}pt)`);
    if (extT > 0.5) extDirections.push(`+y(${r2(extT)}pt)`);

    return {
      marginalExtPt: r2(extL + extR + extB + extT),
      extL: r2(extL),
      extR: r2(extR),
      extB: r2(extB),
      extT: r2(extT),
      candL,
      candR,
      candB,
      candT,
      extDirections,
    };
  };

  var applyAxisRequested = F.applyAxisRequested !== false;
  for (let tIdx = 0; tIdx < targets.length; tIdx++) {
    const n = targets[tIdx];
    if (!n.usable) {
      plan.skipped.push({
        id: n.id,
        label: n.label,
        category: n.fallbackAnchorFromBBox ? "fallback-anchor-unusable" : "unusable-node",
        reason: n.fallbackAnchorFromBBox
          ? "기호 좌표(at) 미해석으로 대체 중심점(fallbackAnchor)이 주입되어 불확실성 잠금(usable=false) 유지"
          : `노드 매칭이 confirmed 가 아님(${n.confidence})`,
      });
      placedBoxes.push(n.bbox);
      continue;
    }
    if (!n.scale) {
      plan.skipped.push({ id: n.id, label: n.label, category: "unknown-scale", reason: "노드 배율 불명" });
      placedBoxes.push(n.bbox);
      continue;
    }
    const a = assigned.get(n.id);
    if (!a || !a.stroke) {
      plan.skipped.push({ id: n.id, label: n.label, category: "unmatched-stroke", reason: (a && a.reason) || "대응 곡선/선을 찾지 못함" });
      placedBoxes.push(n.bbox);
      continue;
    }

    const s = a.stroke;
    const strokeKind = a.strokeKind || classifyStrokeKind(s);
    const w = n.bbox.x1 - n.bbox.x0, h = n.bbox.y1 - n.bbox.y0;
    const others = strokesEff.filter((q) => q.index !== s.index);
    const futureAxisParallelBoxes = [];
    for (let remIdx = tIdx + 1; remIdx < targets.length; remIdx++) {
      const rem = targets[remIdx];
      if (!rem || !rem.bbox) continue;
      const remAsgn = assigned.get(rem.id);
      if (remAsgn && remAsgn.stroke) {
        const remKind = remAsgn.strokeKind || classifyStrokeKind(remAsgn.stroke);
        if (remKind === "verticalLine" || remKind === "horizontalLine") {
          futureAxisParallelBoxes.push(rem.bbox);
        }
      }
    }
    const obsBoxes = [...fixed.map((q) => q.bbox), ...placedBoxes, ...futureAxisParallelBoxes];
    const ends = [endInfo(s, 0), endInfo(s, 1)];
    const anchor0 = n.at || n.inlineAnchor || n.anchor || [(n.bbox.x0 + n.bbox.x1) / 2, (n.bbox.y0 + n.bbox.y1) / 2];
    const preferredEnd = selectPreferredEnd(strokeKind, ends, anchor0);

    const evalBox = (bb, axisImpactForCand = null) => {
      let minOther = Infinity;
      for (const q of others) {
        const c = clearanceToStroke(bb, q);
        if (c < minOther) minOther = c;
      }
      const own = clearanceToStroke(bb, s);
      let labelGap = Infinity;
      for (const fn of fixed) {
        let ob = fn.bbox;
        if (
          applyAxisRequested &&
          hasAxes0 &&
          axisImpactForCand &&
          fn.role === "axisLabel" &&
          fn.kind === "inline"
        ) {
          const cx = (ob.x0 + ob.x1) / 2;
          const cy = (ob.y0 + ob.y1) / 2;
          let obExt = ob;
          if (Math.abs(ob.x0 - xr0) < 35 && Math.abs(cy) < 25) {
            const dx = Math.max(0, axisImpactForCand.candR - xr0);
            obExt = { x0: ob.x0 + dx, x1: ob.x1 + dx, y0: ob.y0, y1: ob.y1 };
          } else if (Math.abs(ob.y0 - yt0) < 35 && Math.abs(cx) < 25) {
            const dy = Math.max(0, axisImpactForCand.candT - yt0);
            obExt = { x0: ob.x0, x1: ob.x1, y0: ob.y0 + dy, y1: ob.y1 + dy };
          }
          if (strokeKind === "generalLine" && F.enableRightAxisTipLineBelow !== false) {
            ob = obExt;
          } else {
            labelGap = Math.min(labelGap, bboxGapRect(bb, obExt));
          }
        }
        labelGap = Math.min(labelGap, bboxGapRect(bb, ob));
      }
      for (const pb of placedBoxes) labelGap = Math.min(labelGap, bboxGapRect(bb, pb));
      for (const fb of futureAxisParallelBoxes) labelGap = Math.min(labelGap, bboxGapRect(bb, fb));
      return { minOther, own, labelGap };
    };

    // [Unit 3-C] 축 평행 직선 방정식 라벨(수평선 y=상수, 수직선 x=상수) 전용 교재 조판 규칙 적용
    if (F.u3c && a.confirmed) {
      const prep3C = preprocessLabelForMatchingUnit2(n.label, scene, F);
      const numAn3C = analyzeNumericLabelExpressionUnit2(prep3C.effectiveLabel, F);
      const baseReq3C = computeBaseAxisReqPt();
      const evalBox3C = (bb) => {
        if (F.applyAxisRequested === false || !hasAxes0) return evalBox(bb);
        const axImpact = evaluateJointAxisImpact(bb, baseReq3C);
        if (axImpact.marginalExtPt <= 0.1) return evalBox(bb);
        const dR = Math.max(0, axImpact.candR - xr0);
        const dT = Math.max(0, axImpact.candT - yt0);
        let minOther = Infinity;
        for (const q of others) {
          if (q.kind === "axis" && F.enableAxisVarTheta !== false) {
            const isHorizAxis = Math.abs(q.pts[0][1] - q.pts[q.pts.length - 1][1]) < 1e-6;
            const extAxisStroke = {
              pts: isHorizAxis
                ? [[axImpact.candL, q.pts[0][1]], [axImpact.candR, q.pts[0][1]]]
                : [[q.pts[0][0], axImpact.candB], [q.pts[0][0], axImpact.candT]],
              halfWidth: q.halfWidth || 0.5,
            };
            const c = clearanceToStroke(bb, extAxisStroke);
            if (c < minOther) minOther = c;
            continue;
          }
          const c = clearanceToStroke(bb, q);
          if (c < minOther) minOther = c;
        }
        const own = clearanceToStroke(bb, s);
        let labelGap = Infinity;
        for (const fn of fixed) {
          let ob = fn.bbox;
          if (fn.role === "axisLabel") {
            const rawLbl = String(fn.label || "").replace(/\$/g, "").trim();
            if ((rawLbl === "x" || rawLbl === "\\theta" || rawLbl === "t") && dR > 0.5) {
              ob = { x0: ob.x0 + dR, y0: ob.y0, x1: ob.x1 + dR, y1: ob.y1 };
            } else if (rawLbl === "y" && dT > 0.5) {
              ob = { x0: ob.x0, y0: ob.y0 + dT, x1: ob.x1, y1: ob.y1 + dT };
            }
          }
          labelGap = Math.min(labelGap, bboxGapRect(bb, ob));
        }
        for (const pb of placedBoxes) labelGap = Math.min(labelGap, bboxGapRect(bb, pb));
        return { minOther, own, labelGap };
      };
      const structTpl3C = parseLabelStructureTemplateUnit2(prep3C.effectiveLabel, F);
      const axisParallelInfo = classifyAxisParallelLineLabelUnit3C(n, scene, a, numAn3C, structTpl3C);
      if (axisParallelInfo) {
        const axisParallelDecision =
          axisParallelInfo.axisParallelKind === "horizontalLine"
            ? planHorizontalLineLabelUnit3C({
                node: n,
                stroke: s,
                assignment: a,
                evalBox: evalBox3C,
                scene,
                P,
              })
            : planVerticalLineLabelUnit3C({
                node: n,
                stroke: s,
                assignment: a,
                evalBox: evalBox3C,
                scene,
                P,
              });

        if (axisParallelDecision) {
          plan.placements.push({
            id: n.id,
            label: n.label,
            action: axisParallelDecision.action,
            reason: axisParallelDecision.reason,
            stroke: s.index,
            strokeKind,
            axisParallelKind: axisParallelInfo.axisParallelKind,
            how: a.how,
            confirmedAssignment: !!a.confirmed,
            uncertainAssignment: !!a.uncertain,
            assignmentReason: a.reason || null,
            end: axisParallelDecision.end,
            preferredEnd: axisParallelDecision.preferredEnd,
            side: axisParallelDecision.side,
            alpha: axisParallelDecision.alpha,
            gapOffset: axisParallelDecision.gapOffset || 0,
            cost: axisParallelDecision.cost || 0,
            bbox: axisParallelDecision.bbox,
            from: n.bbox,
            eval: axisParallelDecision.eval,
            keepCheck: axisParallelDecision.keepCheck,
            candidates: axisParallelDecision.candidates || 1,
            feasible: axisParallelDecision.feasible || 1,
          });
          placedBoxes.push(axisParallelDecision.bbox);
          addC(axisParallelDecision.bbox);
          continue;
        }
      }
    }

    const baseAxisReq = computeBaseAxisReqPt();
    const keepAxisImpact = evaluateJointAxisImpact(n.bbox, baseAxisReq);
    const e0 = evalBox(n.bbox);
    let keepCheck = evaluateKeep(n.bbox, strokeKind, ends, preferredEnd, e0, P);
    if (
      !keepCheck.keep &&
      n.kind === "inline" &&
      keepCheck.checks?.clearanceOk &&
      keepCheck.checks?.endOk &&
      keepCheck.checks?.directionOk &&
      keepCheck.checks?.alignmentOk &&
      keepCheck.endGapPt <= (P.maxAllowedEndGap || 7.5)
    ) {
      keepCheck = { ...keepCheck, keep: true, rejectReasons: [] };
    }
    if (!keepCheck.keep && F.u2e) {
      const crestKeep = checkTrigCrestKeep(n, s, e0, P);
      if (crestKeep) keepCheck = crestKeep;
    }

    // [공동 최적화 규칙]:
    // 1) 미확정 라벨이거나, 원 위치가 이미 평가원 기준에 부합하면서 불필요한 과잉 축 연장(<= 8pt)도 유발하지 않으면 즉시 원 위치 유지!
    const keepForcesExcessiveAxisExt =
      hasAxes0 && a.confirmed && keepAxisImpact.marginalExtPt > (P.jointKeepMaxAxisExtPt ?? 8.0);

    if (keepCheck.keep && (!a.confirmed && !P.allowUncertainMove)) {
      plan.placements.push({
        id: n.id,
        label: n.label,
        action: "keep",
        reason: `원 위치가 평가원 스타일에 부합(끝점/곡선 간격 ${keepCheck.endGapPt}pt, 방향 ${keepCheck.currentSide}, |α|=${Math.abs(keepCheck.alpha)}, 무충돌)`,
        stroke: s.index,
        strokeKind,
        how: a.how,
        confirmedAssignment: !!a.confirmed,
        uncertainAssignment: !!a.uncertain,
        assignmentReason: a.reason || null,
        end: keepCheck.currentEnd,
        preferredEnd,
        side: keepCheck.currentSide,
        alpha: keepCheck.alpha,
        bbox: n.bbox,
        from: n.bbox,
        eval: e0,
        keepCheck,
        jointAxisImpact: keepAxisImpact,
      });
      placedBoxes.push(n.bbox);
      addC(n.bbox);
      continue;
    }

    if (keepCheck.keep && a.confirmed && !keepForcesExcessiveAxisExt) {
      plan.placements.push({
        id: n.id,
        label: n.label,
        action: "keep",
        reason: `원 위치가 평가원 스타일에 부합(끝점/곡선 간격 ${keepCheck.endGapPt}pt, 방향 ${keepCheck.currentSide}, |α|=${Math.abs(keepCheck.alpha)}, 무충돌, 추가 축 연장 불필요)`,
        stroke: s.index,
        strokeKind,
        how: a.how,
        confirmedAssignment: !!a.confirmed,
        uncertainAssignment: !!a.uncertain,
        assignmentReason: a.reason || null,
        end: keepCheck.currentEnd,
        preferredEnd,
        side: keepCheck.currentSide,
        alpha: keepCheck.alpha,
        bbox: n.bbox,
        from: n.bbox,
        eval: e0,
        keepCheck,
        jointAxisImpact: keepAxisImpact,
      });
      placedBoxes.push(n.bbox);
      addC(n.bbox);
      continue;
    }

    const gapOffsets = P.gapOffsets || [0];
    const cands = [];
    for (const ei of [0, 1]) {
      const { point: E, t } = ends[ei];
      const prefAbove = t[1] >= 0;
      for (const side of ["above", "below"]) {
        const isRightXAxisTipDecreasing =
          F.enableRightAxisTipLineBelow !== false &&
          strokeKind === "generalLine" &&
          hasAxes0 &&
          Math.abs(E[1]) <= 12.0 &&
          E[0] >= xr0 - 30.0 &&
          t[1] < -0.15;
        const effGapOffsets =
          isRightXAxisTipDecreasing && side === "below"
            ? [...gapOffsets, 8, 12.5, 17, 22]
            : gapOffsets;
        for (const gOff of effGapOffsets) {
          for (let al = -1; al <= 1.0001; al += P.alphaStep) {
            const cx = E[0] + al * (w / 2);
            const gap = (side === "above" ? P.gapAbove : P.gapBelow) + gOff;
            const rawBb =
              side === "above"
                ? { x0: cx - w / 2, x1: cx + w / 2, y0: E[1] + gap, y1: E[1] + gap + h }
                : { x0: cx - w / 2, x1: cx + w / 2, y1: E[1] - gap, y0: E[1] - gap - h };
            const sh = computeShiftForMove(n, rawBb, P);
            const bb = sh.actualBbox;
            cands.push({ bb, ei, side, alpha: al, gapOffset: gOff, sideMismatch: (side === "above") !== prefAbove, shift: sh.newShift, isRightXAxisTipDecreasing });
          }
        }
      }
      if (strokeKind !== "verticalLine" && Math.abs(t[1]) < P.horizTangentMax) {
        for (const side of ["right", "left"]) {
          for (let be = -1; be <= 1.0001; be += 0.25) {
            const cy = E[1] + be * (h / 2);
            const rawBb =
              side === "right"
                ? { x0: E[0] + P.gapSide, x1: E[0] + P.gapSide + w, y0: cy - h / 2, y1: cy + h / 2 }
                : { x1: E[0] - P.gapSide, x0: E[0] - P.gapSide - w, y0: cy - h / 2, y1: cy + h / 2 };
            const sh = computeShiftForMove(n, rawBb, P);
            const bb = sh.actualBbox;
            const isRightXAxisTipDecreasing =
              F.enableRightAxisTipLineBelow !== false &&
              strokeKind === "generalLine" &&
              hasAxes0 &&
              Math.abs(E[1]) <= 12.0 &&
              E[0] >= xr0 - 30.0 &&
              t[1] < -0.15;
            cands.push({ bb, ei, side, alpha: be, gapOffset: 0, sideMismatch: (side === "right") !== (t[0] >= 0), shift: sh.newShift, isRightXAxisTipDecreasing });
          }
        }
      }
    }

    let best = null;
    let bestNoAxisPen = null;
    const scored = [];
    const baseC = content || { ...n.bbox };
    const wAxisExt = P.wAxisExt ?? 2.5;
    for (const c of cands) {
      const axisImpact = evaluateJointAxisImpact(c.bb, baseAxisReq, { action: "move", side: c.side, origBbox: n.bbox });
      const ev0 = evalBox(c.bb, axisImpact);
      let minOther = ev0.minOther;
      if (hasAxes0) {
        const extXStroke = {
          pts: [
            [axisImpact.candL, 0],
            [axisImpact.candR, 0],
          ],
          halfWidth: scene.axes?.x?.stroke?.halfWidth || 0.5,
        };
        const extYStroke = {
          pts: [
            [0, axisImpact.candB],
            [0, axisImpact.candT],
          ],
          halfWidth: scene.axes?.y?.stroke?.halfWidth || 0.5,
        };
        minOther = Math.min(
          minOther,
          clearanceToStroke(c.bb, extXStroke),
          clearanceToStroke(c.bb, extYStroke)
        );
      }
      const ev = { ...ev0, minOther };
      const hard = ev.minOther < P.cHard || ev.own < P.cOwn || ev.labelGap < P.mLabel;
      const grow =
        Math.max(baseC.x1, c.bb.x1) -
        Math.min(baseC.x0, c.bb.x0) -
        (baseC.x1 - baseC.x0) +
        (Math.max(baseC.y1, c.bb.y1) - Math.min(baseC.y0, c.bb.y0) - (baseC.y1 - baseC.y0));
      const clearPen = Math.max(0, P.cPref - Math.min(ev.minOther, ev.labelGap)) / P.cPref;
      const ownPen = ev.own < (P.cOwnPref || 1.6) ? ((P.cOwnPref || 1.6) - ev.own) / (P.cOwnPref || 1.6) : 0;
      const sameBandWithXAxisLabel =
        c.isRightXAxisTipDecreasing &&
        (c.side === "right" || c.bb.y1 > -9.5);
      const sameBandAxisLabelPen = sameBandWithXAxisLabel ? 12.0 : 0;
      const gapPen =
        (c.isRightXAxisTipDecreasing && c.side === "below"
          ? (c.gapOffset || 0) * 0.08
          : (c.gapOffset || 0) * 0.35) + sameBandAxisLabelPen;
      const baseCost =
        P.wClear * clearPen * clearPen +
        (P.wOwnPref || 3.5) * ownPen * ownPen +
        (c.sideMismatch ? P.wSide : 0) +
        (c.ei !== preferredEnd ? P.wEnd : 0) +
        P.wAlpha * Math.abs(c.alpha) +
        P.wGrow * (grow / 100) +
        gapPen;
      const axisPen = hasAxes0 ? wAxisExt * (axisImpact.marginalExtPt / 100) : 0;
      const cost = baseCost + axisPen;
      scored.push({ ...c, ev, hard, baseCost, axisPen, cost, axisImpact });
      if (!hard && (!best || cost < best.cost)) best = { ...c, ev, baseCost, axisPen, cost, axisImpact };
      if (!hard && (!bestNoAxisPen || baseCost < bestNoAxisPen.baseCost)) {
        bestNoAxisPen = { ...c, ev, baseCost, axisPen, cost, axisImpact };
      }
    }

    // 만약 원 위치가 keepCheck.keep 을 통과했으나 과잉 축 연장(keepForcesExcessiveAxisExt) 때문에 후보를 탐색한 경우:
    // 탐색된 최선 후보(best)가 접선 방향이 자연스럽고(!sideMismatch) 무충돌이며,
    // 원 위치보다 필요 축 연장량을 의미 있게 줄여줄 때(최소 15pt 이상 절감)만 이동하고, 그렇지 않으면 원 위치를 유지(5순위: 개선이 뚜렷하지 않으면 원 위치 유지)!
    if (keepCheck.keep && a.confirmed && keepForcesExcessiveAxisExt) {
      const savedAxisPt = best ? r2(keepAxisImpact.marginalExtPt - best.axisImpact.marginalExtPt) : 0;
      const naturalAlternative =
        best &&
        !best.sideMismatch &&
        best.baseCost <= (P.jointMaxNaturalBaseCost ?? 10.5) &&
        savedAxisPt >= (P.jointMinSavedAxisExtPt ?? 15.0);
      if (!naturalAlternative) {
        plan.placements.push({
          id: n.id,
          label: n.label,
          action: "keep",
          reason: `원 위치가 평가원 스타일에 부합하며 축 연장 절감 효과가 있는 더 나은 자연 후보가 없어 원 위치 유지(끝점/곡선 간격 ${keepCheck.endGapPt}pt, 방향 ${keepCheck.currentSide})`,
          stroke: s.index,
          strokeKind,
          how: a.how,
          confirmedAssignment: !!a.confirmed,
          uncertainAssignment: !!a.uncertain,
          assignmentReason: a.reason || null,
          end: keepCheck.currentEnd,
          preferredEnd,
          side: keepCheck.currentSide,
          alpha: keepCheck.alpha,
          bbox: n.bbox,
          from: n.bbox,
          eval: e0,
          keepCheck,
          jointAxisImpact: keepAxisImpact,
        });
        placedBoxes.push(n.bbox);
        addC(n.bbox);
        continue;
      }
      keepCheck = {
        ...keepCheck,
        keep: false,
        rejectReasons: [
          ...keepCheck.rejectReasons,
          `원 위치 유지 시 과도한 축 연장 필요(${keepAxisImpact.extDirections.join(", ")}) → 곡선 인접 자연 위치로 축 연장 ${savedAxisPt}pt 절감`,
        ],
      };
    }

    if (!best) {
      plan.skipped.push({
        id: n.id,
        label: n.label,
        category: "no-safe-candidate",
        strokeKind,
        reason: `허용 간격을 만족하는 안전한 후보 없음 (cHard=${P.cHard}) — 원본 유지(수동 확인)`,
      });
      plan.placements.push({
        id: n.id,
        label: n.label,
        action: "keep",
        reason: "안전 후보 없음 — 원본 유지(수동 확인)",
        stroke: s.index,
        strokeKind,
        how: a.how,
        confirmedAssignment: !!a.confirmed,
        uncertainAssignment: !!a.uncertain,
        assignmentReason: a.reason || null,
        bbox: n.bbox,
        from: n.bbox,
        eval: e0,
        keepCheck,
      });
      placedBoxes.push(n.bbox);
      addC(n.bbox);
      continue;
    }

    if (a.uncertain && !P.allowUncertainMove) {
      const advShift = computeShiftForMove(n, best.bb, P);
      const advisoryObj = {
        id: n.id,
        label: n.label,
        how: a.how,
        stroke: s.index,
        strokeKind,
        end: best.ei,
        preferredEnd,
        side: best.side,
        alpha: Math.round(best.alpha * 1000) / 1000,
        cost: Math.round(best.cost * 100) / 100,
        bbox: best.bb,
        from: n.bbox,
        shift: advShift.newShift,
        neededMovePt: advShift.neededMovePt,
        eval: best.ev,
      };
      plan.advisory.push(advisoryObj);
      plan.skipped.push({
        id: n.id,
        label: n.label,
        category: a.how === "ambiguous-structural" ? "ambiguous-structural-assignment" : "uncertain-stroke-assignment",
        how: a.how,
        stroke: s.index,
        strokeKind,
        reason: a.reason || `대응 곡선 불확실(${a.how}) — 자동 이동 차단`,
        advisory: advisoryObj,
      });
      plan.placements.push({
        id: n.id,
        label: n.label,
        action: "hold-uncertain",
        reason: a.reason || `대응 곡선 미확정(${a.how})으로 자동 이동 차단`,
        stroke: s.index,
        strokeKind,
        how: a.how,
        confirmedAssignment: false,
        uncertainAssignment: true,
        assignmentReason: a.reason || null,
        end: keepCheck.currentEnd,
        preferredEnd,
        side: keepCheck.currentSide,
        alpha: keepCheck.alpha,
        bbox: n.bbox,
        from: n.bbox,
        eval: e0,
        keepCheck,
        advisory: advisoryObj,
      });
      placedBoxes.push(n.bbox);
      addC(n.bbox);
      continue;
    }

    const savedExtPt = r2(keepAxisImpact.marginalExtPt - (best.axisImpact?.marginalExtPt ?? 0));
    const savedVsAltCandPt =
      bestNoAxisPen && (bestNoAxisPen.side !== best.side || bestNoAxisPen.ei !== best.ei)
        ? r2((bestNoAxisPen.axisImpact?.marginalExtPt ?? 0) - (best.axisImpact?.marginalExtPt ?? 0))
        : 0;
    const axisSaveNote =
      hasAxes0 && savedExtPt >= 10.0
        ? ` (필요 축 연장량 ${r2(keepAxisImpact.marginalExtPt)}pt → ${r2(best.axisImpact.marginalExtPt)}pt로 ${savedExtPt}pt 절감)`
        : hasAxes0 && savedVsAltCandPt >= 10.0
        ? ` (${bestNoAxisPen.side} 후보 대비 필요 축 연장량 ${r2(bestNoAxisPen.axisImpact.marginalExtPt)}pt → ${r2(best.axisImpact.marginalExtPt)}pt로 ${savedVsAltCandPt}pt 절감)`
        : "";

    plan.placements.push({
      id: n.id,
      label: n.label,
      action: "move",
      reason:
        (keepCheck.rejectReasons.length
          ? `원 위치 미유지(${keepCheck.rejectReasons.join(", ")}) → 끝${best.ei}/${best.side} 이동`
          : `끝${best.ei}/${best.side} 이동`) + axisSaveNote,
      stroke: s.index,
      strokeKind,
      how: a.how,
      confirmedAssignment: !!a.confirmed,
      uncertainAssignment: !!a.uncertain,
      assignmentReason: a.reason || null,
      end: best.ei,
      preferredEnd,
      side: best.side,
      alpha: Math.round(best.alpha * 1000) / 1000,
      gapOffset: best.gapOffset || 0,
      cost: Math.round(best.cost * 100) / 100,
      bbox: best.bb,
      from: n.bbox,
      eval: best.ev,
      keepCheck,
      jointAxisImpact: best.axisImpact || null,
      keepAxisImpact,
      savedAxisExtPt: savedExtPt,
      candidates: scored.length,
      feasible: scored.filter((q) => !q.hard).length,
    });
    placedBoxes.push(best.bb);
    addC(best.bb);
  }

  plan.multiAbstractAnalysis = scene.multiAbstractAnalysis || null;
  plan.assignments = Object.fromEntries(
    [...assigned.entries()].map(([k, v]) => [
      k,
      {
        how: v.how,
        stroke: v.stroke ? v.stroke.index : null,
        strokeKind: v.strokeKind || "unknown",
        confirmed: !!v.confirmed,
        uncertain: !!v.uncertain,
        isMultiAbstractPair: !!v.isMultiAbstractPair,
        multiAbstractAction: v.multiAbstractAction || null,
        step2ClassificationType: v.step2ClassificationType || null,
        step2ClassificationCode: v.step2ClassificationCode || null,
        step2MathematicallyProven: !!v.step2MathematicallyProven,
        step2RequiresUserApproval: !!v.step2RequiresUserApproval,
        step2Tier: v.step2Tier || null,
        step2TierCode: v.step2TierCode || null,
        step2Signals: v.step2Signals || [],
        step2RawDistMarginPt: v.step2RawDistMarginPt ?? null,
        step2RecommendedStroke: v.step2RecommendedStroke ?? null,
        step2SwappedStroke: v.step2SwappedStroke ?? null,
        curveShape: v.curveShape || null,
        normalizedExpr: v.normalizedExpr || null,
        plotExpr: v.plotExpr || null,
        parseError: v.parseError || null,
        nonMoveCategory: v.nonMoveCategory || null,
        nonMoveCode: v.nonMoveCode || null,
        template: v.template || null,
        templateDesc: v.templateDesc || null,
        candidateCount: v.candidateCount || (v.stroke ? 1 : 0),
        candidateStrokes: v.candidateStrokes || (v.stroke ? [v.stroke.index] : []),
        reason: v.reason || null,
      },
    ])
  );
  return plan;
}
