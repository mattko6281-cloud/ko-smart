// ============================================================================
// KO-SMART 스마트 라벨 — Unit 3-B (Step 1): 좌표축 눈금 숫자(Axis Ticks) 겹침 자동 해결 모듈
// ============================================================================
// 개발 원칙:
//  1) 기존 함수식 라벨(role === "function") 자동 정렬 알고리즘(Unit 1 + Unit 2/2+ + Unit 3-A)은
//     단 한 줄도 변경하지 않는다.
//  2) 자동 이동 검토 대상은 x축/y축 위의 독립 눈금 숫자·π 눈금 노드(role === "other", standalone)로
//     엄격히 제한한다 (원점 O, 점 이름 A~Z, 직선 이름 l/m, 점근선 방정식 등은 자동 이동 제외).
//  3) 수학적 기준 좌표 `at (2, 0)` 등은 절대 수정하지 않고, 옵션의 `xshift`, `yshift`만 최소 조정한다.
//  4) 함수식 라벨 이동 및(선택 시) 축 길이 연장 이후에도 눈금 노드에 실제 글자 획 충돌
//     (true-ink-collision, clearance < -0.15pt 또는 라벨 간 겹침 <= 0.05pt)이 남아있는 경우에만 작동한다.
//  5) 하드코딩된 shift 값을 사용하지 않고, 각 눈금 주변의 후보를 탐색하여
//     (a) 모든 곡선·보조선과의 실제 여유 간격(>= 1.35pt),
//     (b) 좌표축과의 여유 간격(>= 2.5pt),
//     (c) 타 라벨과의 여유 간격(>= 3.5pt),
//     (d) 해당 눈금 좌표(tickPointPt)와의 수학적 대응 가독성(이웃 눈금보다 충분히 가깝고
//         앵커 이탈이 최소인 위치)을 모두 만족하는 최적 후보만 선택한다.
//  6) 안전한 후보가 없으면 억지로 이동하지 않고 원본 위치를 유지하며 사유(no-safe-tick-candidate)를 기록한다.
// ============================================================================

import { minDistPolylines } from "../../../../experiments/smart-label-engine/src/geometry.mjs";
import {
  bboxGapRect,
  bboxPtDist,
  bboxFromShift,
  setShifts,
} from "../../../../experiments/smart-label-prototype-v021/src/algorithm.mjs";
import { resolveSceneSymbolicCoordinatesUnit3A } from "./unit3a-overlap-diagnostics.mjs";

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

export const DEFAULT_UNIT3B_TICK_PARAMS = {
  triggerStrokeClearancePt: -0.15, // 이 값 미만일 때 실제 곡선/선분 글자 획 침범으로 판정
  triggerNodeGapPt: 0.05,          // 이 값 이하일 때 타 라벨과 실제 글자 겹침으로 판정
  minSafeStrokeClearancePt: 1.35,  // 이동 후보가 확보해야 할 최소 곡선/보조선 여유 간격 (pt)
  targetStrokeClearancePt: 2.2,    // 충분한 여유로 인정하는 목표 곡선 간격 (pt, 이를 넘으면 앵커 근접성 우선)
  minSafeAxisClearancePt: 2.5,     // 이동 후보가 확보해야 할 최소 좌표축 여유 간격 (pt)
  minSafeNodeGapPt: 3.5,           // 이동 후보가 확보해야 할 최소 타 노드 간격 (pt)
  maxAxisCoordOffsetPt: 6.5,       // 축 위 눈금으로 인정할 축 수직 거리 허용치 (pt, 예: at (-1, 0.1) 포괄)
  minOriginDistPt: 6.5,            // 원점(0,0)과 구분하기 위한 최소 축 거리 (pt)
  maxUnshiftedAnchorDistPt: 16.5,  // 원본(무시프트) 박스와 수학적 기준점 사이 최대 허용 거리 (pt)
  maxXTickHorizGapPt: 8.5,         // x축 눈금 박스가 기준 x좌표에서 수평으로 떨어질 수 있는 최대 간격 (pt)
  maxYTickVertGapPt: 7.5,          // y축 눈금 박스가 기준 y좌표에서 수직으로 떨어질 수 있는 최대 간격 (pt)
  maxTickAnchorDistPt: 16.5,       // 이동 후 눈금 박스와 눈금 기준점 사이 최대 허용 거리 (pt)
  allowCrossAxisFlip: true,        // 동일 사분면/측면에 안전 후보가 전혀 없을 때 축 반대편 플립 허용 여부
};

