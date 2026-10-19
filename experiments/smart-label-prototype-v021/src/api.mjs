// 직렬화 가능한 추천 API 및 KO-SMART 통합용 순수 함수 인터페이스 (v0.2.1 — 현재 운영 앱에 연결하지 않음)
import { recommend, ALGORITHM_VERSION } from "./recommend.mjs";
import { renderTikz } from "./local-render.mjs";
import { PARAMS } from "./algorithm.mjs";
import { evaluateFigure } from "./metrics.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const defaultWork = join(dirname(fileURLToPath(import.meta.url)), "..", "output", ".work");

const uri = (svg) => (svg ? "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64") : null);
const round = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : n);
const bb = (b) => (b ? { x0: round(b.x0), y0: round(b.y0), x1: round(b.x1), y1: round(b.y1) } : null);

/**
 * 실험실 서버 및 정적 HTML 빌드용 직렬화 추천 실행기
 * @param {string} body
 * @param {{workRoot?:string, params?:typeof PARAMS, withImages?:boolean, mode?:"auto"|"v0.1"|"v0.2"|"v0.2.1"}} [opts]
 */
export function runRecommend(body, { workRoot = defaultWork, params = PARAMS, withImages = true, mode = "auto" } = {}) {
  const r = recommend(body, { workRoot, params, mode });
  const out = {
    algorithmVersion: ALGORITHM_VERSION,
    mode: r.mode,
    status: r.status,
    ok: r.ok,
    errors: r.errors,
    warnings: r.warnings,
    manual: r.manual,
    figureType: r.figureType,
    engineSummary: r.engineSummary,
    labelDecisions: r.labelDecisions || [],
    labelOnlyDecisions: r.labelOnlyDecisions || [],
    placements: r.placements.map((p) => ({
      label: p.label,
      action: p.action,
      selectedEngine: p.selectedEngine || "v0.2.1",
      agreedEngines: p.agreedEngines || [],
      how: p.how,
      strokeKind: p.strokeKind,
      confirmedAssignment: !!p.confirmedAssignment,
      uncertainAssignment: !!p.uncertainAssignment,
      end: p.end,
      preferredEnd: p.preferredEnd,
      side: p.side,
      alpha: p.alpha,
      cost: p.cost,
      score: p.score,
      reason: p.reason,
      holdReason: p.holdReason || null,
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
      labelDecisions: r.labelOnlyDecisions || [],
      placements: (r.labelOnlyPlacements || []).map((p) => ({
        label: p.label,
        action: p.action,
        selectedEngine: p.selectedEngine || "v0.2.1",
        agreedEngines: p.agreedEngines || [],
        how: p.how,
        strokeKind: p.strokeKind,
        confirmedAssignment: !!p.confirmedAssignment,
        uncertainAssignment: !!p.uncertainAssignment,
        end: p.end,
        side: p.side,
        alpha: p.alpha,
        cost: p.cost,
        score: p.score,
        reason: p.reason,
        holdReason: p.holdReason || null,
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
    originalBody: r.scene ? r.scene.body : body,
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

export function autoAlignTikzLabels(tikzBody, options = {}) {
  const workRoot = options.workRoot || defaultWork;
  const r = recommend(tikzBody, { workRoot, applyAxis: options.applyAxis, verify: options.verify, mode: options.mode });
  const ev = r.scene && r.scene.ok ? evaluateFigure(r.scene, r.recScene, null) : null;
  const evLabelOnly = r.scene && r.scene.ok && r.labelOnlyScene ? evaluateFigure(r.scene, r.labelOnlyScene, null) : null;
  return {
    version: ALGORITHM_VERSION,
    mode: r.mode,
    status: r.status,
    figureType: r.figureType,
    recommendedTikz: r.recommendedBody,
    labelOnlyTikz: r.labelOnlyBody,
    axisOnlyTikz: r.axisOnlyBody,
    beforeSvg: r.scene && r.scene.svg,
    afterSvg: r.recScene && r.recScene.svg,
    labelOnlySvg: r.labelOnlyScene && r.labelOnlyScene.svg,
    axisOnlySvg: r.axisOnlyScene && r.axisOnlyScene.svg,
    shiftReport: r.shiftReport || [],
    advisoryReport: r.advisoryReport || [],
    labelOnlyShiftReport: r.labelOnlyShiftReport || [],
    labelDecisions: r.labelDecisions || [],
    engineSummary: r.engineSummary || null,
    axisReport: r.axis,
    placements: r.placements,
    assignments: r.assignments,
    skipped: r.skipped,
    advisory: r.advisory || [],
    preservation: r.preservation,
    preservationLabelOnly: r.preservationLabelOnly,
    preservationAxisOnly: r.preservationAxisOnly,
    outputs: r.outputs,
    verify: r.verify,
    evaluation: ev,
    evaluationLabelOnly: evLabelOnly,
    manualReviewReasons: r.manual,
    warnings: r.warnings,
    errors: r.errors,
  };
}
