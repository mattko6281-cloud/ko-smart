// ============================================================================
// Unit 3-G (D-3): 직선 이름(l, m, n, \ell) 자동 정렬 및 가시 끝점 자연 배치 엔진 모듈
// ============================================================================
// 핵심 설계 원칙:
//  1) 기본값(enableUnit3G = false / enableLineNameOverlapFix = false)일 때는
//     기존 Production(fcaed53)과 100% 동일한 출력을 보장한다.
//  2) 기존 전담 유닛(함수식 Unit 2 / Type 2, 숫자·π 눈금 Unit 3-B, 원점 O Unit 3-D,
//     대문자 점 이름 Unit 3-E, 축 문자 눈금 Unit 3-F / D-2)과 역할이 절대 충돌하지 않는다.
//  3) 직선 이름 후보를 4대 세부 유형(Type A, B, C, D)으로 정밀 분류한다:
//     - [Type A] 직선에 인라인 연결된 직선 이름 (예: \draw ... node[right] {$l$};)
//     - [Type B] 단일 직선에 대응되는 독립 \node 직선 이름 (예: $l$ 단독)
//     - [Type C] 다중 직선에 대응되는 독립 \node 직선 이름 (예: CASE-009, O03, CASE-018 $l, m$)
//     - [Type D] 직선 이름이 아닌 소문자 기호(축 눈금 a,b,c, 수식 내부 매개변수/기울기 m, 상수 n 등) -> 100% 제외/보호
//  4) \begin{scope} \clip (...) rectangle (...); \end{scope} 가시 클리핑 영역을 반영하여
//     직선이 실제로 잘려 보이는 끝점(visibleEndPt)을 정밀 계산하고,
//     직선 이름 노드가 \clip 스코프 내부에 선언된 경우에는 클립 경계 밖으로 나가 잘리는 위치를 원천 차단한다.
//  5) 매칭 안전 단계를 D3-1(단일/인라인 자동 추천), D3-2(다중 직선 l, m — 기본값 Hold,
//     사용자 선택 시 Recommend / Swap 제공), D3-3(3개 이상 다중 직선 / 주석·기하 모순 / 마진 부족 — 강제 Hold)으로
//     분리하며, Type 2 추상 함수 매칭 상태(multiAbstractAction)와 완전히 독립된 lineNameAction 상태를 유지한다.
// ============================================================================

import {
  PARAMS,
  classifyStrokeKind,
  bboxGapRect,
  bboxPtDist,
  bboxFromShift,
  computeShiftForMove,
  setShifts,
} from "../../../../experiments/smart-label-prototype-v021/src/algorithm.mjs";
import { minDistPolylines } from "../../../../experiments/smart-label-engine/src/geometry.mjs";
import { maskComments } from "../../../../experiments/smart-label-engine/src/tikz-nodes.mjs";
import {
  DEFAULT_UNIT2_FLAGS,
  analyzePlotMathStructureUnit2,
  clipPolylineToRect,
} from "./unit2-expression-matching.mjs";
import { resolveSceneSymbolicCoordinatesUnit3A } from "./unit3a-overlap-diagnostics.mjs";
import { isPureTickValueLabel } from "./unit3b-ticks.mjs";
import {
  parseGeneralLabelSymbolUnit3E,
  getResolvedNodeAnchorPtUnit3E,
  extractNodeDirectionOptionUnit3E,
} from "./unit3e-point-labels.mjs";

const r2 = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

const rectPoly = (b) => ({
  pts: [
    [b.x0, b.y0],
    [b.x1, b.y0],
    [b.x1, b.y1],
    [b.x0, b.y1],
  ],
  closed: true,
});

export const DEFAULT_D3_LINE_NAME_PARAMS = {
  // 축 귀속 판정 (D-2 축 문자 눈금 분리용)
  maxAxisTickSnapDistPt: 3.5,
  minOriginSeparationPt: 4.0,

  // 직선 후보 추출 임계값 (TeX pt)
  minStraightLineLengthPt: 25.0,       // 직각 기호나 짧은 장식 선분을 제외하기 위한 최소 직선 길이
  maxLinearDeviationPt: 0.35,          // 직선으로 인정하는 최대 직선 편차

  // 매칭 거리 및 마진 기준 (TeX pt)
  maxLineMatchDistancePt: 36.0,        // 독립 직선 이름과 대상 직선 간 최대 허용 거리 (초과 시 Type D / Hold)
  minGlobalPairMarginPt: 10.0,         // 다중 직선(l, m) 전역 1:1 매칭 최소 거리 합 우위 마진

  // 원본 유지(Already-Natural Hold) 판정 기준
  keepNearVisibleTipMaxDistPt: 11.5,   // 원본 라벨이 이미 가시 끝점으로부터 이 거리 이내이고
  keepMaxBehindVisibleTipPt: 3.5,      // 끝점 진행 방향 뒤쪽(직선 몸통 쪽)으로 밀려 있지 않으며
  keepMinOwnLineClearancePt: 1.5,      // 자기 직선과 최소 1.5pt 이상 떨어져 있으며
  keepMinOtherStrokeClearancePt: 4.0,  // 타 곡선/직선/보조선과 최소 4.0pt 이상 떨어져 있고
  keepMinAxisClearancePt: 3.5,         // 좌표축과도 최소 3.5pt 이상 떨어져 있으면 이미 자연스러운 위치로 Hold

  // Candidate B (최소 이동 충돌 해소) 탐색 범위 및 안전 기준
  candBMaxShiftPt: 18.0,
  candBShiftStepPt: 1.0,
  candBMinOwnClearancePt: 1.2,
  candBMinOtherStrokeClearancePt: 2.2,
  candBMinAxisClearancePt: 2.2,
  candBMinNodeGapPt: 2.5,
  candBMaxLineAttachDistPt: 8.5,

  // Candidate C (평가원 스타일 가시 끝점 자연 배치) 안전 및 선호 기준
  candCMinOwnClearancePt: 1.0,
  candCIdealOwnClearanceMinPt: 1.8,
  candCIdealOwnClearanceMaxPt: 5.8,
  candCMinOtherMainClearancePt: 3.2,
  candCPrefOtherMainClearancePt: 9.0,
  candCMinDashedClearancePt: 2.5,
  candCMinAxisClearancePt: 3.2,
  candCPrefAxisClearancePt: 7.5,
  candCMinNodeGapPt: 3.5,
  candCMaxTipGapPt: 11.0,
  candCIdealTipGapMinPt: 1.8,
  candCIdealTipGapMaxPt: 6.5,
  clipSafetyInsetPt: 1.5,              // 노드가 \clip 내부에 있을 때 클립 경계 안쪽 최소 안전 여유
};

export const DEFAULT_UNIT3G_LINE_NAME_PARAMS = DEFAULT_D3_LINE_NAME_PARAMS;

const STRICT_LINE_NAME_SYMBOL_RE = /^(?:l|m|n|\\ell)$/;

/**
 * lineNameAction 정규화 ("hold" | "recommend" | "swap", 기본값 "hold")
 */
export function normalizeLineNameActionD3(action) {
  const v = String(action || "hold").trim().toLowerCase();
  if (v === "recommend" || v === "swap" || v === "hold") return v;
  return "hold";
}

/**
 * 라벨 텍스트가 D-3 직선 이름 후보 기호($l$, $m$, $n$, $\ell$)인지 정밀 파싱한다.
 * - 수식($y=mx+n$, $m=2$), 대문자($A, B, P$), 순수 숫자/파이 눈금($1, 2\pi$) 등은 즉시 배제한다.
 */
export function parseLineNameSymbolD3(rawLabel) {
  const base = parseGeneralLabelSymbolUnit3E(rawLabel);
  const raw = String(rawLabel || "").trim();
  let inner = raw;
  if (inner.startsWith("$") && inner.endsWith("$")) {
    inner = inner.slice(1, -1).trim();
  }
  const stripped = inner
    .replace(/\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle)\b/g, "")
    .replace(/\\(?:rm|mathrm|mathit|mathbf|mathsf|mathcal)\b/g, "")
    .replace(/[{}]/g, "")
    .trim();

  const hasEquationOrOperator = /[=+*/^_<>()]/.test(stripped);
  const isStrictLineNameSymbol = !hasEquationOrOperator && STRICT_LINE_NAME_SYMBOL_RE.test(stripped);
  const canonicalSymbol = stripped === "\\ell" ? "l" : stripped;
  const isSingleLowercaseLatin = !hasEquationOrOperator && /^[a-z]$/.test(stripped);

  return {
    ...base,
    raw,
    stripped,
    canonicalSymbol,
    hasEquationOrOperator,
    isStrictLineNameSymbol,
    isSingleLowercaseLatin,
    isPureTick: isPureTickValueLabel(rawLabel),
  };
}

/**
 * TikZ 본문에서 \begin{scope} ... \clip (x0, y0) rectangle (x1, y1); ... \end{scope}
 * 스코프 클리핑 영역 목록을 추출한다.
 */
