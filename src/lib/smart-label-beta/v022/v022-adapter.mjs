// ============================================================================
// KO-SMART 스마트 라벨 v0.2.2 Beta (interim-v1 기반) 어댑터 모듈
// ============================================================================
// 역할:
//  - 동결 검증된 interim-v1(Unit 1 + Unit 2/2+ + Unit 3-A) 알고리즘과 임계값을
//    1글자도 변경하지 않고 그대로 호출하되,
//  - KO-SMART 운영 베타(kroki-recommend.mjs / SmartLabelBetaModal.tsx)의
//    Kroki 비동기 SVG 스테이징 구조 및 응답 스키마(labelDecisions, collisionDiagnostics,
//    2차 검증 verifyOutputVariant)와 100% 호환되도록 연결한다.
//  - 로컬 latex / dvisvgm 명령에 절대 의존하지 않고 tempWorkRoot 에 스테이징된
//    Kroki SVG 만을 읽어 동작한다.
// ============================================================================

import { buildScene } from "../../../../experiments/smart-label-prototype-v021/src/scene.mjs";
import {
  PARAMS,
  classifyStrokeKind,
  clearanceToStroke,
  bboxPtDist,
  bboxFromShift,
  setShifts,
  planAxes,
  axisEdits,
  shiftEdits,
  applyEdits,
} from "../../../../experiments/smart-label-prototype-v021/src/algorithm.mjs";
import { checkPreservation } from "../../../../experiments/smart-label-prototype-v021/src/recommend.mjs";
import { minDistPolylines } from "../../../../experiments/smart-label-engine/src/geometry.mjs";

import {
  sanitizeSceneForSafePlanningUnit1,
  compareCollisionDiagnosticsUnit1,
} from "./unit1-diagnostics-stability.mjs";
import {
  enhanceSceneWithUnit2,
  planLabelsUnit2,
  assignStrokesUnit2,
  DEFAULT_UNIT2_FLAGS,
} from "./unit2-expression-matching.mjs";
import {
  compareCollisionDiagnosticsUnit3A,
} from "./unit3a-overlap-diagnostics.mjs";
import {
  planAxisTickOverlapsUnit3B,
} from "./unit3b-ticks.mjs";
import {
  planOriginNodeUnit3D,
  parseStandardOriginOptionsUnit3D,
} from "./unit3d-origin.mjs";
import { maskComments } from "../../../../experiments/smart-label-engine/src/tikz-nodes.mjs";
import { compileExpr } from "../../../../experiments/smart-label-prototype/src/expr.mjs";

export const AXIS_4DIR_PARAMS_V022 = {
  posRightMarginPt: 16.0,
  posTopMarginPt: 18.5,
  negTargetMarginPt: 12.0,
  negNearNodeMarginPt: 4.0,
  negUnclippedPlotTriggerGapPt: 6.5,
  negNodeNearTriggerGapPt: 3.5,
  negNodeNearAxisBandPt: 30.0,
  clipBoundaryTolPt: 2.5,
};

function evalTikzCoordV022(raw) {
  const s = String(raw || "").trim().replace(/^\{+|\}+$/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  const fn = compileExpr(s);
  if (!fn) return null;
  const v = fn(0);
  return Number.isFinite(v) ? v : null;
}

export function extractClipRectanglesPt(body, units) {
  if (!body || !units || !units.xU || !units.yU) return [];
  const { xU, yU } = units;
  const masked = maskComments(String(body));
  const clipRe = /\\clip\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)\s*rectangle\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)\s*;/g;
  const rects = [];
  for (const m of masked.matchAll(clipRe)) {
    const cx0 = evalTikzCoordV022(m[1]);
    const cy0 = evalTikzCoordV022(m[2]);
    const cx1 = evalTikzCoordV022(m[3]);
    const cy1 = evalTikzCoordV022(m[4]);
    if (cx0 !== null && cy0 !== null && cx1 !== null && cy1 !== null) {
      rects.push({
        math: {
          x0: Math.min(cx0, cx1),
          y0: Math.min(cy0, cy1),
          x1: Math.max(cx0, cx1),
          y1: Math.max(cy0, cy1),
        },
        pt: {
          x0: Math.min(cx0, cx1) * xU,
          y0: Math.min(cy0, cy1) * yU,
          x1: Math.max(cx0, cx1) * xU,
          y1: Math.max(cy0, cy1) * yU,
        },
      });
    }
  }
  return rects;
}

export function planAxesV022(scene, plan, P = PARAMS, opts = {}) {
  const out = { x: null, y: null, content: null, notes: [], diagnostics: null };
  if (!scene?.axes?.x || !scene?.axes?.y) {
    out.notes.push("x/y 축을 모두 식별하지 못해 축 길이 추천 생략");
    return out;
  }

  const { xU, yU } = scene.units;
  const ax = scene.axes.x;
  const ay = scene.axes.y;
  const xl = Math.min(ax.from, ax.to) * xU;
  const xr = Math.max(ax.from, ax.to) * xU;
  const yb = Math.min(ay.from, ay.to) * yU;
  const yt = Math.max(ay.from, ay.to) * yU;

  const AP = { ...AXIS_4DIR_PARAMS_V022, ...(opts.axis4DirParams || {}) };
  const ign = P.axisIgnoreEndWithin ?? 1.5;
  const mRight = P.margins?.right ?? AP.posRightMarginPt;
  const mTop = P.margins?.top ?? AP.posTopMarginPt;
  const mNegTarget = AP.negTargetMarginPt;
  const mNegNearNode = AP.negNearNodeMarginPt;

  const clipRects = extractClipRectanglesPt(scene.body, scene.units);
  const isClippedAtLeft = (xPt) =>
    clipRects.some(
      (c) =>
        Math.abs(c.pt.x0 - xl) <= AP.clipBoundaryTolPt ||
        (Math.abs(xPt - c.pt.x0) <= AP.clipBoundaryTolPt && c.pt.x0 >= xl - AP.clipBoundaryTolPt)
    );
  const isClippedAtBottom = (yPt) =>
    clipRects.some(
      (c) =>
        Math.abs(c.pt.y0 - yb) <= AP.clipBoundaryTolPt ||
        (Math.abs(yPt - c.pt.y0) <= AP.clipBoundaryTolPt && c.pt.y0 >= yb - AP.clipBoundaryTolPt)
    );

  let C = null;
  const addC = (x0, y0, x1, y1) => {
    C = C
      ? {
          x0: Math.min(C.x0, x0),
          y0: Math.min(C.y0, y0),
          x1: Math.max(C.x1, x1),
          y1: Math.max(C.y1, y1),
        }
      : { x0, y0, x1, y1 };
  };

  const nearEnd = { right: false, left: false, top: false, bottom: false };
  let strokeNeedRight = xr;
  let strokeNeedTop = yt;
  let strokeNeedLeft = xl;
  let strokeNeedBottom = yb;

  for (const s of scene.strokes || []) {
    if (!s || s.kind === "axis" || !Array.isArray(s.pts) || s.pts.length === 0) continue;
    let sx0 = Infinity;
    let sy0 = Infinity;
    let sx1 = -Infinity;
    let sy1 = -Infinity;
    for (const p of s.pts) {
      addC(p[0], p[1], p[0], p[1]);
      if (p[0] < sx0) sx0 = p[0];
      if (p[0] > sx1) sx1 = p[0];
      if (p[1] < sy0) sy0 = p[1];
      if (p[1] > sy1) sy1 = p[1];
    }

    const p0 = s.pts[0];
    const p1 = s.pts[s.pts.length - 1];
    const touchesRight = Math.abs(p0[0] - xr) <= ign || Math.abs(p1[0] - xr) <= ign;
    const touchesLeft = Math.abs(p0[0] - xl) <= ign || Math.abs(p1[0] - xl) <= ign;
    const touchesTop = Math.abs(p0[1] - yt) <= ign || Math.abs(p1[1] - yt) <= ign;
    const touchesBottom = Math.abs(p0[1] - yb) <= ign || Math.abs(p1[1] - yb) <= ign;

    if (touchesRight) nearEnd.right = true;
    if (touchesLeft) nearEnd.left = true;
    if (touchesTop) nearEnd.top = true;
    if (touchesBottom) nearEnd.bottom = true;

    if (!touchesRight || sx1 > xr + ign) {
      strokeNeedRight = Math.max(strokeNeedRight, sx1 + mRight);
    }
    if (!touchesTop || sy1 > yt + ign) {
      strokeNeedTop = Math.max(strokeNeedTop, sy1 + mTop);
    }

    const isPlot = Boolean(s.stmt && (s.stmt.type === "plot" || s.stmt.isPlot));
    const gapLeftPt = sx0 - xl;
    if (gapLeftPt < -0.5) {
      const marginL = gapLeftPt < -ign ? (P.margins?.left ?? mNegTarget) : mNegTarget;
      strokeNeedLeft = Math.min(strokeNeedLeft, sx0 - marginL);
    } else if (
      isPlot &&
      gapLeftPt < AP.negUnclippedPlotTriggerGapPt &&
      !isClippedAtLeft(sx0)
    ) {
      strokeNeedLeft = Math.min(strokeNeedLeft, sx0 - mNegTarget);
    }

    const gapBottomPt = sy0 - yb;
    if (gapBottomPt < -0.5) {
      strokeNeedBottom = Math.min(strokeNeedBottom, sy0 - mNegTarget);
    } else if (
      isPlot &&
      gapBottomPt < AP.negUnclippedPlotTriggerGapPt &&
      !isClippedAtBottom(sy0)
    ) {
      strokeNeedBottom = Math.min(strokeNeedBottom, sy0 - mNegTarget);
    }
  }

  const placedById = new Map((plan?.placements || []).map((p) => [p.id, p]));
  const tickMoveById = new Map((opts.tickMoves || []).map((t) => [t.id, t]));
  let nodeNeedRight = xr;
  let nodeNeedTop = yt;
  let nodeNeedLeft = xl;
  let nodeNeedBottom = yb;

  for (const n of scene.nodes || []) {
    if (!n.bbox || ["axisLabel", "origin", "marker"].includes(n.role)) continue;
    const pl = placedById.get(n.id);
    const tk = tickMoveById.get(n.id);
    const b =
      pl && pl.action === "move" && pl.bbox
        ? pl.bbox
        : tk && tk.newBBox
        ? tk.newBBox
        : n.bbox;
    addC(b.x0, b.y0, b.x1, b.y1);

    nodeNeedRight = Math.max(nodeNeedRight, b.x1 + mRight);
    nodeNeedTop = Math.max(nodeNeedTop, b.y1 + mTop);

    const nodeGapLeftPt = b.x0 - xl;
    const nearXAxis = b.y0 <= 8.0 && b.y1 >= -8.0;
    if (nodeGapLeftPt < 0) {
      nodeNeedLeft = Math.min(nodeNeedLeft, b.x0 - mNegTarget);
    } else if (nearXAxis && nodeGapLeftPt < AP.negNodeNearTriggerGapPt) {
      nodeNeedLeft = Math.min(nodeNeedLeft, b.x0 - mNegNearNode);
    }

    const nodeGapBottomPt = b.y0 - yb;
    if (nodeGapBottomPt < 0) {
      nodeNeedBottom = Math.min(nodeNeedBottom, b.y0 - mNegTarget);
    } else if (nodeGapBottomPt < AP.negNodeNearTriggerGapPt) {
      nodeNeedBottom = Math.min(nodeNeedBottom, b.y0 - mNegNearNode);
    }
  }

  out.content = C;
  if (!C) {
    out.x = { old: [ax.from, ax.to], new: [ax.from, ax.to], nearEnd };
    out.y = { old: [ay.from, ay.to], new: [ay.from, ay.to] };
    out.xStmt = ax.stmt;
    out.yStmt = ay.stmt;
    return out;
  }

  const R = Math.max(xr, strokeNeedRight, nodeNeedRight);
  const T = Math.max(yt, strokeNeedTop, nodeNeedTop);
  const L = Math.min(xl, strokeNeedLeft, nodeNeedLeft);
  const B = Math.min(yb, strokeNeedBottom, nodeNeedBottom);

  const u1 = (v) => Math.round(v * 10) / 10;
  const fwdX = ax.from <= ax.to;
  const fwdY = ay.from <= ay.to;
  const pickPos = (oldU, newPt, unit, same) => (same ? oldU : Math.max(oldU, u1(newPt / unit)));
  const pickNeg = (oldU, newPt, unit, same) => (same ? oldU : Math.min(oldU, u1(newPt / unit)));

  const xLeftU = pickNeg(fwdX ? ax.from : ax.to, L, xU, Math.abs(L - xl) < 1e-6);
  const xRightU = pickPos(fwdX ? ax.to : ax.from, R, xU, Math.abs(R - xr) < 1e-6);
  const yBotU = pickNeg(fwdY ? ay.from : ay.to, B, yU, Math.abs(B - yb) < 1e-6);
  const yTopU = pickPos(fwdY ? ay.to : ay.from, T, yU, Math.abs(T - yt) < 1e-6);

  out.x = {
    old: [ax.from, ax.to],
    new: fwdX ? [xLeftU, xRightU] : [xRightU, xLeftU],
    nearEnd,
  };
  out.y = {
    old: [ay.from, ay.to],
    new: fwdY ? [yBotU, yTopU] : [yTopU, yBotU],
  };
  out.xStmt = ax.stmt;
  out.yStmt = ay.stmt;
  out.margins = {
    right: mRight,
    top: mTop,
    left: mNegTarget,
    bottom: mNegTarget,
  };
  out.diagnostics = {
    clipRectsCount: clipRects.length,
    strokeNeedMath: {
      left: u1(strokeNeedLeft / xU),
      right: u1(strokeNeedRight / xU),
      bottom: u1(strokeNeedBottom / yU),
      top: u1(strokeNeedTop / yU),
    },
    nodeNeedMath: {
      left: u1(nodeNeedLeft / xU),
      right: u1(nodeNeedRight / xU),
      bottom: u1(nodeNeedBottom / yU),
      top: u1(nodeNeedTop / yU),
    },
  };
  return out;
}

