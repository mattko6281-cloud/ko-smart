// ============================================================================
// KO-SMART 스마트 라벨 — Unit 3-D-Origin: 원점 O 전용 4방향 자동 배치 규칙 모듈
// ============================================================================
// 개발 원칙:
//  1) 일반 노드 전체의 이동이 아니라, 우리 연구소 TikZ 가이드에 정의된 표준 원점 O 노드만 다룬다:
//     \node [below left, inner sep=1pt, transform shape, xscale=0.9] at (0,0) {$\rm O$};
//     (공백·옵션 순서 변형 및 inner sep=2pt 허용, 단 xshift/yshift 등 수동 커스텀 옵션이 있으면 보존)
//  2) 반드시 x축과 y축이 모두 존재하고 (0,0)에서 교차하는 경우에만 인식한다.
//     축이 없거나 원점이 불명확한 그림, 일반 점 이름(A, B, P, M 또는 원점이 아닌 O)은 절대 이동하지 않는다.
//  3) 원점 O의 4방향 사분면 후보 우선순위:
//     1순위: below left  (제3사분면, 기본값)
//     2순위: above left  (제2사분면, 1차 대체)
//     3순위: below right (제4사분면, 2차 대체)
//     4순위: above right (제1사분면, 최종 대체)
//  4) 함수식 라벨(Unit 2/3-C), 축 연장, 눈금 숫자(Unit 3-B)가 모두 배치된 후의 상태에서
//     현재 원점 위치에 충돌(곡선/직선/보조선/축/눈금/다른 라벨 침범)이 없을 때는 절대 이동하지 않는다.
//  5) 현재 위치에 충돌이 있을 때만 위 4개 후보를 우선순위 순서대로 검사하여 가장 우선순위가 높은
//     무충돌 사분면 방향으로 TikZ 방향 옵션만 변경한다 (xshift/yshift 고정 숫자 하드코딩 금지).
//  6) 네 방향 모두 충돌 위험이 있으면 억지로 이동하지 않고 원본을 유지하며 미해결 사유를 기록한다.
// ============================================================================