export function extractScopedClipRegionsD3(body, units) {
  if (!body || !units || !units.xU || !units.yU) return [];
  const { xU, yU } = units;
  const masked = maskComments(String(body));
  const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)`;
  const clipRe = new RegExp(
    String.raw`\\clip\s*\(\s*(${NUM})\s*,\s*(${NUM})\s*\)\s*rectangle\s*\(\s*(${NUM})\s*,\s*(${NUM})\s*\)\s*;`,
    "g"
  );

  const scopes = [];
  const scopeOpenRe = /\\begin\{scope\}/g;
  const scopeCloseRe = /\\end\{scope\}/g;
  const opens = [];
  const closes = [];
  let m;
  while ((m = scopeOpenRe.exec(masked)) !== null) opens.push(m.index);
  while ((m = scopeCloseRe.exec(masked)) !== null) closes.push(m.index + m[0].length);
  for (let i = 0; i < Math.min(opens.length, closes.length); i++) {
    scopes.push({ start: opens[i], end: closes[i] });
  }

  const regions = [];
  while ((m = clipRe.exec(masked)) !== null) {
    const cIdx = m.index;
    const mx0 = Number(m[1]);
    const my0 = Number(m[2]);
    const mx1 = Number(m[3]);
    const my1 = Number(m[4]);
    const mathRect = {
      x0: Math.min(mx0, mx1),
      y0: Math.min(my0, my1),
      x1: Math.max(mx0, mx1),
      y1: Math.max(my0, my1),
    };
    const ptRect = {
      x0: r2(mathRect.x0 * xU),
      y0: r2(mathRect.y0 * yU),
      x1: r2(mathRect.x1 * xU),
      y1: r2(mathRect.y1 * yU),
    };
    const enclosingScope = scopes.find((sc) => cIdx >= sc.start && cIdx <= sc.end);
    regions.push({
      clipIndex: cIdx,
      scopeStart: enclosingScope ? enclosingScope.start : 0,
      scopeEnd: enclosingScope ? enclosingScope.end : masked.length,
      isScoped: Boolean(enclosingScope),
      mathRect,
      ptRect,
    });
  }
  return regions;
}

/**
 * \draw / plot 문장 직전의 주석에서 직선 이름 힌트(예: "% 접선 l", "% 법선 m", "% 직선 l")를 추출한다.
 */
export function extractLineCommentHintD3(body, stmtStart) {
  if (!body || typeof stmtStart !== "number") return null;
  const tail = body.slice(stmtStart, Math.min(body.length, stmtStart + 300));
  const mDraw = /\\(?:draw|path)\b/.exec(tail);
  const actualStart = mDraw ? stmtStart + mDraw.index : stmtStart;
  const lookbackStart = Math.max(0, actualStart - 220);
  const prefix = body.slice(lookbackStart, actualStart);
  const lines = prefix.split(/\r?\n/).reverse();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("%")) {
      const mRole = /(?:접선|법선|직선|line|tangent|normal)\s*\\?(ell|[lmn])\b/i.exec(trimmed);
      if (mRole) {
        const sym = mRole[1].toLowerCase() === "ell" ? "l" : mRole[1].toLowerCase();
        return { symbol: sym, rawComment: trimmed, explicitRoleKeyword: true };
      }
      const mPrefix = /^%\s*\\?(ell|[lmn])\s*(?:[:(]|—|-)/.exec(trimmed);
      if (mPrefix) {
        const sym = mPrefix[1].toLowerCase() === "ell" ? "l" : mPrefix[1].toLowerCase();
        return { symbol: sym, rawComment: trimmed, explicitRoleKeyword: false };
      }
    } else {
      break;
    }
  }
  return null;
}

/**
 * 장면 내 모든 스트로크 중 D-3 직선 이름이 붙을 수 있는 "실제 직선(Straight Line) 후보"만 정밀 추출한다.
 */
export function extractCandidateStraightLinesD3(
  scene,
  rawTikz = "",
  params = DEFAULT_D3_LINE_NAME_PARAMS
) {
  const cfg = { ...DEFAULT_D3_LINE_NAME_PARAMS, ...(params || {}) };
  if (!scene || !Array.isArray(scene.strokes)) return [];

  const { xU = 28.45, yU = 28.45 } = scene.units || {};
  const body = rawTikz || scene.body || "";
  const clipRegions = extractScopedClipRegionsD3(body, scene.units);

  const lines = [];
  for (const s of scene.strokes) {
    if (!s || s.kind === "axis" || !Array.isArray(s.pts) || s.pts.length < 2) continue;

    const optsRaw = String(s.stmt?.optsRaw || "");
    const stmtRaw = String(s.stmt?.text || s.stmt?.raw || "");
    const isDashed = s.kind === "dashed" || /dashed|dotted/.test(optsRaw) || /dashed|dotted/.test(stmtRaw);
    if (isDashed) continue;

    // 3점 이상 polyline인데 방향이 꺾이는 다각형/직각 기호 배제
    if (s.stmt?.type === "polyline" && Array.isArray(s.stmt.pts) && s.stmt.pts.length >= 3) {
      continue;
    }

    const strokeKind = classifyStrokeKind(s);
    if (strokeKind !== "generalLine" && strokeKind !== "verticalLine") {
      continue;
    }

    // plot 문장인 경우 1차 직선(degree === 1) 또는 상수선(degree === 0)인지 확인
    let mathStruct = null;
    if (s.stmt?.type === "plot") {
      mathStruct = analyzePlotMathStructureUnit2(s.stmt, DEFAULT_UNIT2_FLAGS);
      if (mathStruct && mathStruct.degree !== null && mathStruct.degree >= 2) {
        continue;
      }
      if (mathStruct && mathStruct.kind === "non-polynomial") {
        continue;
      }
    }

    // 원본(unclipped) 폴리라인과 \clip 적용 후 가시(visible) 폴리라인 계산
    const unclippedPts = Array.isArray(s.unclippedPts) && s.unclippedPts.length >= 2 ? s.unclippedPts : s.pts;
    let visiblePts = s.pts;
    let activeClip = null;
    if (s.stmt) {
      const matchingClips = clipRegions.filter(
        (cr) => s.stmt.start >= cr.scopeStart && s.stmt.end <= cr.scopeEnd
      );
      if (matchingClips.length > 0) {
        activeClip = matchingClips[matchingClips.length - 1];
        const clipped = clipPolylineToRect(unclippedPts, activeClip.ptRect);
        if (Array.isArray(clipped) && clipped.length >= 2) {
          visiblePts = clipped;
        }
      }
    }

    const p0 = visiblePts[0];
    const p1 = visiblePts[visiblePts.length - 1];
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const lengthPt = Math.hypot(dx, dy);
    if (lengthPt < cfg.minStraightLineLengthPt) continue;

    const ux = dx / (lengthPt || 1);
    const uy = dy / (lengthPt || 1);
    const ends = [
      {
        endIndex: 0,
        pointPt: [r2(p0[0]), r2(p0[1])],
        pointMath: [r2(p0[0] / xU), r2(p0[1] / yU)],
        outwardTangent: [r2(-ux), r2(-uy)],
      },
      {
        endIndex: 1,
        pointPt: [r2(p1[0]), r2(p1[1])],
        pointMath: [r2(p1[0] / xU), r2(p1[1] / yU)],
        outwardTangent: [r2(ux), r2(uy)],
      },
    ];

    const rawP0 = unclippedPts[0];
    const rawP1 = unclippedPts[unclippedPts.length - 1];
    const wasClippedAtEnd0 = Math.hypot(rawP0[0] - p0[0], rawP0[1] - p0[1]) > 1.0;
    const wasClippedAtEnd1 = Math.hypot(rawP1[0] - p1[0], rawP1[1] - p1[1]) > 1.0;

    const commentHint = s.stmt ? extractLineCommentHintD3(body, s.stmt.start) : null;
    const slopeMath = Math.abs(dx) > 1e-6 ? r2((dy / yU) / (dx / xU)) : Infinity;

    lines.push({
      strokeIndex: s.index,
      stroke: s,
      strokeKind,
      sourceType: s.stmt?.type || "draw",
      plotExpr: s.stmt?.expr || null,
      domain: s.stmt?.domain || null,
      lengthPt: r2(lengthPt),
      slopeMath,
      visiblePts,
      unclippedPts,
      ends,
      wasClipped: Boolean(wasClippedAtEnd0 || wasClippedAtEnd1),
      wasClippedAtEnd0,
      wasClippedAtEnd1,
      activeClipRectPt: activeClip ? activeClip.ptRect : null,
      activeClipRectMath: activeClip ? activeClip.mathRect : null,
      commentHint,
    });
  }

  return lines;
}

/**
 * 장면 내 모든 노드를 스캔하여 D-3 직선 이름 4대 세부 유형(Type A, B, C, D)으로 분류한다.
 */
export function classifyLineNameNodesD3(
  scene,
  candidateLines = [],
  rawTikz = "",
  params = DEFAULT_D3_LINE_NAME_PARAMS
) {
  const cfg = { ...DEFAULT_D3_LINE_NAME_PARAMS, ...(params || {}) };
  if (!scene || !Array.isArray(scene.nodes)) {
    return { items: [], byNodeId: new Map(), summaryCounts: {}, activeLineNameNodes: [] };
  }

  resolveSceneSymbolicCoordinatesUnit3A(scene, DEFAULT_UNIT2_FLAGS);

  const body = rawTikz || scene.body || "";
  const clipRegions = extractScopedClipRegionsD3(body, scene.units);
  const candidateLineStrokeSet = new Set(candidateLines.map((l) => l.strokeIndex));

  const markers = scene.nodes
    .filter((n) => n.role === "marker")
    .map((m) => {
      const { pt } = getResolvedNodeAnchorPtUnit3E(m);
      const center =
        pt || (m.bbox ? [(m.bbox.x0 + m.bbox.x1) / 2, (m.bbox.y0 + m.bbox.y1) / 2] : null);
      return { marker: m, center };
    })
    .filter((m) => Array.isArray(m.center));

  const preliminaryLineNodes = [];
  const items = [];
  const byNodeId = new Map();
  const summaryCounts = {
    TYPE_A_INLINE_LINE_NAME: 0,
    TYPE_B_SINGLE_STANDALONE_LINE_NAME: 0,
    TYPE_C_MULTI_STANDALONE_LINE_NAME: 0,
    TYPE_D_EXCLUDED_NON_LINE_OR_PROTECTED: 0,
  };

  for (const n of scene.nodes) {
    if (n.role === "marker" || n.role === "function" || n.role === "origin" || n.role === "axisLabel") {
      const entry = {
        id: n.id,
        label: n.label || "",
        role: n.role,
        kind: n.kind,
        d3Category: "TYPE_D_EXCLUDED_NON_LINE_OR_PROTECTED",
        d3SubCode: `D-protected-${n.role}`,
        eligibleForD3: false,
        policy: "STRICT_PROTECT_OTHER_UNIT",
        reason: `타 유닛 전담 보호 대상(${n.role})`,
      };
      items.push(entry);
      byNodeId.set(n.id, entry);
      summaryCounts.TYPE_D_EXCLUDED_NON_LINE_OR_PROTECTED++;
      continue;
    }

    const sym = parseLineNameSymbolD3(n.label);
    const { pt: resolvedPt, by: anchorBy } = getResolvedNodeAnchorPtUnit3E(n);
    const dirOpt = extractNodeDirectionOptionUnit3E(n.optionsRaw);
    const anchorPt =
      resolvedPt ||
      (n.bbox ? [r2((n.bbox.x0 + n.bbox.x1) / 2), r2((n.bbox.y0 + n.bbox.y1) / 2)] : null);

    if (sym.isUppercaseLetter || sym.isOriginLetterO || sym.isPureTick) {
      const entry = {
        id: n.id,
        label: n.label,
        cleanLabel: sym.stripped,
        role: n.role,
        kind: n.kind,
        d3Category: "TYPE_D_EXCLUDED_NON_LINE_OR_PROTECTED",
        d3SubCode: sym.isUppercaseLetter ? "D-protected-uppercase-unit3e" : "D-protected-numeric-tick-unit3b",
        eligibleForD3: false,
        policy: "STRICT_PROTECT_OTHER_UNIT",
        reason: sym.isUppercaseLetter
          ? `대문자 라벨(${sym.stripped}) — Unit 3-E 관할 보호`
          : `숫자/π 눈금(${sym.stripped}) — Unit 3-B 관할 보호`,
      };
      items.push(entry);
      byNodeId.set(n.id, entry);
      summaryCounts.TYPE_D_EXCLUDED_NON_LINE_OR_PROTECTED++;
      continue;
    }

    if (!sym.isStrictLineNameSymbol) {
      const entry = {
        id: n.id,
        label: n.label,
        cleanLabel: sym.stripped,
        role: n.role,
        kind: n.kind,
        d3Category: "TYPE_D_EXCLUDED_NON_LINE_OR_PROTECTED",
        d3SubCode: "D-non-line-name-symbol",
        eligibleForD3: false,
        policy: "STRICT_PROTECT_D2_OR_SYMBOL",
        reason: `직선 이름 표준 기호(l, m, n, \\ell)가 아닌 문자/기호(${sym.stripped}) — D-2 축 문자 또는 수식 기호로 보호`,
      };
      items.push(entry);
      byNodeId.set(n.id, entry);
      summaryCounts.TYPE_D_EXCLUDED_NON_LINE_OR_PROTECTED++;
      continue;
    }

    const enclosingClip = clipRegions.find(
      (cr) => cr.isScoped && n.start >= cr.scopeStart && n.end <= cr.scopeEnd
    );

    if (n.kind === "inline") {
      const linkedStrokeIdx = n.stmt?.path?.index ?? null;
      const isLinkedToCandidateLine =
        linkedStrokeIdx !== null && candidateLineStrokeSet.has(linkedStrokeIdx);
      if (!isLinkedToCandidateLine) {
        const entry = {
          id: n.id,
          label: n.label,
          cleanLabel: sym.stripped,
          canonicalSymbol: sym.canonicalSymbol,
          role: n.role,
          kind: n.kind,
          d3Category: "TYPE_D_EXCLUDED_NON_LINE_OR_PROTECTED",
          d3SubCode: "D-inline-dashed-projection-tick",
          eligibleForD3: false,
          policy: "STRICT_PROTECT_D2_INLINE_TICK",
          anchorPt,
          dirOption: dirOpt,
          reason: `직선이 아닌 보조선/기타 경로에 연결된 인라인 문자 눈금(${sym.stripped}) — D-2 관할 보호`,
        };
        items.push(entry);
        byNodeId.set(n.id, entry);
        summaryCounts.TYPE_D_EXCLUDED_NON_LINE_OR_PROTECTED++;
        continue;
      }

      const entry = {
        id: n.id,
        node: n,
        label: n.label,
        cleanLabel: sym.stripped,
        canonicalSymbol: sym.canonicalSymbol,
        role: n.role,
        kind: n.kind,
        d3Category: "TYPE_A_INLINE_LINE_NAME",
        d3SubCode: "A:inline-attached-line-name",
        eligibleForD3: true,
        policy: "ACTIVE_D3_TYPE_A_INLINE",
        linkedStrokeIndex: linkedStrokeIdx,
        anchorPt,
        anchorBy,
        dirOption: dirOpt,
        insideClipScope: Boolean(enclosingClip),
        enclosingClipRectPt: enclosingClip ? enclosingClip.ptRect : null,
        reason: `직선(#${linkedStrokeIdx}) 문장에 인라인으로 직접 연결된 직선 이름(${sym.stripped})`,
      };
      items.push(entry);
      byNodeId.set(n.id, entry);
      summaryCounts.TYPE_A_INLINE_LINE_NAME++;
      preliminaryLineNodes.push(entry);
      continue;
    }

    const onXAxis =
      anchorPt !== null &&
      Boolean(scene?.axes?.x) &&
      Math.abs(anchorPt[1]) <= cfg.maxAxisTickSnapDistPt &&
      Math.hypot(anchorPt[0], anchorPt[1]) >= cfg.minOriginSeparationPt;
    const onYAxis =
      anchorPt !== null &&
      Boolean(scene?.axes?.y) &&
      Math.abs(anchorPt[0]) <= cfg.maxAxisTickSnapDistPt &&
      Math.hypot(anchorPt[0], anchorPt[1]) >= cfg.minOriginSeparationPt;
    const hasMarkerAtAnchor =
      anchorPt !== null &&
      markers.some((rm) => Math.hypot(rm.center[0] - anchorPt[0], rm.center[1] - anchorPt[1]) <= 2.5);

    const isAxisTickPlacement =
      (onXAxis && (dirOpt === "below" || dirOpt === "above" || hasMarkerAtAnchor)) ||
      (onYAxis && (dirOpt === "left" || dirOpt === "right" || hasMarkerAtAnchor));

    let minLineDistPt = Infinity;
    for (const ln of candidateLines) {
      if (!anchorPt) continue;
      const d = minDistPolylines(
        [{ pts: [anchorPt, anchorPt], closed: false }],
        [{ pts: ln.visiblePts, closed: false }]
      );
      if (d < minLineDistPt) minLineDistPt = d;
    }

    if (isAxisTickPlacement || candidateLines.length === 0 || minLineDistPt > cfg.maxLineMatchDistancePt) {
      const entry = {
        id: n.id,
        label: n.label,
        cleanLabel: sym.stripped,
        canonicalSymbol: sym.canonicalSymbol,
        role: n.role,
        kind: n.kind,
        d3Category: "TYPE_D_EXCLUDED_NON_LINE_OR_PROTECTED",
        d3SubCode: isAxisTickPlacement
          ? "D-standalone-axis-tick-letter"
          : candidateLines.length === 0
          ? "D-no-candidate-line-in-scene"
          : "D-far-from-any-line-parameter-hold",
        eligibleForD3: false,
        policy: "STRICT_HOLD_NON_LINE_NAME",
        anchorPt,
        dirOption: dirOpt,
        minLineDistPt: r2(minLineDistPt),
        reason: isAxisTickPlacement
          ? `좌표축 위에 배치된 축 문자 눈금(${sym.stripped}) — D-2 관할이므로 직선 이름에서 제외`
          : candidateLines.length === 0
          ? `장면 내 직선 후보가 없어 소문자 기호(${sym.stripped})를 비-직선 이름으로 보호(Hold)`
          : `가장 가까운 직선과의 거리가 ${r2(minLineDistPt)}pt(> ${cfg.maxLineMatchDistancePt}pt)로 멀어 직선 이름이 아닌 일반 기호/매개변수로 보호(Hold)`,
      };
      items.push(entry);
      byNodeId.set(n.id, entry);
      summaryCounts.TYPE_D_EXCLUDED_NON_LINE_OR_PROTECTED++;
      continue;
    }

    const entry = {
      id: n.id,
      node: n,
      label: n.label,
      cleanLabel: sym.stripped,
      canonicalSymbol: sym.canonicalSymbol,
      role: n.role,
      kind: n.kind,
      d3Category: "PENDING_STANDALONE_LINE_NAME",
      d3SubCode: "pending",
      eligibleForD3: true,
      policy: "ACTIVE_D3_STANDALONE",
      linkedStrokeIndex: null,
      anchorPt,
      anchorBy,
      dirOption: dirOpt,
      minLineDistPt: r2(minLineDistPt),
      insideClipScope: Boolean(enclosingClip),
      enclosingClipRectPt: enclosingClip ? enclosingClip.ptRect : null,
      reason: "",
    };
    items.push(entry);
    byNodeId.set(n.id, entry);
    preliminaryLineNodes.push(entry);
  }

  const standaloneLineNodes = preliminaryLineNodes.filter((e) => e.kind === "standalone");
  const isMultiStandalone = standaloneLineNodes.length >= 2;

  for (const entry of standaloneLineNodes) {
    if (isMultiStandalone) {
      entry.d3Category = "TYPE_C_MULTI_STANDALONE_LINE_NAME";
      entry.d3SubCode = "C:multi-line-standalone-name";
      entry.reason = `다중 직선 장면의 독립 \\node 직선 이름(${entry.cleanLabel}, 총 ${standaloneLineNodes.length}개 직선 이름 공존)`;
      summaryCounts.TYPE_C_MULTI_STANDALONE_LINE_NAME++;
    } else {
      entry.d3Category = "TYPE_B_SINGLE_STANDALONE_LINE_NAME";
      entry.d3SubCode = "B:single-line-standalone-name";
      entry.reason = `단일 독립 \\node 직선 이름(${entry.cleanLabel}, 최근접 직선 거리 ${entry.minLineDistPt}pt)`;
      summaryCounts.TYPE_B_SINGLE_STANDALONE_LINE_NAME++;
    }
  }

  return {
    items,
    byNodeId,
    summaryCounts,
    activeLineNameNodes: preliminaryLineNodes,
  };
}

