// 평가원 스타일 라벨 배치 추천 알고리즘 (프로토타입 v1).
// 추천 대상: (1) 함수식/직선 방정식 라벨의 xshift/yshift, (2) 좌표축 끝 좌표(길이).
// 수정하지 않는 것: plot domain·함수식·도형·점 마커·꼭짓점/원점/축 라벨·폰트 scale·선 두께.
// 규칙 출처: 샘플 1~5 사람 최종본의 정량 측정 (output/dev-measurements.json).
import { minDistPolylines } from "../../smart-label-engine/src/geometry.mjs";

/** 고정 파라미터 (샘플 1~5 로 결정). 고정 후에는 변경하지 않는다 → FROZEN.json 에 해시 기록. */
export const PARAMS = {
  gapAbove: 3.0,   // 위쪽 배치 시 곡선 끝점 ↔ 라벨 ink bbox 하단 간격(pt). dev 측정 above(6개) 중앙값 2.8 → loo.mjs deriveParams 가 3 으로 도출
  gapBelow: 2.5,   // 아래쪽: dev 측정 below: 2.3, 3.7, 2.3, 1.2 / 중앙값 ≈ 2.3
  gapSide: 4.0,    // 좌우 배치(접선이 거의 수평일 때)
  alphaStep: 0.125, // 라벨 가로 정렬 후보 간격 (alpha=0: 끝점 중앙, ±1: 라벨 한쪽 가장자리가 끝점)
  cHard: 4.0,      // 다른 선(축/곡선/선분)과의 최소 허용 간격(pt). dev 최소 5.6(정상 배치)
  cOwn: 0.0,       // 자기 곡선과의 최소 간격(pt, 선 폭 제외). dev 에서 접촉(−0.1~0)도 있음
  cPref: 10.0,     // 선호 여백(pt). dev 중앙값 ≈ 9~10
  mLabel: 4.0,     // 다른 라벨과의 최소 간격
  keepNearEnd: 12.0,   // 원래 위치가 곡선 끝에서 이 거리 이내이고 충돌이 없으면 이동하지 않음(dev: 모든 사람 배치가 끝점 ≤7pt)
  wClear: 20, wSide: 8, wEnd: 8, wAlpha: 6, wGrow: 0.5,
  margins: { right: 16, left: 19.5, top: 18.5, bottom: 4 }, // dev 에서 축을 늘린 변의 중앙값(pt)
  axisIgnoreEndWithin: 1.5, // 곡선 끝이 축 끝과 1.5pt 이내면 의도된 끝으로 보고 여백 계산에서 제외
  shiftRound: 1,   // xshift/yshift 반올림 단위(pt) — 사람 최종본이 정수 pt 사용
};

const rectPoly = (b) => ({ pts: [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]], closed: true });
const bboxGapRect = (a, b) => Math.hypot(Math.max(a.x0 - b.x1, 0, b.x0 - a.x1), Math.max(a.y0 - b.y1, 0, b.y0 - a.y1));
const clearanceToStroke = (bbox, s) => minDistPolylines([rectPoly(bbox)], [{ pts: s.pts, closed: false }]) - s.halfWidth;

/** 라벨 → 곡선/선 배정: ① 인라인 소속 ② 식 수치 일치 ③ 남은 곡선 중 최근접(plot 우선) */
export function assignStrokes(scene, targets) {
  const res = new Map(); const claimed = new Set();
  const strokeOfPath = (p) => scene.strokes.find((s) => s.index === p.index);
  for (const n of targets) if (n.kind === "inline" && n.stmt && n.stmt.path) { res.set(n.id, { how: "inline", stroke: strokeOfPath(n.stmt.path) }); claimed.add(res.get(n.id).stroke.index); }
  for (const n of targets) {
    if (res.has(n.id)) continue;
    const f = scene.compileLabelFunction(n.label);
    if (!f) continue;
    for (const st of scene.stmts) if (st.type === "plot" && st.fn && st.domain && st.path && !claimed.has(st.path.index)) {
      let ok = true;
      for (let k = 0; k < 5; k++) { const x = st.domain[0] + ((st.domain[1] - st.domain[0]) * (k + 0.5)) / 5; if (!(Math.abs(f(x) - st.fn(x)) < 1e-6)) { ok = false; break; } }
      if (ok) { res.set(n.id, { how: "expr-match", stroke: strokeOfPath(st.path) }); claimed.add(st.path.index); break; }
    }
  }
  const rest = targets.filter((n) => !res.has(n.id));
  const pool = (plotOnly) => scene.strokes.filter((s) => s.kind !== "axis" && !claimed.has(s.index) && (!plotOnly || (s.stmt && s.stmt.type === "plot")));
  for (const n of rest) {
    const a = n.at || n.inlineAnchor || n.anchor;
    let cands = pool(true); if (!cands.length) cands = pool(false);
    let best = null;
    for (const s of cands) { const d = minDistPolylines([{ pts: [a, a], closed: false }], [{ pts: s.pts, closed: false }]); if (!best || d < best.d) best = { d, s }; }
    if (best) { res.set(n.id, { how: "nearest-unclaimed", stroke: best.s, uncertain: true }); claimed.add(best.s.index); }
  }
  return res;
}

