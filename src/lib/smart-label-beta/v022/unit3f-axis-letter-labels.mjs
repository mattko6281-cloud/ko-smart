// ============================================================================
// Unit 3-F (D-2): 축 문자 및 기호 눈금(a, b, c, \alpha, \beta 등) 겹침 해소 엔진 (v0.2.2 Beta)
// ============================================================================
// 로컬 통합 정책 (RC1):
//  1) 기본값은 OFF(enableAxisLetterOverlapFix: false / enableUnit3F: false)이며,
//     OFF 상태에서는 기존 엔진(821d22c)과 단 1바이트의 차이도 발생하지 않는다.
//  2) 기존 전담 유닛(함수식 Unit 2 / Type 2, 숫자·π 눈금 Unit 3-B, 원점 O Unit 3-D,
//     대문자 점 이름 Unit 3-E) 관할 노드는 선행 분리하여 절대 건드리지 않는다.
//  3) 소문자 및 기호 라벨을 4대 세부 유형(A, B, C, D)으로 분류한다:
//     - [유형 A] 독립 \node 형태의 문자형 눈금 (예: CASE-010 a)
//     - [유형 B] 보조선(\draw[dashed])에 연결된 인라인 문자형 눈금 (예: CASE-010 b, c, d, e / CASE-016 c)
//     - [유형 C] 그리스 문자(\alpha, \beta, \gamma) 또는 문자+수학기호 결합 눈금 (예: CASE-006/007/008/017, CASE-005 c\pi)
//     - [유형 D] 직선이나 영역의 독립 이름 (예: CASE-009/O03/CASE-018 l, m) -> 후속 D-3 연구 대상으로 100% Hold
//  4) 유형 A, B, C 중 실제 곡선·보조선·좌표축·타 라벨과 충돌하는 축 문자 라벨에 대해서만
//     기준 좌표와 점 마커, 보조선 인라인 구조를 100% 보존하면서 xshift/yshift 미세 조정으로
//     평가원 스타일 자연 배치(Candidate C)를 산출한다.
//  5) 이미 자연스러운 눈금(CASE-010의 b,c,d,e 및 CASE-005, 007, 008, 016, 017, O01, O02)은 100% 원본 위치 유지(Hold)한다.
// ============================================================================

import {
  bboxGapRect,
  bboxPtDist,
  bboxFromShift,
  setShifts,
} from "../../../../experiments/smart-label-prototype-v021/src/algorithm.mjs";
import { minDistPolylines } from "../../../../experiments/smart-label-engine/src/geometry.mjs";
import { DEFAULT_UNIT2_FLAGS } from "./unit2-expression-matching.mjs";
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

export const DEFAULT_UNIT3F_AXIS_LETTER_PARAMS = {
  // 축 귀속 판정 허용 오차 (TeX pt)
  maxAxisCoordSnapDistPt: 3.5,        // 기준 좌표(anchorPt)가 x축(y=0) 또는 y축(x=0) 위에 있다고 판정하는 최대 거리
  minOriginSeparationPt: 4.0,         // 원점(0,0)으로부터 최소 거리

  // 충돌 판정 임계값 (원본이 이미 자연스러운지 판정하는 게이트)
  triggerMainStrokeOverlapPt: -0.15,  // 실선 곡선/직선과 이 값 미만이면 충돌로 판정
  triggerDashedStrokeOverlapPt: -0.15,// 점선 보조선과 이 값 미만이면 충돌로 판정
  triggerAxisOverlapPt: -0.15,        // 좌표축과 이 값 미만이면 충돌로 판정
  triggerNodeOverlapPt: 0.20,         // 타 라벨과 이 값 이하이면 겹침으로 판정

  // 축 방향 접선 미세 이동(Tangential Shift) 탐색 범위 및 안전 기준
  tangentialMaxDeltaShiftPt: 7.5,     // TikZ xshift/yshift 최대 변경 폭 (pt)
  tangentialStepPt: 0.5,              // 탐색 간격 (0.5pt)
  maxAllowedAnchorDistPt: 6.2,        // 기준 좌표(또는 점 마커)로부터 라벨 bbox까지 최대 허용 거리 (소속감 유지)
  maxAllowedTickEdgeOverhangPt: 3.2,  // 기준 좌표로부터 가까운 쪽 라벨 모서리가 벗어날 수 있는 최대 수평/수직 거리
  minSafeMainStrokeMinMovePt: 0.50,   // Candidate B 최소 이동 시 실선 최소 간격
  minSafeMainStrokeNaturalPt: 1.65,   // Candidate C 평가원 자연 배치 시 실선 최소 간격
  idealMainStrokeNaturalPt: 2.20,     // Candidate C 이상적 실선 여유 간격
  minSafeDashedStrokePt: 0.80,        // 점선 보조선과의 최소 안전 간격
  minSafeAxisGapPt: 3.00,             // 축과의 최소 안전 간격
  minSafeNodeGapPt: 2.50,             // 타 눈금/라벨과의 최소 안전 간격

  // 보조선 반대편 축 넘김(Normal Axis Flip) 탐색 범위 및 안전 기준
  flipShiftMinPt: 7.0,                // 축 반대편 이동 최소 shift (TikZ pt)
  flipShiftMaxPt: 16.0,               // 축 반대편 이동 최대 shift (TikZ pt)
  flipStepPt: 1.0,                    // 축 반대편 이동 탐색 간격 (1.0pt)
  minSafeFlipAxisGapPt: 0.80,         // Candidate B 축 반대편 최소 이동 시 축/보조선 최소 간격
  idealFlipAxisGapMinPt: 5.00,        // Candidate C 축 반대편 자연 배치 시 이상적 축 간격 하한 (기존 눈금과 시각적 통일)
  idealFlipAxisGapMaxPt: 6.80,        // Candidate C 축 반대편 자연 배치 시 이상적 축 간격 상한
};

const GREEK_LETTER_RE =
  /^\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega)$/i;

const LINE_NAME_CANDIDATE_RE = /^[lmn]$/;

/**
 * 소문자/기호 라벨 문자열의 세부 기호 특성을 분석한다.
 * @param {string} rawLabel
 */
export function parseAxisLetterSymbolD2(rawLabel) {
  const base = parseGeneralLabelSymbolUnit3E(rawLabel);
  let s = String(rawLabel || "").trim();
  if (s.startsWith("$") && s.endsWith("$")) s = s.slice(1, -1).trim();
  s = s
    .replace(/\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle)\b/g, "")
    .replace(/\\(?:rm|mathrm|mathit|mathbf|mathsf|mathcal)\b/g, "")
    .replace(/[{}]/g, "")
    .trim();

  const isSingleLowercaseLatin = /^[a-z]$/.test(s);
  const isSingleGreek = GREEK_LETTER_RE.test(s);
  const hasMathOrGreekCombo =
    !isSingleLowercaseLatin &&
    !base.isUppercaseLetter &&
    !isPureTickValueLabel(rawLabel) &&
    (/[a-zA-Z]|\\(?:alpha|beta|gamma|delta|theta|pi|sqrt|frac|cdot)/.test(s));

  return {
    ...base,
    stripped: s,
    isSingleLowercaseLatin,
    isSingleGreek,
    hasMathOrGreekCombo,
    isLineNameCandidateLetter: LINE_NAME_CANDIDATE_RE.test(s),
  };
}