/**
 * 직선 이름 노드(Type A, B, C)와 후보 직선(candidateLines) 간의 1:1 매칭 및 안전 단계(D3-1, D3-2, D3-3)를 판정한다.
 * - D3-2의 기본 lineNameAction은 "hold" (원본 유지)이며, 사용자가 명시적으로 "recommend" 또는 "swap"을 선택할 때만 이동을 확정한다.
 */
export function matchLineNamesToLinesD3(
  scene,
  classification,
  candidateLines,
  { lineNameAction = "hold", params = DEFAULT_D3_LINE_NAME_PARAMS } = {}
) {
  const cfg = { ...DEFAULT_D3_LINE_NAME_PARAMS, ...(params || {}) };
  const activeNodes = classification?.activeLineNameNodes || [];
  const assignments = new Map();

  if (activeNodes.length === 0) {
    return {
      safetyTier: "NONE",
      assignments,
      multiLineAnalysis: null,
    };
  }

  // 1) Type A 인라인 직선 이름 우선 확정 (D3-1)
  const claimedStrokeIndices = new Set();
  for (const item of activeNodes) {
    if (item.d3Category !== "TYPE_A_INLINE_LINE_NAME") continue;
    const lineObj = candidateLines.find((l) => l.strokeIndex === item.linkedStrokeIndex);
    if (lineObj) {
      claimedStrokeIndices.add(lineObj.strokeIndex);
      assignments.set(item.id, {
        nodeId: item.id,
        label: item.label,
        cleanLabel: item.cleanLabel,
        d3Category: item.d3Category,
        safetyStage: "D3-1",
        safetyStageDesc: "D3-1 (인라인 경로 직결 — 자동 확정)",
        confirmed: true,
        matchedLine: lineObj,
        matchMethod: "inline-stroke-attached",
        distToLinePt: 0,
        distToNearestEndPt: 0,
        reason: `직선(#${lineObj.strokeIndex}) 그리기 명령에 인라인으로 직접 연결되어 1:1 대응 확정`,
      });
    }
  }

  const standaloneItems = activeNodes.filter((it) => it.d3Category !== "TYPE_A_INLINE_LINE_NAME");
  if (standaloneItems.length === 0) {
    return {
      safetyTier: "D3-1",
      assignments,
      multiLineAnalysis: null,
    };
  }

  const availableLines = candidateLines.filter((l) => !claimedStrokeIndices.has(l.strokeIndex));

  const scorePair = (item, lineObj) => {
    const anchor = item.anchorPt;
    const distLinePt = anchor
      ? r2(
          minDistPolylines(
            [{ pts: [anchor, anchor], closed: false }],
            [{ pts: lineObj.visiblePts, closed: false }]
          )
        )
      : 999;
    const dEnd0 = anchor
      ? Math.hypot(anchor[0] - lineObj.ends[0].pointPt[0], anchor[1] - lineObj.ends[0].pointPt[1])
      : 999;
    const dEnd1 = anchor
      ? Math.hypot(anchor[0] - lineObj.ends[1].pointPt[0], anchor[1] - lineObj.ends[1].pointPt[1])
      : 999;
    const nearestEndIndex = dEnd0 <= dEnd1 ? 0 : 1;
    const distNearestEndPt = r2(Math.min(dEnd0, dEnd1));

    const hintSymbol = lineObj.commentHint?.symbol || null;
    const commentMatch = Boolean(hintSymbol && hintSymbol === item.canonicalSymbol);
    const commentConflict = Boolean(hintSymbol && hintSymbol !== item.canonicalSymbol);

    return {
      nodeId: item.id,
      label: item.label,
      cleanLabel: item.cleanLabel,
      canonicalSymbol: item.canonicalSymbol,
      strokeIndex: lineObj.strokeIndex,
      lineObj,
      distLinePt,
      nearestEndIndex,
      distNearestEndPt,
      commentHint: lineObj.commentHint?.rawComment || null,
      commentSymbol: hintSymbol,
      commentMatch,
      commentConflict,
      geomCostPt: r2(distLinePt + distNearestEndPt * 0.18),
    };
  };

  // 2) 단일 독립 직선 이름 (Type B -> D3-1 또는 D3-3)
  if (standaloneItems.length === 1) {
    const item = standaloneItems[0];
    if (availableLines.length === 0) {
      assignments.set(item.id, {
        nodeId: item.id,
        label: item.label,
        cleanLabel: item.cleanLabel,
        d3Category: item.d3Category,
        safetyStage: "D3-3",
        safetyStageDesc: "D3-3 (대응 가능한 직선 없음 — Hold)",
        confirmed: false,
        matchedLine: null,
        matchMethod: "unmatched-hold",
        reason: "대응 가능한 직선 후보가 없어 원본 위치 유지(Hold)",
      });
      return { safetyTier: "D3-3", assignments, multiLineAnalysis: null };
    }

    const pairs = availableLines
      .map((ln) => scorePair(item, ln))
      .sort((a, b) => a.geomCostPt - b.geomCostPt);
    const best = pairs[0];
    const second = pairs[1] || null;
    const geomMarginPt = second ? r2(second.distLinePt - best.distLinePt) : 999;

    const otherHasExplicitComment = pairs.slice(1).some((p) => p.commentMatch);
    if (best.commentConflict || otherHasExplicitComment || (second && geomMarginPt < 8.0 && !best.commentMatch)) {
      const reasonMsg =
        best.commentConflict || otherHasExplicitComment
          ? `TikZ 주석 힌트와 기하학적 최근접 직선(#${best.strokeIndex})이 서로 모순되어 안전을 위해 Hold 강제`
          : `인접한 두 직선(#${best.strokeIndex}, #${second.strokeIndex})과의 거리 차이(${geomMarginPt}pt < 8.0pt)가 작아 교점 인근 모호성으로 Hold 강제`;
      assignments.set(item.id, {
        nodeId: item.id,
        label: item.label,
        cleanLabel: item.cleanLabel,
        d3Category: item.d3Category,
        safetyStage: "D3-3",
        safetyStageDesc: "D3-3 (주석/기하 모순 또는 교점 모호성 — Hold 강제)",
        confirmed: false,
        matchedLine: null,
        matchMethod: "ambiguous-single-hold",
        reason: reasonMsg,
      });
      return { safetyTier: "D3-3", assignments, multiLineAnalysis: {
        supportedPair: false,
        safetyStage: "D3-3",
        effectiveAction: "hold",
        contradictions: [reasonMsg],
        reason: reasonMsg,
      } };
    }

    assignments.set(item.id, {
      nodeId: item.id,
      label: item.label,
      cleanLabel: item.cleanLabel,
      d3Category: item.d3Category,
      safetyStage: "D3-1",
      safetyStageDesc: "D3-1 (단일 직선 이름 명확 대응 — 자동 확정)",
      confirmed: true,
      matchedLine: best.lineObj,
      matchMethod: best.commentMatch ? "single-line-geom-and-comment-confirmed" : "single-line-geom-confirmed",
      distToLinePt: best.distLinePt,
      distToNearestEndPt: best.distNearestEndPt,
      nearestEndIndex: best.nearestEndIndex,
      geomMarginPt,
      reason: `단일 직선 이름(${item.cleanLabel})이 직선 #${best.strokeIndex}(거리 ${best.distLinePt}pt${best.commentMatch ? `, 주석 '${best.commentHint}' 일치` : ""})에 명확히 대응됨`,
    });
    return { safetyTier: "D3-1", assignments, multiLineAnalysis: null };
  }

  // 3) 다중 독립 직선 이름 (Type C: 2개 이상)
  if (standaloneItems.length >= 3 || availableLines.length < standaloneItems.length) {
    const reasonMsg =
      standaloneItems.length >= 3
        ? `독립 직선 이름이 ${standaloneItems.length}개(${standaloneItems.map((x) => x.cleanLabel).join(", ")}) 존재하여 3개 이상 다중 직선 안전 규칙(D3-3)에 따라 전체 Hold 강제`
        : `독립 직선 이름(${standaloneItems.length}개) 대비 후보 직선(${availableLines.length}개)이 부족하여 D3-3 전체 Hold 강제`;
    for (const item of standaloneItems) {
      assignments.set(item.id, {
        nodeId: item.id,
        label: item.label,
        cleanLabel: item.cleanLabel,
        d3Category: item.d3Category,
        safetyStage: "D3-3",
        safetyStageDesc: "D3-3 (3개 이상 다중 직선 또는 후보 부족 — Hold 강제)",
        confirmed: false,
        matchedLine: null,
        matchMethod: "multi-line-d3-3-hold",
        reason: reasonMsg,
      });
    }
    return {
      safetyTier: "D3-3",
      assignments,
      multiLineAnalysis: {
        supportedPair: false,
        safetyStage: "D3-3",
        effectiveAction: "hold",
        contradictions: [reasonMsg],
        reason: reasonMsg,
      },
    };
  }

  const [L0, L1] = standaloneItems;
  const permutations = [];
  for (let i = 0; i < availableLines.length; i++) {
    for (let j = 0; j < availableLines.length; j++) {
      if (i === j) continue;
      const p0 = scorePair(L0, availableLines[i]);
      const p1 = scorePair(L1, availableLines[j]);
      const rawDistSumPt = r2(p0.distLinePt + p1.distLinePt);
      const geomCostSumPt = r2(p0.geomCostPt + p1.geomCostPt);
      const commentMatches = (p0.commentMatch ? 1 : 0) + (p1.commentMatch ? 1 : 0);
      const commentConflicts = (p0.commentConflict ? 1 : 0) + (p1.commentConflict ? 1 : 0);
      permutations.push({
        pairs: [p0, p1],
        lineIndices: [availableLines[i].strokeIndex, availableLines[j].strokeIndex],
        rawDistSumPt,
        geomCostSumPt,
        commentMatches,
        commentConflicts,
      });
    }
  }

  permutations.sort((a, b) => a.geomCostSumPt - b.geomCostSumPt || a.rawDistSumPt - b.rawDistSumPt);
  const bestPerm = permutations[0];
  const swappedPerm =
    permutations.find(
      (p) =>
        p.lineIndices[0] === bestPerm.lineIndices[1] &&
        p.lineIndices[1] === bestPerm.lineIndices[0]
    ) || permutations[1];
  const secondBestPerm = permutations[1];

  const rawDistMarginPt = r2((secondBestPerm?.rawDistSumPt ?? 999) - bestPerm.rawDistSumPt);
  const swapDistMarginPt = r2((swappedPerm?.rawDistSumPt ?? 999) - bestPerm.rawDistSumPt);

  const maxCommentMatchesInAnyPerm = Math.max(...permutations.map((p) => p.commentMatches));
  const hasCommentGeometryConflict =
    bestPerm.commentConflicts > 0 ||
    (maxCommentMatchesInAnyPerm > bestPerm.commentMatches);

  const hasNarrowMarginAmbiguity = rawDistMarginPt < cfg.minGlobalPairMarginPt;

  const contradictions = [];
  if (hasCommentGeometryConflict) {
    contradictions.push("TikZ 주석의 직선 이름 힌트와 기하학적 최근접 1:1 직선 배정이 서로 모순됨");
  }
  if (hasNarrowMarginAmbiguity) {
    contradictions.push(
      `전역 1:1 거리 합 우위 마진(+${rawDistMarginPt}pt)이 최소 안전 기준(${cfg.minGlobalPairMarginPt}pt) 미만으로 두 직선 교점 인근 모호성 존재`
    );
  }

  const stripPermForSummary = (perm) =>
    perm
      ? {
          lineIndices: perm.lineIndices,
          rawDistSumPt: perm.rawDistSumPt,
          geomCostSumPt: perm.geomCostSumPt,
          commentMatches: perm.commentMatches,
          commentConflicts: perm.commentConflicts,
          pairs: perm.pairs.map(({ lineObj, ...rest }) => ({
            ...rest,
            plotExpr: lineObj?.plotExpr || null,
            endsMath: lineObj?.ends?.map((e) => e.pointMath) || [],
          })),
        }
      : null;

  if (contradictions.length > 0) {
    const reasonMsg = `[D3-3 강제 Hold] ${contradictions.join("; ")}`;
    for (const item of standaloneItems) {
      assignments.set(item.id, {
        nodeId: item.id,
        label: item.label,
        cleanLabel: item.cleanLabel,
        d3Category: item.d3Category,
        safetyStage: "D3-3",
        safetyStageDesc: "D3-3 (주석·기하 모순 또는 마진 부족 — 강제 Hold)",
        confirmed: false,
        matchedLine: null,
        matchMethod: "multi-line-d3-3-hold",
        reason: reasonMsg,
      });
    }
    return {
      safetyTier: "D3-3",
      assignments,
      multiLineAnalysis: {
        supportedPair: false,
        safetyStage: "D3-3",
        effectiveAction: "hold",
        rawDistMarginPt,
        swapDistMarginPt,
        contradictions,
        recommendedAssignment: stripPermForSummary(bestPerm),
        swappedAssignment: stripPermForSummary(swappedPerm),
        reason: reasonMsg,
      },
    };
  }

  // D3-2 (2개 다중 직선 이름 l, m — 기본값 "hold")
  const effectiveAction = normalizeLineNameActionD3(lineNameAction);
  const activePerm = effectiveAction === "swap" ? swappedPerm : bestPerm;
  const shouldConfirm = effectiveAction === "recommend" || effectiveAction === "swap";

  for (const pair of activePerm.pairs) {
    const item = standaloneItems.find((x) => x.id === pair.nodeId);
    const recPair = bestPerm.pairs.find((p) => p.nodeId === pair.nodeId);
    const swpPair = swappedPerm.pairs.find((p) => p.nodeId === pair.nodeId);
    assignments.set(pair.nodeId, {
      nodeId: pair.nodeId,
      label: pair.label,
      cleanLabel: pair.cleanLabel,
      d3Category: item.d3Category,
      safetyStage: "D3-2",
      safetyStageDesc: "D3-2 (다중 직선 l, m 전역 1:1 매칭 — Hold / Recommend / Swap 지원)",
      confirmed: shouldConfirm,
      lineNameAction: effectiveAction,
      matchedLine: shouldConfirm ? pair.lineObj : null,
      previewRecommendedLine: recPair?.lineObj ?? null,
      previewSwappedLine: swpPair?.lineObj ?? null,
      recommendedStrokeIndex: recPair?.strokeIndex ?? null,
      swappedStrokeIndex: swpPair?.strokeIndex ?? null,
      matchMethod:
        effectiveAction === "swap"
          ? "multi-line-d3-2-swapped"
          : effectiveAction === "recommend"
          ? "multi-line-d3-2-recommended"
          : "multi-line-d3-2-hold",
      distToLinePt: pair.distLinePt,
      distToNearestEndPt: pair.distNearestEndPt,
      nearestEndIndex: pair.nearestEndIndex,
      rawDistMarginPt,
      swapDistMarginPt,
      commentHint: pair.commentHint,
      commentMatch: pair.commentMatch,
      reason: shouldConfirm
        ? `[D3-2 ${effectiveAction.toUpperCase()}] 직선 이름 ${pair.cleanLabel} → 직선 #${pair.strokeIndex}(${pair.lineObj.plotExpr || "line"}, 거리 ${pair.distLinePt}pt, 전역 마진 +${rawDistMarginPt}pt${pair.commentMatch ? `, 주석 '${pair.commentHint}' 일치` : ""})`
        : `[D3-2 HOLD] 기본/사용자 Hold 선택으로 원본 위치 유지 (추천 직선: #${recPair?.strokeIndex})`,
    });
  }

  return {
    safetyTier: "D3-2",
    assignments,
    multiLineAnalysis: {
      supportedPair: true,
      safetyStage: "D3-2",
      effectiveAction,
      rawDistMarginPt,
      swapDistMarginPt,
      contradictions: [],
      recommendedAssignment: stripPermForSummary(bestPerm),
      swappedAssignment: stripPermForSummary(swappedPerm),
      reason: `다중 직선 이름(${standaloneItems.map((x) => x.cleanLabel).join(", ")}) 전역 1:1 매칭 성공 (마진 +${rawDistMarginPt}pt, 주석 일치 ${bestPerm.commentMatches}/2)`,
    },
  };
}

