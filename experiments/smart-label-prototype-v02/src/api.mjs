// 직렬화 가능한 추천 API (v0.2, 서버/정적 빌드 공용). 외부 네트워크 없음, 로컬 MiKTeX 렌더만 사용.
import { recommend, ALGORITHM_VERSION } from "./recommend.mjs";
import { renderTikz } from "./local-render.mjs";
import { PARAMS } from "./algorithm.mjs";

const uri = (svg) => (svg ? "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64") : null);
const round = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : n);
const bb = (b) => (b ? { x0: round(b.x0), y0: round(b.y0), x1: round(b.x1), y1: round(b.y1) } : null);

export function runRecommend(body, { workRoot, params = PARAMS, withImages = true } = {}) {
  const r = recommend(body, { workRoot, params });
  const out = {
    algorithmVersion: ALGORITHM_VERSION,
    status: r.status,
    ok: r.ok,
    errors: r.errors,
    warnings: r.warnings,
    manual: r.manual,
    figureType: r.figureType,
    placements: r.placements.map((p) => ({
      label: p.label,
      action: p.action,
      how: p.how,
      strokeKind: p.strokeKind,
      confirmedAssignment: !!p.confirmedAssignment,
      uncertainAssignment: !!p.uncertainAssignment,
      end: p.end,
      preferredEnd: p.preferredEnd,
      side: p.side,
      alpha: p.alpha,
      cost: p.cost,
      reason: p.reason,
      keepCheck: p.keepCheck || null,
      advisory: p.advisory
        ? {
            end: p.advisory.end,
            side: p.advisory.side,
            alpha: p.advisory.alpha,
            cost: p.advisory.cost,
            shift: p.advisory.shift,
            neededMovePt: p.advisory.neededMovePt,
            to: bb(p.advisory.bbox),
          }
        : null,
      from: bb(p.from),
      to: bb(p.bbox),
    })),
    skipped: r.skipped,
    advisoryReport: r.advisoryReport || [],
    shiftReport: r.shiftReport || [],
    axis: r.axis ? { x: r.axis.x && { old: r.axis.x.old, new: r.axis.x.new }, y: r.axis.y && { old: r.axis.y.old, new: r.axis.y.new }, margins: r.axis.margins, notes: r.axis.notes } : null,
    labelOnly: {
      shiftReport: r.labelOnlyShiftReport || [],
      advisoryReport: r.labelOnlyAdvisoryReport || [],
      placements: (r.labelOnlyPlacements || []).map((p) => ({
        label: p.label,
        action: p.action,
        how: p.how,
        strokeKind: p.strokeKind,
        confirmedAssignment: !!p.confirmedAssignment,
        uncertainAssignment: !!p.uncertainAssignment,
        end: p.end,
        side: p.side,
        alpha: p.alpha,
        cost: p.cost,
        reason: p.reason,
        advisory: p.advisory ? { end: p.advisory.end, side: p.advisory.side, alpha: p.advisory.alpha, shift: p.advisory.shift } : null,
      })),
    },
    axisEdits: (r.axisEdits || []).map((e) => ({ kind: e.kind, old: e.old, new: e.new })),
    preservation: r.preservation,
    preservationLabelOnly: r.preservationLabelOnly,
    preservationAxisOnly: r.preservationAxisOnly,
    verify: r.verify || null,
    outputs: r.outputs
      ? {
          labelOnly: { status: r.outputs.labelOnly.status, valid: r.outputs.labelOnly.valid, revertedToOriginal: r.outputs.labelOnly.revertedToOriginal, editCount: r.outputs.labelOnly.editCount, issues: r.outputs.labelOnly.issues },
          axisOnly: { status: r.outputs.axisOnly.status, valid: r.outputs.axisOnly.valid, revertedToOriginal: r.outputs.axisOnly.revertedToOriginal, editCount: r.outputs.axisOnly.editCount, issues: r.outputs.axisOnly.issues },
          recommended: { status: r.outputs.recommended.status, valid: r.outputs.recommended.valid, revertedToOriginal: r.outputs.recommended.revertedToOriginal, editCount: r.outputs.recommended.editCount, issues: r.outputs.recommended.issues },
        }
      : null,
    iterations: r.iterations,
    originalBody: body,
    recommendedBody: r.recommendedBody,
    labelOnlyBody: r.labelOnlyBody,
    axisOnlyBody: r.axisOnlyBody,
    params,
    previews: null,
  };
  if (withImages && r.scene && r.scene.svg) {
    const render = (b, sc) => {
      if (sc && sc.svg) return uri(sc.svg);
      try { const x = renderTikz(b, { workRoot }); return x.ok ? uri(x.svg) : null; } catch { return null; }
    };
    out.previews = {
      before: uri(r.scene.svg),
      recommended: render(r.recommendedBody, r.recScene),
      labelOnly: render(r.labelOnlyBody, r.labelOnlyScene),
      axisOnly: render(r.axisOnlyBody, r.axisOnlyScene),
      note: "로컬 MiKTeX 실제 재렌더 (검증 통과한 출력만 제공, 실패 시 원본 복귀)",
    };
  }
  return out;
}
