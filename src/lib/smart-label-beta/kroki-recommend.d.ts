export const DEVELOPER_BETA_EMAIL: string;
export const DEFAULT_ENGINE_VERSION: "v0.2.1";
export const SUPPORTED_ENGINE_VERSIONS: Array<"v0.2.1" | "v0.2.2-beta">;
export const MAX_TIKZ_INPUT_LENGTH: number;
export const MAX_SAMPLES_VALUE: number;
export const DEFAULT_KROKI_TIMEOUT_MS: number;

export type SmartLabelEngineVersion = "v0.2.1" | "v0.2.2-beta";
export type SmartLabelAccessRole = "developer" | "pilot" | "none";
export type MultiAbstractActionMode = "hold" | "recommend" | "swap";

export function normalizeEngineVersion(engineVersion?: any): SmartLabelEngineVersion;
export function normalizeMultiAbstractAction(action?: any): MultiAbstractActionMode;

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
  matchedStroke?: number | null;
  strokeKind?: string | null;
  plotExpr?: string | null;
  curveShape?: string | null;
  isMultiAbstractPair?: boolean;
  multiAbstractAction?: MultiAbstractActionMode | null;
  step2ClassificationType?: string | null;
  step2ClassificationCode?: string | null;
  step2MathematicallyProven?: boolean;
  step2RequiresUserApproval?: boolean;
  step2Signals?: string[];
  step2RawDistMarginPt?: number | null;
  step2RecommendedStroke?: number | null;
  step2SwappedStroke?: number | null;
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

export interface SafeShrinkDirectionSummary {
  direction: "left" | "right" | "bottom" | "top";
  action: "shrink" | "extend" | "hold";
  origMath: number;
  newMath: number;
  origPt: number;
  newPt: number;
  contentBoundMath: number;
  contentBoundPt: number;
  origMarginPt: number;
  newMarginPt: number;
  shrunkPt: number;
  extendedPt: number;
  holdCode: string | null;
  propFloorApplied?: boolean;
  propFloorPt?: number | null;
  reason: string;
}

export interface SafeShrinkOptionInfo {
  requested: boolean;
  applied: boolean;
  status: "disabled" | "not-needed" | "pending-verification" | "applied" | "held-safety-fallback";
  modeNote: string;
  shrunkPt: number;
  extendedPt: number;
  x: { old: [number, number]; new: [number, number]; changed: boolean } | null;
  y: { old: [number, number]; new: [number, number]; changed: boolean } | null;
  directions: Record<string, SafeShrinkDirectionSummary>;
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
  requiresAxisExtension?: boolean;
  wouldExtendDomain?: [number, number] | null;
  reason: string;
}

