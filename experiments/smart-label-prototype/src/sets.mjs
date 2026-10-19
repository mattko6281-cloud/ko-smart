// 기준 자료 로더 (읽기 전용) + 개발/검증 분리 가드.
//  - 샘플 1~5(개발): 항상 읽을 수 있음.
//  - 샘플 6~7 수정전: output/FROZEN.json (알고리즘 고정 증거) 이 있을 때만 읽는다.
//  - 샘플 6~7 최종: output/recommendations-holdout.json (고정 알고리즘의 추천 결과 저장 증거) 이 있을 때만 읽는다.
// 가드는 실수로 홀드아웃을 열어보는 것을 막기 위한 장치이며, 읽기 시도는 모두 access-log 에 기록된다.
import { readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const protoRoot = join(here, "..");
export const setsDir = join(protoRoot, "..", "smart-label-reference", "sets");
export const outDir = join(protoRoot, "output");
mkdirSync(outDir, { recursive: true });
const logPath = join(outDir, "holdout-access-log.txt");

export const DEV_IDS = [1, 2, 3, 4, 5];
export const HOLDOUT_IDS = [6, 7];
const KIND = { before: "수정전", final: "최종" };

const orderLog = join(outDir, "access-order.log");
export function logEvent(msg) { appendFileSync(orderLog, `${new Date().toISOString()} EVENT ${msg}\n`); }
const stage = () => (existsSync(join(outDir, "recommendations-holdout.json")) ? "RECS_SAVED" : existsSync(join(outDir, "FROZEN.json")) ? "FROZEN" : "DEV");
function gateOk(kind) {
  if (kind === "before") { try { return !!JSON.parse(readFileSync(join(outDir, "FROZEN.json"), "utf8")).sourceHashes; } catch { return false; } }
  try { const f = JSON.parse(readFileSync(join(outDir, "FROZEN.json"), "utf8")); const r = JSON.parse(readFileSync(join(outDir, "recommendations-holdout.json"), "utf8")); return !!(r.frozenManifestSha && r.frozenManifestSha === f.manifestSha && r.samples && r.samples["6"] && r.samples["7"]); } catch { return false; }
}

export function loadSet(id, kind) {
  const holdout = HOLDOUT_IDS.includes(id);
  const st = stage();
  const unlocked = holdout ? gateOk(kind) : DEV_IDS.includes(id);
  appendFileSync(orderLog, `${new Date().toISOString()} READ id=${id} kind=${kind} stage=${st} ${unlocked ? "ALLOWED" : "DENIED"}\n`);
  if (holdout) appendFileSync(logPath, `${new Date().toISOString()} id=${id} kind=${kind} ${unlocked ? "ALLOWED" : "DENIED"}\n`);
  if (!unlocked) throw new Error(holdout ? `holdout 샘플 ${id} 의 '${KIND[kind]}' 는 ${kind === "before" ? "알고리즘 고정(FROZEN.json) 후" : "추천 결과 저장(recommendations-holdout.json) 후"}에만 읽을 수 있습니다.` : "알 수 없는 샘플 id " + id);
  const p = join(setsDir, `샘플${id}_${KIND[kind]}.txt`);
  return readFileSync(p, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}
export function pngPath(id, kind) {
  const holdout = HOLDOUT_IDS.includes(id);
  const unlocked = holdout ? gateOk(kind) : DEV_IDS.includes(id);
  appendFileSync(orderLog, `${new Date().toISOString()} PNG id=${id} kind=${kind} stage=${stage()} ${unlocked ? "ALLOWED" : "DENIED"}\n`);
  if (!unlocked) throw new Error(`holdout PNG(${id}, ${kind}) 는 해당 단계 이전에는 접근할 수 없습니다`);
  return join(setsDir, `샘플${id}_${KIND[kind]}.png`);
}
