// KO-SMART v0.2.1 / v0.2.2-beta 개발자 전용 베타 — Kroki 비동기 렌더링 어댑터 및 권한·안전성·충돌 진단 게이트
// 원칙:
//  1) 기존 v0.1, v0.2, v0.2.1 알고리즘 및 smart-label-engine 코드는 단 한 줄도 수정하지 않고 그대로 import 하여 재사용한다.
//  2) 엔진 선택 옵션(engineVersion):
//     - "v0.2.1" (기본 선택): 기존 운영 베타 엔진 그대로 실행
//     - "v0.2.2-beta" (개선 베타): 동결 검증된 interim-v1(Unit 1 + Unit 2/2+ + Unit 3-A) 엔진 실행
//  3) 기존 local-render.mjs(동기식 spawnSync) 대신 자체 Kroki 서버 HTTP(비동기 fetch)로 SVG를 받아
//     요청 전용 임시 workRoot(<hash>/t.svg)에 스테이징한 뒤 buildScene / verifyOutputVariant 를 호출한다.
//  4) Kroki 렌더링이 실패하거나 스테이징되지 않은 경우에는 buildScene 을 절대 호출하지 않아 로컬 latex 실행 폴백을 원천 차단한다.
//  5) 한국어 포함 도형, 축(x, y) 미비 도형, 2차 검증(verify=true) 실패 도형은 모두 원본을 100% 유지한다.
//  6) 축 길이 자동 조정(applyAxis)은 기본 OFF이며, ON일 때도 길이 연장만 수행하고 x, y, O 및 일반 노드·곡선 충돌 검증을 통과해야만 허용된다.
//  7) 원본부터 존재하던 미해결 겹침과 자동 이동/축 조정으로 새로 발생한 겹침을 엄격히 구분하여 보고한다.

import { createHash, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HEADER, FOOTER } from "../../../experiments/smart-label-prototype-v021/src/local-render.mjs";
import { buildScene } from "../../../experiments/smart-label-prototype-v021/src/scene.mjs";
import { PARAMS, shiftEdits, planAxes, axisEdits, applyEdits } from "../../../experiments/smart-label-prototype-v021/src/algorithm.mjs";
import { planLabelsMultiEngine } from "../../../experiments/smart-label-prototype-v021/src/multi-engine.mjs";
import {
  ALGORITHM_VERSION,
  classifyFigure,
  checkPreservation,
  verifyOutputVariant,
} from "../../../experiments/smart-label-prototype-v021/src/recommend.mjs";
import { maskComments, extractTikzNodes } from "../../../experiments/smart-label-engine/src/tikz-nodes.mjs";
import { compareCollisionDiagnostics } from "./collision-diagnostics.mjs";
import {
  ALGORITHM_VERSION_V022,
  prepareSceneV022,
  runPlanningV022,
  compareCollisionDiagnosticsV022,
  checkPreservationV022,
  verifyOutputVariantV022,
} from "./v022/v022-adapter.mjs";

export const DEVELOPER_BETA_EMAIL = "mattko6281@gmail.com";
export const DEFAULT_ENGINE_VERSION = "v0.2.1";
export const SUPPORTED_ENGINE_VERSIONS = ["v0.2.1", "v0.2.2-beta"];
export const MAX_TIKZ_INPUT_LENGTH = 15000;
export const MAX_SAMPLES_VALUE = 500;
export const DEFAULT_KROKI_TIMEOUT_MS = 6000;

/**
 * 요청된 엔진 버전을 안전하게 정규화한다. 미지정 또는 알 수 없는 값이면 기본값 "v0.2.1"을 반환한다.
 * @param {any} engineVersion
 * @returns {"v0.2.1" | "v0.2.2-beta"}
 */
export function normalizeEngineVersion(engineVersion) {
  return engineVersion === "v0.2.2-beta" ? "v0.2.2-beta" : "v0.2.1";
}

/**
 * 다중 추상 함수 대응 선택 모드(multiAbstractAction)를 안전하게 정규화한다.
 * 미지정 또는 알 수 없는 값이면 기본값 "hold"(원본 유지)를 반환한다.
 * @param {any} action
 * @returns {"hold" | "recommend" | "swap"}
 */
export function normalizeMultiAbstractAction(action) {
  if (action === "recommend" || action === "swap") return action;
  return "hold";
}

// 위험 TeX 매크로 차단 정규식 (주석 제거 후 검사)
const DANGEROUS_TEX_MACRO_RE =
  /\\(?:input|include|write18|immediate|openin|openout|read|newread|newwrite|catcode|csname|endcsname|makeatletter|loop|repeat|pdfoutput|everyeof|everypar)\b/;

// 한국어(음절 및 자모) 포함 여부 정규식
const KOREAN_CHAR_RE = /[가-힣ㄱ-ㅎㅏ-ㅣ]/u;

// 서버 내 동시 실행 및 요청 빈도 제어 상태
const activeRequestsByUser = new Set();
const requestTimestampsByUser = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;

/**
 * 입력 TikZ 문자열의 SHA-256 해시(앞 16자리)를 계산한다.
 * @param {string} rawInput
 */
export function computeInputHash(rawInput) {
  return createHash("sha256").update(String(rawInput ?? ""), "utf8").digest("hex").slice(0, 16);
}

/**
 * 서버 측 베타 기능 활성화 여부를 동적으로 확인한다.
 * 기본값은 OFF(false)이다.
 * @param {{env?: Record<string, string|undefined>}} [opts]
 */
export function isSmartLabelBetaServerEnabled(opts = {}) {
  const env = opts.env || process.env;
  if (globalThis.__SMART_LABEL_BETA_KILL_SWITCH__ === true) {
    return { enabled: false, reason: "런타임 긴급 차단(Kill-Switch)이 활성화되어 있습니다." };
  }
  if (env.SMART_LABEL_KILL_SWITCH === "true" || env.SMART_LABEL_KILL_SWITCH === "1") {
    return { enabled: false, reason: "서버 긴급 차단 환경변수(SMART_LABEL_KILL_SWITCH)가 활성화되어 있습니다." };
  }
  try {
    if (existsSync(join(process.cwd(), ".smart-label-beta-disabled"))) {
      return { enabled: false, reason: "서버 긴급 차단 파일(.smart-label-beta-disabled)이 감지되었습니다." };
    }
  } catch {
    // 파일시스템 접근 불가 환경에서는 무시
  }
  const flag = String(env.ENABLE_SMART_LABEL_BETA || "").trim().toLowerCase();
  if (flag !== "true" && flag !== "1") {
    return { enabled: false, reason: "스마트 라벨 베타 기능이 비활성화(기본 OFF) 상태입니다." };
  }
  return { enabled: true, reason: "활성화됨" };
}

/**
 * 환경변수 문자열(SMART_LABEL_PILOT_EMAILS)에서 파일럿 허용 이메일 목록을 안전하게 파싱한다.
 * - 값이 없거나 빈 문자열이면 누구에게도 추가 개방되지 않도록 빈 배열([])을 반환한다.
 * - 쉼표(,), 세미콜론(;), 공백으로 구분된 이메일을 소문자로 정규화하고 유효한 이메일(@ 포함)만 남긴다.
 * @param {any} rawVal
 * @returns {string[]}
 */
export function parsePilotEmails(rawVal) {
  if (!rawVal || typeof rawVal !== "string") return [];
  const trimmed = rawVal.trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 5 && s.includes("@") && !s.startsWith("@") && !s.endsWith("@") && s !== DEVELOPER_BETA_EMAIL);
  return [...new Set(parts)];
}

/**
 * Unit 3-B (축 눈금 숫자 겹침 자동 조정) 단독 활성화/비활성화 서버 설정을 확인한다.
 * - 비활성화 시에도 기존 v0.2.2 함수식 라벨 정렬(Unit 1 + Unit 2/2+ + Unit 3-A)은 정상 유지된다.
 * @param {{env?: Record<string, string|undefined>}} [opts]
 */
export function isUnit3BServerEnabled(opts = {}) {
  const env = opts.env || process.env;
  if (globalThis.__SMART_LABEL_UNIT3B_KILL_SWITCH__ === true) {
    return {
      enabled: false,
      reason: "런타임 긴급 설정에 의해 Unit 3-B 눈금 겹침 자동 조정이 일시 비활성화되었습니다. (함수식 라벨 정렬은 정상 작동)",
    };
  }
  const disableFlag = String(env.SMART_LABEL_DISABLE_UNIT3B || "").trim().toLowerCase();
  if (disableFlag === "true" || disableFlag === "1") {
    return {
      enabled: false,
      reason: "서버 설정(SMART_LABEL_DISABLE_UNIT3B)에 의해 Unit 3-B 눈금 겹침 자동 조정이 비활성화되었습니다. (함수식 라벨 정렬은 정상 작동)",
    };
  }
  const enableFlag = String(env.ENABLE_SMART_LABEL_UNIT3B || "").trim().toLowerCase();
  if (enableFlag === "false" || enableFlag === "0") {
    return {
      enabled: false,
      reason: "서버 설정(ENABLE_SMART_LABEL_UNIT3B=false)에 의해 Unit 3-B 눈금 겹침 자동 조정이 비활성화되었습니다. (함수식 라벨 정렬은 정상 작동)",
    };
  }
  try {
    if (existsSync(join(process.cwd(), ".smart-label-unit3b-disabled"))) {
      return {
        enabled: false,
        reason: "서버 비활성 파일(.smart-label-unit3b-disabled)이 감지되어 Unit 3-B 눈금 겹침 자동 조정이 비활성화되었습니다.",
      };
    }
  } catch {
    // 파일시스템 접근 불가 환경에서는 무시
  }
  return { enabled: true, reason: "Unit 3-B 활성화 가능" };
}

/**
 * Unit 3-D-Origin(표준 원점 O 4방향 자동 배치) 기능의 서버 측 활성화 여부를 확인한다.
 * - 환경변수 SMART_LABEL_DISABLE_UNIT3D 가 정확히 "true" 이면 Unit 3-D 만 비활성화(기존 함수식·축·눈금 정렬은 정상 유지)
 * - "false" 또는 미설정이면 Unit 3-D 정상 작동(기본값 ON)
 * @param {{env?: Record<string, string|undefined>}} [opts]
 */