/**
 * 라벨 텍스트가 순수 수치 눈금(예: $2$, $-1$, $-3$, $\frac{1}{4}$) 또는
 * π 배수/분수 눈금(예: $\pi$, $2\pi$, $\displaystyle \frac{\pi}{2}$, $-\frac{\pi}{6}$)인지 판별한다.
 * (직선 이름 $l, m$, 점 이름 $A, B, P$, 원점 $\rm O$, 미지수 기호 $\alpha, \beta, c, k$ 등은 제외)
 */
export function isPureTickValueLabel(labelRaw) {
  if (!labelRaw || typeof labelRaw !== "string") return false;
  const s = labelRaw
    .replace(/\$/g, "")
    .replace(/\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle|rm|bf|it|normalfont|mathrm|mathbf|mathit|left|right|[bB]ig{1,2}[lr]?|,|;|:|!|quad|qquad)\b/g, "")
    .replace(/\\(?:d|t|c)?frac\b/g, "/")
    .replace(/\\pi\b/g, "P")
    .replace(/[{}\s]/g, "");

  if (!s) return false;
  if (/\\[a-zA-Z]+/.test(s)) return false;
  if (!/[0-9P]/.test(s)) return false;
  if (!/^[0-9+\-./P]+$/.test(s)) return false;
  return true;
}

/**
 * 라벨에서 기대되는 SVG 글리프 문자 집합(숫자 및 π)이 실제 측정된 svgNode.chars 와 부합하는지 확인한다.
 */
function verifyTickSvgGlyphs(labelRaw, svgChars) {
  if (typeof svgChars !== "string" || !svgChars.trim()) return false;
  const normSvg = svgChars.replace(/\u2212/g, "-").replace(/\s+/g, "");
  const expectedDigits = labelRaw.match(/[0-9]/g) || [];
  for (const d of expectedDigits) {
    if (!normSvg.includes(d)) return false;
  }
  if (/\\pi\b/.test(labelRaw)) {
    if (!/[π\u03c0\u{1D70B}]/u.test(normSvg)) return false;
  }
  return true;
}

/**
 * 노드가 Unit 3-B 1단계 자동 이동 대상인 '좌표축 눈금 숫자 노드'인지 판정한다.
 */