/**
 * 직선 이름 후보 바운딩 박스(bb)와 자기 직선(matchedLine), 타 실선 곡선/직선, 점선 보조선,
 * 좌표축, 타 라벨/점 마커, 그리고 가시 끝점(visibleTipPt) 간의 정밀 간격을 측정한다.
 */
export function evaluateLineNameBoxClearancesD3(
  nodeId,
  matchedLine,
  targetEndIndex,
  bb,
  scene,
  nodeBoxesById,
  insideClipScope = false,
  enclosingClipRectPt = null,
  params = DEFAULT_D3_LINE_NAME_PARAMS
) {
  const cfg = { ...DEFAULT_D3_LINE_NAME_PARAMS, ...(params || {}) };
  const poly = [rectPoly(bb)];
  const ownHw = matchedLine.stroke.halfWidth || 0.75;
  const ownLineClearancePt = r2(
    minDistPolylines(poly, [{ pts: matchedLine.visiblePts, closed: false }]) - ownHw
  );

  let minOtherMainStrokeClearance = Infinity;
  let minDashedStrokeClearance = Infinity;
  let minAxisClearance = Infinity;
  const collidingStrokes = [];

  for (const s of scene.strokes || []) {
    if (!s || !Array.isArray(s.pts) || s.pts.length < 2) continue;
    if (s.index === matchedLine.strokeIndex) continue;

    const isDashed = s.kind === "dashed" || /dashed|dotted/.test(s.stmt?.raw || s.stmt?.optsRaw || "");
    const hw = s.halfWidth || (s.kind === "axis" ? 0.5 : isDashed ? 0.4 : 0.75);
    const c = minDistPolylines(poly, [{ pts: s.pts, closed: false }]) - hw;

    if (s.kind === "axis") {
      if (c < minAxisClearance) minAxisClearance = c;
      if (c < 0) collidingStrokes.push({ index: s.index, kind: "axis", clearancePt: r2(c) });
    } else if (isDashed) {
      if (c < minDashedStrokeClearance) minDashedStrokeClearance = c;
      if (c < 0) collidingStrokes.push({ index: s.index, kind: "dashed", clearancePt: r2(c) });
    } else {
      if (c < minOtherMainStrokeClearance) minOtherMainStrokeClearance = c;
      if (c < 0) collidingStrokes.push({ index: s.index, kind: "other-main-stroke", clearancePt: r2(c) });
    }
  }

  let minNodeGap = Infinity;
  let minMarkerGap = Infinity;
  const collidingNodes = [];

  for (const other of scene.nodes || []) {
    if (!other || other.id === nodeId) continue;
    if (other.role === "marker") {
      if (other.bbox) {
        const g = bboxGapRect(bb, other.bbox);
        if (g < minMarkerGap) minMarkerGap = g;
        if (g < minNodeGap) minNodeGap = g;
      }
      continue;
    }
    const otherBb = (nodeBoxesById && nodeBoxesById.get(other.id)) || other.bbox;
    if (!otherBb) continue;
    const g = bboxGapRect(bb, otherBb);
    if (g < minNodeGap) minNodeGap = g;
    if (g <= 0.25) {
      collidingNodes.push({ id: other.id, label: other.label, role: other.role, gapPt: r2(g) });
    }
  }

  const end0Pt = matchedLine.ends[0].pointPt;
  const end1Pt = matchedLine.ends[1].pointPt;
  const distEnd0Pt = bboxPtDist(end0Pt, bb);
  const distEnd1Pt = bboxPtDist(end1Pt, bb);
  const nearestEndIndex = distEnd0Pt <= distEnd1Pt ? 0 : 1;
  const minTipDistPt = r2(Math.min(distEnd0Pt, distEnd1Pt));
  const nearestEndObj = matchedLine.ends[nearestEndIndex];
  const targetTipPt = matchedLine.ends[targetEndIndex ?? nearestEndIndex].pointPt;
  const targetTipDistPt = r2(bboxPtDist(targetTipPt, bb));

  const cx = (bb.x0 + bb.x1) / 2;
  const cy = (bb.y0 + bb.y1) / 2;
  const [ntx, nty] = nearestEndObj.outwardTangent;
  const nearestEndAlongProjPt = r2((cx - nearestEndObj.pointPt[0]) * ntx + (cy - nearestEndObj.pointPt[1]) * nty);

  let clippedByEnclosingScope = false;
  let minClipBoundaryMarginPt = Infinity;
  if (insideClipScope && enclosingClipRectPt) {
    const mLeft = bb.x0 - enclosingClipRectPt.x0;
    const mRight = enclosingClipRectPt.x1 - bb.x1;
    const mBot = bb.y0 - enclosingClipRectPt.y0;
    const mTop = enclosingClipRectPt.y1 - bb.y1;
    minClipBoundaryMarginPt = r2(Math.min(mLeft, mRight, mBot, mTop));
    if (minClipBoundaryMarginPt < cfg.clipSafetyInsetPt) {
      clippedByEnclosingScope = true;
    }
  }

  return {
    ownLineClearancePt,
    minOtherMainStrokeClearance: r2(minOtherMainStrokeClearance),
    minDashedStrokeClearance: r2(minDashedStrokeClearance),
    minAxisClearance: r2(minAxisClearance),
    minNodeGap: r2(minNodeGap),
    minMarkerGap: r2(minMarkerGap),
    nearestEndIndex,
    minTipDistPt,
    targetTipDistPt,
    nearestEndAlongProjPt,
    clippedByEnclosingScope,
    minClipBoundaryMarginPt: Number.isFinite(minClipBoundaryMarginPt) ? minClipBoundaryMarginPt : null,
    collidingStrokes,
    collidingNodes,
  };
}

