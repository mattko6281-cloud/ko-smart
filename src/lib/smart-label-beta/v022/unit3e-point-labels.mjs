// ============================================================================
// KO-SMART 스마트 라벨 — Unit 3-E: 일반 노드 유형 A (점 마커 연결 대문자 점 이름) 겹침 자동 정렬 모듈
// ============================================================================
// 개발 원칙:
//  1) 기존 함수식 라벨(Unit 1 + Unit 2/2+ + Unit 3-C), 눈금 숫자(Unit 3-B), 원점 O(Unit 3-D),
//     4방향 축 연장(Axis 4-Dir) 알고리즘은 단 1줄도 수정하지 않는다.
//  2) 장면 내 모든 노드를 5개 역할군(유형 A ~ 유형 E)으로 정밀 분류하되,
//     자동 이동 대상은 오직 [유형 A: 점 마커(circle, fill=black)에 연결된 대문자 점 이름 A, B, C, P, Q 등]으로만
//     엄격히 제한한다.
//     - [유형 B] 점 마커 없는 도형 꼭짓점 라벨: 보수적 Hold (이동 금지)
//     - [유형 C] 영역 내부 라벨 (예: CASE-001 색칠 영역 내부 A, B): 100% 보호 (이동 금지)
//     - [유형 D] 축 눈금 및 소문자 라벨 ($a, b, c, d, e$, $7, c\pi$, 직선 $l, m$): 분리/보호 (이동 금지)
//     - [유형 E] 함수식 라벨, 원점 O, 축 이름 x/y: 100% 보호 및 장애물 등록
//  3) 점 마커 자체의 좌표나 도형/곡선/보조선 좌표는 절대 수정하지 않으며,
//     오직 유형 A 텍스트 노드의 `xshift`, `yshift`만 최소 조정한다.
//  4) 이미 충돌이 없고 마커 거리(2.0~9.5pt)가 자연스러운 유형 A 점 이름은 절대 이동하지 않는다(Hold).
//  5) 충돌이 감지된 유형 A 점 이름에 대해서만 평가원 스타일 8방향 앵커 + 열린 외각(Open Sector) +
//     10대 기준 및 인쇄 가독성 병목 보호(minAll >= 1.35pt 선호)를 결합한 Candidate C 자연 배치를 수행한다.
//  6) 안전한 후보가 없으면 억지로 이동하지 않고 원본 위치를 유지한다.
// ============================================================================

import { minDistPolylines } from "../../../../experiments/smart-label-engine/src/geometry.mjs";
import {
  PARAMS,
  bboxGapRect,
  bboxPtDist,
  bboxFromShift,
  computeShiftForMove,
  setShifts,
} from "../../../../experiments/smart-label-prototype-v021/src/algorithm.mjs";
import { DEFAULT_UNIT2_FLAGS } from "./unit2-expression-matching.mjs";
import { resolveSceneSymbolicCoordinatesUnit3A } from "./unit3a-overlap-diagnostics.mjs";
import { isPureTickValueLabel } from "./unit3b-ticks.mjs";

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

export const DEFAULT_UNIT3E_POINT_LABEL_PARAMS = {
  // 마커 매칭 및 거리 기준 (TeX pt)
  maxMarkerCoordMatchDistPt: 2.0,     // 노드의 기준 좌표(at)와 점 마커 중심 간 최대 허용 매칭 거리
  maxOrigMarkerBboxDistPt: 15.0,      // 원본 라벨 bbox와 점 마커 중심 간 최대 허용 거리 (초과 시 별개 라벨로 간주하여 보류)
  minAllowedMarkerGapPt: 2.2,         // 이동 후보 bbox와 점 마커 중심 간 최소 허용 거리
  maxAllowedMarkerGapPt: 9.5,         // 이동 후보 bbox와 점 마커 중심 간 최대 허용 거리 (점 소속감 유지 상한)
  idealMarkerGapMinPt: 3.5,           // 평가원 스타일 이상적 마커~라벨 간격 하한
  idealMarkerGapMaxPt: 6.8,           // 평가원 스타일 이상적 마커~라벨 간격 상한

  // 충돌 판정 임계값 (원본 유지 가능성 게이트)
  triggerStrokeOverlapPt: -0.20,      // 이 값 미만일 때 실제 곡선/직선/보조선 글자 획 침범으로 판정
  triggerAxisOverlapPt: -0.15,        // 이 값 미만일 때 실제 좌표축 침범으로 판정
  triggerNodeOverlapPt: 0.20,         // 이 값 이하일 때 타 라벨과 겹침으로 판정

  // 이동 후보 안전 기준
  minSafeMainStrokePt: 0.80,          // 이동 후보가 실선 곡선/직선과 확보해야 할 최소 간격 (Candidate C)
  minSafeMainStrokeMinMovePt: 0.45,   // 폴백 최소 이동(Candidate B)이 확보해야 할 최소 실선 간격
  minSafeAuxStrokePt: 0.50,           // 이동 후보가 점선/보조선과 확보해야 할 최소 간격
  minSafeAxisPt: 0.85,                // 이동 후보가 좌표축과 확보해야 할 최소 간격
  minSafeNodeGapPt: 2.0,              // 이동 후보가 타 일반 라벨과 확보해야 할 최소 간격
  minSafeProtectedNodeGapPt: 2.5,     // 이동 후보가 함수식 라벨/원점 O/축 이름과 확보해야 할 최소 간격
};

/**
 * 8방향 표준 앵커 정의 (단위 방향 벡터 및 각도, 평가원 기출 대각 사분면 선호 가중치)
 */
export const KICE_8_DIRECTIONS_UNIT3E = [
  { name: "above left",  ux: -Math.SQRT1_2, uy:  Math.SQRT1_2, angleDeg: 135, isDiagonal: true,  kicePrefBonus: 3.5 },
  { name: "above right", ux:  Math.SQRT1_2, uy:  Math.SQRT1_2, angleDeg:  45, isDiagonal: true,  kicePrefBonus: 3.5 },
  { name: "below left",  ux: -Math.SQRT1_2, uy: -Math.SQRT1_2, angleDeg: -135, isDiagonal: true, kicePrefBonus: 3.5 },
  { name: "below right", ux:  Math.SQRT1_2, uy: -Math.SQRT1_2, angleDeg: -45, isDiagonal: true,  kicePrefBonus: 3.5 },
  { name: "above",       ux:  0,            uy:  1,            angleDeg:  90, isDiagonal: false, kicePrefBonus: 2.2 },
  { name: "below",       ux:  0,            uy: -1,            angleDeg: -90, isDiagonal: false, kicePrefBonus: 2.0 },
  { name: "left",        ux: -1,            uy:  0,            angleDeg: 180, isDiagonal: false, kicePrefBonus: 1.8 },
  { name: "right",       ux:  1,            uy:  0,            angleDeg:   0, isDiagonal: false, kicePrefBonus: 1.8 },
];

/**
 * 라벨 문자열을 정규화하여 대문자 점 이름(A~Z, A_1, P' 등)인지, 소문자 기호(a, b, c, l, m 등)인지 판별한다.
 */
