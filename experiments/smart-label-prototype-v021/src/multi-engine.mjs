// 멀티 엔진 후보 비교 및 라벨별 하이브리드 선택 계층 (v0.2.1)
// 비교 대상 후보:
//  - 후보 A (original): 원래 위치
//  - 후보 B (v0.1): v0.1 엔진 추천 위치
//  - 후보 C (v0.2): v0.2 엔진 추천 위치
//  - 후보 D (v0.2.1): v0.2.1 신규 후보 위치 (구조적 수식 매칭 + 자기곡선 끝점 여유 탐색)
//
// 핵심 원칙:
//  1) 각 엔진의 후보를 공통 좌표계(TeX pt, 노드 scale 및 정수 shift 반올림 반영)로 변환하여 평가한다.
//  2) 안전 조건/방향 조건/여백 조건을 위반한 후보는 먼저 탈락(filter out)시킨다.
//  3) 통과한 후보들만 8대 품질 기준으로 채점하여 라벨별로 가장 적절한 후보를 하이브리드 선택한다.
//  4) 라벨별 선택 후 전체 장면(scene) 기준으로 라벨 간 상호 간격을 재검증하여 조합 충돌을 방지한다.

import { planLabels as planLabelsV01 } from "../../smart-label-prototype/src/algorithm.mjs";
import { planLabels as planLabelsV02 } from "../../smart-label-prototype-v02/src/algorithm.mjs";
import {
  PARAMS,
  assignStrokes,
  classifyStrokeKind,
  endInfo,
  selectPreferredEnd,
  describePlacementAtEnd,
  allowedSidesForTangent,
  evaluateKeep,
  computeShiftForMove,
  bboxFromShift,
  bboxGapRect,
  bboxPtDist,
  clearanceToStroke,
  planLabelsV021Single,
} from "./algorithm.mjs";

const r2 = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : n);
const centerOf = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
const distPt = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const normShift = (sh) => [sh && sh[0] !== null && sh[0] !== undefined ? Number(sh[0]) : 0, sh && sh[1] !== null && sh[1] !== undefined ? Number(sh[1]) : 0];
const sameShift = (a, b) => {
  const na = normShift(a), nb = normShift(b);
  return na[0] === nb[0] && na[1] === nb[1];
};

/**
 * 플랜의 단일 라벨 배치(placement)로부터 정수 반올림된 shift [x, y] 추출
 */
function extractShiftFromPlacement(node, pl, P = PARAMS) {
  const origShift = [node.xshift, node.yshift];
  if (!pl || pl.action !== "move" || !pl.bbox) {
    return origShift;
  }
  const sh = computeShiftForMove(node, pl.bbox, P);
  return sh.newShift;
}

/**
 * 공통 좌표계(TeX pt)에서 단일 후보 bbox 의 8대 품질 지표, 안전 필터 통과 여부, 점수를 계산한다.
 */
