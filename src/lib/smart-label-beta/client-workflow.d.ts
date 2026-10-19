export const DEVELOPER_BETA_EMAIL: "mattko6281@gmail.com";
export const SMART_LABEL_BACKUP_STORAGE_KEY: string;

export interface SmartLabelBackupSnapshot {
  originalCode: string;
  appliedRecommendedCode: string;
  inputHash: string | null;
  appliedAt: number;
}

export function shouldShowSmartLabelBetaUI(params: {
  sessionStatus: string;
  sessionEmail?: string | null;
  serverBetaEnabled: boolean;
}): boolean;

export function evaluateProposalApplicability(
  proposal: any,
  currentRawInput: string
): {
  allowed: boolean;
  reasonCode: string;
  reason: string;
};

export function applyApprovedProposal(
  proposal: any,
  currentRawInput: string
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
