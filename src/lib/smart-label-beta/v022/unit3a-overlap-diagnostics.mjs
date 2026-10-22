// ============================================================================
// KO-SMART 스마트 라벨 1차 중간 개선 — Unit 3-A: 글자 겹침 정밀 진단 및 끝점 근접 분리 모듈
// ============================================================================
// 핵심 목표:
//  1) 다음 7가지 상태를 엄격히 구분하여 진단한다:
//     - true-ink-collision        : 실제 글자 잉크가 곡선/축/보조선/다른 라벨에 침범(clearance < 0pt)
//     - bbox-only-contact         : 실제 글자 침범은 없으나(clearance >= 0pt) 여백 기준(cHard/mLabel) 미달인 경미 접촉
//     - natural-endpoint-proximity: 곡선/직선 끝점 부근(endGap <= 8pt)의 자연스러운 인접 배치(충돌 오진 제외!)
//     - pre-existing              : 원본 TikZ 부터 존재하던 겹침
//     - newly-introduced          : 자동 이동/축 조정으로 새로 발생하거나 악화된 겹침 (안전성 게이트 차단 대상)
//     - unmoved-general-node-overlap: 이번 1차 개선에서 자동 이동 제외된 일반 노드(원점 O, 눈금, 점 A~F 등)의 겹침
//     - uncertain-measurement-or-match: 기호 좌표/매칭 불확실 상태의 보류 항목
//  2) \coordinate (A) at (...) 및 pi/sqrt/삼각함수 좌표 해석기(resolveSceneSymbolicCoordinatesUnit3A):
//     - 일반 점 라벨(at (A))이나 축 눈금(at ({pi/8}, 0))의 수학적 기준 좌표를 복원하여
//       SVG 측정 검증 및 충돌 진단의 정확도를 높인다 (단, 일반 노드 자동 이동 Unit 3-B 는 수행하지 않음).
// ============================================================================

import { minDistPolylines } from "../../../../experiments/smart-label-engine/src/geometry.mjs";
import { PARAMS, bboxGapRect, bboxPtDist, classifyStrokeKind } from "../../../../experiments/smart-label-prototype-v021/src/algorithm.mjs";
import { buildCanonicalNodeMapUnit1 } from "./unit1-diagnostics-stability.mjs";
import { evalConstantMathExprUnit2, assignStrokesUnit2, DEFAULT_UNIT2_FLAGS } from "./unit2-expression-matching.mjs";

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

function splitTopLevelComma(inside) {
  let depth = 0;
  for (let i = 0; i < inside.length; i++) {
    const ch = inside[i];
    if (ch === "(" || ch === "{") depth++;
    else if (ch === ")" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      return [inside.slice(0, i).trim(), inside.slice(i + 1).trim()];
    }
  }
  return null;
}

/**
 * [Unit 3-A] TikZ 본문 내 \coordinate (NAME) at (X, Y) 정의 및 노드의 at (...) 기호 좌표를 해석하여
 * 진단용 기준 좌표(resolvedAtPt)를 보강한다.
 * (원본 n.usable 잠금 상태는 절대 변경하지 않아 안전성을 보존한다.)
 */
