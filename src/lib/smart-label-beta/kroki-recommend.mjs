// KO-SMART v0.2.1 개발자 전용 베타 — Kroki 비동기 렌더링 어댑터 및 권한·안전성 게이트
// 원칙:
//  1) 기존 v0.1, v0.2, v0.2.1 알고리즘 및 smart-label-engine 코드는 단 한 줄도 수정하지 않고 그대로 import 하여 재사용한다.
//  2) 기존 local-render.mjs(동기식 spawnSync) 대신 자체 Kroki 서버 HTTP(비동기 fetch)로 SVG를 받아
//     요청 전용 임시 workRoot(<hash>/t.svg)에 스테이징한 뒤 buildScene / verifyOutputVariant 를 호출한다.
//  3) Kroki 렌더링이 실패하거나 스테이징되지 않은 경우에는 buildScene 을 절대 호출하지 않아 로컬 latex 실행 폴백을 원천 차단한다.
//  4) 한국어 포함 도형, 축(x, y) 미비 도형, 2차 검증(verify=true) 실패 도형은 모두 원본을 100% 유지한다.

import { createHash, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HEADER, FOOTER } from "../../../experiments/smart-label-prototype-v021/src/local-render.mjs";
import { buildScene } from "../../../experiments/smart-label-prototype-v021/src/scene.mjs";
import { PARAMS, shiftEdits, applyEdits } from "../../../experiments/smart-label-prototype-v021/src/algorithm.mjs";
import { planLabelsMultiEngine } from "../../../experiments/smart-label-prototype-v021/src/multi-engine.mjs";
import {
  ALGORITHM_VERSION,
  classifyFigure,
  checkPreservation,
  verifyOutputVariant,
} from "../../../experiments/smart-label-prototype-v021/src/recommend.mjs";
import { maskComments, extractTikzNodes } from "../../../experiments/smart-label-engine/src/tikz-nodes.mjs";

export const DEVELOPER_BETA_EMAIL = "mattko6281@gmail.com";
export const MAX_TIKZ_INPUT_LENGTH = 15000;
export const MAX_SAMPLES_VALUE = 500;
export const DEFAULT_KROKI_TIMEOUT_MS = 6000;

// 위험 TeX 매크로 차단 정규식 (주석 제거 후 검사)
// 주의: 정규식 차단은 1차 입력 방어선이며, 실제 실행 격리는 Kroki 컨테이너/OS 자원 제한에 의존함.
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
 * 계산 도중 또는 미리보기 중 사용자가 에디터 내용을 변경했는지 검증하는 데 사용한다.
 * @param {string} rawInput
 */
export function computeInputHash(rawInput) {
  return createHash("sha256").update(String(rawInput ?? ""), "utf8").digest("hex").slice(0, 16);
}

/**
 * 서버 측 베타 기능 활성화 여부를 동적으로 확인한다.
 * Vercel의 NEXT_PUBLIC_ 환경변수가 빌드 시점에만 인라인되는 한계를 보완하기 위해,
 * 서버 런타임 환경변수(ENABLE_SMART_LABEL_BETA), 긴급 킬스위치(SMART_LABEL_KILL_SWITCH),
 * 런타임 글로벌 오버라이드, 로컬 킬스위치 파일을 모두 확인한다.
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
 * NextAuth 서버 세션 객체를 검증하여 개발자 단독(mattko6281@gmail.com) 권한을 판정한다.
 * 클라이언트가 요청 본문이나 헤더로 보낸 이메일은 절대 사용하지 않는다.
 * 개발 모드(NODE_ENV === "development")라 하더라도 세션 우회를 허용하지 않는다.
 * @param {any} session NextAuth auth() 반환 세션
 */
export function verifyDeveloperSession(session) {
  const rawEmail = session?.user?.email;
  if (!rawEmail || typeof rawEmail !== "string" || !rawEmail.trim()) {
    return {
      allowed: false,
      httpStatus: 401,
      code: "UNAUTHORIZED",
      error: "인증되지 않은 요청입니다. Google 로그인이 필요합니다.",
    };
  }
  const normalized = rawEmail.trim().toLowerCase();
  if (normalized !== DEVELOPER_BETA_EMAIL) {
    return {
      allowed: false,
      httpStatus: 403,
      code: "FORBIDDEN",
      error: "접근 권한이 없습니다. 스마트 라벨 베타는 개발자 전용 기능입니다.",
    };
  }
  return {
    allowed: true,
    httpStatus: 200,
    code: "OK",
    email: normalized,
  };
}