export function evaluateCandidateInCommonFrame({
  engineName,
  node,
  shift,
  bbox,
  assignment,
  stroke,
  strokeKind,
  ends,
  preferredEnd,
  otherStrokes,
  obstacleBoxes,
  contentBox,
  P = PARAMS,
}) {
  const origCenter = centerOf(node.bbox);
  const candCenter = centerOf(bbox);
  const movedPt = r2(distPt(origCenter, candCenter));
  const isMoved = movedPt > 0.5;

  if (!stroke || !ends) {
    return {
      engine: engineName,
      shift,
      bbox,
      movedPt,
      isMoved,
      passedFilter: !isMoved,
      filterReasons: isMoved ? ["대응 곡선 없음"] : [],
      score: !isMoved ? 50 : 0,
      cost: !isMoved ? 50 : 999,
      metrics: null,
    };
  }

  const d0 = bboxPtDist(ends[0].point, bbox);
  const d1 = bboxPtDist(ends[1].point, bbox);
  const end = d0 <= d1 ? 0 : 1;
  const desc = describePlacementAtEnd(bbox, ends[end]);
  const allowedSides = allowedSidesForTangent(ends[end].t, strokeKind, P);
  const directionOk = allowedSides.includes(desc.side);
  const useBeta = (desc.side === "right" || desc.side === "left") && directionOk;
  const alignVal = useBeta ? Math.abs(desc.beta) : Math.abs(desc.alpha);

  let minOtherClearancePt = Infinity;
  for (const q of otherStrokes) {
    const c = clearanceToStroke(bbox, q);
    if (c < minOtherClearancePt) minOtherClearancePt = c;
  }
  const ownClearancePt = clearanceToStroke(bbox, stroke);

  let minLabelGapPt = Infinity;
  for (const ob of obstacleBoxes) {
    minLabelGapPt = Math.min(minLabelGapPt, bboxGapRect(bbox, ob));
  }

  const ownEndpointContact = desc.endGapPt <= 4.0 && ownClearancePt >= -1.0 && ownClearancePt <= 1.5;

  // 1단계: 안전 및 방향/정렬/확실성 하드 필터
  const filterReasons = [];
  const confirmed = !!(assignment && assignment.confirmed);

  // (a) 수식-곡선 대응 확실성 검사: 미확정(ambiguous-structural, nearest-unclaimed)인데 이동하려는 후보는 탈락
  if (!confirmed && isMoved && !P.allowUncertainMove) {
    filterReasons.push(`대응 곡선 미확정(${assignment ? assignment.how : "unknown"}) 상태에서 자동 이동 불가`);
  }

  // (b) 다른 곡선/축/도형과의 충돌 검사 (정수 shift 반올림 오차 0.6pt 허용)
  const hardOtherMin = isMoved ? P.cHard - 0.6 : P.cHard;
  if (minOtherClearancePt < hardOtherMin) {
    filterReasons.push(`다른 곡선/축 여백 부족(${r2(minOtherClearancePt)}pt < ${P.cHard}pt)`);
  }

  // (c) 자기 곡선 침범 검사
  const hardOwnMin = isMoved ? P.cOwn - 0.4 : P.cOwn;
  if (ownClearancePt < hardOwnMin) {
    filterReasons.push(`자기 곡선 침범(${r2(ownClearancePt)}pt < ${P.cOwn}pt)`);
  }

  // (d) 라벨 간 충돌 검사
  const hardLabelMin = isMoved ? P.mLabel - 0.6 : P.mLabel;
  if (minLabelGapPt < hardLabelMin) {
    filterReasons.push(`다른 라벨과의 간격 부족(${r2(minLabelGapPt)}pt < ${P.mLabel}pt)`);
  }

  // (e) 확정된 곡선에 대해 끝점 거리, 접선 방향, 중심 정렬 검사
  if (confirmed) {
    const maxGap = engineName === "original" ? P.keepMaxEndGap : P.maxAllowedEndGap;
    if (desc.endGapPt > maxGap) {
      filterReasons.push(`곡선 끝점 거리 초과(${r2(desc.endGapPt)}pt > ${maxGap}pt)`);
    }
    if (!directionOk) {
      filterReasons.push(`곡선 접선 진행 방향 불일치(배치=${desc.side}, 허용=${allowedSides.join("/")}, t=[${r2(ends[end].t[0])}, ${r2(ends[end].t[1])}])`);
    }
    const maxAlign = engineName === "original" ? P.keepMaxAlpha : P.maxAllowedAlpha;
    if (alignVal > maxAlign) {
      filterReasons.push(`끝점 중심 정렬 편차 초과(|align|=${r2(alignVal)} > ${maxAlign})`);
    }
  }

  const passedFilter = filterReasons.length === 0;

  // 2단계: 8대 기준 종합 품질 점수 계산 (100점 만점 기준, 높을수록 우수)
  const baseC = contentBox || bbox;
  const grow =
    Math.max(baseC.x1, bbox.x1) - Math.min(baseC.x0, bbox.x0) - (baseC.x1 - baseC.x0) +
    (Math.max(baseC.y1, bbox.y1) - Math.min(baseC.y0, bbox.y0) - (baseC.y1 - baseC.y0));

  const effMinClear = Math.min(minOtherClearancePt, minLabelGapPt);
  const clearPen = Math.max(0, P.cPref - effMinClear) / P.cPref;
  const ownPref = P.cOwnPref || 1.6;
  const ownPen = ownClearancePt < ownPref ? (ownPref - ownClearancePt) / ownPref : 0;
  const idealGap = desc.side === "above" ? P.gapAbove : desc.side === "below" ? P.gapBelow : P.gapSide;
  const gapDevPen = Math.max(0, Math.abs(desc.endGapPt - idealGap) - 0.6) * 0.65;
  const endMismatchPen = end !== preferredEnd ? P.wEnd : 0;
  const dirMismatchPen = directionOk ? 0 : P.wSide * 2;
  const alignPen = P.wAlpha * alignVal;
  const growPen = P.wGrow * (grow / 100);
  // 원래 위치가 이미 모든 안전·방향·정렬 조건을 통과한 경우 불필요한 이동 방지 보너스 부여
  const movePen = isMoved ? Math.min(1.2, movedPt / 250) : 0;

  const cost =
    P.wClear * clearPen * clearPen +
    (P.wOwnPref || 3.5) * ownPen * ownPen +
    endMismatchPen +
    dirMismatchPen +
    alignPen +
    gapDevPen +
    growPen +
    movePen;

  const score = r2(Math.max(0, 100 - cost * 3.2));

  return {
    engine: engineName,
    shift: normShift(shift),
    bbox: { x0: r2(bbox.x0), y0: r2(bbox.y0), x1: r2(bbox.x1), y1: r2(bbox.y1) },
    rawBbox: bbox,
    movedPt,
    isMoved,
    passedFilter,
    filterReasons,
    score,
    cost: r2(cost),
    metrics: {
      end,
      preferredEnd,
      side: desc.side,
      allowedSides,
      directionOk,
      alpha: r2(desc.alpha),
      beta: r2(desc.beta),
      alignVal: r2(alignVal),
      endGapPt: r2(desc.endGapPt),
      ownClearancePt: r2(ownClearancePt),
      ownEndpointContact,
      minOtherClearancePt: Number.isFinite(minOtherClearancePt) ? r2(minOtherClearancePt) : null,
      minLabelGapPt: Number.isFinite(minLabelGapPt) ? r2(minLabelGapPt) : null,
      assignmentConfirmed: confirmed,
      assignmentMethod: assignment ? assignment.how : "unknown",
    },
  };
}

