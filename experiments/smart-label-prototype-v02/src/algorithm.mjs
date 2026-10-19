// 평가원 스타일 라벨 배치 추천 알고리즘 (프로토타입 v0.2).
// v0.1 대비 3대 알고리즘 개선:
//  1) 유지(keep) 판정 고도화: 단순 거리(keepNearEnd=12)+무충돌이 아니라, 근접성+접선 방향 적합성+선호 끝점+중심 정렬(|alpha|)+여백을 종합 평가
//  2) 수직선/일반 직선/함수 곡선 구분(classifyStrokeKind): 수직선(x=k 등)은 상·하 끝점을 모두 후보로 평가하되 안전할 때 하단(below) 배치를 우선 선호
//  3) 곡선 대응 불확실성 안전 처리: assignStrokes null 안전성 보강 + nearest-unclaimed 추정 노드는 자동 코드 수정을 차단하고 참고 후보(advisory)로만 제공
import { minDistPolylines } from "../../smart-label-engine/src/geometry.mjs";

export const PARAMS = {
  gapAbove: 3.0,        // 위쪽 배치 시 곡선 끝점 ↔ 라벨 ink bbox 하단 간격(pt)
  gapBelow: 2.5,        // 아래쪽 배치 시 곡선 끝점 ↔ 라벨 ink bbox 상단 간격(pt)
  gapSide: 4.0,         // 좌우 배치(접선이 거의 수평일 때) 간격(pt)
  alphaStep: 0.125,     // 라벨 가로 정렬 후보 간격 (alpha=0: 끝점 중앙, ±1: 라벨 한쪽 끝이 끝점)
  cHard: 4.0,           // 다른 선(축/곡선/선분)과의 최소 허용 간격(pt)
  cOwn: 0.0,            // 자기 곡선과의 최소 간격(pt, 선 두께 제외)
  cPref: 10.0,          // 선호 여백(pt)
  mLabel: 4.0,          // 다른 라벨과의 최소 간격(pt)
  // v0.2 신규 유지(keep) 판정 파라미터 (기존 keepNearEnd: 12.0 대체)
  keepNearEnd: 12.0,    // v0.1 비교 진단용 참조값 (v0.2 종합 판정에서는 keepMaxEndGap 사용)
  keepMaxEndGap: 6.0,   // 유지 허용 최대 끝점 간격(pt)
  keepMaxAlpha: 0.65,   // 유지 허용 최대 중심 정렬 편차(|alpha| <= 0.65; 인라인 right 노드의 alpha≈1.1 제외)
  horizTangentMax: 0.5, // |t_y| < 0.5 일 때만 좌/우(left/right) 배치를 자연스러운 접선 방향으로 허용
  allowUncertainMove: false, // false(기본): nearest-unclaimed 불확실 매칭 노드는 코드 자동 수정 금지(참고 후보만 산출)
  wClear: 20, wSide: 8, wEnd: 8, wAlpha: 6, wGrow: 0.5,
  margins: { right: 16, left: 19.5, top: 18.5, bottom: 4 },
  axisIgnoreEndWithin: 1.5,
  shiftRound: 1,
};

const r2 = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : n);
const rectPoly = (b) => ({ pts: [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]], closed: true });
const bboxGapRect = (a, b) => Math.hypot(Math.max(a.x0 - b.x1, 0, b.x0 - a.x1), Math.max(a.y0 - b.y1, 0, b.y0 - a.y1));
const bboxPtDist = (p, b) => Math.hypot(Math.max(b.x0 - p[0], 0, p[0] - b.x1), Math.max(b.y0 - p[1], 0, p[1] - b.y1));
const clearanceToStroke = (bbox, s) => minDistPolylines([rectPoly(bbox)], [{ pts: s.pts, closed: false }]) - s.halfWidth;

/**
 * 선/곡선 유형 분류:
 * - "verticalLine": 수직선 (|dx| <= 1pt 이고 모든 점이 수직선에서 0.5pt 이내)
 * - "generalLine": 수직선이 아닌 직선 (양 끝점 직선으로부터 최대 편차 <= 0.25pt)
 * - "functionCurve": 곡률이 있는 일반 함수 곡선
 */
export function classifyStrokeKind(stroke) {
  if (!stroke || !Array.isArray(stroke.pts) || stroke.pts.length < 2) return "unknown";
  const pts = stroke.pts;
  const p0 = pts[0], p1 = pts[pts.length - 1];
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return "unknown";
  let maxDev = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const px = pts[i][0] - p0[0], py = pts[i][1] - p0[1];
    const dev = Math.abs(px * dy - py * dx) / len;
    if (dev > maxDev) maxDev = dev;
  }
  if (Math.abs(dx) <= 1.0 && Math.abs(dy) >= 5.0 && maxDev <= 0.5) return "verticalLine";
  if (maxDev <= 0.25) return "generalLine";
  return "functionCurve";
}

