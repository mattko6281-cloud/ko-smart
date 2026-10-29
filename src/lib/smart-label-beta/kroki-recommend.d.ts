export const DEVELOPER_BETA_EMAIL: string;
export const DEFAULT_ENGINE_VERSION: "v0.2.1";
export const SUPPORTED_ENGINE_VERSIONS: Array<"v0.2.1" | "v0.2.2-beta">;
export const MAX_TIKZ_INPUT_LENGTH: number;
export const MAX_SAMPLES_VALUE: number;
export const DEFAULT_KROKI_TIMEOUT_MS: number;

export type SmartLabelEngineVersion = "v0.2.1" | "v0.2.2-beta";
export type SmartLabelAccessRole = "developer" | "pilot" | "none";

export function normalizeEngineVersion(engineVersion?: any): SmartLabelEngineVersion;

export function computeInputHash(rawInput: string): string;

export function parsePilotEmails(rawVal?: any): string[];

export function isSmartLabelBetaServerEnabled(opts?: {
  env?: Record<string, string | undefined>;
}): { enabled: boolean; reason: string };

export function isUnit3BServerEnabled(opts?: {
  env?: Record<string, string | undefined>;
}): { enabled: boolean; reason: string };

export function isUnit3DServerEnabled(opts?: {
  env?: Record<string, string | undefined>;
}): { enabled: boolean; reason: string };

export function verifyDeveloperSession(
  session: any,
  opts?: { env?: Record<string, string | undefined> }
): {
  allowed: boolean;
  httpStatus: number;
  code: string;
  role: SmartLabelAccessRole;
  email?: string;
  canSelectEngine?: boolean;
  defaultEngineVersion?: SmartLabelEngineVersion;
  defaultEnableUnit3B?: boolean;
  defaultApplyAxis?: boolean;
  error?: string;
};

export const verifySmartLabelAccess: typeof verifyDeveloperSession;

export function processInputLikeKoSmart(code: string): string;
export function encodeKroki(text: string): string;

export interface SmartLabelDecisionSummary {
  id: string;
  label: string;
  autoModified: boolean;
  selectedEngine: string;
  agreedEngines: string[];
  how: string | null;
  confirmedAssignment: boolean;
  shift: [number, number];
  movedPt: number;
  nonMoveCategory: string | null;
  nonMoveCode: string | null;
  holdReason: string | null;
  selectionReason: string;
  hasPreExistingCollision?: boolean;
  hasRemainingCollision?: boolean;
  collisionDescriptions?: string[];
}

export interface AxisOptionInfo {
  requested: boolean;
  applied: boolean;
  status: "disabled" | "not-needed" | "pending-verification" | "applied" | "blocked-unsafe";
  modeNote: string;
  x: { old: [number, number]; new: [number, number]; changed: boolean } | null;
  y: { old: [number, number]; new: [number, number]; changed: boolean } | null;
  editsCount: number;
  message: string;
}

export interface DomainExtensionDecisionItem {
  nodeId: string;
  label: string;
  strokeIndex: number | null;
  plotExpr: string | null;
  action: "extend" | "hold";
  triggerType: "gap-closure" | "congestion-escape" | null;
  origDomain: [number, number] | null;
  newDomain: [number, number] | null;
  arcLengthPt: number;
  domainRatioPct: number;
  origOwnGapPt: number | null;
  newOwnGapPt: number | null;
  origMinOtherPt: number | null;
  newMinOtherPt: number | null;
  origShift: [number, number];
  newShift: [number, number];
  holdCode: string | null;
  reason: string;
}

export interface DomainExtensionOptionInfo {
  requested: boolean;
  applied: boolean;
  status: "disabled" | "not-needed" | "pending-verification" | "applied" | "blocked-unsafe";
  modeNote: string;
  editsCount: number;
  message: string;
  items: DomainExtensionDecisionItem[];
}

export interface CollisionAuditItem {
  key: string;
  category: string;
  contactKind?: "true-ink-collision" | "bbox-only-contact" | "natural-endpoint-proximity";
  severity: "collision" | "warning";
  autoMoveTarget: boolean;
  nodeId: string;
  nodeLabel: string;
  nodeRole: string;
  otherNodeId?: string;
  otherNodeLabel?: string;
  otherNodeRole?: string;
  targetType: string;
  strokeIndex?: number;
  strokeKind?: string;
  clearancePt?: number;
  origClearancePt?: number;
  thresholdPt?: number;
  endGapPt?: number | null;
  description: string;
  status?: string;
  reasonCode?: string;
  reason?: string;
  resolutionNote?: string;
}

export interface UnmeasuredNodeInfo {
  id: string;
  label: string;
  role: string;
  confidence: string;
  reasons: string[];
  reason?: string;
}