export const ALGORITHM_VERSION_V022 = "proto-0.2.2-beta";

const rectPoly = (b) => ({
  pts: [
    [b.x0, b.y0],
    [b.x1, b.y0],
    [b.x1, b.y1],
    [b.x0, b.y1],
  ],
  closed: true,
});
const bboxGapRect = (a, b) =>
  Math.hypot(
    Math.max(a.x0 - b.x1, 0, b.x0 - a.x1),
    Math.max(a.y0 - b.y1, 0, b.y0 - a.y1)
  );
const r2 = (n) =>
  typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : n;
const normShift = (sh) => [r2(sh?.[0] || 0), r2(sh?.[1] || 0)];

/**
 * 1차/2차 Kroki 스테이징 SVG로 생성된 scene 에 Unit 1 안정성 가드 및 Unit 2/2+ 확장을 적용한다.
 * (로컬 latex 실행 없음)
 */
export function prepareSceneV022(scene, flags = DEFAULT_UNIT2_FLAGS) {
  if (!scene || !scene.ok) return scene;
  sanitizeSceneForSafePlanningUnit1(scene);
  enhanceSceneWithUnit2(scene, flags);
  return scene;
}

/**
 * Unit 2 라벨 배치 플랜(planLabelsUnit2)과 shiftEdits 결과를 결합하여
 * UI 및 진단기에서 사용하는 표준 labelDecisions 배열과 decisionsByNodeId 맵을 생성한다.
 */
export function buildV022LabelDecisions(scene, plan, shiftResult) {
  const targets = (scene?.nodes || []).filter((n) => n.role === "function" && n.bbox);
  const placementsById = new Map((plan?.placements || []).map((p) => [p.id, p]));
  const skippedById = new Map((plan?.skipped || []).map((s) => [s.id, s]));
  const shiftById = new Map((shiftResult?.report || []).map((r) => [r.id, r]));
  const advisoryById = new Map((plan?.advisory || []).map((a) => [a.id, a]));
  const assignmentsObj = plan?.assignments || {};

  const labelDecisions = [];
  const decisionsByNodeId = new Map();

  for (const n of targets) {
    const pl = placementsById.get(n.id) || null;
    const sk = skippedById.get(n.id) || null;
    const shItem = shiftById.get(n.id) || null;
    const asgn = assignmentsObj[n.id] || null;
    const advItem = advisoryById.get(n.id) || pl?.advisory || sk?.advisory || null;

    const oldShift = normShift([n.xshift || 0, n.yshift || 0]);
    const isMoved = Boolean(pl && pl.action === "move" && shItem);
    const newShift = isMoved ? normShift(shItem.newShift) : oldShift;
    const deltaShiftPt = [r2(newShift[0] - oldShift[0]), r2(newShift[1] - oldShift[1])];
    const movedDistancePt = isMoved ? r2(shItem.neededMovePt ?? 0) : 0;

    const how = asgn?.how || pl?.how || sk?.how || "unmatched";
    const confirmed = Boolean(asgn?.confirmed ?? pl?.confirmedAssignment);

    let nonMoveCategory = null;
    let nonMoveCode = null;
    let holdReason = null;
    let selectionReason = "";

    if (isMoved) {
      selectionReason =
        pl.reason ||
        `v0.2.2-beta(interim-v1) 추천 위치 채택(끝점 ${pl.end}/${pl.side}, shift=[${newShift.join(", ")}]pt)`;
    } else {
      if (!n.usable && n.fallbackAnchorFromBBox) {
        nonMoveCategory = "기호 좌표 미해석(안전 잠금)";
        nonMoveCode = "fallback-anchor-unusable";
        holdReason =
          sk?.reason ||
          "기호 좌표(at) 미해석으로 SVG bbox 대체 중심점이 사용되어 안전 잠금(자동 이동 보류) 유지";
      } else if (!n.usable || sk?.category === "unusable-node" || sk?.category === "unknown-scale") {
        nonMoveCategory = "노드 측정 불확실";
        nonMoveCode = "unusable-node";
        holdReason = sk?.reason || `노드 매칭 미확정(${n.confidence})으로 안전을 위해 원본 위치 유지`;
      } else if (sk?.category === "no-safe-candidate") {
        nonMoveCategory = "후보 없음";
        nonMoveCode = "no-safe-candidate";
        holdReason =
          sk?.reason ||
          "수식 매칭은 확정되었으나 허용 간격(cHard)을 만족하는 안전한 이동 후보가 없어 기존 위치를 유지함";
      } else if (
        pl?.action === "hold-uncertain" ||
        !confirmed ||
        sk?.category === "uncertain-stroke-assignment" ||
        sk?.category === "ambiguous-structural-assignment" ||
        sk?.category === "unmatched-stroke"
      ) {
        const isParseFail = how === "parse-failure" || asgn?.nonMoveCode === "parse-failure";
        const isMultiAbstractHold = Boolean(asgn?.isMultiAbstractPair);
        nonMoveCategory = isParseFail
          ? "수식 파싱 실패"
          : isMultiAbstractHold
            ? asgn?.nonMoveCategory || "매칭 불확실 (유형 2: 사용자 확인 필요)"
            : "매칭 불확실";
        nonMoveCode = isParseFail
          ? "parse-failure"
          : isMultiAbstractHold
            ? asgn?.nonMoveCode || "multi-abstract-user-confirm-required"
            : "uncertain-match";
        const advNote =
          advItem && Array.isArray(advItem.shift)
            ? ` (참고 안전 후보 shift=[${advItem.shift.join(", ")}]pt 존재하나 확정 매칭 규칙 미비로 자동 이동 차단)`
            : "";
        holdReason =
          (pl?.reason || sk?.reason || asgn?.reason || `대응 곡선 미확정(${how})으로 자동 이동 차단`) +
          advNote;
      } else {
        nonMoveCategory = "기존 위치 유지";
        nonMoveCode = "keep-original";
        holdReason =
          pl?.reason ||
          "원 위치가 이미 평가원 배치 기준(무충돌·접선 방향·중심 정렬·근접성)을 만족하여 불필요한 이동 생략";
      }
      selectionReason = `[${nonMoveCategory}] ${holdReason}`;
    }

    const decisionObj = {
      id: n.id,
      label: n.label,
      matchedStroke: asgn?.stroke ?? pl?.stroke ?? null,
      strokeKind: asgn?.strokeKind || pl?.strokeKind || "unknown",
      assignmentMethod: how,
      assignmentConfirmed: confirmed,
      how,
      confirmed,
      usable: Boolean(n.usable),
      fallbackAnchorFromBBox: Boolean(n.fallbackAnchorFromBBox),
      advisoryShift: advItem?.shift ? normShift(advItem.shift) : null,
      selectedEngine: isMoved ? "v0.2.2-beta" : "original",
      agreedEngines: isMoved ? ["v0.2.2-beta"] : ["original"],
      selectedPosition: {
        shift: newShift,
        bbox: pl?.bbox || n.bbox,
        end: pl?.end ?? null,
        side: pl?.side ?? null,
        alpha: pl?.alpha ?? null,
      },
      movement: {
        oldShift,
        newShift,
        deltaShiftPt,
        movedDistancePt,
      },
      selectionReason,
      autoModified: isMoved,
      nonMoveCategory,
      nonMoveCode,
      holdReason,
      matchedHoldStatus:
        confirmed && !isMoved
          ? sk?.category === "no-safe-candidate"
            ? "matched-held-no-safe-candidate"
            : "matched-held-optimal-original"
          : null,
      isMultiAbstractPair: Boolean(asgn?.isMultiAbstractPair),
      multiAbstractAction: asgn?.multiAbstractAction || null,
      step2ClassificationType: asgn?.step2ClassificationType || null,
      step2ClassificationCode: asgn?.step2ClassificationCode || null,
      step2MathematicallyProven: Boolean(asgn?.step2MathematicallyProven),
      step2RequiresUserApproval: Boolean(asgn?.step2RequiresUserApproval),
      step2Signals: asgn?.step2Signals || [],
      step2RawDistMarginPt: asgn?.step2RawDistMarginPt ?? null,
      step2RecommendedStroke: asgn?.step2RecommendedStroke ?? null,
      step2SwappedStroke: asgn?.step2SwappedStroke ?? null,
      curveShape: asgn?.curveShape || null,
      plotExpr: asgn?.plotExpr || null,
    };

    labelDecisions.push(decisionObj);
    decisionsByNodeId.set(n.id, decisionObj);
  }

  return { labelDecisions, decisionsByNodeId };
}

/**
 * v0.2.2-beta 전용 라벨 배치 및(옵션 시) 축 연장 / 그래프 끝점(domain) 미세 연장 / Unit 3-B 눈금 겹침 보정 / Unit 3-D-Origin 원점 배치 계획 실행기
 */
export function runPlanningV022(
  scene,
  P = PARAMS,
  applyAxisRequested = false,
  flags = DEFAULT_UNIT2_FLAGS,
  enableUnit3B = false,
  enableUnit3D = true,
  applyDomainExtension = false
) {
  const plan0 = planLabelsUnit2(scene, P, null, { ...flags, applyAxisRequested });
  let activePlan = plan0;
  let activeShift = shiftEdits(scene, activePlan, P);

  // 그래프 끝점(domain) 미세 연장 및 라벨 위치 공동 최적화 (기본 OFF, 체크 시에만 실행)
  const domainPlan = applyDomainExtension
    ? planDomainMicroExtensionsV022(scene, activePlan, activeShift, P, {
        applyDomainExtension: true,
        applyAxis: Boolean(applyAxisRequested),
        flags,
      })
    : {
        requested: false,
        applied: false,
        edits: [],
        decisions: [],
        updatedStrokesByIndex: new Map(),
        updatedPlacementsById: new Map(),
        updatedShiftReportById: new Map(),
        updatedLabelEditsById: new Map(),
      };

  let sceneForPostPlan = scene;
  if (domainPlan.applied) {
    // 원본 scene 은 오염시키지 않고 파생 장면(sceneForPostPlan)과 activePlan/activeShift 만 갱신
    sceneForPostPlan = {
      ...scene,
      strokes: (scene.strokes || []).map(
        (s) => domainPlan.updatedStrokesByIndex.get(s.index) || s
      ),
    };
    const updatedPlacements = (activePlan.placements || []).map(
      (pl) => domainPlan.updatedPlacementsById.get(pl.id) || pl
    );
    const updatedSkipped = (activePlan.skipped || []).filter(
      (sk) => !domainPlan.updatedPlacementsById.has(sk.id)
    );
    activePlan = {
      ...activePlan,
      placements: updatedPlacements,
      skipped: updatedSkipped,
    };

    const editMap = new Map((activeShift.edits || []).map((e) => [e.id, e]));
    for (const [id, newEdit] of domainPlan.updatedLabelEditsById.entries()) {
      editMap.set(id, newEdit);
    }
    const reportMap = new Map((activeShift.report || []).map((r) => [r.id, r]));
    for (const [id, newRep] of domainPlan.updatedShiftReportById.entries()) {
      reportMap.set(id, newRep);
    }
    activeShift = {
      ...activeShift,
      edits: [...editMap.values()],
      report: [...reportMap.values()],
    };
  }

  const domainEditsToApply = domainPlan.edits || [];
  let axisPlan = planAxesV022(sceneForPostPlan, activePlan, P);
  let axisEditsToApply = [];

  if (applyAxisRequested) {
    // [공동 최적화]: 이미 늘어난 축을 다시 줄이는 방식이 아니라,
    // 항상 동일한 원본 TikZ의 축 끝 좌표를 기준으로 각 라벨 후보의 필요 축 연장량과 연장 축 충돌 여부를
    // planLabelsUnit2 내부에서 공동 평가하여 최종 후보를 선택한 뒤, 그 결과에 대해서만 축 연장을 1회 적용한다.
    axisEditsToApply = axisEdits(sceneForPostPlan, axisPlan);
  }

  const { labelDecisions, decisionsByNodeId } = buildV022LabelDecisions(
    sceneForPostPlan,
    activePlan,
    activeShift
  );

  // Unit 3-B (Step 1: 좌표축 눈금 숫자 겹침 자동 해결) 독립 단계 실행
  const tickPlan = enableUnit3B
    ? planAxisTickOverlapsUnit3B(sceneForPostPlan, activePlan, activeShift, axisEditsToApply)
    : {
        edits: [],
        movedTicks: [],
        heldTicks: [],
        decisions: [],
        decisionsByNodeId: new Map(),
      };

  for (const [tid, tdec] of tickPlan.decisionsByNodeId.entries()) {
    decisionsByNodeId.set(tid, tdec);
  }

  if (tickPlan.movedTicks && tickPlan.movedTicks.length > 0) {
    axisPlan = planAxesV022(sceneForPostPlan, activePlan, P, { tickMoves: tickPlan.movedTicks });
    if (applyAxisRequested) {
      axisEditsToApply = axisEdits(sceneForPostPlan, axisPlan);
    }
  }

  const shouldRunUnit3D =
    enableUnit3D !== false &&
    flags?.enableOriginPlacement !== false &&
    flags?.u3d !== false;

  // Unit 3-D-Origin (표준 원점 O 노드 4방향 자동 배치 규칙) 독립 단계 실행
  const originPlan = shouldRunUnit3D
    ? planOriginNodeUnit3D(
        sceneForPostPlan,
        activePlan,
        activeShift,
        axisEditsToApply,
        tickPlan
      )
    : {
        edits: [],
        movedOrigins: [],
        heldOrigins: [],
        decisions: [],
        decisionsByNodeId: new Map(),
      };

  for (const [oid, odec] of originPlan.decisionsByNodeId.entries()) {
    decisionsByNodeId.set(oid, odec);
  }

  activePlan.labelDecisions = labelDecisions;
  activePlan.decisionsByNodeId = decisionsByNodeId;
  activePlan.tickPlan = tickPlan;
  activePlan.originPlan = originPlan;
  activePlan.domainPlan = domainPlan;
  activePlan.multiAbstractAnalysis =
    scene.multiAbstractAnalysis || activePlan.multiAbstractAnalysis || null;

  // placements 배열에도 shift 와 selectedEngine 보강
  const shiftById = new Map((activeShift.report || []).map((r) => [r.id, r]));
  const decById = decisionsByNodeId;
  for (const pl of activePlan.placements || []) {
    const sh = shiftById.get(pl.id);
    const dec = decById.get(pl.id);
    pl.selectedEngine = pl.action === "move" ? "v0.2.2-beta" : "original";
    pl.agreedEngines = [pl.selectedEngine];
    pl.shift = sh ? normShift(sh.newShift) : dec?.selectedPosition?.shift || [0, 0];
    if (dec && !dec.autoModified) {
      pl.holdReason = dec.holdReason;
      pl.nonMoveCategory = dec.nonMoveCategory;
      pl.nonMoveCode = dec.nonMoveCode;
    }
  }

  return {
    plan0,
    activePlan,
    axisPlan,
    axisEditsToApply,
    domainPlan,
    domainEditsToApply,
    activeShift,
    tickPlan,
    originPlan,
    labelDecisions,
    decisionsByNodeId,
    multiAbstractAnalysis: activePlan.multiAbstractAnalysis,
  };
}

