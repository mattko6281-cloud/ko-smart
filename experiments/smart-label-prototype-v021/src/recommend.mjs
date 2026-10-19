// 추천 파이프라인 (v0.2.1):
//  * TikZ 본문 → 로컬 렌더·측정 → 멀티 엔진(original, v0.1, v0.2, v0.2.1) 후보 비교 및 하이브리드 선택 →
//    3개 출력(labelOnlyBody, axisOnlyBody, recommendedBody) 개별 안전성 검증.
//  * 각 출력에 대해 (1) 수식 불변, (2) plot domain 불변, (3) 도형·점 마커 불변, (4) 전역 폰트·선 두께 불변,
//    (5) 허용 범위 외 문자열 불변, (6) 인라인 구조 불변, (7) LaTeX 컴파일 성공, (8) SVG 측정 성공, (9) 렌더 결과 충돌 검증을 독립 수행한다.
//  * 하나라도 실패한 출력은 해당 출력만 원본으로 복귀(revert)시킨다.
import { buildScene } from "./scene.mjs";
import { PARAMS, shiftEdits, planAxes, axisEdits, applyEdits, assignStrokes } from "./algorithm.mjs";
import { planLabelsMultiEngine } from "./multi-engine.mjs";
import { renderTikz } from "./local-render.mjs";
import { maskComments, extractTikzNodes } from "../../smart-label-engine/src/tikz-nodes.mjs";
import { minDistPolylines } from "../../smart-label-engine/src/geometry.mjs";

export const ALGORITHM_VERSION = "proto-0.2.1";

const rectPoly = (b) => ({ pts: [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]], closed: true });
const bboxGapRect = (a, b) => Math.hypot(Math.max(a.x0 - b.x1, 0, b.x0 - a.x1), Math.max(a.y0 - b.y1, 0, b.y0 - a.y1));
const r2 = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

/**
 * 사용자가 \begin{tikzpicture} 없이 내부 명령만 붙여넣은 경우 안전하게 감싸주는 헬퍼
 */
export function ensureTikzpicture(input) {
  const trimmed = String(input || "").trim();
  if (/\\begin\{tikzpicture\}/.test(trimmed)) return trimmed;
  return (
    "\\begin{tikzpicture}[>={Stealth[length=12pt, width=8pt]}, x=1.0cm, y=1.0cm, line width=1pt, every node/.style={scale=1.8, font=\\rm}]\n" +
    trimmed +
    "\n\\end{tikzpicture}"
  );
}

/** 그림 유형 판별: coordinateFunction (축+plot 또는 plot 함수 그래프) 보정 지원 */
export function classifyFigure(scene) {
  const hasAxes = !!(scene.axes.x && scene.axes.y);
  const plots = scene.stmts.filter((s) => s.type === "plot").length;
  if (hasAxes && plots >= 1) return { type: "coordinateFunction", hasAxes: true, reason: `x/y 축 식별 + plot ${plots}개` };
  if (!hasAxes && plots >= 1) return { type: "coordinateFunction", hasAxes: false, reason: `plot 함수 곡선 ${plots}개 식별 (좌표축 없음 — 라벨 정렬만 수행)` };
  if (!hasAxes && plots === 0) return { type: "unknown", hasAxes: false, reason: "좌표축/plot 없음 — 전용 규칙 미검증(기하/입체 포함 가능). 원본 유지" };
  return { type: "unknown", hasAxes, reason: "축은 있으나 plot 이 없음" };
}