/**
 * 인라인 노드가 속한 \draw[dashed] 문장의 시작점~끝점 방향을 분석하여
 * 보조선이 축의 어느 쪽(위/아래/왼쪽/오른쪽)에서 들어오는지 판별한다.
 */
function analyzeInlineProjectionStrokeDirection(node, scene) {
  if (node?.kind !== "inline") return null;
  const dirOpt = extractNodeDirectionOptionUnit3E(node.optionsRaw);
  let anchor = getResolvedNodeAnchorPtUnit3E(node).pt;
  if (!anchor && node.bbox) {
    const cx = (node.bbox.x0 + node.bbox.x1) / 2;
    const cy = (node.bbox.y0 + node.bbox.y1) / 2;
    if (dirOpt === "below" || dirOpt === "above") anchor = [cx, 0];
    else if (dirOpt === "left" || dirOpt === "right") anchor = [0, cy];
    else anchor = [cx, cy];
  }
  if (!anchor) return null;

  let bestStroke = null;
  let bestEndDist = Infinity;

  for (const s of scene.strokes || []) {
    if (!s || s.kind === "axis" || !Array.isArray(s.pts) || s.pts.length < 2) continue;
    const isDashed = s.kind === "dashed" || /dashed|dotted/.test(s.stmt?.raw || "");
    if (!isDashed) continue;
    for (let i = 0; i < s.pts.length; i++) {
      const d = Math.hypot(s.pts[i][0] - anchor[0], s.pts[i][1] - anchor[1]);
      if (d < bestEndDist) {
        bestEndDist = d;
        bestStroke = { stroke: s, endIdx: i };
      }
    }
  }

  if (!bestStroke || bestEndDist > 6.0) return null;
  const { stroke, endIdx } = bestStroke;
  const otherPt =
    endIdx > 0
      ? stroke.pts[0]
      : stroke.pts[stroke.pts.length - 1];
  const dx = otherPt[0] - anchor[0];
  const dy = otherPt[1] - anchor[1];

  return {
    strokeIndex: stroke.index,
    anchorPt: anchor,
    sourcePt: otherPt,
    dxPt: r2(dx),
    dyPt: r2(dy),
    comesFromAbove: dy > 3.0,
    comesFromBelow: dy < -3.0,
    comesFromRight: dx > 3.0,
    comesFromLeft: dx < -3.0,
  };
}

/**
 * 장면 내 모든 소문자·기호·눈금 노드를 스캔하여
 * D-2의 4대 세부 유형(유형 A, B, C, D) 및 타 유닛 보호 대상으로 정밀 분류한다.
 */