/**
 * Unit 1(정준 노드 매퍼 + 4대 미이동 사유 분리)과 Unit 3-A(실제 글자 침범 vs 박스 접촉 vs 끝점 근접 분리)를
 * 결합하여 UI/API 표준 CollisionDiagnosticsSummary 호환 객체를 반환한다.
 */
export function compareCollisionDiagnosticsV022(
  origScene,
  finalScene,
  movedNodeIds = [],
  opts = {}
) {
  const P = opts.params || PARAMS;
  const flags = opts.unit2Flags || DEFAULT_UNIT2_FLAGS;
  const axisChanged = Boolean(opts.axisChanged);
  const decisionsByNodeId = opts.decisionsByNodeId || new Map();

  const syncConfirmedAssignmentsForAudit = (sc) => {
    if (!sc || !sc.ok || typeof sc.compileLabelFunction !== "function") return;
    const origCompile = sc._origCompileLabelFunctionV022 || sc.compileLabelFunction;
    sc._origCompileLabelFunctionV022 = origCompile;
    const fNodes = (sc.nodes || []).filter((n) => n.role === "function" && n.bbox);
    const asgnMap = assignStrokesUnit2(sc, fNodes, flags);
    const byLabel = new Map();
    for (const fn of fNodes) {
      const a = asgnMap.get(fn.id);
      if (a && a.confirmed && a.stroke && a.stroke.stmt && typeof a.stroke.stmt.fn === "function") {
        byLabel.set(fn.label, a.stroke.stmt.fn);
      }
    }
    sc.compileLabelFunction = (lbl) => {
      const fn0 = origCompile(lbl);
      if (fn0) return fn0;
      return byLabel.get(lbl) || null;
    };
  };
  syncConfirmedAssignmentsForAudit(origScene);
  syncConfirmedAssignmentsForAudit(finalScene);

  const cmpU1 = compareCollisionDiagnosticsUnit1(origScene, finalScene, movedNodeIds, {
    params: P,
    axisChanged,
    decisionsByNodeId,
  });
  const cmpU3A = compareCollisionDiagnosticsUnit3A(origScene, finalScene, movedNodeIds, {
    params: P,
    unit2Flags: flags,
    axisChanged,
    decisionsByNodeId,
  });

  // Unit 1 의 상세 미이동 사유(reason / reasonCode)를 Unit 3-A 의 preExistingUnresolved 항목에 보강
  const u1PreByKey = new Map(
    (cmpU1.preExistingUnresolvedCollisions || []).map((c) => [c.key, c])
  );

  // decisionsByNodeId 에서 라벨/ID 로 Unit 3-B 눈금 및 Unit 3-D 원점 보류 사유 조회 헬퍼
  const findDecisionForItem = (item) => {
    if (item.nodeId && decisionsByNodeId.has(item.nodeId)) {
      return decisionsByNodeId.get(item.nodeId);
    }
    for (const dec of decisionsByNodeId.values()) {
      if (dec && dec.label === item.nodeLabel && (dec.tickAxis || dec.role === "origin")) {
        return dec;
      }
    }
    return null;
  };

  const enrichedPreExisting = (cmpU3A.preExistingUnresolvedCollisions || []).map((item) => {
    const u1Match = u1PreByKey.get(item.key);
    const tickDec = item.nodeRole !== "function" ? findDecisionForItem(item) : null;
    if (tickDec && tickDec.nonMoveCode === "no-safe-tick-candidate") {
      return {
        ...item,
        status: "pre-existing-unresolved",
        reasonCode: "no-safe-tick-candidate",
        reason: tickDec.reason,
      };
    }
    if (tickDec && tickDec.nonMoveCode === "no-safe-origin-quadrant") {
      return {
        ...item,
        status: "pre-existing-unresolved",
        reasonCode: "no-safe-origin-quadrant",
        reason: tickDec.reason,
      };
    }
    return {
      ...item,
      status: "pre-existing-unresolved",
      reasonCode: u1Match?.reasonCode || item.reasonCode || "pre-existing",
      reason:
        u1Match?.reason ||
        item.reason ||
        (item.nodeRole !== "function"
          ? `원본부터 존재하던 일반 노드(${item.nodeLabel}) 겹침 (이번 단계에서 일반 노드는 자동 이동 제외 — 조이스틱 수동 조정 권장)`
          : `원본부터 존재하던 미해결 겹침 (${item.description})`),
    };
  });

  const enrichedNewlyIntroduced = (cmpU3A.newlyIntroducedCollisions || []).map((item) => ({
    ...item,
    reason:
      item.reason ||
      (item.reasonCode === "caused-by-label-move"
        ? `함수식 라벨 자동 이동으로 인해 새로 발생한 충돌 (${item.description})`
        : item.reasonCode === "caused-by-axis-adjustment"
        ? `축 길이 조정으로 인해 새로 발생한 충돌 (${item.description})`
        : `2차 검증에서 새로 감지된 충돌 (${item.description})`),
  }));

  const unmeasuredNodes = cmpU3A.finalAudit?.unmeasuredNodes || cmpU1.unmeasuredNodes || [];
  const unverifiableItems = cmpU3A.finalAudit?.unverifiableItems || cmpU1.unverifiableItems || [];
  const finalFnNodes = (finalScene?.nodes || []).filter((n) => n.role === "function" && n.bbox);
  const finalUnit2Asgn = assignStrokesUnit2(finalScene, finalFnNodes, flags);
  let unit2MovedNodeHasCollision = false;
  const movedLabelSet = new Set(
    (origScene?.nodes || [])
      .filter((n) => movedNodeIds.includes(n.id))
      .map((n) => n.label)
  );
  for (const fn of finalFnNodes) {
    if (!movedLabelSet.has(fn.label)) continue;
    const a = finalUnit2Asgn.get(fn.id);
    const ownIdx = a && a.stroke ? a.stroke.index : null;
    for (const s of finalScene.strokes || []) {
      if (!s || !Array.isArray(s.pts) || s.pts.length < 2) continue;
      const cl = minDistPolylines([rectPoly(fn.bbox)], [{ pts: s.pts, closed: false }]) - (s.halfWidth || 0.5);
      if (s.index === ownIdx) {
        if (cl < -1.2) unit2MovedNodeHasCollision = true;
      } else {
        if (cl < P.cHard - 1.5) unit2MovedNodeHasCollision = true;
      }
    }
    for (const ob of finalScene.nodes || []) {
      if (!ob.bbox || ob.id === fn.id || ob.role === "marker") continue;
      if (bboxGapRect(fn.bbox, ob.bbox) < P.mLabel - 1.5) {
        unit2MovedNodeHasCollision = true;
      }
    }
  }
  const filteredNewlyIntroduced = enrichedNewlyIntroduced.filter((item) => {
    const fn = finalFnNodes.find((n) => n.label === item.nodeLabel);
    if (!fn) return true;
    const a = finalUnit2Asgn.get(fn.id);
    if (a && a.confirmed && a.stroke && item.strokeIndex === a.stroke.index && item.clearancePt >= -1.0) {
      return false;
    }
    return true;
  });
  const safetyPassed = filteredNewlyIntroduced.length === 0 && !unit2MovedNodeHasCollision;
  const measurementComplete = cmpU3A.measurementComplete && cmpU1.measurementComplete;
  const hasUnresolvedCollisions =
    enrichedPreExisting.length > 0 || filteredNewlyIntroduced.length > 0;
  const allCollisionsResolved =
    safetyPassed && measurementComplete && !hasUnresolvedCollisions;

  return {
    engineVersion: "v0.2.2-beta",
    safetyPassed,
    measurementComplete,
    allClear: allCollisionsResolved,
    allCollisionsResolved,
    hasUnresolvedCollisions,
    movedNodeHasCollision: Boolean(unit2MovedNodeHasCollision),
    counts: {
      origTotal: cmpU3A.counts.origTotal,
      finalTotal: cmpU3A.counts.finalTotal,
      resolved: cmpU3A.counts.resolved,
      preExistingUnresolved: enrichedPreExisting.length,
      newlyIntroduced: filteredNewlyIntroduced.length,
      unmeasuredNodes: unmeasuredNodes.length,
      unverifiableItems: unverifiableItems.length,
      // Unit 3-A 확장 정밀 지표
      origTrueInk: cmpU3A.counts.origTrueInk,
      finalTrueInk: cmpU3A.counts.finalTrueInk,
      origBboxOnly: cmpU3A.counts.origBboxOnly,
      finalBboxOnly: cmpU3A.counts.finalBboxOnly,
      origNaturalEndpoint: cmpU3A.counts.origNaturalEndpoint,
      finalNaturalEndpoint: cmpU3A.counts.finalNaturalEndpoint,
      unmovedGeneralNodeOverlaps: cmpU3A.counts.unmovedGeneralNodeOverlaps,
    },
    resolvedCollisions: cmpU3A.resolvedCollisions,
    preExistingUnresolvedCollisions: enrichedPreExisting,
    newlyIntroducedCollisions: filteredNewlyIntroduced,
    naturalEndpointContacts: cmpU3A.finalAudit?.naturalEndpointContacts || [],
    unmeasuredNodes,
    unverifiableItems,
    origAudit: cmpU3A.origAudit,
    finalAudit: cmpU3A.finalAudit,
  };
}

/**
 * v0.2.2-beta 보존 검증기:
 *  - 기존 checkPreservation 의 모든 불변성(수식, domain, samples, 선분, 마커, 전역 폰트/선 두께, 범위 밖 텍스트)을 검증하며,
 *  - Unit 3-D-Origin 의 origin-anchor 편집(원점 O 옵션 내 4방향 앵커 토큰만 변경)과
 *    Unit 2-B 의 domain-micro-ext 편집(plot 의 domain=a:b 수치 구간만 안전 연장)을 추가로 허용·검증한다.
 */
