export const DEVELOPER_BETA_EMAIL: "mattko6281@gmail.com";
export const SMART_LABEL_BACKUP_STORAGE_KEY: string;
export const SMART_LABEL_ENGINE_STORAGE_KEY: string;
export const SMART_LABEL_UI_MODE_STORAGE_PREFIX: string;
export const DEFAULT_CLIENT_ENGINE_VERSION: "v0.2.1";
export const SUPPORTED_CLIENT_ENGINE_VERSIONS: Array<"v0.2.1" | "v0.2.2-beta">;
export const DEFAULT_SMART_LABEL_UI_MODE: "A";
export const SUPPORTED_SMART_LABEL_UI_MODES: Array<"A" | "B" | "C">;

export type SmartLabelUiMode = "A" | "B" | "C";

export interface SmartLabelBackupSnapshot {
  originalCode: string;
  appliedRecommendedCode: string;
  inputHash: string | null;
  multiAbstractAction?: "hold" | "recommend" | "swap" | null;
  lineNameAction?: "hold" | "recommend" | "swap" | null;
  appliedAt: number;
}

export interface SmartLabelClientAccessParams {
  sessionStatus: string;
  sessionEmail?: string | null;
  serverBetaEnabled: boolean;
  serverRole?: "developer" | "pilot" | "none" | string | null;
  pilotEmails?: string[] | null;
  unit3BServerEnabled?: boolean;
}

export interface SmartLabelClientAccessResult {
  showUI: boolean;
  role: "developer" | "pilot" | "none";
  canSelectEngine: boolean;
  effectiveEngineVersion: "v0.2.1" | "v0.2.2-beta";
  defaultEnableUnit3B: boolean;
  defaultApplyAxis: boolean;
  unit3BServerEnabled: boolean;
}

export function resolveSmartLabelClientAccess(
  params: SmartLabelClientAccessParams
): SmartLabelClientAccessResult;

export function shouldShowSmartLabelBetaUI(params: SmartLabelClientAccessParams): boolean;

export function resolveActiveProposalForLineNameChoice(
  proposal: any,
  selectedLineNameAction?: "hold" | "recommend" | "swap"
): any;

export function resolveActiveProposalForMultiAbstractChoice(
  proposal: any,
  selectedAction?: "hold" | "recommend" | "swap",
  selectedLineNameAction?: "hold" | "recommend" | "swap"
): any;

export function evaluateProposalApplicability(
  proposal: any,
  currentRawInput: string,
  opts?: { multiAbstractAction?: "hold" | "recommend" | "swap"; lineNameAction?: "hold" | "recommend" | "swap" }
): {
  allowed: boolean;
  reasonCode: string;
  reason: string;
};

export function applyApprovedProposal(
  proposal: any,
  currentRawInput: string,
  opts?: { multiAbstractAction?: "hold" | "recommend" | "swap"; lineNameAction?: "hold" | "recommend" | "swap" }
): {
  applied: boolean;
  reasonCode: string;
  error?: string;
  newRawInput: string;
  backup: SmartLabelBackupSnapshot | null;
};

export function restoreOriginalFromBackup(
  backup: SmartLabelBackupSnapshot | null,
  currentRawInput: string,
  opts?: { confirmedOverwrite?: boolean }
): {
  restored: boolean;
  requiresConfirmation: boolean;
  modifiedAfterApply?: boolean;
  reasonCode: string;
  message: string;
  newRawInput: string;
};

export function normalizeClientEngineVersion(val: any): "v0.2.1" | "v0.2.2-beta";

export function loadRememberedEngineVersion(
  storage: { getItem?: (key: string) => string | null } | null | undefined,
  authParams: SmartLabelClientAccessParams
): "v0.2.1" | "v0.2.2-beta";

export function saveRememberedEngineVersion(
  storage: { setItem?: (key: string, value: string) => void } | null | undefined,
  engineVersion: any,
  authParams: SmartLabelClientAccessParams
): {
  saved: boolean;
  engineVersion: "v0.2.1" | "v0.2.2-beta";
};

export function normalizeSmartLabelUiMode(val: any): SmartLabelUiMode;

export function getSmartLabelUiModeStorageKey(sessionEmail?: string | null): string;

export function loadRememberedSmartLabelUiMode(
  storage: { getItem?: (key: string) => string | null } | null | undefined,
  sessionEmail?: string | null
): SmartLabelUiMode;

export function saveRememberedSmartLabelUiMode(
  storage: { setItem?: (key: string, value: string) => void } | null | undefined,
  uiMode: any,
  sessionEmail?: string | null
): {
  saved: boolean;
  uiMode: SmartLabelUiMode;
};

export function buildModeASafePresetOptions(params?: {
  applyAxis?: boolean;
  unit3BServerEnabled?: boolean;
}): {
  engineVersion: "v0.2.2-beta";
  applyAxis: boolean;
  applySafeShrink: boolean;
  applyDomainExtension: boolean;
  enableUnit3B: boolean;
  enablePointLabelOverlapFix: boolean;
  enableAxisLetterOverlapFix: boolean;
  enableLineNameOverlapFix: boolean;
  multiAbstractAction: "hold";
  lineNameAction: "hold";
};

export function collectProposalCandidateImageUris(proposal: any): string[];

export function isStaleSmartLabelResponse(params: {
  requestSeq: number;
  latestRequestSeq: string | number;
  requestRawInput: string;
  currentRawInput: string;
}): boolean;

export const SMART_LABEL_UPDATE_NOTICE_VERSION: string;
export const SMART_LABEL_UPDATE_NOTICE_STORAGE_PREFIX: string;
export const SMART_LABEL_UPDATE_NOTICE_SESSION_PREFIX: string;
export const MAX_SMART_LABEL_UPDATE_NOTICE_VIEWS: number;

export function computeUpdateNoticeUserKey(sessionEmail?: string | null): string;

export function getUpdateNoticeLocalStorageKey(
  sessionEmail?: string | null,
  version?: string
): string;

export function getUpdateNoticeSessionStorageKey(
  sessionEmail?: string | null,
  version?: string
): string;

export function evaluateAndRecordSmartLabelUpdateNotice(params: {
  localStorage?: {
    getItem?: (k: string) => string | null;
    setItem?: (k: string, v: string) => void;
  } | null;
  sessionStorage?: {
    getItem?: (k: string) => string | null;
    setItem?: (k: string, v: string) => void;
  } | null;
  sessionStatus: string;
  sessionEmail?: string | null;
  serverBetaEnabled: boolean;
  serverRole?: string | null;
  pilotEmails?: string[] | null;
  hasOtherModalOpen?: boolean;
  version?: string;
  maxViews?: number;
}): {
  shouldShow: boolean;
  reason: string;
  shownCount: number;
  dismissedPermanently: boolean;
};

export function dismissSmartLabelUpdateNoticePermanently(
  localStorage?: { setItem?: (k: string, v: string) => void } | null,
  sessionStorage?: { setItem?: (k: string, v: string) => void } | null,
  sessionEmail?: string | null,
  version?: string
): {
  dismissedPermanently: boolean;
  saved: boolean;
};