export function resolveSceneSymbolicCoordinatesUnit3A(scene, flags = DEFAULT_UNIT2_FLAGS) {
  if (!scene || !scene.body || !scene.units || !scene.units.xU || !scene.units.yU) return scene;
  const { xU, yU } = scene.units;
  const body = scene.body;
  const coordMap = new Map();

  // 1) \coordinate (NAME) at (...) 파싱
  const coordRe = /\\coordinate\s*\(\s*([A-Za-z0-9_]+)\s*\)\s*at\s*\(/g;
  let m;
  while ((m = coordRe.exec(body)) !== null) {
    const name = m[1];
    const openIdx = m.index + m[0].length - 1;
    let depth = 0;
    let closeIdx = -1;
    for (let i = openIdx; i < body.length; i++) {
      if (body[i] === "(" || body[i] === "{") depth++;
      else if (body[i] === ")" || body[i] === "}") {
        depth--;
        if (depth === 0 && body[i] === ")") {
          closeIdx = i;
          break;
        }
      }
    }
    if (closeIdx === -1) continue;
    const inside = body.slice(openIdx + 1, closeIdx).trim();
    const parts = splitTopLevelComma(inside);
    if (!parts) continue;
    const xVal = evalConstantMathExprUnit2(parts[0], flags);
    const yVal = evalConstantMathExprUnit2(parts[1], flags);
    if (xVal !== null && yVal !== null) {
      coordMap.set(name, [r2(xVal * xU), r2(yVal * yU)]);
    }
  }

  // 2) 각 노드의 소스 텍스트에서 at (...) 가 기호 좌표 또는 \coordinate 참조인 경우 resolvedAtPt 기록
  for (const n of scene.nodes || []) {
    if (!n) continue;
    if (Array.isArray(n.at) && Number.isFinite(n.at[0]) && Number.isFinite(n.at[1])) {
      n.resolvedAtPt = n.at;
      n.resolvedAtBy = "numeric-at";
      continue;
    }
    if (typeof n.start === "number" && typeof n.end === "number") {
      const rawNodeText = body.slice(n.start, n.end);
      const atMatch = /\bat\s*\(/.exec(rawNodeText);
      if (atMatch) {
        const openIdx = atMatch.index + atMatch[0].length - 1;
        let depth = 0;
        let closeIdx = -1;
        for (let i = openIdx; i < rawNodeText.length; i++) {
          if (rawNodeText[i] === "(" || rawNodeText[i] === "{") depth++;
          else if (rawNodeText[i] === ")" || rawNodeText[i] === "}") {
            depth--;
            if (depth === 0 && rawNodeText[i] === ")") {
              closeIdx = i;
              break;
            }
          }
        }
        if (closeIdx !== -1) {
          const inside = rawNodeText.slice(openIdx + 1, closeIdx).trim();
          if (coordMap.has(inside)) {
            n.resolvedAtPt = coordMap.get(inside);
            n.resolvedAtBy = `coordinate-ref(${inside})`;
          } else {
            const parts = splitTopLevelComma(inside);
            if (parts) {
              const xVal = evalConstantMathExprUnit2(parts[0], flags);
              const yVal = evalConstantMathExprUnit2(parts[1], flags);
              if (xVal !== null && yVal !== null) {
                n.resolvedAtPt = [r2(xVal * xU), r2(yVal * yU)];
                n.resolvedAtBy = "symbolic-expr-at";
              }
            }
          }
        }
      }
    }
  }

  scene.unit3aCoordinateMap = Object.fromEntries(coordMap.entries());
  return scene;
}

/**
 * 라벨 bbox 와 선(stroke) 사이의 접촉이 "자연스러운 끝점 배치(natural-endpoint-proximity)"인지 판정한다.
 *
 * 판정 기준:
 * - 케이스 A (자기 소속 곡선/직선 ownStroke):
 *   함수식 라벨이 자기 소속 곡선의 양 끝점 중 하나에서 8.5pt 이내에 위치하고,
 *   곡선이 라벨 중심부를 관통하지 않으며(끝점 외 내부 점들과의 최소 거리가 >= 0pt 이거나
 *   전체 clearance 가 >= -1.2pt 인 미세 끝점 스침) 배치된 경우 -> 자연스러운 끝점 인접!
 * - 케이스 B (보조선/축 끝점에 붙은 인라인/일반 라벨 또는 클리핑 경계 끝점):
 *   선분의 끝점이 라벨에서 6.0pt 이내이고 선분이 라벨을 관통하지 않으며(clearance >= -0.6pt),
 *   실제 침범이 아닌 단순 여백 접촉(0 <= clearance < threshold)인 경우 -> 자연스러운 끝점 인접!
 */
export function classifyStrokeContactKindUnit3A(node, stroke, isOwnStroke, clearancePt, thresholdPt) {
  const pts = stroke?.pts || [];
  if (!node?.bbox || pts.length < 2) return "true-ink-collision";

  const pStart = pts[0];
  const pEnd = pts[pts.length - 1];
  const dStart = bboxPtDist(pStart, node.bbox);
  const dEnd = bboxPtDist(pEnd, node.bbox);
  const minEndDist = Math.min(dStart, dEnd);

  // 곡선 내부(양 끝점 15% 제외 구간)가 라벨 박스를 깊게 관통하는지 확인
  let interiorClearance = Infinity;
  if (pts.length >= 6) {
    const k0 = Math.max(1, Math.floor(pts.length * 0.15));
    const k1 = Math.min(pts.length - 2, Math.ceil(pts.length * 0.85));
    if (k1 > k0) {
      const interiorPts = pts.slice(k0, k1 + 1);
      interiorClearance =
        minDistPolylines([rectPoly(node.bbox)], [{ pts: interiorPts, closed: false }]) - (stroke.halfWidth || 0.5);
    }
  }

  if (isOwnStroke) {
    // 자기 곡선 끝점 근처(<= 8.5pt)에서 끝점만 살짝 닿거나(>= -1.2pt) 인접하고 내부 관통이 없는 경우
    if (minEndDist <= 8.5 && clearancePt >= -1.2 && interiorClearance >= -0.2) {
      return "natural-endpoint-proximity";
    }
    if (clearancePt >= 0) {
      return "bbox-only-contact";
    }
    return "true-ink-collision";
  }

  // 타 곡선/축/보조선과의 관계:
  // 1) 인라인으로 해당 선분(보조선/축)에 직접 선언된 노드이고 끝점 근처에서 침범하지 않는 경우
  const isInlineOnThisStroke =
    node.kind === "inline" && node.stmt && node.stmt.path && stroke.index === node.stmt.path.index;
  if (isInlineOnThisStroke && minEndDist <= 8.0 && clearancePt >= -0.6) {
    return "natural-endpoint-proximity";
  }

  // 2) 실제 잉크 침범(clearance < 0pt): 선이 글자 박스 내부를 통과함
  if (clearancePt < -0.15) {
    return "true-ink-collision";
  }

  // 3) 글자 침범은 없으나(clearance >= -0.15pt) 여백 기준(thresholdPt)보다 가까운 경우:
  //    선분 끝점 바로 옆(<= 5.0pt)이고 선분 내부와는 떨어져 있으면 자연스러운 끝점 인접, 아니면 bbox-only-contact
  if (minEndDist <= 5.0 && clearancePt >= 0.5 && interiorClearance >= thresholdPt * 0.6) {
    return "natural-endpoint-proximity";
  }

  return "bbox-only-contact";
}

/**
 * 두 노드(라벨-라벨) 사이의 겹침 세부 유형 판정:
 * - 박스가 실제로 겹치면(gap <= 0pt) true-ink-collision
 * - 박스가 겹치지 않으나 여백 기준(mLabel) 미만이면(0 < gap < mLabel) bbox-only-contact
 */
export function classifyNodeNodeContactKindUnit3A(nodeA, nodeB, gapPt, thresholdPt) {
  if (gapPt <= 0.05) {
    return "true-ink-collision";
  }
  return "bbox-only-contact";
}

/**
 * [Unit 3-A] 단일 장면(scene)의 정밀 겹침 감사기
 * - Unit 2 의 확장 수식 매칭(assignStrokesUnit2)을 사용하여 함수 라벨의 소속 곡선(ownStroke)을 정확히 인식한다.
 * - 모든 접촉을 true-ink-collision / bbox-only-contact / natural-endpoint-proximity 로 분류한다.
 * - natural-endpoint-proximity 는 정상 배치이므로 실제 충돌 목록(effectiveCollisions)에서 제외하고
 *   별도 naturalEndpointContacts 배열로 분리 기록한다.
 */
export function auditSceneCollisionsUnit3A(scene, P = PARAMS, flags = DEFAULT_UNIT2_FLAGS) {
  if (!scene || !scene.ok) {
    return {
      ok: false,
      measurementComplete: false,
      allCollisions: [],
      trueInkCollisions: [],
      bboxOnlyContacts: [],
      naturalEndpointContacts: [],
      unmeasuredNodes: [],
      unverifiableItems: [{ reason: "장면(scene) 빌드 또는 SVG 측정 실패" }],
    };
  }

  resolveSceneSymbolicCoordinatesUnit3A(scene, flags);

  const strokes = Array.isArray(scene.strokes) ? scene.strokes : [];
  const nodes = Array.isArray(scene.nodes) ? scene.nodes : [];
  const fnTargets = nodes.filter((n) => n.role === "function" && n.bbox);
  const assigned = assignStrokesUnit2(scene, fnTargets, flags);

  const unmeasuredNodes = [];
  const unverifiableItems = [];
  for (const n of nodes) {
    if (n.role === "marker") continue;
    if (!n.bbox) {
      unmeasuredNodes.push({
        id: n.id,
        label: n.label,
        role: n.role,
        confidence: n.confidence,
        reason: "SVG 텍스트 bbox 측정값 없음",
      });
    }
  }

  const allCollisions = [];
  const trueInkCollisions = [];
  const bboxOnlyContacts = [];
  const naturalEndpointContacts = [];
  const functionLabelAudits = [];

  // 1) 함수식 라벨(role === "function") 검사
  for (const fnNode of fnTargets) {
    const asg = assigned.get(fnNode.id) || null;
    const ownStroke = asg && asg.stroke ? asg.stroke : null;
    const ownStrokeIdx = ownStroke ? ownStroke.index : null;
    const fnCollisions = [];

    if (!asg || !asg.confirmed) {
      unverifiableItems.push({
        type: "uncertain-measurement-or-match",
        nodeId: fnNode.id,
        nodeLabel: fnNode.label,
        how: asg ? asg.how : "unmatched",
        reason: asg ? asg.reason : "대응 곡선 미배정",
      });
    }

    for (const s of strokes) {
      if (!s || !Array.isArray(s.pts) || s.pts.length < 2) continue;
      // 동일 주기함수의 다른 가지(periodicBranches)도 자기 함수 소속으로 인정
      const isOwn =
        ownStrokeIdx !== null &&
        (s.index === ownStrokeIdx || (Array.isArray(asg?.periodicBranches) && asg.periodicBranches.includes(s.index)));
      const c = r2(minDistPolylines([rectPoly(fnNode.bbox)], [{ pts: s.pts, closed: false }]) - (s.halfWidth || 0.5));
      const threshold = isOwn ? P.cOwn : P.cHard;

      if (c < threshold) {
        const contactKind = classifyStrokeContactKindUnit3A(fnNode, s, isOwn, c, threshold);
        const strokeType = s.kind === "axis" ? "axis" : classifyStrokeKind(s);
        const item = {
          key: isOwn ? `fn-own:${fnNode.id}` : `fn-stroke:${fnNode.id}:s${s.index}`,
          category: isOwn
            ? "function-own-curve"
            : s.kind === "axis"
              ? "function-axis"
              : "function-other-curve",
          contactKind, // 'true-ink-collision' | 'bbox-only-contact' | 'natural-endpoint-proximity'
          severity: contactKind === "true-ink-collision" ? "collision" : contactKind === "bbox-only-contact" ? "warning" : "benign",
          autoMoveTarget: true,
          nodeId: fnNode.id,
          nodeLabel: fnNode.label,
          nodeRole: fnNode.role,
          targetType: s.kind === "axis" ? "axis" : isOwn ? "own-stroke" : "other-stroke",
          strokeIndex: s.index,
          strokeKind: strokeType,
          clearancePt: c,
          thresholdPt: threshold,
          description: isOwn
            ? `함수식 라벨(${fnNode.label})이 자기 곡선(#${s.index})과 접촉 (${c}pt, 유형=${contactKind})`
            : `함수식 라벨(${fnNode.label})이 ${s.kind === "axis" ? "축" : `다른 선/곡선(#${s.index})`}과 근접/접촉 (${c}pt < ${threshold}pt, 유형=${contactKind})`,
        };

        if (contactKind === "natural-endpoint-proximity") {
          naturalEndpointContacts.push(item);
        } else {
          fnCollisions.push(item);
          allCollisions.push(item);
          if (contactKind === "true-ink-collision") trueInkCollisions.push(item);
          else bboxOnlyContacts.push(item);
        }
      }
    }

    functionLabelAudits.push({
      id: fnNode.id,
      label: fnNode.label,
      usable: fnNode.usable,
      confidence: fnNode.confidence,
      assignmentHow: asg ? asg.how : "unmatched",
      confirmedAssignment: Boolean(asg && asg.confirmed),
      ownStrokeIndex: ownStrokeIdx,
      hasCollision: fnCollisions.length > 0,
      hasTrueInkCollision: fnCollisions.some((c) => c.contactKind === "true-ink-collision"),
      collisions: fnCollisions,
    });
  }

  // 2) 일반 노드(origin, axisLabel, vertex, other 눈금)와 곡선/보조선 사이의 실제 침범 검사
  const generalNodes = nodes.filter((n) => n.bbox && n.role !== "function" && n.role !== "marker");
  for (const gNode of generalNodes) {
    const inlineAxisIdx =
      gNode.role === "axisLabel" && gNode.kind === "inline" && gNode.stmt && gNode.stmt.path
        ? gNode.stmt.path.index
        : null;
    const inlineOwnStmtIdx =
      gNode.kind === "inline" && gNode.stmt && gNode.stmt.path ? gNode.stmt.path.index : null;

    for (const s of strokes) {
      if (!s || !Array.isArray(s.pts) || s.pts.length < 2) continue;
      if (inlineAxisIdx !== null && s.index === inlineAxisIdx) continue;
      if (gNode.role === "origin" && s.kind === "axis") continue;
      if (inlineOwnStmtIdx !== null && s.index === inlineOwnStmtIdx) continue;
      if (gNode.role === "other" && s.kind === "axis") continue;
      // 꼭짓점 라벨(vertex)이나 눈금(other)이 보조선 끝점에 붙어있는 경우 제외, 실제 메인 곡선/직선 침범만 감지
      if (gNode.role === "vertex" && s.stmt && s.stmt.optsRaw && /dashed/.test(s.stmt.optsRaw)) continue;

      const c = r2(minDistPolylines([rectPoly(gNode.bbox)], [{ pts: s.pts, closed: false }]) - (s.halfWidth || 0.5));
      if (c < -0.2) {
        const contactKind = classifyStrokeContactKindUnit3A(gNode, s, false, c, 0);
        if (contactKind === "natural-endpoint-proximity") {
          naturalEndpointContacts.push({
            key: `gen-stroke:${gNode.id}:s${s.index}`,
            category: "general-node-stroke",
            contactKind,
            nodeId: gNode.id,
            nodeLabel: gNode.label,
            nodeRole: gNode.role,
            strokeIndex: s.index,
            clearancePt: c,
          });
          continue;
        }
        const item = {
          key: `gen-stroke:${gNode.id}:s${s.index}`,
          category: "unmoved-general-node-overlap",
          contactKind: "true-ink-collision",
          severity: "warning",
          autoMoveTarget: false,
          nodeId: gNode.id,
          nodeLabel: gNode.label,
          nodeRole: gNode.role,
          targetType: s.kind === "axis" ? "axis" : "stroke",
          strokeIndex: s.index,
          strokeKind: s.kind === "axis" ? "axis" : classifyStrokeKind(s),
          clearancePt: c,
          thresholdPt: 0,
          description: `일반 노드(${gNode.label}, 역할=${gNode.role})가 ${s.kind === "axis" ? "축" : `선/곡선(#${s.index})`}과 실제 겹침 (${c}pt < 0pt)`,
        };
        allCollisions.push(item);
        trueInkCollisions.push(item);
      }
    }
  }

  // 3) 텍스트 노드 ↔ 텍스트 노드 간 겹침 검사
  const measurableNodes = nodes.filter((n) => n.bbox && n.role !== "marker");
  for (let i = 0; i < measurableNodes.length; i++) {
    for (let j = i + 1; j < measurableNodes.length; j++) {
      const a = measurableNodes[i];
      const b = measurableNodes[j];
      const involvesFunction = a.role === "function" || b.role === "function";
      const gap = r2(bboxGapRect(a.bbox, b.bbox));
      const threshold = involvesFunction ? P.mLabel : 0.0;

      if (involvesFunction ? gap < threshold : gap <= 0.0) {
        const primary = a.role === "function" ? a : b;
        const secondary = primary === a ? b : a;
        const pairKey = [a.id, b.id].sort().join("::");
        const contactKind = classifyNodeNodeContactKindUnit3A(primary, secondary, gap, threshold);
        const item = {
          key: `node-node:${pairKey}`,
          category: involvesFunction ? "label-label" : "unmoved-general-node-overlap",
          contactKind,
          severity: contactKind === "true-ink-collision" ? "collision" : "warning",
          autoMoveTarget: involvesFunction,
          nodeId: primary.id,
          nodeLabel: primary.label,
          nodeRole: primary.role,
          otherNodeId: secondary.id,
          otherNodeLabel: secondary.label,
          otherNodeRole: secondary.role,
          targetType: "node",
          clearancePt: gap,
          thresholdPt: threshold,
          description: `라벨(${primary.label})과 라벨(${secondary.label}) 간 ${contactKind === "true-ink-collision" ? "실제 글자 겹침" : "박스 여백 근접"} (${gap}pt < ${threshold}pt)`,
        };
        allCollisions.push(item);
        if (contactKind === "true-ink-collision") trueInkCollisions.push(item);
        else bboxOnlyContacts.push(item);
        if (primary.role === "function") {
          const fa = functionLabelAudits.find((f) => f.id === primary.id);
          if (fa) {
            fa.hasCollision = true;
            if (contactKind === "true-ink-collision") fa.hasTrueInkCollision = true;
            fa.collisions.push(item);
          }
        }
      }
    }
  }

  return {
    ok: true,
    measurementComplete: unmeasuredNodes.length === 0,
    allCollisions,
    trueInkCollisions,
    bboxOnlyContacts,
    naturalEndpointContacts,
    functionLabelAudits,
    unmeasuredNodes,
    unverifiableItems,
  };
}

/**
 * [Unit 3-A] 전후 장면 충돌 비교 및 7대 진단 범주 통합 리포터
 */
export function compareCollisionDiagnosticsUnit3A(origScene, finalScene, movedNodeIds = [], opts = {}) {
  const P = opts.params || PARAMS;
  const flags = opts.unit2Flags || DEFAULT_UNIT2_FLAGS;
  const axisChanged = Boolean(opts.axisChanged);
  const decisionsByNodeId = opts.decisionsByNodeId || new Map();

  const { origToCanon, finalToCanon } = buildCanonicalNodeMapUnit1(origScene, finalScene);

  const origAuditRaw = auditSceneCollisionsUnit3A(origScene, P, flags);
  const finalAuditRaw = auditSceneCollisionsUnit3A(finalScene, P, flags);

  const mapCanon = (item, idToCanon) => {
    const mapId = (rawId) => (rawId && idToCanon.has(rawId) ? idToCanon.get(rawId) : String(rawId || "").split("@")[0]);
    const cNodeId = mapId(item.nodeId);
    const cOtherId = item.otherNodeId ? mapId(item.otherNodeId) : null;
    let cKey = item.key;
    if (item.key.startsWith("fn-own:")) cKey = `fn-own:${cNodeId}`;
    else if (item.key.startsWith("fn-stroke:")) cKey = `fn-stroke:${cNodeId}:${item.key.split(":").slice(2).join(":")}`;
    else if (item.key.startsWith("gen-stroke:")) cKey = `gen-stroke:${cNodeId}:${item.key.split(":").slice(2).join(":")}`;
    else if (item.key.startsWith("node-node:")) cKey = `node-node:${[cNodeId, cOtherId || ""].sort().join("::")}`;
    return { ...item, rawKey: item.key, key: cKey, rawNodeId: item.nodeId, nodeId: cNodeId, rawOtherNodeId: item.otherNodeId || null, otherNodeId: cOtherId };
  };

  const origCollisions = origAuditRaw.allCollisions.map((c) => mapCanon(c, origToCanon));
  const finalCollisions = finalAuditRaw.allCollisions.map((c) => mapCanon(c, finalToCanon));

  const movedCanonSet = new Set(
    (movedNodeIds || []).map((id) => origToCanon.get(id) || finalToCanon.get(id) || String(id).split("@")[0])
  );

  const decisionsByCanonId = new Map();
  if (decisionsByNodeId instanceof Map) {
    for (const [k, v] of decisionsByNodeId.entries()) {
      const cid = origToCanon.get(k) || finalToCanon.get(k) || k;
      decisionsByCanonId.set(cid, v);
    }
  }

  const origByKey = new Map(origCollisions.map((c) => [c.key, c]));
  const finalByKey = new Map(finalCollisions.map((c) => [c.key, c]));

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
      });
    } else {
      const origClear = typeof origItem.clearancePt === "number" ? origItem.clearancePt : 0;
      const finalClear = typeof finalItem.clearancePt === "number" ? finalItem.clearancePt : 0;
      const worsened = (touchesMovedNode || touchesAxisAfterAxisChange) && finalClear < origClear - 0.5;
      if (worsened) {
        newlyIntroducedCollisions.push({
          ...finalItem,
          status: "newly-introduced",
          subStatus: "worsened",
          origClearancePt: origClear,
        });
      } else {
        const dec = decisionsByCanonId.get(finalItem.nodeId);
        let reasonCode = "pre-existing";
        if (finalItem.nodeRole !== "function") {
          reasonCode = "unmoved-general-node-overlap";
        } else if (dec && (dec.nonMoveCode === "uncertain-match" || dec.nonMoveCode === "parse-failure" || !dec.confirmed)) {
          reasonCode = "uncertain-measurement-or-match";
        } else {
          reasonCode = "held-no-safe-candidate";
        }
        preExistingUnresolvedCollisions.push({
          ...finalItem,
          status: "pre-existing",
          origClearancePt: origClear,
          reasonCode,
        });
      }
    }
  }

  const movedNodeHasCollision = finalAuditRaw.functionLabelAudits.some(
    (fa) => movedCanonSet.has(finalToCanon.get(fa.id) || String(fa.id).split("@")[0]) && fa.hasCollision
  );
  const safetyPassed = newlyIntroducedCollisions.length === 0 && !movedNodeHasCollision;

  return {
    safetyPassed,
    measurementComplete: finalAuditRaw.measurementComplete,
    allClear: safetyPassed && finalAuditRaw.measurementComplete && finalCollisions.length === 0,
    counts: {
      origTotal: origCollisions.length,
      origTrueInk: origAuditRaw.trueInkCollisions.length,
      origBboxOnly: origAuditRaw.bboxOnlyContacts.length,
      origNaturalEndpoint: origAuditRaw.naturalEndpointContacts.length,
      finalTotal: finalCollisions.length,
      finalTrueInk: finalAuditRaw.trueInkCollisions.length,
      finalBboxOnly: finalAuditRaw.bboxOnlyContacts.length,
      finalNaturalEndpoint: finalAuditRaw.naturalEndpointContacts.length,
      resolved: resolvedCollisions.length,
      preExistingUnresolved: preExistingUnresolvedCollisions.length,
      newlyIntroduced: newlyIntroducedCollisions.length,
      unmovedGeneralNodeOverlaps: preExistingUnresolvedCollisions.filter((c) => c.reasonCode === "unmoved-general-node-overlap").length,
      uncertainMeasurementOrMatch: finalAuditRaw.unverifiableItems.length,
    },
    resolvedCollisions,
    preExistingUnresolvedCollisions,
    newlyIntroducedCollisions,
    origAudit: origAuditRaw,
    finalAudit: finalAuditRaw,
  };
}