import { minDistPolylines } from "../../../../experiments/smart-label-engine/src/geometry.mjs";
import {
  bboxGapRect,
  bboxFromShift,
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

export const ORIGIN_ANCHOR_PRIORITY = [
  "below left",
  "above left",
  "below right",
  "above right",
];

export const DEFAULT_UNIT3D_ORIGIN_PARAMS = {
  triggerStrokeClearancePt: 0.5,  // 현재 위치에서 곡선/직선/보조선과의 간격이 이 값 미만이면 충돌로 판정
  triggerNodeGapPt: 0.5,          // 현재 위치에서 타 텍스트 노드와의 간격이 이 값 이하이면 충돌로 판정
  triggerAxisClearancePt: 1.0,    // 현재 위치에서 좌표축과의 간격이 이 값 미만이면 충돌로 판정
  minSafeStrokeClearancePt: 1.5,  // 이동 후보가 확보해야 할 최소 곡선/직선/보조선 여유 간격 (pt)
  minSafeNodeGapPt: 1.5,          // 이동 후보가 확보해야 할 최소 타 노드 여유 간격 (pt)
  minSafeAxisClearancePt: 1.5,    // 이동 후보가 확보해야 할 최소 좌표축 여유 간격 (pt)
  minSafeMarkerGapPt: 1.0,        // 이동 후보가 원점 외 점 마커와 확보해야 할 최소 간격 (pt)
};

function splitTopLevelOptions(optionsRaw) {
  const parts = [];
  let depth = 0;
  let start = 0;
  const s = String(optionsRaw || "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = s.slice(start).trim();
  if (tail) parts.push(tail);
  return parts.filter(Boolean);
}

/**
 * 원점 노드의 대괄호 옵션 문자열을 분석하여 연구소 표준 원점 옵션인지 검사한다.
 * - 허용 옵션: 방향(below left | above left | below right | above right),
 *              inner sep=1pt (또는 2pt), transform shape, xscale=0.9
 * - 이미 xshift/yshift 나 기타 커스텀 옵션이 있으면 덮어쓰지 않고 안전 보류한다.
 */
export function parseStandardOriginOptionsUnit3D(optionsRaw) {
  if (typeof optionsRaw !== "string" || !optionsRaw.trim()) {
    return { valid: false, reason: "empty-options" };
  }

  const tokens = splitTopLevelOptions(optionsRaw);
  let anchor = null;
  let innerSep = null;
  let hasTransformShape = false;
  let hasXscale09 = false;
  const customTokens = [];

  for (const tok of tokens) {
    const norm = tok.replace(/\s+/g, " ").trim();
    if (/^(below left|above left|below right|above right)$/.test(norm)) {
      if (anchor !== null) {
        return { valid: false, reason: "multiple-anchor-options" };
      }
      anchor = norm;
    } else if (/^inner sep\s*=\s*(?:1|2)(?:\.0+)?\s*pt$/.test(norm)) {
      innerSep = norm.replace(/\s+/g, "");
    } else if (norm === "transform shape") {
      hasTransformShape = true;
    } else if (/^xscale\s*=\s*0\.9(?:0*)?$/.test(norm)) {
      hasXscale09 = true;
    } else {
      customTokens.push(norm);
    }
  }

  if (customTokens.length > 0) {
    const hasShift = customTokens.some((t) => /^(?:xshift|yshift)\s*=/.test(t));
    return {
      valid: false,
      hasCustomOptions: true,
      hasCustomShift: hasShift,
      customTokens,
      reason: hasShift ? "custom-shift-already-present" : "non-standard-origin-options",
    };
  }

  if (!anchor || !innerSep || !hasTransformShape || !hasXscale09) {
    return {
      valid: false,
      hasCustomOptions: false,
      reason: "missing-standard-origin-attributes",
    };
  }

  return {
    valid: true,
    anchor,
    innerSep,
  };
}

/**
 * 장면(scene)에 x축과 y축이 실제로 존재하고 원점 (0,0)에서 교차하는지 확인한다.
 */
export function hasIntersectingAxesAtOriginUnit3D(scene) {
  const xAxis = scene?.axes?.x;
  const yAxis = scene?.axes?.y;
  if (!xAxis || !yAxis) return false;

  const xMin = Math.min(xAxis.from, xAxis.to);
  const xMax = Math.max(xAxis.from, xAxis.to);
  const yMin = Math.min(yAxis.from, yAxis.to);
  const yMax = Math.max(yAxis.from, yAxis.to);

  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || !Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    return false;
  }

  // 두 축이 (0,0)을 실제로 포함하거나 교차해야 함
  if (xMin > 0.05 || xMax < -0.05) return false;
  if (yMin > 0.05 || yMax < -0.05) return false;

  return true;
}

function getOptionsRangeSpan(node) {
  if (
    Array.isArray(node?.optionsRange) &&
    typeof node.optionsRange[0] === "number" &&
    typeof node.optionsRange[1] === "number"
  ) {
    return [node.optionsRange[0], node.optionsRange[1]];
  }
  if (
    node?.optionsRange &&
    typeof node.optionsRange.start === "number" &&
    typeof node.optionsRange.end === "number"
  ) {
    return [node.optionsRange.start, node.optionsRange.end];
  }
  return null;
}

/**
 * 주어진 노드가 Unit 3-D-Origin 전용 배치 규칙의 정확한 대상인지 판별한다.
 */
export function classifyOriginNodeUnit3D(node, scene) {
  if (!hasIntersectingAxesAtOriginUnit3D(scene)) {
    return { eligible: false, reason: "axes-not-intersecting-at-origin" };
  }
  if (!node || node.role !== "origin" || node.kind !== "standalone") {
    return { eligible: false, reason: "not-standalone-origin-node" };
  }
  if (
    !node.bbox ||
    !Number.isFinite(node.bbox.x0) ||
    !Number.isFinite(node.bbox.y0) ||
    !Number.isFinite(node.bbox.x1) ||
    !Number.isFinite(node.bbox.y1)
  ) {
    return { eligible: false, reason: "missing-measured-bbox" };
  }
  if (!Array.isArray(node.at) || Math.abs(node.at[0]) > 0.5 || Math.abs(node.at[1]) > 0.5) {
    return { eligible: false, reason: "not-at-zero-zero" };
  }
  const optSpan = getOptionsRangeSpan(node);
  if (!optSpan) {
    return { eligible: false, reason: "missing-options-range" };
  }

  const rawStmt =
    typeof scene?.body === "string" && typeof node.start === "number" && typeof node.end === "number"
      ? scene.body.slice(node.start, node.end)
      : "";

  if (!/^\\node\b/.test(rawStmt.trim())) {
    return { eligible: false, reason: "not-standard-node-command" };
  }
  if (!/\bat\s*\(\s*0(?:\.0+)?\s*,\s*0(?:\.0+)?\s*\)/.test(rawStmt)) {
    return { eligible: false, reason: "not-explicit-at-origin" };
  }
  if (!/\{\s*\$\s*(?:\\rm\s+O|\\mathrm\s*\{\s*O\s*\})\s*\$\s*\}/.test(rawStmt)) {
    return { eligible: false, reason: "not-standard-rm-O-label" };
  }

  const parsedOpts = parseStandardOriginOptionsUnit3D(node.optionsRaw);
  if (!parsedOpts.valid) {
    return {
      eligible: false,
      reason: parsedOpts.reason,
      hasCustomOptions: Boolean(parsedOpts.hasCustomOptions),
      hasCustomShift: Boolean(parsedOpts.hasCustomShift),
    };
  }

  return {
    eligible: true,
    origAnchor: parsedOpts.anchor,
    innerSep: parsedOpts.innerSep,
  };
}

/**
 * 측정된 원점 O 바운딩 박스(origBbox)를 기준으로 4개 사분면 방향 후보의 바운딩 박스를 계산한다.
 * TikZ에서 at (0,0) 기준 below left / above left / below right / above right 는
 * x=0 및 y=0 축에 대해 정확히 대칭인 사분면 박스를 형성한다.
 */
export function computeOriginQuadrantBboxUnit3D(origBbox, targetAnchor) {
  const w = origBbox.x1 - origBbox.x0;
  const h = origBbox.y1 - origBbox.y0;
  const mx = Math.min(Math.abs(origBbox.x0), Math.abs(origBbox.x1));
  const my = Math.min(Math.abs(origBbox.y0), Math.abs(origBbox.y1));

  switch (targetAnchor) {
    case "below left":
      return { x0: -(mx + w), x1: -mx, y0: -(my + h), y1: -my };
    case "above left":
      return { x0: -(mx + w), x1: -mx, y0: my, y1: my + h };
    case "below right":
      return { x0: mx, x1: mx + w, y0: -(my + h), y1: -my };
    case "above right":
      return { x0: mx, x1: mx + w, y0: my, y1: my + h };
    default:
      return { ...origBbox };
  }
}

/**
 * 원점 노드의 옵션 대괄호 텍스트('[below left, inner sep=1pt, transform shape, xscale=0.9]')에서
 * 방향 옵션 토큰만 새 방향으로 교체하고 나머지 속성은 그대로 보존한다.
 */
export function replaceOriginAnchorOptionTextUnit3D(optionsBracketText, newAnchor) {
  return String(optionsBracketText).replace(
    /\b(below\s+left|above\s+left|below\s+right|above\s+right)\b/,
    newAnchor
  );
}

/**
 * 함수식 라벨(Unit 2/3-C), 축 연장, 눈금 숫자(Unit 3-B) 이동까지 모두 반영된 유효 장면 상태를 구성한다.
 */
function buildEffectiveSceneStateBeforeOriginUnit3D(
  scene,
  fnPlan,
  fnShiftResult,
  axisEditsToApply = [],
  tickPlan = null
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

  const nodeBoxesById = new Map();
  const nonOriginMarkerBoxes = [];

  for (const n of scene.nodes || []) {
    if (!n || !n.bbox) continue;
    if (n.role === "marker") {
      const atPt = n.resolvedAtPt || n.at || [
        (n.bbox.x0 + n.bbox.x1) / 2,
        (n.bbox.y0 + n.bbox.y1) / 2,
      ];
      if (Math.hypot(atPt[0] || 0, atPt[1] || 0) > 2.5) {
        nonOriginMarkerBoxes.push({ id: n.id, bbox: { ...n.bbox } });
      }
      continue;
    }

    if (tickMovedBoxById.has(n.id)) {
      nodeBoxesById.set(n.id, { ...tickMovedBoxById.get(n.id), label: n.label, role: n.role });
    } else if (fnMovedShiftById.has(n.id)) {
      nodeBoxesById.set(n.id, {
        ...bboxFromShift(n, fnMovedShiftById.get(n.id)),
        label: n.label,
        role: n.role,
      });
    } else if (fnPlacedBoxById.has(n.id)) {
      nodeBoxesById.set(n.id, { ...fnPlacedBoxById.get(n.id), label: n.label, role: n.role });
    } else if (n.role === "axisLabel" && n.kind === "inline") {
      if ((n.trimmed === "x" || n.trimmed === "\\theta" || n.trimmed === "t") && dxAxisEndPt !== 0) {
        nodeBoxesById.set(n.id, {
          x0: n.bbox.x0 + dxAxisEndPt,
          x1: n.bbox.x1 + dxAxisEndPt,
          y0: n.bbox.y0,
          y1: n.bbox.y1,
          label: n.label,
          role: n.role,
        });
      } else if (n.trimmed === "y" && dyAxisEndPt !== 0) {
        nodeBoxesById.set(n.id, {
          x0: n.bbox.x0,
          x1: n.bbox.x1,
          y0: n.bbox.y0 + dyAxisEndPt,
          y1: n.bbox.y1 + dyAxisEndPt,
          label: n.label,
          role: n.role,
        });
      } else {
        nodeBoxesById.set(n.id, { ...n.bbox, label: n.label, role: n.role });
      }
    } else {
      nodeBoxesById.set(n.id, { ...n.bbox, label: n.label, role: n.role });
    }
  }

  const axisBoundsPt = {
    xMinPt: xAxisNew ? Math.min(xAxisNew[0], xAxisNew[1]) * xU : -Infinity,
    xMaxPt: xAxisNew ? Math.max(xAxisNew[0], xAxisNew[1]) * xU : Infinity,
    yMinPt: yAxisNew ? Math.min(yAxisNew[0], yAxisNew[1]) * yU : -Infinity,
    yMaxPt: yAxisNew ? Math.max(yAxisNew[0], yAxisNew[1]) * yU : Infinity,
  };

  return { strokesEff, nodeBoxesById, nonOriginMarkerBoxes, axisBoundsPt };
}

/**
 * 특정 사분면 후보 바운딩 박스(bb)의 곡선/보조선, 좌표축, 타 노드, 점 마커 간격을 측정한다.
 */
export function evaluateOriginCandidateBoxUnit3D(
  originNodeId,
  anchor,
  bb,
  strokesEff,
  nodeBoxesById,
  nonOriginMarkerBoxes = [],
  axisBoundsPt = null,
  cfg = DEFAULT_UNIT3D_ORIGIN_PARAMS
) {
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
      if (c < cfg.minSafeStrokeClearancePt) {
        collidingStrokes.push({ index: s.index, clearancePt: r2(c) });
      }
    }
  }

  let minNodeGap = Infinity;
  let closestNodeLabel = null;
  const collidingNodes = [];
  for (const [otherId, otherBb] of nodeBoxesById.entries()) {
    if (otherId === originNodeId || !otherBb) continue;
    const g = bboxGapRect(bb, otherBb);
    if (g < minNodeGap) {
      minNodeGap = g;
      closestNodeLabel = otherBb.label || otherId;
    }
    if (g < cfg.minSafeNodeGapPt) {
      collidingNodes.push({ id: otherId, label: otherBb.label || otherId, gapPt: r2(g) });
    }
  }

  let minMarkerGap = Infinity;
  for (const mk of nonOriginMarkerBoxes) {
    if (!mk?.bbox) continue;
    const g = bboxGapRect(bb, mk.bbox);
    if (g < minMarkerGap) minMarkerGap = g;
  }

  // 축 끝단(화살촉) 밖으로 원점 글자가 돌출되지 않는지 확인
  let withinAxisSpan = true;
  if (axisBoundsPt) {
    if (bb.x0 < axisBoundsPt.xMinPt + 2.0 || bb.x1 > axisBoundsPt.xMaxPt - 4.0) {
      withinAxisSpan = false;
    }
    if (bb.y0 < axisBoundsPt.yMinPt + 2.0 || bb.y1 > axisBoundsPt.yMaxPt - 4.0) {
      withinAxisSpan = false;
    }
  }

  const minStroke = Number.isFinite(minStrokeClearance) ? r2(minStrokeClearance) : 999;
  const minAxis = Number.isFinite(minAxisClearance) ? r2(minAxisClearance) : 999;
  const minNode = Number.isFinite(minNodeGap) ? r2(minNodeGap) : 999;
  const minMarker = Number.isFinite(minMarkerGap) ? r2(minMarkerGap) : 999;

  const hasCurrentCollision =
    minStroke < cfg.triggerStrokeClearancePt ||
    minNode <= cfg.triggerNodeGapPt ||
    minAxis < cfg.triggerAxisClearancePt ||
    minMarker < cfg.minSafeMarkerGapPt;

  const isSafeCandidate =
    withinAxisSpan &&
    minStroke >= cfg.minSafeStrokeClearancePt &&
    minNode >= cfg.minSafeNodeGapPt &&
    minAxis >= cfg.minSafeAxisClearancePt &&
    minMarker >= cfg.minSafeMarkerGapPt;

  return {
    anchor,
    bbox: bb,
    minStrokeClearance: minStroke,
    minAxisClearance: minAxis,
    minNodeGap: minNode,
    minMarkerGap: minMarker,
    closestNodeLabel,
    withinAxisSpan,
    hasCurrentCollision,
    isSafeCandidate,
    collidingStrokes,
    collidingNodes,
  };
}