export function checkPreservationV022(orig, rec, edits = []) {
  const originEdits = (edits || []).filter((e) => e && e.kind === "origin-anchor");
  const domainEdits = (edits || []).filter((e) => e && e.kind === "domain-micro-ext");
  const specialEdits = [...originEdits, ...domainEdits];
  if (specialEdits.length === 0) {
    return checkPreservation(orig, rec, edits);
  }

  const sortedAll = [...edits].sort((a, b) => a.start - b.start);
  const specialIssues = [];

  for (let i = 1; i < sortedAll.length; i++) {
    if (sortedAll[i].start < sortedAll[i - 1].end) {
      specialIssues.push("편집 범위 겹침 발생");
    }
  }

  const normOriginOpts = (s) =>
    String(s)
      .replace(/\b(below\s+left|above\s+left|below\s+right|above\s+right)\b/g, "#ANCHOR#")
      .replace(/[\s,\[\]]/g, "");

  for (const oe of originEdits) {
    const before = orig.slice(oe.start, oe.end);
    const after = oe.replacement;
    const beforeInner = before.replace(/^\s*\[/, "").replace(/\]\s*$/, "");
    const afterInner = String(after).replace(/^\s*\[/, "").replace(/\]\s*$/, "");
    const pBefore = parseStandardOriginOptionsUnit3D(beforeInner);
    const pAfter = parseStandardOriginOptionsUnit3D(afterInner);
    if (!pBefore.valid || !pAfter.valid || normOriginOpts(before) !== normOriginOpts(after)) {
      specialIssues.push(`원점 O 옵션이 4방향 앵커 외에도 변경됨: ${before} → ${after}`);
    }
  }

  const domainTokenRe = /^domain\s*=\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*:\s*([-+]?(?:\d+\.?\d*|\.\d+))$/;
  for (const de of domainEdits) {
    const before = orig.slice(de.start, de.end);
    const after = String(de.replacement || "");
    const mBefore = domainTokenRe.exec(before.trim());
    const mAfter = domainTokenRe.exec(after.trim());
    if (!mBefore || !mAfter) {
      specialIssues.push(`plot domain 편집 형식이 유효하지 않음: ${before} → ${after}`);
      continue;
    }
    const oldA = Number(mBefore[1]);
    const oldB = Number(mBefore[2]);
    const newA = Number(mAfter[1]);
    const newB = Number(mAfter[2]);
    if (!Number.isFinite(oldA) || !Number.isFinite(oldB) || !Number.isFinite(newA) || !Number.isFinite(newB) || newA >= newB) {
      specialIssues.push(`plot domain 수치 범위가 유효하지 않음: ${before} → ${after}`);
    } else if (newA > oldA + 1e-6 || newB < oldB - 1e-6) {
      specialIssues.push(`plot domain 구간이 축소됨(연장 전용 위반): ${before} → ${after}`);
    }
  }

  const sortedSpecial = [...specialEdits].sort((a, b) => a.start - b.start);
  const origWithSpecialApplied = applyEdits(orig, sortedSpecial);

  const nonSpecialEditsMapped = (edits || [])
    .filter((e) => e && e.kind !== "origin-anchor" && e.kind !== "domain-micro-ext")
    .map((e) => {
      let delta = 0;
      for (const se of sortedSpecial) {
        if (se.end <= e.start) {
          delta += se.replacement.length - (se.end - se.start);
        }
      }
      return {
        ...e,
        start: e.start + delta,
        end: e.end + delta,
      };
    });

  const basePres = checkPreservation(origWithSpecialApplied, rec, nonSpecialEditsMapped);
  const allIssues = [...specialIssues, ...(basePres.issues || [])];

  return {
    ok: allIssues.length === 0,
    issues: allIssues,
    editCount: edits.length,
    checks: {
      ...(basePres.checks || {}),
      allowedEditSyntaxOnly:
        Boolean(basePres.checks?.allowedEditSyntaxOnly) && specialIssues.length === 0,
    },
  };
}

/**
 * 2차 렌더링된 장면(scene)에서 이동된 함수식 라벨들 및 이동된 원점 O 노드의 충돌 여부를 검증한다.
 */
export function verifyRenderedCollisionsV022(
  scene,
  movedFNodeIndices,
  P = PARAMS,
  flags = DEFAULT_UNIT2_FLAGS,
  movedOriginNodeIds = []
) {
  const fNodes = (scene?.nodes || []).filter((n) => n.role === "function" && n.bbox);
  const assigned = assignStrokesUnit2(scene, fNodes, flags);
  const allBoxes = (scene?.nodes || []).filter((n) => n.bbox && n.role !== "marker");
  const movedSet = new Set(movedFNodeIndices || []);

  const issues = [];
  const labelDetails = [];
  const ownEndpointContacts = [];

  for (let idx = 0; idx < fNodes.length; idx++) {
    const n = fNodes[idx];
    const a = assigned.get(n.id);
    const s = a && a.stroke ? a.stroke : null;
    const isMoved = movedSet.has(idx);
    const cl = (st) =>
      minDistPolylines([rectPoly(n.bbox)], [{ pts: st.pts, closed: false }]) - st.halfWidth;
    const ownClearancePt = s ? r2(cl(s)) : null;
    const others = s ? scene.strokes.filter((q) => q.index !== s.index) : scene.strokes;
    const minOtherClearancePt = others.length ? r2(Math.min(...others.map(cl))) : null;

    let minLabelGapPt = Infinity;
    for (const ob of allBoxes) {
      if (ob.id === n.id) continue;
      minLabelGapPt = Math.min(minLabelGapPt, bboxGapRect(n.bbox, ob.bbox));
    }
    minLabelGapPt = Number.isFinite(minLabelGapPt) ? r2(minLabelGapPt) : null;

    let endGapPt = null;
    if (s && s.pts.length >= 2) {
      const e0 = s.pts[0];
      const e1 = s.pts[s.pts.length - 1];
      const d = (p) =>
        Math.hypot(
          Math.max(n.bbox.x0 - p[0], 0, p[0] - n.bbox.x1),
          Math.max(n.bbox.y0 - p[1], 0, p[1] - n.bbox.y1)
        );
      endGapPt = r2(Math.min(d(e0), d(e1)));
    }

    const isOwnEndpointContact =
      ownClearancePt !== null &&
      endGapPt !== null &&
      endGapPt <= 4.0 &&
      ownClearancePt >= -1.0 &&
      ownClearancePt <= 1.5;
    if (isOwnEndpointContact) {
      ownEndpointContacts.push({ label: n.label, endGapPt, ownClearancePt });
    }

    const otherStrokeCollision =
      minOtherClearancePt !== null && minOtherClearancePt < P.cHard - 1.5;
    const labelOverlapCollision = minLabelGapPt !== null && minLabelGapPt < P.mLabel - 1.5;
    const ownCurvePenetration = ownClearancePt !== null && ownClearancePt < -1.2;

    if (isMoved) {
      if (otherStrokeCollision) {
        issues.push(
          `이동된 라벨 ${n.label} 이(가) 다른 곡선/축과 너무 가까움(minOther=${minOtherClearancePt}pt)`
        );
      }
      if (labelOverlapCollision) {
        issues.push(
          `이동된 라벨 ${n.label} 이(가) 다른 라벨과 충돌함(minLabelGap=${minLabelGapPt}pt)`
        );
      }
      if (ownCurvePenetration) {
        issues.push(
          `이동된 라벨 ${n.label} 이(가) 자기 곡선을 침범함(ownClearance=${ownClearancePt}pt)`
        );
      }
    }

    labelDetails.push({
      id: n.id,
      fNodeIndex: idx,
      label: n.label,
      moved: isMoved,
      endGapPt,
      ownClearancePt,
      minOtherClearancePt,
      minLabelGapPt,
      ownEndpointContact: isOwnEndpointContact,
      otherStrokeCollision,
      labelOverlapCollision,
      ownCurvePenetration,
    });
  }

  // Unit 3-D-Origin 으로 이동된 원점 O 노드의 2차 렌더링 충돌 검사
  if (Array.isArray(movedOriginNodeIds) && movedOriginNodeIds.length > 0) {
    const renderedOrigins = (scene?.nodes || []).filter((n) => n.role === "origin" && n.bbox);
    for (const oNode of renderedOrigins) {
      const poly = [rectPoly(oNode.bbox)];
      const nonAxisStrokes = (scene?.strokes || []).filter((s) => s.kind !== "axis");
      const axisStrokes = (scene?.strokes || []).filter((s) => s.kind === "axis");
      const minStroke = nonAxisStrokes.length
        ? r2(
            Math.min(
              ...nonAxisStrokes.map(
                (s) => minDistPolylines(poly, [{ pts: s.pts, closed: false }]) - (s.halfWidth || 0.5)
              )
            )
          )
        : 999;
      const minAxis = axisStrokes.length
        ? r2(
            Math.min(
              ...axisStrokes.map(
                (s) => minDistPolylines(poly, [{ pts: s.pts, closed: false }]) - (s.halfWidth || 0.5)
              )
            )
          )
        : 999;
      let minGap = Infinity;
      for (const ob of allBoxes) {
        if (ob.id === oNode.id) continue;
        minGap = Math.min(minGap, bboxGapRect(oNode.bbox, ob.bbox));
      }
      minGap = Number.isFinite(minGap) ? r2(minGap) : 999;

      if (minStroke < 1.0) {
        issues.push(`이동된 원점 ${oNode.label} 이(가) 곡선/선분과 너무 가까움(minStroke=${minStroke}pt)`);
      }
      if (minAxis < 1.0) {
        issues.push(`이동된 원점 ${oNode.label} 이(가) 좌표축과 너무 가까움(minAxis=${minAxis}pt)`);
      }
      if (minGap < 1.0) {
        issues.push(`이동된 원점 ${oNode.label} 이(가) 다른 라벨과 너무 가까움(minGap=${minGap}pt)`);
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    ownEndpointContacts,
    labelDetails,
  };
}

/**
 * v0.2.2-beta 용 2차 출력 변형 검증기 (Kroki 스테이징된 workRoot 에서 buildScene 호출 후 Unit 1 + Unit 2 적용)
 */
export function verifyOutputVariantV022({
  variant,
  origBody,
  origScene,
  candidateBody,
  edits,
  movedFNodeIndices,
  movedOriginNodeIds = [],
  workRoot,
  P = PARAMS,
  flags = DEFAULT_UNIT2_FLAGS,
}) {
  const preservation = checkPreservationV022(origBody, candidateBody, edits);
  const out = {
    variant,
    editCount: edits.length,
    preservation,
    compiled: false,
    svgMeasured: false,
    collisionCheck: null,
    valid: false,
    revertedToOriginal: false,
    status: "pending",
    issues: [...preservation.issues],
    candidateBody,
    deliveredBody: origBody,
    scene: null,
  };

  if (!preservation.ok) {
    out.revertedToOriginal = true;
    out.status = "reverted";
    out.scene = origScene;
    return out;
  }

  const sc = buildScene(candidateBody, { workRoot });
  out.compiled = Boolean(sc.render && sc.render.ok);
  out.svgMeasured = Boolean(sc.ok);
  if (!out.compiled) {
    out.issues.push(
      "LaTeX 컴파일 실패: " + (sc.render && sc.render.error ? sc.render.error : sc.errors.join("; "))
    );
  }
  if (out.compiled && !out.svgMeasured) {
    out.issues.push("SVG 측정 실패: " + sc.errors.join("; "));
  }

  if (!out.compiled || !out.svgMeasured) {
    out.revertedToOriginal = true;
    out.status = "reverted";
    out.deliveredBody = origBody;
    out.scene = origScene;
    return out;
  }

  prepareSceneV022(sc, flags);
  out.collisionCheck = verifyRenderedCollisionsV022(
    sc,
    movedFNodeIndices,
    P,
    flags,
    movedOriginNodeIds
  );
  if (!out.collisionCheck.ok) {
    out.issues.push(...out.collisionCheck.issues);
    out.revertedToOriginal = true;
    out.status = "reverted";
    out.deliveredBody = origBody;
    out.scene = origScene;
    return out;
  }

  out.valid = true;
  out.status = "verified";
  out.deliveredBody = candidateBody;
  out.scene = sc;
  return out;
}

const r3 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1000) / 1000 : n);

export const DEFAULT_DOMAIN_EXT_CONFIG_V022 = {
  // 렌더링 pt 기준 연장량 탐색 격자 및 상한
  arcStepGridPt: [8, 12, 16, 18.5, 19.7, 21, 24, 28, 30, 32, 36, 40, 44, 48, 52],
  maxArcLengthPt: 55.0,          // 렌더링 곡선 길이 기준 최대 미세 연장 상한 (pt)
  maxDomainRatio: 0.25,          // 기존 정의역 폭(b - a) 대비 최대 연장 비율 (25%)
  domainRoundStep: 0.02,         // TikZ domain 수치 반올림 단위
  // 8단계 안전 게이트 임계값
  markerLockRadiusPt: 5.0,       // 끝점에 점/원/꼭짓점/투영 보조선이 있을 때 잠금 반경 (pt)
  maxSlopePtPerPt: 8.5,          // 점근선/발산 구간 감지를 위한 렌더링 기울기(|dy_pt/dx_pt|) 상한
  asymptoteClearanceMinPt: 3.0,  // 점선 점근선과의 최소 안전 간격 (pt)
  otherStrokeMinClearPt: 2.5,    // 연장 구간이 다른 곡선/직선과 교차·접촉하지 않기 위한 최소 간격 (pt)
  otherNodeMinClearPt: 4.0,      // 연장 구간이 다른 라벨/눈금/축라벨 bbox와 유지할 최소 간격 (pt)
  clipMarginPt: 2.5,             // \clip 사각형 경계 안쪽 최소 여유 (pt)
  // 필요성 판정(Gate 8) 및 평가원 스타일 목표 간격(4.5~7.5pt)
  triggerMinOwnGapPt: 10.0,      // 기존 배치의 자기 곡선 간격(own)이 이 값 이상일 때만 연결감 개선 대상으로 검토
  comfortableOwnGapMinPt: 4.5,   // 연장 후 평가원 스타일 적정 최소 라벨-곡선 간격 (pt)
  comfortableOwnGapIdealPt: 5.6, // 연장 후 평가원 스타일 이상적 라벨-곡선 간격 (pt)
  comfortableOwnGapMaxPt: 7.5,   // 연장 후 평가원 스타일 적정 최대 라벨-곡선 간격 (pt)
  gapClosureMinRelX: 0.48,       // 위/아래 배치 라벨에서 곡선 끝점이 도달해야 할 최소 가로 중심 비율
  gapClosureIdealRelX: 0.51,     // 위/아래 배치 라벨에서 이상적 가로 중심 비율 (라벨 중앙 부근)
  gapClosureMaxRelX: 0.68,       // 과도한 우측 돌출 방지를 위한 가로 비율 상한
  jointMinOtherClearPt: 6.0,     // 공동 배치된 라벨과 타 선분 간 최소 안전 간격 (pt)
  congestionEscapeMinClearPt: 8.0, // 보조선 혼잡 탈출 시 확보해야 할 최소 타 선분 간격 (pt)
  jointMinLabelGapPt: 5.0,       // 공동 배치된 라벨과 타 노드 간 최소 안전 간격 (pt)
};

