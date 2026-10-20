// KO-SMART 스마트 라벨 베타 — 겹침·충돌 정밀 진단 및 전후 비교 모듈
// 원칙:
//  1) 기존 v0.2.1 엔진 원본(experiments/smart-label-prototype-v021/src/*)은 단 1줄도 수정하지 않는다.
//  2) 원본부터 존재하던 겹침(preExistingUnresolved)과 자동 이동/축 조정으로 새로 발생한 겹침(newlyIntroduced)을 엄격히 구분한다.
//  3) 이동하지 않은 함수식 라벨(no-safe-candidate, uncertain-match 등)의 기존 충돌과
//     일반 노드(role !== "function": x, y, O, 점 라벨 A/B, 눈금 숫자 등)의 충돌을 모두 진단한다.
//  4) 일반 노드는 자동 이동하지 않으며(진단 및 충돌 방어 대상으로만 활용),
//     SVG 측정 누락(unmeasured/unverifiable) 노드가 있으면 이를 명시하여 "모든 겹침 해결"로 오인되지 않게 한다.

import { PARAMS, assignStrokes, bboxGapRect, clearanceToStroke } from "../../../experiments/smart-label-prototype-v021/src/algorithm.mjs";

const r2 = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

/**
 * 노드 역할을 한국어 설명으로 변환
 * @param {string} role
 */
function describeNodeRole(role) {
  switch (role) {
    case "function":
      return "함수식 라벨";
    case "axisLabel":
      return "축 이름(x/y)";
    case "origin":
      return "원점(O)";
    case "vertex":
      return "점/꼭짓점 라벨";
    case "other":
      return "일반 노드(눈금/텍스트)";
    default:
      return "노드";
  }
}

/**
 * 선(stroke) 종류를 한국어 설명으로 변환
 * @param {any} stroke
 */
function describeStroke(stroke) {
  if (!stroke) return "선/곡선";
  if (stroke.kind === "axis") return "좌표축";
  if (stroke.kind === "curve") return "함수 곡선";
  if (stroke.kind === "dashed") return "점선/보조선";
  if (stroke.kind === "line") return "직선/선분";
  return "선/곡선";
}

/**
 * 단일 장면(scene)의 모든 노드(함수식 라벨 + 일반 노드) 및 측정 누락 상태를 정밀 감사(audit)한다.
 * @param {any} scene buildScene 반환 객체
 * @param {typeof PARAMS} [P]
 */