/**
 * 장면(scene)에 대해 v0.1, v0.2, v0.2.1 후보를 모두 생성·비교하고
 * 요청된 모드("auto" | "v0.1" | "v0.2" | "v0.2.1")에 따라 최적 배치를 선택한다.
 */
export function planLabelsMultiEngine(scene, P = PARAMS, axisPt = null, mode = "auto") {
  const targets = scene.nodes.filter((n) => n.role === "function" && n.bbox);
  const fixed = scene.nodes.filter((n) => n.bbox && n.role !== "function" && n.role !== "marker");
  const assigned = assignStrokes(scene, targets);

  // 1) 세 엔진(v0.1, v0.2, v0.2.1) 각각의 단일 플랜 실행 (공통 scene 및 axisPt 기준)
  const planV01 = planLabelsV01(scene, undefined, axisPt);
  const planV02 = planLabelsV02(scene, undefined, axisPt);
  const planV021 = planLabelsV021Single(scene, P, axisPt);

  const v01ById = new Map((planV01.placements || []).map((p) => [p.id, p]));
  const v02ById = new Map((planV02.placements || []).map((p) => [p.id, p]));
  const v021ById = new Map((planV021.placements || []).map((p) => [p.id, p]));

  const strokesEff = scene.strokes.map((s) => {
    if (s.kind !== "axis" || !axisPt) return s;
    const horizontal = Math.abs(s.pts[0][1] - s.pts[s.pts.length - 1][1]) < 1e-6;
    return { ...s, pts: horizontal ? [[axisPt.left, s.pts[0][1]], [axisPt.right, s.pts[0][1]]] : [[s.pts[0][0], axisPt.bottom], [s.pts[0][0], axisPt.top]] };
  });

  let content = null;
  const addC = (b) => { content = content ? { x0: Math.min(content.x0, b.x0), y0: Math.min(content.y0, b.y0), x1: Math.max(content.x1, b.x1), y1: Math.max(content.y1, b.y1) } : { ...b }; };
  for (const s of scene.strokes) if (s.kind !== "axis") for (const p of s.pts) addC({ x0: p[0], y0: p[1], x1: p[0], y1: p[1] });
  for (const n of fixed) if (n.role !== "axisLabel" && n.role !== "origin") addC(n.bbox);

  const plan = {
    mode,
    placements: [],
    skipped: [],
    advisory: [],
    labelDecisions: [],
    engineSummary: {
      totalFunctionLabels: targets.length,
      autoModifiedCount: 0,
      heldOriginalCount: 0,
      selectedByEngine: { original: 0, "v0.1": 0, "v0.2": 0, "v0.2.1": 0 },
      confirmedByMethod: {
        inline: 0,
        "expr-match": 0,
        "numeric-equivalent-match": 0,
        "structural-match": 0,
        "ambiguous-numeric-match": 0,
        "ambiguous-structural": 0,
        "nearest-unclaimed": 0,
        "parse-failure": 0,
        unmatched: 0,
      },
      nonMoveByCategory: {
        "수식 파싱 실패": 0,
        "매칭 불확실": 0,
        "기존 위치 유지": 0,
        "후보 없음": 0,
        "안전성 검증 실패": 0,
      },
    },
    notes: [],
  };

  const placedBoxes = [];
  const perLabelSurvivingPools = [];

  for (const n of targets) {
    const a = assigned.get(n.id) || { how: "unmatched", stroke: null, strokeKind: "unknown", confirmed: false, uncertain: true, nonMoveCategory: "매칭 불확실", nonMoveCode: "uncertain-match", reason: "대응 곡선 없음" };
    plan.engineSummary.confirmedByMethod[a.how] = (plan.engineSummary.confirmedByMethod[a.how] || 0) + 1;

    if (!n.usable || !n.scale || !a.stroke) {
      const isParseFail = a.how === "parse-failure" || a.nonMoveCategory === "수식 파싱 실패";
      const nonMoveCategory = isParseFail ? "수식 파싱 실패" : "매칭 불확실";
      const nonMoveCode = isParseFail ? "parse-failure" : "uncertain-match";
      const holdReason = !n.usable
        ? `노드 매칭 미확정(${n.confidence})`
        : !n.scale
        ? "노드 배율(scale) 불명"
        : a.reason || "대응 곡선/선을 찾지 못함";
      plan.skipped.push({ id: n.id, label: n.label, category: nonMoveCode, nonMoveCategory, how: a.how, reason: holdReason });
      plan.placements.push({
        id: n.id,
        label: n.label,
        action: "keep",
        selectedEngine: "original",
        reason: holdReason,
        holdReason,
        nonMoveCategory,
        nonMoveCode,
        stroke: a.stroke ? a.stroke.index : null,
        strokeKind: a.strokeKind || "unknown",
        how: a.how,
        confirmedAssignment: false,
        uncertainAssignment: true,
        bbox: n.bbox,
        from: n.bbox,
      });
      plan.labelDecisions.push({
        id: n.id,
        label: n.label,
        matchedStroke: a.stroke ? a.stroke.index : null,
        strokeExpr: a.stroke && a.stroke.stmt && a.stroke.stmt.expr ? a.stroke.stmt.expr : null,
        strokeKind: a.strokeKind || "unknown",
        assignmentMethod: a.how,
        assignmentConfirmed: false,
        assignmentCertainty: isParseFail ? "parse-failure" : "unmatched",
        assignmentReason: holdReason,
        normalizedExpr: a.normalizedExpr || null,
        parseError: a.parseError || null,
        candidates: {},
        selectedEngine: "original",
        agreedEngines: ["original"],
        selectedPosition: { shift: normShift([n.xshift, n.yshift]), bbox: n.bbox },
        movement: { oldShift: [n.xshift, n.yshift], newShift: normShift([n.xshift, n.yshift]), deltaShiftPt: [0, 0], movedDistancePt: 0 },
        selectionReason: holdReason,
        autoModified: false,
        nonMoveCategory,
        nonMoveCode,
        holdReason,
      });
      plan.engineSummary.heldOriginalCount++;
      plan.engineSummary.selectedByEngine.original++;
      plan.engineSummary.nonMoveByCategory[nonMoveCategory] = (plan.engineSummary.nonMoveByCategory[nonMoveCategory] || 0) + 1;
      placedBoxes.push(n.bbox);
      addC(n.bbox);
      continue;
    }

    const s = a.stroke;
    const strokeKind = a.strokeKind || classifyStrokeKind(s);
    const others = strokesEff.filter((q) => q.index !== s.index);
    const obsBoxes = [...fixed.map((q) => q.bbox), ...placedBoxes];
    const ends = [endInfo(s, 0), endInfo(s, 1)];
    const anchor0 = n.at || n.inlineAnchor || n.anchor || centerOf(n.bbox);
    const preferredEnd = selectPreferredEnd(strokeKind, ends, anchor0);

    // 4개 후보(A: original, B: v0.1, C: v0.2, D: v0.2.1)의 shift 와 공통 좌표계 bbox 추출
    const shiftOrig = [n.xshift, n.yshift];
    const pl01 = v01ById.get(n.id);
    const pl02 = v02ById.get(n.id);
    const pl021 = v021ById.get(n.id);

    const shiftV01 = extractShiftFromPlacement(n, pl01, P);
    const shiftV02 = extractShiftFromPlacement(n, pl02, P);
    const shiftV021 = extractShiftFromPlacement(n, pl021, P);

    const bboxOrig = n.bbox;
    const bboxV01 = bboxFromShift(n, shiftV01);
    const bboxV02 = bboxFromShift(n, shiftV02);
    const bboxV021 = bboxFromShift(n, shiftV021);

    const commonArgs = {
      node: n,
      assignment: a,
      stroke: s,
      strokeKind,
      ends,
      preferredEnd,
      otherStrokes: others,
      obstacleBoxes: obsBoxes,
      contentBox: content,
      P,
    };

    const candOrig = evaluateCandidateInCommonFrame({ ...commonArgs, engineName: "original", shift: shiftOrig, bbox: bboxOrig });
    const candV01 = evaluateCandidateInCommonFrame({ ...commonArgs, engineName: "v0.1", shift: shiftV01, bbox: bboxV01 });
    const candV02 = evaluateCandidateInCommonFrame({ ...commonArgs, engineName: "v0.2", shift: shiftV02, bbox: bboxV02 });
    const candV021 = evaluateCandidateInCommonFrame({ ...commonArgs, engineName: "v0.2.1", shift: shiftV021, bbox: bboxV021 });

    if (pl02 && pl02.advisory) {
      candV02.advisoryShift = pl02.advisory.shift;
    }

    // 선호 끝점에 안전한 후보가 존재하는 경우, 비선호 끝점에 놓인 후보(예: 수직선 상단 유지 등)를 필터에서 탈락시킴
    const allFour = [candOrig, candV01, candV02, candV021];
    const anySafeAtPreferredEnd = allFour.some((c) => c.passedFilter && c.metrics && c.metrics.end === preferredEnd);
    if (anySafeAtPreferredEnd) {
      for (const c of allFour) {
        if (c.passedFilter && c.metrics && c.metrics.end !== preferredEnd) {
          c.passedFilter = false;
          c.filterReasons.push(`선호 끝점(${preferredEnd})에 안전한 후보가 존재하여 비선호 끝점(${c.metrics.end}) 후보 탈락`);
        }
      }
    }

    // 수식-곡선 대응이 불확실(parse-failure, ambiguous-numeric-match, ambiguous-structural, nearest-unclaimed)한 경우:
    // 자동 이동을 차단하고 original 위치를 유지한다.
    let chosen = candOrig;
    let selectionReason = "";
    let holdReason = null;
    let nonMoveCategory = null;
    let nonMoveCode = null;

    if (!a.confirmed && !P.allowUncertainMove && mode !== "v0.1") {
      chosen = candOrig;
      const isParseFail = a.how === "parse-failure" || a.nonMoveCategory === "수식 파싱 실패";
      nonMoveCategory = isParseFail ? "수식 파싱 실패" : "매칭 불확실";
      nonMoveCode = isParseFail ? "parse-failure" : "uncertain-match";
      holdReason = a.reason || `대응 곡선 미확정(${a.how})으로 자동 이동 차단`;
      selectionReason = `[${nonMoveCategory}] ${holdReason} (v0.1 이동 후보 [${candV01.shift.join(", ")}]pt 기각, 원본 유지)`;
      if (pl021 && pl021.advisory) {
        plan.advisory.push(pl021.advisory);
      }
      plan.skipped.push({
        id: n.id,
        label: n.label,
        category: nonMoveCode,
        nonMoveCategory,
        how: a.how,
        stroke: s.index,
        strokeKind,
        reason: holdReason,
        advisory: pl021 ? pl021.advisory : null,
      });
    } else if (mode === "v0.1") {
      chosen = candV01;
      selectionReason = `사용자 지정 모드(v0.1 추천): shift=[${candV01.shift.join(", ")}]pt`;
    } else if (mode === "v0.2") {
      chosen = candV02;
      selectionReason = `사용자 지정 모드(v0.2 추천): shift=[${candV02.shift.join(", ")}]pt`;
      if (sameShift(candV02.shift, shiftOrig) && pl02 && pl02.action === "hold-uncertain") {
        holdReason = pl02.reason;
        nonMoveCategory = "매칭 불확실";
        nonMoveCode = "uncertain-match";
      }
    } else if (mode === "v0.2.1") {
      chosen = candV021.passedFilter ? candV021 : candOrig;
      if (candV021.passedFilter) {
        selectionReason = `사용자 지정 모드(v0.2.1 추천): shift=[${candV021.shift.join(", ")}]pt (점수 ${candV021.score})`;
      } else {
        nonMoveCategory = "후보 없음";
        nonMoveCode = "no-safe-candidate";
        holdReason = `v0.2.1 후보가 안전 필터를 통과하지 못함 — 원본 유지`;
        selectionReason = `[${nonMoveCategory}] ${holdReason}`;
      }
    } else {
      // mode === "auto": 멀티 엔진 비교 및 하이브리드 선택
      const surviving = allFour.filter((c) => c.passedFilter);
      if (surviving.length === 0) {
        chosen = candOrig;
        nonMoveCategory = "후보 없음";
        nonMoveCode = "no-safe-candidate";
        holdReason = `모든 후보가 안전/방향 필터를 통과하지 못함 — 원본 유지(수동 확인 권장)`;
        selectionReason = `[${nonMoveCategory}] ${holdReason}`;
        plan.skipped.push({
          id: n.id,
          label: n.label,
          category: "no-safe-candidate",
          nonMoveCategory,
          how: a.how,
          stroke: s.index,
          strokeKind,
          reason: holdReason,
        });
      } else if (candOrig.passedFilter) {
        // 원래 위치가 이미 모든 안전·방향·정렬·끝점 근접 조건을 통과한 경우 불필요한 이동 금지
        chosen = candOrig;
        nonMoveCategory = "기존 위치 유지";
        nonMoveCode = "keep-original";
        holdReason = "원 위치가 이미 평가원 배치 기준(무충돌·접선 방향·중심 정렬·근접성)을 만족하여 불필요한 이동 생략";
        selectionReason = `[${nonMoveCategory}] ${holdReason}`;
      } else {
        // 통과한 후보들을 점수(score) 순으로 정렬하되,
        // 동일 좌표를 추천한 경우 또는 점수가 동점(0.15점 이내)인 경우 명확한 우선순위로 결정
        const sorted = [...surviving].sort((x, y) => y.score - x.score);
        chosen = sorted[0];

        // 거절된 엔진들의 탈락 사유 요약
        const rejectedDesc = allFour
          .filter((c) => !c.passedFilter && c.engine !== "original")
          .map((c) => `${c.engine} 탈락(${c.filterReasons[0]})`);

        const agreed = allFour.filter((c) => sameShift(c.shift, chosen.shift)).map((c) => c.engine);
        if (agreed.length > 1) {
          selectionReason = `${agreed.join("·")} 공통 추천 위치 채택(끝점 ${chosen.metrics.end}/${chosen.metrics.side}, 간격 ${chosen.metrics.endGapPt}pt, |α|=${chosen.metrics.alignVal}, 점수 ${chosen.score})` +
            (rejectedDesc.length ? ` · [${rejectedDesc.join("; ")}]` : "");
        } else {
          const runnerUp = sorted.find((c) => !sameShift(c.shift, chosen.shift));
          const cmpNote = runnerUp
            ? `차순위 ${runnerUp.engine}(점수 ${runnerUp.score}, 자기곡선여유 ${runnerUp.metrics.ownClearancePt}pt, |α|=${runnerUp.metrics.alignVal}) 대비 우위`
            : "유일한 안전 통과 후보";
          selectionReason = `${chosen.engine} 후보 단독 채택(끝점 ${chosen.metrics.end}/${chosen.metrics.side}, 간격 ${chosen.metrics.endGapPt}pt, 자기곡선여유 ${chosen.metrics.ownClearancePt}pt, |α|=${chosen.metrics.alignVal}, 점수 ${chosen.score}; ${cmpNote})` +
            (rejectedDesc.length ? ` · [${rejectedDesc.join("; ")}]` : "");
        }
      }
    }

    const agreedEngines = allFour.filter((c) => sameShift(c.shift, chosen.shift)).map((c) => c.engine);
    const willMove = !sameShift(chosen.shift, shiftOrig);
    if (!willMove) {
      if (!nonMoveCategory) {
        if (!a.confirmed) {
          const isParseFail = a.how === "parse-failure" || a.nonMoveCategory === "수식 파싱 실패";
          nonMoveCategory = isParseFail ? "수식 파싱 실패" : "매칭 불확실";
          nonMoveCode = isParseFail ? "parse-failure" : "uncertain-match";
        } else if (!allFour.some((c) => c.passedFilter)) {
          nonMoveCategory = "후보 없음";
          nonMoveCode = "no-safe-candidate";
        } else {
          nonMoveCategory = "기존 위치 유지";
          nonMoveCode = "keep-original";
        }
      }
      if (!holdReason) {
        holdReason = "선택된 최적 위치가 원본 위치와 동일하여 기존 위치 유지";
      }
    } else {
      nonMoveCategory = null;
      nonMoveCode = null;
    }

    const e0 = {
      minOther: candOrig.metrics ? candOrig.metrics.minOtherClearancePt : Infinity,
      own: candOrig.metrics ? candOrig.metrics.ownClearancePt : Infinity,
      labelGap: candOrig.metrics ? candOrig.metrics.minLabelGapPt : Infinity,
    };
    const keepCheck = evaluateKeep(n.bbox, strokeKind, ends, preferredEnd, e0, P);

    const placementObj = {
      id: n.id,
      label: n.label,
      action: willMove ? "move" : (!a.confirmed ? "hold-uncertain" : "keep"),
      selectedEngine: chosen.engine,
      agreedEngines,
      reason: selectionReason,
      holdReason: willMove ? null : holdReason,
      nonMoveCategory,
      nonMoveCode,
      stroke: s.index,
      strokeKind,
      how: a.how,
      confirmedAssignment: !!a.confirmed,
      uncertainAssignment: !!a.uncertain,
      assignmentReason: a.reason || null,
      end: chosen.metrics ? chosen.metrics.end : keepCheck.currentEnd,
      preferredEnd,
      side: chosen.metrics ? chosen.metrics.side : keepCheck.currentSide,
      alpha: chosen.metrics ? chosen.metrics.alpha : keepCheck.alpha,
      cost: chosen.cost,
      score: chosen.score,
      bbox: chosen.rawBbox,
      from: n.bbox,
      shift: chosen.shift,
      eval: {
        minOther: chosen.metrics ? chosen.metrics.minOtherClearancePt : null,
        own: chosen.metrics ? chosen.metrics.ownClearancePt : null,
        labelGap: chosen.metrics ? chosen.metrics.minLabelGapPt : null,
      },
      keepCheck,
      advisory: !a.confirmed && pl021 ? pl021.advisory : null,
    };

    plan.placements.push(placementObj);
    placedBoxes.push(chosen.rawBbox);
    addC(chosen.rawBbox);

    perLabelSurvivingPools.push({
      node: n,
      placementIndex: plan.placements.length - 1,
      decisionIndex: plan.labelDecisions.length,
      chosen,
      surviving: allFour.filter((c) => c.passedFilter),
      allFour,
    });

    const sx = n.scale ? n.scale[0] : 1;
    const sy = n.scale ? n.scale[1] : 1;
    const oldNorm = normShift(shiftOrig);
    const deltaShiftPt = [chosen.shift[0] - oldNorm[0], chosen.shift[1] - oldNorm[1]];
    const movedDistancePt = r2(Math.hypot(deltaShiftPt[0] * sx, deltaShiftPt[1] * sy));

    const serializeCand = (c) => ({
      engine: c.engine,
      shift: c.shift,
      advisoryShift: c.advisoryShift || undefined,
      bbox: c.bbox,
      movedPt: c.movedPt,
      passedFilter: c.passedFilter,
      filterReasons: c.filterReasons,
      score: c.score,
      cost: c.cost,
      metrics: c.metrics,
    });

    plan.labelDecisions.push({
      id: n.id,
      label: n.label,
      matchedStroke: s.index,
      strokeExpr: s.stmt && s.stmt.expr ? s.stmt.expr : null,
      strokeKind,
      assignmentMethod: a.how,
      assignmentConfirmed: !!a.confirmed,
      assignmentCertainty: a.confirmed
        ? "confirmed"
        : a.how === "parse-failure"
        ? "parse-failure"
        : a.how === "ambiguous-structural" || a.how === "ambiguous-numeric-match"
        ? "ambiguous"
        : "uncertain",
      assignmentReason: a.reason || null,
      normalizedExpr: a.normalizedExpr || null,
      parseError: a.parseError || null,
      candidates: {
        original: serializeCand(candOrig),
        "v0.1": serializeCand(candV01),
        "v0.2": serializeCand(candV02),
        "v0.2.1": serializeCand(candV021),
      },
      selectedEngine: chosen.engine,
      agreedEngines,
      selectedPosition: {
        shift: chosen.shift,
        bbox: chosen.bbox,
        end: chosen.metrics ? chosen.metrics.end : null,
        side: chosen.metrics ? chosen.metrics.side : null,
        alpha: chosen.metrics ? chosen.metrics.alpha : null,
        endGapPt: chosen.metrics ? chosen.metrics.endGapPt : null,
        ownClearancePt: chosen.metrics ? chosen.metrics.ownClearancePt : null,
        minOtherClearancePt: chosen.metrics ? chosen.metrics.minOtherClearancePt : null,
        minLabelGapPt: chosen.metrics ? chosen.metrics.minLabelGapPt : null,
      },
      movement: {
        oldShift: shiftOrig,
        newShift: chosen.shift,
        deltaShiftPt,
        movedDistancePt,
      },
      selectionReason,
      autoModified: willMove,
      nonMoveCategory,
      nonMoveCode,
      holdReason: willMove ? null : holdReason,
    });

    if (willMove) plan.engineSummary.autoModifiedCount++;
    else {
      plan.engineSummary.heldOriginalCount++;
      if (nonMoveCategory) {
        plan.engineSummary.nonMoveByCategory[nonMoveCategory] = (plan.engineSummary.nonMoveByCategory[nonMoveCategory] || 0) + 1;
      }
    }
    plan.engineSummary.selectedByEngine[chosen.engine] = (plan.engineSummary.selectedByEngine[chosen.engine] || 0) + 1;
  }

  // 3) 전체 장면(Whole-Scene) 조합 재검증:
  // 라벨별로 하이브리드 선택된 후보들이 서로 겹치거나 최소 간격(mLabel)을 위반하는지 검사하고,
  // 위반 시 각 라벨의 통과 후보 조합 중 충돌 없는 최고 점수 조합으로 교체한다.
  if (mode === "auto" && perLabelSurvivingPools.length >= 2) {
    let hasPairConflict = false;
    for (let i = 0; i < perLabelSurvivingPools.length; i++) {
      for (let j = i + 1; j < perLabelSurvivingPools.length; j++) {
        const bi = perLabelSurvivingPools[i].chosen.rawBbox;
        const bj = perLabelSurvivingPools[j].chosen.rawBbox;
        if (bboxGapRect(bi, bj) < P.mLabel - 0.6) {
          hasPairConflict = true;
        }
      }
    }
    if (hasPairConflict) {
      // 카테시안 곱 탐색으로 무충돌 최대 점수 조합 탐색
      const pools = perLabelSurvivingPools.map((item) => (item.surviving.length ? item.surviving : [item.chosen]));
      let bestCombo = null;
      let bestComboScore = -Infinity;
      const searchCombo = (idx, acc) => {
        if (idx === pools.length) {
          for (let i = 0; i < acc.length; i++) {
            for (let j = i + 1; j < acc.length; j++) {
              if (bboxGapRect(acc[i].rawBbox, acc[j].rawBbox) < P.mLabel - 0.6) return;
            }
          }
          const sum = acc.reduce((s, c) => s + c.score, 0);
          if (sum > bestComboScore) {
            bestComboScore = sum;
            bestCombo = [...acc];
          }
          return;
        }
        for (const c of pools[idx]) {
          acc.push(c);
          searchCombo(idx + 1, acc);
          acc.pop();
        }
      };
      searchCombo(0, []);
      if (bestCombo) {
        bestCombo.forEach((c, idx) => {
          const item = perLabelSurvivingPools[idx];
          if (c.engine !== item.chosen.engine) {
            const pl = plan.placements[item.placementIndex];
            const dec = plan.labelDecisions[item.decisionIndex];
            const shiftOrig = [item.node.xshift, item.node.yshift];
            const willMove = !sameShift(c.shift, shiftOrig);
            pl.selectedEngine = c.engine;
            pl.bbox = c.rawBbox;
            pl.shift = c.shift;
            pl.action = willMove ? "move" : "keep";
            pl.reason += ` [전체 장면 라벨 간 충돌 해소를 위해 ${c.engine} 후보로 조합 조정됨]`;
            dec.selectedEngine = c.engine;
            dec.selectedPosition.shift = c.shift;
            dec.selectedPosition.bbox = c.bbox;
            dec.selectionReason = pl.reason;
            dec.autoModified = willMove;
          }
        });
        plan.notes.push("전체 장면 재검증 단계에서 라벨 간 상호 충돌을 해소하기 위해 후보 조합이 조정됨");
      }
    }
  }

  plan.assignments = planV021.assignments;
  return plan;
}