/**
 * 라벨 → 곡선/선 배정 (v0.2 안전성 강화):
 * ① 인라인 소속 (경로 존재 확인, null 안전 처리) → confirmed: true
 * ② 수식 수치 일치 (plot 함수식 또는 수치형 x=c 직선) → confirmed: true
 * ③ 남은 곡선 중 최근접 추정 (nearest-unclaimed) → confirmed: false, uncertain: true (자동 코드 수정 금지 대상)
 */
export function assignStrokes(scene, targets) {
  const res = new Map();
  const claimed = new Set();
  const strokes = Array.isArray(scene && scene.strokes) ? scene.strokes : [];
  const strokeOfPath = (p) => (p && p.index !== undefined ? strokes.find((s) => s && s.index === p.index) || null : null);

  // ① 인라인 소속 경로 확인 (경로 검색 실패 시 속성 접근 오류 방지)
  for (const n of targets) {
    if (n.kind === "inline" && n.stmt && n.stmt.path) {
      const st = strokeOfPath(n.stmt.path);
      if (st) {
        const strokeKind = classifyStrokeKind(st);
        res.set(n.id, { how: "inline", stroke: st, strokeKind, confirmed: true, uncertain: false });
        claimed.add(st.index);
      } else {
        res.set(n.id, { how: "inline-unlinked", stroke: null, strokeKind: "unknown", confirmed: false, uncertain: true, reason: "인라인 문장의 SVG 경로를 찾지 못함" });
      }
    }
  }

  // ② 수식과 곡선의 수치적 대응 확인
  for (const n of targets) {
    if (res.has(n.id)) continue;
    const f = scene.compileLabelFunction ? scene.compileLabelFunction(n.label) : null;
    if (f) {
      const matches = [];
      for (const st of scene.stmts || []) {
        if (st.type === "plot" && st.fn && st.domain && st.path && !claimed.has(st.path.index)) {
          const stroke = strokeOfPath(st.path);
          if (!stroke) continue;
          let ok = true;
          for (let k = 0; k < 5; k++) {
            const x = st.domain[0] + ((st.domain[1] - st.domain[0]) * (k + 0.5)) / 5;
            if (!(Math.abs(f(x) - st.fn(x)) < 1e-6)) { ok = false; break; }
          }
          if (ok) matches.push(stroke);
        }
      }
      if (matches.length === 1) {
        const st = matches[0];
        res.set(n.id, { how: "expr-match", stroke: st, strokeKind: classifyStrokeKind(st), confirmed: true, uncertain: false });
        claimed.add(st.index);
        continue;
      }
    }
    // 수치형 수직선 라벨(예: $x=-2$)과 수직선 경로의 일치 검사
    const clean = (n.trimmed || "").replace(/\s+/g, "");
    const vm = /^x=([-+]?(?:\d+\.?\d*|\.\d+))$/.exec(clean);
    if (vm && scene.units && scene.units.xU) {
      const xPt = Number(vm[1]) * scene.units.xU;
      const vMatches = strokes.filter((s) => s.kind !== "axis" && !claimed.has(s.index) && classifyStrokeKind(s) === "verticalLine" && Math.abs(s.pts[0][0] - xPt) <= 1.0);
      if (vMatches.length === 1) {
        const st = vMatches[0];
        res.set(n.id, { how: "expr-match", stroke: st, strokeKind: "verticalLine", confirmed: true, uncertain: false });
        claimed.add(st.index);
        continue;
      }
    }
  }

  // ③ 남은 곡선 중 최근접 추정 (nearest-unclaimed: 불확실하므로 confirmed=false, uncertain=true)
  const rest = targets.filter((n) => !res.has(n.id));
  const pool = (plotOnly) => strokes.filter((s) => s && s.kind !== "axis" && Array.isArray(s.pts) && s.pts.length >= 2 && !claimed.has(s.index) && (!plotOnly || (s.stmt && s.stmt.type === "plot")));
  for (const n of rest) {
    const a = n.at || n.inlineAnchor || n.anchor || (n.bbox ? [(n.bbox.x0 + n.bbox.x1) / 2, (n.bbox.y0 + n.bbox.y1) / 2] : null);
    if (!a) {
      res.set(n.id, { how: "unmatched", stroke: null, strokeKind: "unknown", confirmed: false, uncertain: true, reason: "기준 좌표 없음" });
      continue;
    }
    let cands = pool(true);
    if (!cands.length) cands = pool(false);
    let best = null;
    for (const s of cands) {
      const d = minDistPolylines([{ pts: [a, a], closed: false }], [{ pts: s.pts, closed: false }]);
      if (!best || d < best.d) best = { d, s };
    }
    if (best) {
      const strokeKind = classifyStrokeKind(best.s);
      res.set(n.id, {
        how: "nearest-unclaimed",
        stroke: best.s,
        strokeKind,
        confirmed: false,
        uncertain: true,
        distancePt: r2(best.d),
        reason: "수식 기호(미지수) 등으로 인해 최근접 미배정 곡선으로만 추정됨",
      });
      claimed.add(best.s.index);
    } else {
      res.set(n.id, { how: "unmatched", stroke: null, strokeKind: "unknown", confirmed: false, uncertain: true, reason: "대응 가능한 미배정 곡선/선이 없음" });
    }
  }
  return res;
}

