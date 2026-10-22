// ============================================================================
// KO-SMART 스마트 라벨 1차 중간 개선 — Unit 1: 진단 및 안정성 오류 수정 모듈
// ============================================================================
// 해결 범위:
//  1) 노드 ID 문자열 오프셋(@start) 변화에 따른 허위 신규 충돌 판정 방지
//     - 단순 .split("@")[0] (순번 n0, n1...) 만 쓰면 노드 삽입·삭제·재정렬 시
//       순번이 밀려 다른 노드끼리 매칭될 위험이 있으므로,
//       (role, 정규화 label, kind, 동일 라벨 내 상대 순서 및 좌표 근접도)를 결합한
//       전단사(Bijective) 정준 노드 매퍼(buildCanonicalNodeMap)를 사용한다.
//  2) 실제 안전 후보가 없는 경우(no-safe-candidate)와 수식 매칭 불확실로 보류된 경우
//     (uncertain-match, advisoryShift 보유), 수식 파싱 미지원(parse-failure),
//     노드 측정 불확실(unusable-node)의 진단 문구 및 코드를 엄격히 구분한다.
//  3) CASE-007 등에서 기호 좌표(at ({-pi/2}, -3.8)) 해석 실패로 n.at === null 인
//     함수 라벨이 v0.1 assignStrokes 에서 minDistPolylines([null, null]) TypeError 를
//     일으키는 런타임 예외를 방지한다.
//     - 단, SVG bbox 중심점을 대체 좌표(fallbackAnchor)로 주입할 때는 반드시
//       n.fallbackAnchorFromBBox = true, n.confidence = "uncertain", n.usable = false
//       잠금을 유지하여 대체 좌표가 잘못된 곡선 확정 매칭이나 자동 이동으로 이어지지 않게 차단한다.
// ============================================================================

import { PARAMS } from "../../../../experiments/smart-label-prototype-v021/src/algorithm.mjs";
import { auditSceneCollisions } from "../collision-diagnostics.mjs";

const r2 = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

/**
 * [Unit 1 - 안정성 가드]
 * buildScene 결과 장면(scene)에서 n.at === null && n.inlineAnchor === null && n.anchor === null 인
 * 노드가 있을 때 v0.1 assignStrokes 의 minDistPolylines([null, null]) TypeError 크래시를 방지한다.
 *
 * 중요 보호 원칙:
 * - SVG bbox 중심점을 fallback anchor 로 제공할 때, 해당 좌표는 파싱된 수학 좌표가 아니므로
 *   절대 자동 이동(usable=true)이나 확정 매칭에 사용되면 안 된다.
 * - 따라서 fallback 주입 시 n.usable = false, n.confidence = "uncertain",
 *   n.fallbackAnchorFromBBox = true 를 강제 설정하여 안전하게 원본 위치를 유지하도록 보장한다.
 *
 * @param {any} scene buildScene 반환 객체
 * @returns {any} 안전 처리된 scene (원본 객체의 노드 속성을 보강하고 통계 반환)
 */
export function sanitizeSceneForSafePlanningUnit1(scene) {
  if (!scene || !Array.isArray(scene.nodes)) return scene;
  const fallbackAppliedNodes = [];

  for (const n of scene.nodes) {
    if (!n) continue;
    const hasValidCoord =
      (Array.isArray(n.at) && Number.isFinite(n.at[0]) && Number.isFinite(n.at[1])) ||
      (Array.isArray(n.inlineAnchor) && Number.isFinite(n.inlineAnchor[0]) && Number.isFinite(n.inlineAnchor[1])) ||
      (Array.isArray(n.anchor) && Number.isFinite(n.anchor[0]) && Number.isFinite(n.anchor[1]));

    if (!hasValidCoord && n.bbox && Number.isFinite(n.bbox.x0) && Number.isFinite(n.bbox.y0)) {
      const cx = r2((n.bbox.x0 + n.bbox.x1) / 2);
      const cy = r2((n.bbox.y0 + n.bbox.y1) / 2);
      n.anchor = [cx, cy];

      // 인라인 노드(plot ... node {...})로서 이미 stmt.path 에 연결되어 검증된 경우(usableBy: inline-node-at-plot-end)는
      // 소속 경로가 100% 확정되어 있으므로 usable 상태를 그대로 보존한다.
      const isConfirmedInlinePlotNode =
        n.kind === "inline" &&
        Boolean(n.stmt && n.stmt.path) &&
        n.usable === true;

      if (!isConfirmedInlinePlotNode) {
        n.fallbackAnchorFromBBox = true;
        // 불확실성 잠금 강제 유지: 대체 좌표로 인해 잘못된 곡선 이동이 절대 일어나지 않도록 차단
        n.usable = false;
        if (n.confidence === "confirmed") {
          n.confidence = "uncertain";
        }
        fallbackAppliedNodes.push({
          id: n.id,
          label: n.label,
          role: n.role,
          fallbackAnchor: [cx, cy],
        });
      }
    }
  }

  scene.unit1FallbackNodes = fallbackAppliedNodes;
  return scene;
}

