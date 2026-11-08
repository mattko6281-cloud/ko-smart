// KO-SMART v0.2.1 / v0.2.2 베타 — 클라이언트 UI 권한 판정(개발자 vs 파일럿 팀원) 및 추천 승인·독립 백업·원본 복원 순수 상태 전이 모듈
// (브라우저 UI 컴포넌트와 단위 테스트 양쪽에서 동일하게 재사용)

export const DEVELOPER_BETA_EMAIL = "mattko6281@gmail.com";
export const SMART_LABEL_BACKUP_STORAGE_KEY = "kosmart_smart_label_backup_v021";
export const SMART_LABEL_ENGINE_STORAGE_KEY = "kosmart_smart_label_engine_version";
export const SMART_LABEL_UI_MODE_STORAGE_PREFIX = "kosmart_smart_label_ui_mode_v022";
export const DEFAULT_CLIENT_ENGINE_VERSION = "v0.2.1";
export const SUPPORTED_CLIENT_ENGINE_VERSIONS = ["v0.2.1", "v0.2.2-beta"];
export const DEFAULT_SMART_LABEL_UI_MODE = "A";
export const SUPPORTED_SMART_LABEL_UI_MODES = ["A", "B", "C"];

/**
 * 클라이언트에서 개발자(developer), 지정된 파일럿 팀원(pilot), 일반 팀원(none)의 스마트 라벨 권한 및 초기 설정을 판정한다.
 * - 개발자(mattko6281@gmail.com): 엔진 선택 가능, Unit 3-B 초기 기본 ON, 축 길이 조정 기본 OFF
 * - 파일럿 팀원(serverRole === "pilot" 또는 pilotEmails 포함): v0.2.2-beta 엔진 고정(엔진 선택 UI 숨김), Unit 3-B 초기 기본 OFF, 축 길이 조정 기본 OFF
 * - 미지정 팀원 / 미인증 / 서버 비활성화: UI 숨김(showUI = false)
 *
 * @param {{
 *   sessionStatus: "authenticated" | "loading" | "unauthenticated" | string,
 *   sessionEmail?: string | null,
 *   serverBetaEnabled: boolean,
 *   serverRole?: "developer" | "pilot" | "none" | string | null,
 *   pilotEmails?: string[] | null,
 *   unit3BServerEnabled?: boolean
 * }} params
 */
export function resolveSmartLabelClientAccess(params) {
  const denied = {
    showUI: false,
    role: /** @type {"developer" | "pilot" | "none"} */ ("none"),
    canSelectEngine: false,
    effectiveEngineVersion: /** @type {"v0.2.1" | "v0.2.2-beta"} */ ("v0.2.1"),
    defaultEnableUnit3B: false,
    defaultApplyAxis: false,
    unit3BServerEnabled: false,
  };
  if (!params || typeof params !== "object") return denied;
  const {
    sessionStatus,
    sessionEmail,
    serverBetaEnabled,
    serverRole,
    pilotEmails,
    unit3BServerEnabled = true,
  } = params;

  if (sessionStatus !== "authenticated") return denied;
  if (!serverBetaEnabled) return denied;
  if (!sessionEmail || typeof sessionEmail !== "string") return denied;

  const normalized = sessionEmail.trim().toLowerCase();
  if (!normalized) return denied;

  const u3bAllowed = unit3BServerEnabled !== false;

  if (normalized === DEVELOPER_BETA_EMAIL) {
    return {
      showUI: true,
      role: /** @type {"developer" | "pilot" | "none"} */ ("developer"),
      canSelectEngine: true,
      effectiveEngineVersion: /** @type {"v0.2.1" | "v0.2.2-beta"} */ ("v0.2.1"),
      defaultEnableUnit3B: u3bAllowed ? true : false,
      defaultApplyAxis: false,
      unit3BServerEnabled: u3bAllowed,
    };
  }

  const isPilotByServerRole = serverRole === "pilot";
  const isPilotByList =
    Array.isArray(pilotEmails) &&
    pilotEmails.some(
      (e) => typeof e === "string" && e.trim().toLowerCase() === normalized && normalized.includes("@")
    );

  if (isPilotByServerRole || isPilotByList) {
    return {
      showUI: true,
      role: /** @type {"developer" | "pilot" | "none"} */ ("pilot"),
      canSelectEngine: false,
      effectiveEngineVersion: /** @type {"v0.2.1" | "v0.2.2-beta"} */ ("v0.2.2-beta"),
      defaultEnableUnit3B: false,
      defaultApplyAxis: false,
      unit3BServerEnabled: u3bAllowed,
    };
  }

  return denied;
}