export function isUnit3DServerEnabled(opts = {}) {
  const env = opts.env || process.env;
  const rawDisable =
    typeof env?.SMART_LABEL_DISABLE_UNIT3D === "string"
      ? env.SMART_LABEL_DISABLE_UNIT3D.trim()
      : "";
  if (rawDisable === "true") {
    return {
      enabled: false,
      reason:
        "서버 설정(SMART_LABEL_DISABLE_UNIT3D=true)에 의해 Unit 3-D 원점 O 자동 배치가 비활성화되었습니다. (함수식 및 눈금 라벨 정렬은 정상 작동)",
    };
  }
  return { enabled: true, reason: "Unit 3-D 활성화 가능" };
}

/**
 * NextAuth 서버 세션 객체를 검증하여 개발자(developer) 또는 지정된 파일럿 팀원(pilot) 권한을 판정한다.
 * - 개발자(mattko6281@gmail.com): role="developer", 엔진 선택 가능(기본 v0.2.1), Unit 3-B 기본 ON
 * - 파일럿 팀원(SMART_LABEL_PILOT_EMAILS 에 명시된 계정): role="pilot", 엔진 v0.2.2-beta 고정, Unit 3-B 기본 OFF, 축 조정 기본 OFF
 * - 미지정 팀원 또는 SMART_LABEL_PILOT_EMAILS 미설정 시: 403 FORBIDDEN 차단
 * @param {any} session NextAuth auth() 반환 세션
 * @param {{env?: Record<string, string|undefined>}} [opts]
 */
export function verifyDeveloperSession(session, opts = {}) {
  const env = opts.env || process.env;
  const rawEmail = session?.user?.email;
  if (!rawEmail || typeof rawEmail !== "string" || !rawEmail.trim()) {
    return {
      allowed: false,
      httpStatus: 401,
      code: "UNAUTHORIZED",
      role: "none",
      error: "인증되지 않은 요청입니다. Google 로그인이 필요합니다.",
    };
  }
  const normalized = rawEmail.trim().toLowerCase();
  if (normalized === DEVELOPER_BETA_EMAIL) {
    return {
      allowed: true,
      httpStatus: 200,
      code: "OK",
      email: normalized,
      role: "developer",
      canSelectEngine: true,
      defaultEngineVersion: DEFAULT_ENGINE_VERSION,
      defaultEnableUnit3B: true,
      defaultApplyAxis: false,
    };
  }
  const pilotEmails = parsePilotEmails(env?.SMART_LABEL_PILOT_EMAILS);
  if (pilotEmails.includes(normalized)) {
    return {
      allowed: true,
      httpStatus: 200,
      code: "OK",
      email: normalized,
      role: "pilot",
      canSelectEngine: false,
      defaultEngineVersion: "v0.2.2-beta",
      defaultEnableUnit3B: false,
      defaultApplyAxis: false,
    };
  }
  return {
    allowed: false,
    httpStatus: 403,
    code: "FORBIDDEN",
    role: "none",
    error: "접근 권한이 없습니다. 스마트 라벨 베타는 개발자 및 지정된 파일럿 팀원 전용 기능입니다.",
  };
}

export const verifySmartLabelAccess = verifyDeveloperSession;

/**
 * KO-SMART 운영 앱의 getProcessedInput 과 동일한 래핑 및 Circle 정비율 보정을 수행한다.
 * @param {string} code
 */
export function processInputLikeKoSmart(code) {
  let finalCode = String(code || "");
  if (!finalCode.trim()) return "";

  const bs = String.fromCharCode(92);

  if (!finalCode.includes("documentclass")) {
    finalCode = [
      bs + "documentclass[tikz, border=2pt]{standalone}",
      bs + "usepackage{kotex, amsmath}",
      bs + "usetikzlibrary{arrows.meta, calc, intersections, patterns, decorations.pathmorphing}",
      bs + "begin{document}",
      finalCode,
      bs + "end{document}",
    ].join("\n");
  } else if (!finalCode.includes("kotex")) {
    finalCode = finalCode.replace(
      /(\\documentclass(?:\[.*?\])?\{.*?\})/,
      `$1\n${bs}usepackage{kotex, amsmath}`
    );
  }

  if (/circle\s*\(/.test(finalCode)) {
    finalCode = finalCode.replace(
      /(\\begin\{tikzpicture\}\s*\[)([^\]]*(?:\[[^\]]*\][^\]]*)*)(\])/,
      (full, prefix, opts, suffix) => {
        const xMatch = opts.match(/(?<![a-zA-Z])x\s*=\s*([0-9.]+)\s*([a-zA-Z]+)?/);
        const yMatch = opts.match(/(?<![a-zA-Z])y\s*=\s*([0-9.]+)\s*([a-zA-Z]+)?/);
        if (xMatch && yMatch) {
          const xVal = parseFloat(xMatch[1]);
          const yVal = parseFloat(yMatch[1]);
          const xUnit = xMatch[2] || "cm";
          const yUnit = yMatch[2] || "cm";
          const maxVal = Math.max(xVal, yVal);
          const newOpts = opts
            .replace(/(?<![a-zA-Z])x\s*=\s*[0-9.]+\s*[a-zA-Z]*/, `x=${maxVal}${xUnit}`)
            .replace(/(?<![a-zA-Z])y\s*=\s*[0-9.]+\s*[a-zA-Z]*/, `y=${maxVal}${yUnit}`);
          return prefix + newOpts + suffix;
        }
        return full;
      }
    );
  }

  return finalCode;
}

/**
 * KO-SMART의 encodeKroki 와 동일한 deflate(level 9) + Base64URL 인코딩
 * @param {string} text
 */