function endInfo(stroke, which) {
  const p = stroke.pts, n = p.length, k = Math.min(3, n - 1);
  const e = which === 0 ? p[0] : p[n - 1], nb = which === 0 ? p[k] : p[n - 1 - k];
  const tx = e[0] - nb[0], ty = e[1] - nb[1], l = Math.hypot(tx, ty) || 1;
  return { point: e, t: [tx / l, ty / l] };
}

/**
 * @param {ReturnType<import("./scene.mjs").buildScene>} scene  (ok=true)
 * @param {typeof PARAMS} P
 */
export function planLabels(scene, P = PARAMS, axisPt = null) {
  const plan = { placements: [], skipped: [], notes: [] };
  const targets = scene.nodes.filter((n) => n.role === "function" && n.bbox);
  const fixed = scene.nodes.filter((n) => n.bbox && n.role !== "function" && n.role !== "marker");
  const assigned = assignStrokes(scene, targets);
  // 장애물 선: 축은 (계획된) 확장 길이로 대체 — 사람 최종본에서 연장된 축과 라벨이 부딪히는 문제 방지
  const strokesEff = scene.strokes.map((s) => {
    if (s.kind !== "axis" || !axisPt) return s;
    const horizontal = Math.abs(s.pts[0][1] - s.pts[s.pts.length - 1][1]) < 1e-6;
    return { ...s, pts: horizontal ? [[axisPt.left, s.pts[0][1]], [axisPt.right, s.pts[0][1]]] : [[s.pts[0][0], axisPt.bottom], [s.pts[0][0], axisPt.top]] };
  });
  const placedBoxes = [];
  let content = null; const addC = (b) => { content = content ? { x0: Math.min(content.x0, b.x0), y0: Math.min(content.y0, b.y0), x1: Math.max(content.x1, b.x1), y1: Math.max(content.y1, b.y1) } : { ...b }; };
  for (const s of scene.strokes) if (s.kind !== "axis") for (const p of s.pts) addC({ x0: p[0], y0: p[1], x1: p[0], y1: p[1] });
  for (const n of fixed) if (n.role !== "axisLabel" && n.role !== "origin") addC(n.bbox);

  for (const n of targets) {
    if (!n.usable) { plan.skipped.push({ id: n.id, label: n.label, reason: "노드 매칭이 confirmed 가 아님(" + n.confidence + ")" }); continue; }
    if (!n.scale) { plan.skipped.push({ id: n.id, label: n.label, reason: "노드 배율 불명" }); continue; }
    const a = assigned.get(n.id);
    if (!a || !a.stroke) { plan.skipped.push({ id: n.id, label: n.label, reason: "대응 곡선/선을 찾지 못함" }); continue; }
    const s = a.stroke; const w = n.bbox.x1 - n.bbox.x0, h = n.bbox.y1 - n.bbox.y0;
    const others = strokesEff.filter((q) => q.index !== s.index);
    const obsBoxes = [...fixed.map((q) => q.bbox), ...placedBoxes];
    const ends = [endInfo(s, 0), endInfo(s, 1)];
    const anchor0 = n.at || n.inlineAnchor || n.anchor || [(n.bbox.x0 + n.bbox.x1) / 2, (n.bbox.y0 + n.bbox.y1) / 2];
    // 선호 끝: 오른쪽 끝(사람 최종본 10개 중 8개), x 가 같으면(수직선 등) 원래 기준점에 가까운 끝
    const dx = ends[1].point[0] - ends[0].point[0];
    const preferredEnd = Math.abs(dx) > 2 ? (dx > 0 ? 1 : 0) : (Math.hypot(ends[0].point[0] - anchor0[0], ends[0].point[1] - anchor0[1]) <= Math.hypot(ends[1].point[0] - anchor0[0], ends[1].point[1] - anchor0[1]) ? 0 : 1);

    const evalBox = (bb) => {
      let minOther = Infinity;
      for (const q of others) { const c = clearanceToStroke(bb, q); if (c < minOther) minOther = c; }
      const own = clearanceToStroke(bb, s);
      let labelGap = Infinity; for (const ob of obsBoxes) labelGap = Math.min(labelGap, bboxGapRect(bb, ob));
      return { minOther, own, labelGap };
    };
    // 원 위치가 이미 곡선 '끝' 가까이에 충돌 없이 놓여 있으면 유지
    const e0 = evalBox(n.bbox);
    const endDist = Math.min(...ends.map((e) => Math.hypot(Math.max(n.bbox.x0 - e.point[0], 0, e.point[0] - n.bbox.x1), Math.max(n.bbox.y0 - e.point[1], 0, e.point[1] - n.bbox.y1))));
    if (e0.minOther >= P.cHard && e0.own >= P.cOwn && e0.labelGap >= P.mLabel && endDist <= P.keepNearEnd) {
      plan.placements.push({ id: n.id, label: n.label, action: "keep", reason: `원 위치가 곡선 끝에서 ${Math.round(endDist * 10) / 10}pt 이내이고 충돌 없음`, stroke: s.index, how: a.how, bbox: n.bbox, eval: e0 });
      placedBoxes.push(n.bbox); continue;
    }
    const cands = [];
    for (const ei of [0, 1]) {
      const { point: E, t } = ends[ei];
      const prefAbove = t[1] >= 0;
      for (const side of ["above", "below"]) for (let al = -1; al <= 1.0001; al += P.alphaStep) {
        const cx = E[0] + al * (w / 2);
        const bb = side === "above" ? { x0: cx - w / 2, x1: cx + w / 2, y0: E[1] + P.gapAbove, y1: E[1] + P.gapAbove + h } : { x0: cx - w / 2, x1: cx + w / 2, y1: E[1] - P.gapBelow, y0: E[1] - P.gapBelow - h };
        cands.push({ bb, ei, side, alpha: al, sideMismatch: (side === "above") !== prefAbove });
      }
      if (Math.abs(t[1]) < 0.5) for (const side of ["right", "left"]) for (let be = -1; be <= 1.0001; be += 0.25) {
        const cy = E[1] + be * (h / 2);
        const bb = side === "right" ? { x0: E[0] + P.gapSide, x1: E[0] + P.gapSide + w, y0: cy - h / 2, y1: cy + h / 2 } : { x1: E[0] - P.gapSide, x0: E[0] - P.gapSide - w, y0: cy - h / 2, y1: cy + h / 2 };
        cands.push({ bb, ei, side, alpha: be, sideMismatch: (side === "right") !== (t[0] >= 0) });
      }
    }
    let best = null; const scored = [];
    for (const c of cands) {
      const ev = evalBox(c.bb);
      const hard = ev.minOther < P.cHard || ev.own < P.cOwn || ev.labelGap < P.mLabel;
      const grow = (Math.max(content.x1, c.bb.x1) - Math.min(content.x0, c.bb.x0) - (content.x1 - content.x0)) + (Math.max(content.y1, c.bb.y1) - Math.min(content.y0, c.bb.y0) - (content.y1 - content.y0));
      const clearPen = Math.max(0, P.cPref - Math.min(ev.minOther, ev.labelGap)) / P.cPref;
      const cost = P.wClear * clearPen * clearPen + (c.sideMismatch ? P.wSide : 0) + (c.ei !== preferredEnd ? P.wEnd : 0) + P.wAlpha * Math.abs(c.alpha) + P.wGrow * (grow / 100);
      scored.push({ ...c, ev, hard, cost });
      if (!hard && (!best || cost < best.cost)) best = { ...c, ev, cost };
    }
    if (!best) { plan.skipped.push({ id: n.id, label: n.label, reason: "허용 간격을 만족하는 후보 없음 (cHard=" + P.cHard + ") — 원본 유지(수동 확인)" }); placedBoxes.push(n.bbox); continue; }
    plan.placements.push({ id: n.id, label: n.label, action: "move", stroke: s.index, how: a.how, uncertainAssignment: !!a.uncertain, end: best.ei, preferredEnd, side: best.side, alpha: Math.round(best.alpha * 1000) / 1000, cost: Math.round(best.cost * 100) / 100, bbox: best.bb, from: n.bbox, eval: best.ev, candidates: scored.length, feasible: scored.filter((q) => !q.hard).length });
    placedBoxes.push(best.bb); addC(best.bb);
  }
  plan.assignments = Object.fromEntries([...assigned.entries()].map(([k, v]) => [k, { how: v.how, stroke: v.stroke && v.stroke.index, uncertain: !!v.uncertain }]));
  return plan;
}