/**
 * 클라이언트에서 베타 버튼 및 UI를 렌더링할지 판정한다.
 * - 인증 완료(status === "authenticated") + 서버 베타 활성화(serverBetaEnabled === true) 상태에서
 *   개발자(mattko6281@gmail.com) 또는 서버가 승인한 파일럿 팀원(serverRole === "pilot" / pilotEmails)인 경우에만 true 를 반환한다.
 *
 * @param {{
 *   sessionStatus: "authenticated" | "loading" | "unauthenticated" | string,
 *   sessionEmail?: string | null,
 *   serverBetaEnabled: boolean,
 *   serverRole?: "developer" | "pilot" | "none" | string | null,
 *   pilotEmails?: string[] | null
 * }} params
 */
export function shouldShowSmartLabelBetaUI(params) {
  return resolveSmartLabelClientAccess(params).showUI;
}

/**
 * 다중 추상 함수(유형 2/3) 제안 객체에서 사용자의 모달 선택("hold" | "recommend" | "swap")에
 * 해당하는 검증 완료 변형(variant)을 오버레이한 활성 제안 객체를 반환한다.
 * - 이 함수는 순수 함수이며 에디터의 TikZ 코드를 직접 변경하지 않는다.
 * - 유형 3(type3-hold-only)이거나 미검증 변형인 경우 강제로 "hold" 변형을 반환한다.
 *
 * @param {any} proposal
 * @param {"hold" | "recommend" | "swap"} [selectedAction]
 */
export function resolveActiveProposalForLineNameChoice(proposal, selectedLineNameAction) {
  if (!proposal || typeof proposal !== "object") return proposal;
  const lnOpt = proposal.lineNameOption;
  if (!lnOpt || !lnOpt.detected || !lnOpt.variants) return proposal;

  const requested =
    selectedLineNameAction === "recommend" ||
    selectedLineNameAction === "swap" ||
    selectedLineNameAction === "hold"
      ? selectedLineNameAction
      : lnOpt.selectedAction || "hold";

  let effectiveAction = "hold";
  if (lnOpt.safetyTier === "D3-2" && lnOpt.supportedPair) {
    if (requested === "recommend" && lnOpt.canRecommend && lnOpt.variants.recommend) {
      effectiveAction = "recommend";
    } else if (requested === "swap" && lnOpt.canSwap && lnOpt.variants.swap) {
      effectiveAction = "swap";
    }
  }

  const chosenVariant = lnOpt.variants[effectiveAction] || lnOpt.variants.hold;
  if (!chosenVariant) return proposal;

  return {
    ...proposal,
    ...chosenVariant,
    lineNameActionRequested: effectiveAction,
    lineNameOption: {
      ...lnOpt,
      ...(chosenVariant.lineNameOption || {}),
      variants: lnOpt.variants,
      correspondenceRows: lnOpt.correspondenceRows || [],
      selectedAction: effectiveAction,
    },
  };
}

export function resolveActiveProposalForMultiAbstractChoice(
  proposal,
  selectedAction,
  selectedLineNameAction
) {
  if (!proposal || typeof proposal !== "object") return proposal;
  const maOpt = proposal.multiAbstractOption;
  if (!maOpt || !maOpt.detected || !maOpt.variants) {
    return resolveActiveProposalForLineNameChoice(proposal, selectedLineNameAction);
  }

  const requested =
    selectedAction === "recommend" || selectedAction === "swap" || selectedAction === "hold"
      ? selectedAction
      : maOpt.selectedAction || "hold";

  let effectiveAction = "hold";
  if (maOpt.classificationCode === "type2-user-confirm-required" && maOpt.supportedPair) {
    if (requested === "recommend" && maOpt.canRecommend && maOpt.variants.recommend) {
      effectiveAction = "recommend";
    } else if (requested === "swap" && maOpt.canSwap && maOpt.variants.swap) {
      effectiveAction = "swap";
    }
  }

  const chosenVariant = maOpt.variants[effectiveAction] || maOpt.variants.hold;
  if (!chosenVariant) {
    return resolveActiveProposalForLineNameChoice(proposal, selectedLineNameAction);
  }

  const maResolved = {
    ...proposal,
    ...chosenVariant,
    multiAbstractActionRequested: effectiveAction,
    multiAbstractOption: {
      ...maOpt,
      selectedAction: effectiveAction,
    },
  };
  return resolveActiveProposalForLineNameChoice(maResolved, selectedLineNameAction);
}