export function classifyAxisLetterNodesD2(
  scene,
  rawTikz = "",
  params = DEFAULT_UNIT3F_AXIS_LETTER_PARAMS
) {
  const cfg = { ...DEFAULT_UNIT3F_AXIS_LETTER_PARAMS, ...(params || {}) };
  if (!scene || !Array.isArray(scene.nodes)) {
    return { items: [], byNodeId: new Map(), summaryCounts: {} };
  }

  resolveSceneSymbolicCoordinatesUnit3A(scene, DEFAULT_UNIT2_FLAGS);

  const markers = scene.nodes
    .filter((n) => n.role === "marker")
    .map((m) => {
      const { pt } = getResolvedNodeAnchorPtUnit3E(m);
      const center =
        pt ||
        (m.bbox ? [(m.bbox.x0 + m.bbox.x1) / 2, (m.bbox.y0 + m.bbox.y1) / 2] : null);
      return { marker: m, center };
    })
    .filter((m) => Array.isArray(m.center));

  const items = [];
  const byNodeId = new Map();
  const summaryCounts = {
    SUBTYPE_A_STANDALONE_LETTER_TICK: 0,
    SUBTYPE_B_INLINE_PROJECTION_LETTER_TICK: 0,
    SUBTYPE_C_GREEK_OR_SYMBOLIC_MATH_TICK: 0,
    SUBTYPE_D_STANDALONE_LINE_OR_REGION_NAME: 0,
    PROTECTED_UNIT3B_NUMERIC_TICK: 0,
    PROTECTED_UNIT3E_UPPERCASE_NODE: 0,
    PROTECTED_SPECIAL_OR_MARKER: 0,
  };

  for (const n of scene.nodes) {
    if (n.role === "marker" || n.role === "function" || n.role === "origin" || n.role === "axisLabel") {
      const entry = {
        id: n.id,
        label: n.label || "",
        role: n.role,
        kind: n.kind,
        d2Category: "PROTECTED_SPECIAL_OR_MARKER",
        subTypeCode: n.role === "marker" ? "MARKER" : `PROTECTED_${n.role.toUpperCase()}`,
        eligibleForD2: false,
        policy: "STRICT_PROTECT_OTHER_UNIT",
        reason: "전담 유닛(함수식 / 원점 O / 축 이름 / 점 마커) 보호 대상",
      };
      items.push(entry);
      byNodeId.set(n.id, entry);
      summaryCounts.PROTECTED_SPECIAL_OR_MARKER++;
      continue;
    }

    const sym = parseAxisLetterSymbolD2(n.label);
    const { pt: resolvedPt, by: anchorBy } = getResolvedNodeAnchorPtUnit3E(n);
    const dirOpt = extractNodeDirectionOptionUnit3E(n.optionsRaw);

    // 1) 대문자 점 이름 / 꼭짓점 / 영역 내부 라벨 (Unit 3-E 관할) 또는 원점 O
    if (sym.isUppercaseLetter || sym.isOriginLetterO) {
      const entry = {
        id: n.id,
        label: n.label,
        cleanLabel: sym.clean,
        role: n.role,
        kind: n.kind,
        d2Category: "PROTECTED_UNIT3E_UPPERCASE_NODE",
        subTypeCode: "UNIT3E_UPPERCASE",
        eligibleForD2: false,
        policy: "STRICT_PROTECT_UNIT3E",
        reason: `대문자 라벨(${sym.clean}) — Unit 3-E(점 이름/꼭짓점/영역 라벨) 관할이므로 D-2에서 제외`,
      };
      items.push(entry);
      byNodeId.set(n.id, entry);
      summaryCounts.PROTECTED_UNIT3E_UPPERCASE_NODE++;
      continue;
    }

    // 2) 순수 숫자 및 순수 π 분수 눈금 (Unit 3-B 관할)
    if (isPureTickValueLabel(n.label)) {
      const entry = {
        id: n.id,
        label: n.label,
        cleanLabel: sym.clean,
        role: n.role,
        kind: n.kind,
        d2Category: "PROTECTED_UNIT3B_NUMERIC_TICK",
        subTypeCode: "UNIT3B_NUMERIC_OR_PI_TICK",
        eligibleForD2: false,
        policy: "STRICT_PROTECT_UNIT3B",
        reason: `숫자/π 눈금(${sym.clean}) — 기존 Unit 3-B 눈금 전용 엔진 관할이므로 D-2에서 제외`,
      };
      items.push(entry);
      byNodeId.set(n.id, entry);
      summaryCounts.PROTECTED_UNIT3B_NUMERIC_TICK++;
      continue;
    }

    const projInfo = analyzeInlineProjectionStrokeDirection(n, scene);
    let anchorPt = resolvedPt || projInfo?.anchorPt || null;
    if (!anchorPt && n.kind === "inline" && n.bbox) {
      const cx = (n.bbox.x0 + n.bbox.x1) / 2;
      const cy = (n.bbox.y0 + n.bbox.y1) / 2;
      if (dirOpt === "below" || dirOpt === "above") anchorPt = [r2(cx), 0];
      else if (dirOpt === "left" || dirOpt === "right") anchorPt = [0, r2(cy)];
    }

    const onXAxis =
      anchorPt !== null &&
      Boolean(scene?.axes?.x) &&
      Math.abs(anchorPt[1]) <= cfg.maxAxisCoordSnapDistPt &&
      Math.hypot(anchorPt[0], anchorPt[1]) >= cfg.minOriginSeparationPt;
    const onYAxis =
      anchorPt !== null &&
      Boolean(scene?.axes?.y) &&
      Math.abs(anchorPt[0]) <= cfg.maxAxisCoordSnapDistPt &&
      Math.hypot(anchorPt[0], anchorPt[1]) >= cfg.minOriginSeparationPt;
    const axisName = onXAxis ? "x" : onYAxis ? "y" : null;

    let matchedMarker = null;
    let minMarkerDist = Infinity;
    if (anchorPt) {
      for (const rm of markers) {
        const d = Math.hypot(rm.center[0] - anchorPt[0], rm.center[1] - anchorPt[1]);
        if (d < minMarkerDist) {
          minMarkerDist = d;
          matchedMarker = rm;
        }
      }
    }
    const nearbyMarker = minMarkerDist <= 2.5 ? matchedMarker : null;

    const lineSpanText =
      rawTikz && Array.isArray(n.span)
        ? rawTikz
            .slice(
              Math.max(0, rawTikz.lastIndexOf("\n", n.span[0]) + 1),
              rawTikz.indexOf("\n", n.span[1]) >= 0
                ? rawTikz.indexOf("\n", n.span[1])
                : rawTikz.length
            )
            .trim()
        : "";

    // 3) [유형 D] 직선이나 영역의 독립 이름 (예: l, m, n 등 축 위에 있지 않은 독립 소문자 라벨)
    const isStandaloneOffAxis = n.kind === "standalone" && axisName === null;
    const isLineNameOnRightOrDiag =
      n.kind === "standalone" &&
      sym.isLineNameCandidateLetter &&
      (!axisName || dirOpt === "right" || dirOpt === "above right" || dirOpt === "below right");

    if (isStandaloneOffAxis || isLineNameOnRightOrDiag) {
      const entry = {
        id: n.id,
        label: n.label,
        cleanLabel: sym.stripped,
        role: n.role,
        kind: n.kind,
        d2Category: "SUBTYPE_D_STANDALONE_LINE_OR_REGION_NAME",
        subTypeCode: "D:line-or-region-independent-name",
        eligibleForD2: false,
        policy: "DEFER_TO_D3_LINE_NAME_RESEARCH",
        anchorPt,
        dirOption: dirOpt,
        sourceLine: lineSpanText,
        reason: `직선/영역의 독립 이름 라벨(${sym.stripped}) — 축 눈금이 아니므로 후속 D-3 연구 대상으로 분리 및 100% Hold`,
      };
      items.push(entry);
      byNodeId.set(n.id, entry);
      summaryCounts.SUBTYPE_D_STANDALONE_LINE_OR_REGION_NAME++;
      continue;
    }

    // 4) [유형 C] 그리스 문자(\alpha, \beta, \gamma 등) 또는 문자+수학기호 결합 눈금(c\pi 등)
    if (sym.isSingleGreek || sym.hasMathOrGreekCombo) {
      const entry = {
        id: n.id,
        label: n.label,
        cleanLabel: sym.stripped,
        role: n.role,
        kind: n.kind,
        d2Category: "SUBTYPE_C_GREEK_OR_SYMBOLIC_MATH_TICK",
        subTypeCode:
          n.kind === "inline"
            ? "C-inline:greek-or-symbolic-projection-tick"
            : "C-standalone:greek-or-symbolic-axis-tick",
        eligibleForD2: Boolean(axisName),
        policy: axisName ? "ACTIVE_D2_SYMBOLIC_TICK" : "HOLD_AMBIGUOUS_AXIS",
        axisName,
        anchorPt,
        anchorBy,
        dirOption: dirOpt,
        projectionInfo: projInfo,
        nearbyMarkerId: nearbyMarker?.marker?.id || null,
        nearbyMarkerCenterPt: nearbyMarker?.center || null,
        sourceLine: lineSpanText,
        reason:
          n.kind === "inline"
            ? `보조선에 연결된 그리스 문자/복합 기호 인라인 눈금(${sym.stripped}, ${axisName || "?"}축)`
            : `독립 node 형태의 그리스 문자/복합 기호 눈금(${sym.stripped}, ${axisName || "?"}축)`,
      };
      items.push(entry);
      byNodeId.set(n.id, entry);
      summaryCounts.SUBTYPE_C_GREEK_OR_SYMBOLIC_MATH_TICK++;
      continue;
    }

    // 5) [유형 B] 보조선에 연결된 인라인 소문자 눈금 (예: CASE-010 b, c, d, e / CASE-016 c)
    if (n.kind === "inline" && sym.isSingleLowercaseLatin) {
      const entry = {
        id: n.id,
        label: n.label,
        cleanLabel: sym.stripped,
        role: n.role,
        kind: n.kind,
        d2Category: "SUBTYPE_B_INLINE_PROJECTION_LETTER_TICK",
        subTypeCode: "B:inline-projection-letter-tick",
        eligibleForD2: Boolean(axisName),
        policy: axisName ? "ACTIVE_D2_INLINE_LETTER_TICK" : "HOLD_AMBIGUOUS_AXIS",
        axisName,
        anchorPt,
        anchorBy,
        dirOption: dirOpt,
        projectionInfo: projInfo,
        nearbyMarkerId: nearbyMarker?.marker?.id || null,
        nearbyMarkerCenterPt: nearbyMarker?.center || null,
        sourceLine: lineSpanText,
        reason: `보조선(\\draw[dashed])에 연결된 인라인 소문자 눈금(${sym.stripped}, ${axisName || "?"}축)`,
      };
      items.push(entry);
      byNodeId.set(n.id, entry);
      summaryCounts.SUBTYPE_B_INLINE_PROJECTION_LETTER_TICK++;
      continue;
    }

    // 6) [유형 A] 독립 \node 형태의 소문자 문자형 눈금 (예: CASE-010 \node[below, xshift=-2pt] at (-2,0) {$a$};)
    if (n.kind === "standalone" && sym.isSingleLowercaseLatin && axisName) {
      const entry = {
        id: n.id,
        label: n.label,
        cleanLabel: sym.stripped,
        role: n.role,
        kind: n.kind,
        d2Category: "SUBTYPE_A_STANDALONE_LETTER_TICK",
        subTypeCode: "A:standalone-axis-letter-tick",
        eligibleForD2: true,
        policy: "ACTIVE_D2_STANDALONE_LETTER_TICK",
        axisName,
        anchorPt,
        anchorBy,
        dirOption: dirOpt,
        projectionInfo: null,
        nearbyMarkerId: nearbyMarker?.marker?.id || null,
        nearbyMarkerCenterPt: nearbyMarker?.center || null,
        sourceLine: lineSpanText,
        reason: `독립 \\node 형태의 ${axisName}축 소문자 눈금(${sym.stripped})${nearbyMarker ? ` — 기준 좌표에 교점 마커(${nearbyMarker.marker.id}) 공존` : ""}`,
      };
      items.push(entry);
      byNodeId.set(n.id, entry);
      summaryCounts.SUBTYPE_A_STANDALONE_LETTER_TICK++;
      continue;
    }

    // 그 외 미분류 소문자/기호 노드는 안전 보류
    const fallbackEntry = {
      id: n.id,
      label: n.label,
      cleanLabel: sym.stripped,
      role: n.role,
      kind: n.kind,
      d2Category: "SUBTYPE_D_STANDALONE_LINE_OR_REGION_NAME",
      subTypeCode: "D-fallback:unclassified-lowercase-hold",
      eligibleForD2: false,
      policy: "HOLD_UNCLASSIFIED_LOWERCASE",
      anchorPt,
      dirOption: dirOpt,
      sourceLine: lineSpanText,
      reason: `수학적 역할이 불명확한 소문자/기호 노드(${sym.stripped}) — 안전 보류(Hold)`,
    };
    items.push(fallbackEntry);
    byNodeId.set(n.id, fallbackEntry);
    summaryCounts.SUBTYPE_D_STANDALONE_LINE_OR_REGION_NAME++;
  }

  return {
    items,
    byNodeId,
    summaryCounts,
  };
}