/**
 * [Unit 3-D-Origin] 장면 내 표준 원점 O 노드의 충돌 여부를 검사하고,
 * 현재 위치에 충돌이 있을 때만 4방향 우선순위(below left -> above left -> below right -> above right)에 따라
 * 가장 우선순위가 높은 무충돌 사분면 방향으로 배치 계획을 수립한다.
 */
export function planOriginNodeUnit3D(
  scene,
  fnPlan,
  fnShiftResult,
  axisEditsToApply = [],
  tickPlan = null,
  cfg = DEFAULT_UNIT3D_ORIGIN_PARAMS
) {
  const result = {
    edits: [],
    movedOrigins: [],
    heldOrigins: [],
    decisions: [],
    decisionsByNodeId: new Map(),
  };

  if (!scene || !scene.ok || !Array.isArray(scene.nodes)) return result;

  resolveSceneSymbolicCoordinatesUnit3A(scene);

  const { strokesEff, nodeBoxesById, nonOriginMarkerBoxes, axisBoundsPt } =
    buildEffectiveSceneStateBeforeOriginUnit3D(
      scene,
      fnPlan,
      fnShiftResult,
      axisEditsToApply,
      tickPlan
    );

  const originNodes = scene.nodes.filter((n) => n && n.role === "origin");
  for (const n of originNodes) {
    const cls = classifyOriginNodeUnit3D(n, scene);
    if (!cls.eligible) {
      if (cls.hasCustomOptions) {
        const customHoldDec = {
          id: n.id,
          label: n.label,
          role: "origin",
          action: "hold-custom-origin-options",
          nonMoveCode: "custom-origin-options",
          nonMoveCategory: "수동 옵션 보존",
          autoModified: false,
          selectedEngine: "Unit 3-D-Origin",
          origAnchor: null,
          newAnchor: null,
          reason: `원점(${n.label}) 노드에 이미 수동 조정 옵션(${n.optionsRaw})이 포함되어 있어 덮어쓰지 않고 보존`,
          selectionReason: `원점(${n.label}) 노드에 이미 수동 조정 옵션이 포함되어 있어 원본 유지`,
          holdReason: `원점(${n.label}) 노드에 이미 수동 조정 옵션이 포함되어 있어 원본 유지`,
        };
        result.decisions.push(customHoldDec);
        result.decisionsByNodeId.set(n.id, customHoldDec);
      }
      continue;
    }

    const origAnchor = cls.origAnchor;
    const origBb = computeOriginQuadrantBboxUnit3D(n.bbox, origAnchor);
    const origEval = evaluateOriginCandidateBoxUnit3D(
      n.id,
      origAnchor,
      origBb,
      strokesEff,
      nodeBoxesById,
      nonOriginMarkerBoxes,
      axisBoundsPt,
      cfg
    );

    const candidateEvaluations = ORIGIN_ANCHOR_PRIORITY.map((anchorDir, idx) => {
      const bb = computeOriginQuadrantBboxUnit3D(n.bbox, anchorDir);
      const ev = evaluateOriginCandidateBoxUnit3D(
        n.id,
        anchorDir,
        bb,
        strokesEff,
        nodeBoxesById,
        nonOriginMarkerBoxes,
        axisBoundsPt,
        cfg
      );
      return {
        ...ev,
        priorityRank: idx + 1,
      };
    });

    // 1) 현재 원점 위치(기본 below left 등)에 충돌이 없으면 절대 이동하지 않고 원본 유지
    if (!origEval.hasCurrentCollision) {
      const keepReason = `원점(${n.label})이 현재 위치(${origAnchor})에서 곡선(${origEval.minStrokeClearance}pt)·타 라벨(${origEval.minNodeGap}pt)과 충돌이 없어 원본 유지`;
      const keepDec = {
        id: n.id,
        label: n.label,
        role: "origin",
        action: "keep",
        nonMoveCode: "keep-original",
        nonMoveCategory: "기존 위치 유지",
        autoModified: false,
        selectedEngine: "Unit 3-D-Origin",
        origAnchor,
        newAnchor: origAnchor,
        bbox: origBb,
        origClearancePt: origEval.minStrokeClearance,
        finalClearancePt: origEval.minStrokeClearance,
        origNodeGapPt: origEval.minNodeGap,
        finalNodeGapPt: origEval.minNodeGap,
        candidateEvaluations,
        reason: keepReason,
        selectionReason: keepReason,
        holdReason: keepReason,
      };
      result.decisions.push(keepDec);
      result.decisionsByNodeId.set(n.id, keepDec);
      continue;
    }

    // 2) 현재 위치에 충돌이 있으면 4방향 후보를 우선순위(below left -> above left -> below right -> above right) 순서로 검사
    const chosen = candidateEvaluations.find((cand) => cand.isSafeCandidate) || null;

    if (!chosen || chosen.anchor === origAnchor) {
      const holdReason = `원점(${n.label})의 현재 위치(${origAnchor})에서 겹침(곡선 ${origEval.minStrokeClearance}pt, 라벨 ${origEval.minNodeGap}pt)이 감지되었으나 4방향(below left, above left, below right, above right) 모두 안전 기준을 만족하지 못해 원본 위치 유지 (수동 조정 권장)`;
      const holdDec = {
        id: n.id,
        label: n.label,
        role: "origin",
        action: "hold-no-safe-quadrant",
        nonMoveCode: "no-safe-origin-quadrant",
        nonMoveCategory: "안전 사분면 없음",
        autoModified: false,
        selectedEngine: "Unit 3-D-Origin",
        origAnchor,
        newAnchor: origAnchor,
        bbox: origBb,
        origClearancePt: origEval.minStrokeClearance,
        finalClearancePt: origEval.minStrokeClearance,
        origNodeGapPt: origEval.minNodeGap,
        finalNodeGapPt: origEval.minNodeGap,
        candidateEvaluations,
        reason: holdReason,
        selectionReason: holdReason,
        holdReason,
      };
      result.heldOrigins.push(holdDec);
      result.decisions.push(holdDec);
      result.decisionsByNodeId.set(n.id, holdDec);
      continue;
    }

    const optSpan = getOptionsRangeSpan(n);
    if (!optSpan) {
      continue;
    }
    const [optStart, optEnd] = optSpan;
    const origOptionsBracket = scene.body.slice(optStart, optEnd);
    const replacementOptionsBracket = replaceOriginAnchorOptionTextUnit3D(
      origOptionsBracket,
      chosen.anchor
    );

    if (replacementOptionsBracket === origOptionsBracket) {
      continue;
    }

    nodeBoxesById.set(n.id, { ...chosen.bbox, label: n.label, role: n.role });
    result.edits.push({
      kind: "origin-anchor",
      subKind: "origin-quadrant-anchor",
      id: n.id,
      origAnchor,
      newAnchor: chosen.anchor,
      start: optStart,
      end: optEnd,
      replacement: replacementOptionsBracket,
    });

    const collisionCauseDesc =
      origEval.minStrokeClearance < cfg.triggerStrokeClearancePt &&
      origEval.minNodeGap <= cfg.triggerNodeGapPt
        ? `곡선 침범(${origEval.minStrokeClearance}pt) 및 라벨(${origEval.closestNodeLabel}) 겹침(${origEval.minNodeGap}pt)`
        : origEval.minNodeGap <= cfg.triggerNodeGapPt
          ? `인접 라벨(${origEval.closestNodeLabel})과 겹침(${origEval.minNodeGap}pt)`
          : `곡선/직선 침범(${origEval.minStrokeClearance}pt)`;

    const moveReason = `원점(${n.label})의 기본 위치(${origAnchor})에서 ${collisionCauseDesc}이(가) 감지되어 ${chosen.priorityRank}순위 안전 방향(${chosen.anchor})으로 이동 (곡선 여유 ${chosen.minStrokeClearance}pt, 라벨 간격 ${chosen.minNodeGap}pt 확보)`;

    const moveDec = {
      id: n.id,
      label: n.label,
      role: "origin",
      action: "move-origin",
      autoModified: true,
      selectedEngine: "Unit 3-D-Origin",
      priorityRank: chosen.priorityRank,
      origAnchor,
      newAnchor: chosen.anchor,
      bbox: chosen.bbox,
      origClearancePt: origEval.minStrokeClearance,
      finalClearancePt: chosen.minStrokeClearance,
      origNodeGapPt: origEval.minNodeGap,
      finalNodeGapPt: chosen.minNodeGap,
      candidateEvaluations,
      reason: moveReason,
      selectionReason: moveReason,
      holdReason: null,
      nonMoveCode: null,
      nonMoveCategory: null,
    };

    result.movedOrigins.push(moveDec);
    result.decisions.push(moveDec);
    result.decisionsByNodeId.set(n.id, moveDec);
  }

  return result;
}