/**
 * 원본 직선 이름 위치가 이미 평가원 스타일로 충분히 자연스러운지(불필요한 이동 금지 대상인지) 판정한다.
 */
export function checkLineNameNeedsMoveD3(origClr, params = DEFAULT_D3_LINE_NAME_PARAMS) {
  const cfg = { ...DEFAULT_D3_LINE_NAME_PARAMS, ...(params || {}) };
  const reasons = [];

  if (origClr.clippedByEnclosingScope) {
    reasons.push(`inside-clip-scope-cutoff(${origClr.minClipBoundaryMarginPt}pt)`);
  }
  if (origClr.ownLineClearancePt < cfg.keepMinOwnLineClearancePt) {
    reasons.push(`own-line-too-close-or-overlap(${origClr.ownLineClearancePt}pt < ${cfg.keepMinOwnLineClearancePt}pt)`);
  }
  if (origClr.minOtherMainStrokeClearance < cfg.keepMinOtherStrokeClearancePt) {
    reasons.push(`other-curve-or-line-crowded(${origClr.minOtherMainStrokeClearance}pt < ${cfg.keepMinOtherStrokeClearancePt}pt)`);
  }
  if (origClr.minDashedStrokeClearance < cfg.candCMinDashedClearancePt) {
    reasons.push(`dashed-line-crowded(${origClr.minDashedStrokeClearance}pt)`);
  }
  if (origClr.minAxisClearance < cfg.keepMinAxisClearancePt) {
    reasons.push(`axis-crowded(${origClr.minAxisClearance}pt < ${cfg.keepMinAxisClearancePt}pt)`);
  }
  if (origClr.minNodeGap < cfg.candCMinNodeGapPt) {
    reasons.push(`node-or-marker-crowded(${origClr.minNodeGap}pt < ${cfg.candCMinNodeGapPt}pt)`);
  }
  if (origClr.minTipDistPt > cfg.keepNearVisibleTipMaxDistPt) {
    reasons.push(`mid-line-awkward-position(tipDist=${origClr.minTipDistPt}pt > ${cfg.keepNearVisibleTipMaxDistPt}pt)`);
  } else if (origClr.nearestEndAlongProjPt < -cfg.keepMaxBehindVisibleTipPt) {
    reasons.push(`lagging-behind-visible-tip(alongProj=${origClr.nearestEndAlongProjPt}pt < -${cfg.keepMaxBehindVisibleTipPt}pt)`);
  }

  return {
    needsMove: reasons.length > 0,
    reasons,
  };
}