/**
 * 함수식(Unit 2), 끝점 연장(Unit 3-C), 눈금(Unit 3-B), 원점 O(Unit 3-D), 대문자 점 이름(Unit 3-E), 축 변경까지
 * 모두 반영된 유효 장면 상태(strokesEff, nodeBoxesById, axesEff)를 구성한다.
 */
function buildEffectiveSceneStateBeforeAxisLetterUnit3F(
  scene,
  fnPlan,
  fnShiftResult,
  axisEditsToApply = [],
  tickPlan = null,
  originPlan = null,
  pointLabelPlan = null
) {
  const { xU = 28.45, yU = 28.45 } = scene.units || {};

  let xAxisNew = scene.axes?.x ? [scene.axes.x.from, scene.axes.x.to] : null;
  let yAxisNew = scene.axes?.y ? [scene.axes.y.from, scene.axes.y.to] : null;
  let dxAxisEndPt = 0;
  let dyAxisEndPt = 0;

  for (const ae of axisEditsToApply || []) {
    if (ae.kind === "axis-x" && Array.isArray(ae.new) && Array.isArray(ae.old)) {
      xAxisNew = ae.new;
      dxAxisEndPt = (ae.new[1] - ae.old[1]) * xU;
    } else if (ae.kind === "axis-y" && Array.isArray(ae.new) && Array.isArray(ae.old)) {
      yAxisNew = ae.new;
      dyAxisEndPt = (ae.new[1] - ae.old[1]) * yU;
    }
  }

  const strokesEff = (scene.strokes || []).map((s) => {
    if (s.kind !== "axis" || !Array.isArray(s.pts) || s.pts.length < 2) return s;
    const isHoriz = Math.abs(s.pts[0][1] - s.pts[s.pts.length - 1][1]) < 1e-6;
    if (isHoriz && xAxisNew) {
      return {
        ...s,
        pts: [
          [Math.min(xAxisNew[0], xAxisNew[1]) * xU, s.pts[0][1]],
          [Math.max(xAxisNew[0], xAxisNew[1]) * xU, s.pts[0][1]],
        ],
      };
    }
    if (!isHoriz && yAxisNew) {
      return {
        ...s,
        pts: [
          [s.pts[0][0], Math.min(yAxisNew[0], yAxisNew[1]) * yU],
          [s.pts[0][0], Math.max(yAxisNew[0], yAxisNew[1]) * yU],
        ],
      };
    }
    return s;
  });

  const fnMovedShiftById = new Map();
  for (const r of fnShiftResult?.report || []) {
    if (r && r.id && Array.isArray(r.newShift)) {
      fnMovedShiftById.set(r.id, r.newShift);
    }
  }
  const fnPlacedBoxById = new Map();
  for (const p of fnPlan?.placements || []) {
    if (p && p.id && p.action === "move" && p.bbox) {
      fnPlacedBoxById.set(p.id, p.bbox);
    }
  }
  const tickMovedBoxById = new Map();
  for (const t of tickPlan?.movedTicks || []) {
    if (t && t.id && t.bbox) {
      tickMovedBoxById.set(t.id, t.bbox);
    }
  }
  const originMovedBoxById = new Map();
  for (const o of originPlan?.movedOrigins || []) {
    if (o && o.id && o.bbox) {
      originMovedBoxById.set(o.id, o.bbox);
    }
  }
  const pointLabelMovedBoxById = new Map();
  for (const pl of pointLabelPlan?.movedPointLabels || []) {
    if (pl && pl.id && pl.bbox) {
      pointLabelMovedBoxById.set(pl.id, pl.bbox);
    }
  }

  const nodeBoxesById = new Map();
  for (const n of scene.nodes || []) {
    if (!n || !n.bbox || n.role === "marker") continue;
    if (pointLabelMovedBoxById.has(n.id)) {
      nodeBoxesById.set(n.id, { ...pointLabelMovedBoxById.get(n.id) });
    } else if (originMovedBoxById.has(n.id)) {
      nodeBoxesById.set(n.id, { ...originMovedBoxById.get(n.id) });
    } else if (tickMovedBoxById.has(n.id)) {
      nodeBoxesById.set(n.id, { ...tickMovedBoxById.get(n.id) });
    } else if (fnMovedShiftById.has(n.id)) {
      nodeBoxesById.set(n.id, bboxFromShift(n, fnMovedShiftById.get(n.id)));
    } else if (fnPlacedBoxById.has(n.id)) {
      nodeBoxesById.set(n.id, { ...fnPlacedBoxById.get(n.id) });
    } else if (n.role === "axisLabel" && n.kind === "inline") {
      if ((n.trimmed === "x" || n.trimmed === "\\theta" || n.trimmed === "t") && dxAxisEndPt !== 0) {
        nodeBoxesById.set(n.id, {
          x0: n.bbox.x0 + dxAxisEndPt,
          x1: n.bbox.x1 + dxAxisEndPt,
          y0: n.bbox.y0,
          y1: n.bbox.y1,
        });
      } else if (n.trimmed === "y" && dyAxisEndPt !== 0) {
        nodeBoxesById.set(n.id, {
          x0: n.bbox.x0,
          x1: n.bbox.x1,
          y0: n.bbox.y0 + dyAxisEndPt,
          y1: n.bbox.y1 + dyAxisEndPt,
        });
      } else {
        nodeBoxesById.set(n.id, { ...n.bbox });
      }
    } else {
      nodeBoxesById.set(n.id, { ...n.bbox });
    }
  }

  const axesEff = {
    x: xAxisNew ? { ...(scene.axes?.x || {}), from: xAxisNew[0], to: xAxisNew[1] } : scene.axes?.x || null,
    y: yAxisNew ? { ...(scene.axes?.y || {}), from: yAxisNew[0], to: yAxisNew[1] } : scene.axes?.y || null,
  };

  return {
    sceneEff: {
      ...scene,
      strokes: strokesEff,
      axes: axesEff,
    },
    nodeBoxesById,
  };
}

