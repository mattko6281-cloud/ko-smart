// 평가 지표 (v0.2): 추천 결과 vs 원본 vs 사람이 만든 최종본.
// * 자기 곡선 끝과의 의도적 근접/접촉(ownEndpointContact)을 실제 충돌(다른 곡선·축·라벨 침범)과 명확히 분리하여 기록한다.
// * 정의역(domain) 변경이 포함된 최종본에서는 곡선 형태 변화에 의한 끝점 이동과 순수 라벨 배치 차이를 분리한다.
import { minDistPolylines } from "../../smart-label-engine/src/geometry.mjs";
import { assignStrokes } from "./algorithm.mjs";

const r2 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? n : Math.round(n * 100) / 100);
const center = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
const rectPoly = (b) => ({ pts: [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]], closed: true });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const bboxPtDist = (p, b) => Math.hypot(Math.max(b.x0 - p[0], 0, p[0] - b.x1), Math.max(b.y0 - p[1], 0, p[1] - b.y1));
const bboxGapRect = (a, b) => Math.hypot(Math.max(a.x0 - b.x1, 0, b.x0 - a.x1), Math.max(a.y0 - b.y1, 0, b.y0 - a.y1));

export function functionNodes(scene) {
  return scene.nodes.filter((n) => n.role === "function" && n.bbox).sort((a, b) => a.start - b.start);
}

/** 라벨의 대응 곡선 끝점·방향·정렬·여백·자기곡선 접촉 여부 특징 */
export function labelFeatures(scene, node, stroke, strokeKind = "functionCurve") {
  const s = stroke;
  const b = node.bbox;
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const E = [s.pts[0], s.pts[s.pts.length - 1]];
  const d = E.map((e) => bboxPtDist(e, b));
  const ei = d[0] <= d[1] ? 0 : 1;
  const e = E[ei];
  const c = center(b);
  const alpha = r2((c[0] - e[0]) / (w / 2));
  const strictSide = b.y0 >= e[1] - 1 ? "above" : b.y1 <= e[1] + 1 ? "below" : c[0] > e[0] ? "right" : "left";
  // 끝점을 가로로 걸치면서(|alpha| <= 0.95) 중심이 끝점 위/아래로 치우친 의도적 접촉 배치의 실효 방향
  const effectiveSide =
    strictSide === "above" || strictSide === "below"
      ? strictSide
      : Math.abs(alpha) <= 0.95 && Math.abs(c[1] - e[1]) >= h * 0.25
      ? c[1] >= e[1]
        ? "above"
        : "below"
      : strictSide;

  const others = scene.strokes.filter((q) => q.index !== s.index);
  const cl = (q) => minDistPolylines([rectPoly(b)], [{ pts: q.pts, closed: false }]) - q.halfWidth;
  const ownClearancePt = r2(cl(s));
  const minOtherClearancePt = others.length ? r2(Math.min(...others.map(cl))) : null;

  const allBoxes = scene.nodes.filter((q) => q.bbox && q.role !== "marker" && q.id !== node.id);
  const minLabelGapPt = allBoxes.length ? r2(Math.min(...allBoxes.map((q) => bboxGapRect(b, q.bbox)))) : null;

  const ownEndpointContact = d[ei] <= 4.0 && ownClearancePt >= -1.0 && ownClearancePt <= 1.5;
  const labelCollisionCount = allBoxes.filter((q) => bboxGapRect(b, q.bbox) < 0.01).length;
  const otherStrokeInkCollisionCount = others.filter((q) => cl(q) < 0).length;

  return {
    end: ei,
    side: strictSide,
    effectiveSide,
    strokeKind,
    endGapPt: r2(d[ei]),
    alpha,
    absAlpha: r2(Math.abs(alpha)),
    widthPt: r2(w),
    heightPt: r2(h),
    ownClearancePt,
    ownEndpointContact,
    minOtherClearancePt,
    minLabelGapPt,
    labelCollisionCount,
    otherStrokeInkCollisionCount,
    endpoint: e.map(r2),
  };
}