export interface DomainExtensionOptionInfo {
  requested: boolean;
  applied: boolean;
  status: "disabled" | "not-needed" | "held-axis-off" | "pending-verification" | "applied" | "blocked-unsafe";
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

export interface SmartLabelPointLabelDecisionSummary {
  id: string;
  label: string;
  cleanLabel?: string;
  role: "point-label-typeA";
  category?: string;
  subCategory?: string;
  markerId?: string | null;
  markerCenterPt?: [number, number] | null;
  coordTikz?: [number, number] | null;
  origDirOption?: string | null;
  nearestDir?: string | null;
  action: "keep" | "move-point-label" | "hold-no-safe-point-candidate" | "hold-abnormal-marker-distance";
  nonMoveCode?: string | null;
  nonMoveCategory?: string | null;
  autoModified: boolean;
  selectedEngine?: string;
  origShift: [number, number];
  newShift: [number, number];
  shift: [number, number];
  deltaShiftPt?: [number, number];
  movedPt?: number;
  markerGapPt?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
  score?: number;
  origClearancePt?: number | null;
  finalClearancePt?: number | null;
  origAxisClearancePt?: number | null;
  finalAxisClearancePt?: number | null;
  origNodeGapPt?: number | null;
  finalNodeGapPt?: number | null;
  reason: string;
  selectionReason?: string;
  holdReason?: string | null;
}

export interface PointLabelOptionInfo {
  requested: boolean;
  applied: boolean;
  status: "disabled" | "not-needed" | "pending-verification" | "applied" | "blocked-unsafe";
  modeNote: string;
  movedCount: number;
  heldCount: number;
  editsCount: number;
  message: string;
  items: SmartLabelPointLabelDecisionSummary[];
}

export interface MultiAbstractCorrespondenceRow {
  nodeId: string;
  label: string;
  origShift: [number, number];
  recommend: {
    strokeIndex: number | null;
    plotExpr: string | null;
    domain: [number, number] | null;
    curveShape: string | null;
    shift: [number, number];
    movedPt: number;
    autoModified: boolean;
  };
  swap: {
    strokeIndex: number | null;
    plotExpr: string | null;
    domain: [number, number] | null;
    curveShape: string | null;
    shift: [number, number];
    movedPt: number;
    autoModified: boolean;
  };
  hold: {
    strokeIndex: null;
    shift: [number, number];
    movedPt: number;
    autoModified: false;
  };
}

export interface MultiAbstractVariantSummary {
  actionMode: MultiAbstractActionMode;
  ok: boolean;
  status: "recommended" | "unchanged" | "unsupported" | "reverted" | "failed";
  reasonCode: string | null;
  message: string;
  canApply: boolean;
  verified: boolean;
  recommendedCode: string;
  movedCount: number;
  fnMovedCount?: number;
  tickMovedCount?: number;
  tickHeldCount?: number;
  originMovedCount?: number;
  originHeldCount?: number;
  pointLabelMovedCount?: number;
  pointLabelHeldCount?: number;
  heldCount: number;
  labelDecisions: SmartLabelDecisionSummary[];
  tickDecisions?: SmartLabelTickDecisionSummary[];
  originDecisions?: SmartLabelOriginDecisionSummary[];
  pointLabelDecisions?: SmartLabelPointLabelDecisionSummary[];
  placements: any[];
  shiftReport: any[];
  axisOption: AxisOptionInfo;
  safeShrinkOption?: SafeShrinkOptionInfo;
  domainExtensionOption?: DomainExtensionOptionInfo;
  pointLabelOption?: PointLabelOptionInfo;
  collisionDiagnostics: CollisionDiagnosticsSummary | null;
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
}

export interface MultiAbstractOptionInfo {
  detected: boolean;
  supportedPair: boolean;
  classificationType: string | null;
  classificationCode: "type1-auto-confirmable" | "type2-user-confirm-required" | "type3-hold-only" | null;
  mathematicallyProven: boolean;
  requiresUserApproval: boolean;
  requestedAction: MultiAbstractActionMode;
  selectedAction: MultiAbstractActionMode;
  defaultAction: "hold";
  canRecommend: boolean;
  canSwap: boolean;
  rawDistMarginPt: number | null;
  moderateMarginCaution?: boolean;
  scaleNormalizedThresholds?: {
    minIntersectionSepPt: number;
    minGlobalMarginPt: number;
    onCurveTolPt: number;
    moderateMarginCautionPt?: number;
    avgNodeScale: number;
    avgLabelHeightPt: number;
    xU: number;
    yU: number;
  } | null;
  signals: string[];
  holdReason: string | null;
  summaryReason: string;
  correspondenceRows: MultiAbstractCorrespondenceRow[];
  variants: {
    hold: MultiAbstractVariantSummary;
    recommend: MultiAbstractVariantSummary | null;
    swap: MultiAbstractVariantSummary | null;
  } | null;
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
  enablePointLabelOverlapFixRequested?: boolean;
  unit3EEnabled?: boolean;
  applySafeShrinkRequested?: boolean;
  ok: boolean;
  status: "recommended" | "unchanged" | "unsupported" | "reverted" | "failed";
  reasonCode: string | null;
  message: string;
  canApply: boolean;
  verified: boolean;
  applyAxisRequested: boolean;
  axisOption: AxisOptionInfo;
  safeShrinkOption?: SafeShrinkOptionInfo;
  applyDomainExtensionRequested?: boolean;
  domainExtensionOption?: DomainExtensionOptionInfo;
  pointLabelOption?: PointLabelOptionInfo;
  multiAbstractActionRequested?: MultiAbstractActionMode;
  multiAbstractOption?: MultiAbstractOptionInfo;
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
  pointLabelMovedCount?: number;
  pointLabelHeldCount?: number;
  heldCount: number;
  labelDecisions: SmartLabelDecisionSummary[];
  tickDecisions?: SmartLabelTickDecisionSummary[];
  originDecisions?: SmartLabelOriginDecisionSummary[];
  pointLabelDecisions?: SmartLabelPointLabelDecisionSummary[];
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
    applySafeShrink?: boolean;
    applyDomainExtension?: boolean;
    multiAbstractAction?: MultiAbstractActionMode;
    engineVersion?: SmartLabelEngineVersion;
    enableUnit3B?: boolean;
    enableUnit3D?: boolean;
    enablePointLabelOverlapFix?: boolean;
    enableUnit3E?: boolean;
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