/**
 * TikZ 본문에서 \clip (x0, y0) rectangle (x1, y1) 영역들을 pt 좌표로 추출
 */
export function extractClipRectsPtV022(body, units) {
  if (!body || !units || !units.xU || !units.yU) return [];
  const masked = maskComments(body);
  const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)`;
  const re = new RegExp(
    String.raw`\\clip\s*\(\s*(${NUM})\s*,\s*(${NUM})\s*\)\s*rectangle\s*\(\s*(${NUM})\s*,\s*(${NUM})\s*\)\s*;`,
    "g"
  );
  const rects = [];
  let m;
  while ((m = re.exec(masked)) !== null) {
    const x0 = Number(m[1]) * units.xU;
    const y0 = Number(m[2]) * units.yU;
    const x1 = Number(m[3]) * units.xU;
    const y1 = Number(m[4]) * units.yU;
    rects.push({
      pos: m.index,
      x0: Math.min(x0, x1),
      y0: Math.min(y0, y1),
      x1: Math.max(x0, x1),
      y1: Math.max(y0, y1),
    });
  }
  return rects;
}

/**
 * 특정 문장(stmt.start)이 속한 \begin{scope} ... \end{scope} 내부의 \clip 사각형을 찾는다.
 */
export function findActiveClipForStmtV022(body, stmt, units) {
  if (!body || !stmt || !units) return null;
  const masked = maskComments(body);
  const scopeRe = /\\begin\{scope\}[\s\S]*?\\end\{scope\}/g;
  let m;
  while ((m = scopeRe.exec(masked)) !== null) {
    const s0 = m.index;
    const s1 = s0 + m[0].length;
    if (stmt.start >= s0 && stmt.end <= s1) {
      const clips = extractClipRectsPtV022(m[0], units);
      if (clips.length > 0) return clips[clips.length - 1];
    }
  }
  return null;
}

/**
 * plot 문장의 함수 fn(u)에 대해 구간 [uFrom, uTo]의 렌더링 pt 폴리라인 샘플과 호의 길이(arcLengthPt)를 계산
 */
export function samplePlotSegmentPtV022(fn, uFrom, uTo, units, nSamples = 32) {
  const xU = units?.xU || 28.45274;
  const yU = units?.yU || 28.45274;
  const pts = [];
  let arcLengthPt = 0;
  let maxSlopePtPerPt = 0;
  let prevSlopeSign = 0;
  let slopeSignFlips = 0;
  let nonFinite = false;

  for (let i = 0; i <= nSamples; i++) {
    const t = i / nSamples;
    const u = uFrom + (uTo - uFrom) * t;
    let yMath;
    try {
      yMath = fn(u);
    } catch {
      nonFinite = true;
      break;
    }
    if (typeof yMath !== "number" || !Number.isFinite(yMath) || Math.abs(yMath) > 1e4) {
      nonFinite = true;
      break;
    }
    const p = [u * xU, yMath * yU];
    if (pts.length > 0) {
      const prev = pts[pts.length - 1];
      const dx = p[0] - prev[0];
      const dy = p[1] - prev[1];
      const ds = Math.hypot(dx, dy);
      arcLengthPt += ds;
      const slope = Math.abs(dx) > 1e-6 ? Math.abs(dy / dx) : 1e6;
      if (slope > maxSlopePtPerPt) maxSlopePtPerPt = slope;
      if (Math.abs(dy) > 0.05) {
        const sgn = dy > 0 ? 1 : -1;
        if (prevSlopeSign !== 0 && sgn !== prevSlopeSign) slopeSignFlips++;
        prevSlopeSign = sgn;
      }
    }
    pts.push(p);
  }

  return {
    ok: !nonFinite && pts.length >= 2,
    pts,
    endPt: pts.length > 0 ? pts[pts.length - 1] : null,
    arcLengthPt: r2(arcLengthPt),
    maxSlopePtPerPt: r2(maxSlopePtPerPt),
    slopeSignFlips,
  };
}

/**
 * 렌더링 호 길이(targetArcPt)에 대응하는 새로운 정의역 끝점 uNew를 미분 호 길이 적분으로 계산
 */
export function solveDomainEndForArcLengthPtV022(
  fn,
  uStart,
  directionSign,
  targetArcPt,
  units,
  config = DEFAULT_DOMAIN_EXT_CONFIG_V022
) {
  const xU = units?.xU || 28.45274;
  const yU = units?.yU || 28.45274;
  const stepDu = 0.005 * (directionSign >= 0 ? 1 : -1);
  let u = uStart;
  let accumPt = 0;
  let prevPt = [u * xU, fn(u) * yU];
  if (!Number.isFinite(prevPt[1])) return null;

  const maxSteps = 2000;
  for (let step = 0; step < maxSteps; step++) {
    const nextU = u + stepDu;
    let nextY;
    try {
      nextY = fn(nextU);
    } catch {
      return null;
    }
    if (typeof nextY !== "number" || !Number.isFinite(nextY)) return null;
    const nextPt = [nextU * xU, nextY * yU];
    const ds = Math.hypot(nextPt[0] - prevPt[0], nextPt[1] - prevPt[1]);
    if (ds > 50) return null;
    accumPt += ds;
    u = nextU;
    prevPt = nextPt;
    if (accumPt >= targetArcPt) break;
  }

  const roundStep = config.domainRoundStep || 0.02;
  const uRounded = Math.round(u / roundStep) * roundStep;
  return Number(uRounded.toFixed(2));
}

/**
 * TikZ 코드에서 특정 plot 문장(stmt)의 domain=a:b 옵션만 정밀 치환하는 편집 객체 생성
 */
export function buildDomainEditV022(body, stmt, newDomain) {
  const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)`;
  const stmtText = body.slice(stmt.start, stmt.end);
  const dmRe = new RegExp(String.raw`(domain\s*=\s*)(${NUM})(\s*:\s*)(${NUM})`);
  const m = dmRe.exec(stmtText);
  if (!m) return null;
  const matchStartInBody = stmt.start + m.index;
  const matchEndInBody = matchStartInBody + m[0].length;
  const fmt = (v) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2))));
  const replacement = `${m[1]}${fmt(newDomain[0])}${m[3]}${fmt(newDomain[1])}`;
  return {
    kind: "domain-micro-ext",
    start: matchStartInBody,
    end: matchEndInBody,
    oldText: m[0],
    replacement,
    oldDomain: [...stmt.domain],
    newDomain: [Number(fmt(newDomain[0])), Number(fmt(newDomain[1]))],
  };
}

/**
 * 8단계 보수적 안전 필터 (Safety Gates 1~7; Gate 8은 필요성 및 개선 폭 판정)
 */
