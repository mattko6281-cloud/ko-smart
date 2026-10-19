// 스마트 라벨 엔진 v0.1 — 간이 XML 파서.
// 원본: experiments/smart-label-svg/measure-labels.mjs parseXml. 개선: 태그 불일치/미종료 검출(조용한 오파싱 방지).

/** @typedef {{tag:string, attrs:Record<string,string>, children:XNode[], text?:string}} XNode */

/**
 * @param {string} src
 * @returns {{ok:true, root:XNode}|{ok:false, error:string}}
 */
export function parseXml(src) {
  /** @type {XNode} */ const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  for (const m of src.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[a-zA-Z][^>]*>|[^<]+/g)) {
    const t = m[0];
    if (t.startsWith("<!--") || t.startsWith("<?") || t.startsWith("<![CDATA[")) continue;
    if (t.startsWith("</")) {
      const name = /^<\/([a-zA-Z][\w:-]*)/.exec(t)?.[1];
      const top = stack[stack.length - 1];
      if (stack.length < 2 || top.tag !== name) return { ok: false, error: `mismatched closing tag </${name}> (open: ${top.tag})` };
      stack.pop();
      continue;
    }
    if (t[0] === "<") {
      const tag = /^<([a-zA-Z][\w:-]*)/.exec(t)?.[1];
      if (!tag) return { ok: false, error: "malformed tag: " + t.slice(0, 30) };
      /** @type {Record<string,string>} */ const attrs = {};
      for (const a of t.matchAll(/([\w:-]+)\s*=\s*(?:'([^']*)'|"([^"]*)")/g)) attrs[a[1]] = a[2] ?? a[3];
      /** @type {XNode} */ const node = { tag, attrs, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!t.endsWith("/>")) stack.push(node);
    } else {
      const top = stack[stack.length - 1];
      if (t.trim() !== "" || top.tag === "text" || top.tag === "tspan") {
        top.children.push({ tag: "#text", attrs: {}, children: [], text: t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"') });
      }
    }
  }
  if (stack.length !== 1) return { ok: false, error: `unclosed element <${stack[stack.length - 1].tag}>` };
  return { ok: true, root };
}
