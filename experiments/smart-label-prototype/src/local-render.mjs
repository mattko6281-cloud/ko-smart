// 로컬(오프라인) TikZ 렌더러 — 설치된 MiKTeX latex + dvisvgm 사용. 네트워크 요청 없음.
//  * `--disable-installer` 로 MiKTeX 의 누락 패키지 자동 다운로드를 차단한다 (없으면 컴파일 실패로 보고).
//  * `\def\pgfsysdriver{pgfsys-dvisvgm.def}` 를 문서 맨 앞에 두어 Kroki 와 같은 구조의 SVG(노드별 그룹, <text> 글리프)를 얻는다.
//    (실험 확인: 이 줄이 없으면 dvisvgm 3.4 가 노드 그룹을 평탄화하여 기존 엔진이 측정하지 못한다.)
//  * KO-SMART getProcessedInput 과 동일하게 amsmath + 라이브러리를 주입하되, kotex 는 넣지 않는다(라벨이 수식/영문이며 로컬 환경 의존 최소화).
//  * 운영 앱 코드와 무관한 독립 구현이다.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const HEADER =
  "\\def\\pgfsysdriver{pgfsys-dvisvgm.def}\n" +
  "\\documentclass[tikz, border=2pt]{standalone}\n" +
  "\\usepackage{amsmath}\n" +
  "\\usetikzlibrary{arrows.meta, calc, intersections, patterns, decorations.pathmorphing}\n" +
  "\\begin{document}\n";
export const FOOTER = "\n\\end{document}";

/**
 * @param {string} body tikzpicture 환경 문자열
 * @param {{workRoot:string, timeoutMs?:number}} opts
 * @returns {{ok:boolean, svg?:string, doc:string, cached:boolean, error?:string, dir:string}}
 */
export function renderTikz(body, opts) {
  const doc = HEADER + body + FOOTER;
  const hash = createHash("sha1").update(doc).digest("hex").slice(0, 16);
  const dir = join(opts.workRoot, hash);
  mkdirSync(dir, { recursive: true });
  const svgPath = join(dir, "t.svg");
  if (existsSync(svgPath)) return { ok: true, svg: readFileSync(svgPath, "utf8"), doc, cached: true, dir };
  writeFileSync(join(dir, "t.tex"), doc, "utf8");
  const to = opts.timeoutMs ?? 90000;
  const l = spawnSync("latex", ["--disable-installer", "-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", "t.tex"], { cwd: dir, timeout: to, encoding: "utf8", windowsHide: true });
  if (!existsSync(join(dir, "t.dvi"))) {
    const log = existsSync(join(dir, "t.log")) ? readFileSync(join(dir, "t.log"), "utf8") : (l.stdout || "") + (l.stderr || "");
    const m = /^! .*$/m.exec(log);
    return { ok: false, doc, cached: false, dir, error: "latex failed: " + (m ? m[0] : String(l.error || "unknown").slice(0, 160)) };
  }
  const d = spawnSync("dvisvgm", ["--font-format=woff", "t.dvi", "-o", "t.svg"], { cwd: dir, timeout: to, encoding: "utf8", windowsHide: true });
  if (!existsSync(svgPath)) return { ok: false, doc, cached: false, dir, error: "dvisvgm failed: " + String((d.stderr || d.error || "")).slice(0, 160) };
  return { ok: true, svg: readFileSync(svgPath, "utf8"), doc, cached: false, dir };
}
