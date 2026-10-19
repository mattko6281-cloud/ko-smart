// 스마트 라벨 엔진 v0.1 — 기하 유틸 (순수 함수, 부작용 없음).
// 일부 로직(아핀 행렬/bbox)은 experiments/smart-label-svg/measure-labels.mjs 에서 검증된 계산을 복제했다.

/** @typedef {[number, number, number, number, number, number]} Matrix  [a,b,c,d,e,f]  x'=a x+c y+e, y'=b x+d y+f */
/** @typedef {{x0:number,y0:number,x1:number,y1:number}} BBox */
/** @typedef {[number, number]} Pt */

export const IDENTITY = /** @type {Matrix} */ ([1, 0, 0, 1, 0, 0]);

// TeX 단위 → TeX pt (TikZ 의 pt)
export const PT_PER = { pt: 1, cm: 28.45274, mm: 2.845274, in: 72.27, bp: 1.00375, em: 10, ex: 4.3 };

/** @param {Matrix} m @param {Matrix} n @returns {Matrix} m∘n */
export const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

/** @param {Matrix} m @returns {Matrix|null} 특이행렬이면 null */
export const inverse = (m) => {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
};

/** @param {Matrix} m @param {number} x @param {number} y @returns {Pt} */
export const applyPt = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * SVG transform 문자열 파싱. 지원: matrix, translate, scale, rotate(각도만). 그 외(skew 등)는 ok=false.
 * @returns {{m:Matrix, ok:boolean, reason?:string}}
 */
export function parseTransform(s) {
  /** @type {Matrix} */ let m = IDENTITY;
  if (!s) return { m, ok: true };
  const rest = s.replace(/(matrix|translate|scale|rotate)\(([^)]*)\)/g, "").trim();
  if (rest !== "") return { m, ok: false, reason: `unsupported transform syntax: ${rest.slice(0, 40)}` };
  for (const t of s.matchAll(/(matrix|translate|scale|rotate)\(([^)]*)\)/g)) {
    const v = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (v.some((x) => !Number.isFinite(x))) return { m, ok: false, reason: "non-numeric transform argument" };
    /** @type {Matrix} */ let n;
    if (t[1] === "matrix") { if (v.length !== 6) return { m, ok: false, reason: "matrix needs 6 args" }; n = /** @type {Matrix} */ (v); }
    else if (t[1] === "translate") n = [1, 0, 0, 1, v[0], v[1] ?? 0];
    else if (t[1] === "scale") n = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
    else { const r = (v[0] * Math.PI) / 180; n = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]; }
    m = mul(m, n);
  }
  return { m, ok: true };
}

/** @param {Pt[]} pts @returns {BBox} */
export function bboxOfPoints(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
/** @param {BBox|null} a @param {BBox|null} b */
export const unionBBox = (a, b) => (!a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
export const bboxCenter = (b) => /** @type {Pt} */ ([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]);
export const bboxOverlapArea = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
export const bboxIntersects = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
export const bboxGap = (a, b) => Math.hypot(Math.max(a.x0 - b.x1, 0, b.x0 - a.x1), Math.max(a.y0 - b.y1, 0, b.y0 - a.y1));
export const distPointBBox = (p, b) => Math.hypot(Math.max(b.x0 - p[0], 0, p[0] - b.x1), Math.max(b.y0 - p[1], 0, p[1] - b.y1));
export const expandBBox = (b, d) => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });
export const round3 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? n : Math.round(n * 1000) / 1000);
export const roundBBox = (b) => (b ? { x0: round3(b.x0), y0: round3(b.y0), x1: round3(b.x1), y1: round3(b.y1), w: round3(b.x1 - b.x0), h: round3(b.y1 - b.y0) } : null);

/** 점-선분 최소거리 */
export function distPointSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
/** 선분 교차 여부 (끝점 접촉 포함) */
export function segsIntersect(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  const on = (p, q, r) => Math.min(p[0], q[0]) - 1e-9 <= r[0] && r[0] <= Math.max(p[0], q[0]) + 1e-9 && Math.min(p[1], q[1]) - 1e-9 <= r[1] && r[1] <= Math.max(p[1], q[1]) + 1e-9;
  return (Math.abs(o1) < 1e-12 && on(a, b, c)) || (Math.abs(o2) < 1e-12 && on(a, b, d)) || (Math.abs(o3) < 1e-12 && on(c, d, a)) || (Math.abs(o4) < 1e-12 && on(c, d, b));
}
/** 선분-선분 최소거리 (교차하면 0) */
export function distSegSeg(a, b, c, d) {
  if (segsIntersect(a, b, c, d)) return 0;
  return Math.min(distPointSeg(a, c, d), distPointSeg(b, c, d), distPointSeg(c, a, b), distPointSeg(d, a, b));
}
/**
 * 두 폴리라인 집합 사이 최소거리. 각 폴리라인은 점 배열(closed=true면 마지막→처음 연결).
 * @param {{pts:Pt[], closed:boolean}[]} A @param {{pts:Pt[], closed:boolean}[]} B
 */
export function minDistPolylines(A, B) {
  let best = Infinity;
  const segs = (pl) => { const out = []; for (let i = 0; i + 1 < pl.pts.length; i++) out.push([pl.pts[i], pl.pts[i + 1]]); if (pl.closed && pl.pts.length > 2) out.push([pl.pts[pl.pts.length - 1], pl.pts[0]]); return out; };
  const sb = B.flatMap(segs);
  for (const pa of A) {
    const bb = bboxOfPoints(pa.pts);
    for (const [a1, a2] of segs(pa)) {
      for (const [b1, b2] of sb) {
        // 빠른 기각: 현재 best 보다 멀리 떨어진 bbox
        if (Math.min(a1[0], a2[0]) - best > Math.max(b1[0], b2[0]) || Math.max(a1[0], a2[0]) + best < Math.min(b1[0], b2[0]) || Math.min(a1[1], a2[1]) - best > Math.max(b1[1], b2[1]) || Math.max(a1[1], a2[1]) + best < Math.min(b1[1], b2[1])) continue;
        const d = distSegSeg(a1, a2, b1, b2);
        if (d < best) { best = d; if (best === 0) return 0; }
      }
    }
    void bb;
  }
  return best;
}
