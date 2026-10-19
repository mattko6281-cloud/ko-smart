// 스마트 라벨 엔진 v0.1 — 오케스트레이터. 입력(TikZ 문자열 + SVG 문자열) → 구조화된 분석 JSON.
// 부작용 없음: 파일 읽기/쓰기, 네트워크, TikZ 수정·생성을 하지 않는다. (파일 I/O 는 cli.mjs / run-all.mjs 만 담당)
import { extractTikzNodes } from "./tikz-nodes.mjs";
import { measureSvg, summarizeMeasurement } from "./svg-measure.mjs";
import { matchNodes, declaredScale, expectedAnchorPt } from "./match.mjs";
import { analyzeCollisions } from "./collisions.mjs";
import { distPointBBox, minDistPolylines, unionBBox, round3, roundBBox } from "./geometry.mjs";

export const ENGINE_VERSION = "0.1.0";
/** 눈금 정렬 오차 허용치: 실험(B 샘플) 최대 편차 0.086pt 근거 → 0.25pt */
export const TICK_TOLERANCE_PT = 0.25;

/**
 * @param {{tikzSource:string, svgText:string, texFile?:string, svgFile?:string}} input
 */
export function analyze(input) {
  const report = {
    engineVersion: ENGINE_VERSION, analysisOnly: true, input: { texFile: input.texFile ?? null, svgFile: input.svgFile ?? null },
    success: false, status: "failed", errors: [], warnings: [], unsupported: [],
    tikz: null, svg: null, labels: [], matching: null, collisions: null, notes: [
      "Analysis only: this report never modifies or generates TikZ code.",
      "Coordinates are TeX pt in the TikZ frame (y up) unless a field says SVG.",
    ],
  };
  let tikz, svg;
  try { tikz = extractTikzNodes(input.tikzSource); } catch (e) { report.errors.push("TikZ extraction crashed: " + String(e).slice(0, 160)); return report; }
  try { svg = measureSvg(input.svgText); } catch (e) { report.errors.push("SVG measurement crashed: " + String(e).slice(0, 160)); return report; }
  report.errors.push(...tikz.errors.map((e) => "tikz: " + e), ...svg.errors.map((e) => "svg: " + e));
  report.warnings.push(...tikz.warnings.map((w) => "tikz: " + w), ...[...new Set(svg.warnings)].map((w) => "svg: " + w));
  report.unsupported.push(...tikz.unsupported.map((u) => "tikz: " + u), ...[...new Set(svg.unsupported)].map((u) => "svg: " + u));
  if (!tikz.units) { report.svg = summarizeMeasurement(svg); report.status = "failed"; return report; }
  report.tikz = {
    units: { xUnitPt: round3(tikz.units.xUnitPt), yUnitPt: round3(tikz.units.yUnitPt), everyNodeScale: tikz.units.everyNodeScale, coordsReliable: tikz.units.coordsReliable },
    nodeCount: tikz.nodes.length, coordinateStatements: tikz.coordinates.length, sequenceReliable: tikz.sequenceReliable,
    unsafeRanges: tikz.unsafeRanges.map((r) => ({ start: r.start, end: r.end, reason: r.reason })), macros: tikz.macros, legacyComparison: tikz.legacyComparison,
  };
  report.svg = summarizeMeasurement(svg);
  if (!tikz.ok || !svg.ok) { report.status = "failed"; return report; }

  const match = matchNodes(tikz, svg);
  report.matching = { summary: match.summary, globalNotes: match.globalNotes, sequentialTrusted: match.sequentialTrusted ?? false, unmatchedSvgNodes: match.unmatchedSvgNodes ?? [] };

  const matchBySource = new Map(match.matches.map((m) => [m.sourceId, m]));
  const sourceIdBySvgIndex = new Map(), anchorBySvgIndex = new Map(), basicBySvgIndex = new Map();
  for (const n of tikz.nodes) {
    const m = matchBySource.get(n.id);
    if (!m || m.svgNodeIndex === null || m.confidence === "unsupported") continue;
    sourceIdBySvgIndex.set(m.svgNodeIndex, n.id);
    const ea = expectedAnchorPt(n, svg.nodes[m.svgNodeIndex]);
    if (ea) anchorBySvgIndex.set(m.svgNodeIndex, ea.pt);
    if (n.basic) basicBySvgIndex.set(m.svgNodeIndex, n.basic.basicType);
  }

  const markers = svg.paths.filter((p) => p.kind === "marker");
  for (const n of tikz.nodes) {
    const m = matchBySource.get(n.id);
    const sn = m && m.svgNodeIndex !== null ? svg.nodes[m.svgNodeIndex] : null;
    const ea = sn ? expectedAnchorPt(n, sn) : expectedAnchorPt(n, null);
    const ds = declaredScale(n, tikz.units);
    const rec = {
      id: n.id, kind: n.kind, label: n.labelRaw, isEmptyMarker: n.isEmptyMarker, basicType: n.basic?.basicType ?? null,
      source: { start: n.start, end: n.end, line: n.line, optionsRaw: n.optionsRaw, name: n.nameRaw, atRaw: n.atRaw, support: n.support, reasons: n.reasons, joystickTarget: n.joystickTarget },
      originalCoordinate: n.at ? { x: n.at.x, y: n.at.y, xPt: n.at.xPt, yPt: n.at.yPt } : n.inlineAnchor ? { x: n.inlineAnchor.x, y: n.inlineAnchor.y, xPt: n.inlineAnchor.xPt, yPt: n.inlineAnchor.yPt, basis: n.inlineAnchor.basis } : null,
      shift: { xshift: n.options.xshift, yshift: n.options.yshift },
      matching: { confidence: m ? m.confidence : "unsupported", usable: m ? m.usable : false, svgNodeIndex: m ? m.svgNodeIndex : null, evidence: m ? m.evidence : [], reasons: m ? m.reasons : [] },
      declaredScale: ds, measuredScale: sn ? { sx: sn.scaleX, sy: sn.scaleY } : null,
      scaleConsistent: sn ? Math.abs(sn.scaleX - ds.sx) < 0.01 && Math.abs(sn.scaleY - ds.sy) < 0.01 : null,
      expectedAnchor: ea, measured: null, anchorDistance: null, nearestMarker: null, tickAlignment: null,
    };
    if (sn && m.confidence !== "unsupported") {
      rec.measured = { empty: sn.empty, bboxTikzPt: roundBBox(sn.bboxTikz), bboxSvg: roundBBox(sn.bboxSvg), centerTikzPt: sn.centerTikz ? sn.centerTikz.map(round3) : null, originTikzPt: sn.originTikzPt, glyphs: sn.chars, inkChecked: sn.inkChecked, hasRule: sn.hasRule };
      if (ea && sn.bboxTikz) {
        const toBox = distPointBBox(ea.pt, sn.bboxTikz);
        rec.anchorDistance = { toInkBBoxPt: round3(toBox), toInkOutlinePt: sn.inkChecked ? round3(minDistPolylines([{ pts: [ea.pt, ea.pt], closed: false }], sn.geom.outline)) : null, basis: ea.basis };
      }
      if (ea && sn.bboxTikz && markers.length) {
        let best = null;
        for (const mk of markers) { const c = [(mk.bbox.x0 + mk.bbox.x1) / 2, (mk.bbox.y0 + mk.bbox.y1) / 2]; const d = Math.hypot(c[0] - ea.pt[0], c[1] - ea.pt[1]); if (!best || d < best.d) best = { d, mk, c }; }
        if (best && best.d <= 15) rec.nearestMarker = { pathIndex: best.mk.index, centerTikzPt: best.c.map(round3), distanceFromExpectedAnchorPt: round3(best.d), distanceToLabelInkPt: sn.inkChecked ? round3(minDistPolylines(sn.geom.outline, [best.mk.geom])) : null };
      }
      if (n.basic?.flags.isNumeric && n.at && sn.glyphBoxes.length && m.confidence !== "unsupported") {
        const xU = tikz.units.xUnitPt, yU = tikz.units.yUnitPt;
        const val = Number(n.labelRaw.replace(/[^\d.\-]/g, ""));
        const digits = sn.glyphBoxes.filter((g) => /[0-9.]/.test(g.ch));
        let box = null; for (const g of digits) box = unionBBox(box, g.bbox);
        const sx = ea ? ea.shiftAppliedPt[0] : 0, sy = ea ? ea.shiftAppliedPt[1] : 0;
        if (box && Math.abs(n.at.yPt) <= 0.5 * yU) {
          const cx = (box.x0 + box.x1) / 2;
          rec.tickAlignment = { axis: "x", digitsCenterPt: round3(cx), expectedAtPt: round3(n.at.xPt + sx), expectedByValuePt: round3(val * xU + sx), errorToAtPt: round3(cx - (n.at.xPt + sx)), errorToValuePt: round3(cx - (val * xU + sx)), valueMatchesCoordinate: Math.abs(val - n.at.x) < 1e-9, tolerancePt: TICK_TOLERANCE_PT, aligned: Math.abs(cx - (n.at.xPt + sx)) <= TICK_TOLERANCE_PT, note: /^[-+−]/.test(n.labelRaw.replace(/[$\s]/g, "")) ? "signed label: sign glyph excluded from center (UNVERIFIED)" : undefined };
        } else if (box && Math.abs(n.at.xPt) <= 0.5 * xU) {
          const cy = (box.y0 + box.y1) / 2;
          rec.tickAlignment = { axis: "y", digitsCenterPt: round3(cy), expectedAtPt: round3(n.at.yPt + sy), expectedByValuePt: round3(val * yU + sy), errorToAtPt: round3(cy - (n.at.yPt + sy)), errorToValuePt: round3(cy - (val * yU + sy)), valueMatchesCoordinate: Math.abs(val - n.at.y) < 1e-9, tolerancePt: TICK_TOLERANCE_PT, aligned: Math.abs(cy - (n.at.yPt + sy)) <= TICK_TOLERANCE_PT, note: "y-axis tick: vertical centre of digits; bbox centre depends on glyph height (UNVERIFIED on real samples)" };
        }
      }
    }
    report.labels.push(rec);
  }

  report.collisions = analyzeCollisions(svg, { sourceIdBySvgIndex, anchorBySvgIndex, basicBySvgIndex });
  const confirmedAll = match.summary.total > 0 && match.summary.confirmed === match.summary.total;
  report.status = confirmedAll && svg.unsupported.length === 0 && tikz.unsupported.length === 0 ? "ok" : "partial";
  report.success = true;
  return report;
}
