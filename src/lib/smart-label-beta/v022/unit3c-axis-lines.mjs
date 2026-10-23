// ============================================================================
// KO-SMART 스마트 라벨 — Unit 3-C: 축 평행 직선(수평선 y=c · 수직선 x=c) 방정식 라벨 배치 모듈
// ============================================================================
// 역할 및 원칙:
//  1) 수평선 방정식 라벨(y=상수, 예: y=6, y=4, y=1/4, y=9, y=5, y=f(1)):
//     - 실제 그려진(클리핑 반영) 수평선 선분의 오른쪽 끝(node[right]) 배치를 최우선으로 한다.
//     - 직선의 높이(yLine)와 라벨의 세로 중심(cy)을 자연스럽게 정렬한다.
//     - 기존 위치에 충돌이 없더라도 오른쪽 끝(node[right])에 있지 않거나 세로 중심이 어긋나 있으면
//       오른쪽 끝 표준 위치로 이동을 우선 검토한다 (한국 수학 교재/평가원 조판 관례).
//     - 단, 오른쪽 끝에 공간이 부족하거나 글자 잘림·신규 충돌 위험이 있으면 무리하게 이동하지 않는다.
//  2) 수직선 방정식 라벨(x=상수, 예: x=4, x=-2, x=1/2, x=k):
//     - 실제 그려진 수직선 선분과 짝지어진 x=상수 방정식 라벨만 대상으로 한다
//       (x축 눈금 숫자나 일반 점 좌표, 짧은 수선의 발 보조선과 엄격히 구분).
//     - 이미 아래 끝(node[below]) 또는 위 끝(node[above])에 가로 중심 정렬되어 있고 충돌이 없다면
//       원본 위치를 그대로 유지한다 (불필요한 미세 이동 최소화).
//     - 이동이 필요한 경우 아래 공간이 충분하면 아래 끝 중앙 정렬(node[below])을 우선 선택하고,
//       아래에 축·눈금·다른 라벨·곡선이 있어 겹치면 위 끝 중앙 정렬(node[above])로 대체한다.
//  3) 공통 안전 규칙:
//     - 직선 자체의 길이·좌표·도메인 변경 금지, 수식 문자열 변경 금지 (오직 xshift/yshift 만 조정).
//     - 복수 수평선(예: y=9, y=5) 또는 복수 수직선이 있을 때 수식 상수값과 실제 선분 좌표를 대조하여 오매칭을 방지한다.
// ============================================================================

import {
  PARAMS,
  classifyStrokeKind,
  endInfo,
  computeShiftForMove,
  bboxFromShift,
  bboxPtDist,
  clearanceToStroke,
} from "../../../../experiments/smart-label-prototype-v021/src/algorithm.mjs";

const r2 = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

export const DEFAULT_UNIT3C_AXIS_LINE_PARAMS = {
  // 수평선(y=c) 판정 및 배치 파라미터
  horizMaxDyPt: 1.0,              // 수평선으로 인정할 최대 y 편차 (pt)
  horizMinLengthPt: 12.0,         // 수평선으로 인정할 최소 가로 길이 (pt)
  coordMatchTolPt: 1.8,           // 수식 상수(c*U)와 실제 선분 좌표 간 허용 오차 (pt)
  horizKeepMinRightGapPt: 1.8,    // 이미 우측 끝 배치로 인정할 최소 우측 간격 (pt)
  horizKeepMaxRightGapPt: 10.0,   // 이미 우측 끝 배치로 인정할 최대 우측 간격 (pt)
  horizKeepMaxCenterDyPt: 2.5,    // 이미 세로 중심 정렬된 것으로 인정할 최대 |cy - yLine| (pt)
  horizXAxisHalfPlaneMinGapPt: 2.0, // x축 화살표/직선 부근에서 분수 라벨 하단이 x축을 침범하지 않도록 확보할 최소 높이 (pt)

  // 수직선(x=c) 판정 및 배치 파라미터
  vertMinLengthPt: 20.0,          // 실제 수직선으로 인정할 최소 세로 길이 (pt)
  vertKeepMinEndGapPt: 1.2,       // 이미 수직선 끝점 배치로 인정할 최소 끝점 간격 (pt)
  vertKeepMaxEndGapPt: 10.5,      // 이미 수직선 끝점 배치로 인정할 최대 끝점 간격 (pt, inner sep=3pt @ scale=2.2 포괄)
  vertKeepMaxCenterDxPt: 8.0,     // 이미 수직선 가로 중심 정렬로 인정할 최대 |cx - xLine| 상한 (pt)
  vertKeepMaxAlpha: 0.68,         // 이미 수직선 가로 중심 정렬로 인정할 최대 |alpha|
  vertBottomComfortableClearancePt: 5.0, // 수직선 하단 후보를 우선 채택할 여유 간격 기준 (pt)
};

/**
 * 주어진 stroke 가 축이 아닌 실제 수평선 선분인지 판별한다.
 */