export function endInfo(stroke, which) {
  const p = stroke.pts, n = p.length, k = Math.min(3, n - 1);
  const e = which === 0 ? p[0] : p[n - 1], nb = which === 0 ? p[k] : p[n - 1 - k];
  const tx = e[0] - nb[0], ty = e[1] - nb[1], l = Math.hypot(tx, ty) || 1;
  return { point: e, t: [tx / l, ty / l] };
}

/**
 * 선호 끝점 결정:
 * - 수직선("verticalLine"): 평가원 기준 자료(샘플 5, 6)에 따라 아래쪽 끝점(y가 더 작은 끝점)을 우선 선호
 * - 일반 직선/함수 곡선: 오른쪽 끝점(x가 더 큰 끝점)을 우선 선호
 */
export function selectPreferredEnd(strokeKind, ends, anchor0) {
  if (strokeKind === "verticalLine") {
    return ends[0].point[1] <= ends[1].point[1] ? 0 : 1;
  }
  const dx = ends[1].point[0] - ends[0].point[0];
  if (Math.abs(dx) > 2) return dx > 0 ? 1 : 0;
  const d0 = Math.hypot(ends[0].point[0] - anchor0[0], ends[0].point[1] - anchor0[1]);
  const d1 = Math.hypot(ends[1].point[0] - anchor0[0], ends[1].point[1] - anchor0[1]);
  return d0 <= d1 ? 0 : 1;
}

/**
 * 끝점 기준 현재 라벨의 배치 방향(above/below/right/left)과 정렬 지표(alpha/beta) 계산
 */
export function describePlacementAtEnd(bbox, endInfoObj) {
  const e = endInfoObj.point;
  const w = bbox.x1 - bbox.x0, h = bbox.y1 - bbox.y0;
  const cx = (bbox.x0 + bbox.x1) / 2, cy = (bbox.y0 + bbox.y1) / 2;
  const side = bbox.y0 >= e[1] - 1 ? "above" : bbox.y1 <= e[1] + 1 ? "below" : cx >= e[0] ? "right" : "left";
  const alpha = w > 1e-6 ? (cx - e[0]) / (w / 2) : 0;
  const beta = h > 1e-6 ? (cy - e[1]) / (h / 2) : 0;
  const endGapPt = bboxPtDist(e, bbox);
  return { side, alpha, beta, endGapPt };
}

/**
 * 곡선 끝점의 진행 방향(접선 벡터 t)에 따른 평가원 스타일 허용 배치 방향 계산
 */
export function allowedSidesForTangent(t, strokeKind, P = PARAMS) {
  if (strokeKind === "verticalLine") {
    return t[1] >= 0 ? ["above"] : ["below"];
  }
  const allowed = [];
  if (t[1] >= P.horizTangentMax) allowed.push("above");
  else if (t[1] <= -P.horizTangentMax) allowed.push("below");
  else {
    // 접선이 수평에 가까운 경우(|t[1]| < horizTangentMax): 진행 방향 좌/우 및 상/하 허용
    if (t[0] >= 0) allowed.push("right");
    if (t[0] <= 0) allowed.push("left");
    if (t[1] >= 0) allowed.push("above", "below");
    else allowed.push("below", "above");
  }
  return allowed;
}

/**
 * v0.2 첫 번째 개선 — 종합 유지(keep) 판정:
 * 충돌이 없다는 이유만으로 유지하지 않고,
 * (1) 여백/무충돌, (2) 선호 끝점 일치, (3) 끝점 근접성, (4) 접선 진행 방향 적합성, (5) 중심 정렬(|alpha|)을 모두 검사한다.
 */
