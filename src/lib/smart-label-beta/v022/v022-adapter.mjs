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
        nonMoveCategory = isParseFail ? "수식 파싱 실패" : "매칭 불확실";
        nonMoveCode = isParseFail ? "parse-failure" : "uncertain-match";
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
    };

    labelDecisions.push(decisionObj);
    decisionsByNodeId.set(n.id, decisionObj);
  }

  return { labelDecisions, decisionsByNodeId };
}

/**
 * v0.2.2-beta 전용 라벨 배치 및(옵션 시) 축 연장 / Unit 3-B 눈금 겹침 보정 / Unit 3-D-Origin 원점 배치 계획 실행기
 */
export function runPlanningV022(
  scene,
  P = PARAMS,
  applyAxisRequested = false,
  flags = DEFAULT_UNIT2_FLAGS,
  enableUnit3B = false
) {
  const plan0 = planLabelsUnit2(scene, P, null, flags);
  let activePlan = plan0;
  let axisPlan = planAxes(scene, plan0, P);
  let axisEditsToApply = [];

  if (applyAxisRequested) {
    let iters = 1;
    const sig = (p) =>
      JSON.stringify((p.placements || []).map((q) => [q.id, q.action, q.end, q.side, q.alpha]));
    while (iters < 3 && axisPlan.x && axisPlan.y) {
      const { xU, yU } = scene.units;
      const override = {
        left: Math.min(...axisPlan.x.new) * xU,
        right: Math.max(...axisPlan.x.new) * xU,
        bottom: Math.min(...axisPlan.y.new) * yU,
        top: Math.max(...axisPlan.y.new) * yU,
      };
      const next = planLabelsUnit2(scene, P, override, flags);
      iters++;
      const same = sig(next) === sig(activePlan);
      activePlan = next;
      axisPlan = planAxes(scene, activePlan, P);
      if (same) break;
    }
    axisEditsToApply = axisEdits(scene, axisPlan);
  }

  const activeShift = shiftEdits(scene, activePlan, P);
  const { labelDecisions, decisionsByNodeId } = buildV022LabelDecisions(
    scene,
    activePlan,
    activeShift
  );

  // Unit 3-B (Step 1: 좌표축 눈금 숫자 겹침 자동 해결) 독립 단계 실행
  const tickPlan = enableUnit3B
    ? planAxisTickOverlapsUnit3B(scene, activePlan, activeShift, axisEditsToApply)
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

  // Unit 3-D-Origin (표준 원점 O 노드 4방향 자동 배치 규칙) 독립 단계 실행
  const originPlan = planOriginNodeUnit3D(
    scene,
    activePlan,
    activeShift,
    axisEditsToApply,
    tickPlan
  );

  for (const [oid, odec] of originPlan.decisionsByNodeId.entries()) {
    decisionsByNodeId.set(oid, odec);
  }

  activePlan.labelDecisions = labelDecisions;
  activePlan.decisionsByNodeId = decisionsByNodeId;
  activePlan.tickPlan = tickPlan;
  activePlan.originPlan = originPlan;

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
    activeShift,
    tickPlan,
    originPlan,
    labelDecisions,
    decisionsByNodeId,
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
  const safetyPassed = cmpU1.safetyPassed && cmpU3A.safetyPassed;
  const measurementComplete = cmpU3A.measurementComplete && cmpU1.measurementComplete;
  const hasUnresolvedCollisions =
    enrichedPreExisting.length > 0 || enrichedNewlyIntroduced.length > 0;
  const allCollisionsResolved =
    safetyPassed && measurementComplete && !hasUnresolvedCollisions;

  return {
    engineVersion: "v0.2.2-beta",
    safetyPassed,
    measurementComplete,
    allClear: allCollisionsResolved,
    allCollisionsResolved,
    hasUnresolvedCollisions,
    movedNodeHasCollision: Boolean(cmpU1.movedNodeHasCollision || !cmpU3A.safetyPassed),
    counts: {
      origTotal: cmpU3A.counts.origTotal,
      finalTotal: cmpU3A.counts.finalTotal,
      resolved: cmpU3A.counts.resolved,
      preExistingUnresolved: enrichedPreExisting.length,
      newlyIntroduced: enrichedNewlyIntroduced.length,
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
    newlyIntroducedCollisions: enrichedNewlyIntroduced,
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
 *  - Unit 3-D-Origin 의 origin-anchor 편집(원점 O 옵션 내 4방향 앵커 토큰만 변경)을 추가로 허용·검증한다.
 */
export function checkPreservationV022(orig, rec, edits = []) {
  const originEdits = (edits || []).filter((e) => e && e.kind === "origin-anchor");
  if (originEdits.length === 0) {
    return checkPreservation(orig, rec, edits);
  }

  const sortedAll = [...edits].sort((a, b) => a.start - b.start);
  const originIssues = [];

  for (let i = 1; i < sortedAll.length; i++) {
    if (sortedAll[i].start < sortedAll[i - 1].end) {
      originIssues.push("편집 범위 겹침 발생");
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
      originIssues.push(`원점 O 옵션이 4방향 앵커 외에도 변경됨: ${before} → ${after}`);
    }
  }

  const sortedOrigin = [...originEdits].sort((a, b) => a.start - b.start);
  const origWithOriginApplied = applyEdits(orig, sortedOrigin);

  const nonOriginEditsMapped = (edits || [])
    .filter((e) => e && e.kind !== "origin-anchor")
    .map((e) => {
      let delta = 0;
      for (const oe of sortedOrigin) {
        if (oe.end <= e.start) {
          delta += oe.replacement.length - (oe.end - oe.start);
        }
      }
      return {
        ...e,
        start: e.start + delta,
        end: e.end + delta,
      };
    });

  const basePres = checkPreservation(origWithOriginApplied, rec, nonOriginEditsMapped);
  const allIssues = [...originIssues, ...(basePres.issues || [])];

  return {
    ok: allIssues.length === 0,
    issues: allIssues,
    editCount: edits.length,
    checks: {
      ...(basePres.checks || {}),
      allowedEditSyntaxOnly:
        Boolean(basePres.checks?.allowedEditSyntaxOnly) && originIssues.length === 0,
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