/**
 * 노드의 라벨 문자열을 공백 정규화하여 비교용 시그니처를 만든다.
 * @param {any} node
 */
function normalizeNodeLabelSig(node) {
  const raw = String(node?.label ?? node?.nodeLabel ?? "").trim().replace(/\s+/g, " ");
  const role = String(node?.role ?? node?.nodeRole ?? "other");
  return `${role}::${raw}`;
}

/**
 * [Unit 1 - 노드 삽입·삭제·재정렬 안전 정준 ID 매퍼]
 * origScene 과 finalScene 의 노드 목록을 비교하여, 단순 바이트 오프셋(@start)이나
 * 단순 배열 순번(n0, n1...)에 의존하지 않고 (role, label, kind, 상대 순서/좌표 근접성)으로
 * 1:1 대응되는 정준 ID(canonicalId) 매핑을 생성한다.
 *
 * - 만약 중간에 노드가 삽입/삭제/재정렬되더라도, 동일한 (role, label) 그룹 내에서
 *   위치(at / bbox)와 옵션이 가장 가까운 노드끼리만 매칭하며,
 *   (role, label)이 다른 노드는 절대 같은 정준 ID로 묶지 않는다.
 *
 * @param {any} origScene
 * @param {any} finalScene
 */
export function buildCanonicalNodeMapUnit1(origScene, finalScene) {
  const origToCanon = new Map();
  const finalToCanon = new Map();
  const canonMeta = new Map();

  const origNodes = Array.isArray(origScene?.nodes) ? origScene.nodes : [];
  const finalNodes = Array.isArray(finalScene?.nodes) ? finalScene.nodes : [];

  // 그룹별로 origNodes 와 finalNodes 를 분류
  const origByGroup = new Map();
  for (let i = 0; i < origNodes.length; i++) {
    const n = origNodes[i];
    const sig = normalizeNodeLabelSig(n);
    if (!origByGroup.has(sig)) origByGroup.set(sig, []);
    origByGroup.get(sig).push({ node: n, idx: i });
  }

  const finalByGroup = new Map();
  for (let j = 0; j < finalNodes.length; j++) {
    const n = finalNodes[j];
    const sig = normalizeNodeLabelSig(n);
    if (!finalByGroup.has(sig)) finalByGroup.set(sig, []);
    finalByGroup.get(sig).push({ node: n, idx: j });
  }

  let canonCounter = 0;

  // 1) origScene 의 그룹별 매칭
  for (const [sig, oList] of origByGroup.entries()) {
    const fList = finalByGroup.get(sig) || [];
    const usedFinalIndices = new Set();

    if (oList.length === 1 && fList.length === 1) {
      // 그룹 내 유일한 (role, label) 노드이면 순서/오프셋이 바뀌어도 100% 유일 매칭
      const cid = `canon_${canonCounter++}_${oList[0].node.role}`;
      origToCanon.set(oList[0].node.id, cid);
      finalToCanon.set(fList[0].node.id, cid);
      canonMeta.set(cid, {
        canonId: cid,
        origId: oList[0].node.id,
        finalId: fList[0].node.id,
        role: oList[0].node.role,
        label: oList[0].node.label,
      });
      usedFinalIndices.add(0);
    } else {
      // 동일 (role, label) 노드가 여러 개(예: 눈금 $1$ 두 개, 마커 여러 개)인 경우:
      // kind 및 기준 좌표(at 또는 bbox 중심) 거리가 가장 가까운 미사용 finalNode 와 매칭
      for (let oi = 0; oi < oList.length; oi++) {
        const oEntry = oList[oi];
        const oNode = oEntry.node;
        const oCenter = oNode.at || (oNode.bbox ? [(oNode.bbox.x0 + oNode.bbox.x1) / 2, (oNode.bbox.y0 + oNode.bbox.y1) / 2] : null);

        let bestFi = -1;
        let bestScore = Infinity;

        for (let fi = 0; fi < fList.length; fi++) {
          if (usedFinalIndices.has(fi)) continue;
          const fNode = fList[fi].node;
          if (fNode.kind && oNode.kind && fNode.kind !== oNode.kind) continue;

          const fCenter = fNode.at || (fNode.bbox ? [(fNode.bbox.x0 + fNode.bbox.x1) / 2, (fNode.bbox.y0 + fNode.bbox.y1) / 2] : null);
          let dist = Math.abs(oi - fi) * 5;
          if (oCenter && fCenter) {
            dist += Math.hypot(oCenter[0] - fCenter[0], oCenter[1] - fCenter[1]);
          }
          if (dist < bestScore) {
            bestScore = dist;
            bestFi = fi;
          }
        }

        const cid = `canon_${canonCounter++}_${oNode.role}`;
        origToCanon.set(oNode.id, cid);
        if (bestFi >= 0 && bestScore <= 150) {
          usedFinalIndices.add(bestFi);
          finalToCanon.set(fList[bestFi].node.id, cid);
          canonMeta.set(cid, {
            canonId: cid,
            origId: oNode.id,
            finalId: fList[bestFi].node.id,
            role: oNode.role,
            label: oNode.label,
          });
        } else {
          canonMeta.set(cid, {
            canonId: cid,
            origId: oNode.id,
            finalId: null,
            role: oNode.role,
            label: oNode.label,
          });
        }
      }
    }

    // fList 중 매칭되지 않고 새로 삽입된 노드 처리
    for (let fi = 0; fi < fList.length; fi++) {
      if (!usedFinalIndices.has(fi)) {
        const fNode = fList[fi].node;
        const cid = `canon_inserted_${canonCounter++}_${fNode.role}`;
        finalToCanon.set(fNode.id, cid);
        canonMeta.set(cid, {
          canonId: cid,
          origId: null,
          finalId: fNode.id,
          role: fNode.role,
          label: fNode.label,
        });
      }
    }
  }

  // 2) origScene 에는 없던 새로운 그룹이 finalScene 에 삽입된 경우
  for (const [sig, fList] of finalByGroup.entries()) {
    if (origByGroup.has(sig)) continue;
    for (const fEntry of fList) {
      const fNode = fEntry.node;
      const cid = `canon_inserted_${canonCounter++}_${fNode.role}`;
      finalToCanon.set(fNode.id, cid);
      canonMeta.set(cid, {
        canonId: cid,
        origId: null,
        finalId: fNode.id,
        role: fNode.role,
        label: fNode.label,
      });
    }
  }

  return { origToCanon, finalToCanon, canonMeta };
}

