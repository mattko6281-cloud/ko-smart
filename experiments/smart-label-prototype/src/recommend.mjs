// 추천 파이프라인: TikZ 본문 → (로컬 렌더·측정) → 배치/축 추천 → 추천 TikZ + 보존 검증 + 재렌더 검증.
// 원본 문자열은 절대 직접 수정하지 않고, 편집 목록(edits)을 적용한 "새 문자열"만 만든다.
import { buildScene } from "./scene.mjs";
import { PARAMS, planLabels, shiftEdits, planAxes, axisEdits, applyEdits } from "./algorithm.mjs";
import { renderTikz } from "./local-render.mjs";
import { maskComments } from "../../smart-label-engine/src/tikz-nodes.mjs";

export const ALGORITHM_VERSION = "proto-0.1.0";

/** 그림 유형 판별: 이번 v0.1 은 coordinateFunction 만 보정 */
export function classifyFigure(scene) {
  const hasAxes = !!(scene.axes.x && scene.axes.y);
  const plots = scene.stmts.filter((s) => s.type === "plot").length;
  if (hasAxes && plots >= 1) return { type: "coordinateFunction", reason: `x/y 축 식별 + plot ${plots}개` };
  if (!hasAxes && plots === 0) return { type: "unknown", reason: "좌표축/plot 없음 — 전용 규칙 미검증(기하/입체 포함 가능). 원본 유지" };
  return { type: "unknown", reason: hasAxes ? "축은 있으나 plot 이 없음" : "plot 은 있으나 x/y 축을 식별하지 못함" };
}

/** 편집 범위 밖이 전혀 바뀌지 않았고, 편집 내용이 허용 범위(xshift/yshift 값, 축 끝 숫자)만 바꿨는지 검사 */
export function checkPreservation(orig, rec, edits) {
  const issues = [];
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  // skeleton 비교
  let o = "", r = "", pos = 0, rp = 0;
  const recRanges = [];
  let delta = 0;
  for (const e of sorted) { recRanges.push({ start: e.start + delta, end: e.start + delta + e.replacement.length }); delta += e.replacement.length - (e.end - e.start); }
  for (let i = 0; i < sorted.length; i++) {
    o += orig.slice(pos, sorted[i].start) + "§"; pos = sorted[i].end;
    r += rec.slice(rp, recRanges[i].start) + "§"; rp = recRanges[i].end;
  }
  o += orig.slice(pos); r += rec.slice(rp);
  if (o !== r) issues.push("편집 범위 밖 텍스트가 변경됨");
  for (const e of sorted) {
    const before = orig.slice(e.start, e.end), after = e.replacement;
    if (e.kind === "label-shift") {
      const norm = (s) => s.replace(/(x|y)shift\s*=\s*[-+]?[0-9.]+\s*(pt)?/g, "").replace(/[\s,\[\]]/g, "");
      if (norm(before) !== norm(after)) issues.push(`라벨 옵션이 shift 외에도 변경됨: ${before} → ${after}`);
    } else if (e.kind === "axis-x" || e.kind === "axis-y") {
      const norm = (s) => s.replace(/[-+]?(?:\d+\.?\d*|\.\d+)/g, "#").replace(/\s+/g, "");
      if (norm(before) !== norm(after)) issues.push(`축 편집이 숫자 외 구조를 변경함: ${before} → ${after}`);
      // 축의 고정 좌표(0)가 보존되는지: 이미 norm 로 확인되지 않으므로 별도 확인
      const nums = (s) => (s.match(/[-+]?(?:\d+\.?\d*|\.\d+)/g) || []).map(Number);
      const a = nums(before), b = nums(after);
      if (e.kind === "axis-x" && (a[1] !== 0 || b[1] !== 0 || a[3] !== 0 || b[3] !== 0)) issues.push("x축의 y=0 좌표가 변경됨");
      if (e.kind === "axis-y" && (a[0] !== 0 || b[0] !== 0 || a[2] !== 0 || b[2] !== 0)) issues.push("y축의 x=0 좌표가 변경됨");
    } else issues.push("알 수 없는 편집 종류 " + e.kind);
  }
  return { ok: issues.length === 0, issues, editCount: edits.length };
}

/**
 * @param {string} body tikzpicture 환경
 * @param {{workRoot:string, params?:typeof PARAMS, verify?:boolean, applyAxis?:boolean}} opts
 */