export function parseGeneralLabelSymbolUnit3E(labelRaw) {
  const raw = String(labelRaw || "").trim();
  const stripped = raw
    .replace(/\$/g, "")
    .replace(/\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle|rm|bf|it|normalfont|mathrm|mathbf|mathit)\b/g, "")
    .replace(/[{}]/g, "")
    .trim();

  // 대문자 점 이름: A~Z (단, O는 원점 전용이므로 별도 구분), 아래첨자 숫자(A_1) 또는 프라임(P') 허용
  const upperPointMatch = /^([A-Z])(?:_?(\d+)|('+))?$/.exec(stripped);
  if (upperPointMatch) {
    const baseLetter = upperPointMatch[1];
    return {
      clean: stripped,
      isUppercaseLetter: true,
      isOriginLetterO: baseLetter === "O" && !upperPointMatch[2] && !upperPointMatch[3],
      baseLetter,
      isLowercaseSymbol: false,
    };
  }

  // 소문자 단일 문자 또는 그리스 소문자 (a, b, c, d, e, k, l, m, \alpha, \beta, \theta 등)
  const lowerMatch = /^([a-z]|\\(?:alpha|beta|gamma|theta|pi|phi|omega))(?:\s*\\pi)?$/.exec(stripped);
  if (lowerMatch) {
    return {
      clean: stripped,
      isUppercaseLetter: false,
      isOriginLetterO: false,
      baseLetter: null,
      isLowercaseSymbol: true,
    };
  }

  return {
    clean: stripped,
    isUppercaseLetter: false,
    isOriginLetterO: false,
    baseLetter: null,
    isLowercaseSymbol: false,
  };
}

/**
 * 노드 옵션 문자열에서 TikZ 8방향 키워드를 추출한다.
 */
export function extractNodeDirectionOptionUnit3E(optionsRaw) {
  if (typeof optionsRaw !== "string" || !optionsRaw.trim()) return null;
  const s = optionsRaw.replace(/\s+/g, " ");
  const m = /\b(above left|above right|below left|below right|above|below|left|right)\b/.exec(s);
  return m ? m[1] : null;
}

/**
 * 장면 내 \fill / \filldraw 영역 존재 여부를 추출한다.
 */
function extractFilledRegionHints(scene) {
  const body = String(scene?.body || "");
  const fillMatches = body.match(/\\(?:fill|filldraw)\b[^;]*;/g) || [];
  return {
    hasFilledRegions: fillMatches.length > 0,
    fillCount: fillMatches.length,
    fillStatements: fillMatches,
  };
}

/**
 * 마커 없는 다각형/꺾은선 꼭짓점(vertex corner) 근처인지 검사한다.
 */
function findNearbyPolygonVertex(pt, scene, maxDistPt = 2.5) {
  if (!Array.isArray(pt) || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) {
    return { found: false };
  }
  const [px, py] = pt;
  const incidentDirs = [];

  for (const s of scene?.strokes || []) {
    if (!s || s.kind === "axis" || !Array.isArray(s.pts) || s.pts.length < 2) continue;
    const isPlot = s.stmt?.type === "plot";
    if (isPlot) continue;

    for (let i = 0; i < s.pts.length; i++) {
      const [vx, vy] = s.pts[i];
      if (Math.hypot(vx - px, vy - py) <= maxDistPt) {
        if (i > 0) {
          const [nx, ny] = s.pts[i - 1];
          if (Math.hypot(nx - vx, ny - vy) > 1.0) {
            incidentDirs.push(Math.atan2(ny - vy, nx - vx) * (180 / Math.PI));
          }
        }
        if (i + 1 < s.pts.length) {
          const [nx, ny] = s.pts[i + 1];
          if (Math.hypot(nx - vx, ny - vy) > 1.0) {
            incidentDirs.push(Math.atan2(ny - vy, nx - vx) * (180 / Math.PI));
          }
        }
      }
    }
  }

  if (incidentDirs.length >= 2) {
    return {
      found: true,
      incidentSegmentCount: incidentDirs.length,
      incidentAnglesDeg: incidentDirs.map(r2),
    };
  }
  return { found: false };
}

/**
 * 노드의 해석된 기준 좌표(pt)를 반환한다.
 */
export function getResolvedNodeAnchorPtUnit3E(node) {
  if (Array.isArray(node?.at) && Number.isFinite(node.at[0]) && Number.isFinite(node.at[1])) {
    return { pt: node.at, by: "numeric-at" };
  }
  if (
    Array.isArray(node?.resolvedAtPt) &&
    Number.isFinite(node.resolvedAtPt[0]) &&
    Number.isFinite(node.resolvedAtPt[1])
  ) {
    return { pt: node.resolvedAtPt, by: node.resolvedAtBy || "resolved-at" };
  }
  if (
    Array.isArray(node?.inlineAnchor) &&
    Number.isFinite(node.inlineAnchor[0]) &&
    Number.isFinite(node.inlineAnchor[1])
  ) {
    return { pt: node.inlineAnchor, by: "inline-anchor" };
  }
  return { pt: null, by: "unresolved" };
}

/**
 * 장면 내 모든 노드를 5개 역할군(유형 A ~ 유형 E)으로 정밀 분류한다.
 * - 오직 TYPE_A_MARKER_POINT_LABEL (eligibleForTypeAMove === true)만 Unit 3-E 자동 이동 대상이 된다.
 */
export function classifyGeneralNodes5RolesUnit3E(
  scene,
  nodeBoxesById = null,
  cfg = DEFAULT_UNIT3E_POINT_LABEL_PARAMS
) {
  if (!scene || !Array.isArray(scene.nodes)) {
    return { classifications: [], byNodeId: new Map(), summaryCounts: {} };
  }

  resolveSceneSymbolicCoordinatesUnit3A(scene, DEFAULT_UNIT2_FLAGS);

  const fillHints = extractFilledRegionHints(scene);
  const markers = scene.nodes.filter((n) => n.role === "marker");
  const resolvedMarkers = markers
    .map((m) => {
      const { pt } = getResolvedNodeAnchorPtUnit3E(m);
      const center =
        pt ||
        (m.bbox
          ? [(m.bbox.x0 + m.bbox.x1) / 2, (m.bbox.y0 + m.bbox.y1) / 2]
          : null);
      return { marker: m, center };
    })
    .filter((m) => Array.isArray(m.center));

  const classifications = [];
  const byNodeId = new Map();
  const summaryCounts = {
    TYPE_A_MARKER_POINT_LABEL: 0,
    TYPE_B_VERTEX_NO_MARKER: 0,
    TYPE_C_REGION_INTERIOR: 0,
    TYPE_D_AXIS_TICK_OR_LOWER: 0,
    TYPE_E_PROTECTED_SPECIAL: 0,
    MARKER_DOT: 0,
  };

  const { xU = 28.45, yU = 28.45 } = scene.units || {};

  for (const n of scene.nodes) {
    if (n.role === "marker") {
      const item = {
        id: n.id,
        label: "",
        role: n.role,
        kind: n.kind,
        category: "MARKER_DOT",
        subCategory: "point-marker",
        eligibleForTypeAMove: false,
        policy: "IMMUTABLE_MARKER",
        reason: "점 마커 자체(절대 이동 금지, 중심 좌표 기준점)",
      };
      classifications.push(item);
      byNodeId.set(n.id, item);
      summaryCounts.MARKER_DOT++;
      continue;
    }

    // [유형 E] 함수식 라벨, 원점 O, 축 이름(x, y)
    if (n.role === "function" || n.role === "origin" || n.role === "axisLabel") {
      const subCat =
        n.role === "function"
          ? "E-1:function-label"
          : n.role === "origin"
            ? "E-2:origin-O"
            : "E-3:axis-label";
      const item = {
        id: n.id,
        label: n.label,
        role: n.role,
        kind: n.kind,
        category: "TYPE_E_PROTECTED_SPECIAL",
        subCategory: subCat,
        eligibleForTypeAMove: false,
        policy: "STRICT_PROTECT_AND_OBSTACLE",
        reason:
          n.role === "function"
            ? "함수식/방정식 라벨(Unit 2 / Type 2 전담 보호)"
            : n.role === "origin"
              ? "원점 O(Unit 3-D 4방향 사분면 규칙 전담 보호)"
              : "좌표축 끝 라벨 x/y(고정 보호)",
      };
      classifications.push(item);
      byNodeId.set(n.id, item);
      summaryCounts.TYPE_E_PROTECTED_SPECIAL++;
      continue;
    }

    // role === "other" 일반 노드 세분화 (유형 A, B, C, D)
    const sym = parseGeneralLabelSymbolUnit3E(n.label);
    const { pt: anchorPt, by: anchorBy } = getResolvedNodeAnchorPtUnit3E(n);
    const dirOpt = extractNodeDirectionOptionUnit3E(n.optionsRaw);

    // 1) 숫자/π 순수 눈금인지 확인 -> [유형 D-1]
    // (주의: isPureTickValueLabel 내부에서 \pi를 'P'로 치환하므로, 대문자 점 이름 P가 오인되지 않도록 !sym.isUppercaseLetter 선행 검사)
    if (!sym.isUppercaseLetter && isPureTickValueLabel(n.label)) {
      const item = {
        id: n.id,
        label: n.label,
        role: n.role,
        kind: n.kind,
        category: "TYPE_D_AXIS_TICK_OR_LOWER",
        subCategory: "D-1:numeric-or-pi-tick",
        eligibleForTypeAMove: false,
        policy: "DELEGATED_TO_UNIT3B_TICKS",
        anchorPt,
        reason: "순수 숫자/π 눈금 라벨 (기존 Unit 3-B 눈금 전용 엔진 관할)",
      };
      classifications.push(item);
      byNodeId.set(n.id, item);
      summaryCounts.TYPE_D_AXIS_TICK_OR_LOWER++;
      continue;
    }

    // 2) 소문자/기호 라벨 또는 인라인 축 눈금 (예: CASE-010 $a, b, c, d, e$, CASE-005 $c\pi$, 직선 $l, m$) -> [유형 D-2 / D-3]
    if (!sym.isUppercaseLetter) {
      const onXAxis =
        anchorPt && scene?.axes?.x && Math.abs(anchorPt[1]) <= 6.5 && Math.abs(anchorPt[0]) >= 4.0;
      const onYAxis =
        anchorPt && scene?.axes?.y && Math.abs(anchorPt[0]) <= 6.5 && Math.abs(anchorPt[1]) >= 4.0;
      const isAxisSymbolicTick = Boolean(onXAxis || onYAxis || n.kind === "inline");
      const subCat = isAxisSymbolicTick ? "D-2:symbolic-or-inline-axis-tick" : "D-3:lowercase-symbol-or-line-name";
      const item = {
        id: n.id,
        label: n.label,
        role: n.role,
        kind: n.kind,
        category: "TYPE_D_AXIS_TICK_OR_LOWER",
        subCategory: subCat,
        eligibleForTypeAMove: false,
        policy: "HOLD_SEPARATE_AXIS_TICK_POLICY",
        anchorPt,
        onAxis: onXAxis ? "x" : onYAxis ? "y" : null,
        reason: isAxisSymbolicTick
          ? `축 귀속 문자형/인라인 눈금(${sym.clean}) — 대문자 점 이름(유형 A)과 엄격 분리하여 보류`
          : `소문자/기호 라벨(${sym.clean}) — 점 이름이 아니므로 보류`,
      };
      classifications.push(item);
      byNodeId.set(n.id, item);
      summaryCounts.TYPE_D_AXIS_TICK_OR_LOWER++;
      continue;
    }

    // 3) 대문자 원점 O가 role==="other"로 들어온 예외 방어 -> [유형 E]
    if (sym.isOriginLetterO) {
      const item = {
        id: n.id,
        label: n.label,
        role: n.role,
        kind: n.kind,
        category: "TYPE_E_PROTECTED_SPECIAL",
        subCategory: "E-2:origin-O-fallback",
        eligibleForTypeAMove: false,
        policy: "STRICT_PROTECT_AND_OBSTACLE",
        anchorPt,
        reason: "원점 문자 O 보호",
      };
      classifications.push(item);
      byNodeId.set(n.id, item);
      summaryCounts.TYPE_E_PROTECTED_SPECIAL++;
      continue;
    }

    // 4) 대문자(A~Z, O 제외): 점 마커(role === "marker")와 연결되어 있는지 검사
    let matchedMarker = null;
    let minMarkerCoordDist = Infinity;
    if (anchorPt) {
      for (const rm of resolvedMarkers) {
        const d = Math.hypot(rm.center[0] - anchorPt[0], rm.center[1] - anchorPt[1]);
        if (d < minMarkerCoordDist) {
          minMarkerCoordDist = d;
          matchedMarker = rm;
        }
      }
    }

    const hasMatchedMarker =
      matchedMarker !== null && minMarkerCoordDist <= cfg.maxMarkerCoordMatchDistPt;

    const effBox = (nodeBoxesById && nodeBoxesById.get(n.id)) || n.bbox;
    if (hasMatchedMarker && n.kind === "standalone" && effBox) {
      const markerCenterPt = matchedMarker.center;
      const origMarkerBboxDistPt = r2(bboxPtDist(markerCenterPt, effBox));

      // 부정 사례 5 방어: 점 마커와 좌표는 공유하나 라벨 bbox가 비정상적으로 멀리 떨어진 경우
      if (origMarkerBboxDistPt > cfg.maxOrigMarkerBboxDistPt) {
        const item = {
          id: n.id,
          label: n.label,
          cleanLabel: sym.clean,
          role: n.role,
          kind: n.kind,
          category: "TYPE_A_MARKER_POINT_LABEL",
          subCategory: "A-far-from-marker-hold",
          eligibleForTypeAMove: false,
          policy: "HOLD_ABNORMAL_MARKER_DISTANCE",
          anchorPt,
          markerCenterPt,
          origMarkerBboxDistPt,
          dirOption: dirOpt,
          reason: `점 마커와 ${origMarkerBboxDistPt}pt(> ${cfg.maxOrigMarkerBboxDistPt}pt) 떨어져 있어 점 소속감 보호를 위해 자동 이동 보류`,
        };
        classifications.push(item);
        byNodeId.set(n.id, item);
        summaryCounts.TYPE_A_MARKER_POINT_LABEL++;
        continue;
      }

      const item = {
        id: n.id,
        label: n.label,
        cleanLabel: sym.clean,
        role: n.role,
        kind: n.kind,
        category: "TYPE_A_MARKER_POINT_LABEL",
        subCategory: "A-standard-marker-point",
        eligibleForTypeAMove: true,
        policy: "ACTIVE_TYPE_A_OPTIMIZATION",
        anchorPt,
        anchorBy,
        markerId: matchedMarker.marker.id,
        markerCenterPt,
        markerCoordMatchDistPt: r2(minMarkerCoordDist),
        origMarkerBboxDistPt,
        dirOption: dirOpt,
        coordTikz: [r2(markerCenterPt[0] / xU), r2(markerCenterPt[1] / yU)],
        reason: `점 마커(${matchedMarker.marker.id}, 거리 ${r2(minMarkerCoordDist)}pt)에 연결된 대문자 점 이름(${sym.clean})`,
      };
      classifications.push(item);
      byNodeId.set(n.id, item);
      summaryCounts.TYPE_A_MARKER_POINT_LABEL++;
      continue;
    }

    // 5) 점 마커가 없는 대문자 라벨: [유형 B] 도형 꼭짓점 이름 vs [유형 C] 영역 내부 라벨 판별
    const vertexInfo = findNearbyPolygonVertex(anchorPt, scene, 2.5);
    if (vertexInfo.found && dirOpt) {
      const item = {
        id: n.id,
        label: n.label,
        cleanLabel: sym.clean,
        role: n.role,
        kind: n.kind,
        category: "TYPE_B_VERTEX_NO_MARKER",
        subCategory: "B-polygon-vertex-label",
        eligibleForTypeAMove: false,
        policy: "HOLD_CONSERVATIVE_NO_MARKER_VERTEX",
        anchorPt,
        dirOption: dirOpt,
        vertexInfo,
        reason: `점 마커 없는 도형 꼭짓점 라벨(${sym.clean}, 인접 선분 ${vertexInfo.incidentSegmentCount}개) — 보수적 Hold 정책 적용`,
      };
      classifications.push(item);
      byNodeId.set(n.id, item);
      summaryCounts.TYPE_B_VERTEX_NO_MARKER++;
      continue;
    }

    // 6) 그 외 점 마커도 없고 꼭짓점도 아닌 대문자 라벨 -> [유형 C] 영역 내부 라벨 (예: CASE-001 A, B)
    const item = {
      id: n.id,
      label: n.label,
      cleanLabel: sym.clean,
      role: n.role,
      kind: n.kind,
      category: "TYPE_C_REGION_INTERIOR",
      subCategory: fillHints.hasFilledRegions
        ? "C-1:shaded-region-interior-label"
        : "C-2:standalone-region-or-free-uppercase-label",
      eligibleForTypeAMove: false,
      policy: "STRICT_HOLD_REGION_INTERIOR",
      anchorPt,
      dirOption: dirOpt,
      hasFilledRegions: fillHints.hasFilledRegions,
      reason: fillHints.hasFilledRegions
        ? `색칠 영역(\\fill) 내부 이름 라벨(${sym.clean}) — 점 이름(유형 A)으로 오인하지 않고 영역 내부에 100% 고정 보호`
        : `점 마커 및 꼭짓점 연결이 없는 독립 대문자 라벨(${sym.clean}) — 오분류 방지를 위해 원본 위치 고정(Hold)`,
    };
    classifications.push(item);
    byNodeId.set(n.id, item);
    summaryCounts.TYPE_C_REGION_INTERIOR++;
  }

  return {
    classifications,
    byNodeId,
    summaryCounts,
    fillHints,
  };
}

/**
 * 함수식(Unit 2), 끝점 연장(Unit 3-C), 눈금(Unit 3-B), 원점 O(Unit 3-D), 축 연장까지 모두 반영된
 * 유효 장면 상태(strokesEff, nodeBoxesById, axesEff)를 구성한다.
 */
function buildEffectiveSceneStateBeforeTypeAUnit3E(
  scene,
  fnPlan,
  fnShiftResult,
  axisEditsToApply = [],
  tickPlan = null,
  originPlan = null
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

  const nodeBoxesById = new Map();
  for (const n of scene.nodes || []) {
    if (!n || !n.bbox || n.role === "marker") continue;
    if (originMovedBoxById.has(n.id)) {
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
 * 특정 바운딩 박스(bb)의 곡선·보조선·축·타 라벨·마커와의 정밀 여유 간격을 계산한다.
 */
export function evaluateTypeABoxClearancesUnit3E(nodeId, markerId, bb, scene, nodeBoxesById) {
  const poly = [rectPoly(bb)];
  let minMainStrokeClearance = Infinity;
  let minAuxStrokeClearance = Infinity;
  let minAxisClearance = Infinity;
  const collidingStrokes = [];

  for (const s of scene.strokes || []) {
    if (!s || !Array.isArray(s.pts) || s.pts.length < 2) continue;
    const isDashed = /dashed|dotted/.test(s.stmt?.raw || "");
    const hw = s.halfWidth || (s.kind === "axis" ? 0.5 : isDashed ? 0.4 : 0.75);
    const c = minDistPolylines(poly, [{ pts: s.pts, closed: false }]) - hw;

    if (s.kind === "axis") {
      if (c < minAxisClearance) minAxisClearance = c;
      if (c < -0.15) {
        collidingStrokes.push({ index: s.index, kind: "axis", clearancePt: r2(c) });
      }
    } else if (isDashed) {
      if (c < minAuxStrokeClearance) minAuxStrokeClearance = c;
      if (c < -0.20) {
        collidingStrokes.push({ index: s.index, kind: "dashed-aux", clearancePt: r2(c) });
      }
    } else {
      if (c < minMainStrokeClearance) minMainStrokeClearance = c;
      if (c < -0.20) {
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
      if (other.id !== markerId && other.bbox) {
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

  const minOverallStrokeClearance = Math.min(minMainStrokeClearance, minAuxStrokeClearance);

  return {
    minMainStrokeClearance: r2(minMainStrokeClearance),
    minAuxStrokeClearance: r2(minAuxStrokeClearance),
    minOverallStrokeClearance: r2(minOverallStrokeClearance),
    minAxisClearance: r2(minAxisClearance),
    minNodeGap: r2(minNodeGap),
    minProtectedNodeGap: r2(minProtectedNodeGap),
    collidingStrokes,
    collidingNodes,
  };
}

/**
 * 점 마커(markerCenterPt) 주변을 지나는 모든 곡선/직선/보조선/축의 접선 방사 각도(ray angles, -180~180도)를 추출한다.
 */
export function analyzeMarkerLocalSectorGeometryUnit3E(markerCenterPt, scene, radiusPt = 14.0) {
  const [mx, my] = markerCenterPt;
  const rayAnglesDeg = [];

  for (const s of scene.strokes || []) {
    if (!s || !Array.isArray(s.pts) || s.pts.length < 2) continue;
    for (let i = 0; i < s.pts.length - 1; i++) {
      const p0 = s.pts[i];
      const p1 = s.pts[i + 1];
      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((mx - p0[0]) * dx + (my - p0[1]) * dy) / lenSq));
      const cx = p0[0] + t * dx;
      const cy = p0[1] + t * dy;
      const dist = Math.hypot(cx - mx, cy - my);
      if (dist <= 6.5) {
        if (Math.hypot(p0[0] - mx, p0[1] - my) > 1.5) {
          rayAnglesDeg.push(Math.atan2(p0[1] - my, p0[0] - mx) * (180 / Math.PI));
        }
        if (Math.hypot(p1[0] - mx, p1[1] - my) > 1.5) {
          rayAnglesDeg.push(Math.atan2(p1[1] - my, p1[0] - mx) * (180 / Math.PI));
        }
      } else if (dist <= radiusPt) {
        rayAnglesDeg.push(Math.atan2(cy - my, cx - mx) * (180 / Math.PI));
      }
    }
  }

  const sorted = [...rayAnglesDeg].sort((a, b) => a - b);
  const uniqueRays = [];
  for (const a of sorted) {
    if (uniqueRays.length === 0 || Math.abs(a - uniqueRays[uniqueRays.length - 1]) > 8.0) {
      uniqueRays.push(a);
    }
  }

  return {
    rayAnglesDeg: uniqueRays.map(r2),
  };
}

function computeAngularClearanceDeg(candAngleDeg, rayAnglesDeg) {
  if (!Array.isArray(rayAnglesDeg) || rayAnglesDeg.length === 0) return 90.0;
  let minDiff = 180.0;
  for (const r of rayAnglesDeg) {
    let diff = Math.abs(candAngleDeg - r) % 360;
    if (diff > 180) diff = 360 - diff;
    if (diff < minDiff) minDiff = diff;
  }
  return r2(minDiff);
}

/**
 * 8방향 기준점과 이산 시프트 격자로부터 Type A 노드의 후보 바운딩 박스 목록을 생성한다.
 */
function generateTypeACandidatesForNode(node, typeAInfo, cfg = DEFAULT_UNIT3E_POINT_LABEL_PARAMS) {
  const [mx, my] = typeAInfo.markerCenterPt;
  const w = node.bbox.x1 - node.bbox.x0;
  const h = node.bbox.y1 - node.bbox.y0;
  const ox = node.xshift || 0;
  const oy = node.yshift || 0;

  const seenShiftKeys = new Set();
  const candidates = [];

  const typeAShiftParams = { ...PARAMS, shiftRound: 0.5 };
  const addByTargetBbox = (targetBb, metaDirection, sourceTag) => {
    const sh = computeShiftForMove(node, targetBb, typeAShiftParams);
    const nxRaw = r2(sh.newShift[0]);
    const nyRaw = r2(sh.newShift[1]);
    const nx = Object.is(nxRaw, -0) ? 0 : nxRaw;
    const ny = Object.is(nyRaw, -0) ? 0 : nyRaw;
    const key = `${nx},${ny}`;
    if (seenShiftKeys.has(key)) return;
    seenShiftKeys.add(key);

    const bb = sh.actualBbox;
    const cx = (bb.x0 + bb.x1) / 2;
    const cy = (bb.y0 + bb.y1) / 2;
    const angleDeg = Math.atan2(cy - my, cx - mx) * (180 / Math.PI);
    const markerGapPt = r2(bboxPtDist([mx, my], bb));
    const moveDistPt = r2(Math.hypot(sh.actualMovePt[0], sh.actualMovePt[1]));

    let bestDir = KICE_8_DIRECTIONS_UNIT3E[0];
    let minAngleErr = 180;
    for (const d of KICE_8_DIRECTIONS_UNIT3E) {
      let err = Math.abs(angleDeg - d.angleDeg) % 360;
      if (err > 180) err = 360 - err;
      if (err < minAngleErr) {
        minAngleErr = err;
        bestDir = d;
      }
    }

    candidates.push({
      shift: [nx, ny],
      deltaShift: [nx - ox, ny - oy],
      actualMovePt: sh.actualMovePt,
      moveDistPt,
      bbox: bb,
      markerGapPt,
      angleDeg: r2(angleDeg),
      nearestDir: metaDirection || bestDir.name,
      nearestDirObj: bestDir,
      dirAlignErrorDeg: r2(minAngleErr),
      sourceTag,
    });
  };

  // 1) 8방향 표준 앵커 × 정규화 거리(2.4pt ~ 8.6pt) 후보 생성
  const radialGaps = [2.4, 3.0, 3.6, 4.2, 4.8, 5.5, 6.2, 7.0, 7.8, 8.6];
  for (const dir of KICE_8_DIRECTIONS_UNIT3E) {
    for (const gap of radialGaps) {
      let rawBb;
      if (dir.name === "above left") {
        const d = gap / Math.SQRT2;
        rawBb = { x0: mx - d - w, x1: mx - d, y0: my + d, y1: my + d + h };
      } else if (dir.name === "above right") {
        const d = gap / Math.SQRT2;
        rawBb = { x0: mx + d, x1: mx + d + w, y0: my + d, y1: my + d + h };
      } else if (dir.name === "below left") {
        const d = gap / Math.SQRT2;
        rawBb = { x0: mx - d - w, x1: mx - d, y0: my - d - h, y1: my - d };
      } else if (dir.name === "below right") {
        const d = gap / Math.SQRT2;
        rawBb = { x0: mx + d, x1: mx + d + w, y0: my - d - h, y1: my - d };
      } else if (dir.name === "above") {
        for (const xOff of [0, -2.2, 2.2, -4.0, 4.0]) {
          addByTargetBbox(
            { x0: mx - w / 2 + xOff, x1: mx + w / 2 + xOff, y0: my + gap, y1: my + gap + h },
            "above",
            "8dir-cardinal"
          );
        }
        continue;
      } else if (dir.name === "below") {
        for (const xOff of [0, -2.2, 2.2, -4.0, 4.0]) {
          addByTargetBbox(
            { x0: mx - w / 2 + xOff, x1: mx + w / 2 + xOff, y0: my - gap - h, y1: my - gap },
            "below",
            "8dir-cardinal"
          );
        }
        continue;
      } else if (dir.name === "left") {
        for (const yOff of [0, -2.2, 2.2]) {
          addByTargetBbox(
            { x0: mx - gap - w, x1: mx - gap, y0: my - h / 2 + yOff, y1: my + h / 2 + yOff },
            "left",
            "8dir-cardinal"
          );
        }
        continue;
      } else if (dir.name === "right") {
        for (const yOff of [0, -2.2, 2.2]) {
          addByTargetBbox(
            { x0: mx + gap, x1: mx + gap + w, y0: my - h / 2 + yOff, y1: my + h / 2 + yOff },
            "right",
            "8dir-cardinal"
          );
        }
        continue;
      }
      addByTargetBbox(rawBb, dir.name, "8dir-diagonal");
    }
  }

  // 2) 현재 위치 주변의 정밀 0.5pt shift 격자 후보 추가
  for (let dx = -6; dx <= 6; dx += 0.5) {
    for (let dy = -6; dy <= 6; dy += 0.5) {
      const nx = r2(ox + dx);
      const ny = r2(oy + dy);
      const key = `${nx},${ny}`;
      if (seenShiftKeys.has(key)) continue;
      const bb = bboxFromShift(node, [nx, ny]);
      addByTargetBbox(bb, null, "local-shift-grid");
    }
  }

  return candidates;
}

/**
 * 평가원 스타일 10대 기준 및 인쇄 가독성 병목 보호(minAll >= 1.35pt 선호)에 따른 후보 점수 평가
 */
function scoreCandidateForTypeA(
  cand,
  node,
  typeAInfo,
  clr,
  sectorGeom,
  scene,
  cfg = DEFAULT_UNIT3E_POINT_LABEL_PARAMS
) {
  if (cand.markerGapPt < cfg.minAllowedMarkerGapPt || cand.markerGapPt > cfg.maxAllowedMarkerGapPt) {
    return {
      feasibleB: false,
      feasibleC: false,
      rejectReason: `marker-gap-out-of-range(${cand.markerGapPt}pt)`,
    };
  }

  if (clr.minNodeGap < cfg.minSafeNodeGapPt || clr.minProtectedNodeGap < cfg.minSafeProtectedNodeGapPt) {
    return {
      feasibleB: false,
      feasibleC: false,
      rejectReason: `node-gap-violation(minNode=${clr.minNodeGap}pt)`,
    };
  }

  if (clr.minAuxStrokeClearance < cfg.minSafeAuxStrokePt) {
    return {
      feasibleB: false,
      feasibleC: false,
      rejectReason: `aux-stroke-clearance-violation(${clr.minAuxStrokeClearance}pt)`,
    };
  }
  if (clr.minAxisClearance < cfg.minSafeAxisPt) {
    return {
      feasibleB: false,
      feasibleC: false,
      rejectReason: `axis-clearance-violation(${clr.minAxisClearance}pt)`,
    };
  }

  const feasibleB = clr.minMainStrokeClearance >= cfg.minSafeMainStrokeMinMovePt;
  const feasibleC = clr.minMainStrokeClearance >= cfg.minSafeMainStrokePt;

  if (!feasibleB) {
    return {
      feasibleB: false,
      feasibleC: false,
      rejectReason: `main-stroke-clearance-violation(${clr.minMainStrokeClearance}pt)`,
    };
  }

  const scoreB =
    100.0 -
    cand.moveDistPt * 8.0 +
    Math.min(clr.minMainStrokeClearance, 1.5) * 2.0 -
    Math.abs(cand.markerGapPt - 4.5) * 0.5;

  // --- Candidate C 점수: 평가원 스타일 10대 기준 다목적 점수 ---
  let c1MarkerDistScore = 0;
  if (cand.markerGapPt >= cfg.idealMarkerGapMinPt && cand.markerGapPt <= cfg.idealMarkerGapMaxPt) {
    c1MarkerDistScore = 12.0 - Math.abs(cand.markerGapPt - 5.2) * 1.2;
  } else if (cand.markerGapPt < cfg.idealMarkerGapMinPt) {
    c1MarkerDistScore = 6.0 - (cfg.idealMarkerGapMinPt - cand.markerGapPt) * 4.0;
  } else {
    c1MarkerDistScore = 8.0 - (cand.markerGapPt - cfg.idealMarkerGapMaxPt) * 2.8;
  }

  const c2DirNaturalScore = Math.max(0, 8.0 - cand.dirAlignErrorDeg * 0.28);
  const c3MainCurveScore = Math.min(clr.minMainStrokeClearance, 4.5) * 6.5;

  const minAllLineClearance = Math.min(
    clr.minMainStrokeClearance,
    clr.minAuxStrokeClearance,
    clr.minAxisClearance
  );
  const tightPrintPenalty =
    minAllLineClearance < 1.35 ? (1.35 - minAllLineClearance) * 20.0 : 0;
  const c4AuxAndAxisScore =
    Math.min(clr.minAuxStrokeClearance, 3.5) * 2.5 +
    Math.min(clr.minAxisClearance, 3.5) * 2.5 +
    Math.min(minAllLineClearance, 2.2) * 5.5 -
    tightPrintPenalty;

  const c5LabelGapScore = Math.min(clr.minNodeGap, 6.0) * 1.5;

  const angularClearDeg = computeAngularClearanceDeg(cand.angleDeg, sectorGeom.rayAnglesDeg);
  const c6OpenSectorScore = Math.min(angularClearDeg, 75.0) * 0.22;

  let c8BalanceScore = 4.0;
  if (scene.axes?.x && scene.axes?.y && scene.units) {
    const { xU = 28.45, yU = 28.45 } = scene.units;
    const xr = Math.max(scene.axes.x.from, scene.axes.x.to) * xU;
    const xl = Math.min(scene.axes.x.from, scene.axes.x.to) * xU;
    const yt = Math.max(scene.axes.y.from, scene.axes.y.to) * yU;
    const yb = Math.min(scene.axes.y.from, scene.axes.y.to) * yU;
    if (cand.bbox.x1 > xr - 4 || cand.bbox.x0 < xl + 4 || cand.bbox.y1 > yt - 4 || cand.bbox.y0 < yb + 4) {
      c8BalanceScore -= 8.0;
    }
  }

  const sameDirAsOrig = typeAInfo.dirOption && cand.nearestDir === typeAInfo.dirOption;
  const origDirBonus = sameDirAsOrig && minAllLineClearance >= 1.35 ? 4.5 : 0;
  const c9KiceStyleScore = (cand.nearestDirObj?.kicePrefBonus || 2.0) + origDirBonus - cand.moveDistPt * 0.35;

  const scoreC =
    c1MarkerDistScore +
    c2DirNaturalScore +
    c3MainCurveScore +
    c4AuxAndAxisScore +
    c5LabelGapScore +
    c6OpenSectorScore +
    c8BalanceScore +
    c9KiceStyleScore;

  return {
    feasibleB,
    feasibleC,
    scoreB: r2(scoreB),
    scoreC: r2(scoreC),
    angularClearDeg,
    minAllLineClearance: r2(minAllLineClearance),
  };
}

/**
 * [Unit 3-E] 장면 내 일반 노드를 5개 역할군으로 분류하고,
 * 오직 [유형 A: 점 마커에 연결된 대문자 점 이름(A, B, C, P, Q 등)] 중 실제 충돌이 있는 라벨만
 * 평가원 스타일 자연 배치(Candidate C)로 정렬 계획을 수립한다.
 */
export function planTypeAPointLabelsUnit3E(
  scene,
  fnPlan,
  fnShiftResult,
  axisEditsToApply = [],
  tickPlan = null,
  originPlan = null,
  cfg = DEFAULT_UNIT3E_POINT_LABEL_PARAMS
) {
  const result = {
    requested: true,
    applied: false,
    edits: [],
    movedPointLabels: [],
    heldPointLabels: [],
    decisions: [],
    decisionsByNodeId: new Map(),
    roleClassification: null,
  };

  if (!scene || !scene.ok || !Array.isArray(scene.nodes)) return result;

  const { sceneEff, nodeBoxesById } = buildEffectiveSceneStateBeforeTypeAUnit3E(
    scene,
    fnPlan,
    fnShiftResult,
    axisEditsToApply,
    tickPlan,
    originPlan
  );

  const roleClassification = classifyGeneralNodes5RolesUnit3E(sceneEff, nodeBoxesById, cfg);
  result.roleClassification = roleClassification;

  const typeAItems = roleClassification.classifications.filter(
    (c) => c.category === "TYPE_A_MARKER_POINT_LABEL"
  );

  for (const info of typeAItems) {
    const node = sceneEff.nodes.find((n) => n.id === info.id);
    if (!node || !node.bbox) continue;

    const ox = node.xshift || 0;
    const oy = node.yshift || 0;
    const currBb = nodeBoxesById.get(node.id) || node.bbox;

    // 점 마커에서 비정상적으로 멀리 떨어진 경우 (부정 사례 5 방어)
    if (!info.eligibleForTypeAMove) {
      const holdAbnormalDec = {
        id: node.id,
        label: node.label,
        cleanLabel: info.cleanLabel,
        symbol: info.cleanLabel,
        role: "point-label-typeA",
        category: info.category,
        subCategory: info.subCategory,
        markerId: info.markerId || null,
        markerCenterPt: info.markerCenterPt || null,
        coordTikz: info.coordTikz || null,
        origDirOption: info.dirOption || null,
        nearestDir: info.dirOption || "keep",
        action: "hold-abnormal-marker-distance",
        nonMoveCode: "abnormal-marker-distance",
        nonMoveCategory: "점 마커 거리 초과 보류",
        autoModified: false,
        moved: false,
        selectedEngine: "Unit 3-E-TypeA",
        origShift: [ox, oy],
        newShift: [ox, oy],
        shift: [ox, oy],
        shiftPt: [ox, oy],
        deltaShiftPt: [0, 0],
        movedPt: 0,
        markerGapPt: info.origMarkerBboxDistPt,
        origBbox: currBb,
        bbox: currBb,
        origClearancePt: null,
        finalClearancePt: null,
        origAxisClearancePt: null,
        finalAxisClearancePt: null,
        origNodeGapPt: null,
        finalNodeGapPt: null,
        beforeClearance: null,
        afterClearance: null,
        reason: info.reason,
        selectionReason: info.reason,
        holdReason: info.reason,
      };
      result.heldPointLabels.push(holdAbnormalDec);
      result.decisions.push(holdAbnormalDec);
      result.decisionsByNodeId.set(node.id, holdAbnormalDec);
      continue;
    }

    const origClr = evaluateTypeABoxClearancesUnit3E(
      node.id,
      info.markerId,
      currBb,
      sceneEff,
      nodeBoxesById
    );

    const hasStrokeCollision = origClr.minOverallStrokeClearance < cfg.triggerStrokeOverlapPt;
    const hasAxisCollision = origClr.minAxisClearance < cfg.triggerAxisOverlapPt;
    const hasNodeCollision = origClr.minNodeGap <= cfg.triggerNodeOverlapPt;
    const needsMove = hasStrokeCollision || hasAxisCollision || hasNodeCollision;

    // 이미 무충돌 자연 배치 상태이면 100% 원본 유지(Hold)
    if (!needsMove) {
      const keepReason = `점 이름(${info.cleanLabel})이 현재 위치(${info.dirOption || "기본"})에서 무충돌 자연 배치 상태(곡선 여유 ${origClr.minMainStrokeClearance}pt, 축 여유 ${origClr.minAxisClearance}pt, 마커 거리 ${info.origMarkerBboxDistPt}pt)이므로 원본 위치 유지`;
      const keepDec = {
        id: node.id,
        label: node.label,
        cleanLabel: info.cleanLabel,
        symbol: info.cleanLabel,
        role: "point-label-typeA",
        category: info.category,
        subCategory: info.subCategory,
        markerId: info.markerId,
        markerCenterPt: info.markerCenterPt,
        coordTikz: info.coordTikz,
        origDirOption: info.dirOption,
        nearestDir: info.dirOption || "keep",
        action: "keep",
        nonMoveCode: "keep-original",
        nonMoveCategory: "기존 위치 유지",
        autoModified: false,
        moved: false,
        selectedEngine: "Unit 3-E-TypeA",
        origShift: [ox, oy],
        newShift: [ox, oy],
        shift: [ox, oy],
        shiftPt: [ox, oy],
        deltaShiftPt: [0, 0],
        movedPt: 0,
        markerGapPt: info.origMarkerBboxDistPt,
        origBbox: currBb,
        bbox: currBb,
        origClearancePt: origClr.minOverallStrokeClearance,
        finalClearancePt: origClr.minOverallStrokeClearance,
        origAxisClearancePt: origClr.minAxisClearance,
        finalAxisClearancePt: origClr.minAxisClearance,
        origNodeGapPt: origClr.minNodeGap,
        finalNodeGapPt: origClr.minNodeGap,
        beforeClearance: {
          minStrokeClearancePt: origClr.minOverallStrokeClearance,
          minMainClearancePt: origClr.minMainStrokeClearance,
          minAuxClearancePt: origClr.minAuxStrokeClearance,
          minAxisClearancePt: origClr.minAxisClearance,
          minNodeGapPt: origClr.minNodeGap,
        },
        afterClearance: {
          minStrokeClearancePt: origClr.minOverallStrokeClearance,
          minMainClearancePt: origClr.minMainStrokeClearance,
          minAuxClearancePt: origClr.minAuxStrokeClearance,
          minAxisClearancePt: origClr.minAxisClearance,
          minNodeGapPt: origClr.minNodeGap,
        },
        reason: keepReason,
        selectionReason: keepReason,
        holdReason: keepReason,
      };
      result.heldPointLabels.push(keepDec);
      result.decisions.push(keepDec);
      result.decisionsByNodeId.set(node.id, keepDec);
      continue;
    }

    // 충돌이 감지된 유형 A 점 이름에 대해 평가원 스타일 후보 탐색
    const sectorGeom = analyzeMarkerLocalSectorGeometryUnit3E(info.markerCenterPt, sceneEff);
    const rawCands = generateTypeACandidatesForNode(node, info, cfg);

    const scoredForB = [];
    const scoredForC = [];

    for (const c of rawCands) {
      const clr = evaluateTypeABoxClearancesUnit3E(
        node.id,
        info.markerId,
        c.bbox,
        sceneEff,
        nodeBoxesById
      );
      const ev = scoreCandidateForTypeA(c, node, info, clr, sectorGeom, sceneEff, cfg);
      if (ev.feasibleB) {
        scoredForB.push({ ...c, clearance: clr, eval: ev });
      }
      if (ev.feasibleC) {
        scoredForC.push({ ...c, clearance: clr, eval: ev });
      }
    }

    scoredForB.sort((a, b) => a.moveDistPt - b.moveDistPt || b.eval.scoreB - a.eval.scoreB);
    scoredForC.sort((a, b) => b.eval.scoreC - a.eval.scoreC);

    const bestC = scoredForC[0] || scoredForB[0] || null;

    if (!bestC || (bestC.shift[0] === ox && bestC.shift[1] === oy)) {
      const holdReason = `점 이름(${info.cleanLabel})에 겹침(곡선 ${origClr.minOverallStrokeClearance}pt, 축 ${origClr.minAxisClearance}pt)이 감지되었으나 마커 소속 범위(${cfg.minAllowedMarkerGapPt}~${cfg.maxAllowedMarkerGapPt}pt) 내 안전 후보가 없어 원본 위치 유지 (조이스틱 미세 조정 권장)`;
      const holdDec = {
        id: node.id,
        label: node.label,
        cleanLabel: info.cleanLabel,
        symbol: info.cleanLabel,
        role: "point-label-typeA",
        category: info.category,
        subCategory: info.subCategory,
        markerId: info.markerId,
        markerCenterPt: info.markerCenterPt,
        coordTikz: info.coordTikz,
        origDirOption: info.dirOption,
        nearestDir: info.dirOption || "keep",
        action: "hold-no-safe-point-candidate",
        nonMoveCode: "no-safe-point-candidate",
        nonMoveCategory: "안전 후보 없음",
        autoModified: false,
        moved: false,
        selectedEngine: "Unit 3-E-TypeA",
        origShift: [ox, oy],
        newShift: [ox, oy],
        shift: [ox, oy],
        shiftPt: [ox, oy],
        deltaShiftPt: [0, 0],
        movedPt: 0,
        markerGapPt: info.origMarkerBboxDistPt,
        origBbox: currBb,
        bbox: currBb,
        origClearancePt: origClr.minOverallStrokeClearance,
        finalClearancePt: origClr.minOverallStrokeClearance,
        origAxisClearancePt: origClr.minAxisClearance,
        finalAxisClearancePt: origClr.minAxisClearance,
        origNodeGapPt: origClr.minNodeGap,
        finalNodeGapPt: origClr.minNodeGap,
        beforeClearance: {
          minStrokeClearancePt: origClr.minOverallStrokeClearance,
          minMainClearancePt: origClr.minMainStrokeClearance,
          minAuxClearancePt: origClr.minAuxStrokeClearance,
          minAxisClearancePt: origClr.minAxisClearance,
          minNodeGapPt: origClr.minNodeGap,
        },
        afterClearance: {
          minStrokeClearancePt: origClr.minOverallStrokeClearance,
          minMainClearancePt: origClr.minMainStrokeClearance,
          minAuxClearancePt: origClr.minAuxStrokeClearance,
          minAxisClearancePt: origClr.minAxisClearance,
          minNodeGapPt: origClr.minNodeGap,
        },
        reason: holdReason,
        selectionReason: holdReason,
        holdReason,
      };
      result.heldPointLabels.push(holdDec);
      result.decisions.push(holdDec);
      result.decisionsByNodeId.set(node.id, holdDec);
      continue;
    }

    nodeBoxesById.set(node.id, bestC.bbox);
    const ed = setShifts(node, bestC.shift[0], bestC.shift[1]);
    result.edits.push({
      kind: "label-shift",
      subKind: "typeA-point-label-shift",
      id: node.id,
      start: ed.start,
      end: ed.end,
      replacement: ed.replacement,
    });

    const moveReason = `점 이름(${info.cleanLabel})의 기존 선 겹침(곡선 ${origClr.minOverallStrokeClearance}pt, 축 ${origClr.minAxisClearance}pt) 해소를 위해 평가원 스타일 열린 방향(${bestC.nearestDir}, shift=[${bestC.shift[0]}, ${bestC.shift[1]}]pt)으로 이동 (곡선 여유 ${bestC.clearance.minOverallStrokeClearance}pt, 축 여유 ${bestC.clearance.minAxisClearance}pt, 마커 간격 ${bestC.markerGapPt}pt 확보)`;

    const moveDec = {
      id: node.id,
      label: node.label,
      cleanLabel: info.cleanLabel,
      symbol: info.cleanLabel,
      role: "point-label-typeA",
      category: info.category,
      subCategory: info.subCategory,
      markerId: info.markerId,
      markerCenterPt: info.markerCenterPt,
      coordTikz: info.coordTikz,
      origDirOption: info.dirOption,
      nearestDir: bestC.nearestDir,
      action: "move-point-label",
      nonMoveCode: null,
      nonMoveCategory: null,
      autoModified: true,
      moved: true,
      selectedEngine: "Unit 3-E-TypeA",
      origShift: [ox, oy],
      newShift: bestC.shift,
      shift: bestC.shift,
      shiftPt: bestC.shift,
      deltaShiftPt: bestC.deltaShift,
      movedPt: bestC.moveDistPt,
      markerGapPt: bestC.markerGapPt,
      origBbox: currBb,
      bbox: bestC.bbox,
      score: bestC.eval.scoreC,
      origClearancePt: origClr.minOverallStrokeClearance,
      finalClearancePt: bestC.clearance.minOverallStrokeClearance,
      origAxisClearancePt: origClr.minAxisClearance,
      finalAxisClearancePt: bestC.clearance.minAxisClearance,
      origNodeGapPt: origClr.minNodeGap,
      finalNodeGapPt: bestC.clearance.minNodeGap,
      beforeClearance: {
        minStrokeClearancePt: origClr.minOverallStrokeClearance,
        minMainClearancePt: origClr.minMainStrokeClearance,
        minAuxClearancePt: origClr.minAuxStrokeClearance,
        minAxisClearancePt: origClr.minAxisClearance,
        minNodeGapPt: origClr.minNodeGap,
      },
      afterClearance: {
        minStrokeClearancePt: bestC.clearance.minOverallStrokeClearance,
        minMainClearancePt: bestC.clearance.minMainStrokeClearance,
        minAuxClearancePt: bestC.clearance.minAuxStrokeClearance,
        minAxisClearancePt: bestC.clearance.minAxisClearance,
        minNodeGapPt: bestC.clearance.minNodeGap,
      },
      reason: moveReason,
      selectionReason: moveReason,
      holdReason: null,
    };

    result.movedPointLabels.push(moveDec);
    result.decisions.push(moveDec);
    result.decisionsByNodeId.set(node.id, moveDec);
  }

  result.applied = result.movedPointLabels.length > 0;
  return result;
}
