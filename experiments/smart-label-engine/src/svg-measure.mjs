// 스마트 라벨 엔진 v0.1 — Kroki(dvisvgm) SVG 측정기.
// 오프라인/순수: 문자열 입력 → 측정 결과. 네트워크·파일 쓰기·TikZ 실행 없음.
// 원본 실험: experiments/smart-label-svg/measure-labels.mjs (노드 그룹 시그니처, CTM 합성, 글리프 bbox 로직 재사용).
// 개선점: 구조 검증(예상 밖 구조는 오류/미지원으로 명시), 회전·중첩 노드·use/image·text 속성 검출,
//         글리프 실제 윤곽(outline) 추출, 선 종류 분류(축/곡선/점선/직선/마커/채움), 스타일 상속 해석.
import { parseXml } from "./xml.mjs";
import { parseWoff } from "./woff.mjs";
import { IDENTITY, mul, inverse, applyPt, parseTransform, bboxOfPoints, unionBBox, bboxCenter, round3, roundBBox } from "./geometry.mjs";

/** @typedef {import("./geometry.mjs").Matrix} Matrix */
/** @typedef {import("./geometry.mjs").BBox} BBox */

const BAD_TEXT_ATTRS = ["dx", "dy", "rotate", "textLength", "lengthAdjust", "transform"];