/**
 * 축 문자 라벨 바운딩 박스(bb)의 실선 곡선/직선, 점선 보조선, 좌표축, 타 라벨, 기준 좌표와의 정밀 간격을 측정한다.
 */
export function evaluateAxisLetterBoxClearancesD2(
  nodeId,
  anchorPt,
  nearbyMarkerId,
  bb,
  scene,
  nodeBoxesById
) {
  const poly = [rectPoly(bb)];
  let minMainStrokeClearance = Infinity;
  let minDashedStrokeClearance = Infinity;
  let minAxisClearance = Infinity;
  const collidingStrokes = [];

  for (const s of scene.strokes || []) {
    if (!s || !Array.isArray(s.pts) || s.pts.length < 2) continue;
    const isDashed = s.kind === "dashed" || /dashed|dotted/.test(s.stmt?.raw || "");
    const hw = s.halfWidth || (s.kind === "axis" ? 0.5 : isDashed ? 0.4 : 0.75);
    const c = minDistPolylines(poly, [{ pts: s.pts, closed: false }]) - hw;

    if (s.kind === "axis") {
      if (c < minAxisClearance) minAxisClearance = c;
      if (c < -0.15) {
        collidingStrokes.push({ index: s.index, kind: "axis", clearancePt: r2(c) });
      }
    } else if (isDashed) {
      if (c < minDashedStrokeClearance) minDashedStrokeClearance = c;
      if (c < -0.15) {
        collidingStrokes.push({ index: s.index, kind: "dashed-projection", clearancePt: r2(c) });
      }
    } else {
      if (c < minMainStrokeClearance) minMainStrokeClearance = c;
      if (c < -0.15) {
        collidingStrokes.push({ index: s.index, kind: "main-curve-or-line", clearancePt: r2(c) });
      }
    }
  }

  let minNodeGap = Infinity;
  let minProtectedNodeGap = Infinity;
  const collidingNodes = [];

  for (const other of scene.nodes || []) {
    if (!other || other.id === nodeId) continue;
    if (other.role === "marker") {
      if (other.id !== nearbyMarkerId && other.bbox) {
        const g = bboxGapRect(bb, other.bbox);
        if (g < minNodeGap) minNodeGap = g;
      }
      continue;
    }
    const otherBb = (nodeBoxesById && nodeBoxesById.get(other.id)) || other.bbox;
    if (!otherBb) continue;
    const g = bboxGapRect(bb, otherBb);
    if (g < minNodeGap) minNodeGap = g;
    if (other.role === "function" || other.role === "origin" || other.role === "axisLabel") {
      if (g < minProtectedNodeGap) minProtectedNodeGap = g;
    }
    if (g <= 0.20) {
      collidingNodes.push({ id: other.id, label: other.label, role: other.role, gapPt: r2(g) });
    }
  }

  const anchorDistPt = anchorPt ? r2(bboxPtDist(anchorPt, bb)) : null;
  const tickEdgeOverhangXPt = anchorPt
    ? r2(Math.max(bb.x0 - anchorPt[0], 0, anchorPt[0] - bb.x1))
    : 0;
  const tickEdgeOverhangYPt = anchorPt
    ? r2(Math.max(bb.y0 - anchorPt[1], 0, anchorPt[1] - bb.y1))
    : 0;

  return {
    minMainStrokeClearance: r2(minMainStrokeClearance),
    minDashedStrokeClearance: r2(minDashedStrokeClearance),
    minOverallStrokeClearance: r2(Math.min(minMainStrokeClearance, minDashedStrokeClearance)),
    minAxisClearance: r2(minAxisClearance),
    minNodeGap: r2(minNodeGap),
    minProtectedNodeGap: r2(minProtectedNodeGap),
    anchorDistPt,
    tickEdgeOverhangXPt,
    tickEdgeOverhangYPt,
    collidingStrokes,
    collidingNodes,
  };
}

/**
 * 원본 축 문자 노드가 실제로 충돌 상태인지(자동 이동이 필요한지) 판정한다.
 * - 이미 자연스러운 눈금은 절대 이동하지 않는다.
 */
export function checkAxisLetterNeedsMoveD2(origClr, params = DEFAULT_UNIT3F_AXIS_LETTER_PARAMS) {
  const cfg = { ...DEFAULT_UNIT3F_AXIS_LETTER_PARAMS, ...(params || {}) };
  const hasMainCollision = origClr.minMainStrokeClearance < cfg.triggerMainStrokeOverlapPt;
  const hasDashedCollision = origClr.minDashedStrokeClearance < cfg.triggerDashedStrokeOverlapPt;
  const hasAxisCollision = origClr.minAxisClearance < cfg.triggerAxisOverlapPt;
  const hasNodeCollision = origClr.minNodeGap <= cfg.triggerNodeOverlapPt;

  const reasons = [];
  if (hasMainCollision) reasons.push(`main-curve-collision(${origClr.minMainStrokeClearance}pt)`);
  if (hasDashedCollision) reasons.push(`dashed-projection-collision(${origClr.minDashedStrokeClearance}pt)`);
  if (hasAxisCollision) reasons.push(`axis-collision(${origClr.minAxisClearance}pt)`);
  if (hasNodeCollision) reasons.push(`node-overlap(${origClr.minNodeGap}pt)`);

  return {
    needsMove: reasons.length > 0,
    hasMainCollision,
    hasDashedCollision,
    hasAxisCollision,
    hasNodeCollision,
    reasons,
  };
}

/**
 * 충돌이 발생한 축 문자 노드(유형 A, B, C)에 대해
 * 1) 축 접선 방향 미세 이동 후보(Tangential Micro-Shift: x축 눈금이면 좌/우 xshift, y축 눈금이면 상/하 yshift)와
 * 2) 보조선 역방향 침범 시 축 반대편 이동 후보(Normal Axis Flip: 인라인 보조선과 같은 쪽에 배치되어 보조선이 글자를 관통하는 경우)
 * 를 탐색하여 Candidate B(최소 이동)와 Candidate C(평가원 자연 배치)를 산출한다.
 */
