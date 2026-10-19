// 평가 지표: 추천 결과 vs 원본 vs 사람이 만든 최종본. (측정 가능한 항목만; 값을 지어내지 않는다)
import { minDistPolylines } from "../../smart-label-engine/src/geometry.mjs";
import { assignStrokes } from "./algorithm.mjs";

const r2 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? n : Math.round(n * 100) / 100);
const center = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
const rectPoly = (b) => ({ pts: [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]], closed: true });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const bboxPtDist = (p, b) => Math.hypot(Math.max(b.x0 - p[0], 0, p[0] - b.x1), Math.max(b.y0 - p[1], 0, p[1] - b.y1));

export function functionNodes(scene) { return scene.nodes.filter((n) => n.role === "function" && n.bbox).sort((a, b) => a.start - b.start); }

/** 라벨의 대응 곡선 끝점·방향·간격 특징 */
export function labelFeatures(scene, node, stroke) {
  const s = stroke; const b = node.bbox; const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const E = [s.pts[0], s.pts[s.pts.length - 1]];
  const d = E.map((e) => bboxPtDist(e, b)); const ei = d[0] <= d[1] ? 0 : 1; const e = E[ei]; const c = center(b);
  const side = b.y0 >= e[1] - 1 ? "above" : b.y1 <= e[1] + 1 ? "below" : c[0] > e[0] ? "right" : "left";
  const others = scene.strokes.filter((q) => q.index !== s.index);
  const cl = (q) => minDistPolylines([rectPoly(b)], [{ pts: q.pts, closed: false }]) - q.halfWidth;
  return { end: ei, side, endGapPt: r2(d[ei]), alpha: r2((c[0] - e[0]) / (w / 2)), widthPt: r2(w), ownClearancePt: r2(cl(s)), minOtherClearancePt: others.length ? r2(Math.min(...others.map(cl))) : null, endpoint: e.map(r2) };
}

function collisionsFor(scene) {
  const out = {};
  const an = scene.analysis; if (!an || !an.collisions) return out;
  for (const r of an.collisions.results) if (r.verdict === "inkCollision" || r.verdict === "possibleCollision") {
    const id = r.a && r.a.sourceId; if (!id) continue;
    (out[id] = out[id] || []).push({ relation: r.relation, verdict: r.verdict, other: r.b && (r.b.sourceId || `${r.b.kind}#${r.b.pathIndex}`) || null, clearance: r.inkClearancePt ?? null });
  }
  return out;
}

const axisEnds = (sc) => (sc.axes.x && sc.axes.y ? { left: Math.min(sc.axes.x.from, sc.axes.x.to) * sc.units.xU, right: Math.max(sc.axes.x.from, sc.axes.x.to) * sc.units.xU, bottom: Math.min(sc.axes.y.from, sc.axes.y.to) * sc.units.yU, top: Math.max(sc.axes.y.from, sc.axes.y.to) * sc.units.yU } : null);
function contentBox(sc) {
  let b = null; const add = (x0, y0, x1, y1) => { b = b ? { x0: Math.min(b.x0, x0), y0: Math.min(b.y0, y0), x1: Math.max(b.x1, x1), y1: Math.max(b.y1, y1) } : { x0, y0, x1, y1 }; };
  for (const s of sc.strokes) if (s.kind !== "axis") for (const p of s.pts) add(p[0], p[1], p[0], p[1]);
  for (const n of sc.nodes) if (n.bbox && !["axisLabel", "origin", "marker"].includes(n.role)) add(n.bbox.x0, n.bbox.y0, n.bbox.x1, n.bbox.y1);
  return b;
}
export function axisMargins(sc) { const A = axisEnds(sc), C = contentBox(sc); return A && C ? { right: r2(A.right - C.x1), left: r2(C.x0 - A.left), top: r2(A.top - C.y1), bottom: r2(C.y0 - A.bottom) } : null; }

/** 도메인 변경 여부 (원본 vs 최종): plot 문장 순서대로 비교 */
export function domainChanges(sceneA, sceneB) {
  const pa = sceneA.stmts.filter((s) => s.type === "plot"), pb = sceneB.stmts.filter((s) => s.type === "plot");
  const out = [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const a = pa[i] && pa[i].domain, b = pb[i] && pb[i].domain;
    if (JSON.stringify(a) !== JSON.stringify(b) || (pa[i] && pb[i] && pa[i].expr !== pb[i].expr)) out.push({ plot: i, before: a, after: b, exprChanged: !!(pa[i] && pb[i] && pa[i].expr !== pb[i].expr) });
  }
  return out;
}