export function evaluateDomainExtensionSafetyGuardsV022({
  scene,
  node,
  stroke,
  assignment,
  endIdx,
  uNew,
  config = DEFAULT_DOMAIN_EXT_CONFIG_V022,
  ignoreNodeIds = new Set(),
  applyAxis = true,
}) {
  const C = { ...DEFAULT_DOMAIN_EXT_CONFIG_V022, ...(config || {}) };
  const gates = [];

  // Gate 1: 라벨-곡선 매칭 확정성 및 단일 plot 수식 존재 여부
  const stmt = stroke?.stmt;
  const hasPlotFn = Boolean(
    stmt &&
      stmt.type === "plot" &&
      Array.isArray(stmt.domain) &&
      stmt.domain.length === 2 &&
      typeof stmt.fn === "function"
  );
  const matchConfirmed = Boolean(assignment && assignment.confirmed);
  const gate1Pass = matchConfirmed && hasPlotFn;
  gates.push({
    gate: "Gate 1 (매칭 확정 및 유효 plot 함수식)",
    code: "unconfirmed-match",
    passed: gate1Pass,
    detail: gate1Pass
      ? `매칭 확정(${assignment.how}) 및 plot domain=[${stmt.domain[0]}, ${stmt.domain[1]}] 확인`
      : "라벨-곡선 대응이 미확정이거나 단일 plot 수식이 아님",
  });
  if (!gate1Pass) {
    return {
      safe: false,
      blockedCode: "unconfirmed-match",
      blockedReason: gates[gates.length - 1].detail,
      gates,
    };
  }

  const [u0, u1] = stmt.domain;
  const uOrigEnd = endIdx === 0 ? u0 : u1;
  const dirSign = endIdx === 0 ? -1 : 1;
  const deltaU = (uNew - uOrigEnd) * dirSign;
  const domainSpan = Math.abs(u1 - u0);
  const origEndPt = endIdx === 0 ? stroke.pts[0] : stroke.pts[stroke.pts.length - 1];

  // Gate 2: 끝점이 점/원/폐구간 마커, 꼭짓점 라벨, 또는 축 투영 점선 보조선과 연결된 경우 차단
  let endpointMarkerHit = null;
  for (const nd of scene.nodes || []) {
    if (nd.id === node.id) continue;
    if (nd.role === "marker" || nd.role === "vertex") {
      const pt =
        nd.at ||
        nd.anchor ||
        (nd.bbox ? [(nd.bbox.x0 + nd.bbox.x1) / 2, (nd.bbox.y0 + nd.bbox.y1) / 2] : null);
      if (pt && Math.hypot(pt[0] - origEndPt[0], pt[1] - origEndPt[1]) <= C.markerLockRadiusPt) {
        endpointMarkerHit = `끝점(${r2(origEndPt[0])}, ${r2(origEndPt[1])})이 마커/꼭짓점 노드(${nd.label || nd.role})와 연결됨`;
        break;
      }
    }
  }
  if (!endpointMarkerHit && scene.geom && Array.isArray(scene.geom.paths)) {
    for (const p of scene.geom.paths) {
      if (p.kind === "marker" || (p.kind === "filled" && p.bbox)) {
        const b = p.bbox;
        if (!b) continue;
        const w = b.x1 - b.x0;
        const h = b.y1 - b.y0;
        if (w <= 12 && h <= 12) {
          const cx = (b.x0 + b.x1) / 2;
          const cy = (b.y0 + b.y1) / 2;
          if (Math.hypot(cx - origEndPt[0], cy - origEndPt[1]) <= C.markerLockRadiusPt) {
            endpointMarkerHit = `끝점이 점/원 마커 도형(반경 ${r2(Math.max(w, h) / 2)}pt)과 연결됨`;
            break;
          }
        }
      }
    }
  }
  if (!endpointMarkerHit) {
    for (const s of scene.strokes || []) {
      if (s.index === stroke.index || s.kind === "axis") continue;
      if (!s.pts || s.pts.length < 2) continue;
      const sp0 = s.pts[0];
      const sp1 = s.pts[s.pts.length - 1];
      const d0 = Math.hypot(sp0[0] - origEndPt[0], sp0[1] - origEndPt[1]);
      const d1 = Math.hypot(sp1[0] - origEndPt[0], sp1[1] - origEndPt[1]);
      if (Math.min(d0, d1) <= C.markerLockRadiusPt) {
        endpointMarkerHit = `끝점이 보조선/다른 선분(#${s.index})의 끝점과 직접 맞닿아 정의역 경계를 나타냄(거리 ${r2(Math.min(d0, d1))}pt)`;
        break;
      }
    }
  }
  const gate2Pass = !endpointMarkerHit;
  gates.push({
    gate: "Gate 2 (정의역 끝점 마커·투영선 잠금 검사)",
    code: "endpoint-marker-or-tick-locked",
    passed: gate2Pass,
    detail: gate2Pass ? "끝점에 연결된 마커·꼭짓점·투영 보조선 없음" : endpointMarkerHit,
  });
  if (!gate2Pass) {
    return {
      safe: false,
      blockedCode: "endpoint-marker-or-tick-locked",
      blockedReason: endpointMarkerHit,
      gates,
    };
  }

  // Gate 4: Piecewise 함수 또는 다중 주기 가지(periodicBranches) 여부 검사
  let piecewiseHit = null;
  if (Array.isArray(assignment.periodicBranches) && assignment.periodicBranches.length > 1) {
    piecewiseHit = `다중 주기 가지(${assignment.periodicBranches.map((i) => `#${i}`).join(", ")})로 구성된 함수는 개별 가지 연장을 차단함 (Gate 4)`;
  } else {
    for (const s of scene.strokes || []) {
      if (s.index === stroke.index || !s.stmt || s.stmt.type !== "plot" || !Array.isArray(s.stmt.domain)) continue;
      const [ou0, ou1] = s.stmt.domain;
      if (Math.abs(u1 - ou0) <= 0.05 || Math.abs(u0 - ou1) <= 0.05 || Math.abs(uOrigEnd - ou0) <= 0.05 || Math.abs(uOrigEnd - ou1) <= 0.05) {
        piecewiseHit = `다른 plot 구간(#${s.index}: domain=[${ou0}, ${ou1}])과 정의역 경계(${uOrigEnd})를 공유하는 구간별(piecewise) 함수 (Gate 4)`;
        break;
      }
    }
  }
  const gate4Pass = !piecewiseHit;
  gates.push({
    gate: "Gate 4 (구간별 함수 및 다중 plot 조각 보호)",
    code: "piecewise-or-multi-branch",
    passed: gate4Pass,
    detail: gate4Pass ? "단일 연속 plot 곡선 확인" : piecewiseHit,
  });
  if (!gate4Pass) {
    return {
      safe: false,
      blockedCode: "piecewise-or-multi-branch",
      blockedReason: piecewiseHit,
      gates,
    };
  }

  // Gate 3: 불연속점, 점근선, 발산 기울기 및 단조성 반전(새 극점 생성) 위험 구간 검사
  const extSeg = samplePlotSegmentPtV022(stmt.fn, uOrigEnd, uNew, scene.units, 36);
  const lookaheadU = uNew + dirSign * Math.min(0.15, Math.max(0.05, deltaU * 0.35));
  const lookaheadSeg = samplePlotSegmentPtV022(stmt.fn, uOrigEnd, lookaheadU, scene.units, 40);

  let hazardReason = null;
  if (!extSeg.ok || !lookaheadSeg.ok) {
    hazardReason = "연장 구간 또는 인접 구간에서 함수값이 정의되지 않거나 발산함 (Gate 3)";
  } else if (
    extSeg.maxSlopePtPerPt > C.maxSlopePtPerPt ||
    lookaheadSeg.maxSlopePtPerPt > C.maxSlopePtPerPt * 1.25
  ) {
    hazardReason = `연장 구간의 렌더링 기울기(${extSeg.maxSlopePtPerPt} pt/pt)가 급격히 발산하여 점근선/특이점 위험 구간으로 판정됨 (Gate 3)`;
  } else if (extSeg.slopeSignFlips > 0) {
    hazardReason = "연장 구간 내에서 기울기 부호가 반전되어 원본에 없던 새로운 극점(변곡/꺾임)이 생성됨 (Gate 3)";
  } else {
    for (const s of scene.strokes || []) {
      if (s.index === stroke.index || s.kind === "axis") continue;
      const sk = classifyStrokeKind(s);
      if (sk === "verticalLine") {
        const vx = s.pts[0][0];
        const dStart = Math.abs(origEndPt[0] - vx);
        const dEnd = Math.abs(extSeg.endPt[0] - vx);
        if (dEnd < dStart && dEnd <= C.asymptoteClearanceMinPt && extSeg.maxSlopePtPerPt >= 3.5) {
          hazardReason = `연장 끝점이 수직 보조선/점근선(#${s.index}, x=${r2(vx)}pt)에 ${r2(dEnd)}pt까지 접근함 (Gate 3)`;
          break;
        }
      }
    }
  }
  const gate3Pass = !hazardReason;
  gates.push({
    gate: "Gate 3 (불연속·점근선·발산 및 극점 생성 차단)",
    code: "singularity-or-asymptote-hazard",
    passed: gate3Pass,
    detail: gate3Pass
      ? `연속·단조 유지 (최대 기울기 ${extSeg.maxSlopePtPerPt} pt/pt, 부호 반전 0회)`
      : hazardReason,
  });
  if (!gate3Pass) {
    return {
      safe: false,
      blockedCode: "singularity-or-asymptote-hazard",
      blockedReason: hazardReason,
      gates,
    };
  }

  // Gate 5: \clip 사각형 경계 이탈 검사 및 (applyAxis === false 일 때) 원본 축 끝점 초과 돌출 검사
  const activeClip = findActiveClipForStmtV022(scene.body, stmt, scene.units);
  let clipViolation = null;
  let axisBoundProtrusion = false;
  if (activeClip) {
    for (const p of extSeg.pts) {
      if (
        p[0] < activeClip.x0 + C.clipMarginPt ||
        p[0] > activeClip.x1 - C.clipMarginPt ||
        p[1] < activeClip.y0 + C.clipMarginPt ||
        p[1] > activeClip.y1 - C.clipMarginPt
      ) {
        clipViolation = `연장 구간 점(${r2(p[0])}, ${r2(p[1])})이 \\clip 경계([${r2(activeClip.x0)}, ${r2(activeClip.y0)}]..[${r2(activeClip.x1)}, ${r2(activeClip.y1)}]) 바깥 또는 경계에 도달함 (Gate 5)`;
        break;
      }
    }
  }
  // 축 자동 조정이 OFF(applyAxis === false)일 때:
  // 원본부터 이미 축을 넘어간 그래프는 허용하되, 기존 끝점이 원본 축 내부(또는 끝점)에 있었는데
  // 새로 추가된 연장이 원본 축 끝점을 넘어 돌출되는 경우 차단한다.
  if (!clipViolation && !applyAxis && scene.axes?.x && scene.axes?.y && scene.units?.xU && scene.units?.yU) {
    const { xU, yU } = scene.units;
    const xr = Math.max(scene.axes.x.from, scene.axes.x.to) * xU;
    const xl = Math.min(scene.axes.x.from, scene.axes.x.to) * xU;
    const yt = Math.max(scene.axes.y.from, scene.axes.y.to) * yU;
    const yb = Math.min(scene.axes.y.from, scene.axes.y.to) * yU;
    const tol = 1.5;
    const endPt = extSeg.endPt;
    if (endPt) {
      if (origEndPt[0] <= xr + tol && endPt[0] > xr + tol) {
        axisBoundProtrusion = true;
        clipViolation = `축 자동 조정 OFF 상태에서 연장 끝점(x=${r2(endPt[0] / xU)})이 원본 x축 끝(${r2(xr / xU)})을 넘어 돌출됨 (Gate 5)`;
      } else if (origEndPt[0] >= xl - tol && endPt[0] < xl - tol) {
        axisBoundProtrusion = true;
        clipViolation = `축 자동 조정 OFF 상태에서 연장 끝점(x=${r2(endPt[0] / xU)})이 원본 x축 왼쪽 끝(${r2(xl / xU)})을 넘어 돌출됨 (Gate 5)`;
      } else if (origEndPt[1] <= yt + tol && endPt[1] > yt + tol) {
        axisBoundProtrusion = true;
        clipViolation = `축 자동 조정 OFF 상태에서 연장 끝점(y=${r2(endPt[1] / yU)})이 원본 y축 끝(${r2(yt / yU)})을 넘어 돌출됨 (Gate 5)`;
      } else if (origEndPt[1] >= yb - tol && endPt[1] < yb - tol) {
        axisBoundProtrusion = true;
        clipViolation = `축 자동 조정 OFF 상태에서 연장 끝점(y=${r2(endPt[1] / yU)})이 원본 y축 아래쪽 끝(${r2(yb / yU)})을 넘어 돌출됨 (Gate 5)`;
      }
    }
  }
  const gate5Pass = !clipViolation;
  gates.push({
    gate: "Gate 5 (\\clip 가시 영역 및 원본 축 경계 보호)",
    code: axisBoundProtrusion ? "axis-extension-required" : "outside-clip-or-axis-bound",
    passed: gate5Pass,
    detail: gate5Pass
      ? activeClip
        ? "\\clip 영역 내부 안전 여유 확인"
        : "\\clip 미사용 및 축 경계 안전 확인"
      : clipViolation,
  });
  if (!gate5Pass) {
    return {
      safe: false,
      blockedCode: axisBoundProtrusion ? "axis-extension-required" : "outside-clip-or-axis-bound",
      blockedReason: clipViolation,
      gates,
    };
  }

  // Gate 6: 연장된 곡선 구간(extSeg)이 다른 곡선/직선과 새로운 교점을 만들거나 다른 노드 bbox와 충돌하는지 검사
  let collisionHit = null;
  for (const s of scene.strokes || []) {
    if (s.index === stroke.index || s.kind === "axis") continue;
    if (!s.pts || s.pts.length < 2) continue;
    const dist =
      minDistPolylines([{ pts: extSeg.pts, closed: false }], [{ pts: s.pts, closed: false }]) -
      ((stroke.halfWidth || 0.75) + (s.halfWidth || 0.5));
    const tailPts = extSeg.pts.slice(Math.min(4, extSeg.pts.length - 2));
    const tailDist =
      minDistPolylines([{ pts: tailPts, closed: false }], [{ pts: s.pts, closed: false }]) -
      ((stroke.halfWidth || 0.75) + (s.halfWidth || 0.5));
    const startDist = minDistPolylines(
      [{ pts: [origEndPt, origEndPt], closed: false }],
      [{ pts: s.pts, closed: false }]
    );
    const movingAway = tailDist > startDist + 1.0;

    if (tailDist < C.otherStrokeMinClearPt && !movingAway) {
      collisionHit = `연장 구간이 다른 선/곡선(#${s.index})과 ${r2(tailDist)}pt로 근접하거나 새로운 교점을 형성함 (Gate 6)`;
      break;
    }
    if (dist < 0.5 && !movingAway) {
      collisionHit = `연장 구간이 다른 선/곡선(#${s.index})과 교차함(간격 ${r2(dist)}pt) (Gate 6)`;
      break;
    }
  }
  if (!collisionHit) {
    const tailPts = extSeg.pts.slice(Math.min(4, extSeg.pts.length - 2));
    for (const nd of scene.nodes || []) {
      if (nd.id === node.id || ignoreNodeIds.has(nd.id) || !nd.bbox || nd.role === "marker") continue;
      // applyAxis === true 일 때만 축 연장으로 함께 이동할 인라인 축라벨을 예외 처리하고,
      // applyAxis === false 일 때는 고정된 인라인 축라벨(x, y)의 실제 bbox를 그대로 검사한다.
      if (applyAxis && nd.role === "axisLabel" && nd.kind === "inline") continue;
      const clAll =
        minDistPolylines([rectPoly(nd.bbox)], [{ pts: extSeg.pts, closed: false }]) -
        (stroke.halfWidth || 0.75);
      const clTail =
        minDistPolylines([rectPoly(nd.bbox)], [{ pts: tailPts, closed: false }]) -
        (stroke.halfWidth || 0.75);
      const clStart =
        minDistPolylines([rectPoly(nd.bbox)], [{ pts: [origEndPt, origEndPt], closed: false }]) -
        (stroke.halfWidth || 0.75);
      const movingAwayNode = clTail > clStart + 1.0 && clAll >= clStart - 0.05;
      if (clTail < C.otherNodeMinClearPt && !movingAwayNode) {
        collisionHit = `연장 구간이 기존 노드(${nd.label}, role=${nd.role}) bbox와 ${r2(clTail)}pt로 침범/근접함 (Gate 6)`;
        break;
      }
      if (clAll < 0.5 && !movingAwayNode) {
        collisionHit = `연장 구간이 기존 노드(${nd.label}, role=${nd.role}) bbox와 ${r2(clAll)}pt로 침범함 (Gate 6)`;
        break;
      }
    }
  }
  const gate6Pass = !collisionHit;
  gates.push({
    gate: "Gate 6 (신규 교점 및 타 노드 충돌 차단)",
    code: "new-intersection-or-collision",
    passed: gate6Pass,
    detail: gate6Pass ? "타 곡선/보조선 신규 교점 0건 및 타 노드 충돌 0건" : collisionHit,
  });
  if (!gate6Pass) {
    return {
      safe: false,
      blockedCode: "new-intersection-or-collision",
      blockedReason: collisionHit,
      gates,
    };
  }

  // Gate 7: 렌더링 호 길이(maxArcLengthPt) 및 정의역 비율(maxDomainRatio) 상한 검사
  const domainRatio = domainSpan > 1e-6 ? deltaU / domainSpan : 1;
  let capViolation = null;
  if (deltaU <= 0) {
    capViolation = "연장량이 0 이하임(축소 금지) (Gate 7)";
  } else if (extSeg.arcLengthPt > C.maxArcLengthPt + 0.5) {
    capViolation = `연장 호 길이(${extSeg.arcLengthPt}pt)가 상한(${C.maxArcLengthPt}pt)을 초과함 (Gate 7)`;
  } else if (domainRatio > C.maxDomainRatio + 0.01) {
    capViolation = `정의역 연장 비율(${r2(domainRatio * 100)}%)이 상한(${r2(C.maxDomainRatio * 100)}%)을 초과함 (Gate 7)`;
  }
  const gate7Pass = !capViolation;
  gates.push({
    gate: "Gate 7 (스케일 기반 연장량 상한 검사)",
    code: "max-extension-cap",
    passed: gate7Pass,
    detail: gate7Pass
      ? `연장 호 길이 ${extSeg.arcLengthPt}pt (<= ${C.maxArcLengthPt}pt), 정의역 비율 ${r2(domainRatio * 100)}% (<= ${r2(C.maxDomainRatio * 100)}%)`
      : capViolation,
  });
  if (!gate7Pass) {
    return {
      safe: false,
      blockedCode: "max-extension-cap",
      blockedReason: capViolation,
      gates,
    };
  }

  return {
    safe: true,
    blockedCode: null,
    blockedReason: null,
    extSeg,
    deltaU: r3(deltaU),
    domainRatio: r3(domainRatio),
    gates,
  };
}

/**
 * 주어진 라벨 bbox(candBbox)가 장면 내 타 선분(otherStrokes) 및 타 노드(otherNodes)와 유지하는 최소 간격 계산
 * - applyAxis === false 일 때는 인라인 축라벨(x, y)이 이동하지 않으므로 실제 bbox를 그대로 포함하여 검사한다.
 */
function measureBoxClearances(candBbox, ownStrokeIndex, strokes, nodes, ownNodeId, opts = {}) {
  const applyAxis = opts.applyAxis !== false;
  let minOtherPt = Infinity;
  for (const q of strokes || []) {
    if (!q || q.index === ownStrokeIndex || !Array.isArray(q.pts) || q.pts.length < 2) continue;
    const c = clearanceToStroke(candBbox, q);
    if (c < minOtherPt) minOtherPt = c;
  }
  let labelGapPt = Infinity;
  for (const ob of nodes || []) {
    if (
      !ob ||
      !ob.bbox ||
      ob.id === ownNodeId ||
      ob.role === "marker" ||
      (applyAxis && ob.role === "axisLabel" && ob.kind === "inline")
    ) {
      continue;
    }
    const g = bboxGapRect(candBbox, ob.bbox);
    if (g < labelGapPt) labelGapPt = g;
  }
  return {
    minOtherPt: Number.isFinite(minOtherPt) ? r2(minOtherPt) : 999,
    labelGapPt: Number.isFinite(labelGapPt) ? r2(labelGapPt) : 999,
  };
}

