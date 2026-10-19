// 스마트 라벨 엔진 v0.1 — TikZ 노드 ↔ SVG 노드 그룹 매칭.
// 원칙: 확실하지 않으면 매칭을 포기한다. 순서만으로는 절대 confirmed 로 만들지 않는다.
import { distPointBBox, round3 } from "./geometry.mjs";
import { expectedGlyphChars, normalizeSvgChars } from "./tikz-nodes.mjs";

/** 실험 데이터 근거: 앵커→ink bbox 거리는 A=3.3pt, 눈금 라벨≈5pt (scale 2.2). 여유를 두어 12pt. */
export const MATCH_TOLERANCES = { anchorToInkBBoxPt: 12, markerOriginPt: 0.05 };

/** 선언된 노드 스케일 추정: every node scale × node scale (× xscale/yscale 는 transform shape 일 때만 적용으로 가정) */
export function declaredScale(node, units) {
  const o = node.options;
  const base = units.everyNodeScale * (o.scale ?? 1);
  const sx = base * (o.transformShape && o.xscale ? o.xscale : 1);
  const sy = base * (o.transformShape && o.yscale ? o.yscale : 1);
  return { sx: round3(sx), sy: round3(sy), assumption: "xscale/yscale applied only together with 'transform shape' (observed in experiment samples; other combinations UNVERIFIED)" };
}

/** 원본 노드의 기대 기준점(TeX pt, TikZ 좌표). shift 는 SVG 에서 읽은 실제 노드 배율을 곱해 반영(실측 규칙). */
export function expectedAnchorPt(node, svgNode) {
  const base = node.at ? [node.at.xPt, node.at.yPt] : node.inlineAnchor ? [node.inlineAnchor.xPt, node.inlineAnchor.yPt] : null;
  if (!base) return null;
  const sxs = svgNode ? svgNode.scaleX : 1, sys = svgNode ? svgNode.scaleY : 1;
  const dx = node.options.xshift && node.options.xshift.pt !== null ? node.options.xshift.pt * sxs : 0;
  const dy = node.options.yshift && node.options.yshift.pt !== null ? node.options.yshift.pt * sys : 0;
  if ((node.options.xshift && node.options.xshift.pt === null) || (node.options.yshift && node.options.yshift.pt === null)) return null;
  return { pt: [round3(base[0] + dx), round3(base[1] + dy)], basis: node.at ? "at-coordinate" : "inline-last-coordinate", shiftAppliedPt: [round3(dx), round3(dy)] };
}

function evidenceFor(node, svgNode) {
  const ev = [];
  // 라벨
  if (node.isEmptyMarker) ev.push({ type: "label", result: svgNode.empty ? "match" : "mismatch", detail: svgNode.empty ? "both empty (point marker)" : `source empty, SVG has '${svgNode.chars}'` });
  else if (svgNode.empty) ev.push({ type: "label", result: "mismatch", detail: "source has label text, SVG group is empty" });
  else {
    const e = expectedGlyphChars(node.labelRaw);
    const got = normalizeSvgChars(svgNode.chars);
    if (!e.reliable) ev.push({ type: "label", result: "indeterminate", detail: "source label has commands whose glyphs cannot be predicted" });
    else if (e.normalized === got) ev.push({ type: "label", result: "match", detail: `glyphs '${svgNode.chars}'` });
    else if (e.risky) ev.push({ type: "label", result: "indeterminate", detail: "symbols with uncertain font mapping" });
    else ev.push({ type: "label", result: "mismatch", detail: `expected '${e.normalized}' got '${got}'` });
  }
  // 위치
  const ea = expectedAnchorPt(node, svgNode);
  if (!ea) ev.push({ type: "position", result: "unavailable", detail: "no interpretable anchor coordinate" });
  else if (node.isEmptyMarker) {
    const d = Math.hypot(svgNode.originTikzPt[0] - ea.pt[0], svgNode.originTikzPt[1] - ea.pt[1]);
    ev.push({ type: "position", result: d <= MATCH_TOLERANCES.markerOriginPt ? "within" : "outside", detail: `marker origin vs expected anchor: ${round3(d)}pt (tol ${MATCH_TOLERANCES.markerOriginPt})`, distancePt: round3(d) });
  } else if (!svgNode.bboxTikz) ev.push({ type: "position", result: "unavailable", detail: "SVG node has no ink bbox" });
  else {
    const d = distPointBBox(ea.pt, svgNode.bboxTikz);
    ev.push({ type: "position", result: d <= MATCH_TOLERANCES.anchorToInkBBoxPt ? "within" : "outside", detail: `expected anchor to ink bbox: ${round3(d)}pt (tol ${MATCH_TOLERANCES.anchorToInkBBoxPt}; basis ${ea.basis})`, distancePt: round3(d) });
  }
  return ev;
}
const res = (ev, t) => ev.find((e) => e.type === t)?.result;

/**
 * @param {ReturnType<import("./tikz-nodes.mjs").extractTikzNodes>} tikz
 * @param {ReturnType<import("./svg-measure.mjs").measureSvg>} svg
 */