export function evaluateKeep(bbox, strokeKind, ends, preferredEnd, eval0, P = PARAMS) {
  const d0 = bboxPtDist(ends[0].point, bbox);
  const d1 = bboxPtDist(ends[1].point, bbox);
  const currentEnd = d0 <= d1 ? 0 : 1;
  const cur = describePlacementAtEnd(bbox, ends[currentEnd]);
  const allowedSides = allowedSidesForTangent(ends[currentEnd].t, strokeKind, P);

  const clearanceOk = eval0.minOther >= P.cHard && eval0.own >= P.cOwn && eval0.labelGap >= P.mLabel;
  const v01WouldKeep = clearanceOk && cur.endGapPt <= P.keepNearEnd;

  const endOk = currentEnd === preferredEnd;
  const proximityOk = cur.endGapPt <= P.keepMaxEndGap;
  const directionOk = allowedSides.includes(cur.side);
  const useBeta = (cur.side === "right" || cur.side === "left") && directionOk;
  const alignVal = useBeta ? Math.abs(cur.beta) : Math.abs(cur.alpha);
  const alignmentOk = alignVal <= P.keepMaxAlpha;

  const rejectReasons = [];
  if (!clearanceOk) rejectReasons.push("충돌/여백 부족");
  if (!endOk) rejectReasons.push(`선호 끝점 불일치(현재 끝=${currentEnd}, 선호 끝=${preferredEnd}${strokeKind === "verticalLine" ? "·수직선 하단 선호" : ""})`);
  if (!proximityOk) rejectReasons.push(`끝점 거리 초과(${r2(cur.endGapPt)}pt > ${P.keepMaxEndGap}pt)`);
  if (!directionOk) rejectReasons.push(`접선 진행 방향 부적합(현재=${cur.side}, 허용=${allowedSides.join("/")}, t=[${r2(ends[currentEnd].t[0])}, ${r2(ends[currentEnd].t[1])}])`);
  if (!alignmentOk) rejectReasons.push(`중심 정렬 편차 초과(|align|=${r2(alignVal)} > ${P.keepMaxAlpha})`);

  const keep = clearanceOk && endOk && proximityOk && directionOk && alignmentOk;
  return {
    keep,
    v01WouldKeep,
    changedFromV01: v01WouldKeep !== keep,
    currentEnd,
    preferredEnd,
    currentSide: cur.side,
    allowedSides,
    endGapPt: r2(cur.endGapPt),
    alpha: r2(cur.alpha),
    beta: r2(cur.beta),
    checks: { clearanceOk, endOk, proximityOk, directionOk, alignmentOk },
    rejectReasons,
  };
}

function computeShiftForMove(node, targetBbox, P = PARAMS) {
  const dx = targetBbox.x0 - node.bbox.x0;
  const dy = targetBbox.y0 - node.bbox.y0;
  const newX = Math.round(((node.xshift || 0) + dx / node.scale[0]) / P.shiftRound) * P.shiftRound;
  const newY = Math.round(((node.yshift || 0) + dy / node.scale[1]) / P.shiftRound) * P.shiftRound;
  return {
    oldShift: [node.xshift, node.yshift],
    newShift: [newX, newY],
    scale: node.scale,
    neededMovePt: [Math.round(dx * 10) / 10, Math.round(dy * 10) / 10],
  };
}

/**
 * @param {ReturnType<import("./scene.mjs").buildScene>} scene  (ok=true)
 * @param {typeof PARAMS} P
 */