/**
 * 확정된 직선(matchedLine)에 대해 Candidate B(최소 이동) 및 Candidate C(평가원 가시 끝점 자연 배치)를 탐색한다.
 */
export function searchLineNameCandidatesD3(
  node,
  classInfo,
  matchInfo,
  scene,
  nodeBoxesById,
  params = DEFAULT_D3_LINE_NAME_PARAMS
) {
  const cfg = { ...DEFAULT_D3_LINE_NAME_PARAMS, ...(params || {}) };
  const matchedLine = matchInfo.matchedLine;
  const ox = node.xshift || 0;
  const oy = node.yshift || 0;
  const w = node.bbox.x1 - node.bbox.x0;
  const h = node.bbox.y1 - node.bbox.y0;
  const origCx = (node.bbox.x0 + node.bbox.x1) / 2;
  const origCy = (node.bbox.y0 + node.bbox.y1) / 2;

  const d0 = Math.hypot(origCx - matchedLine.ends[0].pointPt[0], origCy - matchedLine.ends[0].pointPt[1]);
  const d1 = Math.hypot(origCx - matchedLine.ends[1].pointPt[0], origCy - matchedLine.ends[1].pointPt[1]);
  const preferredEndIndex = d1 <= d0 + 25.0 ? 1 : 0;

  // [탐색 1] Candidate B: 원본 위치 기준 최소 이동 충돌 해소
  const candBList = [];
  const maxB = cfg.candBMaxShiftPt;
  const stepB = cfg.candBShiftStepPt;

  for (let dxS = -maxB; dxS <= maxB + 1e-9; dxS = r2(dxS + stepB)) {
    for (let dyS = -maxB; dyS <= maxB + 1e-9; dyS = r2(dyS + stepB)) {
      const candShift = [r2(ox + dxS), r2(oy + dyS)];
      const candBb = bboxFromShift(node, candShift);
      const clr = evaluateLineNameBoxClearancesD3(
        node.id,
        matchedLine,
        preferredEndIndex,
        candBb,
        scene,
        nodeBoxesById,
        classInfo.insideClipScope,
        classInfo.enclosingClipRectPt,
        cfg
      );

      if (clr.clippedByEnclosingScope) continue;
      if (clr.ownLineClearancePt < cfg.candBMinOwnClearancePt) continue;
      if (clr.ownLineClearancePt > cfg.candBMaxLineAttachDistPt) continue;
      if (clr.minOtherMainStrokeClearance < cfg.candBMinOtherStrokeClearancePt) continue;
      if (clr.minDashedStrokeClearance < 1.5) continue;
      if (clr.minAxisClearance < cfg.candBMinAxisClearancePt) continue;
      if (clr.minNodeGap < cfg.candBMinNodeGapPt) continue;

      const shiftDeltaNorm = r2(Math.hypot(dxS, dyS));
      const renderedMovePt = r2(
        Math.hypot(
          (candBb.x0 + candBb.x1) / 2 - origCx,
          (candBb.y0 + candBb.y1) / 2 - origCy
        )
      );

      const minAll = Math.min(
        clr.ownLineClearancePt,
        clr.minOtherMainStrokeClearance,
        clr.minAxisClearance,
        clr.minNodeGap
      );

      candBList.push({
        mode: "min-move-local-escape",
        shift: candShift,
        deltaShift: [dxS, dyS],
        deltaShiftNormPt: shiftDeltaNorm,
        renderedMovePt,
        bbox: candBb,
        clearance: clr,
        minAll: r2(minAll),
      });
    }
  }

  candBList.sort(
    (a, b) =>
      a.deltaShiftNormPt - b.deltaShiftNormPt ||
      a.renderedMovePt - b.renderedMovePt ||
      b.minAll - a.minAll
  );

  // [탐색 2] Candidate C: 평가원 스타일 가시 끝점(visibleTipPt) 자연 배치
  const candCList = [];
  const seenShiftKeysC = new Set();
  const shiftRoundParams = { ...PARAMS, shiftRound: 1 };

  const tryAddCandidateC = (rawTargetBb, endObj, placementTag) => {
    const sh = computeShiftForMove(node, rawTargetBb, shiftRoundParams);
    const nx = Object.is(sh.newShift[0], -0) ? 0 : sh.newShift[0];
    const ny = Object.is(sh.newShift[1], -0) ? 0 : sh.newShift[1];
    const key = `${nx},${ny}`;
    if (seenShiftKeysC.has(key)) return;
    seenShiftKeysC.add(key);

    const bb = sh.actualBbox;
    const clr = evaluateLineNameBoxClearancesD3(
      node.id,
      matchedLine,
      endObj.endIndex,
      bb,
      scene,
      nodeBoxesById,
      classInfo.insideClipScope,
      classInfo.enclosingClipRectPt,
      cfg
    );

    if (clr.clippedByEnclosingScope) return;
    if (clr.ownLineClearancePt < cfg.candCMinOwnClearancePt) return;
    if (clr.ownLineClearancePt > cfg.candCIdealOwnClearanceMaxPt + 2.0) return;
    if (clr.minOtherMainStrokeClearance < cfg.candCMinOtherMainClearancePt) return;
    if (clr.minDashedStrokeClearance < cfg.candCMinDashedClearancePt) return;
    if (clr.minAxisClearance < cfg.candCMinAxisClearancePt) return;
    if (clr.minNodeGap < cfg.candCMinNodeGapPt) return;
    if (clr.targetTipDistPt > cfg.candCMaxTipGapPt) return;

    const E = endObj.pointPt;
    const [tx, ty] = endObj.outwardTangent;
    const cx = (bb.x0 + bb.x1) / 2;
    const cy = (bb.y0 + bb.y1) / 2;
    const vx = cx - E[0];
    const vy = cy - E[1];
    const vLen = Math.hypot(vx, vy) || 1;
    const alongTipProjPt = vx * tx + vy * ty;
    const cosAlign = alongTipProjPt / vLen;
    const normalSignedPt = vx * (-ty) + vy * tx;

    const minAllowedProjPt = classInfo.insideClipScope ? -14.0 : -5.5;
    if (alongTipProjPt < minAllowedProjPt) return;

    const deltaShift = [r2(nx - ox), r2(ny - oy)];
    const deltaShiftNormPt = r2(Math.hypot(deltaShift[0], deltaShift[1]));
    const renderedMovePt = r2(Math.hypot(cx - origCx, cy - origCy));

    let scoreC = endObj.endIndex === preferredEndIndex ? 120.0 : 95.0;

    if (
      clr.targetTipDistPt >= cfg.candCIdealTipGapMinPt &&
      clr.targetTipDistPt <= cfg.candCIdealTipGapMaxPt
    ) {
      scoreC += 18.0 - Math.abs(clr.targetTipDistPt - 3.6) * 2.2;
    } else {
      scoreC -= Math.abs(clr.targetTipDistPt - 4.0) * 4.5;
    }

    if (clr.ownLineClearancePt >= cfg.candCIdealOwnClearanceMinPt && clr.ownLineClearancePt <= 5.0) {
      scoreC += 14.0 - Math.abs(clr.ownLineClearancePt - 2.8) * 2.0;
    } else {
      scoreC -= Math.abs(clr.ownLineClearancePt - 2.8) * 3.5;
    }

    if (!classInfo.insideClipScope) {
      if (alongTipProjPt >= 0 && alongTipProjPt <= 11.0) {
        scoreC += 14.0 + cosAlign * 8.0;
      } else {
        scoreC += alongTipProjPt * 2.5;
      }
      if (tx > 0.2 && ty > 0.2 && cy >= E[1] && cx >= E[0] - w * 0.25) {
        scoreC += 8.0;
      }
      if (tx > 0.2 && ty < -0.2 && cx >= E[0] && Math.abs(cy - E[1]) <= h * 0.85) {
        scoreC += 8.5;
      }
    } else {
      scoreC += Math.min(clr.minClipBoundaryMarginPt || 0, 8.0) * 2.0;
    }

    scoreC += Math.min(clr.minOtherMainStrokeClearance, cfg.candCPrefOtherMainClearancePt) * 2.4;
    scoreC += Math.min(clr.minAxisClearance, cfg.candCPrefAxisClearancePt) * 1.8;
    scoreC += Math.min(clr.minNodeGap, 12.0) * 0.9;
    scoreC -= deltaShiftNormPt * 0.18;

    candCList.push({
      mode: "kice-visible-tip-natural",
      placementTag,
      endIndex: endObj.endIndex,
      endPointPt: endObj.pointPt,
      endPointMath: endObj.pointMath,
      shift: [nx, ny],
      deltaShift,
      deltaShiftNormPt,
      renderedMovePt,
      alongTipProjPt: r2(alongTipProjPt),
      normalSignedPt: r2(normalSignedPt),
      bbox: bb,
      clearance: clr,
      scoreC: r2(scoreC),
    });
  };

  for (const endObj of matchedLine.ends) {
    const E = endObj.pointPt;
    for (let dxPt = -18.0; dxPt <= 20.0; dxPt += 2.0) {
      for (let dyPt = -18.0; dyPt <= 20.0; dyPt += 2.0) {
        const rawBb = {
          x0: E[0] + dxPt - w / 2,
          x1: E[0] + dxPt + w / 2,
          y0: E[1] + dyPt - h / 2,
          y1: E[1] + dyPt + h / 2,
        };
        const sideDesc =
          dyPt >= 3 ? (dxPt >= 3 ? "tip-above-right" : dxPt <= -3 ? "tip-above-left" : "tip-above") :
          dyPt <= -3 ? (dxPt >= 3 ? "tip-below-right" : dxPt <= -3 ? "tip-below-left" : "tip-below") :
          dxPt >= 0 ? "tip-right" : "tip-left";
        tryAddCandidateC(rawBb, endObj, `end${endObj.endIndex}-${sideDesc}`);
      }
    }
  }

  candCList.sort((a, b) => b.scoreC - a.scoreC || a.deltaShiftNormPt - b.deltaShiftNormPt);

  const bestC = candCList[0] || null;
  const bestB = candBList[0] || bestC || null;

  return {
    strategy: bestC ? "kice-visible-tip-placement" : bestB ? "fallback-min-move" : "no-safe-candidate-hold",
    candB: bestB,
    candC: bestC || bestB,
    candBCount: candBList.length,
    candCCount: candCList.length,
  };
}

