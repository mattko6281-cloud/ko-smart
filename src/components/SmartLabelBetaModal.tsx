"use client";

import React, { useState, useEffect } from "react";
import {
  evaluateProposalApplicability,
  resolveActiveProposalForMultiAbstractChoice,
  normalizeSmartLabelUiMode,
  collectProposalCandidateImageUris,
  type SmartLabelUiMode,
} from "@/lib/smart-label-beta/client-workflow";
import type {
  SmartLabelBetaResponse,
  SmartLabelEngineVersion,
  MultiAbstractActionMode,
  LineNameActionMode,
} from "@/lib/smart-label-beta/kroki-recommend";

export interface ModeBBatchedOptions {
  applyAxis: boolean;
  applySafeShrink: boolean;
  applyDomainExtension: boolean;
  enableUnit3B: boolean;
  enablePointLabelOverlapFix: boolean;
  enableAxisLetterOverlapFix: boolean;
  enableLineNameOverlapFix: boolean;
}

interface SmartLabelBetaModalProps {
  proposal: SmartLabelBetaResponse | null;
  currentRawInput: string;
  onClose: () => void;
  onApproveApply: () => void;
  restoreConfirmOpen: boolean;
  onCancelRestoreConfirm: () => void;
  onConfirmRestoreOverwrite: () => void;
  accessRole?: "developer" | "pilot" | "none";
  canSelectEngine?: boolean;
  unit3BServerEnabled?: boolean;
  unit3BDisabledReason?: string | null;
  applyAxisOption?: boolean;
  onToggleApplyAxisOption?: (nextApplyAxis: boolean) => void;
  applySafeShrinkOption?: boolean;
  onToggleApplySafeShrinkOption?: (nextApplySafeShrink: boolean) => void;
  applyDomainExtensionOption?: boolean;
  onToggleApplyDomainExtensionOption?: (nextApplyDomainExtension: boolean) => void;
  multiAbstractAction?: MultiAbstractActionMode;
  onChangeMultiAbstractAction?: (nextAction: MultiAbstractActionMode) => void;
  enableUnit3BOption?: boolean;
  onToggleEnableUnit3BOption?: (nextEnableUnit3B: boolean) => void;
  enablePointLabelOverlapFixOption?: boolean;
  onToggleEnablePointLabelOverlapFixOption?: (nextEnablePointLabelOverlapFix: boolean) => void;
  enableAxisLetterOverlapFixOption?: boolean;
  onToggleEnableAxisLetterOverlapFixOption?: (nextEnableAxisLetterOverlapFix: boolean) => void;
  enableLineNameOverlapFixOption?: boolean;
  onToggleEnableLineNameOverlapFixOption?: (nextEnableLineNameOverlapFix: boolean) => void;
  lineNameAction?: LineNameActionMode;
  onChangeLineNameAction?: (nextAction: LineNameActionMode) => void;
  engineVersion?: SmartLabelEngineVersion;
  onChangeEngineVersion?: (nextEngineVersion: SmartLabelEngineVersion) => void;
  isRecomputing?: boolean;
  uiMode?: SmartLabelUiMode;
  onChangeUiMode?: (nextMode: SmartLabelUiMode) => void;
  onRunModeASafePreset?: (nextApplyAxis?: boolean) => void;
  onApplyModeBOptions?: (opts: ModeBBatchedOptions) => void;
}

