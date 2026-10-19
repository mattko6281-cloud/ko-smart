// KO-SMART v0.2.1 베타 — 클라이언트 UI 권한 판정 및 추천 승인·독립 백업·원본 복원 순수 상태 전이 모듈
// (브라우저 UI 컴포넌트와 단위 테스트 양쪽에서 동일하게 재사용)

export const DEVELOPER_BETA_EMAIL = "mattko6281@gmail.com";
export const SMART_LABEL_BACKUP_STORAGE_KEY = "kosmart_smart_label_backup_v021";

/**
 * 클라이언트에서 베타 버튼 및 UI를 렌더링할지 판정한다.
 * - 반드시 인증 완료(status === "authenticated") 상태여야 하며
 * - 세션 이메일이 mattko6281@gmail.com 과 정확히 일치해야 하고
 * - 서버 측 베타 활성화 확인(serverBetaEnabled === true)이 완료된 경우에만 true 를 반환한다.
 * - 개발 모드(isDev) 우회는 절대 허용하지 않는다.
 *
 * @param {{
 *   sessionStatus: "authenticated" | "loading" | "unauthenticated" | string,
 *   sessionEmail?: string | null,
 *   serverBetaEnabled: boolean
 * }} params
 */
export function shouldShowSmartLabelBetaUI({ sessionStatus, sessionEmail, serverBetaEnabled }) {
  if (sessionStatus !== "authenticated") return false;
  if (!serverBetaEnabled) return false;
  if (!sessionEmail || typeof sessionEmail !== "string") return false;
  return sessionEmail.trim().toLowerCase() === DEVELOPER_BETA_EMAIL;
}

/**
 * 현재 에디터 코드와 추천 결과 원본을 비교해 적용 가능 여부를 판정한다.
 * - 검증되지 않았거나(verified !== true), canApply !== true 인 결과는 차단한다.
 * - 추천 계산 중 또는 미리보기 중 에디터 내용이 변경된 경우(currentRawInput !== proposal.originalCode) 차단한다.
 *
 * @param {any} proposal
 * @param {string} currentRawInput
 */
export function evaluateProposalApplicability(proposal, currentRawInput) {
  if (!proposal || typeof proposal !== "object") {
    return { allowed: false, reasonCode: "no-proposal", reason: "추천 결과가 없습니다." };
  }
  if (proposal.originalCode !== currentRawInput) {
    return {
      allowed: false,
      reasonCode: "input-changed",
      reason: "추천 계산 도중 또는 미리보기 중에 에디터 코드가 변경되어 이전 추천을 적용할 수 없습니다. 다시 자동 정렬을 실행해 주세요.",
    };
  }
  if (!proposal.verified) {
    return {
      allowed: false,
      reasonCode: "unverified-blocked",
      reason: "2차 렌더링 및 안전성 검증을 통과하지 않은 결과는 적용할 수 없습니다.",
    };
  }
  if (!proposal.canApply || proposal.status !== "recommended") {
    return {
      allowed: false,
      reasonCode: "not-applicable",
      reason: proposal.message || "적용 가능한 추천 변경 사항이 없습니다.",
    };
  }
  if (!proposal.recommendedCode || proposal.recommendedCode === proposal.originalCode) {
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
 */
export function applyApprovedProposal(proposal, currentRawInput) {
  const check = evaluateProposalApplicability(proposal, currentRawInput);
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
    appliedRecommendedCode: proposal.recommendedCode,
    inputHash: proposal.inputHash || null,
    appliedAt: Date.now(),
  };
  return {
    applied: true,
    reasonCode: "applied",
    newRawInput: proposal.recommendedCode,
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
