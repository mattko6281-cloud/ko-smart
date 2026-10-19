// 비교 전용 복제본 — 기존 KO-SMART 노드 파서(`src/app/page.tsx` 의 `nodes` useMemo, L735~820)를
// 한 줄도 import 하지 않고 로직만 그대로 복사했다. 신규 파서 결과와의 차이를 비교하기 위한 용도이며
// 운영 코드와 연결되지 않는다. (원본은 수정하지 않았다. 원본 변경 시 이 복제본은 자동 갱신되지 않는다.)

/** @param {string} rawInput */
export function legacyParseNodes(rawInput) {
  const matches = [];
  const startRe = /(?:(?:\\node|\\coordinate)(?![a-zA-Z])|(?<=[\s)])node(?=\s*[[{]))/g;
  let startMatch;
  while ((startMatch = startRe.exec(rawInput)) !== null) {
    const startIdx = startMatch.index;
    const slice = rawInput.slice(startIdx, startIdx + 1500);
    const semiIdx = slice.indexOf(";");
    if (semiIdx === -1) continue;
    const stmt = slice.slice(0, semiIdx);
    const optMatch = stmt.match(/^(?:\\node|\\coordinate|node)\s*\[([^\]]*)\]/);
    const options = optMatch ? optMatch[1] : "";
    let scanFrom = optMatch ? (optMatch.index ?? 0) + optMatch[0].length : (stmt.match(/^(?:\\node|\\coordinate|node)/))?.[0].length ?? 0;
    let i = scanFrom;
    while (i < stmt.length) {
      if (/\s/.test(stmt[i])) { i++; continue; }
      if (stmt.slice(i, i + 2) === "at" && /\W/.test(stmt[i + 2] ?? " ")) { i += 2; continue; }
      if (stmt[i] === "(") {
        let pd = 0;
        for (; i < stmt.length; i++) {
          if (stmt[i] === "(") pd++;
          else if (stmt[i] === ")") { pd--; if (pd === 0) { i++; break; } }
        }
        continue;
      }
      if (stmt[i] === "{") break;
      i = stmt.length;
    }
    scanFrom = i;
    if (scanFrom >= stmt.length || stmt[scanFrom] !== "{") continue;
    let labelStart = -1, labelEnd = -1, depth = 0;
    for (let j = scanFrom; j < stmt.length; j++) {
      const ch = stmt[j]; const prev = j > 0 ? stmt[j - 1] : "";
      if (ch === "{" && prev !== "\\") { if (depth === 0) labelStart = j + 1; depth++; }
      else if (ch === "}" && prev !== "\\") { depth--; if (depth === 0) { labelEnd = j; break; } }
    }
    if (labelStart === -1 || labelEnd === -1) continue;
    const content = stmt.slice(labelStart, labelEnd).trim();
    if (content === "") { startRe.lastIndex = startIdx + (labelEnd + 1); continue; }
    const full = stmt.slice(0, labelEnd + 1);
    matches.push({ full, options, content, index: startIdx, srcIndex: startIdx });
    startRe.lastIndex = startIdx + full.length;
  }
  return matches;
}
