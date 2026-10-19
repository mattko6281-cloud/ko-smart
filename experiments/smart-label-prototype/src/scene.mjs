// 장면(scene) 구성: TikZ 본문 → 로컬 렌더 → 엔진 측정(읽기 전용 import) → 소스 문장/노드/선/곡선 연결.
// 모든 기하는 TikZ 좌표계(TeX pt, y 위쪽)다. 소스 문자열은 수정하지 않는다.
import { analyze, extractTikzNodes, measureSvg } from "../../smart-label-engine/src/index.mjs";
import { maskComments, parsePictureContext } from "../../smart-label-engine/src/tikz-nodes.mjs";
import { renderTikz, HEADER } from "./local-render.mjs";
import { compileExpr, compileLabelFunction } from "./expr.mjs";

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)`;

/** 최상위 `;` 로 문장 분리 (괄호/중괄호/대괄호 깊이 고려). 오프셋 보존. */
export function splitStatements(masked) {
  const out = []; let d = 0, start = 0;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === "\\") { i++; continue; }
    if ("{[(".includes(ch)) d++; else if ("}])".includes(ch)) d--;
    else if (ch === ";" && d === 0) { out.push({ start, end: i + 1 }); start = i + 1; }
  }
  return out;
}

function optsOf(text) { // 선두 [..] (균형)
  let p = 0; while (/\s/.test(text[p] ?? "")) p++;
  if (text[p] !== "[") return { raw: "", end: p };
  let d = 0;
  for (let i = p; i < text.length; i++) { if (text[i] === "[") d++; else if (text[i] === "]") { d--; if (d === 0) return { raw: text.slice(p + 1, i), end: i + 1 }; } }
  return { raw: "", end: p };
}

/**
 * @param {string} body tikzpicture 환경
 * @param {{workRoot:string}} opts
 */
export function buildScene(body, opts) {
  const scene = { ok: false, errors: [], warnings: [], body, units: null, nodes: [], strokes: [], stmts: [], axes: { x: null, y: null }, render: null };
  const r = renderTikz(body, { workRoot: opts.workRoot });
  scene.render = { ok: r.ok, cached: r.cached, error: r.error || null };
  if (!r.ok) { scene.errors.push(r.error); return scene; }
  scene.svg = r.svg;
  const offset = HEADER.length;
  const an = analyze({ tikzSource: r.doc, svgText: r.svg });
  const geom = measureSvg(r.svg);
  if (!geom.ok) { scene.errors.push("SVG 측정 실패: " + geom.errors.join("; ")); return scene; }
  scene.analysisStatus = an.status; scene.matchSummary = an.matching && an.matching.summary;
  scene.warnings.push(...an.warnings.filter((w) => !/foreach\/scope ranges without/.test(w)));
  const masked = maskComments(body);
  const pic = parsePictureContext(masked);
  scene.units = { xU: pic.ctx.xUnitPt, yU: pic.ctx.yUnitPt, everyNodeScale: pic.ctx.everyNodeScale, coordsReliable: pic.ctx.coordsReliable };
  if (!pic.ctx.coordsReliable) scene.warnings.push("picture 레벨 변환 때문에 좌표를 신뢰할 수 없음");
  const { xU, yU } = scene.units;

  // ── 문장 파싱 ── (\begin{tikzpicture}[...] / \end{tikzpicture} 는 공백으로 가려 오프셋 보존)
  let maskedStm = masked;
  const bm = /\\begin\{tikzpicture\}/.exec(masked);
  if (bm) { const o0 = optsOf(masked.slice(bm.index + bm[0].length)); const endIdx = bm.index + bm[0].length + o0.end; maskedStm = " ".repeat(endIdx) + masked.slice(endIdx); }
  maskedStm = maskedStm.replace(/\\end\{tikzpicture\}/g, (s) => " ".repeat(s.length));
  const ranges = splitStatements(maskedStm);
  const stmts = [];
  for (const r0 of ranges) {
    const text = maskedStm.slice(r0.start, r0.end);
    const m = /^\s*(\\draw|\\fill|\\filldraw|\\node|\\coordinate|\\path)\b/.exec(text);
    if (!m) { stmts.push({ ...r0, type: "other", text }); continue; }
    const cmd = m[1]; const rest = text.slice(m[0].length);
    const o = optsOf(rest);
    const after = rest.slice(o.end);
    const st = { ...r0, cmd, optsRaw: o.raw, text, after, type: "other" };
    if (cmd === "\\draw" || cmd === "\\path") {
      const pm = new RegExp(String.raw`^\s*plot\s*\(\s*\\x\s*,\s*\{([^{}]+)\}\s*\)`).exec(after) || new RegExp(String.raw`^\s*plot\s*\(\s*\\x\s*,\s*([^)]+)\)`).exec(after);
      if (pm) {
        const dm = new RegExp(String.raw`domain\s*=\s*(${NUM})\s*:\s*(${NUM})`).exec(o.raw);
        const sm = /samples\s*=\s*(\d+)/.exec(o.raw);
        st.type = "plot"; st.expr = pm[1].trim(); st.fn = compileExpr(st.expr);
        st.domain = dm ? [Number(dm[1]), Number(dm[2])] : null; st.samples = sm ? Number(sm[1]) : 25;
      } else {
        const pts = []; const re = new RegExp(String.raw`\(\s*(${NUM})\s*,\s*(${NUM})\s*\)`, "g");
        const seg = after.replace(/node\s*(\[[^\]]*\])?\s*\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, " ");
        const joined = seg.replace(re, (all, a, b) => { pts.push([Number(a), Number(b)]); return "P"; });
        if (pts.length >= 2 && /^[\sP\-]*(--[\sP-]*)*;?\s*$/.test(joined.replace(/cycle/g, "")) ) { st.type = "polyline"; st.pts = pts; }
      }
      const arrow = /(^|[,\s])-?>|<-|->/.test(o.raw) && /->/.test(o.raw);
      st.arrow = arrow;
    } else if (cmd === "\\fill" || cmd === "\\filldraw") st.type = "fill";
    else if (cmd === "\\node") st.type = "node";
    else if (cmd === "\\coordinate") st.type = "coordinate";
    stmts.push(st);
  }
  scene.stmts = stmts;

  // ── 곡선/선 ↔ SVG 경로 연결 (소스 순서 = SVG 경로 순서, 개수 검증) ──
  const drawStmts = stmts.filter((s) => (s.cmd === "\\draw") && (s.type === "plot" || s.type === "polyline" || s.type === "other"));
  const strokePaths = geom.paths.filter((p) => p.kind !== "filled" && p.kind !== "marker" && p.kind !== "unknown");
  const linkOk = drawStmts.length === strokePaths.length;
  if (!linkOk) scene.warnings.push(`\\draw 문장 ${drawStmts.length}개 ≠ SVG 선 ${strokePaths.length}개 → 선 연결 불확실(좌표 기반 대체)`);
  drawStmts.forEach((s, i) => { s.path = linkOk ? strokePaths[i] : null; });
  for (const p of strokePaths) {
    const st = linkOk ? drawStmts[strokePaths.indexOf(p)] : null;
    scene.strokes.push({ index: p.index, kind: p.kind, pts: p.geom.pts, halfWidth: p.halfWidth, stmt: st, bbox: p.bbox, closedPoly: false });
  }
  // 색칠 영역 경계는 별도 draw 로 그려지므로 fill 자체는 장애물에서 제외(채움).

  // ── 축 식별 ──
  for (const st of drawStmts) {
    if (!st.arrow || st.type !== "polyline" || st.pts.length !== 2 || !st.path) continue;
    const [a, b] = st.pts;
    if (Math.abs(a[1]) < 1e-9 && Math.abs(b[1]) < 1e-9) scene.axes.x = { stmt: st, from: a[0], to: b[0], path: st.path };
    else if (Math.abs(a[0]) < 1e-9 && Math.abs(b[0]) < 1e-9) scene.axes.y = { stmt: st, from: a[1], to: b[1], path: st.path };
  }

  // ── 노드 ──
  const src = extractTikzNodes(body);
  const byStart = new Map(src.nodes.map((n) => [n.start, n]));
  const nodeGeom = geom.nodes;
  for (const lab of an.labels) {
    const bodyStart = lab.source.start - offset;
    const sn = byStart.get(bodyStart);
    if (!sn) continue;
    const m = lab.matching;
    const svgNode = m.svgNodeIndex !== null ? nodeGeom[m.svgNodeIndex] : null;
    const bbox = svgNode && svgNode.bboxTikz ? { ...svgNode.bboxTikz } : null;
    const stmt = stmts.find((s) => bodyStart >= s.start && bodyStart < s.end) || null;
    const label = sn.labelRaw ?? "";
    const trimmed = label.replace(/\$|\\displaystyle|\\rm|\\mathrm/g, "").replace(/\s+/g, "");
    let role = "other";
    if (sn.isEmptyMarker) role = "marker";
    else if (stmt && stmt.arrow && sn.kind === "inline") role = "axisLabel";
    else if (/^O$/.test(trimmed)) role = "origin";
    else if (/^[A-Z]$/.test(trimmed)) role = "vertex";
    else if (/^[xy]$/.test(trimmed)) role = "axisLabel";
    else if (trimmed.includes("=")) role = "function";
    let usable = m.usable, usableBy = m.usable ? "engine-confirmed" : null;
    const labEv = (m.evidence || []).find((e) => e.type === "label");
    if (!usable && sn.kind === "inline" && stmt && stmt.path && bbox && m.confidence === "uncertain" && labEv && labEv.result === "match") {
      const st = scene.strokes.find((s) => s.index === stmt.path.index);
      if (st) {
        const dEnd = [st.pts[0], st.pts[st.pts.length - 1]].map((e) => Math.hypot(Math.max(bbox.x0 - e[0], 0, e[0] - bbox.x1), Math.max(bbox.y0 - e[1], 0, e[1] - bbox.y1)));
        if (Math.min(...dEnd) <= 25) { usable = true; usableBy = "inline-node-at-plot-end(own evidence: glyph match + box within 25pt of linked stroke end)"; }
      }
    }
    scene.nodes.push({
      id: lab.id, key: bodyStart, kind: sn.kind, label, trimmed, role, start: sn.start, end: sn.end, optionsRange: sn.optionsRange, optionsRaw: sn.optionsRaw, keywordEnd: sn.start + sn.keyword.length,
      xshift: sn.options.xshift ? sn.options.xshift.pt : null, yshift: sn.options.yshift ? sn.options.yshift.pt : null, position: sn.options.position,
      scale: svgNode ? [svgNode.scaleX, svgNode.scaleY] : null, bbox, svgIndex: m.svgNodeIndex, confidence: m.confidence, usable, usableBy,
      anchor: lab.expectedAnchor ? lab.expectedAnchor.pt : null, at: sn.at ? [sn.at.xPt, sn.at.yPt] : null, stmt, inlineAnchor: sn.inlineAnchor ? [sn.inlineAnchor.xPt, sn.inlineAnchor.yPt] : null, support: sn.support, reasons: sn.reasons,
    });
  }
  scene.nodes.sort((a, b) => a.start - b.start);
  scene.ok = true;
  scene.geom = geom;
  scene.analysis = an;
  scene.compileExpr = compileExpr; scene.compileLabelFunction = compileLabelFunction;
  return scene;
}

/** 곡선(plot)의 pt 폴리라인 (파싱된 식 기준). 평가 불가 시 null. */
export function plotPolyline(stmt, units) {
  if (!stmt.fn || !stmt.domain) return null;
  const [a, b] = stmt.domain, n = Math.max(2, stmt.samples);
  const pts = [];
  for (let i = 0; i < n; i++) { const x = a + ((b - a) * i) / (n - 1); const y = stmt.fn(x); if (!Number.isFinite(y)) return null; pts.push([x * units.xU, y * units.yU]); }
  return pts;
}