/**
 * @param {object} orig 원본 scene  @param {object} rec 추천 scene(recScene) | null  @param {object|null} fin 사람이 만든 최종 scene
 */
export function evaluateFigure(orig, rec, fin) {
  const ev = { labels: [], axes: null, vertices: [], domainChanges: null };
  const fo = functionNodes(orig), fr = rec ? functionNodes(rec) : [], ff = fin ? functionNodes(fin) : [];
  const ao = assignStrokes(orig, fo), ar = rec ? assignStrokes(rec, fr) : null, af = fin ? assignStrokes(fin, ff) : null;
  const colRec = rec ? collisionsFor(rec) : {}, colFin = fin ? collisionsFor(fin) : {}, colOrig = collisionsFor(orig);
  fo.forEach((n0, i) => {
    const n1 = fr[i], n2 = ff[i];
    const item = { label: n0.label, assignment: ao.get(n0.id) && ao.get(n0.id).how };
    const f0 = ao.get(n0.id) && ao.get(n0.id).stroke ? labelFeatures(orig, n0, ao.get(n0.id).stroke) : null;
    item.original = { features: f0, inkCollisions: (colOrig[n0.id] || []).length };
    if (n1 && ar.get(n1.id) && ar.get(n1.id).stroke) {
      const f1 = labelFeatures(rec, n1, ar.get(n1.id).stroke);
      item.recommended = { features: f1, collisions: colRec[n1.id] || [], movedFromOriginalPt: r2(dist(center(n0.bbox), center(n1.bbox))), shift: [n1.xshift, n1.yshift] };
    }
    if (n2 && af.get(n2.id) && af.get(n2.id).stroke) {
      const f2 = labelFeatures(fin, n2, af.get(n2.id).stroke);
      item.human = { features: f2, collisions: colFin[n2.id] || [], movedFromOriginalPt: r2(dist(center(n0.bbox), center(n2.bbox))), shift: [n2.xshift, n2.yshift] };
    }
    if (item.recommended && item.human) {
      item.diff = { centerDistancePt: r2(dist(center(n1.bbox), center(n2.bbox))), sameEnd: item.recommended.features.end === item.human.features.end, sameSide: item.recommended.features.side === item.human.features.side, endGapDiffPt: r2(item.recommended.features.endGapPt - item.human.features.endGapPt) };
    }
    ev.labels.push(item);
  });
  const Ar = rec ? axisEnds(rec) : null, Af = fin ? axisEnds(fin) : null, Ao = axisEnds(orig);
  if (Ao) ev.axes = { originalEnds: Object.fromEntries(Object.entries(Ao).map(([k, v]) => [k, r2(v)])), recommendedEnds: Ar && Object.fromEntries(Object.entries(Ar).map(([k, v]) => [k, r2(v)])), humanEnds: Af && Object.fromEntries(Object.entries(Af).map(([k, v]) => [k, r2(v)])),
    recVsHumanPt: Ar && Af ? Object.fromEntries(Object.keys(Ar).map((k) => [k, r2(Ar[k] - Af[k])])) : null, marginsRecommended: rec ? axisMargins(rec) : null, marginsHuman: fin ? axisMargins(fin) : null, marginsOriginal: axisMargins(orig) };
  // 꼭짓점/원점 라벨 근접성(기준점→bbox)
  for (const n of orig.nodes.filter((q) => q.role === "vertex" && q.bbox && q.anchor)) {
    const find = (sc) => sc && sc.nodes.find((q) => q.role === "vertex" && q.label === n.label && q.bbox);
    const nr = find(rec), nf = find(fin);
    ev.vertices.push({ label: n.trimmed, originalPt: r2(bboxPtDist(n.anchor, n.bbox)), recommendedPt: nr && nr.anchor ? r2(bboxPtDist(nr.anchor, nr.bbox)) : null, humanPt: nf && nf.anchor ? r2(bboxPtDist(nf.anchor, nf.bbox)) : null });
  }
  if (fin) ev.domainChanges = domainChanges(orig, fin);
  return ev;
}