export function auditSceneCollisions(scene, P = PARAMS) {
  if (!scene || scene.ok === false) {
    return {
      ok: false,
      measurementComplete: false,
      unmeasuredNodes: [],
      unverifiableItems: [],
      functionLabelAudits: [],
      generalNodeAudits: [],
      allCollisions: [],
    };
  }

  const nonMarkerNodes = (scene.nodes || []).filter((n) => n.role !== "marker");
  const measuredNodes = nonMarkerNodes.filter((n) => n.bbox);
  const fNodes = measuredNodes.filter((n) => n.role === "function");
  const generalNodes = measuredNodes.filter((n) => n.role !== "function");

  // 1) SVG 측정 누락 / 매칭 불확실 노드 수집
  const unmeasuredNodes = nonMarkerNodes
    .filter((n) => !n.bbox || n.confidence === "unsupported" || n.usable === false)
    .map((n) => ({
      id: n.id,
      label: n.label || n.raw || n.id,
      role: n.role,
      roleLabel: describeNodeRole(n.role),
      hasBBox: Boolean(n.bbox),
      confidence: n.confidence || "unsupported",
      usable: Boolean(n.usable),
      reasons:
        Array.isArray(n.reasons) && n.reasons.length > 0
          ? n.reasons
          : [!n.bbox ? "SVG 글리프 바운딩 박스 측정 누락" : "노드-SVG 매칭 미확정"],
    }));

  const rawCollisionReport = Array.isArray(scene.analysis?.collisions)
    ? { results: scene.analysis.collisions, skippedLabels: [] }
    : scene.analysis?.collisions || { results: [], skippedLabels: [] };
  const unverifiableItems = (rawCollisionReport.results || [])
    .filter((r) => r.verdict === "unverifiable" || r.relation === "unverifiable")
    .map((r) => ({
      relation: r.relation,
      aId: r.a?.sourceId || r.aId || null,
      aChars: r.a?.chars || r.aChars || "",
      bDesc: r.b?.sourceId || r.b?.kind || r.bDesc || "",
      note: r.note || "글리프 외곽선 미확인으로 정밀 충돌 판정 불가",
    }));

  const measurementComplete = unmeasuredNodes.length === 0 && unverifiableItems.length === 0;

  // svgIndex -> scene node 매핑
  const nodeBySvgIndex = new Map();
  for (const n of measuredNodes) {
    if (n.svgIndex !== null && n.svgIndex !== undefined) {
      nodeBySvgIndex.set(n.svgIndex, n);
    }
  }

  // 2) 함수식 라벨(role === "function") 전체(이동·미이동 불문) 충돌 감사
  const assigned = assignStrokes(scene, fNodes);
  const functionLabelAudits = [];
  const allCollisions = [];
  const recordedPairKeys = new Set();

  for (let idx = 0; idx < fNodes.length; idx++) {
    const n = fNodes[idx];
    const a = assigned.get(n.id);
    const matchedStroke = a && a.stroke ? a.stroke : null;
    const confirmedMatch = Boolean(a && a.confirmed);

    // (2-a) 자기 곡선 거리
    const ownClearancePt = matchedStroke ? r2(clearanceToStroke(n.bbox, matchedStroke)) : null;

    // (2-b) 다른 모든 곡선·직선·축과의 최소 거리 및 대상 식별
    const otherStrokes = matchedStroke
      ? (scene.strokes || []).filter((q) => q.index !== matchedStroke.index)
      : scene.strokes || [];

    let minOtherClearancePt = Infinity;
    let closestOtherStroke = null;
    for (const st of otherStrokes) {
      const c = clearanceToStroke(n.bbox, st);
      if (c < minOtherClearancePt) {
        minOtherClearancePt = c;
        closestOtherStroke = {
          index: st.index,
          kind: st.kind,
          kindLabel: describeStroke(st),
          clearancePt: r2(c),
        };
      }
    }
    minOtherClearancePt = Number.isFinite(minOtherClearancePt) ? r2(minOtherClearancePt) : null;

    // (2-c) 다른 모든 측정 노드(함수식 + 일반 노드 x, y, O, A, 눈금 등)와의 최소 간격 및 대상 식별
    let minLabelGapPt = Infinity;
    let closestOtherNode = null;
    for (const ob of measuredNodes) {
      if (ob.id === n.id) continue;
      const g = bboxGapRect(n.bbox, ob.bbox);
      if (g < minLabelGapPt) {
        minLabelGapPt = g;
        closestOtherNode = {
          id: ob.id,
          label: ob.label,
          role: ob.role,
          roleLabel: describeNodeRole(ob.role),
          gapPt: r2(g),
        };
      }
    }
    minLabelGapPt = Number.isFinite(minLabelGapPt) ? r2(minLabelGapPt) : null;

    // (2-d) smart-label-engine 의 글리프 윤곽선(inkCollision) 결과 및 곡선 끝점 접촉 여부 확인
    let endGapPt = null;
    if (matchedStroke && matchedStroke.pts && matchedStroke.pts.length >= 2) {
      const e0 = matchedStroke.pts[0];
      const e1 = matchedStroke.pts[matchedStroke.pts.length - 1];
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

    const inkHitsForNode = (rawCollisionReport.results || []).filter(
      (r) =>
        r.verdict === "inkCollision" &&
        ((r.a && r.a.sourceId === n.id) || (r.b && r.b.sourceId === n.id))
    );

    const ownCurvePenetration =
      ownClearancePt !== null &&
      (ownClearancePt < -1.0 || (!isOwnEndpointContact && ownClearancePt < 0));
    const otherStrokeCollision =
      (minOtherClearancePt !== null && minOtherClearancePt < P.cHard - 1.5) ||
      inkHitsForNode.some(
        (r) =>
          r.relation.startsWith("label-") &&
          r.relation !== "label-label" &&
          (!matchedStroke || r.b?.pathIndex !== matchedStroke.index) &&
          (r.inkClearancePt ?? 0) <= -0.15
      );
    const labelOverlapCollision =
      (minLabelGapPt !== null && minLabelGapPt < P.mLabel - 1.5) ||
      inkHitsForNode.some((r) => r.relation === "label-label");

    const nodeCollisions = [];

    if (ownCurvePenetration) {
      const item = {
        key: `fn-own:${n.id}`,
        nodeId: n.id,
        nodeLabel: n.label,
        nodeRole: n.role,
        autoMoveTarget: true,
        targetType: "own-curve",
        targetLabel: "자기 함수 곡선",
        clearancePt: ownClearancePt,
        severity: "collision",
        description: `함수식 라벨 ${n.label} 이(가) 자기 곡선과 겹침 (간격 ${ownClearancePt}pt)`,
      };
      nodeCollisions.push(item);
      allCollisions.push(item);
    }

    if (otherStrokeCollision && closestOtherStroke) {
      const item = {
        key: `fn-stroke:${n.id}:${closestOtherStroke.kind}:${closestOtherStroke.index}`,
        nodeId: n.id,
        nodeLabel: n.label,
        nodeRole: n.role,
        autoMoveTarget: true,
        targetType: closestOtherStroke.kind === "axis" ? "axis" : "other-stroke",
        targetLabel: closestOtherStroke.kindLabel,
        clearancePt: closestOtherStroke.clearancePt,
        severity: "collision",
        description: `함수식 라벨 ${n.label} 이(가) ${closestOtherStroke.kindLabel}과(와) 너무 가깝거나 겹침 (간격 ${closestOtherStroke.clearancePt}pt)`,
      };
      nodeCollisions.push(item);
      allCollisions.push(item);
    }

    if (labelOverlapCollision && closestOtherNode) {
      const pairIds = [n.id, closestOtherNode.id].sort().join("::");
      const pairKey = `node-node:${pairIds}`;
      const item = {
        key: pairKey,
        nodeId: n.id,
        nodeLabel: n.label,
        nodeRole: n.role,
        otherNodeId: closestOtherNode.id,
        otherNodeLabel: closestOtherNode.label,
        otherNodeRole: closestOtherNode.role,
        autoMoveTarget: true,
        targetType: "node",
        targetLabel: `${closestOtherNode.roleLabel} ${closestOtherNode.label}`,
        clearancePt: closestOtherNode.gapPt,
        severity: "collision",
        description: `함수식 라벨 ${n.label} 이(가) ${closestOtherNode.roleLabel} ${closestOtherNode.label} 과(와) 충돌/근접함 (간격 ${closestOtherNode.gapPt}pt)`,
      };
      nodeCollisions.push(item);
      if (!recordedPairKeys.has(pairKey)) {
        recordedPairKeys.add(pairKey);
        allCollisions.push(item);
      }
    }

    functionLabelAudits.push({
      id: n.id,
      fNodeIndex: idx,
      label: n.label,
      role: n.role,
      matchedStrokeIndex: matchedStroke ? matchedStroke.index : null,
      assignmentHow: a ? a.how : null,
      confirmedMatch,
      ownClearancePt,
      minOtherClearancePt,
      closestOtherStroke,
      minLabelGapPt,
      closestOtherNode,
      ownCurvePenetration,
      otherStrokeCollision,
      labelOverlapCollision,
      hasCollision: nodeCollisions.length > 0,
      collisions: nodeCollisions,
    });
  }

  // 3) 일반 노드(role !== "function": x, y, O, 점 라벨 A/B, 눈금 등) 충돌 감사 (진단 및 축 변경 보호용)
  const generalNodeAudits = [];
  for (const gn of generalNodes) {
    const gnCollisions = [];

    // (3-a) 다른 모든 측정 노드와의 겹침 확인 (bboxGap < 1.2pt 또는 글리프 inkCollision)
    for (const ob of measuredNodes) {
      if (ob.id === gn.id) continue;
      const gap = r2(bboxGapRect(gn.bbox, ob.bbox));
      const pairIds = [gn.id, ob.id].sort().join("::");
      const pairKey = `node-node:${pairIds}`;

      const inkHit = (rawCollisionReport.results || []).find(
        (r) =>
          r.relation === "label-label" &&
          ((r.a?.sourceId === gn.id && r.b?.sourceId === ob.id) ||
            (r.a?.sourceId === ob.id && r.b?.sourceId === gn.id)) &&
          (r.verdict === "inkCollision" || (r.verdict === "possibleCollision" && gap <= 0.5))
      );

      if (gap < 1.0 || inkHit) {
        const item = {
          key: pairKey,
          nodeId: gn.id,
          nodeLabel: gn.label,
          nodeRole: gn.role,
          otherNodeId: ob.id,
          otherNodeLabel: ob.label,
          otherNodeRole: ob.role,
          autoMoveTarget: false,
          targetType: "node",
          targetLabel: `${describeNodeRole(ob.role)} ${ob.label}`,
          clearancePt: inkHit?.inkClearancePt ?? gap,
          severity: "collision",
          description: `${describeNodeRole(gn.role)} ${gn.label} 이(가) ${describeNodeRole(ob.role)} ${ob.label} 과(와) 겹침 (간격 ${inkHit?.inkClearancePt ?? gap}pt)`,
        };
        gnCollisions.push(item);
        if (!recordedPairKeys.has(pairKey)) {
          recordedPairKeys.add(pairKey);
          allCollisions.push(item);
        }
      }
    }

    // (3-b) 일반 노드와 곡선/직선/축의 실제 글리프 침범(inkCollision) 또는 바운딩 박스 관통 확인
    const recordedGeneralStrokeKeys = new Set();
    const strokeHits = (rawCollisionReport.results || []).filter(
      (r) =>
        r.a?.sourceId === gn.id &&
        r.relation.startsWith("label-") &&
        r.relation !== "label-label" &&
        r.verdict === "inkCollision" &&
        (r.inkClearancePt ?? 0) <= -0.1
    );

    for (const hit of strokeHits) {
      const targetKind = hit.b?.kind || "stroke";
      const targetDesc =
        targetKind === "axis"
          ? "좌표축"
          : targetKind === "curve"
          ? "함수 곡선"
          : targetKind === "dashed"
          ? "점선"
          : targetKind === "marker"
          ? "점 마커"
          : targetKind === "filled"
          ? "화살촉/채움도형"
          : "선분";
      const key = `gen-stroke:${gn.id}:${targetKind}:${hit.b?.pathIndex ?? 0}`;
      recordedGeneralStrokeKeys.add(key);
      const item = {
        key,
        nodeId: gn.id,
        nodeLabel: gn.label,
        nodeRole: gn.role,
        autoMoveTarget: false,
        targetType: targetKind,
        targetLabel: targetDesc,
        clearancePt: hit.inkClearancePt ?? 0,
        severity: "collision",
        description: `${describeNodeRole(gn.role)} ${gn.label} 이(가) ${targetDesc}과(와) 실제 겹침 (침범 ${hit.inkClearancePt ?? 0}pt, 일반 노드로 자동 이동 제외)`,
      };
      gnCollisions.push(item);
      allCollisions.push(item);
    }

    // 곡선/축이 일반 노드 바운딩 박스를 직접 관통하는 경우(clearance < -0.5pt) 추가 감지
    for (const st of scene.strokes || []) {
      // 축 이름(x, y)은 자기 축 끝점 근처에 위치하므로 축과의 접촉은 제외
      if (gn.role === "axisLabel" && st.kind === "axis") continue;
      // 원점(O)은 축 교차점 근처에 배치되므로 곡선(curve) 관통만 검사
      if (gn.role === "origin" && st.kind === "axis") continue;
      const c = r2(clearanceToStroke(gn.bbox, st));
      if (c < -0.5) {
        const key = `gen-stroke:${gn.id}:${st.kind}:${st.index}`;
        if (recordedGeneralStrokeKeys.has(key)) continue;
        recordedGeneralStrokeKeys.add(key);
        const targetDesc = describeStroke(st);
        const item = {
          key,
          nodeId: gn.id,
          nodeLabel: gn.label,
          nodeRole: gn.role,
          autoMoveTarget: false,
          targetType: st.kind,
          targetLabel: targetDesc,
          clearancePt: c,
          severity: "collision",
          description: `${describeNodeRole(gn.role)} ${gn.label} 이(가) ${targetDesc}과(와) 겹침 (관통 ${c}pt, 일반 노드로 자동 이동 제외)`,
        };
        gnCollisions.push(item);
        allCollisions.push(item);
      }
    }

    generalNodeAudits.push({
      id: gn.id,
      label: gn.label,
      role: gn.role,
      roleLabel: describeNodeRole(gn.role),
      autoMoveTarget: false,
      hasCollision: gnCollisions.length > 0,
      collisions: gnCollisions,
    });
  }

  return {
    ok: true,
    measurementComplete,
    unmeasuredNodes,
    unverifiableItems,
    functionLabelAudits,
    generalNodeAudits,
    allCollisions,
  };
}

/**
 * 원본 장면(origScene)과 추천 후보 장면(finalScene)의 충돌 감사 결과를 비교하여:
 * 1) 해결된 기존 충돌(resolvedCollisions)
 * 2) 미해결 상태로 남은 기존 충돌(preExistingUnresolvedCollisions)
 * 3) 자동 이동 또는 축 길이 조정으로 인해 새롭게 발생한 충돌(newlyIntroducedCollisions)
 * 을 명확히 분리 판정한다.
 *
 * 안전 규칙:
 * - 이동된 함수식 라벨(movedNodeIds)에 남아 있는 모든 충돌은 항상 newlyIntroducedCollisions(안전성 검증 실패)로 간주하여 적용을 차단한다.
 * - 축 길이 조정(axisChanged === true) 시 x, y, O 또는 일반 노드에서 새로 발생하거나 악화된 충돌도 즉시 newlyIntroducedCollisions로 판정하여 차단한다.
 * - 이동하지 않은 노드의 원본 충돌은 preExistingUnresolvedCollisions(미해결 충돌)로 기록하여 억지로 이동하지 않되 "모든 겹침이 해결됨"으로 표시하지 않는다.
 *
 * @param {any} origScene
 * @param {any} finalScene
 * @param {Iterable<string>} movedNodeIds
 * @param {{axisChanged?: boolean, params?: typeof PARAMS}} [opts]
 */
export function compareCollisionDiagnostics(origScene, finalScene, movedNodeIds = [], opts = {}) {
  const P = opts.params || PARAMS;
  const movedSet = new Set(movedNodeIds || []);
  const origAudit = auditSceneCollisions(origScene, P);
  const finalAudit = finalScene && finalScene !== origScene ? auditSceneCollisions(finalScene, P) : origAudit;

  const origByKey = new Map(origAudit.allCollisions.map((c) => [c.key, c]));
  const finalByKey = new Map(finalAudit.allCollisions.map((c) => [c.key, c]));

  const resolvedCollisions = [];
  const preExistingUnresolvedCollisions = [];
  const newlyIntroducedCollisions = [];

  for (const [key, origItem] of origByKey.entries()) {
    if (!finalByKey.has(key)) {
      resolvedCollisions.push({
        ...origItem,
        resolutionStatus: "resolved",
      });
    }
  }

  for (const [key, finalItem] of finalByKey.entries()) {
    const origItem = origByKey.get(key);
    const involvesMovedNode =
      movedSet.has(finalItem.nodeId) || (finalItem.otherNodeId && movedSet.has(finalItem.otherNodeId));

    // 이동한 라벨이 여전히 충돌 중이면 새 위치가 안전하지 않으므로 실패(차단) 처리
    if (involvesMovedNode) {
      newlyIntroducedCollisions.push({
        ...finalItem,
        originStatus: origItem ? "moved-still-colliding" : "newly-caused-by-move",
        reason: origItem
          ? `이동된 라벨(${finalItem.nodeLabel})이 이동 후에도 충돌 상태를 벗어나지 못함`
          : `라벨 이동으로 인해 새로운 충돌이 발생함: ${finalItem.description}`,
      });
      continue;
    }

    // 원본에는 없던 충돌이 새로 생긴 경우 (예: 축 길이 조정으로 x/y 라벨이나 연장된 축이 기존 노드·곡선과 충돌)
    if (!origItem) {
      newlyIntroducedCollisions.push({
        ...finalItem,
        originStatus: opts.axisChanged ? "newly-caused-by-axis-edit" : "newly-introduced",
        reason: opts.axisChanged
          ? `축 길이 조정으로 인해 새로운 충돌이 발생함: ${finalItem.description}`
          : `자동 정렬 과정에서 새로운 충돌이 발생함: ${finalItem.description}`,
      });
      continue;
    }

    // 원본에도 있었고 이동하지 않은 노드에 그대로 남아 있는 경우:
    // 단, 간격이 0.5pt 이상 더 나빠졌다면 악화(newlyIntroduced)로 판정
    const origClear = typeof origItem.clearancePt === "number" ? origItem.clearancePt : 0;
    const finalClear = typeof finalItem.clearancePt === "number" ? finalItem.clearancePt : 0;
    if (finalClear < origClear - 0.5) {
      newlyIntroducedCollisions.push({
        ...finalItem,
        originStatus: "worsened-existing-collision",
        reason: `기존 충돌 간격이 더 악화됨 (${origClear}pt → ${finalClear}pt): ${finalItem.description}`,
      });
      continue;
    }

    preExistingUnresolvedCollisions.push({
      ...finalItem,
      originStatus: "pre-existing-unresolved",
      reason: finalItem.autoMoveTarget
        ? `원본부터 존재하던 겹침이나 안전한 이동 후보가 없어 기존 위치를 유지함 (수동/조이스틱 조정 권장)`
        : `원본부터 존재하던 일반 노드(${finalItem.nodeLabel}) 겹침 (이번 단계에서 일반 노드는 자동 이동 제외 — 수동 조정 권장)`,
    });
  }

  const safetyPassed = newlyIntroducedCollisions.length === 0;
  const hasUnresolvedCollisions = preExistingUnresolvedCollisions.length > 0;
  const measurementComplete = origAudit.measurementComplete && finalAudit.measurementComplete;
  const allCollisionsResolved =
    safetyPassed && !hasUnresolvedCollisions && measurementComplete;

  return {
    safetyPassed,
    allCollisionsResolved,
    hasUnresolvedCollisions,
    measurementComplete,
    counts: {
      origTotal: origAudit.allCollisions.length,
      finalTotal: finalAudit.allCollisions.length,
      resolved: resolvedCollisions.length,
      preExistingUnresolved: preExistingUnresolvedCollisions.length,
      newlyIntroduced: newlyIntroducedCollisions.length,
      unmeasuredNodes: finalAudit.unmeasuredNodes.length,
    },
    resolvedCollisions,
    preExistingUnresolvedCollisions,
    newlyIntroducedCollisions,
    unmeasuredNodes: finalAudit.unmeasuredNodes,
    unverifiableItems: finalAudit.unverifiableItems,
    origAudit,
    finalAudit,
  };
}