/**
 * v0.2.2-beta 그래프 끝점(domain) 미세 연장 및 라벨 위치 공동 최적화 플래너
 * - applyDomainExtension === false(기본값)일 때는 아무 작업도 수행하지 않고 빈 결과를 반환한다.
 * - applyDomainExtension === true일 때:
 *    1) 모든 함수식 노드에 대해 8단계 안전 게이트와 Gate 8 필요성 조건을 평가한다.
 *    2) 유형 I (Gap-Closure, 예: CASE-001):
 *       라벨이 직선/곡선 끝점 위/아래에 배치되었으나 끝점과의 거리(own >= 10pt)가 먼 경우,
 *       끝점이 라벨 가로 중앙 부근(relX ≈ 0.50)까지 오도록 최소 연장하고,
 *       라벨 수직 위치를 적정 간격(4.5~7.5pt, 목표 5.5pt)으로 공동 조정한다.
 *    3) 유형 II (Congestion-Escape, 예: CASE-002):
 *       라벨 매칭은 확정되었으나 기존 끝점 부근 보조선(점선 등) 혼잡으로 no-safe-candidate 보류된 경우,
 *       보조선과 충분한 여백(>= 8pt)을 확보하는 최소 라벨 이동과 적정 곡선 간격(4.5~7.5pt, 목표 5.8pt)을
 *       만드는 최소 domain 연장을 공동 탐색한다.
 */