function extractInvariants(body) {
  const masked = maskComments(body);
  const nodes = extractTikzNodes(body).nodes;
  const headerMatch = /\\begin\{tikzpicture\}\s*(\[[^\]]*\])?/.exec(masked);
  const headerOpts = headerMatch ? (headerMatch[1] || "").trim() : "";
  const plots = [];
  const plotRe = /\\draw\s*(\[[^\]]*\])?\s*plot\s*\(\s*\\x\s*,\s*(\{[^{}]+\}|[^)]+)\)/g;
  let m;
  while ((m = plotRe.exec(masked)) !== null) {
    const opts = m[1] || "";
    const dom = /domain\s*=\s*[-+]?(?:\d+\.?\d*|\.\d+)\s*:\s*[-+]?(?:\d+\.?\d*|\.\d+)/.exec(opts);
    const samp = /samples\s*=\s*\d+/.exec(opts);
    plots.push({
      expr: m[2].trim(),
      domain: dom ? dom[0].replace(/\s+/g, "") : null,
      samples: samp ? samp[0].replace(/\s+/g, "") : null,
    });
  }
  const lineWidths = (masked.match(/line\s+width\s*=\s*[-+]?(?:\d+\.?\d*|\.\d+)\s*[a-z]+/g) || []).map((s) => s.replace(/\s+/g, ""));
  const scales = (masked.match(/scale\s*=\s*[-+]?(?:\d+\.?\d*|\.\d+)/g) || []).map((s) => s.replace(/\s+/g, ""));
  const fills = (masked.match(/\\(?:fill|filldraw)\b[^;]*;/g) || []).map((s) => s.trim());
  const commentLines = body.split(/\r?\n/).filter((l) => /^\s*%/.test(l)).map((l) => l.trim());
  const markers = nodes.filter((n) => n.isEmptyMarker).map((n) => ({ kind: n.kind, at: n.atRaw || "", opts: n.optionsRaw || "" }));
  const nodeKindsAndLabels = nodes.map((n) => ({ kind: n.kind, label: n.labelRaw, at: n.atRaw || null }));
  const nonAxisDraws = (masked.match(/\\draw\b[^;]*;/g) || [])
    .filter((s) => !/\(\s*[-+]?(?:\d+\.?\d*|\.\d+)\s*,\s*0\s*\)\s*--\s*\(\s*[-+]?(?:\d+\.?\d*|\.\d+)\s*,\s*0\s*\)/.test(s))
    .filter((s) => !/\(\s*0\s*,\s*[-+]?(?:\d+\.?\d*|\.\d+)\s*\)\s*--\s*\(\s*0\s*,\s*[-+]?(?:\d+\.?\d*|\.\d+)\s*\)/.test(s))
    .map((s) => s.replace(/node\s*\[[^\]]*\]/g, "node[]").replace(/\s+/g, " ").trim());
  return { headerOpts, plots, lineWidths, scales, fills, commentLines, markers, nodeKindsAndLabels, nonAxisDraws };
}

