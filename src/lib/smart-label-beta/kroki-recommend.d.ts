export const DEVELOPER_BETA_EMAIL: "mattko6281@gmail.com";
export const MAX_TIKZ_INPUT_LENGTH: number;
export const MAX_SAMPLES_VALUE: number;
export const DEFAULT_KROKI_TIMEOUT_MS: number;

export function computeInputHash(rawInput: string): string;

export function isSmartLabelBetaServerEnabled(opts?: {
  env?: Record<string, string | undefined>;
}): { enabled: boolean; reason: string };

export function verifyDeveloperSession(session: any): {
  allowed: boolean;
  httpStatus: number;
  code: "OK" | "UNAUTHORIZED" | "FORBIDDEN";
  email?: string;
  error?: string;
};

export function processInputLikeKoSmart(code: string): string;
export function encodeKroki(text: string): string;

export function extractTikzpictureBlock(rawInput: string):
  | {
      ok: true;
      prefix: string;
      rawBody: string;
      effectiveBody: string;
      suffix: string;
      circleAdjusted: boolean;
    }
  | {
      ok: false;
      reasonCode: string;
      message: string;
    };

export function renderTikzViaKroki(
  body: string,
  opts?: {
    krokiBaseUrl?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  }
): Promise<{
  ok: boolean;
  svg?: string;
  status?: number;
  elapsedMs: number;
  isTimeout?: boolean;
  error?: string;
  encodedUrlPath?: string;
}>;

export function validateBetaTikzInput(rawInput: string):
  | { ok: true }
  | {
      ok: false;
      httpStatus: number;
      status: "failed" | "unsupported";
      reasonCode: string;
      message: string;
    };

export function acquireUserExecutionSlot(userKey?: string):
  | {
      acquired: true;
      release: () => void;
    }
  | {
      acquired: false;
      httpStatus: number;
      reasonCode: string;
      message: string;
    };

export interface SmartLabelDecisionItem {
  id: string;
  label: string;
  autoModified: boolean;
  selectedEngine: string;
  agreedEngines: string[];
  how: string | null;
  confirmedAssignment: boolean;
  shift: [number | null, number | null];
  movedPt: number;
  nonMoveCategory: string | null;
  nonMoveCode: string | null;
  holdReason: string | null;
  selectionReason: string;
}

export interface SmartLabelBetaResponse {
  algorithmVersion: string;
  ok: boolean;
  status: "recommended" | "unchanged" | "unsupported" | "reverted" | "failed";
  reasonCode: string | null;
  message: string;
  canApply: boolean;
  verified: boolean;
  inputHash: string;
  originalCode: string;
  recommendedCode: string;
  figureType: { type: string; hasAxes: boolean; reason: string } | null;
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

export function recommendSmartLabelBeta(
  rawInput: string,
  opts?: {
    krokiBaseUrl?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    params?: any;
    verify?: boolean;
  }
): Promise<SmartLabelBetaResponse>;

export function handleSmartLabelGet(deps: {
  getSession: () => Promise<any>;
  env?: Record<string, string | undefined>;
}): Promise<{
  httpStatus: number;
  body: {
    ok: boolean;
    enabled: boolean;
    authorized: boolean;
    email?: string;
    reason?: string;
    algorithmVersion?: string;
    code?: string;
    error?: string;
  };
}>;

export function handleSmartLabelPost(
  requestBody: any,
  deps: {
    getSession: () => Promise<any>;
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    krokiBaseUrl?: string;
    timeoutMs?: number;
  }
): Promise<{
  httpStatus: number;
  body: Partial<SmartLabelBetaResponse> & {
    ok: boolean;
    status: string;
    reasonCode?: string | null;
    message?: string;
    canApply: boolean;
  };
}>;