/**
 * 현재 에디터 코드와 추천 결과 원본을 비교해 적용 가능 여부를 판정한다.
 * - 검증되지 않았거나(verified !== true), canApply !== true 인 결과는 차단한다.
 * - 추천 계산 중 또는 미리보기 중 에디터 내용이 변경된 경우(currentRawInput !== proposal.originalCode) 차단한다.
 *
 * @param {any} proposal
 * @param {string} currentRawInput
 * @param {{multiAbstractAction?: "hold" | "recommend" | "swap", lineNameAction?: "hold" | "recommend" | "swap"}} [opts]
 */
export function evaluateProposalApplicability(proposal, currentRawInput, opts = {}) {
  if (!proposal || typeof proposal !== "object") {
    return { allowed: false, reasonCode: "no-proposal", reason: "추천 결과가 없습니다." };
  }
  const activeProposal = resolveActiveProposalForMultiAbstractChoice(
    proposal,
    opts?.multiAbstractAction ?? proposal?.multiAbstractOption?.selectedAction,
    opts?.lineNameAction ?? proposal?.lineNameOption?.selectedAction
  );
  if (activeProposal.originalCode !== currentRawInput) {
    return {
      allowed: false,
      reasonCode: "input-changed",
      reason: "추천 계산 도중 또는 미리보기 중에 에디터 코드가 변경되어 이전 추천을 적용할 수 없습니다. 다시 자동 정렬을 실행해 주세요.",
    };
  }
  if (!activeProposal.verified) {
    return {
      allowed: false,
      reasonCode: "unverified-blocked",
      reason: "2차 렌더링 및 안전성 검증을 통과하지 않은 결과는 적용할 수 없습니다.",
    };
  }
  if (!activeProposal.canApply || activeProposal.status !== "recommended") {
    return {
      allowed: false,
      reasonCode: "not-applicable",
      reason: activeProposal.message || "적용 가능한 추천 변경 사항이 없습니다.",
    };
  }
  if (!activeProposal.recommendedCode || activeProposal.recommendedCode === activeProposal.originalCode) {
    return {
      allowed: false,
      reasonCode: "no-diff",
      reason: "원본 코드와 추천 코드가 동일합니다.",
    };
  }
  return { allowed: true, reasonCode: "ok", reason: "적용 가능" };
}

/**
 * 사용자가 추천 적용을 명시적으로 승인했을 때,
 * 적용 직전의 원본을 독립 백업으로 생성하고 새 에디터 코드를 반환한다.
 *
 * @param {any} proposal
 * @param {string} currentRawInput
 * @param {{multiAbstractAction?: "hold" | "recommend" | "swap", lineNameAction?: "hold" | "recommend" | "swap"}} [opts]
 */
export function applyApprovedProposal(proposal, currentRawInput, opts = {}) {
  const activeProposal = resolveActiveProposalForMultiAbstractChoice(
    proposal,
    opts?.multiAbstractAction ?? proposal?.multiAbstractOption?.selectedAction,
    opts?.lineNameAction ?? proposal?.lineNameOption?.selectedAction
  );
  const check = evaluateProposalApplicability(activeProposal, currentRawInput, opts);
  if (!check.allowed) {
    return {
      applied: false,
      reasonCode: check.reasonCode,
      error: check.reason,
      newRawInput: currentRawInput,
      backup: null,
    };
  }
  const backup = {
    originalCode: currentRawInput,
    appliedRecommendedCode: activeProposal.recommendedCode,
    inputHash: activeProposal.inputHash || null,
    multiAbstractAction: activeProposal.multiAbstractOption?.detected
      ? activeProposal.multiAbstractOption.selectedAction
      : null,
    lineNameAction: activeProposal.lineNameOption?.detected
      ? activeProposal.lineNameOption.selectedAction
      : null,
    appliedAt: Date.now(),
  };
  return {
    applied: true,
    reasonCode: "applied",
    newRawInput: activeProposal.recommendedCode,
    backup,
  };
}