export function checkPreservation(orig, rec, edits) {
  const issues = [];
  const sorted = [...edits].sort((a, b) => a.start - b.start);

  let outsideEditsUnchanged = true;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      outsideEditsUnchanged = false;
      issues.push("편집 범위 겹침 발생");
    }
  }
  if (outsideEditsUnchanged) {
    let o = "", r = "", pos = 0, rp = 0, delta = 0;
    const recRanges = [];
    for (const e of sorted) {
      recRanges.push({ start: e.start + delta, end: e.start + delta + e.replacement.length });
      delta += e.replacement.length - (e.end - e.start);
    }
    for (let i = 0; i < sorted.length; i++) {
      o += orig.slice(pos, sorted[i].start) + "§"; pos = sorted[i].end;
      r += rec.slice(rp, recRanges[i].start) + "§"; rp = recRanges[i].end;
    }
    o += orig.slice(pos); r += rec.slice(rp);
    if (o !== r) {
      outsideEditsUnchanged = false;
      issues.push("편집 범위 밖 텍스트가 변경됨");
    }
  }

  let allowedEditSyntaxOnly = true;
  for (const e of sorted) {
    const before = orig.slice(e.start, e.end), after = e.replacement;
    if (e.kind === "label-shift") {
      const norm = (s) => s.replace(/(x|y)shift\s*=\s*[-+]?[0-9.]+\s*(pt)?/g, "").replace(/[\s,\[\]]/g, "");
      if (norm(before) !== norm(after)) {
        allowedEditSyntaxOnly = false;
        issues.push(`라벨 옵션이 shift 외에도 변경됨: ${before} → ${after}`);
      }
    } else if (e.kind === "axis-x" || e.kind === "axis-y") {
      const norm = (s) => s.replace(/[-+]?(?:\d+\.?\d*|\.\d+)/g, "#").replace(/\s+/g, "");
      if (norm(before) !== norm(after)) {
        allowedEditSyntaxOnly = false;
        issues.push(`축 편집이 숫자 외 구조를 변경함: ${before} → ${after}`);
      }
      const nums = (s) => (s.match(/[-+]?(?:\d+\.?\d*|\.\d+)/g) || []).map(Number);
      const a = nums(before), b = nums(after);
      if (e.kind === "axis-x" && (a[1] !== 0 || b[1] !== 0 || a[3] !== 0 || b[3] !== 0)) {
        allowedEditSyntaxOnly = false;
        issues.push("x축의 y=0 좌표가 변경됨");
      }
      if (e.kind === "axis-y" && (a[0] !== 0 || b[0] !== 0 || a[2] !== 0 || b[2] !== 0)) {
        allowedEditSyntaxOnly = false;
        issues.push("y축의 x=0 좌표가 변경됨");
      }
    } else {
      allowedEditSyntaxOnly = false;
      issues.push("알 수 없는 편집 종류 " + e.kind);
    }
  }

  const invO = extractInvariants(orig);
  const invR = extractInvariants(rec);

  const mathExprUnchanged =
    JSON.stringify(invO.plots.map((p) => p.expr)) === JSON.stringify(invR.plots.map((p) => p.expr)) &&
    JSON.stringify(invO.nodeKindsAndLabels.map((n) => n.label)) === JSON.stringify(invR.nodeKindsAndLabels.map((n) => n.label));
  if (!mathExprUnchanged) issues.push("원본 수학식(plot 수식 또는 노드 라벨 수식)이 변경됨");

  const plotDomainUnchanged =
    JSON.stringify(invO.plots.map((p) => [p.domain, p.samples])) === JSON.stringify(invR.plots.map((p) => [p.domain, p.samples]));
  if (!plotDomainUnchanged) issues.push("plot domain 또는 samples 옵션이 변경됨");

  const shapesAndMarkersUnchanged =
    JSON.stringify(invO.fills) === JSON.stringify(invR.fills) &&
    JSON.stringify(invO.markers) === JSON.stringify(invR.markers) &&
    JSON.stringify(invO.commentLines) === JSON.stringify(invR.commentLines) &&
    JSON.stringify(invO.nonAxisDraws) === JSON.stringify(invR.nonAxisDraws);
  if (!shapesAndMarkersUnchanged) issues.push("도형(\\fill/\\draw) 또는 점 마커/주석이 변경됨");

  const globalFontAndLineWidthUnchanged =
    invO.headerOpts === invR.headerOpts &&
    JSON.stringify(invO.lineWidths) === JSON.stringify(invR.lineWidths) &&
    JSON.stringify(invO.scales) === JSON.stringify(invR.scales);
  if (!globalFontAndLineWidthUnchanged) issues.push("전역 폰트(scale=2.2 등) 또는 선 두께(line width)가 변경됨");

  const inlineStructureUnchanged =
    JSON.stringify(invO.nodeKindsAndLabels.map((n) => [n.kind, n.at])) === JSON.stringify(invR.nodeKindsAndLabels.map((n) => [n.kind, n.at]));
  if (!inlineStructureUnchanged) issues.push("인라인/독립 노드 구조 또는 기준 좌표(at)가 변경됨");

  const checks = {
    outsideEditsUnchanged,
    allowedEditSyntaxOnly,
    mathExprUnchanged,
    plotDomainUnchanged,
    shapesAndMarkersUnchanged,
    globalFontAndLineWidthUnchanged,
    inlineStructureUnchanged,
  };

  return { ok: issues.length === 0, issues, editCount: edits.length, checks };
}