export function searchAxisLetterCandidatesD2(
  node,
  info,
  scene,
  nodeBoxesById,
  params = DEFAULT_UNIT3F_AXIS_LETTER_PARAMS
) {
  const cfg = { ...DEFAULT_UNIT3F_AXIS_LETTER_PARAMS, ...(params || {}) };
  const ox = node.xshift || 0;
  const oy = node.yshift || 0;
  const anchorPt = info.anchorPt;
  const origClr = evaluateAxisLetterBoxClearancesD2(
    node.id,
    anchorPt,
    info.nearbyMarkerId,
    node.bbox,
    scene,
    nodeBoxesById
  );

  const tangentialCandidates = [];

  const isXAxis = info.axisName === "x";
  const pInfo = info.projectionInfo;
  const hasSameSideProjectionCollision =
    Boolean(pInfo) &&
    origClr.minDashedStrokeClearance < cfg.triggerDashedStrokeOverlapPt &&
    ((isXAxis &&
      ((pInfo.comesFromBelow && info.dirOption === "below") ||
        (pInfo.comesFromAbove && info.dirOption === "above"))) ||
      (!isXAxis &&
        ((pInfo.comesFromLeft && info.dirOption === "left") ||
          (pInfo.comesFromRight && info.dirOption === "right"))));

  // [탐색 1] 축 방향 접선 미세 이동 (Tangential Micro-Shift)
  const maxDelta = cfg.tangentialMaxDeltaShiftPt;
  const step = cfg.tangentialStepPt;

  if (!hasSameSideProjectionCollision) {
    for (let delta = -maxDelta; delta <= maxDelta + 1e-9; delta = r2(delta + step)) {
      if (Math.abs(delta) < 1e-6) continue;
      const candShift = isXAxis ? [r2(ox + delta), oy] : [ox, r2(oy + delta)];
      const candBb = bboxFromShift(node, candShift);
      const clr = evaluateAxisLetterBoxClearancesD2(
        node.id,
        anchorPt,
        info.nearbyMarkerId,
        candBb,
        scene,
        nodeBoxesById
      );

      const overhangPt = isXAxis ? clr.tickEdgeOverhangXPt : clr.tickEdgeOverhangYPt;

      if (clr.anchorDistPt !== null && clr.anchorDistPt > cfg.maxAllowedAnchorDistPt) continue;
      if (overhangPt > cfg.maxAllowedTickEdgeOverhangPt) continue;
      if (clr.minDashedStrokeClearance < cfg.minSafeDashedStrokePt) continue;
      if (clr.minAxisClearance < cfg.minSafeAxisGapPt) continue;
      if (clr.minNodeGap < cfg.minSafeNodeGapPt) continue;
      if (clr.minMainStrokeClearance < cfg.minSafeMainStrokeMinMovePt) continue;

      const deltaShiftPt = Math.abs(delta);
      const renderedMovePt = r2(
        Math.hypot(
          (candBb.x0 + candBb.x1) / 2 - (node.bbox.x0 + node.bbox.x1) / 2,
          (candBb.y0 + candBb.y1) / 2 - (node.bbox.y0 + node.bbox.y1) / 2
        )
      );
      const moveDirDesc = isXAxis
        ? delta > 0
          ? "right(+x)"
          : "left(-x)"
        : delta > 0
          ? "up(+y)"
          : "down(-y)";

      let scoreC = 100;
      if (clr.minMainStrokeClearance < cfg.minSafeMainStrokeNaturalPt) {
        scoreC -= (cfg.minSafeMainStrokeNaturalPt - clr.minMainStrokeClearance) * 35;
      } else {
        scoreC += Math.min(clr.minMainStrokeClearance, 3.0) * 6.0;
      }
      scoreC -= overhangPt * 5.2;
      scoreC -= Math.max(0, (clr.anchorDistPt || 0) - (origClr.anchorDistPt || 5.2)) * 10.0;
      scoreC -= deltaShiftPt * 1.4;

      tangentialCandidates.push({
        mode: "tangential-axis-shift",
        moveDirDesc,
        shift: candShift,
        deltaShift: isXAxis ? [r2(delta), 0] : [0, r2(delta)],
        deltaShiftNormPt: deltaShiftPt,
        renderedMovePt,
        bbox: candBb,
        clearance: clr,
        scoreC: r2(scoreC),
      });
    }
  }

  if (tangentialCandidates.length > 0) {
    const sortedB = [...tangentialCandidates].sort(
      (a, b) => a.deltaShiftNormPt - b.deltaShiftNormPt || b.scoreC - a.scoreC
    );
    const sortedC = [...tangentialCandidates].sort(
      (a, b) => b.scoreC - a.scoreC || a.deltaShiftNormPt - b.deltaShiftNormPt
    );
    return {
      strategy: "tangential-axis-shift",
      candB: sortedB[0],
      candC: sortedC[0],
      allCandidatesCount: tangentialCandidates.length,
    };
  }

  // [탐색 2] 인라인 보조선이 같은 방향에서 들어와 글자를 수직/수평 관통하는 경우 (예: CASE-006 \alpha, \beta)
  const flipCandidates = [];
  if (info.projectionInfo) {
    const pInfo = info.projectionInfo;
    let flipSign = 0;
    if (isXAxis) {
      if (pInfo.comesFromBelow && info.dirOption === "below") flipSign = +1;
      else if (pInfo.comesFromAbove && info.dirOption === "above") flipSign = -1;
    } else {
      if (pInfo.comesFromLeft && info.dirOption === "left") flipSign = +1;
      else if (pInfo.comesFromRight && info.dirOption === "right") flipSign = -1;
    }

    if (flipSign !== 0) {
      for (
        let mag = cfg.flipShiftMinPt;
        mag <= cfg.flipShiftMaxPt + 1e-9;
        mag = r2(mag + cfg.flipStepPt)
      ) {
        const delta = r2(flipSign * mag);
        const candShift = isXAxis ? [ox, r2(oy + delta)] : [r2(ox + delta), oy];
        const candBb = bboxFromShift(node, candShift);
        const clr = evaluateAxisLetterBoxClearancesD2(
          node.id,
          anchorPt,
          info.nearbyMarkerId,
          candBb,
          scene,
          nodeBoxesById
        );

        if (isXAxis && flipSign > 0 && candBb.y0 <= 0.5) continue;
        if (isXAxis && flipSign < 0 && candBb.y1 >= -0.5) continue;
        if (!isXAxis && flipSign > 0 && candBb.x0 <= 0.5) continue;
        if (!isXAxis && flipSign < 0 && candBb.x1 >= -0.5) continue;

        if (clr.minMainStrokeClearance < cfg.minSafeMainStrokeMinMovePt) continue;
        if (clr.minDashedStrokeClearance < cfg.minSafeFlipAxisGapPt) continue;
        if (clr.minAxisClearance < cfg.minSafeFlipAxisGapPt) continue;
        if (clr.minNodeGap < cfg.minSafeNodeGapPt) continue;

        const renderedMovePt = r2(
          Math.hypot(
            (candBb.x0 + candBb.x1) / 2 - (node.bbox.x0 + node.bbox.x1) / 2,
            (candBb.y0 + candBb.y1) / 2 - (node.bbox.y0 + node.bbox.y1) / 2
          )
        );

        const idealAxisMid = (cfg.idealFlipAxisGapMinPt + cfg.idealFlipAxisGapMaxPt) / 2;
        let scoreC = 100 - Math.abs(clr.minAxisClearance - idealAxisMid) * 8.0;
        if (
          clr.minAxisClearance >= cfg.idealFlipAxisGapMinPt &&
          clr.minAxisClearance <= cfg.idealFlipAxisGapMaxPt
        ) {
          scoreC += 12.0;
        }
        scoreC += Math.min(clr.minMainStrokeClearance, 10.0) * 0.5;

        flipCandidates.push({
          mode: "opposite-axis-side-flip",
          moveDirDesc: isXAxis
            ? flipSign > 0
              ? "up-across-x-axis(+y)"
              : "down-across-x-axis(-y)"
            : flipSign > 0
              ? "right-across-y-axis(+x)"
              : "left-across-y-axis(-x)",
          shift: candShift,
          deltaShift: isXAxis ? [0, delta] : [delta, 0],
          deltaShiftNormPt: Math.abs(delta),
          renderedMovePt,
          bbox: candBb,
          clearance: clr,
          scoreC: r2(scoreC),
        });
      }
    }
  }

  if (flipCandidates.length > 0) {
    const sortedB = [...flipCandidates].sort(
      (a, b) => a.deltaShiftNormPt - b.deltaShiftNormPt || b.scoreC - a.scoreC
    );
    const sortedC = [...flipCandidates].sort(
      (a, b) => b.scoreC - a.scoreC || a.deltaShiftNormPt - b.deltaShiftNormPt
    );
    return {
      strategy: "opposite-axis-side-flip",
      candB: sortedB[0],
      candC: sortedC[0],
      allCandidatesCount: flipCandidates.length,
    };
  }

  return {
    strategy: "no-safe-candidate-hold",
    candB: null,
    candC: null,
    allCandidatesCount: 0,
  };
}