export function encodeKroki(text) {
  const compressed = deflateSync(Buffer.from(text, "utf8"), { level: 9 });
  return compressed.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 전체 입력에서 단일 \begin{tikzpicture} ... \end{tikzpicture} 블록을 추출한다.
 * @param {string} rawInput
 */
export function extractTikzpictureBlock(rawInput) {
  const src = String(rawInput ?? "");
  const beginRe = /\\begin\{tikzpicture\}/g;
  const endRe = /\\end\{tikzpicture\}/g;
  const begins = [...src.matchAll(beginRe)];
  const ends = [...src.matchAll(endRe)];

  if (begins.length === 0 || ends.length === 0) {
    return {
      ok: false,
      reasonCode: "missing-tikzpicture",
      message: "\\begin{tikzpicture} ... \\end{tikzpicture} 블록을 찾을 수 없습니다.",
    };
  }
  if (begins.length > 1 || ends.length > 1) {
    return {
      ok: false,
      reasonCode: "multiple-tikzpicture",
      message: "현재 베타에서는 단일 tikzpicture 블록만 지원합니다.",
    };
  }

  const start = begins[0].index;
  const end = ends[0].index + ends[0][0].length;
  if (end <= start) {
    return {
      ok: false,
      reasonCode: "invalid-tikzpicture-range",
      message: "tikzpicture 블록의 시작과 끝 위치가 올바르지 않습니다.",
    };
  }

  const rawBody = src.slice(start, end);
  const processedDoc = processInputLikeKoSmart(rawBody);
  const pbStart = processedDoc.indexOf("\\begin{tikzpicture}");
  const pbEnd = processedDoc.lastIndexOf("\\end{tikzpicture}") + "\\end{tikzpicture}".length;
  const effectiveBody = pbStart >= 0 && pbEnd > pbStart ? processedDoc.slice(pbStart, pbEnd) : rawBody;

  return {
    ok: true,
    prefix: src.slice(0, start),
    rawBody,
    effectiveBody,
    suffix: src.slice(end),
    circleAdjusted: effectiveBody !== rawBody,
  };
}

/**
 * local-render.mjs 가 캐시 조회에 사용하는 동일한 해시 경로(<workRoot>/<hash>/t.svg)에
 * 비동기로 가져온 Kroki SVG를 스테이징한다.
 * @param {string} workRoot
 * @param {string} body
 * @param {string} svgText
 */
function stageSvgForV021(workRoot, body, svgText) {
  const doc = HEADER + body + FOOTER;
  const hash = createHash("sha1").update(doc).digest("hex").slice(0, 16);
  const dir = join(workRoot, hash);
  mkdirSync(dir, { recursive: true });
  const svgPath = join(dir, "t.svg");
  writeFileSync(svgPath, svgText, "utf8");
  return { hash, svgPath, exists: existsSync(svgPath) };
}

/**
 * 자체 Kroki 서버(또는 테스트 주입된 customFetcher)를 호출해 TikZ body를 SVG로 비동기 렌더링한다.
 * @param {string} body tikzpicture 블록
 * @param {{krokiBaseUrl?: string, timeoutMs?: number, fetchImpl?: typeof fetch}} [opts]
 */
export async function renderTikzViaKroki(body, opts = {}) {
  const krokiBase = (
    opts.krokiBaseUrl ||
    process.env.SMART_LABEL_KROKI_URL ||
    process.env.NEXT_PUBLIC_KROKI_URL ||
    "http://43.201.227.158:8000"
  ).replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_KROKI_TIMEOUT_MS;
  const fetchFn = opts.fetchImpl || globalThis.fetch;

  const fullDoc = processInputLikeKoSmart(body);
  const encoded = encodeKroki(fullDoc);
  const targetUrl = `${krokiBase}/tikz/svg/${encoded}`;

  const t0 = Date.now();
  let response;
  try {
    response = await fetchFn(targetUrl, {
      method: "GET",
      headers: { Accept: "image/svg+xml" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const elapsedMs = Date.now() - t0;
    const isTimeout = err && (err.name === "TimeoutError" || err.name === "AbortError" || /timeout|aborted/i.test(String(err)));
    return {
      ok: false,
      elapsedMs,
      isTimeout,
      error: isTimeout
        ? `Kroki 렌더링 시간 초과 (${timeoutMs}ms)`
        : `Kroki 서버 연결 실패: ${String(err).slice(0, 140)}`,
    };
  }

  const elapsedMs = Date.now() - t0;
  let svgText = "";
  try {
    svgText = await response.text();
  } catch (err) {
    return {
      ok: false,
      elapsedMs,
      isTimeout: false,
      error: `Kroki 응답 본문 읽기 실패: ${String(err).slice(0, 140)}`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      elapsedMs,
      isTimeout: false,
      error: `Kroki 렌더링 오류 (HTTP ${response.status})`,
    };
  }

  if (!svgText || !svgText.includes("<svg")) {
    return {
      ok: false,
      status: response.status,
      elapsedMs,
      isTimeout: false,
      error: "Kroki 응답이 유효한 SVG 문서가 아닙니다.",
    };
  }

  return {
    ok: true,
    svg: svgText,
    elapsedMs,
    encodedUrlPath: `/api/kroki/tikz/svg/${encoded}`,
  };
}

/**
 * 입력 TikZ에 대한 보안·지원 범위 사전 검증 (한국어 노드 제외, 위험 매크로 차단, 길이·샘플 제한)
 * @param {string} rawInput
 */
export function validateBetaTikzInput(rawInput) {
  if (typeof rawInput !== "string" || !rawInput.trim()) {
    return {
      ok: false,
      httpStatus: 400,
      status: "failed",
      reasonCode: "empty-input",
      message: "TikZ 코드가 비어 있습니다.",
    };
  }

  if (rawInput.length > MAX_TIKZ_INPUT_LENGTH) {
    return {
      ok: false,
      httpStatus: 400,
      status: "failed",
      reasonCode: "input-too-large",
      message: `TikZ 코드가 허용 길이(${MAX_TIKZ_INPUT_LENGTH.toLocaleString()}자)를 초과했습니다.`,
    };
  }

  const masked = maskComments(rawInput);

  if (DANGEROUS_TEX_MACRO_RE.test(masked)) {
    return {
      ok: false,
      httpStatus: 400,
      status: "failed",
      reasonCode: "dangerous-tex-macro",
      message: "보안 정책상 허용되지 않는 TeX 명령어가 포함되어 있습니다.",
    };
  }

  // 과도한 samples 값 검사
  for (const m of masked.matchAll(/samples\s*=\s*(\d+)/g)) {
    if (Number(m[1]) > MAX_SAMPLES_VALUE) {
      return {
        ok: false,
        httpStatus: 400,
        status: "failed",
        reasonCode: "excessive-samples",
        message: `plot samples 값(${m[1]})이 허용 상한(${MAX_SAMPLES_VALUE})을 초과했습니다.`,
      };
    }
  }

  // 초기 베타 정책: 한국어 포함 도형은 자동 정렬을 실행하지 않고 전체 원본 유지
  if (KOREAN_CHAR_RE.test(masked)) {
    return {
      ok: false,
      httpStatus: 200,
      status: "unsupported",
      reasonCode: "korean-unsupported",
      message: "현재 베타에서는 한국어 노드가 포함된 도형을 지원하지 않습니다.",
    };
  }

  return { ok: true };
}

/**
 * 사용자별 동시 실행(Concurrency=1) 및 분당 요청 횟수 제한 게이트
 * @param {string} userKey
 */
export function acquireUserExecutionSlot(userKey = DEVELOPER_BETA_EMAIL) {
  if (activeRequestsByUser.has(userKey)) {
    return {
      acquired: false,
      httpStatus: 429,
      reasonCode: "concurrent-request-blocked",
      message: "이미 스마트 라벨 추천 계산이 진행 중입니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  const now = Date.now();
  const prev = (requestTimestampsByUser.get(userKey) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (prev.length >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      acquired: false,
      httpStatus: 429,
      reasonCode: "rate-limit-exceeded",
      message: "단시간 내 요청 횟수가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  prev.push(now);
  requestTimestampsByUser.set(userKey, prev);
  activeRequestsByUser.add(userKey);

  return {
    acquired: true,
    release() {
      activeRequestsByUser.delete(userKey);
    },
  };
}

/**
 * Option B 기반 스마트 라벨 베타 추천 파이프라인 실행기 (비동기)
 * - engineVersion:
 *    * "v0.2.1" (기본 선택): 기존 v0.2.1 의 buildScene, classifyFigure, planLabelsMultiEngine, shiftEdits,
 *      planAxes, axisEdits, applyEdits, checkPreservation, verifyOutputVariant 를 수정 없이 그대로 사용한다.
 *    * "v0.2.2-beta" (개선 베타): 동결 검증된 interim-v1(Unit 1 + Unit 2/2+ + Unit 3-A + Unit 3-B + Unit 3-C + Unit 3-D)을 실행한다.
 * - 축 길이 조정 옵션(applyAxis)은 기본 OFF(false)이며, ON일 때도 길이 연장만 수행하고
 *   2차 Kroki 렌더링 및 x, y, O·일반 노드·곡선 충돌 검증을 통과해야만 적용이 허용된다.
 * - 원본부터 존재하던 미해결 겹침과 새로 발생한 겹침을 분리하여 collisionDiagnostics에 기록한다.
 *
 * @param {string} rawInput 에디터 전체 TikZ 문자열
 * @param {{
 *   krokiBaseUrl?: string,
 *   timeoutMs?: number,
 *   fetchImpl?: typeof fetch,
 *   params?: typeof PARAMS,
 *   verify?: boolean,
 *   applyAxis?: boolean,
 *   engineVersion?: "v0.2.1" | "v0.2.2-beta"
 * }} [opts]
 */
export async function recommendSmartLabelBeta(rawInput, opts = {}) {
  const inputHash = computeInputHash(rawInput);
  const applyAxisRequested = Boolean(opts.applyAxis === true);
  const engineVersion = normalizeEngineVersion(opts.engineVersion);
  const isV022 = engineVersion === "v0.2.2-beta";
  const applyDomainExtensionRequested = isV022 && Boolean(opts.applyDomainExtension === true);
  const multiAbstractActionRequested = isV022
    ? normalizeMultiAbstractAction(opts.multiAbstractAction)
    : "hold";
  const unit3BServerStatus = isUnit3BServerEnabled({ env: opts.env });
  const enableUnit3BRequested = isV022 && Boolean(opts.enableUnit3B === true);
  const enableUnit3B = enableUnit3BRequested && unit3BServerStatus.enabled;
  const unit3DServerStatus = isUnit3DServerEnabled({ env: opts.env });
  const enableUnit3DRequested = isV022 && opts.enableUnit3D !== false;
  const enableUnit3D = enableUnit3DRequested && unit3DServerStatus.enabled;
  const enablePointLabelOverlapFixRequested =
    isV022 && Boolean(opts.enablePointLabelOverlapFix === true || opts.enableUnit3E === true);
  const enableUnit3E = enablePointLabelOverlapFixRequested;

  const baseResponse = {
    engineVersion,
    algorithmVersion: isV022 ? ALGORITHM_VERSION_V022 : ALGORITHM_VERSION,
    enableUnit3BRequested,
    unit3BEnabled: enableUnit3B,
    unit3BServerEnabled: unit3BServerStatus.enabled,
    unit3BDisabledReason: unit3BServerStatus.enabled ? null : unit3BServerStatus.reason,
    enableUnit3DRequested,
    unit3DEnabled: enableUnit3D,
    unit3DServerEnabled: unit3DServerStatus.enabled,
    unit3DDisabledReason: unit3DServerStatus.enabled ? null : unit3DServerStatus.reason,
    enablePointLabelOverlapFixRequested,
    unit3EEnabled: enableUnit3E,
    ok: false,
    status: "failed",
    reasonCode: null,
    message: "",
    canApply: false,
    verified: false,
    applyAxisRequested,
    axisOption: {
      requested: applyAxisRequested,
      applied: false,
      status: applyAxisRequested ? "not-needed" : "disabled",
      modeNote: "길이 연장 전용 (축 축소 없음)",
      x: null,
      y: null,
      editsCount: 0,
      message: applyAxisRequested
        ? "축 길이 조정 대기 중"
        : "축 길이 자동 조정 옵션 OFF (함수식 라벨만 정렬)",
    },
    applyDomainExtensionRequested,
    domainExtensionOption: {
      requested: applyDomainExtensionRequested,
      applied: false,
      status: applyDomainExtensionRequested ? "not-needed" : "disabled",
      modeNote: "8단계 안전 필터 통과 시 최소 끝점 연장 전용 (축소 없음)",
      editsCount: 0,
      message: applyDomainExtensionRequested
        ? "그래프 끝점 미세 연장 대기 중"
        : "그래프 끝점 미세 연장 옵션 OFF (원본 정의역 유지)",
      items: [],
    },
    pointLabelOption: {
      enabled: enablePointLabelOverlapFixRequested,
      requested: enablePointLabelOverlapFixRequested,
      applied: false,
      status: enablePointLabelOverlapFixRequested ? "not-needed" : "disabled",
      modeNote: "점 마커 연결 대문자 점 이름(A, B, C, P, Q 등) 전용 (마커 불변 · 보수적 자연 배치)",
      movedCount: 0,
      heldCount: 0,
      editsCount: 0,
      message: enablePointLabelOverlapFixRequested
        ? "점 이름 겹침 자동 정렬 대기 중"
        : "점 이름 겹침 자동 정렬 옵션 OFF (원본 점 이름 위치 유지)",
      items: [],
    },
    multiAbstractActionRequested,
    multiAbstractOption: {
      detected: false,
      supportedPair: false,
      classificationType: null,
      classificationCode: null,
      mathematicallyProven: false,
      requiresUserApproval: false,
      requestedAction: multiAbstractActionRequested,
      selectedAction: "hold",
      defaultAction: "hold",
      canRecommend: false,
      canSwap: false,
      rawDistMarginPt: null,
      moderateMarginCaution: false,
      scaleNormalizedThresholds: null,
      signals: [],
      holdReason: null,
      summaryReason: "다중 추상 함수(유형 2/3) 대상이 아닙니다.",
      correspondenceRows: [],
      variants: null,
    },
    collisionDiagnostics: null,
    inputHash,
    originalCode: String(rawInput ?? ""),
    recommendedCode: String(rawInput ?? ""),
    figureType: null,
    movedCount: 0,
    fnMovedCount: 0,
    tickMovedCount: 0,
    tickHeldCount: 0,
    originMovedCount: 0,
    originHeldCount: 0,
    pointLabelMovedCount: 0,
    pointLabelHeldCount: 0,
    heldCount: 0,
    labelDecisions: [],
    tickDecisions: [],
    originDecisions: [],
    pointLabelDecisions: [],
    placements: [],
    shiftReport: [],
    preservation: null,
    verification: null,
    preview: {
      originalSvgDataUri: null,
      recommendedSvgDataUri: null,
    },
    warnings: [],
    errors: [],
  };

  // 안전 조건: verify=false 로 검증 생략을 요청하는 경우에도 적용 가능(canApply) 결과를 절대 허용하지 않음
  if (opts.verify === false) {
    return {
      ...baseResponse,
      status: "failed",
      reasonCode: "unverified-path-blocked",
      message: "안전성 검증(verify=true)을 생략한 추천 경로는 허용되지 않습니다.",
      errors: ["검증 생략 경로(verify=false) 차단됨"],
    };
  }

  // 1) 입력 사전 검사 (빈 입력, 길이 초과, 위험 매크로, 한국어 포함 여부)
  const precheck = validateBetaTikzInput(rawInput);
  if (!precheck.ok) {
    return {
      ...baseResponse,
      ok: precheck.status === "unsupported",
      status: precheck.status,
      reasonCode: precheck.reasonCode,
      message: precheck.message,
      errors: precheck.status === "failed" ? [precheck.message] : [],
    };
  }

  // 2) 단일 tikzpicture 블록 추출
  const extracted = extractTikzpictureBlock(rawInput);
  if (!extracted.ok) {
    return {
      ...baseResponse,
      ok: true,
      status: "unsupported",
      reasonCode: extracted.reasonCode,
      message: extracted.message,
    };
  }

  const { prefix, rawBody, effectiveBody, suffix, circleAdjusted } = extracted;
  const P = opts.params ? { ...PARAMS, ...opts.params } : PARAMS;
  const MP = opts.multiEngineParams || undefined;
  const tempWorkRoot = mkdtempSync(join(tmpdir(), `kosmart-sl-beta-${randomUUID().slice(0, 8)}-`));

  try {
    // 3) 1차 Kroki 비동기 렌더링 (원본 도형 측정용)
    const render1 = await renderTikzViaKroki(effectiveBody, opts);
    if (!render1.ok || !render1.svg) {
      return {
        ...baseResponse,
        status: "failed",
        reasonCode: render1.isTimeout ? "kroki-timeout" : "kroki-render-failed",
        message: render1.error || "원본 TikZ 렌더링에 실패했습니다. 원본 코드를 유지합니다.",
        errors: [render1.error || "1차 Kroki 렌더링 실패"],
      };
    }

    const staged1 = stageSvgForV021(tempWorkRoot, effectiveBody, render1.svg);
    if (!staged1.exists) {
      return {
        ...baseResponse,
        status: "failed",
        reasonCode: "staging-failed",
        message: "SVG 측정 준비에 실패했습니다. 원본 코드를 유지합니다.",
        errors: ["임시 SVG 스테이징 실패"],
      };
    }

    const origSvgDataUri = "data:image/svg+xml;base64," + Buffer.from(render1.svg, "utf8").toString("base64");
    baseResponse.preview.originalSvgDataUri = origSvgDataUri;
    baseResponse.preview.recommendedSvgDataUri = origSvgDataUri;

    // 4) 기존 v0.2.1 buildScene 호출 (tempWorkRoot 에 스테이징된 SVG를 즉시 읽어 로컬 latex 실행 없음)
    const scene = buildScene(effectiveBody, { workRoot: tempWorkRoot });
    if (!scene.ok) {
      return {
        ...baseResponse,
        status: "failed",
        reasonCode: "scene-measurement-failed",
        message: "SVG 기하 측정에 실패하여 원본 코드를 유지합니다.",
        errors: scene.errors,
      };
    }
    baseResponse.warnings.push(...scene.warnings);

    // v0.2.2-beta 선택 시 Unit 1 안정성 가드(n.at===null 예외 방지 및 불확실성 잠금) + Unit 2 확장 적용
    if (isV022) {
      prepareSceneV022(scene);
    }

    // 원본 장면의 정밀 겹침·측정 누락 감사
    let origDiag = isV022
      ? compareCollisionDiagnosticsV022(scene, scene, [], { axisChanged: false, params: P })
      : compareCollisionDiagnostics(scene, scene, [], { axisChanged: false, params: P });
    baseResponse.collisionDiagnostics = origDiag;

    // 5) 그림 유형 확인: 반드시 x축과 y축이 모두 식별된 coordinateFunction(plot 함수 그래프 또는 v0.2.2 축 평행 직선/원점 그래프)만 지원
    let fig = classifyFigure(scene);
    if (
      isV022 &&
      fig.hasAxes &&
      fig.type !== "coordinateFunction" &&
      (scene.nodes || []).some(
        (n) =>
          n.role === "function" ||
          (enableUnit3D && n.role === "origin") ||
          (enableUnit3E && n.role === "other")
      ) &&
      (scene.strokes || []).some((s) => s.kind !== "axis")
    ) {
      fig = {
        type: "coordinateFunction",
        hasAxes: true,
        reason: "x/y 축 식별 + 직선 방정식 라벨/원점 그래프",
      };
    }
    baseResponse.figureType = fig;
    if (fig.type !== "coordinateFunction" || !fig.hasAxes) {
      return {
        ...baseResponse,
        ok: true,
        status: "unsupported",
        reasonCode: "unsupported-figure-type",
        message:
          !fig.hasAxes && fig.type === "coordinateFunction"
            ? "현재 베타에서는 x축과 y축이 모두 있는 함수 그래프만 지원합니다. (좌표축 미식별 — 원본 유지)"
            : `현재 베타에서는 x축과 y축이 모두 있는 함수 그래프만 지원합니다. (${fig.reason})`,
      };
    }

    if (circleAdjusted) {
      const rawNodes = extractTikzNodes(rawBody).nodes;
      const effNodes = extractTikzNodes(effectiveBody).nodes;
      if (rawNodes.length !== effNodes.length) {
        return {
          ...baseResponse,
          ok: true,
          status: "unsupported",
          reasonCode: "circle-scale-mismatch",
          message: "원(circle) 비율 보정이 포함된 비대칭 스케일 도형으로 원본을 유지합니다.",
        };
      }
    }

    // 6~9) 주어진 multiAbstractAction ("hold" | "recommend" | "swap")에 대해
    //      플래닝 → 1차 보존 검사 → 2차 Kroki 렌더링 및 충돌 검증 → 결과 객체 생성을 수행하는 내부 헬퍼
    const evaluateActionVariant = async (actionMode = "hold") => {
      const unit2FlagsForAction = {
        enableOriginPlacement: enableUnit3D,
        multiAbstractAction: actionMode,
      };

      let activePlan;
      let axisPlan;
      let axisEditsToApply = [];
      let domainPlan = { requested: false, applied: false, edits: [], decisions: [] };
      let domainEditsToApply = [];
      let activeShift;
      let tickPlan = { edits: [], movedTicks: [], heldTicks: [], decisions: [] };
      let originPlan = { edits: [], movedOrigins: [], heldOrigins: [], decisions: [] };
      let pointLabelPlan = {
        requested: false,
        applied: false,
        edits: [],
        movedPointLabels: [],
        heldPointLabels: [],
        decisions: [],
        roleClassification: null,
      };
      let decisionsByNodeId = new Map();
      let variantOrigDiag = origDiag;
      let multiAbstractAnalysis = null;

      if (isV022) {
        const v022Plan = runPlanningV022(
          scene,
          P,
          applyAxisRequested,
          unit2FlagsForAction,
          enableUnit3B,
          enableUnit3D,
          applyDomainExtensionRequested,
          enableUnit3E
        );
        activePlan = v022Plan.activePlan;
        axisPlan = v022Plan.axisPlan;
        axisEditsToApply = v022Plan.axisEditsToApply;
        domainPlan = v022Plan.domainPlan || domainPlan;
        domainEditsToApply = v022Plan.domainEditsToApply || [];
        activeShift = v022Plan.activeShift;
        tickPlan = v022Plan.tickPlan || tickPlan;
        originPlan = v022Plan.originPlan || originPlan;
        pointLabelPlan = v022Plan.pointLabelPlan || pointLabelPlan;
        decisionsByNodeId = v022Plan.decisionsByNodeId;
        multiAbstractAnalysis =
          v022Plan.multiAbstractAnalysis || scene.multiAbstractAnalysis || null;
        variantOrigDiag = compareCollisionDiagnosticsV022(scene, scene, [], {
          axisChanged: false,
          params: P,
          decisionsByNodeId,
          unit2Flags: unit2FlagsForAction,
        });
      } else {
        const plan0 = planLabelsMultiEngine(scene, P, null, "auto", MP);
        activePlan = plan0;
        axisPlan = planAxes(scene, plan0, P);

        if (applyAxisRequested) {
          let iters = 1;
          const sig = (p) =>
            JSON.stringify((p.placements || []).map((q) => [q.id, q.action, q.selectedEngine, q.shift]));
          while (iters < 3 && axisPlan.x && axisPlan.y) {
            const { xU, yU } = scene.units;
            const override = {
              left: Math.min(...axisPlan.x.new) * xU,
              right: Math.max(...axisPlan.x.new) * xU,
              bottom: Math.min(...axisPlan.y.new) * yU,
              top: Math.max(...axisPlan.y.new) * yU,
            };
            const next = planLabelsMultiEngine(scene, P, override, "auto", MP);
            iters++;
            const same = sig(next) === sig(activePlan);
            activePlan = next;
            axisPlan = planAxes(scene, activePlan, P);
            if (same) break;
          }
          axisEditsToApply = axisEdits(scene, axisPlan);
        }

        activeShift = shiftEdits(scene, activePlan, P);
      }

      const labelEditsOnEffective = activeShift.edits;
      const tickEditsOnEffective = tickPlan.edits || [];
      const originEditsOnEffective = originPlan.edits || [];
      const pointLabelEditsOnEffective = pointLabelPlan.edits || [];
      const editsToApply = [
        ...domainEditsToApply,
        ...labelEditsOnEffective,
        ...tickEditsOnEffective,
        ...originEditsOnEffective,
        ...pointLabelEditsOnEffective,
        ...axisEditsToApply,
      ];

      const xAxisChanged = axisEditsToApply.some((e) => e.kind === "axis-x");
      const yAxisChanged = axisEditsToApply.some((e) => e.kind === "axis-y");
      const anyAxisChanged = axisEditsToApply.length > 0;
      const anyDomainChanged = domainEditsToApply.length > 0;
      const anyPointLabelChanged = pointLabelEditsOnEffective.length > 0;
      const hasAxisRequiredHold = (domainPlan.decisions || []).some(
        (d) => d.action === "hold" && d.holdCode === "axis-extension-required"
      );

      const domainOptionInfo = {
        requested: applyDomainExtensionRequested,
        applied: false,
        status: !applyDomainExtensionRequested
          ? "disabled"
          : anyDomainChanged
          ? "pending-verification"
          : hasAxisRequiredHold
          ? "held-axis-off"
          : "not-needed",
        modeNote: "8단계 안전 필터 통과 시 최소 끝점 연장 전용 (축소 없음)",
        editsCount: domainEditsToApply.length,
        items: domainPlan.decisions || [],
        message: !applyDomainExtensionRequested
          ? "그래프 끝점 미세 연장 옵션 OFF (원본 정의역 유지)"
          : anyDomainChanged
          ? `그래프 끝점 미세 연장 후보 산출됨 (${(domainPlan.decisions || [])
              .filter((d) => d.action === "extend")
              .map(
                (d) =>
                  `${d.label}: domain [${d.origDomain.join(", ")}] → [${d.newDomain.join(", ")}] (+${d.arcLengthPt}pt, 간격 ${d.origOwnGapPt}pt → ${d.newOwnGapPt}pt)`
              )
              .join(" · ")})`
          : hasAxisRequiredHold
          ? "원본 x축 범위와 축라벨 안전 여백을 보호하기 위해 그래프 끝점 연장을 보류했습니다. 축 길이 자동 조정을 함께 켜면 연장이 가능합니다."
          : "모든 함수 그래프가 이미 적정 연결 간격이거나 8단계 안전 게이트에 의해 원본 정의역을 유지합니다.",
      };

      const axisOptionInfo = {
        requested: applyAxisRequested,
        applied: false,
        status: !applyAxisRequested
          ? "disabled"
          : anyAxisChanged
          ? "pending-verification"
          : "not-needed",
        modeNote: "길이 연장 전용 (축 축소 없음)",
        x: axisPlan.x
          ? {
              old: axisPlan.x.old,
              new: applyAxisRequested ? axisPlan.x.new : axisPlan.x.old,
              changed: applyAxisRequested && xAxisChanged,
            }
          : null,
        y: axisPlan.y
          ? {
              old: axisPlan.y.old,
              new: applyAxisRequested ? axisPlan.y.new : axisPlan.y.old,
              changed: applyAxisRequested && yAxisChanged,
            }
          : null,
        editsCount: axisEditsToApply.length,
        message: !applyAxisRequested
          ? "축 길이 자동 조정 옵션 OFF (함수식 라벨만 정렬)"
          : anyAxisChanged
          ? `축 길이 연장 후보 산출됨 (${[
              xAxisChanged ? `x축 [${axisPlan.x.old.join(", ")}] → [${axisPlan.x.new.join(", ")}]` : null,
              yAxisChanged ? `y축 [${axisPlan.y.old.join(", ")}] → [${axisPlan.y.new.join(", ")}]` : null,
            ]
              .filter(Boolean)
              .join(", ")})`
          : "현재 x축·y축 길이가 이미 충분하여 축 길이 조정이 불필요합니다 (길이 연장 전용, 축소 없음).",
      };

      const pointLabelOptionInfo = {
        enabled: enablePointLabelOverlapFixRequested,
        requested: enablePointLabelOverlapFixRequested,
        applied: false,
        status: !enablePointLabelOverlapFixRequested
          ? "disabled"
          : anyPointLabelChanged
          ? "pending-verification"
          : "not-needed",
        modeNote: "점 마커 연결 대문자 점 이름(A, B, C, P, Q 등) 전용 (마커 불변 · 보수적 자연 배치)",
        movedCount: (pointLabelPlan.movedPointLabels || []).length,
        heldCount: (pointLabelPlan.heldPointLabels || []).length,
        editsCount: pointLabelEditsOnEffective.length,
        items: pointLabelPlan.decisions || [],
        message: !enablePointLabelOverlapFixRequested
          ? "점 이름 겹침 자동 정렬 옵션 OFF (원본 점 이름 위치 유지)"
          : anyPointLabelChanged
          ? `점 이름(유형 A) 겹침 자동 정렬 후보 산출됨 (${(pointLabelPlan.movedPointLabels || [])
              .map(
                (p) =>
                  `${p.cleanLabel || p.label}: shift [${p.origShift.join(", ")}] → [${p.newShift.join(", ")}]pt (${p.nearestDir}, 곡선 여유 ${p.finalClearancePt}pt, 마커 간격 ${p.markerGapPt}pt)`
              )
              .join(" · ")})`
          : (pointLabelPlan.heldPointLabels || []).length > 0
          ? `감지된 대문자 점 이름(유형 A) ${pointLabelPlan.heldPointLabels.length}개가 이미 무충돌 자연 배치 상태이므로 원본 위치를 유지합니다.`
          : "이동 대상인 점 마커 연결 대문자 점 이름(유형 A)이 없거나 모두 원본 위치를 유지합니다.",
      };

      const variantBase = {
        ...baseResponse,
        axisOption: axisOptionInfo,
        domainExtensionOption: domainOptionInfo,
        pointLabelOption: pointLabelOptionInfo,
        collisionDiagnostics: variantOrigDiag,
      };

      const candEffectiveBody = applyEdits(effectiveBody, editsToApply);

      const origFnAuditById = new Map(
        (variantOrigDiag.origAudit?.functionLabelAudits || []).map((fa) => [fa.id, fa])
      );

      const buildEnrichedDecisions = (rawDecisions, finalFnAuditById) =>
        (rawDecisions || []).map((d) => {
          const origFa = origFnAuditById.get(d.id);
          const finalFa = finalFnAuditById ? finalFnAuditById.get(d.id) : origFa;
          const hasPreExistingCollision = Boolean(origFa?.hasCollision);
          const hasRemainingCollision = Boolean(finalFa?.hasCollision);
          const collisionDescriptions = (finalFa?.collisions || origFa?.collisions || []).map(
            (c) => c.description
          );
          const autoMod = !!d.autoModified;
          let holdReason = d.holdReason || null;
          let selectionReason = d.selectionReason || "";
          if (!autoMod && hasRemainingCollision) {
            const warnSuffix =
              d.nonMoveCode === "uncertain-match" ||
              d.nonMoveCode === "multi-abstract-user-confirm-required" ||
              d.nonMoveCode === "multi-abstract-hold-only" ||
              d.nonMoveCode === "parse-failure" ||
              d.nonMoveCode === "fallback-anchor-unusable"
                ? ` [⚠️ 미해결 기존 충돌: ${collisionDescriptions.join("; ")} — ${d.nonMoveCategory || "매칭/좌표 불확실"}로 인해 자동 이동을 보류하므로 수동/조이스틱 조정 권장]`
                : ` [⚠️ 미해결 기존 충돌: ${collisionDescriptions.join("; ")} — 안전한 자동 이동 후보가 없어 원본을 유지하므로 수동/조이스틱 조정 권장]`;
            if (holdReason && !holdReason.includes("미해결 기존 충돌")) {
              holdReason += warnSuffix;
            }
            if (selectionReason && !selectionReason.includes("미해결 기존 충돌")) {
              selectionReason += warnSuffix;
            }
          }
          return {
            id: d.id,
            label: d.label,
            autoModified: autoMod,
            selectedEngine: d.selectedEngine || "original",
            agreedEngines: d.agreedEngines || [],
            how: d.assignmentMethod || d.assignment?.how || d.how || null,
            confirmedAssignment: Boolean(d.assignmentConfirmed ?? d.assignment?.confirmed ?? d.confirmed),
            matchedStroke: d.matchedStroke ?? null,
            strokeKind: d.strokeKind || null,
            plotExpr: d.plotExpr || null,
            curveShape: d.curveShape || null,
            isMultiAbstractPair: Boolean(d.isMultiAbstractPair),
            multiAbstractAction: d.multiAbstractAction || null,
            step2ClassificationType: d.step2ClassificationType || null,
            step2ClassificationCode: d.step2ClassificationCode || null,
            step2MathematicallyProven: Boolean(d.step2MathematicallyProven),
            step2RequiresUserApproval: Boolean(d.step2RequiresUserApproval),
            step2Signals: d.step2Signals || [],
            step2RawDistMarginPt: d.step2RawDistMarginPt ?? null,
            step2RecommendedStroke: d.step2RecommendedStroke ?? null,
            step2SwappedStroke: d.step2SwappedStroke ?? null,
            shift: d.selectedPosition?.shift || d.chosenShift || [0, 0],
            movedPt: d.movement?.movedDistancePt ?? d.movedPt ?? 0,
            nonMoveCategory: d.nonMoveCategory || null,
            nonMoveCode: d.nonMoveCode || null,
            holdReason,
            selectionReason,
            hasPreExistingCollision,
            hasRemainingCollision,
            collisionDescriptions,
          };
        });

      // 이동할 라벨 및 축 편집이 전혀 없는 경우 (모두 기존 위치 유지 또는 보류)
      if (editsToApply.length === 0 || candEffectiveBody === effectiveBody) {
        const decisions0 = buildEnrichedDecisions(activePlan.labelDecisions, origFnAuditById);
        const preservation0 = checkPreservation(effectiveBody, effectiveBody, []);
        const unresolvedCnt = variantOrigDiag.counts.preExistingUnresolved;
        const unmeasuredCnt = variantOrigDiag.counts.unmeasuredNodes;

        let unchangedMsg =
          "모든 함수식 라벨이 이미 적절한 위치에 있거나 안전한 이동 조건에 해당하지 않아 원본 위치를 유지합니다.";
        let unchangedReasonCode = "all-labels-kept";

        if (multiAbstractAnalysis?.classificationCode === "type2-user-confirm-required" && actionMode === "hold") {
          unchangedReasonCode = "multi-abstract-hold-default";
          unchangedMsg =
            "다중 추상 함수식(유형 2: 사용자 확인 필요)이 감지되어 기본 상태에서는 원본 위치(Hold)를 안전하게 유지합니다. 모달에서 ① 추천 매칭(Recommend) 또는 ② 대응 관계 교환(Swap)을 선택해 미리보기를 비교한 뒤 승인할 수 있습니다.";
          if (unresolvedCnt > 0) {
            unchangedMsg += ` (⚠️ 원본 도형 미해결 충돌 ${unresolvedCnt}건 존재)`;
          }
        } else if (multiAbstractAnalysis?.classificationCode === "type3-hold-only") {
          unchangedReasonCode = "multi-abstract-hold-forced";
          unchangedMsg = `다중 추상 함수식 안전 보류(유형 3: Hold 강제 — ${multiAbstractAnalysis.holdReason || "근거 부족/충돌 위험"})에 따라 원본 위치를 유지합니다.`;
          if (unresolvedCnt > 0) {
            unchangedMsg += ` (⚠️ 원본 도형 미해결 충돌 ${unresolvedCnt}건 존재)`;
          }
        } else if (unresolvedCnt > 0) {
          unchangedReasonCode = "all-labels-kept-with-unresolved-collisions";
          const hasUncertainHold = decisions0.some(
            (d) =>
              !d.autoModified &&
              d.hasRemainingCollision &&
              (d.nonMoveCode === "uncertain-match" ||
                d.nonMoveCode === "multi-abstract-user-confirm-required" ||
                d.nonMoveCode === "multi-abstract-hold-only" ||
                d.nonMoveCode === "parse-failure" ||
                d.nonMoveCode === "fallback-anchor-unusable")
          );
          unchangedMsg =
            isV022 && hasUncertainHold
              ? `수식 매칭 또는 기호 좌표가 불확실한 항목을 안전 보류하여 원본 코드를 유지합니다. ⚠️ 원본부터 존재하던 미해결 충돌 ${unresolvedCnt}건이 남아 있습니다 (조이스틱/수동 조정 권장).`
              : `안전하게 자동 이동할 수 있는 후보가 없어 원본 코드를 유지합니다. ⚠️ 원본부터 존재하던 미해결 충돌 ${unresolvedCnt}건이 남아 있습니다 (조이스틱/수동 조정 권장).`;
        } else if (unmeasuredCnt > 0) {
          unchangedMsg += ` (참고: SVG 측정 미확인 노드 ${unmeasuredCnt}건 존재)`;
        }

        return {
          actionMode,
          multiAbstractAnalysis,
          response: {
            ...variantBase,
            ok: true,
            status: "unchanged",
            reasonCode: unchangedReasonCode,
            message: unchangedMsg,
            canApply: false,
            verified: true,
            movedCount: 0,
            fnMovedCount: 0,
            tickMovedCount: 0,
            tickHeldCount: (tickPlan.heldTicks || []).length,
            originMovedCount: 0,
            originHeldCount: (originPlan.heldOrigins || []).length,
            pointLabelMovedCount: 0,
            pointLabelHeldCount: (pointLabelPlan.heldPointLabels || []).length,
            heldCount: decisions0.length,
            labelDecisions: decisions0,
            tickDecisions: tickPlan.decisions || [],
            originDecisions: originPlan.decisions || [],
            pointLabelDecisions: pointLabelPlan.decisions || [],
            placements: activePlan.placements || [],
            shiftReport: activeShift.report || [],
            preservation: preservation0,
            collisionDiagnostics: variantOrigDiag,
          },
        };
      }

      // 7) 1차 보존 검사 (수식, domain, samples, 선분, 점 마커, 전역 폰트·선 두께 불변 확인)
      const prePreservation = isV022
        ? checkPreservationV022(effectiveBody, candEffectiveBody, editsToApply)
        : checkPreservation(effectiveBody, candEffectiveBody, editsToApply);
      if (!prePreservation.ok) {
        if (anyAxisChanged) {
          axisOptionInfo.status = "blocked-unsafe";
          axisOptionInfo.applied = false;
          axisOptionInfo.message = `축 길이 조정 보존 검증 실패로 차단됨: ${prePreservation.issues.join("; ")}`;
        }
        return {
          actionMode,
          multiAbstractAnalysis,
          response: {
            ...variantBase,
            ok: false,
            status: "reverted",
            reasonCode: "preservation-check-failed",
            message: `원본 보존 검증에 실패하여 추천을 적용하지 않고 원본을 유지합니다: ${prePreservation.issues.join("; ")}`,
            canApply: false,
            verified: false,
            preservation: prePreservation,
            errors: prePreservation.issues,
          },
        };
      }

      // 8) 필수 2차 Kroki 실제 렌더링 및 충돌/안전성 검증 (verify=true)
      const render2 = await renderTikzViaKroki(candEffectiveBody, opts);
      if (!render2.ok || !render2.svg) {
        if (anyAxisChanged) {
          axisOptionInfo.status = "blocked-unsafe";
          axisOptionInfo.applied = false;
          axisOptionInfo.message = `축 길이 조정 후 2차 Kroki 렌더링 실패로 차단됨`;
        }
        return {
          actionMode,
          multiAbstractAnalysis,
          response: {
            ...variantBase,
            ok: false,
            status: "reverted",
            reasonCode: render2.isTimeout ? "verify-kroki-timeout" : "verify-kroki-failed",
            message: `2차 검증 렌더링에 실패하여 추천을 차단하고 원본을 유지합니다 (${render2.error || "렌더 실패"}).`,
            canApply: false,
            verified: false,
            errors: [render2.error || "2차 검증 렌더링 실패"],
          },
        };
      }

      const staged2 = stageSvgForV021(tempWorkRoot, candEffectiveBody, render2.svg);
      if (!staged2.exists) {
        return {
          actionMode,
          multiAbstractAnalysis,
          response: {
            ...variantBase,
            ok: false,
            status: "reverted",
            reasonCode: "verify-staging-failed",
            message: "2차 검증 SVG 스테이징에 실패하여 원본을 유지합니다.",
            canApply: false,
            verified: false,
          },
        };
      }

      const origFNodes = scene.nodes.filter((n) => n.role === "function" && n.bbox);
      const movedFnNodeIds = (activePlan.placements || [])
        .filter((p) => p.action === "move")
        .map((p) => p.id);
      const movedTickNodeIds = (tickPlan.movedTicks || []).map((t) => t.id);
      const movedOriginNodeIds = (originPlan.movedOrigins || []).map((o) => o.id);
      const movedPointLabelNodeIds = (pointLabelPlan.movedPointLabels || []).map((p) => p.id);
      const movedNodeIds = [
        ...movedFnNodeIds,
        ...movedTickNodeIds,
        ...movedOriginNodeIds,
        ...movedPointLabelNodeIds,
      ];
      const movedFNodeIndices = movedFnNodeIds
        .map((id) => origFNodes.findIndex((q) => q.id === id))
        .filter((idx) => idx >= 0);

      const vVariant = isV022
        ? verifyOutputVariantV022({
            variant: anyAxisChanged ? "recommendedBody" : "labelOnlyBody",
            origBody: effectiveBody,
            origScene: scene,
            candidateBody: candEffectiveBody,
            edits: editsToApply,
            movedFNodeIndices,
            movedOriginNodeIds,
            movedPointLabelNodeIds,
            workRoot: tempWorkRoot,
            P,
            flags: unit2FlagsForAction,
          })
        : verifyOutputVariant({
            variant: anyAxisChanged ? "recommendedBody" : "labelOnlyBody",
            origBody: effectiveBody,
            origScene: scene,
            candidateBody: candEffectiveBody,
            edits: editsToApply,
            movedFNodeIndices,
            workRoot: tempWorkRoot,
            P,
            runRender: true,
          });

      const finalScene = vVariant.scene || scene;
      const finalDiag = isV022
        ? compareCollisionDiagnosticsV022(scene, finalScene, movedNodeIds, {
            axisChanged: anyAxisChanged,
            params: P,
            decisionsByNodeId,
            unit2Flags: unit2FlagsForAction,
          })
        : compareCollisionDiagnostics(scene, finalScene, movedNodeIds, {
            axisChanged: anyAxisChanged,
            params: P,
          });

      const newCollisionIssues = finalDiag.newlyIntroducedCollisions.map(
        (c) => c.reason || c.description
      );
      const allSafetyIssues = [
        ...(vVariant.issues || []),
        ...newCollisionIssues.filter((msg) => !(vVariant.issues || []).includes(msg)),
      ];

      if (
        !vVariant.valid ||
        vVariant.revertedToOriginal ||
        !vVariant.compiled ||
        !vVariant.svgMeasured ||
        !vVariant.collisionCheck?.ok ||
        !finalDiag.safetyPassed
      ) {
        if (anyAxisChanged) {
          axisOptionInfo.status = "blocked-unsafe";
          axisOptionInfo.applied = false;
          axisOptionInfo.message = `축 길이 조정 후 안전성/충돌 검증 실패로 축 변경 및 추천 적용 차단: ${allSafetyIssues.join("; ")}`;
        }
        const revReason = `2차 안전성 검증 실패로 원본 유지: ${allSafetyIssues.join("; ")}`;
        const baseDecisions = buildEnrichedDecisions(activePlan.labelDecisions, origFnAuditById);
        const revertedDecisions = baseDecisions.map((d) =>
          d.autoModified
            ? {
                ...d,
                autoModified: false,
                nonMoveCategory: "안전성 검증 실패",
                nonMoveCode: "safety-verification-failed",
                holdReason: revReason,
                selectionReason: `[안전성 검증 실패] ${revReason}`,
              }
            : d
        );
        return {
          actionMode,
          multiAbstractAnalysis,
          response: {
            ...variantBase,
            ok: true,
            status: "reverted",
            reasonCode: "safety-verification-failed",
            message: revReason,
            canApply: false,
            verified: false,
            movedCount: 0,
            heldCount: revertedDecisions.length,
            labelDecisions: revertedDecisions,
            placements: activePlan.placements || [],
            shiftReport: activeShift.report || [],
            preservation: vVariant.preservation,
            collisionDiagnostics: finalDiag,
            verification: {
              compiled: vVariant.compiled,
              svgMeasured: vVariant.svgMeasured,
              collisionOk: false,
              issues: allSafetyIssues,
            },
          },
        };
      }

      // 9) rawBody 에도 동일하게 안전 편집 적용 및 보존 재검증
      let finalBody = candEffectiveBody;
      if (circleAdjusted) {
        const headerDelta = effectiveBody.indexOf("]") - rawBody.indexOf("]");
        const rawEdits = editsToApply.map((e) => ({
          ...e,
          start: e.start - headerDelta,
          end: e.end - headerDelta,
        }));
        finalBody = applyEdits(rawBody, rawEdits);
        const rawPreservation = isV022
          ? checkPreservationV022(rawBody, finalBody, rawEdits)
          : checkPreservation(rawBody, finalBody, rawEdits);
        if (!rawPreservation.ok) {
          return {
            actionMode,
            multiAbstractAnalysis,
            response: {
              ...variantBase,
              ok: false,
              status: "reverted",
              reasonCode: "raw-preservation-failed",
              message: "원본 TikZ 블록 보존 검증에 실패하여 원본을 유지합니다.",
              canApply: false,
              verified: false,
              errors: rawPreservation.issues,
            },
          };
        }
      }

      if (anyAxisChanged) {
        axisOptionInfo.applied = true;
        axisOptionInfo.status = "applied";
        axisOptionInfo.message = `x축·y축 길이 자동 연장 및 2차 충돌 검증 통과 (${[
          xAxisChanged ? `x축 [${axisPlan.x.old.join(", ")}] → [${axisPlan.x.new.join(", ")}]` : null,
          yAxisChanged ? `y축 [${axisPlan.y.old.join(", ")}] → [${axisPlan.y.new.join(", ")}]` : null,
        ]
          .filter(Boolean)
          .join(", ")})`;
      }
      if (anyDomainChanged) {
        domainOptionInfo.applied = true;
        domainOptionInfo.status = "applied";
        domainOptionInfo.message = `그래프 끝점 미세 연장 및 2차 충돌 검증 통과 (${(domainPlan.decisions || [])
          .filter((d) => d.action === "extend")
          .map(
            (d) =>
              `${d.label}: domain [${d.origDomain.join(", ")}] → [${d.newDomain.join(", ")}] (+${d.arcLengthPt}pt, 간격 ${d.origOwnGapPt}pt → ${d.newOwnGapPt}pt)`
          )
          .join(" · ")})`;
      }
      if (anyPointLabelChanged) {
        pointLabelOptionInfo.applied = true;
        pointLabelOptionInfo.status = "applied";
        pointLabelOptionInfo.message = `점 이름(유형 A) 겹침 자동 정렬 및 2차 충돌 검증 통과 (${(pointLabelPlan.movedPointLabels || [])
          .map(
            (p) =>
              `${p.cleanLabel || p.label}: shift [${p.origShift.join(", ")}] → [${p.newShift.join(", ")}]pt (${p.nearestDir}, 곡선 여유 ${p.finalClearancePt}pt, 마커 간격 ${p.markerGapPt}pt)`
          )
          .join(" · ")})`;
      }

      const finalFnAuditById = new Map(
        (finalDiag.finalAudit?.functionLabelAudits || []).map((fa) => [fa.id, fa])
      );
      const getFinalAuditForDecision = (d) => {
        if (finalFnAuditById.has(d.id)) return finalFnAuditById.get(d.id);
        const byLabel = (finalDiag.finalAudit?.functionLabelAudits || []).find(
          (fa) => fa.label === d.label
        );
        return byLabel || origFnAuditById.get(d.id);
      };
      const finalAuditLookupMap = new Map(
        (activePlan.labelDecisions || []).map((d) => [d.id, getFinalAuditForDecision(d)])
      );
      const decisions = buildEnrichedDecisions(activePlan.labelDecisions, finalAuditLookupMap);

      const recommendedFullCode = prefix + finalBody + suffix;
      const recSvgDataUri = "data:image/svg+xml;base64," + Buffer.from(render2.svg, "utf8").toString("base64");
      const fnMovedCount = decisions.filter((d) => d.autoModified).length;
      const tickMovedCount = (tickPlan.movedTicks || []).length;
      const tickHeldCount = (tickPlan.heldTicks || []).length;
      const originMovedCount = (originPlan.movedOrigins || []).length;
      const originHeldCount = (originPlan.heldOrigins || []).length;
      const pointLabelMovedCount = (pointLabelPlan.movedPointLabels || []).length;
      const pointLabelHeldCount = (pointLabelPlan.heldPointLabels || []).length;
      const movedCount = fnMovedCount + tickMovedCount + originMovedCount + pointLabelMovedCount;
      const heldCount = decisions.length - fnMovedCount;

      const actionParts = [];
      if (fnMovedCount > 0) {
        if (multiAbstractAnalysis?.classificationCode === "type2-user-confirm-required" && actionMode === "recommend") {
          actionParts.push(`다중 추상 함수 추천 매칭(Recommend) 라벨 ${fnMovedCount}개 위치`);
        } else if (multiAbstractAnalysis?.classificationCode === "type2-user-confirm-required" && actionMode === "swap") {
          actionParts.push(`다중 추상 함수 대응 교환(Swap) 라벨 ${fnMovedCount}개 위치`);
        } else {
          actionParts.push(`함수식 라벨 ${fnMovedCount}개 추천 위치`);
        }
      }
      if (anyDomainChanged) actionParts.push(`그래프 끝점 미세 연장(${domainEditsToApply.length}개 곡선)`);
      if (tickMovedCount > 0) actionParts.push(`축 눈금 숫자 ${tickMovedCount}개 겹침 자동 조정(Unit 3-B)`);
      if (originMovedCount > 0) actionParts.push(`원점 O ${originMovedCount}개 4방향 자동 배치(Unit 3-D)`);
      if (pointLabelMovedCount > 0) actionParts.push(`점 이름(유형 A) ${pointLabelMovedCount}개 겹침 자동 정렬(Unit 3-E)`);
      if (anyAxisChanged) actionParts.push(`축 길이 연장(${axisEditsToApply.length}개 축)`);
      let successMsg = `${actionParts.join(" 및 ")}이(가) 2차 렌더링 및 안전성 검증을 통과했습니다.`;

      if (finalDiag.hasUnresolvedCollisions) {
        successMsg += ` (⚠️ 주의: 이동하지 않은 라벨/일반 노드에 원본부터 존재하던 미해결 충돌 ${finalDiag.counts.preExistingUnresolved}건이 남아 있어 추가 수동 확인이 필요합니다.)`;
      } else if (!finalDiag.measurementComplete) {
        successMsg += ` (참고: SVG 측정 미확인 노드 ${finalDiag.counts.unmeasuredNodes}건 존재)`;
      }

      return {
        actionMode,
        multiAbstractAnalysis,
        response: {
          ...variantBase,
          ok: true,
          status: "recommended",
          reasonCode: finalDiag.hasUnresolvedCollisions
            ? "verified-recommendation-with-unresolved-collisions"
            : "verified-recommendation",
          message: successMsg,
          canApply: (movedCount > 0 || anyAxisChanged || anyDomainChanged) && recommendedFullCode !== rawInput,
          verified: true,
          recommendedCode: recommendedFullCode,
          movedCount,
          fnMovedCount,
          tickMovedCount,
          tickHeldCount,
          originMovedCount,
          originHeldCount,
          pointLabelMovedCount,
          pointLabelHeldCount,
          heldCount,
          labelDecisions: decisions,
          tickDecisions: tickPlan.decisions || [],
          originDecisions: originPlan.decisions || [],
          pointLabelDecisions: pointLabelPlan.decisions || [],
          placements: (activePlan.placements || []).map((p) => ({
            id: p.id,
            label: p.label,
            action: p.action,
            stroke: p.stroke ?? null,
            strokeKind: p.strokeKind || null,
            axisParallelKind: p.axisParallelKind || null,
            side: p.side || null,
            end: p.end ?? null,
            alpha: p.alpha ?? null,
            selectedEngine: p.selectedEngine || (isV022 ? "v0.2.2-beta" : "v0.2.1"),
            agreedEngines: p.agreedEngines || [],
            how: p.how,
            confirmedAssignment: !!p.confirmedAssignment,
            shift: p.shift,
            reason: p.reason,
            holdReason: p.holdReason || null,
            nonMoveCategory: p.nonMoveCategory || null,
          })),
          shiftReport: activeShift.report || [],
          preservation: vVariant.preservation,
          collisionDiagnostics: finalDiag,
          verification: {
            compiled: vVariant.compiled,
            svgMeasured: vVariant.svgMeasured,
            collisionOk: vVariant.collisionCheck ? vVariant.collisionCheck.ok : false,
            issues: vVariant.issues || [],
            labelDetails: vVariant.collisionCheck?.labelDetails || [],
          },
          preview: {
            originalSvgDataUri: origSvgDataUri,
            recommendedSvgDataUri: recSvgDataUri,
          },
        },
      };
    };

    // v0.2.1 엔진이거나 v0.2.2-beta 기본("hold") 평가 실행
    const holdEval = await evaluateActionVariant("hold");
    const maAnalysis = isV022 ? holdEval.multiAbstractAnalysis : null;

    if (!isV022 || !maAnalysis) {
      return holdEval.response;
    }

    const summarizeVariantPayload = (resp, actionMode) => ({
      actionMode,
      ok: resp.ok,
      status: resp.status,
      reasonCode: resp.reasonCode,
      message: resp.message,
      canApply: resp.canApply,
      verified: resp.verified,
      recommendedCode: resp.recommendedCode,
      movedCount: resp.movedCount,
      fnMovedCount: resp.fnMovedCount,
      tickMovedCount: resp.tickMovedCount,
      tickHeldCount: resp.tickHeldCount,
      originMovedCount: resp.originMovedCount,
      originHeldCount: resp.originHeldCount,
      pointLabelMovedCount: resp.pointLabelMovedCount,
      pointLabelHeldCount: resp.pointLabelHeldCount,
      heldCount: resp.heldCount,
      labelDecisions: resp.labelDecisions,
      tickDecisions: resp.tickDecisions,
      originDecisions: resp.originDecisions,
      pointLabelDecisions: resp.pointLabelDecisions,
      placements: resp.placements,
      shiftReport: resp.shiftReport,
      axisOption: resp.axisOption,
      domainExtensionOption: resp.domainExtensionOption,
      pointLabelOption: resp.pointLabelOption,
      collisionDiagnostics: resp.collisionDiagnostics,
      verification: resp.verification,
      preview: resp.preview,
    });

    if (maAnalysis.classificationCode === "type2-user-confirm-required" && maAnalysis.supportedPair) {
      const recEval = await evaluateActionVariant("recommend");
      const swapEval = await evaluateActionVariant("swap");

      const canRecommend = Boolean(
        recEval.response.verified &&
          recEval.response.canApply &&
          recEval.response.status === "recommended"
      );
      const canSwap = Boolean(
        swapEval.response.verified &&
          swapEval.response.canApply &&
          swapEval.response.status === "recommended"
      );

      const recDecById = new Map(
        (recEval.response.labelDecisions || []).map((d) => [d.id, d])
      );
      const swapDecById = new Map(
        (swapEval.response.labelDecisions || []).map((d) => [d.id, d])
      );
      const holdDecById = new Map(
        (holdEval.response.labelDecisions || []).map((d) => [d.id, d])
      );

      const correspondenceRows = [];
      const recPairs = maAnalysis.recommendedAssignment?.pairs || [];
      const swapPairs = maAnalysis.swappedAssignment?.pairs || [];
      for (const recInfo of recPairs) {
        const nodeId = recInfo.labelId;
        const swapInfo = swapPairs.find((p) => p.labelId === nodeId) || null;
        const holdDec = holdDecById.get(nodeId) || null;
        const recDec = recDecById.get(nodeId) || null;
        const swapDec = swapDecById.get(nodeId) || null;
        correspondenceRows.push({
          nodeId,
          label: recDec?.label || holdDec?.label || recInfo.label || nodeId,
          origShift: holdDec?.shift || [0, 0],
          recommend: {
            strokeIndex: recInfo?.strokeIndex ?? null,
            plotExpr: recInfo?.plotExpr || null,
            domain: Array.isArray(recInfo?.domain) ? [...recInfo.domain] : null,
            curveShape: recInfo?.curveShape?.kindLabel || recInfo?.curveShape?.summary || null,
            shift: recDec?.shift || holdDec?.shift || [0, 0],
            movedPt: recDec?.movedPt ?? 0,
            autoModified: Boolean(recDec?.autoModified),
          },
          swap: {
            strokeIndex: swapInfo?.strokeIndex ?? null,
            plotExpr: swapInfo?.plotExpr || null,
            domain: Array.isArray(swapInfo?.domain) ? [...swapInfo.domain] : null,
            curveShape: swapInfo?.curveShape?.kindLabel || swapInfo?.curveShape?.summary || null,
            shift: swapDec?.shift || holdDec?.shift || [0, 0],
            movedPt: swapDec?.movedPt ?? 0,
            autoModified: Boolean(swapDec?.autoModified),
          },
          hold: {
            strokeIndex: null,
            shift: holdDec?.shift || [0, 0],
            movedPt: 0,
            autoModified: false,
          },
        });
      }

      let effectiveSelectedAction = "hold";
      let selectedEval = holdEval;
      if (multiAbstractActionRequested === "recommend" && canRecommend) {
        effectiveSelectedAction = "recommend";
        selectedEval = recEval;
      } else if (multiAbstractActionRequested === "swap" && canSwap) {
        effectiveSelectedAction = "swap";
        selectedEval = swapEval;
      }

      const multiAbstractOption = {
        detected: true,
        supportedPair: true,
        classificationType: maAnalysis.classificationType,
        classificationCode: maAnalysis.classificationCode,
        mathematicallyProven: Boolean(maAnalysis.mathematicallyProven),
        requiresUserApproval: true,
        requestedAction: multiAbstractActionRequested,
        selectedAction: effectiveSelectedAction,
        defaultAction: "hold",
        canRecommend,
        canSwap,
        rawDistMarginPt: maAnalysis.rawDistMarginPt ?? null,
        moderateMarginCaution: Boolean(maAnalysis.moderateMarginCaution),
        scaleNormalizedThresholds: maAnalysis.scaleNormalizedThresholds || null,
        signals: maAnalysis.signals || [],
        holdReason: maAnalysis.holdReason || null,
        summaryReason: maAnalysis.summaryReason || "",
        correspondenceRows,
        variants: {
          hold: summarizeVariantPayload(holdEval.response, "hold"),
          recommend: summarizeVariantPayload(recEval.response, "recommend"),
          swap: summarizeVariantPayload(swapEval.response, "swap"),
        },
      };

      return {
        ...selectedEval.response,
        multiAbstractActionRequested,
        multiAbstractOption,
      };
    }

    // 유형 3 (Hold 강제): 3개 이상 추상 함수, 비대칭, 신호 모순, 교점 인접, 마진 협소 등
    const multiAbstractOptionType3 = {
      detected: true,
      supportedPair: false,
      classificationType: maAnalysis.classificationType || "유형 3: Hold 강제",
      classificationCode: maAnalysis.classificationCode || "type3-hold-only",
      mathematicallyProven: false,
      requiresUserApproval: false,
      requestedAction: multiAbstractActionRequested,
      selectedAction: "hold",
      defaultAction: "hold",
      canRecommend: false,
      canSwap: false,
      rawDistMarginPt: maAnalysis.rawDistMarginPt ?? null,
      moderateMarginCaution: false,
      scaleNormalizedThresholds: maAnalysis.scaleNormalizedThresholds || null,
      signals: maAnalysis.signals || [],
      holdReason: maAnalysis.holdReason || maAnalysis.summaryReason || "유형 3 안전 보류",
      summaryReason: maAnalysis.summaryReason || "유형 3 안전 보류(Hold 강제)",
      correspondenceRows: [],
      variants: {
        hold: summarizeVariantPayload(holdEval.response, "hold"),
        recommend: null,
        swap: null,
      },
    };

    return {
      ...holdEval.response,
      multiAbstractActionRequested,
      multiAbstractOption: multiAbstractOptionType3,
    };
  } catch (err) {
    return {
      ...baseResponse,
      ok: false,
      status: "failed",
      reasonCode: "unexpected-exception",
      message: "스마트 라벨 계산 중 예외가 발생하여 원본 코드를 안전하게 유지합니다.",
      canApply: false,
      verified: false,
      errors: [String(err).slice(0, 200)],
    };
  } finally {
    try {
      rmSync(tempWorkRoot, { recursive: true, force: true });
    } catch {
      // 임시 폴더 정리 실패 무시
    }
  }
}

/**
 * GET /api/smart-label/recommend 핸들러 코어
 * @param {{getSession: () => Promise<any>, env?: Record<string, string|undefined>}} deps
 */
export async function handleSmartLabelGet(deps) {
  const authCheck = verifyDeveloperSession(await deps.getSession(), { env: deps.env });
  if (!authCheck.allowed) {
    return {
      httpStatus: authCheck.httpStatus,
      body: {
        ok: false,
        enabled: false,
        authorized: false,
        role: "none",
        code: authCheck.code,
        error: authCheck.error,
      },
    };
  }

  const serverFlag = isSmartLabelBetaServerEnabled({ env: deps.env });
  const unit3BFlag = isUnit3BServerEnabled({ env: deps.env });
  const unit3DFlag = isUnit3DServerEnabled({ env: deps.env });
  const isDeveloper = authCheck.role === "developer";
  return {
    httpStatus: 200,
    body: {
      ok: true,
      enabled: serverFlag.enabled,
      authorized: true,
      email: authCheck.email,
      role: authCheck.role,
      canSelectEngine: isDeveloper,
      reason: serverFlag.reason,
      algorithmVersion: isDeveloper ? ALGORITHM_VERSION : ALGORITHM_VERSION_V022,
      defaultEngineVersion: authCheck.defaultEngineVersion,
      availableEngines: isDeveloper ? SUPPORTED_ENGINE_VERSIONS : ["v0.2.2-beta"],
      defaultEnableUnit3B: unit3BFlag.enabled ? authCheck.defaultEnableUnit3B : false,
      defaultApplyAxis: false,
      defaultApplyDomainExtension: false,
      defaultEnablePointLabelOverlapFix: false,
      unit3BServerEnabled: unit3BFlag.enabled,
      unit3BDisabledReason: unit3BFlag.enabled ? null : unit3BFlag.reason,
      unit3DServerEnabled: unit3DFlag.enabled,
      unit3DDisabledReason: unit3DFlag.enabled ? null : unit3DFlag.reason,
    },
  };
}

/**
 * POST /api/smart-label/recommend 핸들러 코어
 * @param {any} requestBody
 * @param {{
 *   getSession: () => Promise<any>,
 *   env?: Record<string, string|undefined>,
 *   fetchImpl?: typeof fetch,
 *   krokiBaseUrl?: string,
 *   timeoutMs?: number
 * }} deps
 */
export async function handleSmartLabelPost(requestBody, deps) {
  const session = await deps.getSession();
  const authCheck = verifyDeveloperSession(session, { env: deps.env });
  if (!authCheck.allowed) {
    return {
      httpStatus: authCheck.httpStatus,
      body: {
        ok: false,
        status: "failed",
        reasonCode: authCheck.code,
        message: authCheck.error,
        canApply: false,
      },
    };
  }

  const serverFlag = isSmartLabelBetaServerEnabled({ env: deps.env });
  if (!serverFlag.enabled) {
    return {
      httpStatus: 503,
      body: {
        ok: false,
        status: "failed",
        reasonCode: "BETA_DISABLED",
        message: serverFlag.reason,
        canApply: false,
      },
    };
  }

  if (!requestBody || typeof requestBody !== "object") {
    return {
      httpStatus: 400,
      body: {
        ok: false,
        status: "failed",
        reasonCode: "INVALID_BODY",
        message: "유효하지 않은 요청 본문입니다.",
        canApply: false,
      },
    };
  }

  const rawTikz = typeof requestBody.tikz === "string" ? requestBody.tikz : "";
  const clientInputHash = typeof requestBody.inputHash === "string" ? requestBody.inputHash : null;
  const applyAxis = Boolean(requestBody.applyAxis === true);
  const applyDomainExtension = Boolean(requestBody.applyDomainExtension === true);
  const multiAbstractAction = normalizeMultiAbstractAction(requestBody.multiAbstractAction);
  // 파일럿 팀원(role === "pilot")은 요청 본문에 어떤 engineVersion 을 보내더라도 서버에서 v0.2.2-beta 로 강제 고정
  const engineVersion =
    authCheck.role === "pilot" ? "v0.2.2-beta" : normalizeEngineVersion(requestBody.engineVersion);
  const enableUnit3B = Boolean(requestBody.enableUnit3B === true);
  const enablePointLabelOverlapFix = Boolean(
    requestBody.enablePointLabelOverlapFix === true || requestBody.enableUnit3E === true
  );
  const serverInputHash = computeInputHash(rawTikz);

  if (clientInputHash && clientInputHash !== serverInputHash) {
    return {
      httpStatus: 409,
      body: {
        ok: false,
        status: "failed",
        reasonCode: "INPUT_HASH_MISMATCH",
        message: "전송 도중 에디터 코드가 변경되었습니다. 다시 시도해 주세요.",
        canApply: false,
        inputHash: serverInputHash,
      },
    };
  }

  const slot = acquireUserExecutionSlot(authCheck.email);
  if (!slot.acquired) {
    return {
      httpStatus: slot.httpStatus,
      body: {
        ok: false,
        status: "failed",
        reasonCode: slot.reasonCode,
        message: slot.message,
        canApply: false,
      },
    };
  }

  try {
    const result = await recommendSmartLabelBeta(rawTikz, {
      krokiBaseUrl: deps.krokiBaseUrl,
      timeoutMs: deps.timeoutMs,
      fetchImpl: deps.fetchImpl,
      env: deps.env,
      verify: true,
      applyAxis,
      applyDomainExtension,
      multiAbstractAction,
      engineVersion,
      enableUnit3B,
      enablePointLabelOverlapFix,
    });

    const httpStatus =
      result.reasonCode === "empty-input" ||
      result.reasonCode === "input-too-large" ||
      result.reasonCode === "dangerous-tex-macro" ||
      result.reasonCode === "excessive-samples"
        ? 400
        : 200;

    return {
      httpStatus,
      body: result,
    };
  } finally {
    slot.release();
  }
}