/**
 * 독립 백업으로부터 원본 복원을 시도한다.
 * - 추천 적용 이후 사용자가 에디터나 조이스틱으로 코드를 다시 편집한 경우(currentRawInput !== backup.appliedRecommendedCode),
 *   confirmedOverwrite === true 가 아니면 즉시 덮어쓰지 않고 확인 요청(requiresConfirmation: true)을 반환한다.
 *
 * @param {{originalCode: string, appliedRecommendedCode: string, appliedAt?: number} | null} backup
 * @param {string} currentRawInput
 * @param {{confirmedOverwrite?: boolean}} [opts]
 */
export function restoreOriginalFromBackup(backup, currentRawInput, opts = {}) {
  if (!backup || typeof backup.originalCode !== "string") {
    return {
      restored: false,
      requiresConfirmation: false,
      reasonCode: "no-backup",
      message: "복원할 원본 백업이 없습니다.",
      newRawInput: currentRawInput,
    };
  }

  const modifiedAfterApply = currentRawInput !== backup.appliedRecommendedCode;
  if (modifiedAfterApply && !opts.confirmedOverwrite) {
    return {
      restored: false,
      requiresConfirmation: true,
      modifiedAfterApply: true,
      reasonCode: "overwrite-confirmation-required",
      message:
        "추천 적용 이후 수동으로 편집한 내용이 있습니다. 원본으로 복원하면 이후 수정 내용이 덮어써집니다. 정말 원본으로 복원하시겠습니까?",
      newRawInput: currentRawInput,
    };
  }

  return {
    restored: true,
    requiresConfirmation: false,
    modifiedAfterApply,
    reasonCode: "restored",
    message: "스마트 라벨 자동 정렬 이전의 원본 TikZ 코드로 복원되었습니다.",
    newRawInput: backup.originalCode,
  };
}

/**
 * 클라이언트 엔진 버전 값을 정규화한다.
 * 저장된 값이 없거나 유효하지 않은 값이면 기본값 "v0.2.1" 로 안전하게 복귀한다.
 *
 * @param {any} val
 * @returns {"v0.2.1" | "v0.2.2-beta"}
 */
export function normalizeClientEngineVersion(val) {
  if (typeof val === "string") {
    const trimmed = val.trim().toLowerCase();
    if (trimmed === "v0.2.2-beta" || trimmed === "v0.2.2" || trimmed === "0.2.2") {
      return "v0.2.2-beta";
    }
  }
  return DEFAULT_CLIENT_ENGINE_VERSION;
}

/**
 * 브라우저 localStorage 에서 개발자가 마지막으로 선택한 스마트 라벨 엔진을 읽어온다.
 * - 개발자(role === "developer")인 경우에만 localStorage 에서 저장된 엔진을 복원한다.
 * - 파일럿 팀원(role === "pilot")인 경우 항상 고정 엔진 "v0.2.2-beta" 를 반환한다.
 * - 권한이 없는 경우(role === "none") localStorage 에 어떤 값이 있더라도 읽지 않고 기본값 "v0.2.1" 을 반환한다.
 *
 * @param {{ getItem?: (key: string) => string | null } | null | undefined} storage
 * @param {{
 *   sessionStatus: string,
 *   sessionEmail?: string | null,
 *   serverBetaEnabled: boolean,
 *   serverRole?: string | null,
 *   pilotEmails?: string[] | null
 * }} authParams
 * @returns {"v0.2.1" | "v0.2.2-beta"}
 */
export function loadRememberedEngineVersion(storage, authParams) {
  const access = resolveSmartLabelClientAccess(authParams);
  if (!access.showUI) {
    return DEFAULT_CLIENT_ENGINE_VERSION;
  }
  if (access.role === "pilot" || !access.canSelectEngine) {
    return "v0.2.2-beta";
  }
  if (!storage || typeof storage.getItem !== "function") {
    return DEFAULT_CLIENT_ENGINE_VERSION;
  }
  try {
    const raw = storage.getItem(SMART_LABEL_ENGINE_STORAGE_KEY);
    return normalizeClientEngineVersion(raw);
  } catch {
    return DEFAULT_CLIENT_ENGINE_VERSION;
  }
}

