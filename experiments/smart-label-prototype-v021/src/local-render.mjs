// 로컬(오프라인) TikZ 렌더러 (v0.2.1) — 설치된 MiKTeX latex + dvisvgm 사용. 네트워크 요청 없음.
// v0.1 및 v0.2 의 output/.work 캐시 디렉터리를 읽기 전용 폴백으로 조회하여 동일 TikZ 재컴파일을 방지한다.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const V01_WORK_CACHE = join(here, "..", "..", "smart-label-prototype", "output", ".work");
const V02_WORK_CACHE = join(here, "..", "..", "smart-label-prototype-v02", "output", ".work");

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
 * @returns {{ok:boolean, svg?:string, doc:string, cached:boolean, cacheSource?:string, error?:string, dir:string}}
 */
export function renderTikz(body, opts) {
  const doc = HEADER + body + FOOTER;
  const hash = createHash("sha1").update(doc).digest("hex").slice(0, 16);
  const dir = join(opts.workRoot, hash);
  const svgPath = join(dir, "t.svg");
  if (existsSync(svgPath)) {
    return { ok: true, svg: readFileSync(svgPath, "utf8"), doc, cached: true, cacheSource: "v021", dir };
  }
  for (const [tag, root] of [["v02-readonly", V02_WORK_CACHE], ["v01-readonly", V01_WORK_CACHE]]) {
    const fallbackSvg = join(root, hash, "t.svg");
    if (existsSync(fallbackSvg)) {
      const svg = readFileSync(fallbackSvg, "utf8");
      mkdirSync(dir, { recursive: true });
      writeFileSync(svgPath, svg, "utf8");
      return { ok: true, svg, doc, cached: true, cacheSource: tag, dir };
    }
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "t.tex"), doc, "utf8");
  const to = opts.timeoutMs ?? 90000;
  const l = spawnSync("latex", ["--disable-installer", "-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", "t.tex"], {
    cwd: dir,
    timeout: to,
    encoding: "utf8",
    windowsHide: true,
  });
  if (!existsSync(join(dir, "t.dvi"))) {
    const log = existsSync(join(dir, "t.log")) ? readFileSync(join(dir, "t.log"), "utf8") : (l.stdout || "") + (l.stderr || "");
    const m = /^! .*$/m.exec(log);
    return { ok: false, doc, cached: false, dir, error: "latex failed: " + (m ? m[0] : String(l.error || "unknown").slice(0, 160)) };
  }
  const d = spawnSync("dvisvgm", ["--font-format=woff", "t.dvi", "-o", "t.svg"], {
    cwd: dir,
    timeout: to,
    encoding: "utf8",
    windowsHide: true,
  });
  if (!existsSync(svgPath)) {
    return { ok: false, doc, cached: false, dir, error: "dvisvgm failed: " + String((d.stderr || d.error || "")).slice(0, 160) };
  }
  return { ok: true, svg: readFileSync(svgPath, "utf8"), doc, cached: false, cacheSource: "compiled", dir };
}
