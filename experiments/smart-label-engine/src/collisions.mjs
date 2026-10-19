// 스마트 라벨 엔진 v0.1 — 충돌/근접 분석 (분석 전용, 위치를 바꾸지 않는다).
// 글리프 실제 윤곽(outline)과 선 중심선(폭 고려) 사이의 거리로 "실제 획 충돌"을 판정하고,
// bbox 교차만 있는 경우는 possibleCollision 으로 분리한다.
import { bboxIntersects, bboxGap, bboxOverlapArea, expandBBox, minDistPolylines, round3, segsIntersect } from "./geometry.mjs";

/** nearMissPt: 획 사이 간격이 이 값보다 작으면 "근접"(오류 아님, 정보). 평가원 조판은 라벨을 선/점에 바짝 붙이므로 오류로 보지 않는다. */
export const COLLISION_DEFAULTS = { nearMissPt: 1.5, prefilterPt: 6 };

const SEVERITY = { inkCollision: "error-candidate", possibleCollision: "warning", nearMiss: "info", clear: "none", unverifiable: "unverifiable" };

function polylineHitsBBox(pts, b) {
  const inside = (p) => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1;
  if (pts.some(inside)) return true;
  const c = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
  for (let i = 0; i + 1 < pts.length; i++) for (let k = 0; k < 4; k++) if (segsIntersect(pts[i], pts[i + 1], c[k], c[(k + 1) % 4])) return true;
  return false;
}

/**
 * @param {ReturnType<import("./svg-measure.mjs").measureSvg>} svg
 * @param {{sourceIdBySvgIndex?:Map<number,string>, anchorBySvgIndex?:Map<number,[number,number]>, basicBySvgIndex?:Map<number,string>}} ctx
 */
export function analyzeCollisions(svg, ctx = {}, options = {}) {
  const cfg = { ...COLLISION_DEFAULTS, ...options };
  const labels = svg.nodes.filter((n) => !n.empty && n.supported && n.bboxTikz);
  const results = []; const skipped = [];
  for (const n of svg.nodes) if (!n.empty && (!n.supported || !n.bboxTikz)) skipped.push({ svgNodeIndex: n.index, reasons: n.reasons.length ? n.reasons : ["no ink bbox"] });
  const sid = (i) => ctx.sourceIdBySvgIndex?.get(i) ?? null;

  const push = (r) => results.push({ ...r, severity: SEVERITY[r.verdict] });

  // A. 라벨-라벨
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = labels[i], b = labels[j];
    const base = { relation: "label-label", a: { svgNodeIndex: a.index, sourceId: sid(a.index), chars: a.chars }, b: { svgNodeIndex: b.index, sourceId: sid(b.index), chars: b.chars }, intent: "unknown" };
    const gap = bboxGap(a.bboxTikz, b.bboxTikz), inter = bboxIntersects(a.bboxTikz, b.bboxTikz);
    if (!inter && gap > cfg.prefilterPt) { if (options.includeClear) push({ ...base, verdict: "clear", bboxIntersects: false, bboxGapPt: round3(gap), inkChecked: false }); continue; }
    if (!(a.inkChecked && b.inkChecked)) { push({ ...base, verdict: inter || gap <= cfg.nearMissPt ? "unverifiable" : "clear", bboxIntersects: inter, bboxOverlapAreaPt2: round3(bboxOverlapArea(a.bboxTikz, b.bboxTikz)), inkChecked: false, note: "glyph outline unavailable; bbox only" }); continue; }
    const d = minDistPolylines(a.geom.outline, b.geom.outline);
    const verdict = d === 0 ? "inkCollision" : inter ? "possibleCollision" : d < cfg.nearMissPt ? "nearMiss" : "clear";
    push({ ...base, verdict, bboxIntersects: inter, bboxOverlapAreaPt2: round3(bboxOverlapArea(a.bboxTikz, b.bboxTikz)), inkClearancePt: round3(d), inkChecked: true });
  }

  // B~D. 라벨-선
  const lineKinds = { axis: "label-axis", curve: "label-curve", dashed: "label-dashed", line: "label-line" };
  for (const p of svg.paths) {
    const relation = lineKinds[p.kind];
    if (!relation) continue;
    const pb = p.bbox;
    for (const l of labels) {
      const expanded = expandBBox(l.bboxTikz, p.halfWidth + cfg.prefilterPt);
      const base = { relation, a: { svgNodeIndex: l.index, sourceId: sid(l.index), chars: l.chars }, b: { pathIndex: p.index, kind: p.kind, halfWidthPt: p.halfWidth }, intent: "unknown" };
      if (!bboxIntersects(pb, expanded)) { if (options.includeClear) push({ ...base, verdict: "clear", bboxIntersects: false, inkChecked: false }); continue; }
      const bboxHit = polylineHitsBBox(p.geom.pts, expandBBox(l.bboxTikz, p.halfWidth));
      if (!l.inkChecked) { push({ ...base, verdict: bboxHit ? "unverifiable" : "clear", bboxIntersects: bboxHit, inkChecked: false, note: "glyph outline unavailable; bbox only" }); continue; }
      const d = minDistPolylines(l.geom.outline, [p.geom]);
      const clearance = d - p.halfWidth;
      const verdict = clearance <= 0 ? "inkCollision" : bboxHit ? "possibleCollision" : clearance < cfg.nearMissPt ? "nearMiss" : "clear";
      const tickLike = ctx.basicBySvgIndex?.get(l.index);
      const intent = relation === "label-axis" && (tickLike === "number" || tickLike === "letter") && verdict !== "inkCollision" ? "likelyIntentional" : "unknown";
      push({ ...base, intent, verdict, bboxIntersects: bboxHit, inkClearancePt: round3(clearance), centerlineDistancePt: round3(d), inkChecked: true });
    }
  }

  // 마커/채움 도형(화살촉 포함)
  for (const p of svg.paths) {
    if (p.kind !== "marker" && p.kind !== "filled") continue;
    for (const l of labels) {
      const base = { relation: p.kind === "marker" ? "label-marker" : "label-arrowhead", a: { svgNodeIndex: l.index, sourceId: sid(l.index), chars: l.chars }, b: { pathIndex: p.index, kind: p.kind }, intent: "unknown" };
      if (bboxGap(p.bbox, l.bboxTikz) > cfg.prefilterPt) continue;
      if (!l.inkChecked) { push({ ...base, verdict: "unverifiable", inkChecked: false }); continue; }
      const d = minDistPolylines(l.geom.outline, [p.geom]);
      const verdict = d === 0 ? "inkCollision" : bboxIntersects(p.bbox, l.bboxTikz) ? "possibleCollision" : d < cfg.nearMissPt ? "nearMiss" : "clear";
      const anchor = ctx.anchorBySvgIndex?.get(l.index);
      const mc = [(p.bbox.x0 + p.bbox.x1) / 2, (p.bbox.y0 + p.bbox.y1) / 2];
      const own = p.kind === "marker" && anchor && Math.hypot(anchor[0] - mc[0], anchor[1] - mc[1]) < 12;
      push({ ...base, intent: own && verdict !== "inkCollision" ? "likelyIntentional" : "unknown", verdict, bboxIntersects: bboxIntersects(p.bbox, l.bboxTikz), inkClearancePt: round3(d), inkChecked: true });
    }
  }
  const counts = {}; for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  return { config: cfg, results, counts, skippedLabels: skipped };
}