/**
 * 개발자가 선택한 스마트 라벨 엔진을 브라우저 localStorage 에 저장한다.
 * - 개발자(role === "developer")가 아닌 경우 저장하지 않는다.
 *
 * @param {{ setItem?: (key: string, value: string) => void } | null | undefined} storage
 * @param {any} engineVersion
 * @param {{
 *   sessionStatus: string,
 *   sessionEmail?: string | null,
 *   serverBetaEnabled: boolean,
 *   serverRole?: string | null,
 *   pilotEmails?: string[] | null
 * }} authParams
 * @returns {{ saved: boolean, engineVersion: "v0.2.1" | "v0.2.2-beta" }}
 */
export function saveRememberedEngineVersion(storage, engineVersion, authParams) {
  const access = resolveSmartLabelClientAccess(authParams);
  if (!access.showUI) {
    return { saved: false, engineVersion: DEFAULT_CLIENT_ENGINE_VERSION };
  }
  if (access.role === "pilot" || !access.canSelectEngine) {
    return { saved: false, engineVersion: "v0.2.2-beta" };
  }
  const normalized = normalizeClientEngineVersion(engineVersion);
  if (!storage || typeof storage.setItem !== "function") {
    return { saved: false, engineVersion: normalized };
  }
  try {
    storage.setItem(SMART_LABEL_ENGINE_STORAGE_KEY, normalized);
    return { saved: true, engineVersion: normalized };
  } catch {
    return { saved: false, engineVersion: normalized };
  }
}

/**
 * 스마트 라벨 모달 UI 모드("A" | "B" | "C") 값을 정규화한다.
 * 유효하지 않거나 비어 있으면 항상 일반 모드 "A" 로 복귀한다.
 *
 * @param {any} val
 * @returns {"A" | "B" | "C"}
 */
export function normalizeSmartLabelUiMode(val) {
  if (typeof val === "string") {
    const upper = val.trim().toUpperCase();
    if (upper === "A" || upper === "B" || upper === "C") {
      return upper;
    }
  }
  return DEFAULT_SMART_LABEL_UI_MODE;
}

/**
 * 사용자 이메일별 UI 모드 localStorage 키를 생성한다.
 *
 * @param {string | null | undefined} sessionEmail
 * @returns {string}
 */
export function getSmartLabelUiModeStorageKey(sessionEmail) {
  const norm =
    typeof sessionEmail === "string" && sessionEmail.trim()
      ? sessionEmail.trim().toLowerCase()
      : "anonymous";
  return `${SMART_LABEL_UI_MODE_STORAGE_PREFIX}:${norm}`;
}

/**
 * 브라우저 localStorage 에서 사용자가 마지막으로 사용한 UI 모드("A" | "B" | "C")를 읽어온다.
 * - 최초 진입(저장값 없음) 시 모든 사용자에게 일반 모드 "A" 를 반환한다.
 * - UI 모드 전환은 서버 권한 판정(resolveSmartLabelClientAccess)과 완전히 분리되어 동작한다.
 *
 * @param {{ getItem?: (key: string) => string | null } | null | undefined} storage
 * @param {string | null | undefined} sessionEmail
 * @returns {"A" | "B" | "C"}
 */
export function loadRememberedSmartLabelUiMode(storage, sessionEmail) {
  if (!storage || typeof storage.getItem !== "function") {
    return DEFAULT_SMART_LABEL_UI_MODE;
  }
  try {
    const key = getSmartLabelUiModeStorageKey(sessionEmail);
    const raw = storage.getItem(key);
    return normalizeSmartLabelUiMode(raw);
  } catch {
    return DEFAULT_SMART_LABEL_UI_MODE;
  }
}

/**
 * 사용자가 선택한 UI 모드("A" | "B" | "C")를 브라우저 localStorage 에 저장한다.
 *
 * @param {{ setItem?: (key: string, value: string) => void } | null | undefined} storage
 * @param {any} uiMode
 * @param {string | null | undefined} sessionEmail
 * @returns {{ saved: boolean, uiMode: "A" | "B" | "C" }}
 */
export function saveRememberedSmartLabelUiMode(storage, uiMode, sessionEmail) {
  const normalized = normalizeSmartLabelUiMode(uiMode);
  if (!storage || typeof storage.setItem !== "function") {
    return { saved: false, uiMode: normalized };
  }
  try {
    const key = getSmartLabelUiModeStorageKey(sessionEmail);
    storage.setItem(key, normalized);
    return { saved: true, uiMode: normalized };
  } catch {
    return { saved: false, uiMode: normalized };
  }
}