export function verifyRenderedCollisions(scene, movedFNodeIndices, P = PARAMS) {
  const fNodes = scene.nodes.filter((n) => n.role === "function" && n.bbox);
  const assigned = assignStrokes(scene, fNodes);
  const allBoxes = scene.nodes.filter((n) => n.bbox && n.role !== "marker");
  const movedSet = new Set(movedFNodeIndices || []);

  const issues = [];
  const labelDetails = [];
  const ownEndpointContacts = [];

  for (let idx = 0; idx < fNodes.length; idx++) {
    const n = fNodes[idx];
    const a = assigned.get(n.id);
    const s = a && a.stroke ? a.stroke : null;
    const isMoved = movedSet.has(idx);
    const cl = (st) => minDistPolylines([rectPoly(n.bbox)], [{ pts: st.pts, closed: false }]) - st.halfWidth;
    const ownClearancePt = s ? r2(cl(s)) : null;
    const others = s ? scene.strokes.filter((q) => q.index !== s.index) : scene.strokes;
    const minOtherClearancePt = others.length ? r2(Math.min(...others.map(cl))) : null;

    let minLabelGapPt = Infinity;
    for (const ob of allBoxes) {
      if (ob.id === n.id) continue;
      minLabelGapPt = Math.min(minLabelGapPt, bboxGapRect(n.bbox, ob.bbox));
    }
    minLabelGapPt = Number.isFinite(minLabelGapPt) ? r2(minLabelGapPt) : null;

    let endGapPt = null;
    if (s && s.pts.length >= 2) {
      const e0 = s.pts[0], e1 = s.pts[s.pts.length - 1];
      const d = (p) => Math.hypot(Math.max(n.bbox.x0 - p[0], 0, p[0] - n.bbox.x1), Math.max(n.bbox.y0 - p[1], 0, p[1] - n.bbox.y1));
      endGapPt = r2(Math.min(d(e0), d(e1)));
    }

    const isOwnEndpointContact = ownClearancePt !== null && endGapPt !== null && endGapPt <= 4.0 && ownClearancePt >= -1.0 && ownClearancePt <= 1.5;
    if (isOwnEndpointContact) {
      ownEndpointContacts.push({ label: n.label, endGapPt, ownClearancePt });
    }

    const otherStrokeCollision = minOtherClearancePt !== null && minOtherClearancePt < P.cHard - 1.5;
    const labelOverlapCollision = minLabelGapPt !== null && minLabelGapPt < P.mLabel - 1.5;
    const ownCurvePenetration = ownClearancePt !== null && ownClearancePt < -1.2;

    if (isMoved) {
      if (otherStrokeCollision) issues.push(`이동된 라벨 ${n.label} 이(가) 다른 곡선/축과 너무 가까움(minOther=${minOtherClearancePt}pt)`);
      if (labelOverlapCollision) issues.push(`이동된 라벨 ${n.label} 이(가) 다른 라벨과 충돌함(minLabelGap=${minLabelGapPt}pt)`);
      if (ownCurvePenetration) issues.push(`이동된 라벨 ${n.label} 이(가) 자기 곡선을 침범함(ownClearance=${ownClearancePt}pt)`);
    }

    labelDetails.push({
      id: n.id,
      fNodeIndex: idx,
      label: n.label,
      moved: isMoved,
      endGapPt,
      ownClearancePt,
      minOtherClearancePt,
      minLabelGapPt,
      ownEndpointContact: isOwnEndpointContact,
      otherStrokeCollision,
      labelOverlapCollision,
      ownCurvePenetration,
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    ownEndpointContacts,
    labelDetails,
  };
}

export function verifyOutputVariant({ variant, origBody, origScene, candidateBody, edits, movedFNodeIndices, workRoot, P = PARAMS, runRender = true }) {
  const preservation = checkPreservation(origBody, candidateBody, edits);
  const out = {
    variant,
    editCount: edits.length,
    preservation,
    compiled: false,
    svgMeasured: false,
    collisionCheck: null,
    valid: false,
    revertedToOriginal: false,
    status: "pending",
    issues: [...preservation.issues],
    candidateBody,
    deliveredBody: origBody,
    scene: null,
  };

  if (!preservation.ok) {
    out.revertedToOriginal = true;
    out.status = "reverted";
    out.scene = origScene;
    return out;
  }

  if (edits.length === 0 && candidateBody === origBody) {
    out.compiled = !!(origScene && origScene.render && origScene.render.ok);
    out.svgMeasured = !!(origScene && origScene.ok);
    out.collisionCheck = origScene && origScene.ok ? verifyRenderedCollisions(origScene, [], P) : { ok: false, issues: ["원본 장면 없음"], ownEndpointContacts: [], labelDetails: [] };
    out.valid = out.compiled && out.svgMeasured && out.collisionCheck.ok;
    out.status = out.valid ? "unchanged" : "reverted";
    out.deliveredBody = origBody;
    out.scene = origScene;
    return out;
  }

  if (!runRender) {
    out.compiled = true;
    out.svgMeasured = true;
    out.collisionCheck = { ok: true, issues: [], ownEndpointContacts: [], labelDetails: [] };
    out.valid = true;
    out.status = "verified";
    out.deliveredBody = candidateBody;
    return out;
  }

  const sc = buildScene(candidateBody, { workRoot });
  out.compiled = !!(sc.render && sc.render.ok);
  out.svgMeasured = !!sc.ok;
  if (!out.compiled) out.issues.push("LaTeX 컴파일 실패: " + (sc.render && sc.render.error ? sc.render.error : sc.errors.join("; ")));
  if (out.compiled && !out.svgMeasured) out.issues.push("SVG 측정 실패: " + sc.errors.join("; "));

  if (!out.compiled || !out.svgMeasured) {
    out.revertedToOriginal = true;
    out.status = "reverted";
    out.deliveredBody = origBody;
    out.scene = origScene;
    return out;
  }

  out.collisionCheck = verifyRenderedCollisions(sc, movedFNodeIndices, P);
  if (!out.collisionCheck.ok) {
    out.issues.push(...out.collisionCheck.issues);
    out.revertedToOriginal = true;
    out.status = "reverted";
    out.deliveredBody = origBody;
    out.scene = origScene;
    return out;
  }

  out.valid = true;
  out.status = "verified";
  out.deliveredBody = candidateBody;
  out.scene = sc;
  return out;
}

/**
 * @param {string} rawBody tikzpicture 환경 또는 내부 TikZ 코드
 * @param {{workRoot:string, params?:typeof PARAMS, verify?:boolean, applyAxis?:boolean, mode?:"auto"|"v0.1"|"v0.2"|"v0.2.1"}} opts
 */
export function recommend(rawBody, opts) {
  const P = opts.params || PARAMS;
  const mode = opts.mode || "auto";
  const body = ensureTikzpicture(rawBody);
  const res = {
    version: ALGORITHM_VERSION,
    mode,
    ok: false,
    status: "failed",
    figureType: null,
    errors: [],
    warnings: [],
    placements: [],
    labelDecisions: [],
    engineSummary: null,
    skipped: [],
    advisory: [],
    axis: null,
    edits: [],
    recommendedBody: body,
    axisOnlyBody: body,
    labelOnlyBody: body,
    preservation: null,
    preservationLabelOnly: null,
    preservationAxisOnly: null,
    outputs: null,
    verify: null,
    manual: [],
  };

  let scene;
  try {
    scene = buildScene(body, { workRoot: opts.workRoot });
  } catch (e) {
    res.errors.push("장면 구성 예외: " + String(e).slice(0, 160));
    return res;
  }
  res.render = scene.render;
  if (!scene.ok) {
    res.errors.push(...scene.errors);
    res.manual.push("원본 렌더/측정 실패 → 추천 불가, 원본 유지");
    return res;
  }
  res.warnings.push(...scene.warnings);
  res.scene = scene;

  const fig = classifyFigure(scene);
  res.figureType = fig;
  if (fig.type !== "coordinateFunction") {
    res.ok = true;
    res.status = "unchanged";
    res.manual.push(`그림 유형 '${fig.type}': ${fig.reason}`);
    return res;
  }

  let plan = planLabelsMultiEngine(scene, P, null, mode);
  const plan0 = plan;
  let axisPlan = planAxes(scene, plan, P);
  let iters = 1;
  const sig = (p) => JSON.stringify(p.placements.map((q) => [q.id, q.action, q.selectedEngine, q.shift]));
  while (iters < 3 && axisPlan.x && axisPlan.y) {
    const { xU, yU } = scene.units;
    const override = {
      left: Math.min(...axisPlan.x.new) * xU,
      right: Math.max(...axisPlan.x.new) * xU,
      bottom: Math.min(...axisPlan.y.new) * yU,
      top: Math.max(...axisPlan.y.new) * yU,
    };
    const next = planLabelsMultiEngine(scene, P, override, mode);
    iters++;
    const same = sig(next) === sig(plan);
    plan = next;
    axisPlan = planAxes(scene, plan, P);
    if (same) break;
  }

  res.iterations = iters;
  res.placements = plan.placements;
  res.labelDecisions = plan.labelDecisions;
  res.engineSummary = plan.engineSummary;
  res.skipped = plan.skipped;
  res.advisory = plan.advisory || [];
  res.assignments = plan.assignments;
  for (const s of plan.skipped) res.manual.push(`라벨 ${s.label} 보정 안 함: ${s.reason}`);

  const sh = shiftEdits(scene, plan, P);
  res.shiftReport = sh.report;
  res.advisoryReport = sh.advisoryReport;
  res.axis = { ...axisPlan, xStmt: undefined, yStmt: undefined };

  const ax = axisEdits(scene, axisPlan);
  const labelEdits = sh.edits;
  const combinedEdits = [...labelEdits, ...(opts.applyAxis === false ? [] : ax)];
  res.edits = combinedEdits;
  res.axisEdits = ax;
  if (axisPlan.notes.length) res.manual.push(...axisPlan.notes);

  const so = shiftEdits(scene, plan0, P);
  const labelOnlyEdits = so.edits;
  res.labelOnlyShiftReport = so.report;
  res.labelOnlyAdvisoryReport = so.advisoryReport;
  res.labelOnlyEdits = labelOnlyEdits;
  res.labelOnlyPlacements = plan0.placements;
  res.labelOnlyDecisions = plan0.labelDecisions;

  let candRecommended = body, candLabelOnly = body, candAxisOnly = body;
  try {
    candRecommended = applyEdits(body, combinedEdits);
  } catch (e) {
    res.errors.push("recommendedBody 편집 적용 실패: " + e.message);
  }
  try {
    candLabelOnly = applyEdits(body, labelOnlyEdits);
  } catch (e) {
    res.errors.push("labelOnlyBody 편집 적용 실패: " + e.message);
  }
  try {
    candAxisOnly = applyEdits(body, ax);
  } catch (e) {
    res.errors.push("axisOnlyBody 편집 적용 실패: " + e.message);
  }

  const origFNodes = scene.nodes.filter((n) => n.role === "function" && n.bbox);
  const movedIndicesCombined = plan.placements
    .filter((p) => p.action === "move")
    .map((p) => origFNodes.findIndex((q) => q.id === p.id))
    .filter((idx) => idx >= 0);

  const movedIndicesLabelOnly = plan0.placements
    .filter((p) => p.action === "move")
    .map((p) => origFNodes.findIndex((q) => q.id === p.id))
    .filter((idx) => idx >= 0);

  const runRender = opts.verify !== false;
  const vLabelOnly = verifyOutputVariant({
    variant: "labelOnlyBody",
    origBody: body,
    origScene: scene,
    candidateBody: candLabelOnly,
    edits: labelOnlyEdits,
    movedFNodeIndices: movedIndicesLabelOnly,
    workRoot: opts.workRoot,
    P,
    runRender,
  });

  const vAxisOnly = verifyOutputVariant({
    variant: "axisOnlyBody",
    origBody: body,
    origScene: scene,
    candidateBody: candAxisOnly,
    edits: ax,
    movedFNodeIndices: [],
    workRoot: opts.workRoot,
    P,
    runRender,
  });

  const vRecommended = verifyOutputVariant({
    variant: "recommendedBody",
    origBody: body,
    origScene: scene,
    candidateBody: candRecommended,
    edits: combinedEdits,
    movedFNodeIndices: movedIndicesCombined,
    workRoot: opts.workRoot,
    P,
    runRender,
  });

  res.outputs = {
    labelOnly: { ...vLabelOnly, scene: undefined },
    axisOnly: { ...vAxisOnly, scene: undefined },
    recommended: { ...vRecommended, scene: undefined },
  };

  res.labelOnlyBody = vLabelOnly.deliveredBody;
  res.axisOnlyBody = vAxisOnly.deliveredBody;
  res.recommendedBody = vRecommended.deliveredBody;

  res.preservation = vRecommended.preservation;
  res.preservationLabelOnly = vLabelOnly.preservation;
  res.preservationAxisOnly = vAxisOnly.preservation;

  for (const [k, v] of [["labelOnlyBody", vLabelOnly], ["axisOnlyBody", vAxisOnly], ["recommendedBody", vRecommended]]) {
    if (v.revertedToOriginal) {
      res.errors.push(`${k} 검증 실패(원본 복귀): ${v.issues.join("; ")}`);
      res.manual.push(`${k} 안전성 검증 실패로 해당 출력만 원본으로 복귀됨`);
    }
  }

  if (vRecommended.revertedToOriginal) {
    const revReason = `안전성 검증 실패로 원본 복귀: ${vRecommended.issues.join("; ")}`;
    for (const dec of res.labelDecisions || []) {
      if (dec.autoModified) {
        dec.autoModified = false;
        dec.revertedByVerification = true;
        dec.nonMoveCategory = "안전성 검증 실패";
        dec.nonMoveCode = "safety-verification-failed";
        dec.holdReason = revReason;
        dec.selectionReason = `[안전성 검증 실패] ${revReason}`;
        if (res.engineSummary) {
          res.engineSummary.autoModifiedCount = Math.max(0, (res.engineSummary.autoModifiedCount || 0) - 1);
          res.engineSummary.heldOriginalCount = (res.engineSummary.heldOriginalCount || 0) + 1;
          if (res.engineSummary.nonMoveByCategory) {
            res.engineSummary.nonMoveByCategory["안전성 검증 실패"] = (res.engineSummary.nonMoveByCategory["안전성 검증 실패"] || 0) + 1;
          }
        }
      }
    }
    for (const pl of res.placements || []) {
      if (pl.action === "move") {
        pl.action = "reverted-safety";
        pl.nonMoveCategory = "안전성 검증 실패";
        pl.nonMoveCode = "safety-verification-failed";
        pl.holdReason = revReason;
        pl.reason = `[안전성 검증 실패] ${revReason}`;
      }
    }
  }

  if (vLabelOnly.revertedToOriginal) {
    const revReason = `라벨 단독 출력 안전성 검증 실패로 원본 복귀: ${vLabelOnly.issues.join("; ")}`;
    for (const dec of res.labelOnlyDecisions || []) {
      if (dec.autoModified) {
        dec.autoModified = false;
        dec.revertedByVerification = true;
        dec.nonMoveCategory = "안전성 검증 실패";
        dec.nonMoveCode = "safety-verification-failed";
        dec.holdReason = revReason;
      }
    }
  }

  res.verify = {
    compiled: vRecommended.compiled,
    svgMeasured: vRecommended.svgMeasured,
    collisionOk: vRecommended.collisionCheck ? vRecommended.collisionCheck.ok : false,
    error: vRecommended.issues.length ? vRecommended.issues.join("; ") : null,
    perOutput: {
      labelOnly: { status: vLabelOnly.status, valid: vLabelOnly.valid, reverted: vLabelOnly.revertedToOriginal, issues: vLabelOnly.issues },
      axisOnly: { status: vAxisOnly.status, valid: vAxisOnly.valid, reverted: vAxisOnly.revertedToOriginal, issues: vAxisOnly.issues },
      recommended: { status: vRecommended.status, valid: vRecommended.valid, reverted: vRecommended.revertedToOriginal, issues: vRecommended.issues },
    },
  };

  res.recScene = vRecommended.scene || scene;
  res.labelOnlyScene = vLabelOnly.scene || scene;
  res.axisOnlyScene = vAxisOnly.scene || scene;

  const anyValid = vLabelOnly.valid || vAxisOnly.valid || vRecommended.valid;
  const anyChangedAndValid =
    (vLabelOnly.valid && vLabelOnly.editCount > 0) ||
    (vAxisOnly.valid && vAxisOnly.editCount > 0) ||
    (vRecommended.valid && vRecommended.editCount > 0);

  res.ok = anyValid;
  if (!anyValid) {
    res.status = "failed";
  } else if (anyChangedAndValid) {
    res.status = "recommended";
  } else {
    res.status = "unchanged";
  }
  return res;
}

export { maskComments, renderTikz };