export function classifyAxisTickNode(node, scene, cfg = DEFAULT_UNIT3B_TICK_PARAMS) {
  if (!node || node.role !== "other" || node.kind !== "standalone") {
    return { eligible: false, reason: "not-standalone-other-node" };
  }
  if (!node.bbox || !Array.isArray(node.scale) || !node.scale[0] || !node.scale[1]) {
    return { eligible: false, reason: "missing-bbox-or-scale" };
  }
  if (!isPureTickValueLabel(node.label)) {
    return { eligible: false, reason: "non-numeric-tick-label" };
  }

  const hasNumericAt =
    Array.isArray(node.at) && Number.isFinite(node.at[0]) && Number.isFinite(node.at[1]);
  const hasResolvedSymbolicAt =
    Array.isArray(node.resolvedAtPt) &&
    Number.isFinite(node.resolvedAtPt[0]) &&
    Number.isFinite(node.resolvedAtPt[1]) &&
    (node.resolvedAtBy === "numeric-at" ||
      node.resolvedAtBy === "symbolic-expr-at" ||
      (typeof node.resolvedAtBy === "string" && node.resolvedAtBy.startsWith("coordinate-ref")));

  if (node.fallbackAnchorFromBBox && !hasNumericAt && !hasResolvedSymbolicAt) {
    return { eligible: false, reason: "fallback-bbox-anchor-locked" };
  }

  const anchorPt = hasNumericAt ? node.at : hasResolvedSymbolicAt ? node.resolvedAtPt : null;

  if (!anchorPt) {
    return { eligible: false, reason: "unresolved-anchor-coordinate" };
  }

  const svgNode =
    node.svgIndex !== null && node.svgIndex !== undefined && scene?.geom?.nodes
      ? scene.geom.nodes[node.svgIndex]
      : null;
  if (!node.usable) {
    if (!svgNode || !verifyTickSvgGlyphs(node.label, svgNode.chars)) {
      return { eligible: false, reason: "unverified-svg-glyphs" };
    }
  }

  const unshiftedBbox = bboxFromShift(node, [0, 0]);
  const unshiftedDist = bboxPtDist(anchorPt, unshiftedBbox);
  if (unshiftedDist > cfg.maxUnshiftedAnchorDistPt) {
    return { eligible: false, reason: `anchor-too-far(${r2(unshiftedDist)}pt)` };
  }

  const [ax, ay] = anchorPt;
  const hasXAxis = Boolean(scene?.axes?.x);
  const hasYAxis = Boolean(scene?.axes?.y);

  if (hasXAxis && Math.abs(ay) <= cfg.maxAxisCoordOffsetPt && Math.abs(ax) >= cfg.minOriginDistPt) {
    const origCy = (node.bbox.y0 + node.bbox.y1) / 2;
    return {
      eligible: true,
      tickAxis: "x",
      anchorPt,
      tickPointPt: [ax, 0],
      origSideSign: origCy <= 0 ? -1 : 1,
    };
  }

  if (hasYAxis && Math.abs(ax) <= cfg.maxAxisCoordOffsetPt && Math.abs(ay) >= cfg.minOriginDistPt) {
    const origCx = (node.bbox.x0 + node.bbox.x1) / 2;
    return {
      eligible: true,
      tickAxis: "y",
      anchorPt,
      tickPointPt: [0, ay],
      origSideSign: origCx <= 0 ? -1 : 1,
    };
  }

  return { eligible: false, reason: "not-on-coordinate-axis" };
}

/**
 * 함수식 라벨 이동(fnPlan / fnShiftResult)과 선택적 축 연장(axisEditsToApply)이 적용된 후의
 * 유효 선분 배열(strokesEff)과 노드별 현재 바운딩 박스 맵(nodeBoxesById)을 구성한다.
 */