/**
 * [Unit 3-F / D-2] 장면 내 축 문자 및 기호 눈금(유형 A, B, C)을 분류하고,
 * 실제 곡선·보조선·좌표축·타 라벨과 충돌하는 축 문자 라벨만 평가원 스타일 자연 배치(Candidate C)로 정렬한다.
 */
export function planAxisLetterOverlapsD2(
  scene,
  fnPlan,
  fnShiftResult,
  axisEditsToApply = [],
  tickPlan = null,
  originPlan = null,
  pointLabelPlan = null,
  cfg = DEFAULT_UNIT3F_AXIS_LETTER_PARAMS
) {
  const params = { ...DEFAULT_UNIT3F_AXIS_LETTER_PARAMS, ...(cfg || {}) };
  const result = {
    requested: true,
    applied: false,
    edits: [],
    movedAxisLetters: [],
    heldAxisLetters: [],
    decisions: [],
    decisionsByNodeId: new Map(),
    classification: null,
  };

  if (!scene || !scene.ok || !Array.isArray(scene.nodes)) return result;

  const { sceneEff, nodeBoxesById } = buildEffectiveSceneStateBeforeAxisLetterUnit3F(
    scene,
    fnPlan,
    fnShiftResult,
    axisEditsToApply,
    tickPlan,
    originPlan,
    pointLabelPlan
  );

  const classification = classifyAxisLetterNodesD2(sceneEff, sceneEff.raw || "", params);
  result.classification = classification;

  const eligibleItems = classification.items.filter((it) => it.eligibleForD2);

  for (const info of eligibleItems) {
    const node = sceneEff.nodes.find((nd) => nd.id === info.id);
    if (!node || !node.bbox) continue;

    const ox = node.xshift || 0;
    const oy = node.yshift || 0;
    const currBb = nodeBoxesById.get(node.id) || node.bbox;

    const origClr = evaluateAxisLetterBoxClearancesD2(
      node.id,
      info.anchorPt,
      info.nearbyMarkerId,
      currBb,
      sceneEff,
      nodeBoxesById
    );
    const trigger = checkAxisLetterNeedsMoveD2(origClr, params);

    if (!trigger.needsMove) {
      const keepReason = `축 문자(${info.cleanLabel}, ${info.axisName}축)가 현재 위치(${info.dirOption || "기본"})에서 무충돌 자연 배치 상태(실선 여유 ${origClr.minMainStrokeClearance}pt, 보조선 여유 ${origClr.minDashedStrokeClearance}pt, 축 여유 ${origClr.minAxisClearance}pt)이므로 원본 위치 유지`;
      const keepDec = {
        id: node.id,
        label: node.label,
        cleanLabel: info.cleanLabel,
        symbol: info.cleanLabel,
        role: "axis-letter-d2",
        d2Category: info.d2Category,
        subTypeCode: info.subTypeCode,
        kind: node.kind,
        axisName: info.axisName,
        anchorPt: info.anchorPt,
        nearbyMarkerId: info.nearbyMarkerId,
        origDirOption: info.dirOption,
        moveDirDesc: "keep",
        strategy: "keep-natural",
        action: "keep",
        nonMoveCode: "keep-original",
        nonMoveCategory: "기존 위치 유지",
        autoModified: false,
        moved: false,
        selectedEngine: "Unit 3-F-D2",
        origShift: [ox, oy],
        newShift: [ox, oy],
        shift: [ox, oy],
        shiftPt: [ox, oy],
        deltaShiftPt: [0, 0],
        movedPt: 0,
        origBbox: currBb,
        bbox: currBb,
        origClearancePt: origClr.minOverallStrokeClearance,
        finalClearancePt: origClr.minOverallStrokeClearance,
        origMainClearancePt: origClr.minMainStrokeClearance,
        finalMainClearancePt: origClr.minMainStrokeClearance,
        origDashedClearancePt: origClr.minDashedStrokeClearance,
        finalDashedClearancePt: origClr.minDashedStrokeClearance,
        origAxisClearancePt: origClr.minAxisClearance,
        finalAxisClearancePt: origClr.minAxisClearance,
        origNodeGapPt: origClr.minNodeGap,
        finalNodeGapPt: origClr.minNodeGap,
        beforeClearance: {
          minStrokeClearancePt: origClr.minOverallStrokeClearance,
          minMainClearancePt: origClr.minMainStrokeClearance,
          minDashedClearancePt: origClr.minDashedStrokeClearance,
          minAxisClearancePt: origClr.minAxisClearance,
          minNodeGapPt: origClr.minNodeGap,
        },
        afterClearance: {
          minStrokeClearancePt: origClr.minOverallStrokeClearance,
          minMainClearancePt: origClr.minMainStrokeClearance,
          minDashedClearancePt: origClr.minDashedStrokeClearance,
          minAxisClearancePt: origClr.minAxisClearance,
          minNodeGapPt: origClr.minNodeGap,
        },
        reason: keepReason,
        selectionReason: keepReason,
        holdReason: keepReason,
      };
      result.heldAxisLetters.push(keepDec);
      result.decisions.push(keepDec);
      result.decisionsByNodeId.set(node.id, keepDec);
      continue;
    }

    const searchRes = searchAxisLetterCandidatesD2(node, info, sceneEff, nodeBoxesById, params);
    const bestC = searchRes.candC || searchRes.candB || null;

    if (!bestC || (bestC.shift[0] === ox && bestC.shift[1] === oy)) {
      const holdReason = `축 문자(${info.cleanLabel}, ${info.axisName}축)에 선 겹침(${trigger.reasons.join(", ")})이 감지되었으나 눈금 소속 범위 내 안전한 이동 후보가 없어 원본 위치 유지(Hold)`;
      const holdDec = {
        id: node.id,
        label: node.label,
        cleanLabel: info.cleanLabel,
        symbol: info.cleanLabel,
        role: "axis-letter-d2",
        d2Category: info.d2Category,
        subTypeCode: info.subTypeCode,
        kind: node.kind,
        axisName: info.axisName,
        anchorPt: info.anchorPt,
        nearbyMarkerId: info.nearbyMarkerId,
        origDirOption: info.dirOption,
        moveDirDesc: "hold",
        strategy: "no-safe-candidate-hold",
        action: "hold-no-safe-axis-letter-candidate",
        nonMoveCode: "no-safe-axis-letter-candidate",
        nonMoveCategory: "안전 후보 없음",
        autoModified: false,
        moved: false,
        selectedEngine: "Unit 3-F-D2",
        origShift: [ox, oy],
        newShift: [ox, oy],
        shift: [ox, oy],
        shiftPt: [ox, oy],
        deltaShiftPt: [0, 0],
        movedPt: 0,
        origBbox: currBb,
        bbox: currBb,
        origClearancePt: origClr.minOverallStrokeClearance,
        finalClearancePt: origClr.minOverallStrokeClearance,
        origMainClearancePt: origClr.minMainStrokeClearance,
        finalMainClearancePt: origClr.minMainStrokeClearance,
        origDashedClearancePt: origClr.minDashedStrokeClearance,
        finalDashedClearancePt: origClr.minDashedStrokeClearance,
        origAxisClearancePt: origClr.minAxisClearance,
        finalAxisClearancePt: origClr.minAxisClearance,
        origNodeGapPt: origClr.minNodeGap,
        finalNodeGapPt: origClr.minNodeGap,
        beforeClearance: {
          minStrokeClearancePt: origClr.minOverallStrokeClearance,
          minMainClearancePt: origClr.minMainStrokeClearance,
          minDashedClearancePt: origClr.minDashedStrokeClearance,
          minAxisClearancePt: origClr.minAxisClearance,
          minNodeGapPt: origClr.minNodeGap,
        },
        afterClearance: {
          minStrokeClearancePt: origClr.minOverallStrokeClearance,
          minMainClearancePt: origClr.minMainStrokeClearance,
          minDashedClearancePt: origClr.minDashedStrokeClearance,
          minAxisClearancePt: origClr.minAxisClearance,
          minNodeGapPt: origClr.minNodeGap,
        },
        reason: holdReason,
        selectionReason: holdReason,
        holdReason,
      };
      result.heldAxisLetters.push(holdDec);
      result.decisions.push(holdDec);
      result.decisionsByNodeId.set(node.id, holdDec);
      continue;
    }

    nodeBoxesById.set(node.id, bestC.bbox);
    const ed = setShifts(node, bestC.shift[0], bestC.shift[1]);
    result.edits.push({
      kind: "label-shift",
      subKind: "d2-axis-letter-shift",
      id: node.id,
      start: ed.start,
      end: ed.end,
      replacement: ed.replacement,
    });

    const moveReason = `축 문자(${info.cleanLabel}, ${info.axisName}축)의 기존 선 겹침(${trigger.reasons.join(", ")}) 해소를 위해 평가원 스타일 자연 배치(${bestC.moveDirDesc}, shift=[${bestC.shift[0]}, ${bestC.shift[1]}]pt)로 이동 (실선 여유 ${bestC.clearance.minMainStrokeClearance}pt, 보조선 여유 ${bestC.clearance.minDashedStrokeClearance}pt, 축 여유 ${bestC.clearance.minAxisClearance}pt 확보)`;

    const moveDec = {
      id: node.id,
      label: node.label,
      cleanLabel: info.cleanLabel,
      symbol: info.cleanLabel,
      role: "axis-letter-d2",
      d2Category: info.d2Category,
      subTypeCode: info.subTypeCode,
      kind: node.kind,
      axisName: info.axisName,
      anchorPt: info.anchorPt,
      nearbyMarkerId: info.nearbyMarkerId,
      origDirOption: info.dirOption,
      moveDirDesc: bestC.moveDirDesc,
      strategy: searchRes.strategy,
      action: "move-d2-axis-letter",
      nonMoveCode: null,
      nonMoveCategory: null,
      autoModified: true,
      moved: true,
      selectedEngine: "Unit 3-F-D2",
      origShift: [ox, oy],
      newShift: bestC.shift,
      shift: bestC.shift,
      shiftPt: bestC.shift,
      deltaShiftPt: bestC.deltaShift,
      movedPt: bestC.renderedMovePt,
      score: bestC.scoreC,
      origBbox: currBb,
      bbox: bestC.bbox,
      origClearancePt: origClr.minOverallStrokeClearance,
      finalClearancePt: bestC.clearance.minOverallStrokeClearance,
      origMainClearancePt: origClr.minMainStrokeClearance,
      finalMainClearancePt: bestC.clearance.minMainStrokeClearance,
      origDashedClearancePt: origClr.minDashedStrokeClearance,
      finalDashedClearancePt: bestC.clearance.minDashedStrokeClearance,
      origAxisClearancePt: origClr.minAxisClearance,
      finalAxisClearancePt: bestC.clearance.minAxisClearance,
      origNodeGapPt: origClr.minNodeGap,
      finalNodeGapPt: bestC.clearance.minNodeGap,
      beforeClearance: {
        minStrokeClearancePt: origClr.minOverallStrokeClearance,
        minMainClearancePt: origClr.minMainStrokeClearance,
        minDashedClearancePt: origClr.minDashedStrokeClearance,
        minAxisClearancePt: origClr.minAxisClearance,
        minNodeGapPt: origClr.minNodeGap,
      },
      afterClearance: {
        minStrokeClearancePt: bestC.clearance.minOverallStrokeClearance,
        minMainClearancePt: bestC.clearance.minMainStrokeClearance,
        minDashedClearancePt: bestC.clearance.minDashedStrokeClearance,
        minAxisClearancePt: bestC.clearance.minAxisClearance,
        minNodeGapPt: bestC.clearance.minNodeGap,
      },
      reason: moveReason,
      selectionReason: moveReason,
      holdReason: null,
    };

    result.movedAxisLetters.push(moveDec);
    result.decisions.push(moveDec);
    result.decisionsByNodeId.set(node.id, moveDec);
  }

  result.applied = result.movedAxisLetters.length > 0;
  return result;
}
