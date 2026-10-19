// 스마트 라벨 엔진 v0.1 — SVG 임베디드 WOFF(TrueType) 해석.
// 원본: experiments/smart-label-svg/measure-labels.mjs 의 parseWoff (검증된 cmap/hmtx/loca/glyf bbox 로직 복제)
// 개선: 입력 검증(시그니처/범위), 오류를 throw 하지 않고 {ok:false} 반환, 단순 글리프 윤곽(outline) 추출 추가.
import { inflateSync } from "node:zlib";

/**
 * @typedef {{ok:true, upm:number, glyph:(ch:string)=>({gid:number, adv:number, box:{xMin:number,yMin:number,xMax:number,yMax:number}|null}|null), outline:(gid:number)=>({contours:[number,number][][], composite:boolean}|null)}|{ok:false, error:string}} Font
 */

/** @param {Buffer} buf @returns {Font} */
export function parseWoff(buf) {
  try {
    if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "wOFF") return { ok: false, error: "not a WOFF (signature mismatch)" };
    const n = buf.readUInt16BE(12);
    /** @type {Record<string, Buffer>} */ const tables = {};
    for (let i = 0; i < n; i++) {
      const o = 44 + i * 20;
      if (o + 20 > buf.length) return { ok: false, error: "truncated WOFF table directory" };
      const tag = buf.toString("ascii", o, o + 4);
      const off = buf.readUInt32BE(o + 4), comp = buf.readUInt32BE(o + 8), orig = buf.readUInt32BE(o + 12);
      if (off + comp > buf.length) return { ok: false, error: `table ${tag} out of range` };
      const raw = buf.subarray(off, off + comp);
      tables[tag] = comp < orig ? inflateSync(raw) : raw;
    }
    for (const t of ["head", "hhea", "hmtx", "cmap", "loca", "glyf"]) if (!tables[t]) return { ok: false, error: `missing table ${t} (CFF/OTF fonts unsupported)` };
    const { head, hhea, hmtx, loca, glyf, cmap } = tables;
    const upm = head.readUInt16BE(18), locFmt = head.readInt16BE(50), nH = hhea.readUInt16BE(34);
    if (!upm) return { ok: false, error: "unitsPerEm = 0" };

    const cm = new Map();
    const nt = cmap.readUInt16BE(2);
    for (let i = 0; i < nt; i++) {
      const so = cmap.readUInt32BE(4 + i * 8 + 4), fmt = cmap.readUInt16BE(so);
      if (fmt === 4) {
        const sc = cmap.readUInt16BE(so + 6) / 2;
        const endO = so + 14, startO = endO + sc * 2 + 2, deltaO = startO + sc * 2, rangeO = deltaO + sc * 2;
        for (let s = 0; s < sc; s++) {
          const end = cmap.readUInt16BE(endO + s * 2), start = cmap.readUInt16BE(startO + s * 2);
          const delta = cmap.readInt16BE(deltaO + s * 2), ro = cmap.readUInt16BE(rangeO + s * 2);
          for (let c = start; c <= end && c !== 0xffff; c++) {
            let g;
            if (ro === 0) g = (c + delta) & 0xffff;
            else { const go = rangeO + s * 2 + ro + (c - start) * 2; g = cmap.readUInt16BE(go); if (g) g = (g + delta) & 0xffff; }
            if (g && !cm.has(c)) cm.set(c, g);
          }
        }
      } else if (fmt === 0) {
        for (let c = 0; c < 256; c++) { const g = cmap[so + 6 + c]; if (g && !cm.has(c)) cm.set(c, g); }
      } else if (fmt === 6) {
        const first = cmap.readUInt16BE(so + 6), cnt = cmap.readUInt16BE(so + 8);
        for (let k = 0; k < cnt; k++) { const g = cmap.readUInt16BE(so + 10 + k * 2); if (g && !cm.has(first + k)) cm.set(first + k, g); }
      }
    }
    const numGlyphs = (locFmt === 0 ? loca.length / 2 : loca.length / 4) - 1;
    const adv = (g) => hmtx.readUInt16BE(Math.min(g, nH - 1) * 4);
    const locaAt = (g) => (locFmt === 0 ? loca.readUInt16BE(g * 2) * 2 : loca.readUInt32BE(g * 4));
    const gbox = (g) => {
      if (g < 0 || g >= numGlyphs) return null;
      const a = locaAt(g), b = locaAt(g + 1);
      if (a === b) return null;
      return { xMin: glyf.readInt16BE(a + 2), yMin: glyf.readInt16BE(a + 4), xMax: glyf.readInt16BE(a + 6), yMax: glyf.readInt16BE(a + 8) };
    };

    /** 단순 글리프 윤곽 → 폴리라인(폰트 단위). 합성 글리프는 composite:true 로 표시(윤곽 없음). */
    const outline = (g) => {
      if (g < 0 || g >= numGlyphs) return null;
      const a = locaAt(g), b = locaAt(g + 1);
      if (a === b) return { contours: [], composite: false };
      const nc = glyf.readInt16BE(a);
      if (nc < 0) return { contours: [], composite: true };
      let p = a + 10;
      const ends = [];
      for (let i = 0; i < nc; i++) { ends.push(glyf.readUInt16BE(p)); p += 2; }
      const nPts = nc ? ends[nc - 1] + 1 : 0;
      const insLen = glyf.readUInt16BE(p); p += 2 + insLen;
      const flags = [];
      while (flags.length < nPts) {
        const f = glyf[p++]; flags.push(f);
        if (f & 8) { let r = glyf[p++]; while (r-- > 0 && flags.length < nPts) flags.push(f); }
      }
      const xs = [], ys = [];
      let v = 0;
      for (let i = 0; i < nPts; i++) { const f = flags[i]; if (f & 2) { const d = glyf[p++]; v += f & 16 ? d : -d; } else if (!(f & 16)) { v += glyf.readInt16BE(p); p += 2; } xs.push(v); }
      v = 0;
      for (let i = 0; i < nPts; i++) { const f = flags[i]; if (f & 4) { const d = glyf[p++]; v += f & 32 ? d : -d; } else if (!(f & 32)) { v += glyf.readInt16BE(p); p += 2; } ys.push(v); }
      /** @type {[number,number][][]} */ const contours = [];
      let s = 0;
      for (const e of ends) {
        const pts = [];
        for (let i = s; i <= e; i++) pts.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) });
        s = e + 1;
        if (pts.length < 2) continue;
        // 시작점을 on-curve 로 정규화
        let start = pts.findIndex((q) => q.on);
        let seq;
        if (start === -1) { const m0 = { x: (pts[0].x + pts[pts.length - 1].x) / 2, y: (pts[0].y + pts[pts.length - 1].y) / 2, on: true }; seq = [m0, ...pts]; }
        else seq = [...pts.slice(start), ...pts.slice(0, start)];
        const poly = [[seq[0].x, seq[0].y]];
        let i = 1;
        let cur = seq[0];
        while (i <= seq.length) {
          const q = seq[i % seq.length];
          if (q.on) { poly.push([q.x, q.y]); cur = q; i++; }
          else {
            const nx = seq[(i + 1) % seq.length];
            const end = nx.on ? nx : { x: (q.x + nx.x) / 2, y: (q.y + nx.y) / 2, on: true };
            for (let k = 1; k <= 4; k++) { const t = k / 4, u = 1 - t; poly.push([u * u * cur.x + 2 * u * t * q.x + t * t * end.x, u * u * cur.y + 2 * u * t * q.y + t * t * end.y]); }
            cur = end; i += nx.on ? 2 : 1;
          }
        }
        contours.push(/** @type {[number,number][]} */ (poly));
      }
      return { contours, composite: false };
    };

    return {
      ok: true, upm,
      glyph: (ch) => { const g = cm.get(ch.codePointAt(0)); return g ? { gid: g, adv: adv(g), box: gbox(g) } : null; },
      outline,
    };
  } catch (e) {
    return { ok: false, error: "WOFF parse exception: " + String(e).slice(0, 120) };
  }
}