/** 이동 계획 → 노드 옵션 수정 (xshift/yshift = 기존 + 필요 이동량 ÷ 노드 배율) */
export function shiftEdits(scene, plan, P = PARAMS) {
  const edits = [], report = [];
  for (const pl of plan.placements) {
    if (pl.action !== "move") continue;
    const n = scene.nodes.find((q) => q.id === pl.id);
    const dx = pl.bbox.x0 - pl.from.x0, dy = pl.bbox.y0 - pl.from.y0; // 필요 이동량 (pt, y 위쪽)
    const newX = Math.round(((n.xshift || 0) + dx / n.scale[0]) / P.shiftRound) * P.shiftRound;
    const newY = Math.round(((n.yshift || 0) + dy / n.scale[1]) / P.shiftRound) * P.shiftRound;
    const text = setShifts(n, newX, newY);
    edits.push({ kind: "label-shift", id: n.id, start: text.start, end: text.end, replacement: text.replacement });
    report.push({ id: n.id, label: n.label, oldShift: [n.xshift, n.yshift], newShift: [newX, newY], scale: n.scale, neededMovePt: [Math.round(dx * 10) / 10, Math.round(dy * 10) / 10] });
  }
  return { edits, report };
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
  let C = null; const add = (x0, y0, x1, y1) => { C = C ? { x0: Math.min(C.x0, x0), y0: Math.min(C.y0, y0), x1: Math.max(C.x1, x1), y1: Math.max(C.y1, y1) } : { x0, y0, x1, y1 }; };
  const ign = P.axisIgnoreEndWithin;
  for (const s of scene.strokes) if (s.kind !== "axis") for (const p of s.pts) {
    // 축 끝과 일치하는 곡선 끝은 의도된 것으로 보고 제외
    if (Math.abs(p[0] - xl) <= ign || Math.abs(p[0] - xr) <= ign || Math.abs(p[1] - yb) <= ign || Math.abs(p[1] - yt) <= ign) { add(p[0], p[1], p[0], p[1]); continue; }
    add(p[0], p[1], p[0], p[1]);
  }
  const placedById = new Map(plan.placements.map((p) => [p.id, p]));
  for (const n of scene.nodes) { if (!n.bbox || ["axisLabel", "origin", "marker"].includes(n.role)) continue; const pl = placedById.get(n.id); const b = pl && pl.action === "move" ? pl.bbox : n.bbox; add(b.x0, b.y0, b.x1, b.y1); }
  out.content = C;
  const M = P.margins;
  const need = { right: C.x1 + M.right, left: C.x0 - M.left, top: C.y1 + M.top, bottom: C.y0 - M.bottom };
  const ends = { right: Math.max(xr, need.right), left: Math.min(xl, need.left), top: Math.max(yt, need.top), bottom: Math.min(yb, need.bottom) };
  // 곡선 끝이 축 끝과 같은 변은 (사람 최종본처럼) 그대로 둔다: 곡선 점이 축 끝 ign 이내면 그 변은 유지
  const nearEnd = { right: false, left: false, top: false, bottom: false };
  for (const s of scene.strokes) if (s.kind !== "axis") for (const p of [s.pts[0], s.pts[s.pts.length - 1]]) { if (Math.abs(p[0] - xr) <= ign) nearEnd.right = true; if (Math.abs(p[0] - xl) <= ign) nearEnd.left = true; if (Math.abs(p[1] - yt) <= ign) nearEnd.top = true; if (Math.abs(p[1] - yb) <= ign) nearEnd.bottom = true; }
  const u1 = (v) => Math.round(v * 10) / 10;
  const L = nearEnd.left ? xl : ends.left, R = nearEnd.right ? xr : ends.right, B = nearEnd.bottom ? yb : ends.bottom, T = nearEnd.top ? yt : ends.top;
  const fwd = ax.from <= ax.to, fwdY = ay.from <= ay.to;
  // 변경이 없는 변은 원래 숫자를 그대로 사용(반올림 오차로 불필요하게 바꾸지 않음)
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