/**
 * 일반 모드 A의 `[스마트 정리하기]` 원클릭 안전 프리셋 요청 옵션을 생성한다.
 * - 엔진 내부 기본값이나 API 기본값은 변경하지 않고, 일반 모드 A 원클릭 요청에서만
 *   6대 라벨 정리 유닛(함수식, Unit 3-B 눈금, Unit 3-D 원점, Unit 3-E 점 이름, Unit 3-F 축 문자, Unit 3-G 직선 이름)을 켜서 전달한다.
 * - 다중 추상 함수식(Type 2) 및 다중 직선 이름(D3-2)은 감지하되 기본 Hold("hold")로 요청한다.
 * - Safe Shrink 와 그래프 domain 미세 연장은 기본 OFF(false)로 유지한다.
 * - "축 길이도 함께 맞춤"(applyAxis)은 토글 상태를 반영한다 (기본 OFF).
 *
 * @param {{
 *   applyAxis?: boolean,
 *   unit3BServerEnabled?: boolean
 * }} [params]
 */
export function buildModeASafePresetOptions(params = {}) {
  const applyAxis = Boolean(params?.applyAxis);
  const enableUnit3B = params?.unit3BServerEnabled !== false;
  return {
    engineVersion: /** @type {"v0.2.2-beta"} */ ("v0.2.2-beta"),
    applyAxis,
    applySafeShrink: false,
    applyDomainExtension: false,
    enableUnit3B,
    enablePointLabelOverlapFix: true,
    enableAxisLetterOverlapFix: true,
    enableLineNameOverlapFix: true,
    multiAbstractAction: /** @type {"hold"} */ ("hold"),
    lineNameAction: /** @type {"hold"} */ ("hold"),
  };
}

/**
 * 제안 객체(proposal) 내의 모든 후보 미리보기 이미지 URI(원본, 추천, Type 2 Hold/Recommend/Swap, D-3 Hold/Recommend/Swap)를
 * 중복 없이 수집하여 클라이언트 측 이미지 프리로드에 사용한다.
 *
 * @param {any} proposal
 * @returns {string[]}
 */
export function collectProposalCandidateImageUris(proposal) {
  if (!proposal || typeof proposal !== "object") return [];
  const uris = new Set();
  const addFrom = (obj) => {
    if (!obj || typeof obj !== "object") return;
    if (typeof obj.preview?.originalSvgDataUri === "string" && obj.preview.originalSvgDataUri) {
      uris.add(obj.preview.originalSvgDataUri);
    }
    if (typeof obj.preview?.recommendedSvgDataUri === "string" && obj.preview.recommendedSvgDataUri) {
      uris.add(obj.preview.recommendedSvgDataUri);
    }
    const lnVars = obj.lineNameOption?.variants;
    if (lnVars && typeof lnVars === "object") {
      for (const k of ["hold", "recommend", "swap"]) {
        if (lnVars[k]?.preview?.recommendedSvgDataUri) {
          uris.add(lnVars[k].preview.recommendedSvgDataUri);
        }
      }
    }
  };

  addFrom(proposal);
  const maVars = proposal.multiAbstractOption?.variants;
  if (maVars && typeof maVars === "object") {
    for (const k of ["hold", "recommend", "swap"]) {
      addFrom(maVars[k]);
    }
  }
  return Array.from(uris);
}

/**
 * 비동기 추천 응답이 최신 요청인지 검증한다 (요청 ID 불일치 또는 입력 코드 변경 시 이전 응답 무시).
 *
 * @param {{
 *   requestSeq: number,
 *   latestRequestSeq: number,
 *   requestRawInput: string,
 *   currentRawInput: string
 * }} params
 * @returns {boolean}
 */
export function isStaleSmartLabelResponse(params) {
  if (!params || typeof params !== "object") return true;
  if (params.requestSeq !== params.latestRequestSeq) return true;
  if (params.requestRawInput !== params.currentRawInput) return true;
  return false;
}


// ─────────────────────────────────────────────────────────────────────────────
// 업데이트 안내 팝업 (최대 2회 별도 방문 표시 + 동일 세션 중복 방지 + 다시 보지 않기)
// ─────────────────────────────────────────────────────────────────────────────