/**
 * 충돌 항목(item)의 키를 정준 노드 ID(canonId) 기반으로 변환한다.
 * @param {any} item
 * @param {Map<string, string>} idToCanon
 */
export function canonicalizeCollisionItemUnit1(item, idToCanon) {
  const mapId = (rawId) => {
    if (!rawId) return "";
    if (idToCanon && idToCanon.has(rawId)) return idToCanon.get(rawId);
    return String(rawId).split("@")[0];
  };

  const cNodeId = mapId(item.nodeId);
  const cOtherNodeId = item.otherNodeId ? mapId(item.otherNodeId) : null;

  let cKey = item.key;
  if (item.key.startsWith("fn-own:")) {
    cKey = `fn-own:${cNodeId}`;
  } else if (item.key.startsWith("fn-stroke:")) {
    const parts = item.key.split(":");
    cKey = `fn-stroke:${cNodeId}:${parts.slice(2).join(":")}`;
  } else if (item.key.startsWith("gen-stroke:")) {
    const parts = item.key.split(":");
    cKey = `gen-stroke:${cNodeId}:${parts.slice(2).join(":")}`;
  } else if (item.key.startsWith("node-node:")) {
    const pair = [cNodeId, cOtherNodeId || ""].sort().join("::");
    cKey = `node-node:${pair}`;
  }

  return {
    ...item,
    rawKey: item.key,
    key: cKey,
    rawNodeId: item.nodeId,
    nodeId: cNodeId,
    rawOtherNodeId: item.otherNodeId || null,
    otherNodeId: cOtherNodeId,
  };
}

/**
 * [Unit 1] 전후 장면 충돌 비교 및 미이동 사유 정밀 분리
 */