/**
 * 선행 유닛(Unit 2 함수식, Unit 3-B 숫자 눈금, Unit 3-D 원점, Unit 3-E 대문자 점 이름, Unit 3-F 축 문자 눈금)이
 * 이미 계획한 라벨 이동과 축 연장(axisEditsToApply)을 반영한 유효 장면 상태를 구성한다.
 */
export function buildEffectiveSceneStateBeforeLineNamesUnit3G(
  scene,
  fnPlan,
  fnShiftResult,
  axisEditsToApply,
  tickPlan,
  originPlan,
  pointLabelPlan,
  axisLetterPlan
) {
  const { xU = 28.45, yU = 28.45 } = scene.units || {};
  const nodeBoxesById = new Map();

  for (const nd of scene.nodes || []) {
    if (nd && nd.bbox && nd.role !== "marker") {
      nodeBoxesById.set(nd.id, nd.bbox);
    }
  }

  if (Array.isArray(fnPlan?.placements)) {
    for (const pl of fnPlan.placements) {
      if (pl?.id && pl.action === "move" && pl.bbox) {
        nodeBoxesById.set(pl.id, pl.bbox);
      }
    }
  }
  if (fnPlan?.placedBoxById instanceof Map) {
    for (const [id, bb] of fnPlan.placedBoxById.entries()) {
      if (bb) nodeBoxesById.set(id, bb);
    }
  }
  for (const mv of fnShiftResult?.moves || []) {
    if (mv?.id && (mv?.actualBbox || mv?.newBBox || mv?.bbox)) {
      nodeBoxesById.set(mv.id, mv.actualBbox || mv.newBBox || mv.bbox);
    }
  }
  for (const tk of tickPlan?.movedTicks || []) {
    const bb = tk?.newBBox || tk?.newBbox || tk?.bbox;
    if (tk?.id && bb) {
      nodeBoxesById.set(tk.id, bb);
    }
  }
  for (const om of originPlan?.movedOrigins || []) {
    const bb = om?.newBBox || om?.newBbox || om?.bbox;
    if (om?.id && bb) {
      nodeBoxesById.set(om.id, bb);
    }
  }
  if (originPlan?.movedOrigin?.id && (originPlan?.movedOrigin?.newBBox || originPlan?.movedOrigin?.newBbox)) {
    nodeBoxesById.set(
      originPlan.movedOrigin.id,
      originPlan.movedOrigin.newBBox || originPlan.movedOrigin.newBbox
    );
  }
  for (const ptMv of pointLabelPlan?.movedPointLabels || []) {
    const bb = ptMv?.newBBox || ptMv?.newBbox || ptMv?.bbox;
    if (ptMv?.id && bb) {
      nodeBoxesById.set(ptMv.id, bb);
    }
  }
  for (const axMv of axisLetterPlan?.movedAxisLetters || []) {
    const bb = axMv?.newBBox || axMv?.newBbox || axMv?.bbox;
    if (axMv?.id && bb) {
      nodeBoxesById.set(axMv.id, bb);
    }
  }

  let effectiveStrokes = scene.strokes || [];
  const xAxisEdit = (axisEditsToApply || []).find(
    (e) => e.axis === "x" && e.applied && e.newTipMath
  );
  const yAxisEdit = (axisEditsToApply || []).find(
    (e) => e.axis === "y" && e.applied && e.newTipMath
  );

  if (xAxisEdit || yAxisEdit) {
    effectiveStrokes = effectiveStrokes.map((s) => {
      if (s.kind !== "axis" || !Array.isArray(s.pts) || s.pts.length < 2) return s;
      const p0 = s.pts[0];
      const p1 = s.pts[s.pts.length - 1];
      const isHoriz = Math.abs(p1[1] - p0[1]) < Math.abs(p1[0] - p0[0]);
      if (isHoriz && xAxisEdit) {
        const newEndPt = [xAxisEdit.newTipMath[0] * xU, xAxisEdit.newTipMath[1] * yU];
        const copyPts = s.pts.slice();
        copyPts[copyPts.length - 1] = newEndPt;
        return { ...s, pts: copyPts };
      }
      if (!isHoriz && yAxisEdit) {
        const newEndPt = [yAxisEdit.newTipMath[0] * xU, yAxisEdit.newTipMath[1] * yU];
        const copyPts = s.pts.slice();
        copyPts[copyPts.length - 1] = newEndPt;
        return { ...s, pts: copyPts };
      }
      return s;
    });
  }

  return {
    sceneEff: {
      ...scene,
      strokes: effectiveStrokes,
    },
    nodeBoxesById,
  };
}

/**
 * 본 엔진 파이프라인(v022-adapter.mjs) 통합용 Unit 3-G (D-3) 플래너
 * - enableUnit3G가 false(기본값 OFF)이면 즉시 빈 결과를 반환하여 Production 동작과 100% 일치한다.
 * - D3-2 다중 직선 이름($l, m$)의 기본 lineNameAction은 "hold"이며,
 *   사용자가 명시적으로 "recommend" 또는 "swap"을 선택했을 때만 이동을 적용한다.
 */