export function isHorizontalLineStrokeUnit3C(
  stroke,
  cfg = DEFAULT_UNIT3C_AXIS_LINE_PARAMS
) {
  if (!stroke || stroke.kind === "axis" || !Array.isArray(stroke.pts) || stroke.pts.length < 2) {
    return false;
  }
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of stroke.pts) {
    if (p[0] < xMin) xMin = p[0];
    if (p[0] > xMax) xMax = p[0];
    if (p[1] < yMin) yMin = p[1];
    if (p[1] > yMax) yMax = p[1];
  }
  const dx = xMax - xMin;
  const dy = yMax - yMin;
  return dy <= cfg.horizMaxDyPt && dx >= cfg.horizMinLengthPt;
}

/**
 * 주어진 stroke 가 축이 아닌 실제 수직선 선분인지 판별한다.
 */
export function isVerticalLineStrokeUnit3C(
  stroke,
  cfg = DEFAULT_UNIT3C_AXIS_LINE_PARAMS
) {
  if (!stroke || stroke.kind === "axis" || !Array.isArray(stroke.pts) || stroke.pts.length < 2) {
    return false;
  }
  if (classifyStrokeKind(stroke) !== "verticalLine") return false;
  let yMin = Infinity, yMax = -Infinity;
  for (const p of stroke.pts) {
    if (p[1] < yMin) yMin = p[1];
    if (p[1] > yMax) yMax = p[1];
  }
  return yMax - yMin >= cfg.vertMinLengthPt;
}

/**
 * 수치 상수 수평선 방정식 라벨(y = c)에서 상수 c 를 추출한다.
 * (변수 x 가 포함되지 않은 순수 상수 함수 y = c 만 해당)
 */
