// 스마트 라벨 엔진 v0.1 — TikZ 라벨 노드 추출기 (분석 전용).
// 입력 TikZ 문자열을 절대 수정/생성하지 않는다. 기존 KO-SMART 파서(page.tsx `nodes`)와 독립적으로 동작하며,
// legacy-node-parser.mjs(복제본)와의 비교 결과(`legacyComparison`)를 함께 제공한다.
import { PT_PER, round3 } from "./geometry.mjs";
import { legacyParseNodes } from "./legacy-node-parser.mjs";

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)`;

/** `%` 주석을 공백으로 치환(오프셋 보존). `\%` 는 주석이 아니다. */
export function maskComments(src) {
  let out = "";
  for (const line of src.split(/(\r?\n)/)) {
    if (/^\r?\n$/.test(line)) { out += line; continue; }
    let cut = -1;
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== "%") continue;
      let bs = 0, j = i - 1;
      while (j >= 0 && line[j] === "\\") { bs++; j--; }
      if (bs % 2 === 0) { cut = i; break; }
    }
    out += cut === -1 ? line : line.slice(0, cut) + " ".repeat(line.length - cut);
  }
  return out;
}

/** 균형 괄호 끝 인덱스(열린 위치 open → 닫는 위치). 실패 -1. 이스케이프된 괄호는 무시. */
function matchClose(s, open, oc, cc) {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "\\") { i++; continue; }
    if (s[i] === oc) d++;
    else if (s[i] === cc) { d--; if (d === 0) return i; }
  }
  return -1;
}
/** 최상위 쉼표 분리 (중괄호/대괄호/괄호 깊이 고려) */
function splitTop(s) {
  const parts = []; let d = 0, cur = "";
  for (const ch of s) {
    if ("{[(".includes(ch)) d++; else if ("}])".includes(ch)) d--;
    if (ch === "," && d === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim() !== "") parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}
export function parseLengthPt(str) {
  const m = new RegExp(`^(${NUM})\\s*(pt|mm|cm|in|bp)?$`).exec(str.trim());
  if (!m) return null;
  return { value: Number(m[1]) * (m[2] ? PT_PER[m[2]] : 1), hadUnit: !!m[2] };
}

/** tikzpicture 옵션에서 x/y 단위, every node scale 등 추출 */
export function parsePictureContext(masked) {
  const warnings = []; const unsupported = [];
  const ctx = { xUnitPt: PT_PER.cm, yUnitPt: PT_PER.cm, everyNodeScale: 1, everyNodeTransformShape: false, found: false, coordsReliable: true, optionsRaw: null };
  const b = masked.indexOf("\\begin{tikzpicture}");
  if (b === -1) { warnings.push("\\begin{tikzpicture} not found; default units (1cm) assumed"); return { ctx, warnings, unsupported }; }
  ctx.found = true;
  let p = b + "\\begin{tikzpicture}".length;
  while (/\s/.test(masked[p] ?? "")) p++;
  if (masked[p] !== "[") return { ctx, warnings, unsupported };
  const e = matchClose(masked, p, "[", "]");
  if (e === -1) { unsupported.push("unbalanced tikzpicture options"); ctx.coordsReliable = false; return { ctx, warnings, unsupported }; }
  const raw = masked.slice(p + 1, e);
  ctx.optionsRaw = raw;
  for (const opt of splitTop(raw)) {
    let m;
    if ((m = new RegExp(`^x\\s*=\\s*\\{?\\s*(${NUM}\\s*(?:pt|mm|cm|in|bp)?)\\s*\\}?$`).exec(opt))) { const l = parseLengthPt(m[1]); if (l) ctx.xUnitPt = l.hadUnit ? l.value : l.value * PT_PER.cm; else ctx.coordsReliable = false; }
    else if ((m = new RegExp(`^y\\s*=\\s*\\{?\\s*(${NUM}\\s*(?:pt|mm|cm|in|bp)?)\\s*\\}?$`).exec(opt))) { const l = parseLengthPt(m[1]); if (l) ctx.yUnitPt = l.hadUnit ? l.value : l.value * PT_PER.cm; else ctx.coordsReliable = false; }
    else if (/^every\s+node\/\.style\s*=/.test(opt)) {
      const sm = new RegExp(`(?<![a-zA-Z])scale\\s*=\\s*(${NUM})`).exec(opt);
      if (sm) ctx.everyNodeScale = Number(sm[1]);
      if (/transform\s+shape/.test(opt)) ctx.everyNodeTransformShape = true;
    } else if (/^(scale|xscale|yscale|rotate|shift|xshift|yshift|cm|xslant|yslant|x|y|z)\b/.test(opt) && !/^[xyz]\s*=/.test(opt)) {
      unsupported.push(`picture-level transform '${opt.slice(0, 30)}' — expected coordinates unreliable`); ctx.coordsReliable = false;
    } else if (/^[xyz]\s*=/.test(opt) && !/^[xy]\s*=/.test(opt)) { warnings.push(`unhandled axis vector option '${opt.slice(0, 30)}'`); ctx.coordsReliable = false; }
    else if (/^[xy]\s*=/.test(opt)) { warnings.push(`unparsed unit option '${opt.slice(0, 30)}'`); ctx.coordsReliable = false; }
  }
  return { ctx, warnings, unsupported };
}

/** \foreach 본문, 변환 scope, 매크로 정의 범위를 찾아 "안전하지 않은 범위"로 반환 */
export function findUnsafeRanges(masked) {
  /** @type {{start:number,end:number,reason:string}[]} */ const ranges = [];
  const macros = new Set();
  for (const m of masked.matchAll(/\\foreach\b/g)) {
    let p = m.index + m[0].length;
    const inM = /\bin\b/.exec(masked.slice(p));
    if (!inM) { ranges.push({ start: m.index, end: masked.length, reason: "foreach (unparsed)" }); continue; }
    for (const v of masked.slice(p, p + inM.index).matchAll(/\\([a-zA-Z]+)/g)) macros.add("\\" + v[1]);
    p += inM.index + 2;
    while (/\s/.test(masked[p] ?? "")) p++;
    if (masked[p] === "{") { const e = matchClose(masked, p, "{", "}"); if (e === -1) { ranges.push({ start: m.index, end: masked.length, reason: "foreach (unbalanced list)" }); continue; } p = e + 1; }
    while (/\s/.test(masked[p] ?? "")) p++;
    let end;
    if (masked[p] === "{") { const e = matchClose(masked, p, "{", "}"); end = e === -1 ? masked.length : e + 1; }
    else { const s = masked.indexOf(";", p); end = s === -1 ? masked.length : s + 1; }
    ranges.push({ start: m.index, end, reason: "inside \\foreach" });
  }
  for (const m of masked.matchAll(/\\(?:def|let)\s*(\\[a-zA-Z]+)|\\(?:re)?newcommand\s*\*?\s*\{?\s*(\\[a-zA-Z]+)|\\pgfmathsetmacro\s*\{\s*(\\[a-zA-Z]+)\s*\}/g)) macros.add(m[1] || m[2] || m[3]);
  // 변환이 있는 scope
  const stack = [];
  for (const m of masked.matchAll(/\\begin\{scope\}\s*(\[[^\]]*\])?|\\end\{scope\}/g)) {
    if (m[0].startsWith("\\begin")) stack.push({ start: m.index, opts: m[1] || "" });
    else { const b = stack.pop(); if (b && /\b(shift|xshift|yshift|scale|xscale|yscale|rotate|cm|xslant|yslant)\b/.test(b.opts)) ranges.push({ start: b.start, end: m.index + m[0].length, reason: "inside transformed scope" }); }
  }
  return { ranges, macros: [...macros] };
}

/** 옵션 문자열 해석 */
export function parseNodeOptions(raw) {
  const res = { raw, position: [], anchor: null, xshift: null, yshift: null, scale: null, xscale: null, yscale: null, transformShape: false, rotate: null, pos: null, innerSep: null, font: null, fill: null, text: null, isCircle: false, flags: [], unsupported: [], list: [] };
  if (!raw) return res;
  const POS = new Set(["above", "below", "left", "right", "above left", "above right", "below left", "below right", "centered"]);
  for (const opt of splitTop(raw)) {
    res.list.push(opt);
    let m;
    if (POS.has(opt)) res.position.push(opt);
    else if ((m = /^anchor\s*=\s*(.+)$/.exec(opt))) res.anchor = m[1].trim();
    else if ((m = /^(x|y)shift\s*=\s*(.+)$/.exec(opt))) {
      const l = parseLengthPt(m[2]);
      const key = m[1] === "x" ? "xshift" : "yshift";
      if (l) res[key] = { raw: m[2].trim(), pt: round3(l.value) };
      else { res[key] = { raw: m[2].trim(), pt: null }; res.unsupported.push(`${key} value not a plain length: ${m[2].trim().slice(0, 25)}`); }
    }
    else if ((m = new RegExp(`^(x|y)?scale\\s*=\\s*(${NUM})$`).exec(opt))) { const k = m[1] ? m[1] + "scale" : "scale"; res[k] = Number(m[2]); if (Number(m[2]) <= 0) res.unsupported.push(`${k} <= 0 (mirror/degenerate)`); }
    else if (/^(x|y)?scale\s*=/.test(opt)) res.unsupported.push(`non-numeric scale: ${opt.slice(0, 25)}`);
    else if (/^transform\s+shape$/.test(opt)) res.transformShape = true;
    else if ((m = /^rotate\s*=\s*(.+)$/.exec(opt))) { res.rotate = m[1].trim(); res.unsupported.push("rotated node"); }
    else if (/^sloped$/.test(opt)) { res.flags.push("sloped"); res.unsupported.push("sloped node (rotated)"); }
    else if ((m = /^pos\s*=\s*(.+)$/.exec(opt))) res.pos = m[1].trim();
    else if (/^(midway|near start|near end|at start|at end|very near start|very near end)$/.test(opt)) res.pos = opt;
    else if ((m = /^inner sep\s*=\s*(.+)$/.exec(opt))) res.innerSep = m[1].trim();
    else if ((m = /^font\s*=\s*(.+)$/.exec(opt))) res.font = m[1].trim();
    else if (opt === "circle") res.isCircle = true;
    else if ((m = /^fill\s*=\s*(.+)$/.exec(opt))) res.fill = m[1].trim();
    else if ((m = /^text\s*=\s*(.+)$/.exec(opt))) res.text = m[1].trim();
    else if (/^(text width|align|minimum|text depth|text height|shape|draw|rectangle|ellipse|rounded corners|path picture|label|pin|rotate around|yshift|xshift)\b/.test(opt)) res.flags.push(opt.split(/[=\s]/)[0]);
    else if (/^shift\s*=/.test(opt)) res.unsupported.push("shift={(x,y)} form not interpreted");
  }
  if (res.flags.includes("text") || res.flags.includes("align") || res.flags.includes("text width")) res.unsupported.push("multi-line / fixed-width text options");
  return res;
}

/** 좌표 문자열 "(...)" 내부 해석: 단순 숫자 쌍만 지원 */
export function parseCoordinate(inner, ctx) {
  const m = new RegExp(`^\\s*(${NUM})\\s*(pt|mm|cm|in|bp)?\\s*,\\s*(${NUM})\\s*(pt|mm|cm|in|bp)?\\s*$`).exec(inner);
  if (!m) return { ok: false, reason: /\\|\$/.test(inner) ? "coordinate uses macro/calc/variable" : /:/.test(inner) ? "polar coordinate not interpreted" : /\|-|-\||\+\+|\+/.test(inner) ? "relative/intersection coordinate not interpreted" : /^[A-Za-z]/.test(inner.trim()) ? "named coordinate not resolved" : "complex coordinate expression" };
  const x = Number(m[1]), y = Number(m[3]);
  return { ok: true, x, y, xUnit: m[2] || null, yUnit: m[4] || null, xPt: round3(m[2] ? x * PT_PER[m[2]] : x * ctx.xUnitPt), yPt: round3(m[4] ? y * PT_PER[m[4]] : y * ctx.yUnitPt) };
}

/** 라벨 기초 분류 (의미 분류는 다음 단계) */
export function classifyLabelBasic(label) {
  const t = label.trim();
  if (t === "") return { basicType: "empty", flags: { isEmpty: true } };
  const stripped = t.replace(/\$/g, "").replace(/\\(?:displaystyle|rm|mathrm|textstyle|bf|it|left|right)\b\s*/g, "").replace(/\s+/g, "");
  const flags = {
    isEmpty: false, isNumeric: /^[-+−]?\d+(\.\d+)?$/.test(stripped), isSingleLetter: /^[A-Za-z]$/.test(stripped), isUppercaseLetter: /^[A-Z]$/.test(stripped),
    hasEquals: stripped.includes("="), hasFrac: /\\frac/.test(t), hasSupSub: /[\^_]/.test(t), hasOtherCommands: /\\(?!frac\b)[a-zA-Z]+/.test(stripped), hasKorean: /[가-힣]/.test(t), mathMode: t.includes("$"),
  };
  const basicType = flags.isNumeric ? "number" : flags.isSingleLetter ? "letter" : flags.hasEquals ? "equation" : flags.hasKorean ? "korean-text" : flags.mathMode ? "math" : "text";
  return { basicType, flags };
}

/** 라벨 원문에서 SVG 에 나올 글리프 문자를 예측 (신뢰 불가면 reliable=false) */
export function expectedGlyphChars(label) {
  let s = label.replace(/\$/g, "").replace(/\\(?:displaystyle|rm|mathrm|textstyle|scriptstyle|bf|it|left|right|frac)\b/g, "").replace(/[\^_{}\s]/g, "");
  const reliable = !/\\/.test(s);
  const risky = /[<>|*'"`~]/.test(s);
  const norm = (str) => [...str].filter((c) => !/[-−\u2212\u0000]/.test(c)).sort().join("");
  return { chars: s, normalized: norm(s), reliable, risky };
}
export function normalizeSvgChars(chars) { return [...chars].filter((c) => !/[\s\-−\u2212\u0000]/.test(c)).sort().join(""); }