export function planLabels(scene, P = PARAMS, axisPt = null) {
  const plan = { placements: [], skipped: [], advisory: [], notes: [] };
  const targets = scene.nodes.filter((n) => n.role === "function" && n.bbox);
  const fixed = scene.nodes.filter((n) => n.bbox && n.role !== "function" && n.role !== "marker");
  const assigned = assignStrokes(scene, targets);

  const strokesEff = scene.strokes.map((s) => {
    if (s.kind !== "axis" || !axisPt) return s;
    const horizontal = Math.abs(s.pts[0][1] - s.pts[s.pts.length - 1][1]) < 1e-6;
    return { ...s, pts: horizontal ? [[axisPt.left, s.pts[0][1]], [axisPt.right, s.pts[0][1]]] : [[s.pts[0][0], axisPt.bottom], [s.pts[0][0], axisPt.top]] };
  });

  const placedBoxes = [];
  let content = null;
  const addC = (b) => { content = content ? { x0: Math.min(content.x0, b.x0), y0: Math.min(content.y0, b.y0), x1: Math.max(content.x1, b.x1), y1: Math.max(content.y1, b.y1) } : { ...b }; };
  for (const s of scene.strokes) if (s.kind !== "axis") for (const p of s.pts) addC({ x0: p[0], y0: p[1], x1: p[0], y1: p[1] });
  for (const n of fixed) if (n.role !== "axisLabel" && n.role !== "origin") addC(n.bbox);

  for (const n of targets) {
    if (!n.usable) {
      plan.skipped.push({ id: n.id, label: n.label, category: "unusable-node", reason: `노드 매칭이 confirmed 가 아님(${n.confidence})` });
      placedBoxes.push(n.bbox);
      continue;
    }
    if (!n.scale) {
      plan.skipped.push({ id: n.id, label: n.label, category: "unknown-scale", reason: "노드 배율 불명" });
      placedBoxes.push(n.bbox);
      continue;
    }
    const a = assigned.get(n.id);
    if (!a || !a.stroke) {
      plan.skipped.push({ id: n.id, label: n.label, category: "unmatched-stroke", reason: (a && a.reason) || "대응 곡선/선을 찾지 못함" });
      placedBoxes.push(n.bbox);
      continue;
    }

    const s = a.stroke;
    const strokeKind = a.strokeKind || classifyStrokeKind(s);
    const w = n.bbox.x1 - n.bbox.x0, h = n.bbox.y1 - n.bbox.y0;
    const others = strokesEff.filter((q) => q.index !== s.index);
    const obsBoxes = [...fixed.map((q) => q.bbox), ...placedBoxes];
    const ends = [endInfo(s, 0), endInfo(s, 1)];
    const anchor0 = n.at || n.inlineAnchor || n.anchor || [(n.bbox.x0 + n.bbox.x1) / 2, (n.bbox.y0 + n.bbox.y1) / 2];
    const preferredEnd = selectPreferredEnd(strokeKind, ends, anchor0);

    const evalBox = (bb) => {
      let minOther = Infinity;
      for (const q of others) { const c = clearanceToStroke(bb, q); if (c < minOther) minOther = c; }
      const own = clearanceToStroke(bb, s);
      let labelGap = Infinity;
      for (const ob of obsBoxes) labelGap = Math.min(labelGap, bboxGapRect(bb, ob));
      return { minOther, own, labelGap };
    };

    const e0 = evalBox(n.bbox);
    const keepCheck = evaluateKeep(n.bbox, strokeKind, ends, preferredEnd, e0, P);

    if (keepCheck.keep && (a.confirmed || !P.allowUncertainMove)) {
      plan.placements.push({
        id: n.id,
        label: n.label,
        action: "keep",
        reason: `원 위치가 평가원 스타일에 부합(끝점 ${keepCheck.endGapPt}pt, 방향 ${keepCheck.currentSide}, |α|=${Math.abs(keepCheck.alpha)}, 무충돌)`,
        stroke: s.index,
        strokeKind,
        how: a.how,
        confirmedAssignment: !!a.confirmed,
        uncertainAssignment: !!a.uncertain,
        end: keepCheck.currentEnd,
        preferredEnd,
        side: keepCheck.currentSide,
        alpha: keepCheck.alpha,
        bbox: n.bbox,
        from: n.bbox,
        eval: e0,
        keepCheck,
      });
      placedBoxes.push(n.bbox);
      addC(n.bbox);
      continue;
    }

    // 후보 생성 (수직선은 상·하 끝점 모두 평가하되 preferredEnd=하단 선호; 접선이 수평에 가까우면 좌·우도 평가)
    const cands = [];
    for (const ei of [0, 1]) {
      const { point: E, t } = ends[ei];
      const prefAbove = t[1] >= 0;
      for (const side of ["above", "below"]) {
        for (let al = -1; al <= 1.0001; al += P.alphaStep) {
          const cx = E[0] + al * (w / 2);
          const bb = side === "above"
            ? { x0: cx - w / 2, x1: cx + w / 2, y0: E[1] + P.gapAbove, y1: E[1] + P.gapAbove + h }
            : { x0: cx - w / 2, x1: cx + w / 2, y1: E[1] - P.gapBelow, y0: E[1] - P.gapBelow - h };
          cands.push({ bb, ei, side, alpha: al, sideMismatch: (side === "above") !== prefAbove });
        }
      }
      if (strokeKind !== "verticalLine" && Math.abs(t[1]) < P.horizTangentMax) {
        for (const side of ["right", "left"]) {
          for (let be = -1; be <= 1.0001; be += 0.25) {
            const cy = E[1] + be * (h / 2);
            const bb = side === "right"
              ? { x0: E[0] + P.gapSide, x1: E[0] + P.gapSide + w, y0: cy - h / 2, y1: cy + h / 2 }
              : { x1: E[0] - P.gapSide, x0: E[0] - P.gapSide - w, y0: cy - h / 2, y1: cy + h / 2 };
            cands.push({ bb, ei, side, alpha: be, sideMismatch: (side === "right") !== (t[0] >= 0) });
          }
        }
      }
    }

    let best = null;
    const scored = [];
    const baseC = content || { ...n.bbox };
    for (const c of cands) {
      const ev = evalBox(c.bb);
      const hard = ev.minOther < P.cHard || ev.own < P.cOwn || ev.labelGap < P.mLabel;
      const grow = (Math.max(baseC.x1, c.bb.x1) - Math.min(baseC.x0, c.bb.x0) - (baseC.x1 - baseC.x0)) +
                   (Math.max(baseC.y1, c.bb.y1) - Math.min(baseC.y0, c.bb.y0) - (baseC.y1 - baseC.y0));
      const clearPen = Math.max(0, P.cPref - Math.min(ev.minOther, ev.labelGap)) / P.cPref;
      const cost = P.wClear * clearPen * clearPen +
                   (c.sideMismatch ? P.wSide : 0) +
                   (c.ei !== preferredEnd ? P.wEnd : 0) +
                   P.wAlpha * Math.abs(c.alpha) +
                   P.wGrow * (grow / 100);
      scored.push({ ...c, ev, hard, cost });
      if (!hard && (!best || cost < best.cost)) best = { ...c, ev, cost };
    }

    if (!best) {
      plan.skipped.push({
        id: n.id,
        label: n.label,
        category: "no-safe-candidate",
        strokeKind,
        reason: `허용 간격을 만족하는 안전한 후보 없음 (cHard=${P.cHard}) — 원본 유지(수동 확인)`,
      });
      plan.placements.push({
        id: n.id,
        label: n.label,
        action: "keep",
        reason: "안전 후보 없음 — 원본 유지(수동 확인)",
        stroke: s.index,
        strokeKind,
        how: a.how,
        confirmedAssignment: !!a.confirmed,
        uncertainAssignment: !!a.uncertain,
        bbox: n.bbox,
        from: n.bbox,
        eval: e0,
        keepCheck,
      });
      placedBoxes.push(n.bbox);
      addC(n.bbox);
      continue;
    }

    // 세 번째 개선: 최근접 곡선 추정(nearest-unclaimed)만으로 연결된 경우 자동 코드 수정 금지, 참고 후보(advisory)로만 기록
    if (a.uncertain && !P.allowUncertainMove) {
      const advShift = computeShiftForMove(n, best.bb, P);
      const advisoryObj = {
        id: n.id,
        label: n.label,
        how: a.how,
        stroke: s.index,
        strokeKind,
        end: best.ei,
        preferredEnd,
        side: best.side,
        alpha: Math.round(best.alpha * 1000) / 1000,
        cost: Math.round(best.cost * 100) / 100,
        bbox: best.bb,
        from: n.bbox,
        shift: advShift.newShift,
        neededMovePt: advShift.neededMovePt,
        eval: best.ev,
      };
      plan.advisory.push(advisoryObj);
      plan.skipped.push({
        id: n.id,
        label: n.label,
        category: "uncertain-stroke-assignment",
        how: a.how,
        stroke: s.index,
        strokeKind,
        reason: `대응 곡선 불확실(${a.how}) — 자동 코드 수정 금지(원본 유지). 참고 추정 위치: 끝점 ${best.ei}/${best.side}, 추천 shift=[${advShift.newShift[0]}pt, ${advShift.newShift[1]}pt]`,
        advisory: advisoryObj,
      });
      plan.placements.push({
        id: n.id,
        label: n.label,
        action: "hold-uncertain",
        reason: `최근접 곡선 추정(${a.how})만으로는 자동 코드 수정 금지 — 참고 후보(끝${best.ei}/${best.side}, shift=[${advShift.newShift[0]}pt, ${advShift.newShift[1]}pt])만 제공`,
        stroke: s.index,
        strokeKind,
        how: a.how,
        confirmedAssignment: false,
        uncertainAssignment: true,
        end: keepCheck.currentEnd,
        preferredEnd,
        side: keepCheck.currentSide,
        alpha: keepCheck.alpha,
        bbox: n.bbox,
        from: n.bbox,
        eval: e0,
        keepCheck,
        advisory: advisoryObj,
      });
      placedBoxes.push(n.bbox);
      addC(n.bbox);
      continue;
    }

    plan.placements.push({
      id: n.id,
      label: n.label,
      action: "move",
      reason: keepCheck.rejectReasons.length ? `원 위치 미유지(${keepCheck.rejectReasons.join(", ")}) → 끝${best.ei}/${best.side} 이동` : `끝${best.ei}/${best.side} 이동`,
      stroke: s.index,
      strokeKind,
      how: a.how,
      confirmedAssignment: !!a.confirmed,
      uncertainAssignment: !!a.uncertain,
      end: best.ei,
      preferredEnd,
      side: best.side,
      alpha: Math.round(best.alpha * 1000) / 1000,
      cost: Math.round(best.cost * 100) / 100,
      bbox: best.bb,
      from: n.bbox,
      eval: best.ev,
      keepCheck,
      candidates: scored.length,
      feasible: scored.filter((q) => !q.hard).length,
    });
    placedBoxes.push(best.bb);
    addC(best.bb);
  }

  plan.assignments = Object.fromEntries([...assigned.entries()].map(([k, v]) => [k, {
    how: v.how,
    stroke: v.stroke ? v.stroke.index : null,
    strokeKind: v.strokeKind || "unknown",
    confirmed: !!v.confirmed,
    uncertain: !!v.uncertain,
    reason: v.reason || null,
  }]));
  return plan;
}

