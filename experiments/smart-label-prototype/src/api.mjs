// 직렬화 가능한 추천 API (서버/정적 빌드 공용). 외부 네트워크 없음, 로컬 MiKTeX 렌더만 사용.
import { recommend, ALGORITHM_VERSION } from "./recommend.mjs";
import { renderTikz } from "./local-render.mjs";
import { PARAMS } from "./algorithm.mjs";

const uri = (svg) => (svg ? "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64") : null);
const round = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : n);
const bb = (b) => (b ? { x0: round(b.x0), y0: round(b.y0), x1: round(b.x1), y1: round(b.y1) } : null);

export function runRecommend(body, { workRoot, params = PARAMS, withImages = true } = {}) {
  const r = recommend(body, { workRoot, params });
  const out = {
    algorithmVersion: ALGORITHM_VERSION, status: r.status, ok: r.ok, errors: r.errors, warnings: r.warnings, manual: r.manual, figureType: r.figureType,
    placements: r.placements.map((p) => ({ label: p.label, action: p.action, how: p.how, end: p.end, side: p.side, alpha: p.alpha, cost: p.cost, reason: p.reason, uncertainAssignment: !!p.uncertainAssignment, from: bb(p.from), to: bb(p.bbox) })),
    skipped: r.skipped, shiftReport: r.shiftReport || [],
    axis: r.axis ? { x: r.axis.x && { old: r.axis.x.old, new: r.axis.x.new }, y: r.axis.y && { old: r.axis.y.old, new: r.axis.y.new }, margins: r.axis.margins, notes: r.axis.notes } : null,
    labelOnly: { shiftReport: r.labelOnlyShiftReport || [], placements: (r.labelOnlyPlacements || []).map((p) => ({ label: p.label, action: p.action, how: p.how, end: p.end, side: p.side, alpha: p.alpha, cost: p.cost, reason: p.reason, uncertainAssignment: !!p.uncertainAssignment })) },
    axisEdits: (r.axisEdits || []).map((e) => ({ kind: e.kind, old: e.old, new: e.new })),
    preservation: r.preservation, verify: r.verify ? { compiled: r.verify.compiled, error: r.verify.error } : null, iterations: r.iterations,
    originalBody: body, recommendedBody: r.recommendedBody, labelOnlyBody: r.labelOnlyBody, axisOnlyBody: r.axisOnlyBody,
    params, previews: null,
  };
  if (withImages && r.scene && r.scene.svg) {
    const render = (b) => { try { const x = renderTikz(b, { workRoot }); return x.ok ? uri(x.svg) : null; } catch { return null; } };
    out.previews = { before: uri(r.scene.svg), recommended: r.status === "recommended" ? render(r.recommendedBody) : uri(r.scene.svg), labelOnly: r.status === "recommended" ? render(r.labelOnlyBody) : uri(r.scene.svg), note: "로컬 MiKTeX 실제 재렌더 (예상 미리보기 아님)" };
  }
  return out;
}