/**
 * KO-SMART 운영 앱의 getProcessedInput(src/app/page.tsx L368-412)과 동일한 래핑 및 Circle 정비율 보정을 수행한다.
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
 * KO-SMART의 encodeKroki(src/app/page.tsx L29-37)와 동일한 deflate(level 9) + Base64URL 인코딩
 * @param {string} text
 */
export function encodeKroki(text) {
  const compressed = deflateSync(Buffer.from(text, "utf8"), { level: 9 });
  return compressed.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 전체 입력에서 단일 \begin{tikzpicture} ... \end{tikzpicture} 블록을 추출한다.
 * Circle 정비율 보정이 필요한 경우 tikzpicture 헤더에도 동일하게 반영하여 측정 좌표계를 일치시킨다.
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
  // Circle 정비율 보정이 발동하는 코드인지 확인하여 측정용 body 헤더도 동일하게 맞춘다.
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
 * - 기존 v0.2.1 의 buildScene, classifyFigure, planLabelsMultiEngine, shiftEdits, applyEdits,
 *   checkPreservation, verifyOutputVariant 를 수정 없이 그대로 사용한다.
 * - 축 길이 조정은 항상 OFF(labelOnly 경로 고정)이며, 2차 렌더 검증(verify=true)이 강제된다.
 *
 * @param {string} rawInput 에디터 전체 TikZ 문자열
 * @param {{
 *   krokiBaseUrl?: string,
 *   timeoutMs?: number,
 *   fetchImpl?: typeof fetch,
 *   params?: typeof PARAMS,
 *   verify?: boolean
 * }} [opts]
 */
export async function recommendSmartLabelBeta(rawInput, opts = {}) {
  const inputHash = computeInputHash(rawInput);
  const baseResponse = {
    algorithmVersion: ALGORITHM_VERSION,
    ok: false,
    status: "failed",
    reasonCode: null,
    message: "",
    canApply: false,
    verified: false,
    inputHash,
    originalCode: String(rawInput ?? ""),
    recommendedCode: String(rawInput ?? ""),
    figureType: null,
    movedCount: 0,
    heldCount: 0,
    labelDecisions: [],
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
  const P = opts.params || PARAMS;
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

    // 5) 그림 유형 확인: 반드시 x축과 y축이 모두 식별된 coordinateFunction(plot 함수 그래프)만 지원
    const fig = classifyFigure(scene);
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

    // 6) 기존 v0.2.1 멀티 엔진 함수식 라벨 후보 평가 및 선택 (축 길이 조정 OFF = labelOnly 경로)
    const plan0 = planLabelsMultiEngine(scene, P, null, "auto");
    const sh0 = shiftEdits(scene, plan0, P);
    const labelOnlyEditsOnEffective = sh0.edits;

    // 만약 circleAdjusted 로 인해 effectiveBody 와 rawBody 의 헤더 길이가 다르더라도
    // rawBody 에 안전하게 적용하기 위해 rawBody 기준의 shiftEdits 도 함께 확인한다.
    let targetBodyForEdits = rawBody;
    let editsToApply = labelOnlyEditsOnEffective;
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
      // effectiveBody 기준으로 먼저 검증한 뒤 rawBody 의 대응 노드 오프셋으로 치환
      targetBodyForEdits = effectiveBody;
    }

    const candEffectiveBody = applyEdits(effectiveBody, editsToApply);

    const decisions = (plan0.labelDecisions || []).map((d) => ({
      id: d.id,
      label: d.label,
      autoModified: !!d.autoModified,
      selectedEngine: d.selectedEngine || "original",
      agreedEngines: d.agreedEngines || [],
      how: d.assignmentMethod || d.assignment?.how || null,
      confirmedAssignment: Boolean(d.assignmentConfirmed ?? d.assignment?.confirmed),
      shift: d.selectedPosition?.shift || d.chosenShift || [0, 0],
      movedPt: d.movement?.movedDistancePt ?? d.movedPt ?? 0,
      nonMoveCategory: d.nonMoveCategory || null,
      nonMoveCode: d.nonMoveCode || null,
      holdReason: d.holdReason || null,
      selectionReason: d.selectionReason || "",
    }));

    // 이동할 라벨이 전혀 없는 경우 (모두 기존 위치 유지 또는 보류)
    if (editsToApply.length === 0 || candEffectiveBody === effectiveBody) {
      const preservation0 = checkPreservation(effectiveBody, effectiveBody, []);
      return {
        ...baseResponse,
        ok: true,
        status: "unchanged",
        reasonCode: "all-labels-kept",
        message: "모든 함수식 라벨이 이미 적절한 위치에 있거나 안전한 이동 조건에 해당하지 않아 원본 위치를 유지합니다.",
        canApply: false,
        verified: true,
        movedCount: 0,
        heldCount: decisions.length,
        labelDecisions: decisions,
        placements: plan0.placements || [],
        shiftReport: sh0.report || [],
        preservation: preservation0,
      };
    }

    // 7) 1차 보존 검사 (수식, domain, 선분, 점 마커, 전역 폰트·선 두께 불변 확인)
    const prePreservation = checkPreservation(effectiveBody, candEffectiveBody, editsToApply);
    if (!prePreservation.ok) {
      return {
        ...baseResponse,
        ok: false,
        status: "reverted",
        reasonCode: "preservation-check-failed",
        message: `원본 보존 검증에 실패하여 추천을 적용하지 않고 원본을 유지합니다: ${prePreservation.issues.join("; ")}`,
        canApply: false,
        verified: false,
        preservation: prePreservation,
        errors: prePreservation.issues,
      };
    }

    // 8) 필수 2차 Kroki 실제 렌더링 및 충돌/안전성 검증 (verify=true)
    const render2 = await renderTikzViaKroki(candEffectiveBody, opts);
    if (!render2.ok || !render2.svg) {
      return {
        ...baseResponse,
        ok: false,
        status: "reverted",
        reasonCode: render2.isTimeout ? "verify-kroki-timeout" : "verify-kroki-failed",
        message: `2차 검증 렌더링에 실패하여 추천을 차단하고 원본을 유지합니다 (${render2.error || "렌더 실패"}).`,
        canApply: false,
        verified: false,
        errors: [render2.error || "2차 검증 렌더링 실패"],
      };
    }

    const staged2 = stageSvgForV021(tempWorkRoot, candEffectiveBody, render2.svg);
    if (!staged2.exists) {
      return {
        ...baseResponse,
        ok: false,
        status: "reverted",
        reasonCode: "verify-staging-failed",
        message: "2차 검증 SVG 스테이징에 실패하여 원본을 유지합니다.",
        canApply: false,
        verified: false,
      };
    }

    const origFNodes = scene.nodes.filter((n) => n.role === "function" && n.bbox);
    const movedIndicesLabelOnly = (plan0.placements || [])
      .filter((p) => p.action === "move")
      .map((p) => origFNodes.findIndex((q) => q.id === p.id))
      .filter((idx) => idx >= 0);

    const vLabelOnly = verifyOutputVariant({
      variant: "labelOnlyBody",
      origBody: effectiveBody,
      origScene: scene,
      candidateBody: candEffectiveBody,
      edits: editsToApply,
      movedFNodeIndices: movedIndicesLabelOnly,
      workRoot: tempWorkRoot,
      P,
      runRender: true,
    });

    if (
      !vLabelOnly.valid ||
      vLabelOnly.revertedToOriginal ||
      !vLabelOnly.compiled ||
      !vLabelOnly.svgMeasured ||
      !vLabelOnly.collisionCheck?.ok
    ) {
      const revReason = `2차 안전성 검증 실패로 원본 유지: ${(vLabelOnly.issues || []).join("; ")}`;
      const revertedDecisions = decisions.map((d) =>
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
        ...baseResponse,
        ok: true,
        status: "reverted",
        reasonCode: "safety-verification-failed",
        message: revReason,
        canApply: false,
        verified: false,
        movedCount: 0,
        heldCount: revertedDecisions.length,
        labelDecisions: revertedDecisions,
        placements: plan0.placements || [],
        shiftReport: sh0.report || [],
        preservation: vLabelOnly.preservation,
        verification: {
          compiled: vLabelOnly.compiled,
          svgMeasured: vLabelOnly.svgMeasured,
          collisionOk: vLabelOnly.collisionCheck ? vLabelOnly.collisionCheck.ok : false,
          issues: vLabelOnly.issues || [],
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
      const rawPreservation = checkPreservation(rawBody, finalBody, rawEdits);
      if (!rawPreservation.ok) {
        return {
          ...baseResponse,
          ok: false,
          status: "reverted",
          reasonCode: "raw-preservation-failed",
          message: "원본 TikZ 블록 보존 검증에 실패하여 원본을 유지합니다.",
          canApply: false,
          verified: false,
          errors: rawPreservation.issues,
        };
      }
    }

    const recommendedFullCode = prefix + finalBody + suffix;
    const recSvgDataUri = "data:image/svg+xml;base64," + Buffer.from(render2.svg, "utf8").toString("base64");
    const movedCount = decisions.filter((d) => d.autoModified).length;
    const heldCount = decisions.length - movedCount;

    return {
      ...baseResponse,
      ok: true,
      status: "recommended",
      reasonCode: "verified-recommendation",
      message: `함수식 라벨 ${movedCount}개에 대한 추천 위치가 2차 렌더링 및 안전성 검증을 통과했습니다.`,
      canApply: movedCount > 0 && recommendedFullCode !== rawInput,
      verified: true,
      recommendedCode: recommendedFullCode,
      movedCount,
      heldCount,
      labelDecisions: decisions,
      placements: (plan0.placements || []).map((p) => ({
        id: p.id,
        label: p.label,
        action: p.action,
        selectedEngine: p.selectedEngine || "v0.2.1",
        agreedEngines: p.agreedEngines || [],
        how: p.how,
        confirmedAssignment: !!p.confirmedAssignment,
        shift: p.shift,
        reason: p.reason,
        holdReason: p.holdReason || null,
        nonMoveCategory: p.nonMoveCategory || null,
      })),
      shiftReport: sh0.report || [],
      preservation: vLabelOnly.preservation,
      verification: {
        compiled: vLabelOnly.compiled,
        svgMeasured: vLabelOnly.svgMeasured,
        collisionOk: vLabelOnly.collisionCheck ? vLabelOnly.collisionCheck.ok : false,
        issues: vLabelOnly.issues || [],
        labelDetails: vLabelOnly.collisionCheck?.labelDetails || [],
      },
      preview: {
        originalSvgDataUri: origSvgDataUri,
        recommendedSvgDataUri: recSvgDataUri,
      },
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
 * 개발자 세션 여부 및 서버 측 동적 활성화 상태를 반환한다.
 * @param {{getSession: () => Promise<any>, env?: Record<string, string|undefined>}} deps
 */
export async function handleSmartLabelGet(deps) {
  const authCheck = verifyDeveloperSession(await deps.getSession());
  if (!authCheck.allowed) {
    return {
      httpStatus: authCheck.httpStatus,
      body: {
        ok: false,
        enabled: false,
        authorized: false,
        code: authCheck.code,
        error: authCheck.error,
      },
    };
  }

  const serverFlag = isSmartLabelBetaServerEnabled({ env: deps.env });
  return {
    httpStatus: 200,
    body: {
      ok: true,
      enabled: serverFlag.enabled,
      authorized: true,
      email: authCheck.email,
      reason: serverFlag.reason,
      algorithmVersion: ALGORITHM_VERSION,
    },
  };
}

/**
 * POST /api/smart-label/recommend 핸들러 코어
 * 1) NextAuth 서버 세션 검증 (401 / 403) — 요청 본문의 email 파라미터는 절대 신뢰하지 않음
 * 2) 서버 측 베타 활성화 및 긴급 차단 스위치 확인 (503)
 * 3) 동시 실행 및 요청 빈도 제한 (429)
 * 4) Kroki 비동기 렌더링 어댑터를 통한 추천 및 필수 2차 검증(verify=true) 수행
 *
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
  // 1) 서버 세션 기반 권한 검증 (클라이언트가 보낸 requestBody.email 등은 완전히 무시)
  const session = await deps.getSession();
  const authCheck = verifyDeveloperSession(session);
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

  // 2) 서버 측 베타 활성화 및 긴급 차단(Kill-Switch) 확인
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

  // 3) 요청 본문 파싱 검증
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

  // 4) 동시 실행 및 요청 빈도 제한
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
      verify: true, // 사용자 경로에서는 항상 verify=true 고정
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

