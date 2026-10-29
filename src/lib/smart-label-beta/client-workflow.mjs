// KO-SMART v0.2.1 / v0.2.2 베타 — 클라이언트 UI 권한 판정(개발자 vs 파일럿 팀원) 및 추천 승인·독립 백업·원본 복원 순수 상태 전이 모듈
// (브라우저 UI 컴포넌트와 단위 테스트 양쪽에서 동일하게 재사용)

export const DEVELOPER_BETA_EMAIL = "mattko6281@gmail.com";
export const SMART_LABEL_BACKUP_STORAGE_KEY = "kosmart_smart_label_backup_v021";
export const SMART_LABEL_ENGINE_STORAGE_KEY = "kosmart_smart_label_engine_version";
export const DEFAULT_CLIENT_ENGINE_VERSION = "v0.2.1";
export const SUPPORTED_CLIENT_ENGINE_VERSIONS = ["v0.2.1", "v0.2.2-beta"];

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
export function resolveActiveProposalForMultiAbstractChoice(proposal, selectedAction) {
  if (!proposal || typeof proposal !== "object") return proposal;
  const maOpt = proposal.multiAbstractOption;
  if (!maOpt || !maOpt.detected || !maOpt.variants) return proposal;

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
  if (!chosenVariant) return proposal;

  return {
    ...proposal,
    ...chosenVariant,
    multiAbstractActionRequested: effectiveAction,
    multiAbstractOption: {
      ...maOpt,
      selectedAction: effectiveAction,
    },
  };
}

/**
 * 현재 에디터 코드와 추천 결과 원본을 비교해 적용 가능 여부를 판정한다.
 * - 검증되지 않았거나(verified !== true), canApply !== true 인 결과는 차단한다.
 * - 추천 계산 중 또는 미리보기 중 에디터 내용이 변경된 경우(currentRawInput !== proposal.originalCode) 차단한다.
 *
 * @param {any} proposal
 * @param {string} currentRawInput
 * @param {{multiAbstractAction?: "hold" | "recommend" | "swap"}} [opts]
 */
export function evaluateProposalApplicability(proposal, currentRawInput, opts = {}) {
  if (!proposal || typeof proposal !== "object") {
    return { allowed: false, reasonCode: "no-proposal", reason: "추천 결과가 없습니다." };
  }
  const activeProposal = resolveActiveProposalForMultiAbstractChoice(
    proposal,
    opts?.multiAbstractAction ?? proposal?.multiAbstractOption?.selectedAction
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
 * @param {{multiAbstractAction?: "hold" | "recommend" | "swap"}} [opts]
 */
export function applyApprovedProposal(proposal, currentRawInput, opts = {}) {
  const activeProposal = resolveActiveProposalForMultiAbstractChoice(
    proposal,
    opts?.multiAbstractAction ?? proposal?.multiAbstractOption?.selectedAction
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
