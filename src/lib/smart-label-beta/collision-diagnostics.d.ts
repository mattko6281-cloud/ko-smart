export interface CollisionItem {
  key: string;
  nodeId: string;
  nodeLabel: string;
  nodeRole: string;
  otherNodeId?: string;
  otherNodeLabel?: string;
  otherNodeRole?: string;
  autoMoveTarget: boolean;
  targetType: string;
  targetLabel: string;
  clearancePt: number | null;
  severity: "collision";
  description: string;
  originStatus?: string;
  resolutionStatus?: string;
  reason?: string;
}

export interface UnmeasuredNodeInfo {
  id: string;
  label: string;
  role: string;
  roleLabel: string;
  hasBBox: boolean;
  confidence: string;
  usable: boolean;
  reasons: string[];
}

export interface CollisionDiagnosticsComparison {
  safetyPassed: boolean;
  allCollisionsResolved: boolean;
  hasUnresolvedCollisions: boolean;
  measurementComplete: boolean;
  counts: {
    origTotal: number;
    finalTotal: number;
    resolved: number;
    preExistingUnresolved: number;
    newlyIntroduced: number;
    unmeasuredNodes: number;
  };
  resolvedCollisions: CollisionItem[];
  preExistingUnresolvedCollisions: CollisionItem[];
  newlyIntroducedCollisions: CollisionItem[];
  unmeasuredNodes: UnmeasuredNodeInfo[];
  unverifiableItems: Array<{
    relation: string;
    aId: string | null;
    aChars: string;
    bDesc: string;
    note: string;
  }>;
  origAudit: any;
  finalAudit: any;
}

export function auditSceneCollisions(scene: any, P?: any): any;
export function compareCollisionDiagnostics(
  origScene: any,
  finalScene: any,
  movedNodeIds?: Iterable<string>,
  opts?: { axisChanged?: boolean; params?: any }
): CollisionDiagnosticsComparison;