const lineOf = (src, off) => src.slice(0, off).split("\n").length;

/**
 * @param {string} source 원본 TikZ (문서 전체 또는 tikzpicture 부분)
 * @param {{compareLegacy?:boolean}} [opts]
 */
export function extractTikzNodes(source, opts = {}) {
  const out = { ok: false, nodes: [], coordinates: [], units: null, unsupported: [], warnings: [], errors: [], sequenceReliable: true, unsafeRanges: [], macros: [], legacyComparison: null };
  if (typeof source !== "string" || source.trim() === "") { out.errors.push("empty TikZ source"); return out; }
  if (source.length > 200_000) { out.errors.push("TikZ source too large (>200k chars)"); return out; }
  const masked = maskComments(source);
  const pic = parsePictureContext(masked);
  out.units = pic.ctx; out.warnings.push(...pic.warnings); out.unsupported.push(...pic.unsupported);
  const un = findUnsafeRanges(masked);
  out.unsafeRanges = un.ranges; out.macros = un.macros;
  const unsafeAt = (s, e) => un.ranges.find((r) => s < r.end && e > r.start);

  const startRe = /(?:(\\node|\\coordinate)(?![a-zA-Z])|(?<=[\s)])(node)(?=\s*[[{]))/g;
  let m;
  while ((m = startRe.exec(masked)) !== null) {
    const kw = m[1] || m[2];
    const start = m.index;
    const kind = kw === "\\node" ? "standalone" : kw === "\\coordinate" ? "coordinate" : "inline";
    let p = start + m[0].length;
    const rec = { id: null, kind, start, end: null, line: lineOf(source, start), keyword: kw, optionsRaw: "", optionsRange: null, nameRaw: null, atRaw: null, at: null, labelRaw: null, labelRange: null, isEmptyMarker: false, options: null, inlineAnchor: null, support: "supported", reasons: [], basic: null, joystickTarget: false, usedBy: [] };
    const bad = (why, level = "unsupported") => { rec.reasons.push(why); rec.support = level === "unsupported" ? "unsupported" : rec.support === "unsupported" ? "unsupported" : "partial"; };
    let sawAt = false, ok = true;
    while (p < masked.length) {
      while (/\s/.test(masked[p] ?? "")) p++;
      const ch = masked[p];
      if (ch === "[") {
        const e = matchClose(masked, p, "[", "]");
        if (e === -1) { bad("unbalanced option brackets"); ok = false; break; }
        if (rec.optionsRange) { bad("multiple option blocks"); ok = false; break; }
        rec.optionsRaw = masked.slice(p + 1, e); rec.optionsRange = [p + 1, e]; p = e + 1;
      } else if (ch === "(" && !sawAt) {
        const e = matchClose(masked, p, "(", ")");
        if (e === -1) { bad("unbalanced name parentheses"); ok = false; break; }
        rec.nameRaw = masked.slice(p + 1, e).trim(); p = e + 1;
      } else if (masked.startsWith("at", p) && /\W/.test(masked[p + 2] ?? " ") && kind !== "inline") {
        sawAt = true; p += 2;
        while (/\s/.test(masked[p] ?? "")) p++;
        if (masked[p] !== "(") { bad("'at' not followed by coordinate"); ok = false; break; }
        const e = matchClose(masked, p, "(", ")");
        if (e === -1) { bad("unbalanced at-coordinate"); ok = false; break; }
        rec.atRaw = masked.slice(p + 1, e); p = e + 1;
      } else if (ch === "{" && kind !== "coordinate") {
        const e = matchClose(masked, p, "{", "}");
        if (e === -1) { bad("unbalanced label braces"); ok = false; break; }
        rec.labelRaw = source.slice(p + 1, e); rec.labelRange = [p + 1, e]; p = e + 1; rec.end = p; break;
      } else if (ch === ";" && kind === "coordinate") { rec.end = p + 1; break; }
      else { bad(`unrecognised syntax after ${kw}: '${masked.slice(p, p + 12).replace(/\s+/g, " ")}'`); ok = false; break; }
    }
    if (rec.end === null) { rec.end = p; if (ok) bad("node statement not terminated"); }
    startRe.lastIndex = Math.max(startRe.lastIndex, kind === "coordinate" ? rec.end : rec.labelRange ? rec.labelRange[0] + 0 : start + m[0].length);
    // label 내부의 node 키워드를 다시 훑지 않도록 라벨 끝으로 이동
    if (rec.end) startRe.lastIndex = Math.max(startRe.lastIndex, rec.end);

    rec.options = parseNodeOptions(rec.optionsRaw);
    for (const u of rec.options.unsupported) bad(u, /rotated|sloped|<= 0|multi-line/.test(u) ? "unsupported" : "partial");
    if (rec.labelRaw !== null) {
      rec.isEmptyMarker = rec.labelRaw.trim() === "";
      rec.basic = classifyLabelBasic(rec.labelRaw);
      if (/\\\\/.test(rec.labelRaw)) bad("multi-line label (\\\\)");
      if (!rec.isEmptyMarker && un.macros.some((mc) => rec.labelRaw.includes(mc))) bad("label uses user macro / foreach variable");
    }
    if (rec.atRaw !== null) {
      const c = parseCoordinate(rec.atRaw, pic.ctx);
      if (c.ok) rec.at = c; else bad(`at-coordinate not interpreted: ${c.reason}`, "partial");
    }
    if (kind === "inline" && rec.labelRange) {
      // 직전 토큰이 단순 좌표 ")" 인 경우에만 기준점 추정
      let q = start - 1;
      while (q >= 0 && /\s/.test(masked[q])) q--;
      if (masked[q] === ")" && !rec.options.pos) {
        let d = 0, o = -1;
        for (let k = q; k >= 0; k--) { if (masked[k] === ")") d++; else if (masked[k] === "(") { d--; if (d === 0) { o = k; break; } } }
        if (o !== -1) { const c = parseCoordinate(masked.slice(o + 1, q), pic.ctx); if (c.ok) rec.inlineAnchor = { ...c, basis: "last coordinate before inline node (no pos= given)" }; else rec.reasons.push(`inline anchor not interpreted: ${c.reason}`); }
      } else rec.reasons.push("inline anchor unknown (not directly after a coordinate, or pos= given)");
      if (!rec.inlineAnchor && rec.support === "supported") rec.support = "partial";
    }
    const us = unsafeAt(start, rec.end);
    if (us) bad(us.reason);
    if (kind === "standalone" && rec.at === null && rec.atRaw === null && rec.labelRange && rec.support !== "unsupported") bad("standalone node without 'at' (position depends on path)", "partial");
    if (kind === "coordinate") { rec.support = rec.support === "unsupported" ? "unsupported" : "supported"; out.coordinates.push(rec); continue; }
    out.nodes.push(rec);
  }
  // id / 순서
  out.nodes.forEach((n, i) => { n.id = `n${i}@${n.start}`; n.order = i; });
  const rangesEmittingNodes = out.unsafeRanges.filter((r) => /\\node\b|\bnode\b/.test(masked.slice(r.start, r.end)));
  out.sequenceReliable = !out.nodes.some((n) => n.support === "unsupported") && rangesEmittingNodes.length === 0;
  if (out.unsafeRanges.length && !rangesEmittingNodes.length) out.warnings.push("\\foreach/scope ranges without node statements found (node group order assumed unaffected)");
  if (!out.sequenceReliable) out.warnings.push("sequence-breaking constructs present (\\foreach / macro / transformed scope / unsupported node): SVG group order cannot be trusted for all nodes");
  if (out.coordinates.length) out.warnings.push(`${out.coordinates.length} \\coordinate statement(s) ignored for SVG matching (assumed to emit no node group; UNVERIFIED)`);

  // 기존 파서와 비교
  if (opts.compareLegacy !== false) {
    const legacy = legacyParseNodes(source);
    const legacyStarts = new Set(legacy.map((l) => l.srcIndex));
    const newJoy = new Set(out.nodes.filter((n) => n.labelRange && !n.isEmptyMarker).map((n) => n.start));
    for (const n of out.nodes) n.joystickTarget = !!n.labelRange && !n.isEmptyMarker && legacyStarts.has(n.start);
    out.legacyComparison = {
      legacyCount: legacy.length, newNonEmptyCount: [...newJoy].length,
      onlyInLegacy: legacy.filter((l) => !newJoy.has(l.srcIndex)).map((l) => ({ srcIndex: l.srcIndex, content: l.content.slice(0, 40), likelyReason: maskComments(source)[l.srcIndex] === " " ? "inside % comment (legacy lists it, engine ignores it)" : "other" })),
      onlyInEngine: out.nodes.filter((n) => n.labelRange && !n.isEmptyMarker && !legacyStarts.has(n.start)).map((n) => ({ start: n.start, label: n.labelRaw.slice(0, 40), reasons: n.reasons.slice(0, 2) })),
      identicalSet: legacy.every((l) => newJoy.has(l.srcIndex)) && [...newJoy].every((s) => legacyStarts.has(s)),
    };
  }
  out.ok = out.errors.length === 0;
  return out;
}