/** 경로 d → 폴리라인(곡선 8분할). 호(arc)는 hasArc 로 알린다. */
export function pathToPolyline(d) {
  const toks = [...d.matchAll(/([MmLlHhVvCcSsQqZzAa])|(-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)/g)].map((m) => (m[1] ? m[1] : Number(m[2])));
  const pts = []; let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, hasArc = false, closed = false;
  const num = () => /** @type {number} */ (toks[i++]);
  const cubic = (p1, p2, p3) => { for (let s = 1; s <= 8; s++) { const t = s / 8, u = 1 - t; pts.push([u * u * u * x + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * y + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); } };
  while (i < toks.length) {
    if (typeof toks[i] === "string") cmd = /** @type {string} */ (toks[i++]);
    const rel = cmd === cmd.toLowerCase(); const C = cmd.toUpperCase();
    if (C === "Z") { x = sx; y = sy; pts.push([x, y]); closed = true; continue; }
    if (C === "M") { const nx = num(), ny = num(); x = rel ? x + nx : nx; y = rel ? y + ny : ny; sx = x; sy = y; pts.push([x, y]); cmd = rel ? "l" : "L"; }
    else if (C === "L") { const nx = num(), ny = num(); x = rel ? x + nx : nx; y = rel ? y + ny : ny; pts.push([x, y]); }
    else if (C === "H") { const nx = num(); x = rel ? x + nx : nx; pts.push([x, y]); }
    else if (C === "V") { const ny = num(); y = rel ? y + ny : ny; pts.push([x, y]); }
    else if (C === "C") {
      const v = [num(), num(), num(), num(), num(), num()];
      const p1 = rel ? [x + v[0], y + v[1]] : [v[0], v[1]], p2 = rel ? [x + v[2], y + v[3]] : [v[2], v[3]], p3 = rel ? [x + v[4], y + v[5]] : [v[4], v[5]];
      cubic(p1, p2, p3); lcx = p2[0]; lcy = p2[1]; x = p3[0]; y = p3[1];
    } else if (C === "S") {
      const v = [num(), num(), num(), num()];
      const p1 = [2 * x - lcx, 2 * y - lcy], p2 = rel ? [x + v[0], y + v[1]] : [v[0], v[1]], p3 = rel ? [x + v[2], y + v[3]] : [v[2], v[3]];
      cubic(p1, p2, p3); lcx = p2[0]; lcy = p2[1]; x = p3[0]; y = p3[1];
    } else if (C === "Q") {
      const v = [num(), num(), num(), num()];
      const p1 = rel ? [x + v[0], y + v[1]] : [v[0], v[1]], p2 = rel ? [x + v[2], y + v[3]] : [v[2], v[3]];
      for (let s = 1; s <= 8; s++) { const t = s / 8, u = 1 - t; pts.push([u * u * x + 2 * u * t * p1[0] + t * t * p2[0], u * u * y + 2 * u * t * p1[1] + t * t * p2[1]]); }
      x = p2[0]; y = p2[1];
    } else { hasArc = true; break; }
  }
  return { pts, hasArc, closed };
}

/**
 * @param {string} svgText
 * @param {{maxSvgBytes?:number}} [opts]
 */
export function measureSvg(svgText, opts = {}) {
  const maxBytes = opts.maxSvgBytes ?? 5_000_000;
  const out = {
    ok: false, errors: /** @type {string[]} */ ([]), warnings: /** @type {string[]} */ ([]), unsupported: /** @type {string[]} */ ([]),
    viewBox: /** @type {number[]|null} */ (null), pageTransform: /** @type {Matrix|null} */ (null),
    counts: { text: 0, tspan: 0, rect: 0, path: 0, use: 0, image: 0, nodeGroups: 0, outsideText: 0 },
    fonts: /** @type {string[]} */ ([]), nodes: /** @type {any[]} */ ([]), paths: /** @type {any[]} */ ([]),
  };
  const fail = (m) => { out.errors.push(m); return out; };
  if (typeof svgText !== "string" || svgText.length === 0) return fail("empty SVG input");
  if (svgText.length > maxBytes) return fail(`SVG too large (> ${maxBytes} bytes)`);
  if (!/<svg[\s>]/.test(svgText)) return fail("not an SVG document (no <svg>)");
  if (/<svg[^>]*>[\s\S]*?<text[^>]*>\s*<tspan[^>]*>\s*Error \d+/.test(svgText) || /font-weight="bold" fill="#cd0930"/.test(svgText)) return fail("Kroki error SVG detected (compilation error image, not a diagram)");

  // 폰트
  /** @type {Record<string, any>} */ const fonts = {};
  for (const m of svgText.matchAll(/font-family:(\w+);src:url\(data:[^;]+;base64,([^)]+)\)/g)) {
    const f = parseWoff(Buffer.from(m[2], "base64"));
    if (f.ok) fonts[m[1]] = f; else out.warnings.push(`font ${m[1]} unreadable: ${f.error}`);
    out.fonts.push(m[1]);
  }
  /** @type {Record<string,{family:string,size:number}>} */ const classFont = {};
  for (const m of svgText.matchAll(/text\.(f\d+)\s*\{font-family:(\w+);font-size:([\d.]+)px\}/g)) classFont[m[1]] = { family: m[2], size: Number(m[3]) };

  const parsed = parseXml(svgText);
  if (!parsed.ok) return fail("XML parse error: " + parsed.error);
  const svgEl = parsed.root.children.find((c) => c.tag === "svg");
  if (!svgEl) return fail("no <svg> root element");
  const vb = (svgEl.attrs.viewBox || "").trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v))) return fail("missing or invalid viewBox");
  out.viewBox = vb;

  /** @type {Matrix|null} */ let pageInv = null;
  /** @type {Matrix|null} */ let pageCtm = null;
  let pageGroups = 0;

  const resolveStyle = (st, attrs) => ({
    fill: attrs.fill ?? st.fill, stroke: attrs.stroke ?? st.stroke,
    strokeWidth: attrs["stroke-width"] !== undefined ? Number(attrs["stroke-width"]) : st.strokeWidth,
    dash: attrs["stroke-dasharray"] ?? st.dash,
  });
  const isNodeGroup = (g) => {
    if (g.tag !== "g" || !(g.attrs.transform || "").startsWith("matrix(")) return false;
    const c = g.children.find((k) => k.tag === "g");
    return !!c && /scale\(-1,-1\)/.test(c.attrs.transform || "");
  };

  /** 노드 그룹 내부 수집 */
  const collectNode = (g, ctm, node) => {
    const toTikz = (a, b, ctmX) => { const p = applyPt(ctmX, a, b); return /** @type {[number,number]} */ (applyPt(/** @type {Matrix} */ (pageInv), p[0], p[1])); };
    const addBox = (pts, ctmX) => {
      node.inkSvg = unionBBox(node.inkSvg, bboxOfPoints(pts.map(([a, b]) => applyPt(ctmX, a, b))));
      node.inkTikz = unionBBox(node.inkTikz, bboxOfPoints(pts.map(([a, b]) => toTikz(a, b, ctmX))));
    };
    const walkText = (el, ctmX, st) => {
      if (el.tag === "text") { st = { x: Number(el.attrs.x ?? 0), y: Number(el.attrs.y ?? 0), cls: el.attrs.class }; out.counts.text++; node.baselines.add(st.y); }
      else if (el.tag === "tspan") { out.counts.tspan++; if (el.attrs.x !== undefined) st.x = Number(el.attrs.x); if (el.attrs.y !== undefined) { st.y = Number(el.attrs.y); node.baselines.add(st.y); } }
      for (const a of BAD_TEXT_ATTRS) if (el.attrs[a] !== undefined && el.tag !== "g") node.reasons.add(`text attribute '${a}' unsupported`);
      if (!Number.isFinite(st.x) || !Number.isFinite(st.y)) { node.reasons.add("non-numeric text position"); return; }
      for (const ch of el.children) {
        if (ch.tag === "#text") {
          const cf = classFont[st.cls]; const f = cf && fonts[cf.family];
          if (!f) { node.reasons.add(`font unavailable for class ${st.cls}`); node.inkChecked = false; continue; }
          const s = cf.size / f.upm;
          for (const chr of /** @type {string} */ (ch.text)) {
            const gl = f.glyph(chr);
            if (!gl) { if (chr.trim()) { node.reasons.add(`no glyph for '${chr}'`); node.inkChecked = false; } st.x += 0; continue; }
            node.chars.push(chr);
            if (gl.box) {
              const x0 = st.x + gl.box.xMin * s, x1 = st.x + gl.box.xMax * s, yb = st.y - gl.box.yMin * s, yt = st.y - gl.box.yMax * s;
              addBox([[x0, yt], [x1, yt], [x1, yb], [x0, yb]], ctmX);
              const gb = bboxOfPoints([[x0, yt], [x1, yb]].map(([a, b]) => toTikz(a, b, ctmX)));
              node.glyphBoxes.push({ ch: chr, bbox: gb });
              const ol = f.outline(gl.gid);
              if (!ol || ol.composite) { node.inkChecked = false; node.reasons.add("composite/unreadable glyph outline"); }
              else for (const c of ol.contours) node.outline.push({ closed: true, pts: c.map(([fx, fy]) => toTikz(st.x + fx * s, st.y - fy * s, ctmX)) });
            }
            st.x += gl.adv * s;
          }
        } else if (ch.tag === "tspan") walkText(ch, ctmX, st);
      }
    };
    const walk = (el, ctmX) => {
      for (const ch of el.children) {
        if (ch.tag === "text") walkText(ch, ctmX, null);
        else if (ch.tag === "rect") {
          out.counts.rect++;
          const x = Number(ch.attrs.x), y = Number(ch.attrs.y), w = Number(ch.attrs.width), h = Number(ch.attrs.height);
          if (![x, y, w, h].every(Number.isFinite)) { node.reasons.add("rect with non-numeric geometry"); continue; }
          const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
          addBox(corners, ctmX); node.rects++;
          node.outline.push({ closed: true, pts: corners.map(([a, b]) => toTikz(a, b, ctmX)) });
        } else if (ch.tag === "g") {
          const t = parseTransform(ch.attrs.transform);
          if (!t.ok) { node.reasons.add(t.reason || "bad transform"); continue; }
          if (isNodeGroup(ch)) { node.reasons.add("nested node group"); continue; }
          walk(ch, mul(ctmX, t.m));
        } else if (["use", "image", "foreignObject", "path", "circle", "ellipse", "line", "polyline", "polygon"].includes(ch.tag)) {
          if (ch.tag === "use") out.counts.use++; else if (ch.tag === "image") out.counts.image++;
          node.reasons.add(`unsupported element <${ch.tag}> inside node group`);
        }
      }
    };
    walk(g, ctm);
  };

  let nodeCounter = 0;
  const walkTree = (el, ctm, st, inNode) => {
    for (const ch of el.children) {
      if (ch.tag === "#text") continue;
      if (ch.tag === "use") { out.counts.use++; out.unsupported.push("<use> element outside node group (glyph-by-reference SVG?)"); continue; }
      if (ch.tag === "image") { out.counts.image++; out.unsupported.push("<image> element"); continue; }
      if (ch.tag === "text") { out.counts.outsideText++; continue; }
      if (ch.tag === "path") {
        out.counts.path++;
        if (!pageInv) continue;
        const pst = resolveStyle(st, ch.attrs);
        const { pts, hasArc, closed } = pathToPolyline(ch.attrs.d || "");
        if (hasArc) out.warnings.push("path with arc command ignored");
        if (pts.length < 2 || pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) { out.warnings.push("degenerate/invalid path ignored"); continue; }
        const rel = /** @type {Matrix} */ (mul(/** @type {Matrix} */ (pageInv), ctm));
        const tp = pts.map(([a, b]) => applyPt(rel, a, b));
        const bbox = bboxOfPoints(tp);
        const w = bbox.x1 - bbox.x0, h = bbox.y1 - bbox.y0;
        const straight = tp.every((p) => Math.abs((p[0] - tp[0][0]) * (tp[tp.length - 1][1] - tp[0][1]) - (p[1] - tp[0][1]) * (tp[tp.length - 1][0] - tp[0][0])) < 1e-6 * Math.max(1, w * h + w + h));
        const filled = pst.fill !== undefined && pst.fill !== "none";
        const dashed = pst.dash !== undefined && pst.dash !== "none" && pst.dash !== "";
        const scaleF = Math.sqrt(Math.abs(rel[0] * rel[3] - rel[1] * rel[2]));
        const halfWidth = pst.strokeWidth !== undefined && Number.isFinite(pst.strokeWidth) ? (pst.strokeWidth * scaleF) / 2 : 0;
        let kind;
        if (hasArc) kind = "unknown";
        else if (filled) kind = tp.length >= 8 && Math.abs(w - h) < 0.2 * Math.max(w, h) && Math.max(w, h) <= 12 ? "marker" : "filled";
        else if (dashed) kind = "dashed";
        else if (straight) kind = ((h < 1e-6 && Math.abs(bbox.y0) <= 0.5) || (w < 1e-6 && Math.abs(bbox.x0) <= 0.5)) ? "axis" : "line";
        else kind = "curve";
        out.paths.push({ index: out.paths.length, kind, axisBasis: kind === "axis" ? "straight horizontal/vertical line through x=0 or y=0 (heuristic)" : undefined, fill: pst.fill ?? null, dash: dashed ? pst.dash : null, strokeWidth: pst.strokeWidth ?? null, halfWidth: round3(halfWidth), nPts: tp.length, closed, bbox, geom: { pts: tp, closed } });
        continue;
      }
      if (ch.tag !== "g") continue;
      const t = parseTransform(ch.attrs.transform);
      if (!t.ok) { out.unsupported.push(`group transform: ${t.reason}`); continue; }
      const m = mul(ctm, t.m);
      if (ch.attrs["stroke-miterlimit"] !== undefined) {
        pageGroups++;
        if (pageGroups > 1) { out.unsupported.push("multiple TikZ page groups"); continue; }
        if (Math.abs(m[1]) > 1e-9 || Math.abs(m[2]) > 1e-9) { out.errors.push("page transform has rotation/skew"); continue; }
        const iv = inverse(m);
        if (!iv) { out.errors.push("page transform not invertible"); continue; }
        pageCtm = m; pageInv = iv;
      }
      const nst = resolveStyle(st, ch.attrs);
      if (pageInv && isNodeGroup(ch)) {
        if (inNode) { out.unsupported.push("node group nested in node group"); continue; }
        const node = { reasons: new Set(), chars: [], glyphBoxes: [], outline: [], baselines: new Set(), rects: 0, inkSvg: null, inkTikz: null, inkChecked: true };
        collectNode(ch, m, node);
        out.counts.nodeGroups++;
        const outer = t.m;
        const origin = applyPt(pageInv, ...applyPt(m, 0, 0));
        if (Math.abs(outer[1]) > 1e-6 || Math.abs(outer[2]) > 1e-6) node.reasons.add("rotated or skewed node (b/c != 0)");
        if (outer[0] <= 0 || outer[3] <= 0) node.reasons.add("non-positive node scale");
        const fillColor = (function find(e) { if (e.attrs && e.attrs.fill && e.attrs.fill !== "#000") return e.attrs.fill; for (const c of e.children || []) { const r = find(c); if (r) return r; } return null; })(ch);
        const empty = !node.inkTikz && node.chars.length === 0 && node.rects === 0;
        out.nodes.push({
          index: nodeCounter++, empty, supported: node.reasons.size === 0, reasons: [...node.reasons],
          matrix: outer.map(round3), scaleX: round3(outer[0]), scaleY: round3(outer[3]), originTikzPt: origin.map(round3),
          chars: node.chars.join(""), hasRule: node.rects > 0, fill: fillColor, distinctBaselines: node.baselines.size,
          inkChecked: node.inkChecked && !empty, bboxTikz: node.inkTikz, bboxSvg: node.inkSvg,
          centerTikz: node.inkTikz ? bboxCenter(node.inkTikz) : null, glyphBoxes: node.glyphBoxes, geom: { outline: node.outline },
        });
        continue;
      }
      walkTree(ch, m, nst, inNode);
    }
  };
  walkTree(svgEl, IDENTITY, { fill: undefined, stroke: undefined, strokeWidth: undefined, dash: undefined }, false);

  if (!pageInv) { out.errors.push("TikZ page group (g[stroke-miterlimit]) not found — unexpected SVG structure"); return out; }
  out.pageTransform = /** @type {Matrix} */ (pageCtm);
  if (out.counts.outsideText > 0) out.unsupported.push(`${out.counts.outsideText} <text> element(s) outside any recognised node group`);
  // 빈 노드 ↔ 마커 경로 연결
  for (const n of out.nodes) {
    if (!n.empty) continue;
    const mk = out.paths.find((p) => p.kind === "marker" && Math.hypot((p.bbox.x0 + p.bbox.x1) / 2 - n.originTikzPt[0], (p.bbox.y0 + p.bbox.y1) / 2 - n.originTikzPt[1]) < 0.5);
    n.markerPathIndex = mk ? mk.index : null;
  }
  out.ok = out.errors.length === 0;
  return out;
}