function collisionsFor(scene, assignedMap) {
  const out = {};
  const an = scene.analysis;
  if (!an || !an.collisions) return out;
  for (const r of an.collisions.results) {
    if (r.verdict !== "inkCollision" && r.verdict !== "possibleCollision") continue;
    const id = r.a && r.a.sourceId;
    if (!id) continue;
    const a = assignedMap ? assignedMap.get(id) : null;
    const ownIdx = a && a.stroke ? a.stroke.index : null;
    const isOwnStroke = r.b && r.b.pathIndex !== undefined && ownIdx !== null && r.b.pathIndex === ownIdx;
    (out[id] = out[id] || []).push({
      relation: r.relation,
      verdict: r.verdict,
      other: (r.b && (r.b.sourceId || `${r.b.kind}#${r.b.pathIndex}`)) || null,
      clearance: r.inkClearancePt ?? null,
      isOwnStroke,
    });
  }
  return out;
}

const axisEnds = (sc) =>
  sc.axes.x && sc.axes.y
    ? {
        left: Math.min(sc.axes.x.from, sc.axes.x.to) * sc.units.xU,
        right: Math.max(sc.axes.x.from, sc.axes.x.to) * sc.units.xU,
        bottom: Math.min(sc.axes.y.from, sc.axes.y.to) * sc.units.yU,
        top: Math.max(sc.axes.y.from, sc.axes.y.to) * sc.units.yU,
      }
    : null;

function contentBox(sc) {
  let b = null;
  const add = (x0, y0, x1, y1) => {
    b = b ? { x0: Math.min(b.x0, x0), y0: Math.min(b.y0, y0), x1: Math.max(b.x1, x1), y1: Math.max(b.y1, y1) } : { x0, y0, x1, y1 };
  };
  for (const s of sc.strokes) if (s.kind !== "axis") for (const p of s.pts) add(p[0], p[1], p[0], p[1]);
  for (const n of sc.nodes) if (n.bbox && !["axisLabel", "origin", "marker"].includes(n.role)) add(n.bbox.x0, n.bbox.y0, n.bbox.x1, n.bbox.y1);
  return b;
}

export function axisMargins(sc) {
  const A = axisEnds(sc), C = contentBox(sc);
  return A && C ? { right: r2(A.right - C.x1), left: r2(C.x0 - A.left), top: r2(A.top - C.y1), bottom: r2(C.y0 - A.bottom) } : null;
}

/** 도메인 변경 여부 (원본 vs 최종): plot 문장 순서대로 비교 */
export function domainChanges(sceneA, sceneB) {
  const pa = sceneA.stmts.filter((s) => s.type === "plot"), pb = sceneB.stmts.filter((s) => s.type === "plot");
  const out = [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const a = pa[i] && pa[i].domain, b = pb[i] && pb[i].domain;
    if (JSON.stringify(a) !== JSON.stringify(b) || (pa[i] && pb[i] && pa[i].expr !== pb[i].expr)) {
      out.push({ plot: i, before: a, after: b, exprChanged: !!(pa[i] && pb[i] && pa[i].expr !== pb[i].expr) });
    }
  }
  return out;
}

/**
 * @param {object} orig 원본 scene
 * @param {object|null} rec 추천 scene(recScene)
 * @param {object|null} fin 사람이 만든 최종 scene
 */