export function planDomainMicroExtensionsV022(
  scene,
  basePlan,
  baseShift,
  P = PARAMS,
  opts = {}
) {
  const applyDomainExtension = Boolean(opts.applyDomainExtension === true);
  const applyAxis = opts.applyAxis !== false;
  const config = { ...DEFAULT_DOMAIN_EXT_CONFIG_V022, ...(opts.domainExtConfig || {}) };
  const flags = opts.flags || DEFAULT_UNIT2_FLAGS;

  const emptyResult = {
    requested: applyDomainExtension,
    applied: false,
    edits: [],
    decisions: [],
    updatedStrokesByIndex: new Map(),
    updatedPlacementsById: new Map(),
    updatedShiftReportById: new Map(),
    updatedLabelEditsById: new Map(),
  };

  if (!applyDomainExtension || !scene || !scene.ok) {
    return emptyResult;
  }

  const fnNodes = (scene.nodes || []).filter((n) => n.role === "function" && n.bbox);
  const assignedMap = assignStrokesUnit2(scene, fnNodes, flags);
  const placementsById = new Map((basePlan?.placements || []).map((p) => [p.id, p]));
  const skippedById = new Map((basePlan?.skipped || []).map((s) => [s.id, s]));
  const shiftById = new Map((baseShift?.report || []).map((r) => [r.id, r]));

  // 현재 다른 함수식 라벨들의 배치된 bbox를 반영한 노드 목록 구성
  const currentNodesForClearance = (scene.nodes || []).map((nd) => {
    const pl = placementsById.get(nd.id);
    if (pl && pl.action === "move" && pl.bbox) {
      return { ...nd, bbox: pl.bbox };
    }
    return nd;
  });

  const decisions = [];
  const edits = [];
  const updatedStrokesByIndex = new Map();
  const updatedPlacementsById = new Map();
  const updatedShiftReportById = new Map();
  const updatedLabelEditsById = new Map();

  for (const fnNode of fnNodes) {
    const asg = assignedMap.get(fnNode.id) || null;
    const stroke = asg?.stroke || null;
    const plItem = placementsById.get(fnNode.id) || null;
    const skItem = skippedById.get(fnNode.id) || null;
    const shItem = shiftById.get(fnNode.id) || null;

    const baseShiftPair = shItem
      ? [...shItem.newShift]
      : [fnNode.xshift || 0, fnNode.yshift || 0];
    const baseBbox = plItem?.bbox || fnNode.bbox;
    const origOwnGapPt = stroke ? r2(clearanceToStroke(baseBbox, stroke)) : null;
    const origClear = stroke
      ? measureBoxClearances(baseBbox, stroke.index, scene.strokes, currentNodesForClearance, fnNode.id, {
          applyAxis,
        })
      : { minOtherPt: null, labelGapPt: null };

    // Gate 1: 매칭 확정 및 단일 plot 곡선 확인 (다중 추상 함수 쌍은 domain 잠금)
    if (
      !asg ||
      !asg.confirmed ||
      asg.isMultiAbstractPair ||
      !stroke ||
      !stroke.stmt ||
      stroke.stmt.type !== "plot" ||
      !Array.isArray(stroke.stmt.domain) ||
      typeof stroke.stmt.fn !== "function"
    ) {
      decisions.push({
        nodeId: fnNode.id,
        label: fnNode.label,
        strokeIndex: stroke?.index ?? null,
        plotExpr: stroke?.stmt?.expr || null,
        action: "hold",
        triggerType: null,
        origDomain: stroke?.stmt?.domain ? [...stroke.stmt.domain] : null,
        newDomain: stroke?.stmt?.domain ? [...stroke.stmt.domain] : null,
        arcLengthPt: 0,
        domainRatioPct: 0,
        origOwnGapPt,
        newOwnGapPt: origOwnGapPt,
        origMinOtherPt: origClear.minOtherPt,
        newMinOtherPt: origClear.minOtherPt,
        origShift: baseShiftPair,
        newShift: baseShiftPair,
        holdCode: asg?.isMultiAbstractPair
          ? "multi-abstract-domain-locked"
          : "unconfirmed-or-non-plot",
        reason: asg?.isMultiAbstractPair
          ? "다중 추상 함수(유형 2)는 사용자 대응 승인 시에도 라벨 위치만 재배치하며 원본 그래프의 정의역(domain)은 자동 변경하지 않는 보수적 안전 정책을 적용함 (Gate 1)"
          : !asg?.confirmed
            ? `라벨-곡선 매칭 미확정(${asg?.how || "unmatched"})으로 그래프 끝점 연장을 보류함 (Gate 1)`
            : "대응 도형이 domain 기반 plot 곡선이 아니므로 끝점 연장 대상이 아님 (Gate 1)",
      });
      continue;
    }

    const dEnd0 = bboxPtDist(stroke.pts[0], baseBbox);
    const dEnd1 = bboxPtDist(stroke.pts[stroke.pts.length - 1], baseBbox);
    const endIdx = dEnd1 <= dEnd0 ? 1 : 0;
    const dirSign = endIdx === 0 ? -1 : 1;
    const uOrigEnd = stroke.stmt.domain[endIdx];
    const domainSpan = Math.abs(stroke.stmt.domain[1] - stroke.stmt.domain[0]);

    // 선행 안전 게이트 점검(Gate 2, Gate 3, Gate 4, Gate 5, Gate 6): 최소 시험 연장(12pt)으로 구조적 차단 사유 확인
    const probeU = solveDomainEndForArcLengthPtV022(
      stroke.stmt.fn,
      uOrigEnd,
      dirSign,
      12,
      scene.units,
      config
    );
    if (probeU !== null) {
      const probeGuard = evaluateDomainExtensionSafetyGuardsV022({
        scene,
        node: fnNode,
        stroke,
        assignment: asg,
        endIdx,
        uNew: probeU,
        config,
        applyAxis,
      });
      if (
        !probeGuard.safe &&
        (probeGuard.blockedCode === "piecewise-or-multi-branch" ||
          probeGuard.blockedCode === "endpoint-marker-or-tick-locked")
      ) {
        decisions.push({
          nodeId: fnNode.id,
          label: fnNode.label,
          strokeIndex: stroke.index,
          plotExpr: stroke.stmt.expr || null,
          action: "hold",
          triggerType: null,
          origDomain: [...stroke.stmt.domain],
          newDomain: [...stroke.stmt.domain],
          arcLengthPt: 0,
          domainRatioPct: 0,
          origOwnGapPt,
          newOwnGapPt: origOwnGapPt,
          origMinOtherPt: origClear.minOtherPt,
          newMinOtherPt: origClear.minOtherPt,
          origShift: baseShiftPair,
          newShift: baseShiftPair,
          holdCode: probeGuard.blockedCode,
          reason: probeGuard.blockedReason,
        });
        continue;
      }
    }

    // Gate 8 (필요성 판정):
    //  - 유형 I (Gap-Closure): 배치된 라벨과 자기 곡선 간격이 10pt 이상 벌어진 경우
    //  - 유형 II (Congestion-Escape): 매칭은 확정되었으나 no-safe-candidate로 보류되어 own >= 10pt 인 경우
    const needsCongestionEscape = Boolean(
      skItem &&
        skItem.category === "no-safe-candidate" &&
        typeof origOwnGapPt === "number" &&
        origOwnGapPt >= config.triggerMinOwnGapPt
    );
    const needsGapClosure = Boolean(
      !needsCongestionEscape &&
        typeof origOwnGapPt === "number" &&
        origOwnGapPt >= config.triggerMinOwnGapPt
    );

    // 원본 라벨 자체가 멀리 떨어져 있었으나(rawOwnGap >= 10pt) Gate 5(\clip) 또는 Gate 6(교차) 때문에 연장 불가한 경우 진단 기록
    const rawNodeOwnGapPt = r2(clearanceToStroke(fnNode.bbox, stroke));
    if (!needsGapClosure && !needsCongestionEscape) {
      let holdCode = "already-optimal-or-no-benefit";
      let holdReason = `현재 라벨-곡선 간격(${origOwnGapPt}pt)이 이미 적정 범위(< ${config.triggerMinOwnGapPt}pt)이므로 불필요한 그래프 연장을 생략함 (Gate 8)`;
      if (rawNodeOwnGapPt >= config.triggerMinOwnGapPt) {
        const rawEndIdx = bboxPtDist(stroke.pts[stroke.pts.length - 1], fnNode.bbox) <= bboxPtDist(stroke.pts[0], fnNode.bbox) ? 1 : 0;
        const rawProbeU = solveDomainEndForArcLengthPtV022(stroke.stmt.fn, stroke.stmt.domain[rawEndIdx], rawEndIdx === 0 ? -1 : 1, 12, scene.units, config);
        const probeGuard = rawProbeU !== null ? evaluateDomainExtensionSafetyGuardsV022({
          scene,
          node: fnNode,
          stroke,
          assignment: asg,
          endIdx: rawEndIdx,
          uNew: rawProbeU,
          config,
          applyAxis,
        }) : { safe: true };
        if (!probeGuard.safe) {
          holdCode = probeGuard.blockedCode;
          holdReason = probeGuard.blockedReason;
        }
      }
      decisions.push({
        nodeId: fnNode.id,
        label: fnNode.label,
        strokeIndex: stroke.index,
        plotExpr: stroke.stmt.expr || null,
        action: "hold",
        triggerType: null,
        origDomain: [...stroke.stmt.domain],
        newDomain: [...stroke.stmt.domain],
        arcLengthPt: 0,
        domainRatioPct: 0,
        origOwnGapPt,
        newOwnGapPt: origOwnGapPt,
        origMinOtherPt: origClear.minOtherPt,
        newMinOtherPt: origClear.minOtherPt,
        origShift: baseShiftPair,
        newShift: baseShiftPair,
        holdCode,
        reason: holdReason,
      });
      continue;
    }

    const triggerType = needsCongestionEscape ? "congestion-escape" : "gap-closure";

    const findBestJointCandidateForAxisMode = (axisModeFlag) => {
      let bestCand = null;
      let firstBlock = null;

      if (triggerType === "gap-closure") {
        // ----------------------------------------------------------------------
        // 유형 I (Gap-Closure):
        //  라벨의 가로 위치(baseShiftPair[0])는 그대로 유지하면서,
        //  1) 곡선 끝점이 라벨 가로 중앙 부근(relX ∈ [0.48, 0.68], 목표 0.51)에 도달하는 최소 domain 연장을 찾고,
        //  2) 연장된 끝점과 라벨 사이의 수직 간격(yshift)을 적정 범위(4.5~7.5pt, 목표 5.5pt)로 공동 최적화한다.
        // ----------------------------------------------------------------------
        const seenU = new Set();
        for (const arcPt of config.arcStepGridPt) {
          const uCand = solveDomainEndForArcLengthPtV022(
            stroke.stmt.fn,
            uOrigEnd,
            dirSign,
            arcPt,
            scene.units,
            config
          );
          if (uCand === null || seenU.has(uCand)) continue;
          seenU.add(uCand);

          const safety = evaluateDomainExtensionSafetyGuardsV022({
            scene,
            node: fnNode,
            stroke,
            assignment: asg,
            endIdx,
            uNew: uCand,
            config,
            applyAxis: axisModeFlag,
          });
          if (!safety.safe) {
            if (!firstBlock) firstBlock = safety;
            continue;
          }

          const newDomain =
            endIdx === 0 ? [uCand, stroke.stmt.domain[1]] : [stroke.stmt.domain[0], uCand];
          const domainEdit = buildDomainEditV022(scene.body, stroke.stmt, newDomain);
          if (!domainEdit) continue;

          const fullStrokePts =
            endIdx === 1
              ? [...stroke.pts, ...safety.extSeg.pts.slice(1)]
              : [...safety.extSeg.pts.slice(0, -1).reverse(), ...stroke.pts];
          const extStrokeObj = { ...stroke, pts: fullStrokePts };
          const newEndPt = safety.extSeg.endPt;

          const wBox = baseBbox.x1 - baseBbox.x0;
          const relX =
            wBox > 1e-6
              ? dirSign >= 0
                ? (newEndPt[0] - baseBbox.x0) / wBox
                : (baseBbox.x1 - newEndPt[0]) / wBox
              : 0.5;

          if (relX < config.gapClosureMinRelX || relX > config.gapClosureMaxRelX) {
            continue;
          }

          // 수직 미세 이동(dyStep ∈ [-2..+5]pt) 후보 탐색
          for (const dyStep of [0, 1, 2, 3, 4, 5, -1, -2]) {
            const candShift = [baseShiftPair[0], baseShiftPair[1] + dyStep];
            const candBbox = bboxFromShift(fnNode, candShift);
            const ownGapPt = r2(clearanceToStroke(candBbox, extStrokeObj));
            const endGapPt = r2(bboxPtDist(newEndPt, candBbox));
            const { minOtherPt, labelGapPt } = measureBoxClearances(
              candBbox,
              stroke.index,
              scene.strokes,
              currentNodesForClearance,
              fnNode.id,
              { applyAxis: axisModeFlag }
            );

            if (
              ownGapPt < config.comfortableOwnGapMinPt ||
              ownGapPt > config.comfortableOwnGapMaxPt
            ) {
              continue;
            }
            if (minOtherPt < config.jointMinOtherClearPt || labelGapPt < config.jointMinLabelGapPt) {
              continue;
            }

            const score =
              Math.abs(relX - config.gapClosureIdealRelX) * 25.0 +
              Math.abs(ownGapPt - 5.5) * 6.0 +
              safety.extSeg.arcLengthPt * 0.15 +
              Math.abs(dyStep) * 0.1;

            if (!bestCand || score < bestCand.score) {
              bestCand = {
                score: r2(score),
                uNew: uCand,
                newDomain,
                domainEdit,
                extStrokeObj,
                arcLengthPt: safety.extSeg.arcLengthPt,
                domainRatioPct: r2(safety.domainRatio * 100),
                candShift,
                candBbox,
                ownGapPt,
                endGapPt,
                minOtherPt,
                labelGapPt,
                relX: r2(relX),
                gates: safety.gates,
              };
            }
          }
        }
      } else {
        // ----------------------------------------------------------------------
        // 유형 II (Congestion-Escape):
        //  기존 끝점 부근 보조선(점선 등) 혼잡으로 보류된 라벨에 대해:
        //  1) 보조선 및 타 선분과의 간격(minOtherPt >= 8.0pt) 및 타 노드 간격(labelGapPt >= 5.5pt)을
        //     확보하는 최소 라벨 이동(dx ∈ [0..8]pt, dy ∈ [-3..3]pt)을 찾고,
        //  2) 정의역 끝점을 0.02 단위로 미세 연장하여 연장된 곡선과 라벨 간격(ownGapPt)이
        //     평가원 적정 범위(4.5~7.5pt, 이상적 5.8pt)에 들어오는 최소 연장 후보를 공동 선택한다.
        // ----------------------------------------------------------------------
        const uStep = (config.domainRoundStep || 0.02) * dirSign;
        const maxSteps = Math.min(40, Math.floor((domainSpan * config.maxDomainRatio) / Math.abs(uStep)));

        const safeDomainSteps = [];
        for (let k = 1; k <= maxSteps; k++) {
          const uCand = Number((uOrigEnd + k * uStep).toFixed(2));
          const safety = evaluateDomainExtensionSafetyGuardsV022({
            scene,
            node: fnNode,
            stroke,
            assignment: asg,
            endIdx,
            uNew: uCand,
            config,
            applyAxis: axisModeFlag,
          });
          if (!safety.safe) {
            if (!firstBlock) firstBlock = safety;
            continue;
          }
          const newDomain =
            endIdx === 0 ? [uCand, stroke.stmt.domain[1]] : [stroke.stmt.domain[0], uCand];
          const domainEdit = buildDomainEditV022(scene.body, stroke.stmt, newDomain);
          if (!domainEdit) continue;

          const fullStrokePts =
            endIdx === 1
              ? [...stroke.pts, ...safety.extSeg.pts.slice(1)]
              : [...safety.extSeg.pts.slice(0, -1).reverse(), ...stroke.pts];
          safeDomainSteps.push({
            uCand,
            newDomain,
            domainEdit,
            extStrokeObj: { ...stroke, pts: fullStrokePts },
            newEndPt: safety.extSeg.endPt,
            arcLengthPt: safety.extSeg.arcLengthPt,
            domainRatioPct: r2(safety.domainRatio * 100),
            gates: safety.gates,
          });
        }

        const dxCandidates = dirSign >= 0 ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [0, -1, -2, -3, -4, -5, -6, -7, -8];
        const dyCandidates = [0, -1, 1, -2, 2];

        for (const dx of dxCandidates) {
          for (const dy of dyCandidates) {
            const candShift = [baseShiftPair[0] + dx, baseShiftPair[1] + dy];
            const candBbox = bboxFromShift(fnNode, candShift);
            const { minOtherPt, labelGapPt } = measureBoxClearances(
              candBbox,
              stroke.index,
              scene.strokes,
              currentNodesForClearance,
              fnNode.id,
              { applyAxis: axisModeFlag }
            );
            if (
              minOtherPt < config.congestionEscapeMinClearPt ||
              labelGapPt < config.jointMinLabelGapPt
            ) {
              continue;
            }

            for (const dStep of safeDomainSteps) {
              const ownGapPt = r2(clearanceToStroke(candBbox, dStep.extStrokeObj));
              const endGapPt = r2(bboxPtDist(dStep.newEndPt, candBbox));
              if (
                ownGapPt < config.comfortableOwnGapMinPt ||
                ownGapPt > config.comfortableOwnGapMaxPt ||
                endGapPt > config.comfortableOwnGapMaxPt + 0.5
              ) {
                continue;
              }

              const moveMagnitude = Math.abs(dx) + Math.abs(dy) * 1.5;
              const score =
                moveMagnitude * 3.5 +
                Math.abs(ownGapPt - 5.8) * 12.0 +
                dStep.arcLengthPt * 0.15;

              if (!bestCand || score < bestCand.score) {
                bestCand = {
                  score: r2(score),
                  uNew: dStep.uCand,
                  newDomain: dStep.newDomain,
                  domainEdit: dStep.domainEdit,
                  extStrokeObj: dStep.extStrokeObj,
                  arcLengthPt: dStep.arcLengthPt,
                  domainRatioPct: dStep.domainRatioPct,
                  candShift,
                  candBbox,
                  ownGapPt,
                  endGapPt,
                  minOtherPt,
                  labelGapPt,
                  relX: null,
                  gates: dStep.gates,
                };
              }
            }
          }
        }
      }

      return { bestCand, firstBlock };
    };

    const primarySearch = findBestJointCandidateForAxisMode(applyAxis);
    const bestJointCandidate = primarySearch.bestCand;
    const firstGateBlock = primarySearch.firstBlock;

    if (!bestJointCandidate) {
      let holdCode = firstGateBlock?.blockedCode || "no-safe-joint-candidate";
      let holdReason =
        firstGateBlock?.blockedReason ||
        "8단계 안전 게이트와 적정 간격(4.5~7.5pt)을 동시에 만족하는 미세 연장 후보가 없어 원본 정의역을 유지함";
      let requiresAxisExtension = false;
      let wouldExtendDomain = null;

      if (!applyAxis) {
        const axisOnSearch = findBestJointCandidateForAxisMode(true);
        if (axisOnSearch.bestCand || firstGateBlock?.blockedCode === "axis-extension-required") {
          holdCode = "axis-extension-required";
          requiresAxisExtension = true;
          wouldExtendDomain = axisOnSearch.bestCand ? [...axisOnSearch.bestCand.newDomain] : null;
          holdReason =
            "원본 x축 범위와 축라벨 안전 여백을 보호하기 위해 그래프 끝점 연장을 보류했습니다. 축 길이 자동 조정을 함께 켜면 연장이 가능합니다.";
        }
      }

      decisions.push({
        nodeId: fnNode.id,
        label: fnNode.label,
        strokeIndex: stroke.index,
        plotExpr: stroke.stmt.expr || null,
        action: "hold",
        triggerType,
        origDomain: [...stroke.stmt.domain],
        newDomain: [...stroke.stmt.domain],
        arcLengthPt: 0,
        domainRatioPct: 0,
        origOwnGapPt,
        newOwnGapPt: origOwnGapPt,
        origMinOtherPt: origClear.minOtherPt,
        newMinOtherPt: origClear.minOtherPt,
        origShift: baseShiftPair,
        newShift: baseShiftPair,
        holdCode,
        requiresAxisExtension,
        wouldExtendDomain,
        reason: holdReason,
      });
      continue;
    }

    // 채택된 그래프 끝점 연장 및 라벨 공동 배치 반영
    edits.push(bestJointCandidate.domainEdit);
    updatedStrokesByIndex.set(stroke.index, bestJointCandidate.extStrokeObj);

    const sx = fnNode.scale ? fnNode.scale[0] : 1;
    const sy = fnNode.scale ? fnNode.scale[1] : 1;
    const oldX = fnNode.xshift || 0;
    const oldY = fnNode.yshift || 0;
    const newX = bestJointCandidate.candShift[0];
    const newY = bestJointCandidate.candShift[1];
    const actualDxPt = r2((newX - oldX) * sx);
    const actualDyPt = r2((newY - oldY) * sy);
    const movedDistPt = r2(Math.hypot(actualDxPt, actualDyPt));

    const reasonText =
      triggerType === "gap-closure"
        ? `그래프 끝점 미세 연장(domain=${bestJointCandidate.domainEdit.oldDomain.join(":")} → ${bestJointCandidate.newDomain.join(":")}, +${bestJointCandidate.arcLengthPt}pt) 및 라벨 위치 공동 조정(shift=[${newX}, ${newY}]pt, 라벨-그래프 간격 ${origOwnGapPt}pt → ${bestJointCandidate.ownGapPt}pt)`
        : `그래프 끝점 미세 연장(domain=${bestJointCandidate.domainEdit.oldDomain.join(":")} → ${bestJointCandidate.newDomain.join(":")}, +${bestJointCandidate.arcLengthPt}pt)으로 점선 혼잡 구간 탈출 및 라벨 공동 배치(shift=[${newX}, ${newY}]pt, 점선 간격 ${origClear.minOtherPt}pt → ${bestJointCandidate.minOtherPt}pt, 라벨-그래프 간격 ${origOwnGapPt}pt → ${bestJointCandidate.ownGapPt}pt)`;

    if (newX !== oldX || newY !== oldY) {
      const shText = setShifts(fnNode, newX, newY);
      updatedLabelEditsById.set(fnNode.id, {
        kind: "label-shift",
        id: fnNode.id,
        start: shText.start,
        end: shText.end,
        replacement: shText.replacement,
      });
      updatedShiftReportById.set(fnNode.id, {
        id: fnNode.id,
        label: fnNode.label,
        how: asg.how,
        strokeKind: asg.strokeKind || classifyStrokeKind(stroke),
        selectedEngine: "v0.2.2-beta",
        oldShift: [oldX, oldY],
        newShift: [newX, newY],
        scale: fnNode.scale,
        neededMovePt: [actualDxPt, actualDyPt],
      });
    }

    updatedPlacementsById.set(fnNode.id, {
      ...(plItem || {}),
      id: fnNode.id,
      label: fnNode.label,
      action: newX !== oldX || newY !== oldY ? "move" : "keep",
      reason: reasonText,
      stroke: stroke.index,
      strokeKind: asg.strokeKind || classifyStrokeKind(stroke),
      how: asg.how,
      confirmedAssignment: true,
      uncertainAssignment: false,
      end: endIdx,
      side: plItem?.side || (dirSign >= 0 ? "right" : "left"),
      alpha: plItem?.alpha ?? 0,
      bbox: bestJointCandidate.candBbox,
      from: fnNode.bbox,
      shift: [newX, newY],
      eval: {
        minOther: bestJointCandidate.minOtherPt,
        own: bestJointCandidate.ownGapPt,
        labelGap: bestJointCandidate.labelGapPt,
      },
    });

    decisions.push({
      nodeId: fnNode.id,
      label: fnNode.label,
      strokeIndex: stroke.index,
      plotExpr: stroke.stmt.expr || null,
      action: "extend",
      triggerType,
      origDomain: [...stroke.stmt.domain],
      newDomain: [...bestJointCandidate.newDomain],
      arcLengthPt: bestJointCandidate.arcLengthPt,
      domainRatioPct: bestJointCandidate.domainRatioPct,
      origOwnGapPt,
      newOwnGapPt: bestJointCandidate.ownGapPt,
      origMinOtherPt: origClear.minOtherPt,
      newMinOtherPt: bestJointCandidate.minOtherPt,
      origShift: baseShiftPair,
      newShift: [newX, newY],
      holdCode: null,
      reason: reasonText,
    });
  }

  return {
    requested: true,
    applied: edits.length > 0,
    edits,
    decisions,
    updatedStrokesByIndex,
    updatedPlacementsById,
    updatedShiftReportById,
    updatedLabelEditsById,
  };
}
