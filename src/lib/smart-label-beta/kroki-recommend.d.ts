export const DEVELOPER_BETA_EMAIL: string;
export const DEFAULT_ENGINE_VERSION: "v0.2.1";
export const SUPPORTED_ENGINE_VERSIONS: Array<"v0.2.1" | "v0.2.2-beta">;
export const MAX_TIKZ_INPUT_LENGTH: number;
export const MAX_SAMPLES_VALUE: number;
export const DEFAULT_KROKI_TIMEOUT_MS: number;

export type SmartLabelEngineVersion = "v0.2.1" | "v0.2.2-beta";

export function normalizeEngineVersion(engineVersion?: any): SmartLabelEngineVersion;

export function computeInputHash(rawInput: string): string;

export function isSmartLabelBetaServerEnabled(opts?: {
  env?: Record<string, string | undefined>;
}): { enabled: boolean; reason: string };

export function verifyDeveloperSession(session: any): {
  allowed: boolean;
  httpStatus: number;
  code: string;
  email?: string;
  error?: string;
};

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

export interface SmartLabelBetaProposal {
  engineVersion?: SmartLabelEngineVersion;
  algorithmVersion: string;
  ok: boolean;
  status: "recommended" | "unchanged" | "unsupported" | "reverted" | "failed";
  reasonCode: string | null;
  message: string;
  canApply: boolean;
  verified: boolean;
  applyAxisRequested: boolean;
  axisOption: AxisOptionInfo;
  collisionDiagnostics: CollisionDiagnosticsSummary | null;
  inputHash: string;
  originalCode: string;
  recommendedCode: string;
  figureType: { type: string; hasAxes: boolean; reason: string } | null;
  movedCount: number;
  heldCount: number;
  labelDecisions: SmartLabelDecisionSummary[];
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
    params?: any;
    verify?: boolean;
    applyAxis?: boolean;
    engineVersion?: SmartLabelEngineVersion;
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