export function SmartLabelBetaModal({
  proposal,
  currentRawInput,
  onClose,
  onApproveApply,
  restoreConfirmOpen,
  onCancelRestoreConfirm,
  onConfirmRestoreOverwrite,
  accessRole = "developer",
  canSelectEngine = true,
  unit3BServerEnabled = true,
  unit3BDisabledReason,
  applyAxisOption = false,
  onToggleApplyAxisOption,
  applySafeShrinkOption = false,
  onToggleApplySafeShrinkOption,
  applyDomainExtensionOption = false,
  onToggleApplyDomainExtensionOption,
  multiAbstractAction,
  onChangeMultiAbstractAction,
  enableUnit3BOption = false,
  onToggleEnableUnit3BOption,
  enablePointLabelOverlapFixOption = false,
  onToggleEnablePointLabelOverlapFixOption,
  enableAxisLetterOverlapFixOption = false,
  onToggleEnableAxisLetterOverlapFixOption,
  enableLineNameOverlapFixOption = false,
  onToggleEnableLineNameOverlapFixOption,
  lineNameAction,
  onChangeLineNameAction,
  engineVersion = "v0.2.1",
  onChangeEngineVersion,
  isRecomputing = false,
  uiMode = "A",
  onChangeUiMode,
  onRunModeASafePreset,
  onApplyModeBOptions,
}: SmartLabelBetaModalProps) {
  const [internalUiMode, setInternalUiMode] = useState<SmartLabelUiMode>("A");
  const activeUiMode: SmartLabelUiMode = normalizeSmartLabelUiMode(
    onChangeUiMode ? uiMode : internalUiMode
  );

  const handleSelectUiMode = (nextMode: SmartLabelUiMode) => {
    const normalized = normalizeSmartLabelUiMode(nextMode);
    setInternalUiMode(normalized);
    if (onChangeUiMode) {
      onChangeUiMode(normalized);
    }
  };

  const [internalMaAction, setInternalMaAction] =
    React.useState<MultiAbstractActionMode>("hold");

  React.useEffect(() => {
    setInternalMaAction("hold");
  }, [
    proposal?.inputHash,
    proposal?.applyAxisRequested,
    proposal?.applySafeShrinkRequested,
    proposal?.applyDomainExtensionRequested,
    proposal?.enablePointLabelOverlapFixRequested,
    proposal?.enableAxisLetterOverlapFixRequested,
    proposal?.enableLineNameOverlapFixRequested,
  ]);

  const selectedMaAction: MultiAbstractActionMode =
    multiAbstractAction ?? internalMaAction;

  const [internalLnAction, setInternalLnAction] =
    React.useState<LineNameActionMode>("hold");

  React.useEffect(() => {
    setInternalLnAction("hold");
  }, [
    proposal?.inputHash,
    proposal?.applyAxisRequested,
    proposal?.applySafeShrinkRequested,
    proposal?.applyDomainExtensionRequested,
    proposal?.enablePointLabelOverlapFixRequested,
    proposal?.enableAxisLetterOverlapFixRequested,
    proposal?.enableLineNameOverlapFixRequested,
  ]);

  const selectedLnAction: LineNameActionMode =
    lineNameAction ?? internalLnAction;

  const handleSelectLnAction = (next: LineNameActionMode) => {
    setInternalLnAction(next);
    if (onChangeLineNameAction) {
      onChangeLineNameAction(next);
    }
  };

  const handleSelectMaAction = (next: MultiAbstractActionMode) => {
    setInternalMaAction(next);
    if (onChangeMultiAbstractAction) {
      onChangeMultiAbstractAction(next);
    }
  };

  // Mode B local draft checkboxes for 1-click batched apply
  const [draftModeB, setDraftModeB] = useState<ModeBBatchedOptions>({
    applyAxis: Boolean(applyAxisOption),
    applySafeShrink: Boolean(applySafeShrinkOption),
    applyDomainExtension: Boolean(applyDomainExtensionOption),
    enableUnit3B: Boolean(enableUnit3BOption),
    enablePointLabelOverlapFix: Boolean(enablePointLabelOverlapFixOption),
    enableAxisLetterOverlapFix: Boolean(enableAxisLetterOverlapFixOption),
    enableLineNameOverlapFix: Boolean(enableLineNameOverlapFixOption),
  });

  useEffect(() => {
    setDraftModeB({
      applyAxis: Boolean(applyAxisOption),
      applySafeShrink: Boolean(applySafeShrinkOption),
      applyDomainExtension: Boolean(applyDomainExtensionOption),
      enableUnit3B: Boolean(enableUnit3BOption),
      enablePointLabelOverlapFix: Boolean(enablePointLabelOverlapFixOption),
      enableAxisLetterOverlapFix: Boolean(enableAxisLetterOverlapFixOption),
      enableLineNameOverlapFix: Boolean(enableLineNameOverlapFixOption),
    });
  }, [
    applyAxisOption,
    applySafeShrinkOption,
    applyDomainExtensionOption,
    enableUnit3BOption,
    enablePointLabelOverlapFixOption,
    enableAxisLetterOverlapFixOption,
    enableLineNameOverlapFixOption,
  ]);

  // Responsive comparison layout & zoom state for Mode A / B
  const [compareLayoutPref, setCompareLayoutPref] = useState<"auto" | "two-col" | "single-tab">("auto");
  const [isNarrowViewport, setIsNarrowViewport] = useState<boolean>(false);
  const [compareActiveTab, setCompareActiveTab] = useState<"recommended" | "original">("recommended");
  const [compareZoomPct, setCompareZoomPct] = useState<100 | 115 | 130>(100);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateViewport = () => {
      setIsNarrowViewport(window.innerWidth < 1200 || window.innerHeight < 700);
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  // ESC key handler: close modal safely without modifying rawInput
  useEffect(() => {
    if (!proposal && !restoreConfirmOpen) return;
    if (typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (restoreConfirmOpen) {
          onCancelRestoreConfirm();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [proposal, restoreConfirmOpen, onClose, onCancelRestoreConfirm]);

  // Preload all candidate SVG data URIs on client so switching Hold/Recommend/Swap requires 0 server calls
  const [preloadedImageCount, setPreloadedImageCount] = useState<number>(0);
  useEffect(() => {
    if (!proposal || typeof window === "undefined") {
      setPreloadedImageCount(0);
      return;
    }
    const uris = collectProposalCandidateImageUris(proposal);
    setPreloadedImageCount(uris.length);
    for (const uri of uris) {
      const img = new window.Image();
      img.src = uri;
    }
  }, [proposal]);

  if (restoreConfirmOpen) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        data-testid="smart-label-restore-confirm-modal"
      >
        <div className="w-full max-w-md rounded-xl border border-amber-300 bg-white p-6 shadow-2xl">
          <div className="mb-3 flex items-center gap-2 text-amber-700 font-bold text-base">
            <span>⚠️ 원본 복원 덮어쓰기 확인</span>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed mb-5">
            추천 적용 이후 에디터 또는 조이스틱으로 추가 수정한 내용이 감지되었습니다.
            <br />
            <strong className="text-slate-900">
              자동 정렬 이전의 원본으로 복원하면 이후에 수정한 내용이 덮어써집니다.
            </strong>{" "}
            계속 복원하시겠습니까?
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancelRestoreConfirm}
              data-testid="btn-cancel-restore-confirm"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              취소 (현재 코드 유지)
            </button>
            <button
              type="button"
              onClick={onConfirmRestoreOverwrite}
              data-testid="btn-confirm-restore-overwrite"
              className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700"
            >
              확인 (원본으로 복원)
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!proposal) return null;

  const activeProposal = resolveActiveProposalForMultiAbstractChoice(
    proposal,
    selectedMaAction,
    selectedLnAction
  ) as SmartLabelBetaResponse;
  const maOpt = activeProposal.multiAbstractOption;
  const lnOpt = activeProposal.lineNameOption;
  const effectiveLnAction: LineNameActionMode = lnOpt?.requiresUserApproval
    ? lnOpt.selectedAction
    : "hold";
  const effectiveMaAction: MultiAbstractActionMode = maOpt?.detected
    ? maOpt.selectedAction
    : "hold";

  const applicability = evaluateProposalApplicability(activeProposal, currentRawInput, {
    multiAbstractAction: effectiveMaAction,
    lineNameAction: effectiveLnAction,
  });
  const isStale = currentRawInput !== activeProposal.originalCode;
  const diag = activeProposal.collisionDiagnostics;
  const activeEngineVersion: SmartLabelEngineVersion =
    activeProposal.engineVersion === "v0.2.2-beta" ? "v0.2.2-beta" : engineVersion;
  const effectiveUnit3BServerEnabled =
    unit3BServerEnabled !== false && activeProposal.unit3BServerEnabled !== false;
  const effectiveUnit3BDisabledReason =
    activeProposal.unit3BDisabledReason ||
    unit3BDisabledReason ||
    "서버 설정에 의해 Unit 3-B 눈금 겹침 자동 조정이 비활성화되어 있습니다. (함수식 라벨 자동 정렬은 정상 작동)";
  const hasUnresolvedIssues =
    Boolean(diag) &&
    (Boolean(diag?.hasUnresolvedCollisions) || !Boolean(diag?.measurementComplete));

  const statusTone =
    activeProposal.status === "recommended"
      ? hasUnresolvedIssues
        ? "border-amber-300 bg-amber-50 text-amber-950"
        : "border-emerald-300 bg-emerald-50 text-emerald-900"
      : activeProposal.status === "unchanged"
      ? hasUnresolvedIssues
        ? "border-amber-300 bg-amber-50 text-amber-950"
        : "border-blue-300 bg-blue-50 text-blue-900"
      : activeProposal.status === "unsupported"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-rose-300 bg-rose-50 text-rose-900";

  const statusLabel =
    activeProposal.status === "recommended"
      ? hasUnresolvedIssues
        ? "추천 완료 (2차 검증 통과 · 일부 기존 미해결 충돌 존재)"
        : "추천 완료 (2차 검증 통과)"
      : activeProposal.status === "unchanged"
      ? maOpt?.detected && maOpt.classificationCode === "type2-user-confirm-required"
        ? "원본 위치 유지 (유형 2: 다중 추상 함수 기본 Hold — 아래에서 대응 선택 가능)"
        : hasUnresolvedIssues
        ? "원본 위치 유지 (미해결 충돌 감지)"
        : "원본 위치 유지"
      : activeProposal.status === "unsupported"
      ? "초기 베타 미지원 도형 (원본 유지)"
      : activeProposal.status === "reverted"
      ? "안전성 검증 미통과 (원본 유지)"
      : "추천 실패 (원본 유지)";

  const effectiveCompareLayout: "two-col" | "single-tab" =
    compareLayoutPref === "auto"
      ? isNarrowViewport
        ? "single-tab"
        : "two-col"
      : compareLayoutPref;

  const showMaConfirmCard = Boolean(
    activeEngineVersion === "v0.2.2-beta" && maOpt?.detected
  );
  const showLnConfirmCard = Boolean(
    activeEngineVersion === "v0.2.2-beta" &&
      lnOpt?.requested &&
      (lnOpt.d3SubType === "D3-2" || lnOpt.d3SubType === "D3-3" || lnOpt.requiresUserApproval)
  );
  const showSimpleCorrespondenceSection = showMaConfirmCard || showLnConfirmCard;

  const movedFunctionCount = activeProposal.fnMovedCount ?? activeProposal.movedCount ?? 0;
  const movedTickCount = activeProposal.tickMovedCount ?? 0;
  const movedOriginCount = activeProposal.originMovedCount ?? 0;
  const movedPointCount = activeProposal.pointLabelMovedCount ?? 0;
  const movedAxisLetterCount = activeProposal.axisLetterMovedCount ?? 0;
  const movedLineNameCount = activeProposal.lineNameMovedCount ?? 0;
  const axisChanged = Boolean(activeProposal.axisOption?.applied);
  const totalMovedCount =
    movedFunctionCount +
    movedTickCount +
    movedOriginCount +
    movedPointCount +
    movedAxisLetterCount +
    movedLineNameCount +
    (axisChanged ? 1 : 0);
  const unresolvedCount = diag?.counts?.preExistingUnresolved ?? 0;

  const imgMaxHeightClass =
    compareZoomPct === 130
      ? "max-h-[380px]"
      : compareZoomPct === 115
      ? "max-h-[325px]"
      : "max-h-[270px]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4"
      data-testid="smart-label-beta-modal"
      data-ui-mode={activeUiMode}
      data-preloaded-candidates={preloadedImageCount}
    >
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        {/* 헤더 */}
        <div className="shrink-0 flex flex-col gap-2 border-b border-slate-200 bg-slate-900 px-4 py-2.5 text-white">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold whitespace-nowrap">
                ✨ 스마트 그림 정리
              </span>
              <span
                className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${
                  activeEngineVersion === "v0.2.2-beta"
                    ? "bg-emerald-500/30 border-emerald-400/50 text-emerald-200"
                    : "bg-indigo-500/30 border-indigo-400/40 text-indigo-200"
                }`}
              >
                {activeEngineVersion === "v0.2.2-beta"
                  ? proposal.unit3BEnabled
                    ? "v0.2.2 Beta (interim-v1 + Unit 3-B/3-C/3-D)"
                    : "v0.2.2 Beta (interim-v1 + Unit 3-C/3-D)"
                  : proposal.algorithmVersion || "proto-0.2.1"}{" "}
                · {proposal.applyAxisRequested ? "label+axes" : "labelOnly"} · verify=true
              </span>
              <span
                className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300"
                data-testid="modal-badge-access-role"
              >
                {accessRole === "pilot" ? "파일럿 팀원 베타" : "개발자 전용"}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* A / B / C 모드 전환기 */}
              <div
                className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-800 p-0.5 text-[11px]"
                data-testid="smart-label-ui-mode-switcher"
              >
                <button
                  type="button"
                  onClick={() => handleSelectUiMode("A")}
                  data-testid="btn-ui-mode-a"
                  className={`rounded-md px-2.5 py-1 font-bold whitespace-nowrap transition ${
                    activeUiMode === "A"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  일반 모드
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectUiMode("B")}
                  data-testid="btn-ui-mode-b"
                  className={`rounded-md px-2.5 py-1 font-bold whitespace-nowrap transition ${
                    activeUiMode === "B"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  고급 옵션
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectUiMode("C")}
                  data-testid="btn-ui-mode-c"
                  className={`rounded-md px-2.5 py-1 font-bold whitespace-nowrap transition ${
                    activeUiMode === "C"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  상세 검수
                </button>
              </div>

              {canSelectEngine && onChangeEngineVersion ? (
                <label
                  className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/90 px-2.5 py-1 text-[11px] font-medium text-slate-200"
                  data-testid="modal-select-engine-version"
                >
                  <span className="text-slate-400">엔진:</span>
                  <select
                    value={engineVersion}
                    disabled={isRecomputing}
                    onChange={(e) =>
                      onChangeEngineVersion(
                        e.target.value === "v0.2.2-beta" ? "v0.2.2-beta" : "v0.2.1"
                      )
                    }
                    className="bg-transparent font-semibold text-white outline-none cursor-pointer"
                  >
                    <option value="v0.2.1" className="bg-slate-900 text-slate-200">
                      기존 v0.2.1 (기본)
                    </option>
                    <option value="v0.2.2-beta" className="bg-slate-900 text-emerald-300">
                      개선 v0.2.2 Beta (interim-v1)
                    </option>
                  </select>
                </label>
              ) : (
                <span
                  className="rounded-md border border-emerald-700/60 bg-slate-800/90 px-2.5 py-1 text-[11px] font-semibold text-emerald-300"
                  data-testid="modal-fixed-engine-badge"
                >
                  엔진: v0.2.2 Beta (고정)
                </span>
              )}

              <button
                type="button"
                onClick={onClose}
                data-testid="btn-close-smart-label-modal"
                className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white whitespace-nowrap"
              >
                ✕ 닫기
              </button>
            </div>
          </div>

          {/* Mode C 전용 헤더 체크박스 바 */}
          {activeUiMode === "C" && (
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800">
            {activeEngineVersion === "v0.2.2-beta" && onToggleEnableUnit3BOption && (
              <label
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium ${
                  effectiveUnit3BServerEnabled
                    ? "cursor-pointer border-emerald-700/70 bg-emerald-950/60 text-emerald-200 hover:border-emerald-400"
                    : "cursor-not-allowed border-slate-700 bg-slate-800/60 text-slate-400"
                }`}
                title={
                  effectiveUnit3BServerEnabled
                    ? "체크 시 축 눈금 숫자(2, π, 6 등)와 그래프 선의 실제 글자 겹침도 함께 미세 조정합니다"
                    : effectiveUnit3BDisabledReason
                }
                data-testid="modal-checkbox-enable-unit3b"
              >
                <input
                  type="checkbox"
                  checked={effectiveUnit3BServerEnabled ? enableUnit3BOption : false}
                  disabled={isRecomputing || !effectiveUnit3BServerEnabled}
                  onChange={(e) => {
                    if (!effectiveUnit3BServerEnabled) return;
                    onToggleEnableUnit3BOption(e.target.checked);
                  }}
                  className="h-3.5 w-3.5 rounded accent-emerald-500"
                />
                <span>
                  {effectiveUnit3BServerEnabled
                    ? "Unit 3-B 눈금 겹침 자동 조정"
                    : "Unit 3-B 눈금 조정 (서버 비활성)"}
                </span>
              </label>
            )}
            {activeEngineVersion === "v0.2.2-beta" && onToggleEnablePointLabelOverlapFixOption && (
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded-md border border-teal-700/70 bg-teal-950/60 px-2.5 py-1 text-[11px] font-medium text-teal-200 hover:border-teal-400"
                title="체크 시 점 마커(circle, fill=black)에 연결된 대문자 점 이름(A, B, C, P, Q 등)의 선·축 겹침을 평가원 스타일 열린 방향으로 자동 정렬합니다 (기본 OFF)"
                data-testid="modal-checkbox-enable-point-label-overlap-fix"
              >
                <input
                  type="checkbox"
                  checked={enablePointLabelOverlapFixOption}
                  disabled={isRecomputing}
                  onChange={(e) => onToggleEnablePointLabelOverlapFixOption(e.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-teal-500"
                />
                <span>점 이름 겹침 자동 정렬</span>
              </label>
            )}
            {activeEngineVersion === "v0.2.2-beta" && onToggleEnableAxisLetterOverlapFixOption && (
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded-md border border-purple-700/70 bg-purple-950/60 px-2.5 py-1 text-[11px] font-medium text-purple-200 hover:border-purple-400"
                title="체크 시 좌표축 위의 문자·그리스 문자 눈금(a, b, c, \alpha, \beta 등)의 곡선·보조선 관통 겹침을 평가원 스타일로 자동 정렬합니다 (직선 이름 l,m,n 제외 · 기본 OFF)"
                data-testid="modal-checkbox-enable-axis-letter-overlap-fix"
              >
                <input
                  type="checkbox"
                  checked={enableAxisLetterOverlapFixOption}
                  disabled={isRecomputing}
                  onChange={(e) => onToggleEnableAxisLetterOverlapFixOption(e.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-purple-500"
                />
                <span>축 문자 눈금 자동 정렬</span>
              </label>
            )}
            {activeEngineVersion === "v0.2.2-beta" && onToggleEnableLineNameOverlapFixOption && (
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded-md border border-sky-700/70 bg-sky-950/60 px-2.5 py-1 text-[11px] font-medium text-sky-200 hover:border-sky-400"
                title="체크 시 직선 이름(l, m, n, \ell)을 대응 직선의 가시 끝점(visible tip) 인접 열린 방향으로 자동 정렬하며, 2직선(l, m)은 기본 Hold 후 추천/교환 선택이 가능합니다 (기본 OFF)"
                data-testid="modal-checkbox-enable-line-name-overlap-fix"
              >
                <input
                  type="checkbox"
                  checked={enableLineNameOverlapFixOption}
                  disabled={isRecomputing}
                  onChange={(e) => onToggleEnableLineNameOverlapFixOption(e.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-sky-500"
                />
                <span>직선 이름(l, m, n) 자동 정렬</span>
              </label>
            )}
            {activeEngineVersion === "v0.2.2-beta" && onToggleApplyDomainExtensionOption && (
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded-md border border-cyan-700/70 bg-cyan-950/60 px-2.5 py-1 text-[11px] font-medium text-cyan-200 hover:border-cyan-400"
                title="체크 시 라벨과 그래프 끝점 간격이 멀거나 보조선 혼잡이 있을 때 8단계 안전 게이트를 통과한 단일 plot 곡선의 끝점을 최소 연장합니다 (기본 OFF)"
                data-testid="modal-checkbox-apply-domain-extension"
              >
                <input
                  type="checkbox"
                  checked={applyDomainExtensionOption}
                  disabled={isRecomputing}
                  onChange={(e) => onToggleApplyDomainExtensionOption(e.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-cyan-500"
                />
                <span>그래프 끝점 미세 연장</span>
              </label>
            )}
            {activeEngineVersion === "v0.2.2-beta" && onToggleApplySafeShrinkOption && (
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded-md border border-violet-700/70 bg-violet-950/60 px-2.5 py-1 text-[11px] font-medium text-violet-200 hover:border-violet-400"
                title="체크 시 8단계 안전 게이트와 양의 줄기 비례 하한(45%, 46pt)을 통과한 방향의 불필요한 축 여백만 4방향 독립으로 안전하게 줄입니다 (기본 OFF)"
                data-testid="modal-checkbox-apply-safe-shrink"
              >
                <input
                  type="checkbox"
                  checked={applySafeShrinkOption}
                  disabled={isRecomputing}
                  onChange={(e) => onToggleApplySafeShrinkOption(e.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-violet-500"
                />
                <span>축 길이 안전하게 줄이기</span>
              </label>
            )}
            {onToggleApplyAxisOption && (
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/90 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-indigo-400"
                data-testid="modal-checkbox-apply-axis"
              >
                <input
                  type="checkbox"
                  checked={applyAxisOption}
                  disabled={isRecomputing}
                  onChange={(e) => onToggleApplyAxisOption(e.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-indigo-500"
                />
                <span>x축·y축 길이도 자동 조정하기</span>
              </label>
            )}
            </div>
          )}
        </div>

        {/* 본문: 일반 모드 (A) 및 고급 옵션 모드 (B) */}
        {(activeUiMode === "A" || activeUiMode === "B") && (
          <div
            className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-3"
            data-testid="smart-label-simple-body"
          >
            {/* ① 원클릭 스마트 정리 컨트롤 + 핵심 한 줄 요약 바 */}
            <div
              className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-indigo-200 bg-indigo-50/50 px-3.5 py-2.5"
              data-testid="mode-a-preset-bar"
            >
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={isRecomputing}
                  onClick={() => {
                    if (onRunModeASafePreset) {
                      onRunModeASafePreset(applyAxisOption);
                    }
                  }}
                  data-testid="btn-mode-a-run-preset"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 whitespace-nowrap transition"
                >
                  <span>✨ 스마트 정리하기</span>
                  {isRecomputing && <span className="text-[10px] font-normal">(계산 중...)</span>}
                </button>

                <label
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:border-indigo-400 whitespace-nowrap"
                  data-testid="label-mode-a-axis-fit"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(applyAxisOption)}
                    disabled={isRecomputing}
                    onChange={(e) => {
                      const nextVal = e.target.checked;
                      if (onRunModeASafePreset) {
                        onRunModeASafePreset(nextVal);
                      } else if (onToggleApplyAxisOption) {
                        onToggleApplyAxisOption(nextVal);
                      }
                    }}
                    data-testid="chk-mode-a-axis-fit"
                    className="h-3.5 w-3.5 rounded accent-indigo-600"
                  />
                  <span>축 길이도 함께 맞춤</span>
                </label>
              </div>

              {/* 한 줄 요약 + 정돈된 요소 칩 */}
              <div
                className="flex flex-wrap items-center gap-1.5 text-xs"
                data-testid="mode-a-concise-summary"
              >
                <span
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${
                    totalMovedCount > 0
                      ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                      : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  {totalMovedCount > 0
                    ? `정돈됨 ${totalMovedCount}건`
                    : showSimpleCorrespondenceSection
                    ? "원본 배치 유지 중 (아래에서 후보 배치 선택 가능)"
                    : "추가 이동 없이 원본 배치 유지"}
                </span>
                {movedFunctionCount > 0 && (
                  <span className="rounded bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                    함수식 {movedFunctionCount}
                  </span>
                )}
                {movedTickCount > 0 && (
                  <span className="rounded bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                    눈금 {movedTickCount}
                  </span>
                )}
                {movedOriginCount > 0 && (
                  <span className="rounded bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                    원점 O
                  </span>
                )}
                {movedPointCount > 0 && (
                  <span className="rounded bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                    점 이름 {movedPointCount}
                  </span>
                )}
                {movedAxisLetterCount > 0 && (
                  <span className="rounded bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                    축 문자 {movedAxisLetterCount}
                  </span>
                )}
                {movedLineNameCount > 0 && (
                  <span className="rounded bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                    직선 이름 {movedLineNameCount}
                  </span>
                )}
                {axisChanged && (
                  <span className="rounded bg-indigo-100 border border-indigo-200 px-2 py-0.5 text-[11px] font-semibold text-indigo-900">
                    축 길이 맞춤
                  </span>
                )}
                {unresolvedCount > 0 && (
                  <span className="rounded bg-amber-100 border border-amber-300 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                    조이스틱 미세 조정 권장 {unresolvedCount}건
                  </span>
                )}
              </div>
            </div>

            {/* Mode B 전용: 고급 옵션 일괄 선택 바 (1회 요청으로 일괄 적용) */}
            {activeUiMode === "B" && (
              <div
                className="rounded-xl border border-slate-300 bg-slate-50 p-3 space-y-2"
                data-testid="mode-b-options-panel"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold text-slate-800">
                    ⚙️ 고급 옵션 선택 (원하는 항목을 체크한 뒤 [옵션 변경 일괄 적용]을 누르면 1회 계산으로 반영됩니다)
                  </div>
                  <button
                    type="button"
                    disabled={isRecomputing}
                    onClick={() => {
                      if (onApplyModeBOptions) {
                        onApplyModeBOptions(draftModeB);
                      }
                    }}
                    data-testid="btn-mode-b-apply-options"
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:bg-slate-300 whitespace-nowrap"
                  >
                    ⚡ 옵션 변경 일괄 적용
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={draftModeB.enableUnit3B && effectiveUnit3BServerEnabled}
                      disabled={!effectiveUnit3BServerEnabled || isRecomputing}
                      onChange={(e) =>
                        setDraftModeB((prev) => ({ ...prev, enableUnit3B: e.target.checked }))
                      }
                      data-testid="chk-mode-b-unit3b"
                      className="h-3.5 w-3.5 rounded accent-emerald-600"
                    />
                    <span>숫자 눈금 정렬</span>
                  </label>

                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={draftModeB.enablePointLabelOverlapFix}
                      disabled={isRecomputing}
                      onChange={(e) =>
                        setDraftModeB((prev) => ({
                          ...prev,
                          enablePointLabelOverlapFix: e.target.checked,
                        }))
                      }
                      data-testid="chk-mode-b-point-label"
                      className="h-3.5 w-3.5 rounded accent-teal-600"
                    />
                    <span>점 이름(A,B,P) 정렬</span>
                  </label>

                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={draftModeB.enableAxisLetterOverlapFix}
                      disabled={isRecomputing}
                      onChange={(e) =>
                        setDraftModeB((prev) => ({
                          ...prev,
                          enableAxisLetterOverlapFix: e.target.checked,
                        }))
                      }
                      data-testid="chk-mode-b-axis-letter"
                      className="h-3.5 w-3.5 rounded accent-purple-600"
                    />
                    <span>축 문자(a,b,α) 정렬</span>
                  </label>

                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={draftModeB.enableLineNameOverlapFix}
                      disabled={isRecomputing}
                      onChange={(e) =>
                        setDraftModeB((prev) => ({
                          ...prev,
                          enableLineNameOverlapFix: e.target.checked,
                        }))
                      }
                      data-testid="chk-mode-b-line-name"
                      className="h-3.5 w-3.5 rounded accent-sky-600"
                    />
                    <span>직선 이름(l,m,n) 정렬</span>
                  </label>

                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={draftModeB.applyAxis}
                      disabled={isRecomputing}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setDraftModeB((prev) => ({
                          ...prev,
                          applyAxis: checked,
                          applySafeShrink: checked ? prev.applySafeShrink : false,
                        }));
                      }}
                      data-testid="chk-mode-b-axis"
                      className="h-3.5 w-3.5 rounded accent-indigo-600"
                    />
                    <span>4방향 축 연장</span>
                  </label>

                  <label
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-medium ${
                      draftModeB.applyAxis
                        ? "cursor-pointer border-slate-300 bg-white text-slate-800"
                        : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={draftModeB.applyAxis && draftModeB.applySafeShrink}
                      disabled={!draftModeB.applyAxis || isRecomputing}
                      onChange={(e) =>
                        setDraftModeB((prev) => ({
                          ...prev,
                          applySafeShrink: e.target.checked,
                        }))
                      }
                      data-testid="chk-mode-b-safe-shrink"
                      className="h-3.5 w-3.5 rounded accent-violet-600"
                    />
                    <span>여유 축 줄이기 (Safe Shrink)</span>
                  </label>

                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={draftModeB.applyDomainExtension}
                      disabled={isRecomputing}
                      onChange={(e) =>
                        setDraftModeB((prev) => ({
                          ...prev,
                          applyDomainExtension: e.target.checked,
                        }))
                      }
                      data-testid="chk-mode-b-domain-ext"
                      className="h-3.5 w-3.5 rounded accent-cyan-600"
                    />
                    <span>그래프 끝점 미세 연장</span>
                  </label>
                </div>
              </div>
            )}

            {/* ② 원본 그림 vs 추천 결과 반응형 비교 영역 */}
            <div
              className="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5"
              data-testid="simple-graph-compare-section"
              data-effective-layout={effectiveCompareLayout}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-800">
                    🖼️ 그림 비교 (적용 전 원본 vs 정돈된 결과)
                  </span>
                  {isRecomputing && (
                    <span className="rounded bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-800">
                      미리보기 업데이트 중...
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* 비교 보기 방식 전환 (자동 / 좌우 / 탭) */}
                  <div
                    className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-[11px]"
                    data-testid="compare-layout-controls"
                  >
                    <button
                      type="button"
                      onClick={() => setCompareLayoutPref("auto")}
                      data-testid="btn-compare-layout-auto"
                      className={`rounded px-2 py-0.5 font-semibold whitespace-nowrap ${
                        compareLayoutPref === "auto"
                          ? "bg-white text-slate-900 shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      자동 ({isNarrowViewport ? "탭" : "좌우"})
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompareLayoutPref("two-col")}
                      data-testid="btn-compare-layout-twocol"
                      className={`rounded px-2 py-0.5 font-semibold whitespace-nowrap ${
                        compareLayoutPref === "two-col"
                          ? "bg-white text-slate-900 shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      좌우 나란히
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompareLayoutPref("single-tab")}
                      data-testid="btn-compare-layout-tab"
                      className={`rounded px-2 py-0.5 font-semibold whitespace-nowrap ${
                        compareLayoutPref === "single-tab"
                          ? "bg-white text-slate-900 shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      탭 전환 크게 보기
                    </button>
                  </div>

                  {/* 확대 배율 (100% / 115% / 130%) */}
                  <div
                    className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-[11px]"
                    data-testid="compare-zoom-controls"
                  >
                    {([100, 115, 130] as const).map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setCompareZoomPct(pct)}
                        data-testid={`btn-compare-zoom-${pct}`}
                        className={`rounded px-2 py-0.5 font-semibold whitespace-nowrap ${
                          compareZoomPct === pct
                            ? "bg-white text-indigo-700 shadow-xs"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {effectiveCompareLayout === "two-col" ? (
                <div
                  className="grid grid-cols-1 gap-3 md:grid-cols-2"
                  data-testid="compare-two-column-grid"
                >
                  <div
                    className="rounded-lg border border-slate-200 bg-slate-50 p-2.5"
                    data-testid="compare-original-panel"
                  >
                    <div className="mb-1.5 flex items-center justify-between text-xs font-bold text-slate-700">
                      <span>원본 그림</span>
                      <span className="text-[11px] font-normal text-slate-500">현재 편집기 상태</span>
                    </div>
                    <div className="flex min-h-[200px] items-center justify-center overflow-auto rounded border border-slate-200 bg-white p-2">
                      {activeProposal.preview?.originalSvgDataUri ? (
                        <img
                          src={activeProposal.preview.originalSvgDataUri}
                          alt="Original TikZ Preview"
                          className={`${imgMaxHeightClass} w-auto object-contain transition-all`}
                        />
                      ) : (
                        <span className="text-xs text-slate-400">원본 미리보기 없음</span>
                      )}
                    </div>
                  </div>

                  <div
                    className="rounded-lg border border-indigo-200 bg-indigo-50/35 p-2.5"
                    data-testid="compare-recommended-panel"
                  >
                    <div className="mb-1.5 flex items-center justify-between text-xs font-bold text-indigo-950">
                      <span>추천 결과 미리보기</span>
                      <span className="text-[11px] font-normal text-indigo-700">
                        {activeProposal.canApply ? "정돈된 미리보기" : "원본 배치 유지 중"}
                      </span>
                    </div>
                    <div className="flex min-h-[200px] items-center justify-center overflow-auto rounded border border-indigo-200 bg-white p-2">
                      {activeProposal.preview?.recommendedSvgDataUri ? (
                        <img
                          src={activeProposal.preview.recommendedSvgDataUri}
                          alt="Recommended TikZ Preview"
                          className={`${imgMaxHeightClass} w-auto object-contain transition-all`}
                        />
                      ) : (
                        <span className="text-xs text-slate-400">추천 미리보기 없음</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2" data-testid="compare-single-tab-box">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCompareActiveTab("recommended")}
                      data-testid="btn-compare-tab-recommended"
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold whitespace-nowrap ${
                        compareActiveTab === "recommended"
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      ✨ 추천 결과 보기
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompareActiveTab("original")}
                      data-testid="btn-compare-tab-original"
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold whitespace-nowrap ${
                        compareActiveTab === "original"
                          ? "border-slate-800 bg-slate-800 text-white"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      원본 그림 보기
                    </button>
                  </div>

                  <div className="flex min-h-[220px] items-center justify-center overflow-auto rounded-lg border border-indigo-200 bg-white p-3">
                    {compareActiveTab === "recommended" ? (
                      activeProposal.preview?.recommendedSvgDataUri ? (
                        <img
                          src={activeProposal.preview.recommendedSvgDataUri}
                          alt="Recommended TikZ Preview"
                          className={`${imgMaxHeightClass} w-auto object-contain`}
                        />
                      ) : (
                        <span className="text-xs text-slate-400">추천 미리보기 없음</span>
                      )
                    ) : activeProposal.preview?.originalSvgDataUri ? (
                      <img
                        src={activeProposal.preview.originalSvgDataUri}
                        alt="Original TikZ Preview"
                        className={`${imgMaxHeightClass} w-auto object-contain`}
                      />
                    ) : (
                      <span className="text-xs text-slate-400">원본 미리보기 없음</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ③ 필요한 대응 관계만 선택 (해당 그림에서 감지된 경우에만 노출) */}
            {showSimpleCorrespondenceSection && (
              <div
                className="rounded-xl border border-amber-300 bg-amber-50/45 p-3.5 space-y-3"
                data-testid="simple-correspondence-section"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold text-slate-900">
                    🔀 확인이 필요한 라벨 배치 선택 (기본값: 원본 배치 유지)
                  </div>
                  <span
                    className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-900"
                    data-testid="correspondence-candidate-disclaimer"
                  >
                    후보 배치는 기하·근접성 기반 추정 후보이며, 최종 판단은 그림을 보고 선택합니다.
                  </span>
                </div>

                {/* Type 2: 추상 함수 라벨이 여러 개인 경우 */}
                {showMaConfirmCard && maOpt && (
                  <div
                    className="rounded-lg border border-slate-200 bg-white p-3 space-y-2.5"
                    data-testid="simple-multi-abstract-cards"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className="text-xs font-bold text-slate-900">
                        📐 함수 이름 배치 선택 ({(maOpt.correspondenceRows || []).map((r) => r.label).join(", ") || "다중 추상 함수"})
                      </span>
                      <span className="text-[11px] text-slate-500">
                        카드를 눌러 위 미리보기에서 배치를 바로 비교하세요
                      </span>
                    </div>

                    {maOpt.classificationCode === "type3-hold-only" && (
                      <div
                        className="rounded border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-900"
                        data-testid="multi-abstract-type3-lock-banner"
                      >
                        🔒 곡선 간 거리가 너무 가까워 자동 배치가 잠겼습니다. 원본 배치를 유지합니다.
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                      {(
                        [
                          {
                            mode: "hold" as const,
                            testId: "btn-multi-abstract-hold",
                            title: "원본 배치",
                            badge: "기본 선택",
                            desc: "원래 있던 함수 이름 위치를 그대로 유지합니다.",
                            enabled: true,
                            thumbUri: maOpt.variants?.hold?.preview?.recommendedSvgDataUri,
                          },
                          {
                            mode: "recommend" as const,
                            testId: "btn-multi-abstract-recommend",
                            title: "추천 배치",
                            badge: "후보 1",
                            desc: "가까운 곡선에 맞춘 첫 번째 후보 배치입니다.",
                            enabled: Boolean(maOpt.canRecommend),
                            thumbUri: maOpt.variants?.recommend?.preview?.recommendedSvgDataUri,
                          },
                          {
                            mode: "swap" as const,
                            testId: "btn-multi-abstract-swap",
                            title: "반대 배치",
                            badge: "후보 2",
                            desc: "두 함수 이름의 대응 곡선을 서로 바꾼 후보 배치입니다.",
                            enabled: Boolean(maOpt.canSwap),
                            thumbUri: maOpt.variants?.swap?.preview?.recommendedSvgDataUri,
                          },
                        ] as const
                      ).map((card) => {
                        const isSelected = effectiveMaAction === card.mode;
                        return (
                          <button
                            key={card.mode}
                            type="button"
                            disabled={!card.enabled || isRecomputing}
                            onClick={() => handleSelectMaAction(card.mode)}
                            data-testid={card.testId}
                            className={`flex flex-col justify-between rounded-xl border p-2.5 text-left transition ${
                              !card.enabled
                                ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                                : isSelected
                                ? "border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-600/20 text-slate-900"
                                : "border-slate-200 bg-white hover:border-indigo-300 text-slate-800"
                            }`}
                          >
                            <div className="w-full space-y-1.5">
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-xs font-bold">{card.title}</span>
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                    isSelected
                                      ? "bg-indigo-600 text-white"
                                      : "bg-slate-100 text-slate-600"
                                  }`}
                                >
                                  {card.badge}
                                </span>
                              </div>
                              {card.thumbUri && (
                                <div className="flex h-24 items-center justify-center overflow-hidden rounded border border-slate-200 bg-white p-1">
                                  <img
                                    src={card.thumbUri}
                                    alt={card.title}
                                    className="max-h-full w-auto object-contain"
                                  />
                                </div>
                              )}
                              <p className="text-[11px] leading-snug text-slate-600">{card.desc}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* D-3: 직선 이름(l, m)이 여러 개인 경우 */}
                {showLnConfirmCard && lnOpt && (
                  <div
                    className="rounded-lg border border-slate-200 bg-white p-3 space-y-2.5"
                    data-testid="simple-line-name-cards"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className="text-xs font-bold text-slate-900">
                        📏 직선 이름(l, m) 배치 선택
                      </span>
                      <span className="text-[11px] text-slate-500">
                        함수 이름 선택과 독립적으로 조합할 수 있습니다
                      </span>
                    </div>

                    {lnOpt.d3SubType === "D3-3" && (
                      <div
                        className="rounded border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-900"
                        data-testid="line-name-d3-3-lock-banner"
                      >
                        🔒 직선이 3개 이상이거나 모호하여 원본 배치를 안전하게 유지합니다.
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                      {(
                        [
                          {
                            mode: "hold" as const,
                            testId: "btn-line-name-hold",
                            title: "원본 배치",
                            badge: "기본 선택",
                            desc: "원래 있던 직선 이름(l, m) 위치를 그대로 유지합니다.",
                            enabled: true,
                            thumbUri: lnOpt.variants?.hold?.preview?.recommendedSvgDataUri,
                          },
                          {
                            mode: "recommend" as const,
                            testId: "btn-line-name-recommend",
                            title: "추천 배치",
                            badge: "후보 1",
                            desc: "각 직선의 끝점 옆 열린 공간에 맞춘 첫 번째 후보입니다.",
                            enabled: Boolean(lnOpt.canRecommend),
                            thumbUri: lnOpt.variants?.recommend?.preview?.recommendedSvgDataUri,
                          },
                          {
                            mode: "swap" as const,
                            testId: "btn-line-name-swap",
                            title: "반대 배치",
                            badge: "후보 2",
                            desc: "l과 m의 대응 직선을 서로 바꾼 두 번째 후보입니다.",
                            enabled: Boolean(lnOpt.canSwap),
                            thumbUri: lnOpt.variants?.swap?.preview?.recommendedSvgDataUri,
                          },
                        ] as const
                      ).map((card) => {
                        const isSelected = effectiveLnAction === card.mode;
                        return (
                          <button
                            key={card.mode}
                            type="button"
                            disabled={!card.enabled || isRecomputing}
                            onClick={() => handleSelectLnAction(card.mode)}
                            data-testid={card.testId}
                            className={`flex flex-col justify-between rounded-xl border p-2.5 text-left transition ${
                              !card.enabled
                                ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                                : isSelected
                                ? "border-sky-600 bg-sky-50/70 ring-2 ring-sky-600/20 text-slate-900"
                                : "border-slate-200 bg-white hover:border-sky-300 text-slate-800"
                            }`}
                          >
                            <div className="w-full space-y-1.5">
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-xs font-bold">{card.title}</span>
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                    isSelected
                                      ? "bg-sky-600 text-white"
                                      : "bg-slate-100 text-slate-600"
                                  }`}
                                >
                                  {card.badge}
                                </span>
                              </div>
                              {card.thumbUri && (
                                <div className="flex h-24 items-center justify-center overflow-hidden rounded border border-slate-200 bg-white p-1">
                                  <img
                                    src={card.thumbUri}
                                    alt={card.title}
                                    className="max-h-full w-auto object-contain"
                                  />
                                </div>
                              )}
                              <p className="text-[11px] leading-snug text-slate-600">{card.desc}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 본문: 상세 검수 모드 (C) — 기존 개발자용 진단·수치·코드 비교 100% 보존 */}
        {activeUiMode === "C" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4" data-testid="smart-label-mode-c-body">
          {/* 상태 배너 */}
          <div
            className={`rounded-lg border p-3.5 text-xs ${statusTone}`}
            data-testid="smart-label-status-banner"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 font-bold mb-1">
              <span>[{statusLabel}]</span>
              <span className="text-[11px] font-normal">
                이동 추천: {activeProposal.movedCount}개 (함수식{" "}
                {activeProposal.fnMovedCount ?? activeProposal.movedCount}개
                {typeof activeProposal.tickMovedCount === "number" &&
                activeProposal.tickMovedCount > 0
                  ? ` · 눈금 ${activeProposal.tickMovedCount}개`
                  : ""}
                {typeof activeProposal.originMovedCount === "number" &&
                activeProposal.originMovedCount > 0
                  ? ` · 원점 O ${activeProposal.originMovedCount}개`
                  : ""}
                {typeof activeProposal.pointLabelMovedCount === 'number' && activeProposal.pointLabelMovedCount > 0 ? ' · 점 이름 ' + activeProposal.pointLabelMovedCount + '개' : ''}{typeof activeProposal.axisLetterMovedCount === 'number' && activeProposal.axisLetterMovedCount > 0 ? ' · 축 문자 ' + activeProposal.axisLetterMovedCount + '개' : ''}{typeof activeProposal.lineNameMovedCount === 'number' && activeProposal.lineNameMovedCount > 0 ? ' · 직선 이름 ' + activeProposal.lineNameMovedCount + '개' : ''}) · 원본 유지: {activeProposal.heldCount}개 · 끝점 연장:
                {activeProposal.domainExtensionOption?.editsCount ?? 0}개 · 축 조정:{" "}
                {activeProposal.axisOption?.editsCount ?? 0}개
                {activeProposal.safeShrinkOption?.applied
                  ? ` (축소 -${activeProposal.safeShrinkOption.shrunkPt}pt)`
                  : ""}{" "}
                · 2차 검증: {activeProposal.verified ? "통과 (Verified)" : "미적용"}
              </span>
            </div>
            <p className="leading-relaxed" data-testid="smart-label-status-message">
              {activeProposal.message}
            </p>
          </div>

          {/* Unit 3-B 서버 비활성화 상태 안내 배너 */}
          {activeEngineVersion === "v0.2.2-beta" && !effectiveUnit3BServerEnabled && (
            <div
              className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-medium text-amber-900"
              data-testid="smart-label-unit3b-disabled-banner"
            >
              ℹ️ <strong>Unit 3-B 비활성 상태 안내:</strong> {effectiveUnit3BDisabledReason}
            </div>
          )}

          {/* 에디터 코드 중간 변경 경고 */}
          {isStale && (
            <div
              className="rounded-lg border border-rose-400 bg-rose-50 p-3.5 text-xs font-semibold text-rose-800"
              data-testid="smart-label-stale-warning"
            >
              ⚠️ 추천 계산 도중 또는 미리보기 표시 중에 에디터 TikZ 코드가 변경되었습니다. 이전 추천 결과를 적용할 수 없으니 창을 닫고 다시 실행해 주세요.
            </div>
          )}

          {/* 축 길이 자동 조정 상태 카드 */}
          {activeProposal.axisOption && (
            <div
              className={`rounded-lg border p-3.5 text-xs ${
                activeProposal.axisOption.status === "applied"
                  ? "border-indigo-200 bg-indigo-50/60 text-indigo-950"
                  : activeProposal.axisOption.status === "blocked-unsafe"
                  ? "border-rose-300 bg-rose-50 text-rose-900"
                  : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
              data-testid="smart-label-axis-option-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 font-bold mb-1">
                <span>
                  📏 x축·y축 길이 자동 조정 옵션:{" "}
                  {activeProposal.axisOption.requested ? "ON (활성화)" : "OFF (기본 labelOnly)"}
                </span>
                <span className="rounded bg-white/80 px-2 py-0.5 text-[10px] font-semibold border border-slate-200 text-slate-600">
                  {activeProposal.axisOption.modeNote}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed mb-1.5">
                {activeProposal.axisOption.message}
              </p>
              {(activeProposal.axisOption.x?.changed || activeProposal.axisOption.y?.changed) && (
                <div className="mt-2 space-y-1">
                  {activeProposal.axisOption.x?.changed && (
                    <div className="flex flex-wrap items-center gap-2 rounded bg-white px-2.5 py-1.5 text-[11px] font-mono border border-indigo-200 text-slate-800">
                      <span className="font-bold text-indigo-700">x축 구간 변경:</span>
                      <span className="text-slate-500">
                        [{activeProposal.axisOption.x.old[0]}, {activeProposal.axisOption.x.old[1]}]
                      </span>
                      <span className="text-indigo-600 font-bold">➔</span>
                      <span className="font-semibold text-emerald-700">
                        [{activeProposal.axisOption.x.new[0]}, {activeProposal.axisOption.x.new[1]}]
                      </span>
                    </div>
                  )}
                  {activeProposal.axisOption.y?.changed && (
                    <div className="flex flex-wrap items-center gap-2 rounded bg-white px-2.5 py-1.5 text-[11px] font-mono border border-indigo-200 text-slate-800">
                      <span className="font-bold text-indigo-700">y축 구간 변경:</span>
                      <span className="text-slate-500">
                        [{activeProposal.axisOption.y.old[0]}, {activeProposal.axisOption.y.old[1]}]
                      </span>
                      <span className="text-indigo-600 font-bold">➔</span>
                      <span className="font-semibold text-emerald-700">
                        [{activeProposal.axisOption.y.new[0]}, {activeProposal.axisOption.y.new[1]}]
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 안전한 축 길이 자동 축소 (Safe Shrink) 상태 카드 (v0.2.2-beta 전용) */}
          {activeEngineVersion === "v0.2.2-beta" && activeProposal.safeShrinkOption && (
            <div
              className={`rounded-lg border p-3.5 text-xs ${
                activeProposal.safeShrinkOption.status === "applied"
                  ? "border-violet-300 bg-violet-50/60 text-violet-950"
                  : activeProposal.safeShrinkOption.status === "held-safety-fallback"
                  ? "border-amber-300 bg-amber-50/60 text-amber-950"
                  : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
              data-testid="smart-label-safe-shrink-option-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 font-bold mb-1">
                <span>
                  ✂️ 축 길이 안전하게 줄이기 옵션:{" "}
                  {activeProposal.safeShrinkOption.requested
                    ? activeProposal.safeShrinkOption.applied
                      ? `ON (적용됨 · 총 -${activeProposal.safeShrinkOption.shrunkPt}pt 안전 축소)`
                      : "ON (활성화 · 모든 방향 안전 보류 Hold)"
                    : "OFF (기본 원본 축 범위 유지)"}
                </span>
                <span className="rounded bg-white/80 px-2 py-0.5 text-[10px] font-semibold border border-slate-200 text-slate-600">
                  {activeProposal.safeShrinkOption.modeNote}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed mb-1.5">
                {activeProposal.safeShrinkOption.message}
              </p>
              {activeProposal.safeShrinkOption.requested &&
                activeProposal.safeShrinkOption.directions &&
                Object.keys(activeProposal.safeShrinkOption.directions).length > 0 && (
                  <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {(["left", "right", "bottom", "top"] as const).map((dirKey) => {
                      const d = activeProposal.safeShrinkOption?.directions?.[dirKey];
                      if (!d) return null;
                      const dirLabel =
                        dirKey === "left"
                          ? "-x (왼쪽)"
                          : dirKey === "right"
                          ? "+x (오른쪽)"
                          : dirKey === "bottom"
                          ? "-y (아래쪽)"
                          : "+y (위쪽)";
                      return (
                        <div
                          key={`shrink-dir-${dirKey}`}
                          data-testid={`smart-label-safe-shrink-dir-${dirKey}`}
                          className={`rounded border px-2.5 py-1.5 text-[11px] ${
                            d.action === "shrink"
                              ? "border-violet-200 bg-white text-slate-800"
                              : d.action === "extend"
                              ? "border-indigo-200 bg-white text-slate-800"
                              : "border-slate-200 bg-white/70 text-slate-600"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1.5 mb-0.5">
                            <span className="font-bold text-slate-800">{dirLabel}</span>
                            {d.action === "shrink" ? (
                              <span className="rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                안전 축소: {d.origMath} ➔ {d.newMath} (-{d.shrunkPt}pt)
                              </span>
                            ) : d.action === "extend" ? (
                              <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                축 연장: {d.origMath} ➔ {d.newMath} (+{d.extendedPt}pt)
                              </span>
                            ) : (
                              <span className="rounded bg-slate-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                원본 유지 ({d.origMath} · Hold)
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-600 leading-relaxed">
                            {d.propFloorApplied && (
                              <span className="mr-1 rounded bg-amber-100 px-1 py-0.5 font-semibold text-amber-900">
                                비례 하한 가드 적용
                              </span>
                            )}
                            {d.reason}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
            </div>
          )}

          {/* 점 이름(유형 A) 겹침 자동 정렬 상태 카드 (v0.2.2-beta 전용) */}
          {activeEngineVersion === "v0.2.2-beta" && activeProposal.pointLabelOption && (
            <div
              className={`rounded-lg border p-3.5 text-xs ${
                activeProposal.pointLabelOption.status === "applied"
                  ? "border-teal-300 bg-teal-50/60 text-teal-950"
                  : activeProposal.pointLabelOption.status === "blocked-unsafe"
                  ? "border-rose-300 bg-rose-50 text-rose-900"
                  : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
              data-testid="smart-label-point-label-option-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 font-bold mb-1">
                <span>
                  📍 점 이름 겹침 자동 정렬 옵션:{" "}
                  {activeProposal.pointLabelOption.requested
                    ? `ON (활성화 · 이동 추천 ${activeProposal.pointLabelOption.movedCount}개 / 원본 유지 ${activeProposal.pointLabelOption.heldCount}개)`
                    : "OFF (기본 원본 점 이름 위치 유지)"}
                </span>
                <span className="rounded bg-white/80 px-2 py-0.5 text-[10px] font-semibold border border-slate-200 text-slate-600">
                  {activeProposal.pointLabelOption.modeNote}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed mb-1.5">
                {activeProposal.pointLabelOption.message}
              </p>
              {activeProposal.pointLabelOption.requested &&
                activeProposal.pointLabelOption.items &&
                activeProposal.pointLabelOption.items.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {activeProposal.pointLabelOption.items.map((pItem) => (
                      <div
                        key={`pt-opt-${pItem.id}`}
                        data-testid="smart-label-point-label-option-item"
                        className={`rounded border px-2.5 py-1.5 text-[11px] ${
                          pItem.autoModified
                            ? "border-teal-200 bg-white text-slate-800"
                            : "border-slate-200 bg-white/70 text-slate-600"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-white">
                              {pItem.label}
                            </code>
                            <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-900">
                              유형 A 점 이름{pItem.coordTikz ? ` (${pItem.coordTikz[0]}, ${pItem.coordTikz[1]})` : ""}
                            </span>
                            {pItem.autoModified ? (
                              <>
                                <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                  이동 추천: [{pItem.origShift[0]}, {pItem.origShift[1]}]pt ➔ [
                                  {pItem.newShift[0]}, {pItem.newShift[1]}]pt
                                </span>
                                {pItem.nearestDir && (
                                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-900">
                                    방향: {pItem.nearestDir}
                                  </span>
                                )}
                                {typeof pItem.markerGapPt === "number" && (
                                  <span className="font-mono text-[10px] text-slate-600">
                                    마커 간격: {pItem.markerGapPt}pt
                                  </span>
                                )}
                              </>
                            ) : (
                              <>
                                <span className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                  원본 유지 (Hold · shift=[{pItem.origShift[0]}, {pItem.origShift[1]}]pt)
                                </span>
                                {pItem.origDirOption && (
                                  <span className="text-[10px] text-slate-500">
                                    (방향: {pItem.origDirOption})
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        <div className="text-[11px] text-slate-600 leading-relaxed">{pItem.reason}</div>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          )}

          {/* 축 문자(D-2: a, b, c, \alpha, \beta 등) 겹침 자동 정렬 상태 카드 (v0.2.2-beta 전용) */}
          {activeEngineVersion === "v0.2.2-beta" && proposal.axisLetterOption && (
            <div
              className={`rounded-lg border p-3.5 text-xs ${
                proposal.axisLetterOption.status === "applied"
                  ? "border-purple-300 bg-purple-50/60 text-purple-950"
                  : proposal.axisLetterOption.status === "blocked-unsafe"
                  ? "border-rose-300 bg-rose-50 text-rose-900"
                  : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
              data-testid="smart-label-axis-letter-option-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 font-bold mb-1">
                <span>
                  🔤 축 문자 눈금(D-2) 자동 정렬 옵션:{" "}
                  {proposal.axisLetterOption.requested ? "ON (활성화)" : "OFF (기본 원본 축 문자 위치 유지)"}
                </span>
                <span className="rounded bg-white/80 px-2 py-0.5 text-[10px] font-semibold border border-slate-200 text-slate-600">
                  {proposal.axisLetterOption.modeNote}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed mb-1.5">
                {proposal.axisLetterOption.message}
              </p>
              {proposal.axisLetterOption.requested &&
                proposal.axisLetterOption.items &&
                proposal.axisLetterOption.items.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {proposal.axisLetterOption.items.map((aItem) => (
                      <div
                        key={`al-opt-${aItem.id}`}
                        data-testid="smart-label-axis-letter-item"
                        className={`rounded border px-2.5 py-1.5 text-[11px] ${
                          aItem.autoModified
                            ? "border-purple-200 bg-white text-slate-800"
                            : "border-slate-200 bg-white/70 text-slate-600"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-white">
                              {aItem.label}
                            </code>
                            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-900">
                              {aItem.subTypeCode || "D-2 축 문자"} ({aItem.axisName || "?"}축)
                            </span>
                            {aItem.autoModified ? (
                              <>
                                <span className="rounded bg-purple-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                  이동 추천: [{aItem.origShift[0]}, {aItem.origShift[1]}]pt ➔ [
                                  {aItem.newShift[0]}, {aItem.newShift[1]}]pt
                                </span>
                                {aItem.moveDirDesc && (
                                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-900">
                                    방향: {aItem.moveDirDesc}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                원본 유지 (Hold · shift=[{aItem.origShift[0]}, {aItem.origShift[1]}]pt)
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-[11px] text-slate-600 leading-relaxed">{aItem.reason}</div>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          )}

          {/* 직선 이름(D-3: l, m, n, \ell) 자동 정렬 및 D3-2 대응 확인 카드 (v0.2.2-beta 전용) */}
          {activeEngineVersion === "v0.2.2-beta" && lnOpt && (
            <div
              className={`rounded-lg border p-3.5 text-xs ${
                lnOpt.status === "applied"
                  ? "border-sky-300 bg-sky-50/60 text-sky-950"
                  : lnOpt.status === "user-confirm-hold"
                  ? "border-amber-300 bg-amber-50/60 text-amber-950"
                  : lnOpt.status === "held-d3-3" || lnOpt.status === "blocked-unsafe"
                  ? "border-rose-300 bg-rose-50 text-rose-900"
                  : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
              data-testid="smart-label-line-name-option-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 font-bold mb-1">
                <span>
                  📏 직선 이름(l, m, n, \ell) 자동 정렬 옵션(D-3):{" "}
                  {lnOpt.requested
                    ? `ON (활성화${lnOpt.d3SubType ? ` · ${lnOpt.d3SubType}` : ""})`
                    : "OFF (기본 원본 직선 이름 위치 유지)"}
                </span>
                <span className="rounded bg-white/80 px-2 py-0.5 text-[10px] font-semibold border border-slate-200 text-slate-600">
                  {lnOpt.modeNote}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed mb-1.5">
                {lnOpt.message}
              </p>

              {/* D3-2 (2직선 l, m) 사용자 확인 UI: Hold / Recommend / Swap */}
              {lnOpt.requested && lnOpt.d3SubType === "D3-2" && lnOpt.requiresUserApproval && (
                <div
                  className="mt-2.5 rounded-lg border border-sky-200 bg-white p-3 space-y-2.5"
                  data-testid="smart-label-line-name-d3-2-confirm-box"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-[11px] text-slate-900">
                      🔀 2직선 이름(l, m) ↔ 직선 대응 확인 (D3-2: 기본 원본 유지 Hold)
                    </span>
                    <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                      추상 함수(유형 2)와 독립 선택 · 가시 끝점(visible tip) 기준 배치
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      disabled={isRecomputing}
                      onClick={() => handleSelectLnAction("hold")}
                      data-testid="btn-line-name-hold"
                      className={`rounded-lg border px-3 py-2 text-left transition ${
                        effectiveLnAction === "hold"
                          ? "border-slate-800 bg-slate-900 text-white shadow-sm"
                          : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 font-bold text-[11px]">
                        <span>③ 원본 유지 (Hold)</span>
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
                          기본 선택
                        </span>
                      </div>
                      <div
                        className={`mt-0.5 text-[10px] ${
                          effectiveLnAction === "hold" ? "text-slate-300" : "text-slate-500"
                        }`}
                      >
                        직선 이름(l, m)을 이동하지 않고 원본 위치를 안전하게 보존합니다.
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={!lnOpt.canRecommend || isRecomputing}
                      onClick={() => handleSelectLnAction("recommend")}
                      data-testid="btn-line-name-recommend"
                      className={`rounded-lg border px-3 py-2 text-left transition ${
                        !lnOpt.canRecommend
                          ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                          : effectiveLnAction === "recommend"
                          ? "border-sky-700 bg-sky-700 text-white shadow-sm"
                          : "border-sky-300 bg-white text-slate-800 hover:bg-sky-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 font-bold text-[11px]">
                        <span>① 추천 배치 적용 (Recommend)</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                            !lnOpt.canRecommend
                              ? "bg-slate-200 text-slate-500"
                              : effectiveLnAction === "recommend"
                              ? "bg-white/20 text-white"
                              : "bg-sky-100 text-sky-800"
                          }`}
                        >
                          {lnOpt.canRecommend ? "2차 검증 통과" : "비활성"}
                        </span>
                      </div>
                      <div
                        className={`mt-0.5 text-[10px] ${
                          !lnOpt.canRecommend
                            ? "text-slate-400"
                            : effectiveLnAction === "recommend"
                            ? "text-sky-100"
                            : "text-slate-500"
                        }`}
                      >
                        주석 힌트 및 전역 최소 거리 1:1 매칭 기반 가시 끝점 자연 배치를 표시합니다.
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={!lnOpt.canSwap || isRecomputing}
                      onClick={() => handleSelectLnAction("swap")}
                      data-testid="btn-line-name-swap"
                      className={`rounded-lg border px-3 py-2 text-left transition ${
                        !lnOpt.canSwap
                          ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                          : effectiveLnAction === "swap"
                          ? "border-indigo-700 bg-indigo-700 text-white shadow-sm"
                          : "border-indigo-300 bg-white text-slate-800 hover:bg-indigo-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 font-bold text-[11px]">
                        <span>② 대응 직선 교환 (Swap)</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                            !lnOpt.canSwap
                              ? "bg-slate-200 text-slate-500"
                              : effectiveLnAction === "swap"
                              ? "bg-white/20 text-white"
                              : "bg-indigo-100 text-indigo-800"
                          }`}
                        >
                          {lnOpt.canSwap ? "1클릭 반전 검증됨" : "비활성"}
                        </span>
                      </div>
                      <div
                        className={`mt-0.5 text-[10px] ${
                          !lnOpt.canSwap
                            ? "text-slate-400"
                            : effectiveLnAction === "swap"
                            ? "text-indigo-100"
                            : "text-slate-500"
                        }`}
                      >
                        l과 m의 대응 직선을 1:1 교환하여 재계산한 끝점 배치를 표시합니다.
                      </div>
                    </button>
                  </div>

                  {lnOpt.correspondenceRows && lnOpt.correspondenceRows.length > 0 && (
                    <div
                      className="rounded border border-slate-200 bg-slate-50/70 p-2 space-y-1.5"
                      data-testid="line-name-correspondence-table"
                    >
                      {lnOpt.correspondenceRows.map((row) => {
                        const activeCell =
                          effectiveLnAction === "recommend"
                            ? row.recommend
                            : effectiveLnAction === "swap"
                            ? row.swap
                            : null;
                        return (
                          <div
                            key={`ln-row-${row.nodeId}`}
                            data-testid="line-name-correspondence-row"
                            className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px]"
                          >
                            <div className="flex flex-wrap items-center gap-1.5">
                              <code className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-mono text-white">
                                {row.label}
                              </code>
                              {activeCell ? (
                                <>
                                  <span className="font-semibold text-sky-800">
                                    ➔ 직선 #{activeCell.strokeIndex ?? "?"}{" "}
                                    {activeCell.lineDesc ? `(${activeCell.lineDesc})` : ""}
                                  </span>
                                  <span className="rounded bg-sky-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                    shift: [{row.origShift[0]}, {row.origShift[1]}]pt ➔ [
                                    {activeCell.shift[0]}, {activeCell.shift[1]}]pt
                                  </span>
                                </>
                              ) : (
                                <span className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                  원본 유지 (Hold · shift=[{row.origShift[0]}, {row.origShift[1]}]pt)
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 개별 직선 이름 항목 리스트 (D3-1 / D3-2 / D3-3) */}
              {lnOpt.requested && lnOpt.items && lnOpt.items.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {lnOpt.items.map((lnItem) => (
                    <div
                      key={`ln-opt-${lnItem.id}`}
                      data-testid="smart-label-line-name-item"
                      className={`rounded border px-2.5 py-1.5 text-[11px] ${
                        lnItem.autoModified
                          ? "border-sky-200 bg-white text-slate-800"
                          : "border-slate-200 bg-white/70 text-slate-600"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-white">
                            {lnItem.label}
                          </code>
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-900">
                            {lnItem.subTypeCode || lnItem.d3Category || "D-3 직선 이름"}
                            {lnItem.matchedLineDesc ? ` · ${lnItem.matchedLineDesc}` : ""}
                          </span>
                          {lnItem.autoModified ? (
                            <span className="rounded bg-sky-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                              이동 추천: [{lnItem.origShift[0]}, {lnItem.origShift[1]}]pt ➔ [
                              {lnItem.newShift[0]}, {lnItem.newShift[1]}]pt
                            </span>
                          ) : (
                            <span className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                              원본 유지 (Hold · shift=[{lnItem.origShift[0]}, {lnItem.origShift[1]}]pt)
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-600 leading-relaxed">{lnItem.reason}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 그래프 끝점(domain) 미세 연장 상태 카드 (v0.2.2-beta 전용) */}
          {activeEngineVersion === "v0.2.2-beta" && proposal.domainExtensionOption && (
            <div
              className={`rounded-lg border p-3.5 text-xs ${
                proposal.domainExtensionOption.status === "applied"
                  ? "border-cyan-300 bg-cyan-50/60 text-cyan-950"
                  : proposal.domainExtensionOption.status === "held-axis-off"
                  ? "border-amber-300 bg-amber-50/60 text-amber-950"
                  : proposal.domainExtensionOption.status === "blocked-unsafe"
                  ? "border-rose-300 bg-rose-50 text-rose-900"
                  : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
              data-testid="smart-label-domain-extension-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 font-bold mb-1">
                <span>
                  📈 그래프 끝점 미세 연장 옵션:{" "}
                  {proposal.domainExtensionOption.requested ? "ON (활성화)" : "OFF (기본 원본 정의역 유지)"}
                </span>
                <span className="rounded bg-white/80 px-2 py-0.5 text-[10px] font-semibold border border-slate-200 text-slate-600">
                  {proposal.domainExtensionOption.modeNote}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed mb-1.5">
                {proposal.domainExtensionOption.message}
              </p>
              {proposal.domainExtensionOption.requested &&
                proposal.domainExtensionOption.items &&
                proposal.domainExtensionOption.items.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {proposal.domainExtensionOption.items.map((item) => (
                      <div
                        key={`dom-ext-${item.nodeId}`}
                        data-testid="smart-label-domain-extension-item"
                        className={`rounded border px-2.5 py-1.5 text-[11px] ${
                          item.action === "extend"
                            ? "border-cyan-200 bg-white text-slate-800"
                            : item.holdCode === "axis-extension-required"
                            ? "border-amber-300 bg-white text-slate-800"
                            : "border-slate-200 bg-white/70 text-slate-600"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-white">
                              {item.label}
                            </code>
                            {item.action === "extend" && item.origDomain && item.newDomain ? (
                              <>
                                <span className="rounded bg-cyan-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                  끝점 미세 연장 추천
                                </span>
                                <span className="font-mono text-slate-600">
                                  domain=[{item.origDomain[0]}, {item.origDomain[1]}]
                                </span>
                                <span className="font-bold text-cyan-700">➔</span>
                                <span className="font-mono font-semibold text-emerald-700">
                                  domain=[{item.newDomain[0]}, {item.newDomain[1]}]
                                </span>
                                <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-900">
                                  연장 길이: +{item.arcLengthPt}pt
                                </span>
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-900">
                                  라벨-그래프 간격: {item.origOwnGapPt}pt ➔ {item.newOwnGapPt}pt
                                </span>
                              </>
                            ) : (
                              <>
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${
                                    item.holdCode === "axis-extension-required"
                                      ? "bg-amber-600"
                                      : "bg-slate-500"
                                  }`}
                                >
                                  정의역 원본 유지 (Hold)
                                </span>
                                {item.origDomain && (
                                  <span className="font-mono text-slate-500">
                                    domain=[{item.origDomain[0]}, {item.origDomain[1]}]
                                  </span>
                                )}
                                {item.holdCode === "axis-extension-required" && (
                                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                                    축 자동 조정 ON 필요
                                    {item.wouldExtendDomain
                                      ? ` (축 ON 시 [${item.wouldExtendDomain[0]}, ${item.wouldExtendDomain[1]}] 연장 가능)`
                                      : ""}
                                  </span>
                                )}
                                {typeof item.origOwnGapPt === "number" && (
                                  <span className="text-[10px] text-slate-500">
                                    (현재 간격: {item.origOwnGapPt}pt)
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        <div className="text-[11px] text-slate-600 leading-relaxed">{item.reason}</div>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          )}

          {/* 다중 추상 함수 대응 확인 섹션 (유형 2: 사용자 선택 필수 / 유형 3: Hold 강제) */}
          {activeEngineVersion === "v0.2.2-beta" && maOpt?.detected && (
            <div
              className={`rounded-lg border p-3.5 text-xs ${
                maOpt.classificationCode === "type3-hold-only"
                  ? "border-rose-300 bg-rose-50/70 text-rose-950"
                  : effectiveMaAction === "recommend"
                  ? "border-emerald-300 bg-emerald-50/60 text-slate-900"
                  : effectiveMaAction === "swap"
                  ? "border-indigo-300 bg-indigo-50/60 text-slate-900"
                  : "border-amber-300 bg-amber-50/60 text-slate-900"
              }`}
              data-testid="smart-label-multi-abstract-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <div className="flex flex-wrap items-center gap-1.5 font-bold">
                  <span>
                    🔀 다중 추상 함수 대응 확인 ({maOpt.classificationType || "유형 2: 사용자 확인 필요"})
                  </span>
                  <span
                    className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-amber-900"
                    data-testid="multi-abstract-proof-badge"
                  >
                    {maOpt.mathematicallyProven
                      ? "수학적 항등 증명"
                      : "추정 근거 (기하·정의역 전역 1:1 매칭 · 수학적 항등 증명 아님)"}
                  </span>
                  {typeof maOpt.rawDistMarginPt === "number" && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-white">
                      전역 거리 합 우위: +{maOpt.rawDistMarginPt}pt
                    </span>
                  )}
                </div>
                <span className="rounded border border-slate-200 bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                  승인 전 기본값: ③ 원본 유지 (Hold) · 정의역(domain) 불변 잠금
                </span>
              </div>

              <p className="text-[11px] text-slate-700 leading-relaxed mb-2">
                {maOpt.summaryReason}
              </p>

              {maOpt.moderateMarginCaution && (
                <div
                  className="mb-2.5 rounded border border-amber-300 bg-amber-100/80 px-2.5 py-1.5 text-[11px] font-semibold text-amber-950"
                  data-testid="multi-abstract-margin-caution"
                >
                  ⚠️ 주의: 전역 1:1 거리 합 마진(+{maOpt.rawDistMarginPt}pt)이 보통 수준(12~25pt)이므로,
                  하단 [① 추천 매칭]과 [② 대응 관계 교환(Swap)] 미리보기를 대조한 뒤 승인해 주세요.
                </div>
              )}

              {maOpt.classificationCode === "type3-hold-only" && (
                <div
                  className="mb-2.5 rounded border border-rose-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-rose-900"
                  data-testid="multi-abstract-type3-lock-banner"
                >
                  🔒 [유형 3: Hold 강제] {maOpt.holdReason || "근거 부족 또는 교점 인접으로 인해 자동 매칭 및 교환이 비활성화되었습니다."}
                </div>
              )}

              {/* 3대 대응 선택 버튼 (Hold / Recommend / Swap) */}
              <div className="mb-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  disabled={isRecomputing}
                  onClick={() => handleSelectMaAction("hold")}
                  data-testid="btn-multi-abstract-hold"
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    effectiveMaAction === "hold"
                      ? "border-slate-800 bg-slate-900 text-white shadow-sm"
                      : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 font-bold text-[11px]">
                    <span>③ 원본 유지 (Hold)</span>
                    <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
                      기본 선택
                    </span>
                  </div>
                  <div
                    className={`mt-0.5 text-[10px] ${
                      effectiveMaAction === "hold" ? "text-slate-300" : "text-slate-500"
                    }`}
                  >
                    추상 함수 라벨을 이동하지 않고 원본 위치를 안전하게 보존합니다.
                  </div>
                </button>

                <button
                  type="button"
                  disabled={!maOpt.canRecommend || isRecomputing}
                  onClick={() => handleSelectMaAction("recommend")}
                  data-testid="btn-multi-abstract-recommend"
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    !maOpt.canRecommend
                      ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                      : effectiveMaAction === "recommend"
                      ? "border-emerald-700 bg-emerald-700 text-white shadow-sm"
                      : "border-emerald-300 bg-white text-slate-800 hover:bg-emerald-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 font-bold text-[11px]">
                    <span>① 추천 매칭 적용 (Recommend)</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                        !maOpt.canRecommend
                          ? "bg-slate-200 text-slate-500"
                          : effectiveMaAction === "recommend"
                          ? "bg-white/20 text-white"
                          : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {maOpt.canRecommend ? "2차 검증 통과" : "비활성"}
                    </span>
                  </div>
                  <div
                    className={`mt-0.5 text-[10px] ${
                      !maOpt.canRecommend
                        ? "text-slate-400"
                        : effectiveMaAction === "recommend"
                        ? "text-emerald-100"
                        : "text-slate-500"
                    }`}
                  >
                    전역 최소 거리 1:1 대응으로 계산된 추천 위치를 미리보기에 표시합니다.
                  </div>
                </button>

                <button
                  type="button"
                  disabled={!maOpt.canSwap || isRecomputing}
                  onClick={() => handleSelectMaAction("swap")}
                  data-testid="btn-multi-abstract-swap"
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    !maOpt.canSwap
                      ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                      : effectiveMaAction === "swap"
                      ? "border-indigo-700 bg-indigo-700 text-white shadow-sm"
                      : "border-indigo-300 bg-white text-slate-800 hover:bg-indigo-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 font-bold text-[11px]">
                    <span>② 대응 관계 교환 (Swap)</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                        !maOpt.canSwap
                          ? "bg-slate-200 text-slate-500"
                          : effectiveMaAction === "swap"
                          ? "bg-white/20 text-white"
                          : "bg-indigo-100 text-indigo-800"
                      }`}
                    >
                      {maOpt.canSwap ? "1클릭 반전 검증됨" : "비활성"}
                    </span>
                  </div>
                  <div
                    className={`mt-0.5 text-[10px] ${
                      !maOpt.canSwap
                        ? "text-slate-400"
                        : effectiveMaAction === "swap"
                        ? "text-indigo-100"
                        : "text-slate-500"
                    }`}
                  >
                    두 추상 함수의 대응 곡선을 1:1 교환하여 재계산한 안전 위치를 표시합니다.
                  </div>
                </button>
              </div>

              {/* 추상 함수별 대응 곡선 및 재계산 shift 요약 표 */}
              {maOpt.correspondenceRows && maOpt.correspondenceRows.length > 0 && (
                <div
                  className="rounded border border-slate-200 bg-white p-2.5"
                  data-testid="multi-abstract-correspondence-table"
                >
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-slate-800">
                    <span>📋 추상 함수 라벨 ↔ 대응 곡선 및 재계산 위치 비교</span>
                    <span className="text-[10px] font-normal text-slate-500">
                      위 버튼 선택은 모달 미리보기만 변경하며, 하단 [승인 및 적용] 클릭 전까지 에디터 코드는 변경되지 않습니다.
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {maOpt.correspondenceRows.map((row) => {
                      const activeCell =
                        effectiveMaAction === "recommend"
                          ? row.recommend
                          : effectiveMaAction === "swap"
                          ? row.swap
                          : null;
                      return (
                        <div
                          key={`ma-row-${row.nodeId}`}
                          data-testid="multi-abstract-correspondence-row"
                          className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50/80 px-2.5 py-1.5 text-[11px]"
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <code className="rounded bg-slate-900 px-1.5 py-0.5 text-[11px] font-mono text-white">
                              {row.label}
                            </code>
                            {activeCell ? (
                              <>
                                <span className="font-bold text-indigo-700">➔</span>
                                <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-semibold text-indigo-900">
                                  곡선 #{activeCell.strokeIndex} ({activeCell.curveShape || "plot 곡선"})
                                </span>
                                {activeCell.plotExpr && (
                                  <code className="rounded bg-white px-1.5 py-0.5 text-[10px] font-mono border border-slate-200 text-slate-700">
                                    plot: {activeCell.plotExpr}
                                  </code>
                                )}
                                {activeCell.domain && (
                                  <span className="font-mono text-[10px] text-slate-500">
                                    domain=[{activeCell.domain[0]}, {activeCell.domain[1]}] (불변)
                                  </span>
                                )}
                                <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                  선택 shift=[{activeCell.shift[0]}, {activeCell.shift[1]}]pt
                                </span>
                              </>
                            ) : (
                              <span className="rounded bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-white">
                                현재 선택: ③ 원본 유지 (Hold · shift=[{row.origShift[0]}, {row.origShift[1]}]pt)
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-600 font-mono">
                            <span>
                              ①추천: #{row.recommend.strokeIndex} [{row.recommend.shift[0]},{" "}
                              {row.recommend.shift[1]}]pt
                            </span>
                            <span>·</span>
                            <span>
                              ②Swap: #{row.swap.strokeIndex} [{row.swap.shift[0]},{" "}
                              {row.swap.shift[1]}]pt
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 겹침 및 충돌 진단 리포트 */}
          {diag && (
            <div
              className={`rounded-lg border p-3.5 text-xs ${
                diag.counts.newlyIntroduced > 0
                  ? "border-rose-300 bg-rose-50/70"
                  : diag.counts.preExistingUnresolved > 0 || diag.counts.unmeasuredNodes > 0
                  ? "border-amber-300 bg-amber-50/50"
                  : "border-slate-200 bg-white"
              }`}
              data-testid="smart-label-collision-diagnostics"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                <h4 className="text-xs font-bold text-slate-800">
                  🔍 전체 노드 겹침 및 충돌 진단 (함수식 라벨 + 일반 노드 포함)
                </h4>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="rounded bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">
                    해결된 충돌: {diag.counts.resolved}건
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 font-semibold ${
                      diag.counts.preExistingUnresolved > 0
                        ? "bg-amber-200 text-amber-900"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    미해결 충돌 (기존 존재): {diag.counts.preExistingUnresolved}건
                  </span>
                  {typeof diag.counts.finalTrueInk === "number" && (
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                      글자 침범(true-ink): {diag.counts.origTrueInk ?? 0}➔{diag.counts.finalTrueInk}건 · 박스 근접:{" "}
                      {diag.counts.origBboxOnly ?? 0}➔{diag.counts.finalBboxOnly ?? 0}건
                    </span>
                  )}
                  {diag.counts.newlyIntroduced > 0 && (
                    <span className="rounded bg-rose-200 px-2 py-0.5 font-semibold text-rose-900">
                      차단된 신규 충돌: {diag.counts.newlyIntroduced}건
                    </span>
                  )}
                  {diag.counts.unmeasuredNodes > 0 && (
                    <span className="rounded bg-amber-200 px-2 py-0.5 font-semibold text-amber-900">
                      측정 미확인 노드: {diag.counts.unmeasuredNodes}개
                    </span>
                  )}
                </div>
              </div>

              {/* 해결된 충돌 목록 */}
              {diag.resolvedCollisions.length > 0 && (
                <div className="mb-2 space-y-1">
                  <div className="text-[11px] font-bold text-emerald-800">
                    ✅ 이번 정렬로 해결된 겹침 ({diag.resolvedCollisions.length}건)
                  </div>
                  {diag.resolvedCollisions.map((item) => (
                    <div
                      key={`resolved-${item.key}`}
                      className="rounded border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5 text-[11px] text-emerald-900"
                    >
                      <code className="mr-1.5 rounded bg-emerald-800 px-1.5 py-0.5 text-[10px] text-white">
                        {item.nodeLabel}
                      </code>
                      <span>{item.description} ➔ 안전 위치로 이동 완료</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 미해결 충돌 (원본부터 존재) */}
              {diag.preExistingUnresolvedCollisions.length > 0 && (
                <div className="mb-2 space-y-1" data-testid="smart-label-unresolved-collisions">
                  <div className="text-[11px] font-bold text-amber-900">
                    ⚠️ 미해결 충돌 — 원본부터 존재하며 자동 이동으로 해소되지 않은 항목 (
                    {diag.preExistingUnresolvedCollisions.length}건)
                  </div>
                  {diag.preExistingUnresolvedCollisions.map((item) => (
                    <div
                      key={`unresolved-${item.key}`}
                      className="rounded border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] text-amber-950"
                    >
                      <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                        <code className="rounded bg-amber-900 px-1.5 py-0.5 text-[10px] text-white">
                          {item.nodeLabel}
                        </code>
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                          {item.autoMoveTarget
                            ? "함수식 라벨 (원본 위치 유지)"
                            : `일반 노드 (${item.nodeRole}) · 자동 이동 제외 대상`}
                        </span>
                        {item.contactKind && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-700">
                            {item.contactKind === "true-ink-collision"
                              ? "실제 글자 침범(true-ink)"
                              : "박스 여백 근접(bbox-only)"}
                          </span>
                        )}
                      </div>
                      <div className="text-slate-700">
                        원인: {item.description} — {item.reason || "적용 후 조이스틱으로 미세 조정 권장"}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 차단된 신규 충돌 */}
              {diag.newlyIntroducedCollisions.length > 0 && (
                <div className="mb-2 space-y-1" data-testid="smart-label-new-collisions">
                  <div className="text-[11px] font-bold text-rose-900">
                    🛑 안전성 검증에서 차단된 신규 충돌 ({diag.newlyIntroducedCollisions.length}건)
                  </div>
                  {diag.newlyIntroducedCollisions.map((item) => (
                    <div
                      key={`new-${item.key}`}
                      className="rounded border border-rose-300 bg-white px-2.5 py-1.5 text-[11px] text-rose-900"
                    >
                      <code className="mr-1.5 rounded bg-rose-800 px-1.5 py-0.5 text-[10px] text-white">
                        {item.nodeLabel}
                      </code>
                      <span>{item.description} (적용 차단 및 원본 유지)</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 측정 미확인 노드 */}
              {diag.unmeasuredNodes.length > 0 && (
                <div className="space-y-1" data-testid="smart-label-unmeasured-nodes">
                  <div className="text-[11px] font-bold text-amber-900">
                    ⚠️ SVG 바운딩 박스 측정 미확인 노드 ({diag.unmeasuredNodes.length}개)
                  </div>
                  {diag.unmeasuredNodes.map((u) => (
                    <div
                      key={`unmeasured-${u.id}`}
                      className="rounded border border-amber-200 bg-white px-2.5 py-1 text-[11px] text-slate-700"
                    >
                      <code className="mr-1.5 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-white">
                        {u.label}
                      </code>
                      <span>{(u.reasons || [u.reason || ""]).join(" · ")}</span>
                    </div>
                  ))}
                </div>
              )}

              {diag.allCollisionsResolved &&
                diag.measurementComplete &&
                diag.resolvedCollisions.length === 0 &&
                diag.newlyIntroducedCollisions.length === 0 && (
                  <p className="text-[11px] text-slate-600">
                    측정된 모든 함수식 라벨과 일반 노드(x, y, O, 점 라벨 등)에서 겹침이나 선 침범이 감지되지 않았습니다.
                  </p>
                )}
            </div>
          )}

          {/* 원본 vs 추천 결과 SVG 비교 화면 (메인 svgUrl 과 완전히 분리) */}
          {(activeProposal.preview?.originalSvgDataUri ||
            activeProposal.preview?.recommendedSvgDataUri) && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>적용 전 (원본 도형)</span>
                  <span className="text-[11px] font-normal text-slate-500">현재 코드 기준</span>
                </div>
                <div className="flex min-h-[220px] items-center justify-center rounded border border-slate-200 bg-white p-3">
                  {activeProposal.preview.originalSvgDataUri ? (
                    <img
                      src={activeProposal.preview.originalSvgDataUri}
                      alt="Original TikZ Preview"
                      className="max-h-[280px] w-auto object-contain"
                    />
                  ) : (
                    <span className="text-xs text-slate-400">원본 미리보기 없음</span>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
                <div className="mb-2 flex items-center justify-between text-xs font-bold text-indigo-900">
                  <span>
                    적용 후 (
                    {maOpt?.detected
                      ? effectiveMaAction === "recommend"
                        ? "① 추천 매칭 미리보기"
                        : effectiveMaAction === "swap"
                        ? "② 대응 교환(Swap) 미리보기"
                        : "③ 원본 유지(Hold) 미리보기"
                      : "추천 미리보기"}
                    )
                  </span>
                  <span className="text-[11px] font-normal text-indigo-700">
                    {activeProposal.canApply ? "2차 Kroki 렌더 검증 완료" : "변경 없음 (원본 유지)"}
                  </span>
                </div>
                <div className="flex min-h-[220px] items-center justify-center rounded border border-indigo-200 bg-white p-3">
                  {activeProposal.preview.recommendedSvgDataUri ? (
                    <img
                      src={activeProposal.preview.recommendedSvgDataUri}
                      alt="Recommended TikZ Preview"
                      className="max-h-[280px] w-auto object-contain"
                    />
                  ) : (
                    <span className="text-xs text-slate-400">추천 미리보기 없음</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 라벨별 판단 사유 리포트 */}
          {activeProposal.labelDecisions && activeProposal.labelDecisions.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-3.5">
              <h4 className="mb-2.5 text-xs font-bold text-slate-800">
                함수식 라벨별 판단 및 매칭 사유 ({activeProposal.labelDecisions.length}개)
              </h4>
              <div className="space-y-2">
                {activeProposal.labelDecisions.map((dec) => (
                  <div
                    key={dec.id}
                    data-testid="smart-label-decision-item"
                    className={`rounded-md border p-2.5 text-xs ${
                      dec.autoModified
                        ? "border-emerald-200 bg-emerald-50/40"
                        : dec.hasRemainingCollision || dec.hasPreExistingCollision
                        ? "border-amber-300 bg-amber-50/50"
                        : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-mono text-white">
                          {dec.label}
                        </code>
                        {dec.autoModified ? (
                          <span className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                            이동 추천: xshift={dec.shift?.[0] ?? 0}pt, yshift={dec.shift?.[1] ?? 0}pt
                          </span>
                        ) : dec.hasRemainingCollision || dec.hasPreExistingCollision ? (
                          <span className="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-bold text-white">
                            미해결 충돌 · 원본 유지 ({dec.nonMoveCategory || "안전 후보 없음"})
                          </span>
                        ) : (
                          <span className="rounded bg-slate-600 px-2 py-0.5 text-[10px] font-bold text-white">
                            원본 유지 ({dec.nonMoveCategory || "기존 위치 유지"})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                        <span>선택 엔진: {dec.selectedEngine}</span>
                        {dec.how && <span>· 매칭: {dec.how}</span>}
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      {dec.autoModified
                        ? dec.selectionReason || "멀티 엔진 비교 및 안전성 검증 통과"
                        : dec.holdReason || dec.selectionReason || "원본 위치 유지"}
                    </p>
                    {!dec.autoModified &&
                      dec.collisionDescriptions &&
                      dec.collisionDescriptions.length > 0 && (
                        <p className="mt-1 text-[11px] font-semibold text-amber-800">
                          ⚠️ 감지된 기존 겹침: {dec.collisionDescriptions.join(" · ")}
                        </p>
                      )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unit 3-B: 축 눈금 숫자(axis tick) 겹침 판단 리포트 */}
          {proposal.tickDecisions && proposal.tickDecisions.length > 0 && (
            <div
              className="rounded-lg border border-emerald-200 bg-white p-3.5"
              data-testid="smart-label-tick-decisions"
            >
              <h4 className="mb-2.5 text-xs font-bold text-slate-800">
                🎯 Unit 3-B: 축 눈금 숫자 겹침 판단 및 조정 사유 ({proposal.tickDecisions.length}개)
              </h4>
              <div className="space-y-2">
                {proposal.tickDecisions.map((tDec) => (
                  <div
                    key={tDec.id}
                    data-testid="smart-label-tick-decision-item"
                    className={`rounded-md border p-2.5 text-xs ${
                      tDec.autoModified
                        ? "border-emerald-200 bg-emerald-50/40"
                        : "border-amber-300 bg-amber-50/50"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-mono text-white">
                          {tDec.label}
                        </code>
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                          {tDec.axisKind === "x-tick" ? "x축 눈금" : "y축 눈금"}
                        </span>
                        {tDec.autoModified ? (
                          <span className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                            이동 추천: [{tDec.origShift?.[0] ?? 0}, {tDec.origShift?.[1] ?? 0}]pt ➔ [
                            {tDec.shift?.[0] ?? 0}, {tDec.shift?.[1] ?? 0}]pt
                          </span>
                        ) : (
                          <span className="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-bold text-white">
                            보류 · 원본 유지 ({tDec.nonMoveCategory || "안전 후보 없음"})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                        <span>엔진: {tDec.selectedEngine}</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      {tDec.autoModified
                        ? tDec.selectionReason
                        : tDec.holdReason || tDec.selectionReason}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unit 3-D-Origin: 원점 O 전용 4방향 배치 판단 리포트 */}
          {proposal.originDecisions && proposal.originDecisions.length > 0 && (
            <div
              className="rounded-lg border border-indigo-200 bg-white p-3.5"
              data-testid="smart-label-origin-decisions"
            >
              <h4 className="mb-2.5 text-xs font-bold text-slate-800">
                🧭 Unit 3-D: 원점 O 4방향 자동 배치 판단 사유 ({proposal.originDecisions.length}개)
              </h4>
              <div className="space-y-2">
                {proposal.originDecisions.map((oDec) => (
                  <div
                    key={oDec.id}
                    data-testid="smart-label-origin-decision-item"
                    className={`rounded-md border p-2.5 text-xs ${
                      oDec.autoModified
                        ? "border-emerald-200 bg-emerald-50/40"
                        : oDec.action === "hold-no-safe-quadrant"
                        ? "border-amber-300 bg-amber-50/50"
                        : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-mono text-white">
                          {oDec.label}
                        </code>
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-800">
                          원점 (0,0)
                        </span>
                        {oDec.autoModified ? (
                          <span className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                            방향 변경: [{oDec.origAnchor}] ➔ [{oDec.newAnchor}] ({oDec.priorityRank}순위)
                          </span>
                        ) : oDec.action === "hold-no-safe-quadrant" ? (
                          <span className="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-bold text-white">
                            보류 · 원본 유지 ({oDec.nonMoveCategory || "안전 사분면 없음"})
                          </span>
                        ) : (
                          <span className="rounded bg-slate-600 px-2 py-0.5 text-[10px] font-bold text-white">
                            원본 유지 ({oDec.origAnchor || oDec.nonMoveCategory || "무충돌"})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                        <span>엔진: {oDec.selectedEngine}</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      {oDec.autoModified
                        ? oDec.selectionReason
                        : oDec.holdReason || oDec.selectionReason}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unit 3-E: 점 이름(유형 A) 겹침 자동 정렬 판단 리포트 */}
          {activeProposal.pointLabelDecisions && activeProposal.pointLabelDecisions.length > 0 && (
            <div
              className="rounded-lg border border-teal-200 bg-white p-3.5"
              data-testid="smart-label-point-label-decisions"
            >
              <h4 className="mb-2.5 text-xs font-bold text-slate-800">
                📍 Unit 3-E: 점 이름(유형 A) 겹침 판단 및 자연 배치 사유 ({activeProposal.pointLabelDecisions.length}개)
              </h4>
              <div className="space-y-2">
                {activeProposal.pointLabelDecisions.map((pDec) => (
                  <div
                    key={pDec.id}
                    data-testid="smart-label-point-label-decision-item"
                    className={`rounded-md border p-2.5 text-xs ${
                      pDec.autoModified
                        ? "border-teal-200 bg-teal-50/40"
                        : pDec.action === "hold-no-safe-point-candidate"
                        ? "border-amber-300 bg-amber-50/50"
                        : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-mono text-white">
                          {pDec.label}
                        </code>
                        <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800">
                          점 마커 연결 점 이름
                        </span>
                        {pDec.autoModified ? (
                          <span className="rounded bg-teal-600 px-2 py-0.5 text-[10px] font-bold text-white">
                            이동 추천: [{pDec.origShift?.[0] ?? 0}, {pDec.origShift?.[1] ?? 0}]pt ➔ [
                            {pDec.shift?.[0] ?? 0}, {pDec.shift?.[1] ?? 0}]pt ({pDec.nearestDir})
                          </span>
                        ) : pDec.action === "hold-no-safe-point-candidate" ? (
                          <span className="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-bold text-white">
                            보류 · 원본 유지 ({pDec.nonMoveCategory || "안전 후보 없음"})
                          </span>
                        ) : (
                          <span className="rounded bg-slate-600 px-2 py-0.5 text-[10px] font-bold text-white">
                            원본 유지 ({pDec.origDirOption || pDec.nonMoveCategory || "무충돌"})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                        <span>엔진: {pDec.selectedEngine}</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      {pDec.autoModified
                        ? pDec.selectionReason || pDec.reason
                        : pDec.holdReason || pDec.selectionReason || pDec.reason}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>
        )}

        {/* 하단 고정(Sticky) 푸터 액션 버튼 */}
        <div
          className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3"
          data-testid="smart-label-modal-footer"
        >
          <span className="text-[11px] text-slate-500">
            적용 시 직전 원본 코드가 자동 백업되며, 언제든 [원본 복원]으로 되돌리고 조이스틱으로 미세 조정할 수 있습니다.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              data-testid="btn-cancel-smart-label"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap"
            >
              {activeUiMode === "C" ? "취소 (원본 유지)" : "그대로 두기"}
            </button>
            <button
              type="button"
              disabled={!applicability.allowed || isRecomputing}
              onClick={onApproveApply}
              data-testid="btn-approve-smart-label"
              className={`rounded-lg px-4 py-2 text-xs font-bold text-white whitespace-nowrap transition ${
                applicability.allowed && !isRecomputing
                  ? "bg-indigo-600 hover:bg-indigo-700 shadow-sm"
                  : "cursor-not-allowed bg-slate-300 text-slate-500"
              }`}
            >
              {activeUiMode === "C"
                ? maOpt?.detected
                  ? effectiveMaAction === "recommend"
                    ? "✅ ① 추천 매칭(Recommend) 위치 승인 및 적용"
                    : effectiveMaAction === "swap"
                    ? "✅ ② 대응 교환(Swap) 위치 승인 및 적용"
                    : applicability.allowed
                    ? "✅ 추상 함수 원본 유지(Hold) + 일반 정렬 승인 및 적용"
                    : "🔒 원본 유지(Hold) 기본 선택됨 (적용할 변경 없음)"
                  : "✅ 추천 위치 승인 및 적용"
                : applicability.allowed
                ? "✨ 선택한 결과 적용"
                : "적용할 변경 없음 (원본 유지)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