/** 이동 계획 → 노드 옵션 수정 (action === "move" 인 확정 노드만 실제 편집 생성; hold-uncertain 은 advisoryReport 에만 기록) */
export function shiftEdits(scene, plan, P = PARAMS) {
  const edits = [], report = [], advisoryReport = [];
  for (const pl of plan.placements) {
    const n = scene.nodes.find((q) => q.id === pl.id);
    if (!n) continue;
    if (pl.action === "hold-uncertain" && pl.advisory) {
      advisoryReport.push({
        id: n.id,
        label: n.label,
        how: pl.how,
        strokeKind: pl.strokeKind,
        oldShift: [n.xshift, n.yshift],
        advisoryShift: pl.advisory.shift,
        scale: n.scale,
        neededMovePt: pl.advisory.neededMovePt,
        end: pl.advisory.end,
        side: pl.advisory.side,
        alpha: pl.advisory.alpha,
      });
      continue;
    }
    if (pl.action !== "move") continue;
    const sh = computeShiftForMove(n, pl.bbox, P);
    const text = setShifts(n, sh.newShift[0], sh.newShift[1]);
    edits.push({ kind: "label-shift", id: n.id, start: text.start, end: text.end, replacement: text.replacement });
    report.push({ id: n.id, label: n.label, how: pl.how, strokeKind: pl.strokeKind, oldShift: sh.oldShift, newShift: sh.newShift, scale: sh.scale, neededMovePt: sh.neededMovePt });
  }
  return { edits, report, advisoryReport };
}