export function recommend(body, opts) {
  const P = opts.params || PARAMS;
  const res = { version: ALGORITHM_VERSION, ok: false, status: "failed", figureType: null, errors: [], warnings: [], placements: [], skipped: [], axis: null, edits: [], recommendedBody: body, axisOnlyBody: body, labelOnlyBody: body, preservation: null, verify: null, manual: [] };
  let scene;
  try { scene = buildScene(body, { workRoot: opts.workRoot }); } catch (e) { res.errors.push("장면 구성 예외: " + String(e).slice(0, 160)); return res; }
  res.render = scene.render;
  if (!scene.ok) { res.errors.push(...scene.errors); res.manual.push("원본 렌더/측정 실패 → 추천 불가, 원본 유지"); return res; }
  res.warnings.push(...scene.warnings);
  res.scene = scene;
  const fig = classifyFigure(scene); res.figureType = fig;
  if (fig.type !== "coordinateFunction") { res.ok = true; res.status = "unchanged"; res.manual.push(`그림 유형 '${fig.type}': ${fig.reason}`); return res; }
  let plan = planLabels(scene, P); const plan0 = plan; let axisPlan = planAxes(scene, plan, P); let iters = 1;
  const sig = (p) => JSON.stringify(p.placements.map((q) => [q.id, q.action, q.end, q.side, q.alpha]));
  while (iters < 3 && axisPlan.x && axisPlan.y) {
    const { xU, yU } = scene.units;
    const override = { left: Math.min(...axisPlan.x.new) * xU, right: Math.max(...axisPlan.x.new) * xU, bottom: Math.min(...axisPlan.y.new) * yU, top: Math.max(...axisPlan.y.new) * yU };
    const next = planLabels(scene, P, override); iters++;
    const same = sig(next) === sig(plan); plan = next; axisPlan = planAxes(scene, plan, P);
    if (same) break;
  }
  res.iterations = iters; res.placements = plan.placements; res.skipped = plan.skipped; res.assignments = plan.assignments;
  for (const s of plan.skipped) res.manual.push(`라벨 ${s.label} 보정 안 함: ${s.reason}`);
  const sh = shiftEdits(scene, plan, P); res.shiftReport = sh.report;
  res.axis = { ...axisPlan, xStmt: undefined, yStmt: undefined };
  const ax = axisEdits(scene, axisPlan);
  const labelEdits = sh.edits;
  res.edits = [...labelEdits, ...(opts.applyAxis === false ? [] : ax)];
  res.axisEdits = ax;
  if (axisPlan.notes.length) res.manual.push(...axisPlan.notes);
  try {
    res.recommendedBody = applyEdits(body, res.edits);
    // 축을 늘리지 않는 경우(기본값, 축 변경은 별도 승인)에는 원래 축 기준으로 따로 계획한 라벨 위치를 사용한다
    const so = shiftEdits(scene, plan0, P); const labelOnlyEdits = so.edits; res.labelOnlyShiftReport = so.report;
    res.labelOnlyEdits = labelOnlyEdits; res.labelOnlyPlacements = plan0.placements;
    res.labelOnlyBody = applyEdits(body, labelOnlyEdits);
    res.axisOnlyBody = applyEdits(body, ax);
  } catch (e) { res.errors.push("편집 적용 실패: " + e.message); res.recommendedBody = body; return res; }
  res.preservation = checkPreservation(body, res.recommendedBody, res.edits);
  res.preservationLabelOnly = checkPreservation(body, res.labelOnlyBody, res.labelOnlyEdits || []);
  if (!res.preservationLabelOnly.ok) res.errors.push("라벨만 코드 보존 검증 실패: " + res.preservationLabelOnly.issues.join("; "));
  if (!res.preservation.ok) { res.errors.push("보존 검증 실패 → 원본 유지: " + res.preservation.issues.join("; ")); res.recommendedBody = body; res.status = "failed"; return res; }
  if (res.edits.length === 0) { res.ok = true; res.status = "unchanged"; return res; }
  if (opts.verify !== false) {
    const rr = buildScene(res.recommendedBody, { workRoot: opts.workRoot });
    res.verify = { compiled: rr.ok, error: rr.ok ? null : rr.errors.join("; ") };
    if (!rr.ok) { res.errors.push("추천 코드 컴파일/측정 실패 → 원본 유지: " + rr.errors.join("; ")); res.recommendedBody = body; res.status = "failed"; return res; }
    res.recScene = rr;
  }
  res.ok = true; res.status = "recommended";
  return res;
}

export { maskComments, renderTikz };
