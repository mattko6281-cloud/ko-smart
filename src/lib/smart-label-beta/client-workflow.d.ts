export const DEVELOPER_BETA_EMAIL: "mattko6281@gmail.com";
export const SMART_LABEL_BACKUP_STORAGE_KEY: string;
export const SMART_LABEL_ENGINE_STORAGE_KEY: string;
export const DEFAULT_CLIENT_ENGINE_VERSION: "v0.2.1";
export const SUPPORTED_CLIENT_ENGINE_VERSIONS: Array<"v0.2.1" | "v0.2.2-beta">;

export interface SmartLabelBackupSnapshot {
  originalCode: string;
  appliedRecommendedCode: string;
  inputHash: string | null;
  multiAbstractAction?: "hold" | "recommend" | "swap" | null;
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

export function resolveActiveProposalForMultiAbstractChoice(
  proposal: any,
  selectedAction?: "hold" | "recommend" | "swap"
): any;

export function evaluateProposalApplicability(
  proposal: any,
  currentRawInput: string,
  opts?: { multiAbstractAction?: "hold" | "recommend" | "swap" }
): {
  allowed: boolean;
  reasonCode: string;
  reason: string;
};

export function applyApprovedProposal(
  proposal: any,
  currentRawInput: string,
  opts?: { multiAbstractAction?: "hold" | "recommend" | "swap" }
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
