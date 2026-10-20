import type { CollisionDiagnosticsComparison } from "./collision-diagnostics";

export const DEVELOPER_BETA_EMAIL = "mattko6281@gmail.com";
export const MAX_TIKZ_INPUT_LENGTH = 15000;
export const MAX_SAMPLES_VALUE = 500;
export const DEFAULT_KROKI_TIMEOUT_MS = 6000;

export interface SmartLabelDecisionItem {
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

export interface SmartLabelAxisEndpointInfo {
  old: [number, number];
  new: [number, number];
  changed: boolean;
}

export interface SmartLabelAxisOptionResult {
  requested: boolean;
  applied: boolean;
  status: "disabled" | "not-needed" | "pending-verification" | "applied" | "blocked-unsafe";
  modeNote: string;
  x: SmartLabelAxisEndpointInfo | null;
  y: SmartLabelAxisEndpointInfo | null;
  editsCount: number;
  message: string;
}

export interface SmartLabelBetaResponse {
  algorithmVersion: string;
  ok: boolean;
  status: "recommended" | "unchanged" | "unsupported" | "reverted" | "failed";
  reasonCode: string | null;
  message: string;
  canApply: boolean;
  verified: boolean;
  applyAxisRequested?: boolean;
  axisOption?: SmartLabelAxisOptionResult;
  collisionDiagnostics?: CollisionDiagnosticsComparison | null;
  inputHash: string;
  originalCode: string;
  recommendedCode: string;
  figureType: {
    type: string;
    hasAxes: boolean;
    reason: string;
  } | null;
  movedCount: number;
  heldCount: number;
  labelDecisions: SmartLabelDecisionItem[];
  placements: any[];
  shiftReport: any[];
  preservation: {
    ok: boolean;
    issues: string[];
    editCount: number;
    checks: Record<string, boolean>;
  } | null;
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

export function validateBetaTikzInput(rawInput: string): {
  ok: boolean;
  httpStatus?: number;
  status?: string;
  reasonCode?: string;
  message?: string;
};

export function recommendSmartLabelBeta(
  rawInput: string,
  opts?: {
    krokiBaseUrl?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    params?: any;
    verify?: boolean;
    applyAxis?: boolean;
  }
): Promise<SmartLabelBetaResponse>;

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
): Promise<{ httpStatus: number; body: SmartLabelBetaResponse | any }>;