/** JSON 직렬화용: 큰 기하 데이터 제거 + 반올림 */
export function summarizeMeasurement(m) {
  return {
    ok: m.ok, errors: m.errors, warnings: [...new Set(m.warnings)], unsupported: [...new Set(m.unsupported)], viewBox: m.viewBox, pageTransform: m.pageTransform && m.pageTransform.map(round3), counts: m.counts, fonts: m.fonts,
    nodes: m.nodes.map((n) => ({ index: n.index, empty: n.empty, supported: n.supported, reasons: n.reasons, matrix: n.matrix, scaleX: n.scaleX, scaleY: n.scaleY, originTikzPt: n.originTikzPt, chars: n.chars, hasRule: n.hasRule, fill: n.fill, distinctBaselines: n.distinctBaselines, inkChecked: n.inkChecked, bboxTikzPt: roundBBox(n.bboxTikz), bboxSvg: roundBBox(n.bboxSvg), centerTikzPt: n.centerTikz && n.centerTikz.map(round3), markerPathIndex: n.markerPathIndex ?? null })),
    paths: m.paths.map((p) => ({ index: p.index, kind: p.kind, axisBasis: p.axisBasis, fill: p.fill, dash: p.dash, strokeWidth: p.strokeWidth, halfWidthPt: p.halfWidth, nPts: p.nPts, bboxTikzPt: roundBBox(p.bbox) })),
  };
}
