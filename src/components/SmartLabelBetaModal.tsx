"use client";

import React from "react";
import {
  evaluateProposalApplicability,
  resolveActiveProposalForMultiAbstractChoice,
} from "@/lib/smart-label-beta/client-workflow";
import type {
  MultiAbstractActionMode,
  SmartLabelAccessRole,
  SmartLabelBetaResponse,
  SmartLabelEngineVersion,
} from "@/lib/smart-label-beta/kroki-recommend";

interface SmartLabelBetaModalProps {
  proposal: SmartLabelBetaResponse | null;
  currentRawInput: string;
  onClose: () => void;
  onApproveApply: () => void;
  restoreConfirmOpen: boolean;
  onCancelRestoreConfirm: () => void;
  onConfirmRestoreOverwrite: () => void;
  accessRole?: SmartLabelAccessRole;
  canSelectEngine?: boolean;
  unit3BServerEnabled?: boolean;
  unit3BDisabledReason?: string | null;
  applyAxisOption?: boolean;
  onToggleApplyAxisOption?: (next: boolean) => void;
  applySafeShrinkOption?: boolean;
  onToggleApplySafeShrinkOption?: (next: boolean) => void;
  applyDomainExtensionOption?: boolean;
  onToggleApplyDomainExtensionOption?: (next: boolean) => void;
  multiAbstractAction?: MultiAbstractActionMode;
  onChangeMultiAbstractAction?: (next: MultiAbstractActionMode) => void;
  enableUnit3BOption?: boolean;
  onToggleEnableUnit3BOption?: (next: boolean) => void;
  enablePointLabelOverlapFixOption?: boolean;
  onToggleEnablePointLabelOverlapFixOption?: (next: boolean) => void;
  enableAxisLetterOverlapFixOption?: boolean;
  onToggleEnableAxisLetterOverlapFixOption?: (next: boolean) => void;
  engineVersion?: SmartLabelEngineVersion;
  onChangeEngineVersion?: (next: SmartLabelEngineVersion) => void;
  isRecomputing?: boolean;
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
  unit3BDisabledReason = null,
  applyAxisOption = false,
  onToggleApplyAxisOption,
  applySafeShrinkOption = false,
  onToggleApplySafeShrinkOption,
  applyDomainExtensionOption = false,
  onToggleApplyDomainExtensionOption,
  multiAbstractAction,
  onChangeMultiAbstractAction,
  enableUnit3BOption = true,
  onToggleEnableUnit3BOption,
  enablePointLabelOverlapFixOption = false,
  onToggleEnablePointLabelOverlapFixOption,
  enableAxisLetterOverlapFixOption = false,
  onToggleEnableAxisLetterOverlapFixOption,
  engineVersion = "v0.2.1",
  onChangeEngineVersion,
  isRecomputing = false,
}: SmartLabelBetaModalProps) {
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
  ]);

  const selectedMaAction: MultiAbstractActionMode =
    multiAbstractAction ?? internalMaAction;

  const handleSelectMaAction = (next: MultiAbstractActionMode) => {
    setInternalMaAction(next);
    if (onChangeMultiAbstractAction) {
      onChangeMultiAbstractAction(next);
    }
  };
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
    selectedMaAction
  ) as SmartLabelBetaResponse;
  const maOpt = activeProposal.multiAbstractOption;
  const effectiveMaAction: MultiAbstractActionMode = maOpt?.detected
    ? maOpt.selectedAction
    : "hold";

  const applicability = evaluateProposalApplicability(activeProposal, currentRawInput, {
    multiAbstractAction: effectiveMaAction,
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      data-testid="smart-label-beta-modal"
    >
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        {/* 헤더 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-900 px-5 py-3.5 text-white">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-sm font-bold">✨ 스마트 라벨 자동 정렬 (Beta)</span>
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
          <div className="flex flex-wrap items-center gap-2.5">
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
            <button
              type="button"
              onClick={onClose}
              data-testid="btn-close-smart-label-modal"
              className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              ✕ 닫기
            </button>
          </div>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
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
                {typeof activeProposal.pointLabelMovedCount === "number" &&
                activeProposal.pointLabelMovedCount > 0
                  ? ` · 점 이름 ${activeProposal.pointLabelMovedCount}개`
                  : ""}
                ) · 원본 유지: {activeProposal.heldCount}개 · 끝점 연장:{" "}
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

        {/* 푸터 액션 버튼 */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3">
          <span className="text-[11px] text-slate-500">
            승인 시 직전 원본 코드가 별도 백업되며, 1클릭으로 언제든 복원하고 조이스틱으로 미세 조정할 수 있습니다.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              data-testid="btn-cancel-smart-label"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              취소 (원본 유지)
            </button>
            <button
              type="button"
              disabled={!applicability.allowed || isRecomputing}
              onClick={onApproveApply}
              data-testid="btn-approve-smart-label"
              className={`rounded-lg px-4 py-2 text-xs font-bold text-white transition ${
                applicability.allowed && !isRecomputing
                  ? "bg-indigo-600 hover:bg-indigo-700 shadow-sm"
                  : "cursor-not-allowed bg-slate-300 text-slate-500"
              }`}
            >
              {maOpt?.detected
                ? effectiveMaAction === "recommend"
                  ? "✅ ① 추천 매칭(Recommend) 위치 승인 및 적용"
                  : effectiveMaAction === "swap"
                  ? "✅ ② 대응 교환(Swap) 위치 승인 및 적용"
                  : applicability.allowed
                  ? "✅ 추상 함수 원본 유지(Hold) + 일반 정렬 승인 및 적용"
                  : "🔒 원본 유지(Hold) 기본 선택됨 (적용할 변경 없음)"
                : "✅ 추천 위치 승인 및 적용"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