export function evaluateFigure(orig, rec, fin) {
  const ev = { labels: [], axes: null, vertices: [], domainChanges: null };
  const fo = functionNodes(orig), fr = rec ? functionNodes(rec) : [], ff = fin ? functionNodes(fin) : [];
  const ao = assignStrokes(orig, fo), ar = rec ? assignStrokes(rec, fr) : null, af = fin ? assignStrokes(fin, ff) : null;
  const colRec = rec ? collisionsFor(rec, ar) : {}, colFin = fin ? collisionsFor(fin, af) : {}, colOrig = collisionsFor(orig, ao);
  const domCh = fin ? domainChanges(orig, fin) : [];

  fo.forEach((n0, i) => {
    const n1 = fr[i], n2 = ff[i];
    const a0 = ao.get(n0.id);
    const item = {
      label: n0.label,
      assignment: a0 && a0.how,
      confirmedAssignment: !!(a0 && a0.confirmed),
      uncertainAssignment: !!(a0 && a0.uncertain),
      strokeKind: a0 && a0.strokeKind,
    };
    const f0 = a0 && a0.stroke ? labelFeatures(orig, n0, a0.stroke, a0.strokeKind) : null;
    const origAllCols = colOrig[n0.id] || [];
    item.original = {
      features: f0,
      inkCollisions: origAllCols.filter((c) => !c.isOwnStroke && c.verdict === "inkCollision").length,
      otherCollisions: origAllCols.filter((c) => !c.isOwnStroke),
      ownStrokeNotes: origAllCols.filter((c) => c.isOwnStroke),
    };
    if (n1 && ar && ar.get(n1.id) && ar.get(n1.id).stroke) {
      const a1 = ar.get(n1.id);
      const f1 = labelFeatures(rec, n1, a1.stroke, a1.strokeKind);
      const allCols = colRec[n1.id] || [];
      item.recommended = {
        features: f1,
        collisions: allCols.filter((c) => !c.isOwnStroke),
        ownStrokeNotes: allCols.filter((c) => c.isOwnStroke),
        movedFromOriginalPt: r2(dist(center(n0.bbox), center(n1.bbox))),
        shift: [n1.xshift, n1.yshift],
      };
    }
    if (n2 && af && af.get(n2.id) && af.get(n2.id).stroke) {
      const a2 = af.get(n2.id);
      const f2 = labelFeatures(fin, n2, a2.stroke, a2.strokeKind);
      const allCols = colFin[n2.id] || [];
      item.human = {
        features: f2,
        collisions: allCols.filter((c) => !c.isOwnStroke),
        ownStrokeNotes: allCols.filter((c) => c.isOwnStroke),
        movedFromOriginalPt: r2(dist(center(n0.bbox), center(n2.bbox))),
        shift: [n2.xshift, n2.yshift],
      };
    }
    if (item.recommended && item.human) {
      const epDist = dist(item.recommended.features.endpoint, item.human.features.endpoint);
      item.diff = {
        centerDistancePt: r2(dist(center(n1.bbox), center(n2.bbox))),
        sameEnd: item.recommended.features.end === item.human.features.end,
        sameSide: item.recommended.features.side === item.human.features.side,
        effectiveSameSide: item.recommended.features.effectiveSide === item.human.features.effectiveSide,
        endGapDiffPt: r2(item.recommended.features.endGapPt - item.human.features.endGapPt),
        alphaDiff: r2(item.recommended.features.alpha - item.human.features.alpha),
        endpointShiftedByDomainPt: r2(epDist),
        confoundedByDomainChange: domCh.length > 0 && epDist > 1.0,
      };
    }
    ev.labels.push(item);
  });

  const Ar = rec ? axisEnds(rec) : null, Af = fin ? axisEnds(fin) : null, Ao = axisEnds(orig);
  if (Ao) {
    ev.axes = {
      originalEnds: Object.fromEntries(Object.entries(Ao).map(([k, v]) => [k, r2(v)])),
      recommendedEnds: Ar && Object.fromEntries(Object.entries(Ar).map(([k, v]) => [k, r2(v)])),
      humanEnds: Af && Object.fromEntries(Object.entries(Af).map(([k, v]) => [k, r2(v)])),
      recVsHumanPt: Ar && Af ? Object.fromEntries(Object.keys(Ar).map((k) => [k, r2(Ar[k] - Af[k])])) : null,
      marginsRecommended: rec ? axisMargins(rec) : null,
      marginsHuman: fin ? axisMargins(fin) : null,
      marginsOriginal: axisMargins(orig),
    };
  }

  for (const n of orig.nodes.filter((q) => q.role === "vertex" && q.bbox && q.anchor)) {
    const find = (sc) => sc && sc.nodes.find((q) => q.role === "vertex" && q.label === n.label && q.bbox);
    const nr = find(rec), nf = find(fin);
    ev.vertices.push({
      label: n.trimmed,
      originalPt: r2(bboxPtDist(n.anchor, n.bbox)),
      recommendedPt: nr && nr.anchor ? r2(bboxPtDist(nr.anchor, nr.bbox)) : null,
      humanPt: nf && nf.anchor ? r2(bboxPtDist(nf.anchor, nf.bbox)) : null,
    });
  }
  if (fin) ev.domainChanges = domCh;
  return ev;
}