export function matchNodes(tikz, svg) {
  const matches = [];
  const reasonsGlobal = [];
  const outputNodes = tikz.nodes;
  if (!svg.ok) {
    for (const n of outputNodes) matches.push({ sourceId: n.id, svgNodeIndex: null, confidence: "unsupported", usable: false, evidence: [], reasons: ["SVG measurement failed: " + svg.errors.join("; ")] });
    return { matches, summary: summarize(matches), globalNotes: ["SVG measurement failed"] };
  }
  const countsEqual = outputNodes.length === svg.nodes.length;
  const svgClean = svg.unsupported.length === 0 && svg.counts.outsideText === 0;
  const sequentialTrusted = tikz.sequenceReliable && countsEqual && svgClean;
  if (!countsEqual) reasonsGlobal.push(`node count differs: source ${outputNodes.length} vs SVG ${svg.nodes.length}`);
  if (!tikz.sequenceReliable) reasonsGlobal.push("source contains sequence-breaking constructs");
  if (!svgClean) reasonsGlobal.push("SVG contains unsupported/unclassified content: " + [...svg.unsupported, svg.counts.outsideText ? `${svg.counts.outsideText} outside text` : ""].filter(Boolean).join("; "));

  const labelCount = new Map();
  for (const n of outputNodes) if (n.labelRaw !== null) labelCount.set(n.labelRaw.trim(), (labelCount.get(n.labelRaw.trim()) || 0) + 1);

  const taken = new Map(); // svgIndex -> [sourceIds]
  const candidates = outputNodes.map((n) => {
    const base = { sourceId: n.id, svgNodeIndex: null, confidence: "unsupported", usable: false, evidence: [], reasons: [] };
    if (n.support === "unsupported" || n.labelRaw === null) { base.reasons.push(...n.reasons); return base; }
    // 1) 순서 후보
    let cand = null; let viaOrder = false;
    if (sequentialTrusted && svg.nodes[n.order]) { cand = svg.nodes[n.order]; viaOrder = true; }
    let ev = cand ? evidenceFor(n, cand) : [];
    const bad = cand && (res(ev, "label") === "mismatch" || res(ev, "position") === "outside");
    // 2) 내용 기반 대체 탐색 (순서 후보가 없거나 모순일 때)
    if (!cand || bad) {
      const pool = svg.nodes.map((sn) => ({ sn, ev: evidenceFor(n, sn) })).filter(({ ev: e }) => res(e, "label") === "match" && res(e, "position") === "within");
      if (pool.length === 1) { cand = pool[0].sn; ev = pool[0].ev; viaOrder = false; base.reasons.push(bad ? "order candidate contradicted; unique content+position candidate used" : "no sequential candidate; unique content+position candidate used"); }
      else { base.evidence = ev; base.reasons.push(bad ? "order candidate contradicted by label/position and no unique alternative" : "no usable candidate (ambiguous or none)"); return base; }
    }
    base.svgNodeIndex = cand.index; base.evidence = [{ type: "order", result: viaOrder ? "consistent" : "not-used", detail: viaOrder ? `source order ${n.order} ↔ SVG group ${cand.index}` : "order untrusted" }, ...ev];
    if (!cand.supported) { base.confidence = "unsupported"; base.reasons.push(...cand.reasons.map((r) => "SVG node: " + r)); return base; }
    const lab = res(ev, "label"), pos = res(ev, "position");
    const uniqueLabel = !n.isEmptyMarker && labelCount.get(n.labelRaw.trim()) === 1;
    if (viaOrder && lab === "match" && pos === "within") base.confidence = "confirmed";
    else if (viaOrder && lab === "match" && pos === "unavailable" && uniqueLabel && n.support === "supported") base.confidence = "confirmed";
    else base.confidence = "uncertain";
    if (base.confidence === "uncertain") base.reasons.push(`label=${lab}, position=${pos}, viaOrder=${viaOrder}`);
    if (n.support === "partial" && base.confidence === "confirmed") base.confidence = "uncertain", base.reasons.push("source node only partially interpreted: " + n.reasons.join("; "));
    return base;
  });
  // 일대일 충돌
  for (const c of candidates) if (c.svgNodeIndex !== null) { taken.set(c.svgNodeIndex, [...(taken.get(c.svgNodeIndex) || []), c.sourceId]); }
  for (const c of candidates) if (c.svgNodeIndex !== null && taken.get(c.svgNodeIndex).length > 1) { c.confidence = "uncertain"; c.reasons.push("SVG node claimed by multiple source nodes"); }
  for (const c of candidates) { c.usable = c.confidence === "confirmed"; matches.push(c); }
  const unmatchedSvg = svg.nodes.filter((s) => !taken.has(s.index)).map((s) => ({ index: s.index, chars: s.chars, empty: s.empty }));
  return { matches, summary: summarize(matches), globalNotes: reasonsGlobal, unmatchedSvgNodes: unmatchedSvg, sequentialTrusted };
}
function summarize(matches) {
  const s = { total: matches.length, confirmed: 0, uncertain: 0, unsupported: 0 };
  for (const m of matches) s[m.confidence]++;
  return s;
}