function setShifts(n, x, y) {
  const set = (raw, key, v) => {
    const re = new RegExp(`${key}\\s*=\\s*[-+]?[0-9.]+\\s*(?:pt)?`);
    return re.test(raw) ? raw.replace(re, `${key}=${v}pt`) : (raw.trim() ? raw.replace(/\s+$/, "") + ", " : "") + `${key}=${v}pt`;
  };
  if (n.optionsRange) {
    let raw = n.optionsRaw;
    if (x !== 0 || n.xshift !== null) raw = set(raw, "xshift", x);
    if (y !== 0 || n.yshift !== null) raw = set(raw, "yshift", y);
    return { start: n.optionsRange[0], end: n.optionsRange[1], replacement: raw };
  }
  const parts = []; if (x !== 0) parts.push(`xshift=${x}pt`); if (y !== 0) parts.push(`yshift=${y}pt`);
  return { start: n.keywordEnd, end: n.keywordEnd, replacement: ` [${parts.join(", ")}]` };
}

/** 축 길이 계획: 내용(곡선·라벨) 바깥으로 dev 중앙값 여백을 둔다. 늘리기만 한다. */
export function planAxes(scene, plan, P = PARAMS) {
  const out = { x: null, y: null, content: null, notes: [] };
  if (!scene.axes.x || !scene.axes.y) { out.notes.push("x/y 축을 모두 식별하지 못해 축 길이 추천 생략"); return out; }
  const { xU, yU } = scene.units;
  const ax = scene.axes.x, ay = scene.axes.y;
  const xl = Math.min(ax.from, ax.to) * xU, xr = Math.max(ax.from, ax.to) * xU, yb = Math.min(ay.from, ay.to) * yU, yt = Math.max(ay.from, ay.to) * yU;
  let C = null;
  const add = (x0, y0, x1, y1) => { C = C ? { x0: Math.min(C.x0, x0), y0: Math.min(C.y0, y0), x1: Math.max(C.x1, x1), y1: Math.max(C.y1, y1) } : { x0, y0, x1, y1 }; };
  const ign = P.axisIgnoreEndWithin;
  for (const s of scene.strokes) if (s.kind !== "axis") for (const p of s.pts) {
    add(p[0], p[1], p[0], p[1]);
  }
  const placedById = new Map(plan.placements.map((p) => [p.id, p]));
  for (const n of scene.nodes) {
    if (!n.bbox || ["axisLabel", "origin", "marker"].includes(n.role)) continue;
    const pl = placedById.get(n.id);
    const b = pl && pl.action === "move" ? pl.bbox : n.bbox;
    add(b.x0, b.y0, b.x1, b.y1);
  }
  out.content = C;
  const M = P.margins;
  const need = { right: C.x1 + M.right, left: C.x0 - M.left, top: C.y1 + M.top, bottom: C.y0 - M.bottom };
  const ends = { right: Math.max(xr, need.right), left: Math.min(xl, need.left), top: Math.max(yt, need.top), bottom: Math.min(yb, need.bottom) };
  const nearEnd = { right: false, left: false, top: false, bottom: false };
  for (const s of scene.strokes) if (s.kind !== "axis") for (const p of [s.pts[0], s.pts[s.pts.length - 1]]) {
    if (Math.abs(p[0] - xr) <= ign) nearEnd.right = true;
    if (Math.abs(p[0] - xl) <= ign) nearEnd.left = true;
    if (Math.abs(p[1] - yt) <= ign) nearEnd.top = true;
    if (Math.abs(p[1] - yb) <= ign) nearEnd.bottom = true;
  }
  const u1 = (v) => Math.round(v * 10) / 10;
  const L = nearEnd.left ? xl : ends.left, R = nearEnd.right ? xr : ends.right, B = nearEnd.bottom ? yb : ends.bottom, T = nearEnd.top ? yt : ends.top;
  const fwd = ax.from <= ax.to, fwdY = ay.from <= ay.to;
  const pick = (oldU, newPt, unit, same) => (same ? oldU : u1(newPt / unit));
  const xLeftU = pick(fwd ? ax.from : ax.to, L, xU, Math.abs(L - xl) < 1e-6), xRightU = pick(fwd ? ax.to : ax.from, R, xU, Math.abs(R - xr) < 1e-6);
  const yBotU = pick(fwdY ? ay.from : ay.to, B, yU, Math.abs(B - yb) < 1e-6), yTopU = pick(fwdY ? ay.to : ay.from, T, yU, Math.abs(T - yt) < 1e-6);
  out.x = { old: [ax.from, ax.to], new: fwd ? [xLeftU, xRightU] : [xRightU, xLeftU], nearEnd };
  out.y = { old: [ay.from, ay.to], new: fwdY ? [yBotU, yTopU] : [yTopU, yBotU] };
  out.xStmt = ax.stmt; out.yStmt = ay.stmt; out.margins = M;
  return out;
}