export interface CollisionDiagnosticsSummary {
  engineVersion?: SmartLabelEngineVersion;
  safetyPassed: boolean;
  measurementComplete: boolean;
  allClear: boolean;
  allCollisionsResolved: boolean;
  hasUnresolvedCollisions: boolean;
  movedNodeHasCollision: boolean;
  counts: {
    origTotal: number;
    finalTotal: number;
    resolved: number;
    preExistingUnresolved: number;
    newlyIntroduced: number;
    unmeasuredNodes: number;
    unverifiableItems: number;
    origTrueInk?: number;
    finalTrueInk?: number;
    origBboxOnly?: number;
    finalBboxOnly?: number;
    origNaturalEndpoint?: number;
    finalNaturalEndpoint?: number;
    unmovedGeneralNodeOverlaps?: number;
  };
  resolvedCollisions: CollisionAuditItem[];
  preExistingUnresolvedCollisions: CollisionAuditItem[];
  newlyIntroducedCollisions: CollisionAuditItem[];
  naturalEndpointContacts?: any[];
  unmeasuredNodes: UnmeasuredNodeInfo[];
  unverifiableItems: Array<{
    key: string;
    nodeId: string;
    nodeLabel: string;
    nodeRole: string;
    confidence: string;
    reason: string;
  }>;
  origAudit?: any;
  finalAudit?: any;
}

export interface SmartLabelTickDecisionSummary {
  id: string;
  label: string;
  role: string;
  tickAxis: "x" | "y";
  axisKind?: "x-tick" | "y-tick";
  tickPointPt: [number, number];
  action: "keep" | "move-tick" | "hold-no-safe-tick-candidate";
  nonMoveCode?: string;
  nonMoveCategory?: string | null;
  autoModified: boolean;
  selectedEngine?: string;
  tier?: number;
  oldShift: [number, number];
  origShift?: [number, number];
  newShift: [number, number];
  shift?: [number, number];
  deltaShiftPt: [number, number];
  origClearancePt: number;
  finalClearancePt: number;
  dTickPt?: number;
  score?: number;
  reason: string;
  selectionReason?: string;
  holdReason?: string | null;
}

export interface SmartLabelOriginDecisionSummary {
  id: string;
  label: string;
  role: "origin";
  action: "keep" | "move-origin" | "hold-no-safe-quadrant" | "hold-custom-origin-options";
  nonMoveCode?: string | null;
  nonMoveCategory?: string | null;
  autoModified: boolean;
  selectedEngine?: string;
  priorityRank?: number;
  origAnchor: string | null;
  newAnchor: string | null;
  origClearancePt?: number;
  finalClearancePt?: number;
  origNodeGapPt?: number;
  finalNodeGapPt?: number;
  reason: string;
  selectionReason?: string;
  holdReason?: string | null;
}

export interface SmartLabelBetaProposal {
  engineVersion?: SmartLabelEngineVersion;
  algorithmVersion: string;
  enableUnit3BRequested?: boolean;
  unit3BEnabled?: boolean;
  unit3BServerEnabled?: boolean;
  unit3BDisabledReason?: string | null;
  enableUnit3DRequested?: boolean;
  unit3DEnabled?: boolean;
  unit3DServerEnabled?: boolean;
  unit3DDisabledReason?: string | null;
  ok: boolean;
  status: "recommended" | "unchanged" | "unsupported" | "reverted" | "failed";
  reasonCode: string | null;
  message: string;
  canApply: boolean;
  verified: boolean;
  applyAxisRequested: boolean;
  axisOption: AxisOptionInfo;
  applyDomainExtensionRequested?: boolean;
  domainExtensionOption?: DomainExtensionOptionInfo;
  collisionDiagnostics: CollisionDiagnosticsSummary | null;
  inputHash: string;
  originalCode: string;
  recommendedCode: string;
  figureType: { type: string; hasAxes: boolean; reason: string } | null;
  movedCount: number;
  fnMovedCount?: number;
  tickMovedCount?: number;
  tickHeldCount?: number;
  originMovedCount?: number;
  originHeldCount?: number;
  heldCount: number;
  labelDecisions: SmartLabelDecisionSummary[];
  tickDecisions?: SmartLabelTickDecisionSummary[];
  originDecisions?: SmartLabelOriginDecisionSummary[];
  placements: any[];
  shiftReport: any[];
  preservation: any;
  verification: {
    compiled: boolean;
    svgMeasured: boolean;
    collisionOk: boolean;
    issues: string[];
    labelDetails?: any[];
  } | null;
  preview: {
    originalSvgDataUri: string | null;
    recommendedSvgDataUri: string | null;
  };
  warnings: string[];
  errors: string[];
}

export type SmartLabelBetaResponse = SmartLabelBetaProposal;

export function recommendSmartLabelBeta(
  rawInput: string,
  opts?: {
    krokiBaseUrl?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    env?: Record<string, string | undefined>;
    params?: any;
    verify?: boolean;
    applyAxis?: boolean;
    applyDomainExtension?: boolean;
    engineVersion?: SmartLabelEngineVersion;
    enableUnit3B?: boolean;
    enableUnit3D?: boolean;
  }
): Promise<SmartLabelBetaProposal>;

export function handleSmartLabelGet(deps: {
  getSession: () => Promise<any>;
  env?: Record<string, string | undefined>;
}): Promise<{ httpStatus: number; body: any }>;

export function handleSmartLabelPost(
  requestBody: any,
  deps: {
    getSession: () => Promise<any>;
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    krokiBaseUrl?: string;
    timeoutMs?: number;
  }
): Promise<{ httpStatus: number; body: SmartLabelBetaProposal | any }>;