export function compareCollisionDiagnosticsUnit1(origScene, finalScene, movedNodeIds = [], opts = {}) {
  const P = opts.params || PARAMS;
  const axisChanged = Boolean(opts.axisChanged);
  const decisionsByNodeId = opts.decisionsByNodeId || new Map();

  const { origToCanon, finalToCanon } = buildCanonicalNodeMapUnit1(origScene, finalScene);

  const origAuditRaw = auditSceneCollisions(origScene, P);
  const finalAuditRaw = auditSceneCollisions(finalScene, P);

  const origCollisions = origAuditRaw.allCollisions.map((c) => canonicalizeCollisionItemUnit1(c, origToCanon));
  const finalCollisions = finalAuditRaw.allCollisions.map((c) => canonicalizeCollisionItemUnit1(c, finalToCanon));

  const movedCanonSet = new Set(
    (movedNodeIds || []).map((id) => origToCanon.get(id) || finalToCanon.get(id) || String(id).split("@")[0])
  );

  // decisionsByNodeId 도 canonId 로 조회 가능하게 매핑
  const decisionsByCanonId = new Map();
  if (decisionsByNodeId instanceof Map) {
    for (const [k, v] of decisionsByNodeId.entries()) {
      const cid = origToCanon.get(k) || finalToCanon.get(k) || k;
      decisionsByCanonId.set(cid, v);
    }
  }

  const origByKey = new Map();
  for (const c of origCollisions) {
    origByKey.set(c.key, c);
  }
  const finalByKey = new Map();
  for (const c of finalCollisions) {
    finalByKey.set(c.key, c);
  }

  const resolvedCollisions = [];
  const preExistingUnresolvedCollisions = [];
  const newlyIntroducedCollisions = [];

  for (const [key, origItem] of origByKey.entries()) {
    if (!finalByKey.has(key)) {
      resolvedCollisions.push({
        ...origItem,
        status: "resolved",
        resolutionNote: "스마트 라벨 자동 정렬/축 조정 후 해소됨",
      });
    }
  }

  for (const [key, finalItem] of finalByKey.entries()) {
    const origItem = origByKey.get(key);
    const touchesMovedNode =
      movedCanonSet.has(finalItem.nodeId) ||
      (finalItem.otherNodeId ? movedCanonSet.has(finalItem.otherNodeId) : false);
    const touchesAxisAfterAxisChange =
      axisChanged &&
      (finalItem.targetType === "axis" ||
        finalItem.nodeRole === "axisLabel" ||
        finalItem.otherNodeRole === "axisLabel");

    if (!origItem) {
      newlyIntroducedCollisions.push({
        ...finalItem,
        status: "newly-introduced",
        reasonCode: touchesMovedNode
          ? "caused-by-label-move"
          : touchesAxisAfterAxisChange
          ? "caused-by-axis-adjustment"
          : "new-in-second-pass",
        reason: touchesMovedNode
          ? "함수식 라벨 자동 이동으로 인해 새로 발생한 충돌"
          : touchesAxisAfterAxisChange
          ? "축 길이 조정으로 인해 새로 발생한 충돌"
          : "2차 검증 렌더링에서 새로 감지된 충돌",
      });
    } else {
      const origClearance = typeof origItem.clearancePt === "number" ? origItem.clearancePt : 0;
      const finalClearance = typeof finalItem.clearancePt === "number" ? finalItem.clearancePt : 0;
      const worsened = (touchesMovedNode || touchesAxisAfterAxisChange) && finalClearance < origClearance - 0.5;

      if (worsened) {
        newlyIntroducedCollisions.push({
          ...finalItem,
          status: "worsened",
          origClearancePt: origClearance,
          reasonCode: touchesMovedNode ? "worsened-by-label-move" : "worsened-by-axis-adjustment",
          reason: touchesMovedNode
            ? `라벨 이동 후 기존 간격(${origClearance}pt → ${finalClearance}pt)이 악화됨`
            : `축 길이 조정 후 기존 간격(${origClearance}pt → ${finalClearance}pt)이 악화됨`,
        });
      } else {
        // [Unit 1 핵심] 미이동 사유를 4가지(uncertain-match / parse-failure / unusable-node / no-safe-candidate)로 엄격히 분리
        let nonMoveReason = "";
        let nonMoveReasonCode = "";

        if (finalItem.nodeRole === "function" && !movedCanonSet.has(finalItem.nodeId)) {
          const dec = decisionsByCanonId.get(finalItem.nodeId);
          const hasAdvisoryCandidate =
            Array.isArray(dec?.advisoryShift) &&
            (Math.abs(dec.advisoryShift[0] || 0) > 0 || Math.abs(dec.advisoryShift[1] || 0) > 0);

          if (dec && !dec.usable && dec.fallbackAnchorFromBBox) {
            nonMoveReasonCode = "held-fallback-anchor-unusable";
            nonMoveReason = `원본부터 존재하던 겹침이나 기호 좌표 미해석(SVG bbox 대체 좌표 사용)으로 인해 안전 잠금이 적용되어 자동 이동을 보류함`;
          } else if (dec && dec.nonMoveCode === "unusable-node") {
            nonMoveReasonCode = "held-unusable-node";
            nonMoveReason = `원본부터 존재하던 겹침이나 SVG 글리프/좌표 매칭이 불확실하여 안전을 위해 자동 이동을 보류함`;
          } else if (dec && dec.nonMoveCode === "parse-failure") {
            nonMoveReasonCode = "held-parse-failure";
            nonMoveReason = `원본부터 존재하던 겹침이나 함수식 수식 파싱 미지원(${finalItem.nodeLabel})으로 자동 이동을 보류함 (조이스틱 수동 조정 권장)`;
          } else if (
            dec &&
            (dec.nonMoveCode === "uncertain-match" ||
              dec.how === "nearest-unclaimed" ||
              dec.how === "ambiguous-structural")
          ) {
            nonMoveReasonCode = hasAdvisoryCandidate
              ? "held-uncertain-match-has-candidate"
              : "held-uncertain-match";
            nonMoveReason = hasAdvisoryCandidate
              ? `원본부터 존재하던 겹침이며 안전 이동 후보(shift=[${dec.advisoryShift.join(", ")}]pt)가 존재하나, 수식-곡선 확정 매칭 규칙이 없어 자동 이동을 보류함`
              : `원본부터 존재하던 겹침이나 수식-곡선 확정 매칭이 불확실하여 자동 이동을 보류함 (수동/조이스틱 조정 권장)`;
          } else {
            nonMoveReasonCode = "held-no-safe-candidate";
            nonMoveReason =
              "원본부터 존재하던 겹침이며 수식 매칭은 확정되었으나 허용 간격(cHard)을 만족하는 안전한 이동 후보가 없어 기존 위치를 유지함 (수동/조이스틱 조정 권장)";
          }
        } else if (finalItem.nodeRole !== "function") {
          nonMoveReasonCode = "unmoved-general-node-overlap";
          nonMoveReason = `원본부터 존재하던 일반 노드(${finalItem.nodeLabel}) 겹침 (이번 단계에서 일반 노드는 자동 이동 제외 — 조이스틱 수동 조정 권장)`;
        } else {
          nonMoveReasonCode = "residual-after-move";
          nonMoveReason = "이동 후에도 일부 근접이 남아 있음";
        }

        preExistingUnresolvedCollisions.push({
          ...finalItem,
          status: "pre-existing-unresolved",
          origClearancePt: origClearance,
          reasonCode: nonMoveReasonCode,
          reason: nonMoveReason,
        });
      }
    }
  }

  const movedNodeHasCollision = finalAuditRaw.functionLabelAudits.some(
    (fa) => movedCanonSet.has(finalToCanon.get(fa.id) || String(fa.id).split("@")[0]) && fa.hasCollision
  );

  const safetyPassed = newlyIntroducedCollisions.length === 0 && !movedNodeHasCollision;
  const measurementComplete = finalAuditRaw.measurementComplete;
  const allClear =
    safetyPassed &&
    measurementComplete &&
    finalCollisions.length === 0 &&
    preExistingUnresolvedCollisions.length === 0;

  return {
    safetyPassed,
    measurementComplete,
    allClear,
    movedNodeHasCollision,
    counts: {
      origTotal: origCollisions.length,
      finalTotal: finalCollisions.length,
      resolved: resolvedCollisions.length,
      preExistingUnresolved: preExistingUnresolvedCollisions.length,
      newlyIntroduced: newlyIntroducedCollisions.length,
      unmeasuredNodes: finalAuditRaw.unmeasuredNodes.length,
      unverifiableItems: finalAuditRaw.unverifiableItems.length,
    },
    resolvedCollisions,
    preExistingUnresolvedCollisions,
    newlyIntroducedCollisions,
    unmeasuredNodes: finalAuditRaw.unmeasuredNodes,
    unverifiableItems: finalAuditRaw.unverifiableItems,
    origAudit: origAuditRaw,
    finalAudit: finalAuditRaw,
  };
}