export function extractNumericConstantY(numAn) {
  if (!numAn || !numAn.parseOk || numAn.lhs !== "y" || numAn.hasSymbolicParams || !numAn.fn) {
    return null;
  }
  const exprStr = String(numAn.compiledExpr || numAn.normalizedExpr || "");
  if (/\bx\b/.test(exprStr)) return null;
  try {
    const y0 = numAn.fn(0);
    const y1 = numAn.fn(1);
    const yNeg = numAn.fn(-2);
    if (
      Number.isFinite(y0) &&
      Number.isFinite(y1) &&
      Number.isFinite(yNeg) &&
      Math.abs(y0 - y1) < 1e-6 &&
      Math.abs(y0 - yNeg) < 1e-6
    ) {
      return y0;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 수치 상수 수직선 방정식 라벨(x = c)에서 상수 c 를 추출한다.
 */
export function extractNumericConstantX(node, numAn) {
  if (numAn && numAn.parseOk && numAn.lhs === "x" && typeof numAn.constantX === "number" && Number.isFinite(numAn.constantX)) {
    return numAn.constantX;
  }
  const clean = String(node?.trimmed || "").replace(/\s+/g, "");
  const vm = /^x=([-+]?(?:\d+\.?\d*|\.\d+))$/.exec(clean);
  return vm ? Number(vm[1]) : null;
}

/**
 * 장면(scene) 내에서 수치 상수 y = c 에 정확히 대응하는 수평선(plot 또는 -- 선분)을 찾는다.
 * 복수 수평선이 있을 때 yPt = c * yU 좌표 일치 여부로 오매칭을 원천 차단한다.
 */
export function findMatchingHorizontalLineStrokesUnit3C(
  scene,
  constY,
  claimedStrokeIndices = new Set(),
  cfg = DEFAULT_UNIT3C_AXIS_LINE_PARAMS
) {
  if (constY === null || !Number.isFinite(constY) || !scene?.units?.yU) return [];
  const yPt = constY * scene.units.yU;
  const strokes = Array.isArray(scene.strokes) ? scene.strokes : [];

  const matches = [];
  for (const s of strokes) {
    if (!s || s.kind === "axis" || claimedStrokeIndices.has(s.index)) continue;
    if (!isHorizontalLineStrokeUnit3C(s, cfg)) continue;
    const lineY = (s.pts[0][1] + s.pts[s.pts.length - 1][1]) / 2;
    if (Math.abs(lineY - yPt) <= cfg.coordMatchTolPt) {
      matches.push(s);
    }
  }

  // 만약 동일 높이(y=c)에 실선(또는 plot) 메인 수평선과 짧은 점선 보조선이 함께 존재한다면
  // 메인 수평선(plot 또는 비점선)을 우선 선택한다.
  if (matches.length >= 2) {
    const mainMatches = matches.filter(
      (s) => (s.stmt && s.stmt.type === "plot") || s.kind !== "dashed"
    );
    if (mainMatches.length === 1) return mainMatches;
  }

  return matches;
}

/**
 * 장면(scene) 내에서 수치 상수 x = c 에 정확히 대응하는 수직선 선분을 찾는다.
 * x축 눈금이나 짧은 점선 수선의 발(한쪽 끝이 x축 y=0 에 딱 붙어 있는 짧은 보조선)과 실제 수직선을 구분한다.
 */
export function findMatchingVerticalLineStrokesUnit3C(
  scene,
  constX,
  claimedStrokeIndices = new Set(),
  cfg = DEFAULT_UNIT3C_AXIS_LINE_PARAMS
) {
  if (constX === null || !Number.isFinite(constX) || !scene?.units?.xU) return [];
  const xPt = constX * scene.units.xU;
  const strokes = Array.isArray(scene.strokes) ? scene.strokes : [];

  const rawMatches = [];
  for (const s of strokes) {
    if (!s || s.kind === "axis" || claimedStrokeIndices.has(s.index)) continue;
    if (!isVerticalLineStrokeUnit3C(s, cfg)) continue;
    const lineX = (s.pts[0][0] + s.pts[s.pts.length - 1][0]) / 2;
    if (Math.abs(lineX - xPt) <= cfg.coordMatchTolPt) {
      rawMatches.push(s);
    }
  }

  if (rawMatches.length <= 1) return rawMatches;

  // 복수 후보가 있을 때: x축(y=0)을 관통하거나 양쪽으로 뻗은 진짜 수직선을 수선의 발(한 끝이 y=0 인 점선)보다 우선
  const spanningLines = rawMatches.filter((s) => {
    const y0 = Math.min(s.pts[0][1], s.pts[s.pts.length - 1][1]);
    const y1 = Math.max(s.pts[0][1], s.pts[s.pts.length - 1][1]);
    return !(Math.abs(y0) <= 1.5 || Math.abs(y1) <= 1.5);
  });
  if (spanningLines.length === 1) return spanningLines;

  return rawMatches;
}

/**
 * 노드(node)와 배정 정보(assignment)가 Unit 3-C 축 평행 직선(수평선 y=c 또는 수직선 x=c) 대상인지 분류한다.
 */
export function classifyAxisParallelLineLabelUnit3C(
  node,
  scene,
  assignment,
  numAn = null,
  structTpl = null,
  cfg = DEFAULT_UNIT3C_AXIS_LINE_PARAMS
) {
  if (!node || node.role !== "function" || !node.bbox || !assignment || !assignment.stroke || !assignment.confirmed) {
    return null;
  }
  const stroke = assignment.stroke;

  // 1) 수평선(y = 상수) 판정
  const constY = extractNumericConstantY(numAn);
  const isHorizConstFn = Boolean(structTpl && structTpl.template === "horizontal-constant-fn");
  const isInlineHorizConst =
    node.kind === "inline" &&
    isHorizontalLineStrokeUnit3C(stroke, cfg) &&
    (constY !== null || /^y=[^x]+$/.test(String(node.trimmed || "")));

  if ((constY !== null || isHorizConstFn || isInlineHorizConst) && isHorizontalLineStrokeUnit3C(stroke, cfg)) {
    const lineY = (stroke.pts[0][1] + stroke.pts[stroke.pts.length - 1][1]) / 2;
    if (constY !== null && scene?.units?.yU) {
      const expectedYPt = constY * scene.units.yU;
      if (Math.abs(lineY - expectedYPt) > cfg.coordMatchTolPt + 0.5) {
        return null; // 높이가 다른 수평선이면 절대 매칭하지 않음
      }
    }
    return {
      axisParallelKind: "horizontalLine",
      equationKind: constY !== null ? "y-numeric-constant" : "y-symbolic-constant",
      constantValue: constY,
      lineCoordPt: r2(lineY),
    };
  }

  // 2) 수직선(x = 상수) 판정
  const constX = extractNumericConstantX(node, numAn);
  const isVertSymbolic = Boolean(
    (structTpl && structTpl.template === "vertical-symbolic") ||
      (numAn && numAn.parseOk && numAn.lhs === "x" && numAn.hasSymbolicParams) ||
      /^x=[^y]+$/.test(String(node.trimmed || ""))
  );

  if ((constX !== null || isVertSymbolic) && isVerticalLineStrokeUnit3C(stroke, cfg)) {
    const lineX = (stroke.pts[0][0] + stroke.pts[stroke.pts.length - 1][0]) / 2;
    if (constX !== null && scene?.units?.xU) {
      const expectedXPt = constX * scene.units.xU;
      if (Math.abs(lineX - expectedXPt) > cfg.coordMatchTolPt + 0.5) {
        return null; // x좌표가 다른 수직선이면 절대 매칭하지 않음
      }
    }
    return {
      axisParallelKind: "verticalLine",
      equationKind: constX !== null ? "x-numeric-constant" : "x-symbolic-constant",
      constantValue: constX,
      lineCoordPt: r2(lineX),
    };
  }

  return null;
}

/**
 * 노드가 속한 활성 \clip 직사각형(존재할 경우)을 반환한다.
 */
function findEnclosingClipRectForNode(node, scene) {
  if (!node || !scene || !scene.body || !scene.units?.xU || !scene.units?.yU) return null;
  const { xU, yU } = scene.units;
  const body = scene.body;
  const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)`;
  const clipRe = new RegExp(
    String.raw`\\clip\s*\(\s*(${NUM})\s*,\s*(${NUM})\s*\)\s*rectangle\s*\(\s*(${NUM})\s*,\s*(${NUM})\s*\)\s*;`,
    "g"
  );
  const scopes = [];
  const scopeOpenRe = /\\begin\{scope\}/g;
  const scopeCloseRe = /\\end\{scope\}/g;
  const opens = [];
  let m;
  while ((m = scopeOpenRe.exec(body)) !== null) opens.push(m.index);
  const closes = [];
  while ((m = scopeCloseRe.exec(body)) !== null) closes.push(m.index + m[0].length);
  for (let i = 0; i < Math.min(opens.length, closes.length); i++) {
    scopes.push({ start: opens[i], end: closes[i] });
  }

  while ((m = clipRe.exec(body)) !== null) {
    const cIdx = m.index;
    const enclosingScope = scopes.find((sc) => cIdx >= sc.start && cIdx <= sc.end);
    const rangeStart = cIdx;
    const rangeEnd = enclosingScope ? enclosingScope.end : body.length;
    if (node.start >= rangeStart && node.end <= rangeEnd) {
      const xa = Number(m[1]) * xU;
      const ya = Number(m[2]) * yU;
      const xb = Number(m[3]) * xU;
      const yb = Number(m[4]) * yU;
      return {
        x0: Math.min(xa, xb),
        y0: Math.min(ya, yb),
        x1: Math.max(xa, xb),
        y1: Math.max(ya, yb),
      };
    }
  }
  return null;
}

/**
 * 수평선(y = c) 라벨 후보가 x축 직선 및 화살표(Stealth) 영역을 침범하지 않는지 검사한다.
 * (예: CASE-008 \displaystyle y=\frac{1}{4} 이 y=0.25 에 배치될 때 분모 4가 \theta 축 화살표 아래로 내려가는 현상 방지)
 */
function passesHorizontalXAxisHalfPlaneGuard(
  bb,
  yLine,
  scene,
  cfg = DEFAULT_UNIT3C_AXIS_LINE_PARAMS
) {
  if (!scene?.axes?.x || !scene?.units?.xU) return true;
  const xU = scene.units.xU;
  const xAxisLeftPt = Math.min(scene.axes.x.from, scene.axes.x.to) * xU;
  const xAxisRightPt = Math.max(scene.axes.x.from, scene.axes.x.to) * xU;

  // 라벨의 가로 범위가 x축(또는 축 연장 시 화살표 주변 +25pt 이내)과 겹치는 경우
  const overlapsXAxisHoriz = bb.x1 >= xAxisLeftPt - 5.0 && bb.x0 <= xAxisRightPt + 25.0;
  if (!overlapsXAxisHoriz) return true;

  // 수평선이 x축 위쪽(yLine > 2pt)에 있으면 라벨 하단(bb.y0)도 x축 위(>= 2.0pt)에 있어야 함
  if (yLine > cfg.horizXAxisHalfPlaneMinGapPt) {
    if (bb.y0 < cfg.horizXAxisHalfPlaneMinGapPt) return false;
  }
  // 수평선이 x축 아래쪽(yLine < -2pt)에 있으면 라벨 상단(bb.y1)도 x축 아래(<= -2.0pt)에 있어야 함
  if (yLine < -cfg.horizXAxisHalfPlaneMinGapPt) {
    if (bb.y1 > -cfg.horizXAxisHalfPlaneMinGapPt) return false;
  }
  return true;
}

/**
 * [1] 수평선(y = 상수) 라벨 배치 계획기
 * - 오른쪽 끝(node[right]) + 세로 중심 정렬(cy ≈ yLine) 최우선
 * - 이미 오른쪽 끝에 바르게 정렬되어 있고 무충돌이면 기존 위치 유지(keep)
 * - 기존 위치에 충돌이 없더라도 오른쪽 끝이 아니면 오른쪽 끝 배치를 우선 검토
 */
export function planHorizontalLineLabelUnit3C({
  node,
  stroke,
  assignment,
  evalBox,
  scene,
  P = PARAMS,
  cfg = DEFAULT_UNIT3C_AXIS_LINE_PARAMS,
}) {
  const ends = [endInfo(stroke, 0), endInfo(stroke, 1)];
  const rightEndIdx = ends[1].point[0] >= ends[0].point[0] ? 1 : 0;
  const E = ends[rightEndIdx].point;
  const xRight = E[0];
  const yLine = E[1];
  const w = node.bbox.x1 - node.bbox.x0;
  const h = node.bbox.y1 - node.bbox.y0;

  const e0 = evalBox(node.bbox);
  const origClearanceOk =
    e0.minOther >= P.cHard && e0.own >= P.cOwn && e0.labelGap >= P.mLabel;
  const origRightGap = node.bbox.x0 - xRight;
  const origCy = (node.bbox.y0 + node.bbox.y1) / 2;
  const origDyCenter = Math.abs(origCy - yLine);
  const origHalfPlaneOk = passesHorizontalXAxisHalfPlaneGuard(node.bbox, yLine, scene, cfg);

  const isAlreadyCanonicalRight =
    origClearanceOk &&
    origHalfPlaneOk &&
    origRightGap >= cfg.horizKeepMinRightGapPt &&
    origRightGap <= cfg.horizKeepMaxRightGapPt &&
    origDyCenter <= cfg.horizKeepMaxCenterDyPt;

  if (isAlreadyCanonicalRight) {
    const endGapPt = r2(bboxPtDist(E, node.bbox));
    const beta = h > 1e-6 ? r2((origCy - yLine) / (h / 2)) : 0;
    return {
      action: "keep",
      axisParallelKind: "horizontalLine",
      end: rightEndIdx,
      preferredEnd: rightEndIdx,
      side: "right",
      alpha: beta,
      bbox: node.bbox,
      eval: e0,
      reason: `수평선(${node.label}) 우측 끝(node[right]) 표준 배치 및 세로 중심 정렬(|Δcy|=${r2(origDyCenter)}pt, 간격=${endGapPt}pt, 무충돌)을 이미 만족하여 기존 위치 유지`,
      keepCheck: {
        keep: true,
        currentEnd: rightEndIdx,
        preferredEnd: rightEndIdx,
        currentSide: "right",
        endGapPt,
        alpha: beta,
        beta,
        checks: {
          clearanceOk: true,
          endOk: true,
          proximityOk: true,
          directionOk: true,
          alignmentOk: true,
        },
        rejectReasons: [],
      },
    };
  }

  // 오른쪽 끝(node[right]) 후보 생성
  const clipRect = findEnclosingClipRectForNode(node, scene);
  const unshiftedBb = bboxFromShift(node, [0, 0]);
  const unshiftedRightGap = unshiftedBb.x0 - xRight;
  const hasNaturalUnshiftedRightX =
    node.position === "right" &&
    unshiftedRightGap >= 3.2 &&
    unshiftedRightGap <= 7.5;

  // x 후보(shift X) 목록 구성
  const candidateXShifts = new Set();
  if (hasNaturalUnshiftedRightX) {
    candidateXShifts.add(0);
  }
  for (const gOff of [0, 1.0, 2.0, 3.0]) {
    const targetX0 = xRight + P.gapSide + gOff;
    const sh = computeShiftForMove(
      node,
      { x0: targetX0, x1: targetX0 + w, y0: yLine - h / 2, y1: yLine + h / 2 },
      P
    );
    candidateXShifts.add(sh.newShift[0]);
  }

  // 기본 세로 중심 정렬 yshift 계산
  const baseCenteredSh = computeShiftForMove(
    node,
    { x0: xRight + P.gapSide, x1: xRight + P.gapSide + w, y0: yLine - h / 2, y1: yLine + h / 2 },
    P
  );
  const baseYShift = baseCenteredSh.newShift[1];
  const candidateYShifts = new Set();
  if (Math.abs(((unshiftedBb.y0 + unshiftedBb.y1) / 2) - yLine) <= 1.2) {
    candidateYShifts.add(0);
  }
  for (const dyS of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) {
    candidateYShifts.add(baseYShift + dyS);
  }

  const feasibleRightCands = [];
  for (const nx of candidateXShifts) {
    for (const ny of candidateYShifts) {
      const bb = bboxFromShift(node, [nx, ny]);
      const rightGap = bb.x0 - xRight;
      if (rightGap < 2.0 || rightGap > 10.5) continue;

      if (clipRect) {
        if (
          bb.x0 < clipRect.x0 + 1.0 ||
          bb.x1 > clipRect.x1 - 1.0 ||
          bb.y0 < clipRect.y0 + 1.0 ||
          bb.y1 > clipRect.y1 - 1.0
        ) {
          continue; // 클립 영역 밖 글자 잘림 위험 후보 제외
        }
      }

      if (!passesHorizontalXAxisHalfPlaneGuard(bb, yLine, scene, cfg)) {
        continue;
      }

      const ev = evalBox(bb);
      const hard = ev.minOther < P.cHard || ev.own < P.cOwn || ev.labelGap < P.mLabel;
      if (hard) continue;

      const cy = (bb.y0 + bb.y1) / 2;
      const dyCenterPt = Math.abs(cy - yLine);
      if (dyCenterPt > Math.max(10.0, h * 0.35)) continue;

      const clearPen = Math.max(0, P.cPref - Math.min(ev.minOther, ev.labelGap)) / P.cPref;
      const gapDiffFromIdeal = Math.abs(rightGap - 5.2);
      const keepOrigXBonus = hasNaturalUnshiftedRightX && nx === 0 ? -0.35 : 0;

      // 세로 중심 정렬(dyCenterPt -> 0)을 가장 강하게 선호하되, 여유 간격(clearPen)을 함께 고려
      const cost =
        dyCenterPt * 1.65 +
        P.wClear * clearPen * clearPen * 0.45 +
        gapDiffFromIdeal * 0.35 +
        keepOrigXBonus;

      const beta = h > 1e-6 ? r2((cy - yLine) / (h / 2)) : 0;
      feasibleRightCands.push({
        bb,
        shift: [nx, ny],
        ev,
        cost: r2(cost),
        dyCenterPt: r2(dyCenterPt),
        rightGapPt: r2(rightGap),
        beta,
      });
    }
  }

  feasibleRightCands.sort((a, b) => a.cost - b.cost);

  if (feasibleRightCands.length > 0) {
    const best = feasibleRightCands[0];
    const oldX = node.xshift || 0;
    const oldY = node.yshift || 0;
    const isSameShift = best.shift[0] === oldX && best.shift[1] === oldY;

    const rejectReasons = [];
    if (!origClearanceOk) rejectReasons.push("충돌/여백 부족");
    if (origRightGap < cfg.horizKeepMinRightGapPt || origRightGap > cfg.horizKeepMaxRightGapPt) {
      rejectReasons.push("수평선 우측 끝(node[right]) 표준 위치 아님");
    }
    if (origDyCenter > cfg.horizKeepMaxCenterDyPt) {
      rejectReasons.push(`수평선 높이와 세로 중심 편차(${r2(origDyCenter)}pt)`);
    }
    if (!origHalfPlaneOk) {
      rejectReasons.push("x축 직선/화살표 인접 침범 방지");
    }

    return {
      action: isSameShift ? "keep" : "move",
      axisParallelKind: "horizontalLine",
      end: rightEndIdx,
      preferredEnd: rightEndIdx,
      side: "right",
      alpha: best.beta,
      gapOffset: 0,
      cost: best.cost,
      bbox: best.bb,
      eval: best.ev,
      candidates: feasibleRightCands.length,
      feasible: feasibleRightCands.length,
      reason: isSameShift
        ? `수평선(${node.label}) 우측 끝(node[right]) 배치 유지`
        : `수평선(${node.label}) 우측 끝(node[right]) 세로 중심 정렬 배치(${rejectReasons.join(", ")} → 우측 끝 간격 ${best.rightGapPt}pt, |Δcy|=${best.dyCenterPt}pt)`,
      keepCheck: {
        keep: isSameShift,
        currentEnd: rightEndIdx,
        preferredEnd: rightEndIdx,
        currentSide: "right",
        endGapPt: best.rightGapPt,
        alpha: best.beta,
        beta: best.beta,
        checks: {
          clearanceOk: origClearanceOk,
          endOk: origRightGap >= cfg.horizKeepMinRightGapPt && origRightGap <= cfg.horizKeepMaxRightGapPt,
          proximityOk: origRightGap >= cfg.horizKeepMinRightGapPt && origRightGap <= cfg.horizKeepMaxRightGapPt,
          directionOk: origRightGap >= 0,
          alignmentOk: origDyCenter <= cfg.horizKeepMaxCenterDyPt,
        },
        rejectReasons,
      },
    };
  }

  // 오른쪽 끝에 안전한 후보가 없는 경우:
  // 원본 위치가 무충돌이면 억지로 다른 방향(위/왼쪽 등)으로 옮기지 않고 원본 위치를 유지한다.
  if (origClearanceOk) {
    return {
      action: "keep",
      axisParallelKind: "horizontalLine",
      end: rightEndIdx,
      preferredEnd: rightEndIdx,
      side: "right",
      alpha: 0,
      bbox: node.bbox,
      eval: e0,
      reason: `수평선(${node.label}) 우측 끝 여유 공간 부족/충돌 위험으로 무충돌 원본 위치 유지`,
      keepCheck: {
        keep: true,
        currentEnd: rightEndIdx,
        preferredEnd: rightEndIdx,
        currentSide: "above",
        endGapPt: r2(bboxPtDist(E, node.bbox)),
        alpha: 0,
        beta: 0,
        checks: {
          clearanceOk: true,
          endOk: true,
          proximityOk: true,
          directionOk: true,
          alignmentOk: true,
        },
        rejectReasons: [],
      },
    };
  }

  // 원본 위치에도 충돌이 있고 우측 끝도 막혀 있으면 null 반환 -> 상위 일반 후보 탐색기로 폴백
  return null;
}

/**
 * [2] 수직선(x = 상수) 라벨 배치 계획기
 * - 이미 아래 끝(node[below]) 또는 위 끝(node[above])에 가로 중심 정렬되어 있고 무충돌이면 그대로 유지(keep)
 * - 이동이 필요하면 아래 끝 중앙 정렬(node[below])을 우선 선택하고,
 *   아래 공간이 부족하거나 축/눈금/라벨/곡선과 겹치면 위 끝 중앙 정렬(node[above])로 대체
 */
export function planVerticalLineLabelUnit3C({
  node,
  stroke,
  assignment,
  evalBox,
  scene,
  P = PARAMS,
  cfg = DEFAULT_UNIT3C_AXIS_LINE_PARAMS,
}) {
  const ends = [endInfo(stroke, 0), endInfo(stroke, 1)];
  const bottomEndIdx = ends[0].point[1] <= ends[1].point[1] ? 0 : 1;
  const topEndIdx = 1 - bottomEndIdx;
  const EBottom = ends[bottomEndIdx].point;
  const ETop = ends[topEndIdx].point;
  const xLine = (EBottom[0] + ETop[0]) / 2;
  const yBottom = EBottom[1];
  const yTop = ETop[1];
  const w = node.bbox.x1 - node.bbox.x0;
  const h = node.bbox.y1 - node.bbox.y0;

  const e0 = evalBox(node.bbox);
  const origClearanceOk =
    e0.minOther >= P.cHard && e0.own >= P.cOwn && e0.labelGap >= P.mLabel;
  const origCx = (node.bbox.x0 + node.bbox.x1) / 2;
  const origDxCenter = Math.abs(origCx - xLine);
  const origAlpha = w > 1e-6 ? (origCx - xLine) / (w / 2) : 0;
  const isHorizCentered =
    origDxCenter <= cfg.vertKeepMaxCenterDxPt && Math.abs(origAlpha) <= cfg.vertKeepMaxAlpha;

  const bottomVertGap = yBottom - node.bbox.y1;
  const topVertGap = node.bbox.y0 - yTop;
  const isNaturallyBelowBottom =
    bottomVertGap >= cfg.vertKeepMinEndGapPt && bottomVertGap <= cfg.vertKeepMaxEndGapPt;
  const isNaturallyAboveTop =
    topVertGap >= cfg.vertKeepMinEndGapPt && topVertGap <= cfg.vertKeepMaxEndGapPt;

  if (origClearanceOk && isHorizCentered && (isNaturallyBelowBottom || isNaturallyAboveTop)) {
    const keptEndIdx = isNaturallyBelowBottom ? bottomEndIdx : topEndIdx;
    const keptSide = isNaturallyBelowBottom ? "below" : "above";
    const keptGapPt = r2(isNaturallyBelowBottom ? bottomVertGap : topVertGap);
    return {
      action: "keep",
      axisParallelKind: "verticalLine",
      end: keptEndIdx,
      preferredEnd: bottomEndIdx,
      side: keptSide,
      alpha: r2(origAlpha),
      bbox: node.bbox,
      eval: e0,
      reason: `원 위치가 이미 수직선(${node.label}) ${keptSide === "below" ? "아래 끝(node[below])" : "위 끝(node[above])"} 중앙 정렬(|Δcx|=${r2(origDxCenter)}pt, 간격=${keptGapPt}pt, 무충돌)을 만족하여 불필요한 이동 생략`,
      keepCheck: {
        keep: true,
        currentEnd: keptEndIdx,
        preferredEnd: bottomEndIdx,
        currentSide: keptSide,
        endGapPt: keptGapPt,
        alpha: r2(origAlpha),
        beta: 0,
        checks: {
          clearanceOk: true,
          endOk: true,
          proximityOk: true,
          directionOk: true,
          alignmentOk: true,
        },
        rejectReasons: [],
      },
    };
  }

  const clipRect = findEnclosingClipRectForNode(node, scene);
  const alphaCandidates = [0, -0.125, 0.125, -0.25, 0.25, -0.375, 0.375, -0.5, 0.5];
  const gapOffsets = [0, 1.0, 2.0, 3.0];

  const evaluateEndpointCandidates = (endIdx, side) => {
    const E = ends[endIdx].point;
    const list = [];
    for (const gOff of gapOffsets) {
      const gap = (side === "below" ? P.gapBelow : P.gapAbove) + gOff;
      for (const al of alphaCandidates) {
        const cx = xLine + al * (w / 2);
        const rawBb =
          side === "below"
            ? { x0: cx - w / 2, x1: cx + w / 2, y1: E[1] - gap, y0: E[1] - gap - h }
            : { x0: cx - w / 2, x1: cx + w / 2, y0: E[1] + gap, y1: E[1] + gap + h };
        const sh = computeShiftForMove(node, rawBb, P);
        const bb = sh.actualBbox;

        if (clipRect) {
          if (
            bb.x0 < clipRect.x0 + 1.0 ||
            bb.x1 > clipRect.x1 - 1.0 ||
            bb.y0 < clipRect.y0 + 1.0 ||
            bb.y1 > clipRect.y1 - 1.0
          ) {
            continue;
          }
        }

        const ev = evalBox(bb);
        const hard = ev.minOther < P.cHard || ev.own < P.cOwn || ev.labelGap < P.mLabel;
        if (hard) continue;

        const actualCx = (bb.x0 + bb.x1) / 2;
        const dxCenterPt = Math.abs(actualCx - xLine);
        const actualAlpha = w > 1e-6 ? (actualCx - xLine) / (w / 2) : 0;
        const minClear = Math.min(ev.minOther, ev.labelGap);
        const clearPen = Math.max(0, P.cPref - minClear) / P.cPref;
        const ownPen =
          ev.own < (P.cOwnPref || 1.6)
            ? ((P.cOwnPref || 1.6) - ev.own) / (P.cOwnPref || 1.6)
            : 0;
        const cost =
          P.wClear * clearPen * clearPen +
          (P.wOwnPref || 3.5) * ownPen * ownPen +
          dxCenterPt * 1.5 +
          P.wAlpha * Math.abs(actualAlpha) +
          gOff * 0.35;

        list.push({
          bb,
          ei: endIdx,
          side,
          alpha: r2(actualAlpha),
          gapOffset: gOff,
          shift: sh.newShift,
          ev,
          minClear: r2(minClear),
          dxCenterPt: r2(dxCenterPt),
          cost: r2(cost),
        });
      }
    }
    list.sort((a, b) => a.cost - b.cost);
    return list;
  };

  const bottomFeasible = evaluateEndpointCandidates(bottomEndIdx, "below");
  const topFeasible = evaluateEndpointCandidates(topEndIdx, "above");

  let chosen = null;
  let selectionMode = null;

  if (
    bottomFeasible.length > 0 &&
    bottomFeasible[0].minClear >= cfg.vertBottomComfortableClearancePt
  ) {
    // 1순위: 아래 끝(node[below])에 충분한 여유 공간이 있으면 무조건 아래 끝 중앙 정렬 선택
    chosen = bottomFeasible[0];
    selectionMode = "bottom-preferred";
  } else if (topFeasible.length > 0) {
    if (
      bottomFeasible.length === 0 ||
      topFeasible[0].minClear > bottomFeasible[0].minClear + 1.5
    ) {
      // 2순위: 아래 끝이 막혔거나 협소할 때 위 끝(node[above]) 중앙 정렬로 대체
      chosen = topFeasible[0];
      selectionMode = "top-fallback";
    } else {
      chosen = bottomFeasible[0];
      selectionMode = "bottom-preferred";
    }
  } else if (bottomFeasible.length > 0) {
    chosen = bottomFeasible[0];
    selectionMode = "bottom-preferred";
  }

  if (!chosen) {
    return null; // 안전 후보 없음 -> 상위에서 no-safe-candidate 처리
  }

  const oldX = node.xshift || 0;
  const oldY = node.yshift || 0;
  const isSameShift = chosen.shift[0] === oldX && chosen.shift[1] === oldY;

  const rejectReasons = [];
  if (!origClearanceOk) rejectReasons.push("충돌/여백 부족");
  if (!isNaturallyBelowBottom && !isNaturallyAboveTop) {
    rejectReasons.push("수직선 끝점(아래/위) 위치 아님");
  }
  if (!isHorizCentered) {
    rejectReasons.push(`수직선 가로 중심 편차(|Δcx|=${r2(origDxCenter)}pt)`);
  }

  const modeDesc =
    selectionMode === "top-fallback"
      ? `수직선(${node.label}) 하단 여유 부족으로 상단 끝(node[above]) 중앙 정렬 대체 배치`
      : `수직선(${node.label}) 하단 끝(node[below]) 중앙 정렬 배치`;

  return {
    action: isSameShift ? "keep" : "move",
    axisParallelKind: "verticalLine",
    end: chosen.ei,
    preferredEnd: bottomEndIdx,
    side: chosen.side,
    alpha: chosen.alpha,
    gapOffset: chosen.gapOffset,
    cost: chosen.cost,
    bbox: chosen.bb,
    eval: chosen.ev,
    candidates: bottomFeasible.length + topFeasible.length,
    feasible: bottomFeasible.length + topFeasible.length,
    reason: isSameShift
      ? `${modeDesc} 유지`
      : `${modeDesc}(${rejectReasons.join(", ")} → 끝${chosen.ei}/${chosen.side}, |Δcx|=${chosen.dxCenterPt}pt)`,
    keepCheck: {
      keep: isSameShift,
      currentEnd: isNaturallyAboveTop ? topEndIdx : bottomEndIdx,
      preferredEnd: bottomEndIdx,
      currentSide: chosen.side,
      endGapPt: r2(bboxPtDist(ends[chosen.ei].point, chosen.bb)),
      alpha: r2(origAlpha),
      beta: 0,
      checks: {
        clearanceOk: origClearanceOk,
        endOk: isNaturallyBelowBottom || isNaturallyAboveTop,
        proximityOk: isNaturallyBelowBottom || isNaturallyAboveTop,
        directionOk: isNaturallyBelowBottom || isNaturallyAboveTop,
        alignmentOk: isHorizCentered,
      },
      rejectReasons,
    },
  };
}