/** 축 끝 좌표 수정 편집: `(a, 0) -- (b, 0)` / `(0, a) -- (0, b)` 의 숫자만 교체 */
export function axisEdits(scene, axisPlan) {
  const edits = [];
  if (!axisPlan.x || !axisPlan.y) return edits;
  const NUMR = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)`;
  const fmt = (v) => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : String(v));
  const rep = (st, isX, from, to) => {
    const txt = scene.body.slice(st.start, st.end);
    const re = isX ? new RegExp(String.raw`\(\s*(${NUMR})\s*,\s*0\s*\)(\s*--\s*)\(\s*(${NUMR})\s*,\s*0\s*\)`) : new RegExp(String.raw`\(\s*0\s*,\s*(${NUMR})\s*\)(\s*--\s*)\(\s*0\s*,\s*(${NUMR})\s*\)`);
    const m = re.exec(txt); if (!m) return;
    const replacement = isX ? `(${fmt(from)}, 0)${m[2]}(${fmt(to)}, 0)` : `(0, ${fmt(from)})${m[2]}(0, ${fmt(to)})`;
    if (Number(m[1]) === from && Number(m[3]) === to) return;
    edits.push({ kind: isX ? "axis-x" : "axis-y", start: st.start + m.index, end: st.start + m.index + m[0].length, replacement, old: [Number(m[1]), Number(m[3])], new: [from, to] });
  };
  rep(axisPlan.xStmt, true, axisPlan.x.new[0], axisPlan.x.new[1]);
  rep(axisPlan.yStmt, false, axisPlan.y.new[0], axisPlan.y.new[1]);
  return edits;
}

export function applyEdits(body, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].end > sorted[i - 1].start) throw new Error("편집 범위 겹침");
  let out = body;
  for (const e of sorted) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  return out;
}