function buildEffectiveSceneStateAfterFnAndAxes(scene, fnPlan, fnShiftResult, axisEditsToApply = []) {
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

  const nodeBoxesById = new Map();
  for (const n of scene.nodes || []) {
    if (!n || !n.bbox || n.role === "marker") continue;
    if (fnMovedShiftById.has(n.id)) {
      nodeBoxesById.set(n.id, bboxFromShift(n, fnMovedShiftById.get(n.id)));
    } else if (fnPlacedBoxById.has(n.id)) {
      nodeBoxesById.set(n.id, fnPlacedBoxById.get(n.id));
    } else if (n.role === "axisLabel" && n.kind === "inline") {
      if (n.trimmed === "x" && dxAxisEndPt !== 0) {
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

  return { strokesEff, nodeBoxesById };
}

/**
 * 주어진 바운딩 박스(bb)의 곡선/축/타 노드 간격을 계산한다.
 */
function evaluateTickBoxClearance(nodeId, bb, strokesEff, nodeBoxesById) {
  const poly = [rectPoly(bb)];
  let minStrokeClearance = Infinity;
  let minAxisClearance = Infinity;
  const collidingStrokes = [];

  for (const s of strokesEff) {
    if (!s || !Array.isArray(s.pts) || s.pts.length < 2) continue;
    const c = minDistPolylines(poly, [{ pts: s.pts, closed: false }]) - (s.halfWidth || 0.5);
    if (s.kind === "axis") {
      if (c < minAxisClearance) minAxisClearance = c;
    } else {
      if (c < minStrokeClearance) minStrokeClearance = c;
      if (c < -0.15) {
        collidingStrokes.push({ index: s.index, clearancePt: r2(c) });
      }
    }
  }

  let minNodeGap = Infinity;
  const collidingNodes = [];
  for (const [otherId, otherBb] of nodeBoxesById.entries()) {
    if (otherId === nodeId || !otherBb) continue;
    const g = bboxGapRect(bb, otherBb);
    if (g < minNodeGap) minNodeGap = g;
    if (g <= 0.05) {
      collidingNodes.push({ id: otherId, gapPt: r2(g) });
    }
  }

  return {
    minStrokeClearance: r2(minStrokeClearance),
    minAxisClearance: r2(minAxisClearance),
    minNodeGap: r2(minNodeGap),
    collidingStrokes,
    collidingNodes,
  };
}

/**
 * 눈금 후보 시프트 목록 생성
 */
function generateTickCandidateShifts(node, tickInfo, cfg = DEFAULT_UNIT3B_TICK_PARAMS) {
  const ox = node.xshift || 0;
  const oy = node.yshift || 0;
  const tier1A = [];
  const tier1B = [];
  const tier2 = [];

  if (tickInfo.tickAxis === "x") {
    for (let dx = -12; dx <= 12; dx++) {
      if (dx === 0) continue;
      tier1A.push({ shift: [ox + dx, oy], tier: 1, subTier: "1A", delta: [dx, 0] });
    }
    for (const dy of [-1, 1]) {
      for (let dx = -12; dx <= 12; dx++) {
        tier1B.push({ shift: [ox + dx, oy + dy], tier: 1, subTier: "1B", delta: [dx, dy] });
      }
    }
    if (cfg.allowCrossAxisFlip) {
      const flipSign = tickInfo.origSideSign < 0 ? 1 : -1;
      for (const dyMag of [10, 11, 12, 9, 13]) {
        const dy = flipSign * dyMag;
        for (let dx = -7; dx <= 7; dx++) {
          tier2.push({ shift: [ox + dx, oy + dy], tier: 2, subTier: "2", delta: [dx, dy] });
        }
      }
    }
  } else {
    for (let dy = -8; dy <= 8; dy++) {
      if (dy === 0) continue;
      tier1A.push({ shift: [ox, oy + dy], tier: 1, subTier: "1A", delta: [0, dy] });
    }
    for (const dx of [1, -1]) {
      for (let dy = -8; dy <= 8; dy++) {
        tier1B.push({ shift: [ox + dx, oy + dy], tier: 1, subTier: "1B", delta: [dx, dy] });
      }
    }
  }

  return { tier1A, tier1B, tier2 };
}

/**
 * 후보 위치(bb)가 해당 눈금 기준점(tickPointPt)과의 수학적 대응 관계 및 가독성 제약을 만족하는지 검사하고 점수를 매긴다.
 */
function evaluateTickCandidateFeasibilityAndScore(
  node,
  tickInfo,
  cand,
  strokesEff,
  nodeBoxesById,
  otherTickPoints,
  cfg = DEFAULT_UNIT3B_TICK_PARAMS
) {
  const [nx, ny] = cand.shift;
  const ox = node.xshift || 0;
  const oy = node.yshift || 0;
  const bb = bboxFromShift(node, [nx, ny]);
  const cx = (bb.x0 + bb.x1) / 2;
  const cy = (bb.y0 + bb.y1) / 2;
  const [tx, ty] = tickInfo.tickPointPt;

  if (tickInfo.tickAxis === "x") {
    const expectedSign = cand.tier === 1 ? tickInfo.origSideSign : -tickInfo.origSideSign;
    if (expectedSign < 0 && bb.y1 > -cfg.minSafeAxisClearancePt) {
      return { feasible: false, reason: "x-axis-clearance-violation" };
    }
    if (expectedSign > 0 && bb.y0 < cfg.minSafeAxisClearancePt) {
      return { feasible: false, reason: "x-axis-clearance-violation" };
    }
  } else {
    const expectedSign = tickInfo.origSideSign;
    if (expectedSign < 0 && bb.x1 > -cfg.minSafeAxisClearancePt) {
      return { feasible: false, reason: "y-axis-clearance-violation" };
    }
    if (expectedSign > 0 && bb.x0 < cfg.minSafeAxisClearancePt) {
      return { feasible: false, reason: "y-axis-clearance-violation" };
    }
  }

  const dTick = bboxPtDist(tickInfo.tickPointPt, bb);
  const maxAnchorDist = cand.tier === 1 ? cfg.maxTickAnchorDistPt : 13.0;
  if (dTick > maxAnchorDist) {
    return { feasible: false, reason: "tick-anchor-too-far" };
  }

  let axisParallelGapPt = 0;
  let axisParallelCenterOffsetPt = 0;
  if (tickInfo.tickAxis === "x") {
    axisParallelGapPt = Math.max(tx - bb.x1, 0, bb.x0 - tx);
    axisParallelCenterOffsetPt = Math.abs(cx - tx);
    const maxHorizGap = cand.tier === 1 ? cfg.maxXTickHorizGapPt : 6.5;
    if (axisParallelGapPt > maxHorizGap) {
      return { feasible: false, reason: "x-tick-horizontal-drift-exceeded" };
    }
  } else {
    axisParallelGapPt = Math.max(ty - bb.y1, 0, bb.y0 - ty);
    axisParallelCenterOffsetPt = Math.abs(cy - ty);
    if (axisParallelGapPt > cfg.maxYTickVertGapPt) {
      return { feasible: false, reason: "y-tick-vertical-drift-exceeded" };
    }
  }

  for (const otp of otherTickPoints) {
    const distBetweenTicks = Math.hypot(tx - otp[0], ty - otp[1]);
    if (distBetweenTicks < 1e-3) continue;
    const dOther = bboxPtDist(otp, bb);
    if (dTick >= dOther * 0.75 || axisParallelCenterOffsetPt >= distBetweenTicks * 0.42) {
      return { feasible: false, reason: "ambiguous-with-neighbor-tick" };
    }
  }

  const clr = evaluateTickBoxClearance(node.id, bb, strokesEff, nodeBoxesById);
  if (clr.minStrokeClearance < cfg.minSafeStrokeClearancePt) {
    return { feasible: false, reason: "insufficient-stroke-clearance", clr };
  }
  if (clr.minAxisClearance < cfg.minSafeAxisClearancePt) {
    return { feasible: false, reason: "insufficient-axis-clearance", clr };
  }
  if (clr.minNodeGap < cfg.minSafeNodeGapPt) {
    return { feasible: false, reason: "insufficient-node-gap", clr };
  }

  const effectiveClearance = Math.min(clr.minStrokeClearance, cfg.targetStrokeClearancePt);
  const extraClearance = Math.max(0, clr.minStrokeClearance - cfg.targetStrokeClearancePt);
  const shiftDist = Math.hypot(nx - ox, ny - oy);
  const orthoPenalty =
    tickInfo.tickAxis === "x" && cand.tier === 1
      ? Math.abs(ny - oy) * 4.0
      : tickInfo.tickAxis === "y" && cand.tier === 1
        ? Math.abs(nx - ox) * 4.0
        : 0;
  const yDownPrefBonus = tickInfo.tickAxis === "y" && ny < oy ? 0.5 : 0;

  const score =
    100.0 +
    effectiveClearance * 10.0 +
    Math.min(extraClearance, 2.0) * 0.8 -
    axisParallelGapPt * 3.2 -
    dTick * 1.8 -
    axisParallelCenterOffsetPt * 0.7 -
    shiftDist * 0.65 -
    orthoPenalty +
    yDownPrefBonus;

  return {
    feasible: true,
    score: r2(score),
    shift: [nx, ny],
    deltaShiftPt: [r2(nx - ox), r2(ny - oy)],
    tier: cand.tier,
    bbox: bb,
    dTickPt: r2(dTick),
    axisParallelGapPt: r2(axisParallelGapPt),
    axisParallelCenterOffsetPt: r2(axisParallelCenterOffsetPt),
    clearance: clr,
  };
}

/**
 * [Unit 3-B Step 1] 장면 내 좌표축 눈금 숫자의 실제 글자 겹침을 검사하고,
 * 안전하고 가독성 높은 미세 이동(xshift/yshift) 플랜 및 텍스트 편집(edits)을 생성한다.
 */
export function planAxisTickOverlapsUnit3B(
  scene,
  fnPlan,
  fnShiftResult,
  axisEditsToApply = [],
  cfg = DEFAULT_UNIT3B_TICK_PARAMS
) {
  const result = {
    edits: [],
    movedTicks: [],
    heldTicks: [],
    decisions: [],
    decisionsByNodeId: new Map(),
  };

  if (!scene || !scene.ok || !Array.isArray(scene.nodes)) return result;

  resolveSceneSymbolicCoordinatesUnit3A(scene);

  const { strokesEff, nodeBoxesById } = buildEffectiveSceneStateAfterFnAndAxes(
    scene,
    fnPlan,
    fnShiftResult,
    axisEditsToApply
  );

  const classifiedTicks = [];
  for (const n of scene.nodes) {
    const info = classifyAxisTickNode(n, scene, cfg);
    if (info.eligible) {
      classifiedTicks.push({ node: n, info });
    }
  }

  for (const { node: n, info } of classifiedTicks) {
    const origBb = nodeBoxesById.get(n.id) || n.bbox;
    const origClr = evaluateTickBoxClearance(n.id, origBb, strokesEff, nodeBoxesById);
    const hasTrueInkStrokeOverlap = origClr.minStrokeClearance < cfg.triggerStrokeClearancePt;
    const hasTrueInkNodeOverlap = origClr.minNodeGap <= cfg.triggerNodeGapPt;

    const ox = n.xshift || 0;
    const oy = n.yshift || 0;

    if (!hasTrueInkStrokeOverlap && !hasTrueInkNodeOverlap) {
      const keepDec = {
        id: n.id,
        label: n.label,
        role: n.role,
        tickAxis: info.tickAxis,
        axisKind: info.tickAxis === "x" ? "x-tick" : "y-tick",
        tickPointPt: info.tickPointPt,
        action: "keep",
        autoModified: false,
        selectedEngine: "Unit 3-B-ticks",
        oldShift: [ox, oy],
        origShift: [ox, oy],
        newShift: [ox, oy],
        shift: [ox, oy],
        deltaShiftPt: [0, 0],
        origClearancePt: origClr.minStrokeClearance,
        finalClearancePt: origClr.minStrokeClearance,
        nonMoveCategory: "기존 위치 유지",
        reason: "원본 눈금 위치에 실제 글자 획 겹침이 없어 기존 위치 유지",
        selectionReason: "원본 눈금 위치에 실제 글자 획 겹침이 없어 기존 위치 유지",
        holdReason: "원본 눈금 위치에 실제 글자 획 겹침이 없어 기존 위치 유지",
      };
      result.decisions.push(keepDec);
      result.decisionsByNodeId.set(n.id, keepDec);
      continue;
    }

    const otherTickPoints = classifiedTicks
      .filter((t) => t.node.id !== n.id && t.info.tickAxis === info.tickAxis)
      .map((t) => t.info.tickPointPt);

    const { tier1A, tier1B, tier2 } = generateTickCandidateShifts(n, info, cfg);
    const evalList = (cands) => {
      const out = [];
      for (const cand of cands) {
        const ev = evaluateTickCandidateFeasibilityAndScore(
          n,
          info,
          cand,
          strokesEff,
          nodeBoxesById,
          otherTickPoints,
          cfg
        );
        if (ev.feasible) out.push(ev);
      }
      out.sort((a, b) => b.score - a.score);
      return out;
    };

    let chosen = null;
    const feasible1A = evalList(tier1A);
    if (feasible1A.length > 0) {
      chosen = feasible1A[0];
    } else {
      const feasible1B = evalList(tier1B);
      if (feasible1B.length > 0) {
        chosen = feasible1B[0];
      } else if (tier2.length > 0) {
        const feasible2 = evalList(tier2);
        if (feasible2.length > 0) {
          chosen = feasible2[0];
        }
      }
    }

    if (!chosen) {
      const holdReasonText = `눈금 숫자(${n.label})와 선/곡선 간 겹침(${origClr.minStrokeClearance}pt)이 감지되었으나 주변 공간 협소로 안전한 미세 이동 후보가 없어 원본 위치 유지 (조이스틱/수동 조정 권장)`;
      const holdDec = {
        id: n.id,
        label: n.label,
        role: n.role,
        tickAxis: info.tickAxis,
        axisKind: info.tickAxis === "x" ? "x-tick" : "y-tick",
        tickPointPt: info.tickPointPt,
        action: "hold-no-safe-tick-candidate",
        nonMoveCode: "no-safe-tick-candidate",
        nonMoveCategory: "안전 후보 없음",
        autoModified: false,
        selectedEngine: "Unit 3-B-ticks",
        oldShift: [ox, oy],
        origShift: [ox, oy],
        newShift: [ox, oy],
        shift: [ox, oy],
        deltaShiftPt: [0, 0],
        origClearancePt: origClr.minStrokeClearance,
        finalClearancePt: origClr.minStrokeClearance,
        reason: holdReasonText,
        selectionReason: holdReasonText,
        holdReason: holdReasonText,
      };
      result.heldTicks.push(holdDec);
      result.decisions.push(holdDec);
      result.decisionsByNodeId.set(n.id, holdDec);
      continue;
    }

    nodeBoxesById.set(n.id, chosen.bbox);
    const edit = setShifts(n, chosen.shift[0], chosen.shift[1]);
    result.edits.push({
      kind: "label-shift",
      subKind: "tick-shift",
      id: n.id,
      start: edit.start,
      end: edit.end,
      replacement: edit.replacement,
    });

    const moveReasonText = `${info.tickAxis}축 눈금(${n.label})의 실제 글자 획 겹침(${origClr.minStrokeClearance}pt) 해소를 위해 미세 조정(xshift=${chosen.shift[0]}pt, yshift=${chosen.shift[1]}pt → 여유 ${chosen.clearance.minStrokeClearance}pt 확보)`;
    const moveDec = {
      id: n.id,
      label: n.label,
      role: n.role,
      tickAxis: info.tickAxis,
      axisKind: info.tickAxis === "x" ? "x-tick" : "y-tick",
      tickPointPt: info.tickPointPt,
      action: "move-tick",
      autoModified: true,
      selectedEngine: "Unit 3-B-ticks",
      tier: chosen.tier,
      oldShift: [ox, oy],
      origShift: [ox, oy],
      newShift: chosen.shift,
      shift: chosen.shift,
      deltaShiftPt: chosen.deltaShiftPt,
      bbox: chosen.bbox,
      origClearancePt: origClr.minStrokeClearance,
      finalClearancePt: chosen.clearance.minStrokeClearance,
      dTickPt: chosen.dTickPt,
      score: chosen.score,
      reason: moveReasonText,
      selectionReason: moveReasonText,
      holdReason: null,
      nonMoveCategory: null,
    };
    result.movedTicks.push(moveDec);
    result.decisions.push(moveDec);
    result.decisionsByNodeId.set(n.id, moveDec);
  }

  return result;
}