export const SMART_LABEL_UPDATE_NOTICE_VERSION = "v0.2.2-r2-d3-20261108";
export const SMART_LABEL_UPDATE_NOTICE_STORAGE_PREFIX = "kosmart_update_notice_state";
export const SMART_LABEL_UPDATE_NOTICE_SESSION_PREFIX = "kosmart_update_notice_session";
export const MAX_SMART_LABEL_UPDATE_NOTICE_VIEWS = 2;

/**
 * 민감한 이메일 원문이나 토큰을 브라우저 스토리지 키에 직접 노출하지 않기 위해
 * 정규화된 이메일로부터 비가역 해시 식별자(u_<8자리 hex>)를 생성한다.
 *
 * @param {string | null | undefined} sessionEmail
 * @returns {string}
 */
export function computeUpdateNoticeUserKey(sessionEmail) {
  const norm =
    typeof sessionEmail === "string" && sessionEmail.trim()
      ? sessionEmail.trim().toLowerCase()
      : "";
  if (!norm) return "u_anon";
  let h = 2166136261;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `u_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * 사용자별 · 업데이트 버전별 localStorage 키를 생성한다.
 *
 * @param {string | null | undefined} sessionEmail
 * @param {string} [version]
 * @returns {string}
 */
export function getUpdateNoticeLocalStorageKey(
  sessionEmail,
  version = SMART_LABEL_UPDATE_NOTICE_VERSION
) {
  const ver =
    typeof version === "string" && version.trim()
      ? version.trim()
      : SMART_LABEL_UPDATE_NOTICE_VERSION;
  return `${SMART_LABEL_UPDATE_NOTICE_STORAGE_PREFIX}:${ver}:${computeUpdateNoticeUserKey(sessionEmail)}`;
}

/**
 * 사용자별 · 업데이트 버전별 sessionStorage 키를 생성한다.
 *
 * @param {string | null | undefined} sessionEmail
 * @param {string} [version]
 * @returns {string}
 */
export function getUpdateNoticeSessionStorageKey(
  sessionEmail,
  version = SMART_LABEL_UPDATE_NOTICE_VERSION
) {
  const ver =
    typeof version === "string" && version.trim()
      ? version.trim()
      : SMART_LABEL_UPDATE_NOTICE_VERSION;
  return `${SMART_LABEL_UPDATE_NOTICE_SESSION_PREFIX}:${ver}:${computeUpdateNoticeUserKey(sessionEmail)}`;
}

/**
 * 허용된 사용자가 메인 편집기에 진입했을 때 업데이트 안내 팝업 표시 여부를 판정하고,
 * 표시 대상인 경우 방문 횟수(+1)와 현재 세션 표시 기록을 안전하게 저장한다.
 * - 비로그인 또는 스마트 라벨 미허용 사용자는 절대 표시하지 않는다.
 * - 다른 모달이 열려 있을 때는 표시하지 않는다.
 * - 동일 브라우저 세션 내 새로고침/재진입 시 중복 표시하지 않는다.
 * - 최대 2회 별도 방문까지만 표시하며, 3번째 방문부터는 자동 숨김 처리한다.
 * - [다시 보지 않기]가 설정된 경우 즉시 숨김 처리한다.
 * - 스토리지 접근 예외 발생 시에도 편집기 동작을 방해하지 않는다.
 *
 * @param {{
 *   localStorage?: { getItem?: (k: string) => string | null, setItem?: (k: string, v: string) => void } | null,
 *   sessionStorage?: { getItem?: (k: string) => string | null, setItem?: (k: string, v: string) => void } | null,
 *   sessionStatus: string,
 *   sessionEmail?: string | null,
 *   serverBetaEnabled: boolean,
 *   serverRole?: string | null,
 *   pilotEmails?: string[] | null,
 *   hasOtherModalOpen?: boolean,
 *   version?: string,
 *   maxViews?: number
 * }} params
 */
export function evaluateAndRecordSmartLabelUpdateNotice(params) {
  const blocked = (reason, shownCount = 0, dismissedPermanently = false) => ({
    shouldShow: false,
    reason,
    shownCount,
    dismissedPermanently,
  });

  if (!params || typeof params !== "object") {
    return blocked("invalid-params");
  }

  const access = resolveSmartLabelClientAccess({
    sessionStatus: params.sessionStatus,
    sessionEmail: params.sessionEmail,
    serverBetaEnabled: params.serverBetaEnabled,
    serverRole: params.serverRole,
    pilotEmails: params.pilotEmails,
  });

  if (!access.showUI) {
    return blocked("unauthorized");
  }

  if (params.hasOtherModalOpen) {
    return blocked("other-modal-open");
  }

  const version =
    typeof params.version === "string" && params.version.trim()
      ? params.version.trim()
      : SMART_LABEL_UPDATE_NOTICE_VERSION;
  const maxViews =
    typeof params.maxViews === "number" && params.maxViews > 0
      ? params.maxViews
      : MAX_SMART_LABEL_UPDATE_NOTICE_VIEWS;

  const lsKey = getUpdateNoticeLocalStorageKey(params.sessionEmail, version);
  const ssKey = getUpdateNoticeSessionStorageKey(params.sessionEmail, version);

  let shownCount = 0;
  let dismissedPermanently = false;
  try {
    if (params.localStorage && typeof params.localStorage.getItem === "function") {
      const raw = params.localStorage.getItem(lsKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          shownCount =
            typeof parsed.shownCount === "number" && Number.isFinite(parsed.shownCount)
              ? Math.max(0, Math.floor(parsed.shownCount))
              : 0;
          dismissedPermanently = Boolean(parsed.dismissedPermanently);
        }
      }
    }
  } catch {
    // 스토리지 읽기 실패 시 기본값 유지 (편집기 보호)
  }

  if (dismissedPermanently) {
    return blocked("dismissed-permanently", shownCount, true);
  }

  if (shownCount >= maxViews) {
    return blocked("max-views-reached", shownCount, false);
  }

  let alreadyShownInSession = false;
  try {
    if (params.sessionStorage && typeof params.sessionStorage.getItem === "function") {
      alreadyShownInSession = params.sessionStorage.getItem(ssKey) === "1";
    }
  } catch {
    // 스토리지 읽기 실패 무시
  }

  if (alreadyShownInSession) {
    return blocked("already-shown-this-session", shownCount, false);
  }

  const nextShownCount = shownCount + 1;
  try {
    if (params.localStorage && typeof params.localStorage.setItem === "function") {
      params.localStorage.setItem(
        lsKey,
        JSON.stringify({
          shownCount: nextShownCount,
          dismissedPermanently: false,
        })
      );
    }
  } catch {
    // 스토리지 쓰기 실패 무시
  }

  try {
    if (params.sessionStorage && typeof params.sessionStorage.setItem === "function") {
      params.sessionStorage.setItem(ssKey, "1");
    }
  } catch {
    // 스토리지 쓰기 실패 무시
  }

  return {
    shouldShow: true,
    reason: "shown",
    shownCount: nextShownCount,
    dismissedPermanently: false,
  };
}

/**
 * 사용자가 [다시 보지 않기]를 선택했을 때 해당 사용자·버전에 대해 영구 숨김 상태를 기록한다.
 *
 * @param {{ setItem?: (k: string, v: string) => void } | null | undefined} localStorage
 * @param {{ setItem?: (k: string, v: string) => void } | null | undefined} sessionStorage
 * @param {string | null | undefined} sessionEmail
 * @param {string} [version]
 */
export function dismissSmartLabelUpdateNoticePermanently(
  localStorage,
  sessionStorage,
  sessionEmail,
  version = SMART_LABEL_UPDATE_NOTICE_VERSION
) {
  const lsKey = getUpdateNoticeLocalStorageKey(sessionEmail, version);
  const ssKey = getUpdateNoticeSessionStorageKey(sessionEmail, version);
  let saved = false;
  try {
    if (localStorage && typeof localStorage.setItem === "function") {
      localStorage.setItem(
        lsKey,
        JSON.stringify({
          shownCount: MAX_SMART_LABEL_UPDATE_NOTICE_VIEWS,
          dismissedPermanently: true,
        })
      );
      saved = true;
    }
  } catch {
    // 스토리지 예외 무시
  }
  try {
    if (sessionStorage && typeof sessionStorage.setItem === "function") {
      sessionStorage.setItem(ssKey, "1");
    }
  } catch {
    // 스토리지 예외 무시
  }
  return { dismissedPermanently: true, saved };
}