export function planLineNameLabelsD3(
  scene,
  fnPlan,
  fnShiftResult,
  axisEditsToApply,
  tickPlan,
  originPlan,
  pointLabelPlan,
  axisLetterPlan,
  {
    enableUnit3G = false,
    lineNameAction = "hold",
    params = DEFAULT_D3_LINE_NAME_PARAMS,
  } = {}
) {
  const normalizedAction = normalizeLineNameActionD3(lineNameAction);
  if (!enableUnit3G || !scene || !Array.isArray(scene.nodes)) {
    return {
      enabled: false,
      lineNameAction: normalizedAction,
      safetyTier: "NONE",
      classification: null,
      multiLineAnalysis: null,
      decisions: [],
      movedLineNames: [],
      edits: [],
    };
  }

  const cfg = { ...DEFAULT_D3_LINE_NAME_PARAMS, ...(params || {}) };
  const { sceneEff, nodeBoxesById } = buildEffectiveSceneStateBeforeLineNamesUnit3G(
    scene,
    fnPlan,
    fnShiftResult,
    axisEditsToApply,
    tickPlan,
    originPlan,
    pointLabelPlan,
    axisLetterPlan
  );

  const rawBody = scene.body || "";
  const candidateLines = extractCandidateStraightLinesD3(sceneEff, rawBody, cfg);
  const classification = classifyLineNameNodesD3(sceneEff, candidateLines, rawBody, cfg);
  const matching = matchLineNamesToLinesD3(sceneEff, classification, candidateLines, {
    lineNameAction: normalizedAction,
    params: cfg,
  });

  const decisions = [];
  const movedLineNames = [];
  const edits = [];

  for (const classInfo of classification.activeLineNameNodes) {
    const node = sceneEff.nodes.find((nd) => nd.id === classInfo.id);
    if (!node || !node.bbox) continue;

    const ox = node.xshift || 0;
    const oy = node.yshift || 0;
    const matchInfo = matching.assignments.get(node.id);

    // D3-2 Hold 상태일 때도 UI 미리보기/정보 표시를 위해 추천 직선 기준 예상 shift를 참고용으로 계산
    let previewRecShift = null;
    if (matchInfo && !matchInfo.confirmed && matchInfo.previewRecommendedLine) {
      const previewSearch = searchLineNameCandidatesD3(
        node,
        classInfo,
        { matchedLine: matchInfo.previewRecommendedLine },
        sceneEff,
        nodeBoxesById,
        cfg
      );
      if (previewSearch?.candC) {
        previewRecShift = previewSearch.candC.shift;
      }
    }

    if (!matchInfo || !matchInfo.confirmed || !matchInfo.matchedLine) {
      decisions.push({
        id: node.id,
        label: node.label,
        cleanLabel: classInfo.cleanLabel,
        symbol: classInfo.cleanLabel,
        role: "line-name-d3",
        d3Category: classInfo.d3Category,
        d3SubCode: classInfo.d3SubCode,
        subTypeCode: classInfo.d3SubCode,
        kind: node.kind,
        anchorPt: classInfo.anchorPt,
        insideClipScope: classInfo.insideClipScope,
        safetyStage: matchInfo?.safetyStage || "D3-3",
        safetyStageDesc: matchInfo?.safetyStageDesc || "Hold",
        matchMethod: matchInfo?.matchMethod || "hold",
        matchedStrokeIndex: null,
        recommendedStrokeIndex: matchInfo?.recommendedStrokeIndex ?? null,
        swappedStrokeIndex: matchInfo?.swappedStrokeIndex ?? null,
        previewRecommendedShift: previewRecShift,
        action: "keep",
        autoModified: false,
        moved: false,
        reason: matchInfo?.reason || "unconfirmed-line-match-hold",
        oldShift: [ox, oy],
        origShift: [ox, oy],
        newShift: [ox, oy],
        shift: [ox, oy],
      });
      continue;
    }

    const origClr = evaluateLineNameBoxClearancesD3(
      node.id,
      matchInfo.matchedLine,
      matchInfo.nearestEndIndex,
      node.bbox,
      sceneEff,
      nodeBoxesById,
      classInfo.insideClipScope,
      classInfo.enclosingClipRectPt,
      cfg
    );

    const trigger = checkLineNameNeedsMoveD3(origClr, cfg);
    if (!trigger.needsMove) {
      decisions.push({
        id: node.id,
        label: node.label,
        cleanLabel: classInfo.cleanLabel,
        symbol: classInfo.cleanLabel,
        role: "line-name-d3",
        d3Category: classInfo.d3Category,
        d3SubCode: classInfo.d3SubCode,
        subTypeCode: classInfo.d3SubCode,
        kind: node.kind,
        anchorPt: classInfo.anchorPt,
        insideClipScope: classInfo.insideClipScope,
        safetyStage: matchInfo.safetyStage,
        safetyStageDesc: matchInfo.safetyStageDesc,
        matchMethod: matchInfo.matchMethod,
        matchedStrokeIndex: matchInfo.matchedLine.strokeIndex,
        recommendedStrokeIndex: matchInfo.recommendedStrokeIndex ?? matchInfo.matchedLine.strokeIndex,
        swappedStrokeIndex: matchInfo.swappedStrokeIndex ?? null,
        action: "keep",
        autoModified: false,
        moved: false,
        reason: "already-natural-near-visible-tip",
        triggerReasons: [],
        oldShift: [ox, oy],
        origShift: [ox, oy],
        newShift: [ox, oy],
        shift: [ox, oy],
        origClearance: origClr,
      });
      continue;
    }

    const searched = searchLineNameCandidatesD3(
      node,
      classInfo,
      matchInfo,
      sceneEff,
      nodeBoxesById,
      cfg
    );
    const bestC = searched.candC;

    if (!bestC || (bestC.shift[0] === ox && bestC.shift[1] === oy)) {
      decisions.push({
        id: node.id,
        label: node.label,
        cleanLabel: classInfo.cleanLabel,
        symbol: classInfo.cleanLabel,
        role: "line-name-d3",
        d3Category: classInfo.d3Category,
        d3SubCode: classInfo.d3SubCode,
        subTypeCode: classInfo.d3SubCode,
        kind: node.kind,
        anchorPt: classInfo.anchorPt,
        insideClipScope: classInfo.insideClipScope,
        safetyStage: matchInfo.safetyStage,
        safetyStageDesc: matchInfo.safetyStageDesc,
        matchMethod: matchInfo.matchMethod,
        matchedStrokeIndex: matchInfo.matchedLine.strokeIndex,
        recommendedStrokeIndex: matchInfo.recommendedStrokeIndex ?? matchInfo.matchedLine.strokeIndex,
        swappedStrokeIndex: matchInfo.swappedStrokeIndex ?? null,
        action: "keep",
        autoModified: false,
        moved: false,
        reason: "no-safe-candidate-found-hold",
        triggerReasons: trigger.reasons,
        oldShift: [ox, oy],
        origShift: [ox, oy],
        newShift: [ox, oy],
        shift: [ox, oy],
        origClearance: origClr,
      });
      continue;
    }

    nodeBoxesById.set(node.id, bestC.bbox);
    const rawEdit = setShifts(node, bestC.shift[0], bestC.shift[1], { ...PARAMS, shiftRound: 1 });
    const edit = {
      kind: "label-shift",
      subKind: "d3-line-name-shift",
      id: node.id,
      start: rawEdit.start,
      end: rawEdit.end,
      replacement: rawEdit.replacement,
    };
    edits.push(edit);

    const moveRecord = {
      id: node.id,
      label: node.label,
      cleanLabel: classInfo.cleanLabel,
      symbol: classInfo.cleanLabel,
      role: "line-name-d3",
      d3Category: classInfo.d3Category,
      d3SubCode: classInfo.d3SubCode,
      subTypeCode: classInfo.d3SubCode,
      kind: node.kind,
      anchorPt: classInfo.anchorPt,
      insideClipScope: classInfo.insideClipScope,
      safetyStage: matchInfo.safetyStage,
      safetyStageDesc: matchInfo.safetyStageDesc,
      matchMethod: matchInfo.matchMethod,
      matchedStrokeIndex: matchInfo.matchedLine.strokeIndex,
      matchedLineEndsMath: matchInfo.matchedLine.ends.map((e) => e.pointMath),
      matchedLineWasClipped: matchInfo.matchedLine.wasClipped,
      recommendedStrokeIndex: matchInfo.recommendedStrokeIndex ?? matchInfo.matchedLine.strokeIndex,
      swappedStrokeIndex: matchInfo.swappedStrokeIndex ?? null,
      action: "move-line-name",
      autoModified: true,
      moved: true,
      strategy: searched.strategy,
      placementTag: bestC.placementTag || bestC.mode,
      triggerReasons: trigger.reasons,
      oldShift: [ox, oy],
      origShift: [ox, oy],
      newShift: bestC.shift,
      shift: bestC.shift,
      deltaShift: bestC.deltaShift,
      deltaShiftNormPt: bestC.deltaShiftNormPt,
      renderedMovePt: bestC.renderedMovePt,
      oldBbox: node.bbox,
      newBbox: bestC.bbox,
      bbox: bestC.bbox,
      origClearance: origClr,
      newClearance: bestC.clearance,
      reason: `직선 이름(${classInfo.cleanLabel})을 대응 직선(#${matchInfo.matchedLine.strokeIndex}) 가시 끝점 인근 열린 방향(shift=[${bestC.shift[0]}, ${bestC.shift[1]}]pt)으로 배치`,
      edit,
    };

    decisions.push(moveRecord);
    movedLineNames.push(moveRecord);
  }

  return {
    enabled: true,
    lineNameAction: normalizedAction,
    safetyTier: matching.safetyTier,
    classification: {
      summaryCounts: classification.summaryCounts,
      items: classification.items.map(({ node, ...rest }) => rest),
    },
    multiLineAnalysis: matching.multiLineAnalysis,
    decisions,
    movedLineNames,
    edits,
  };
}
