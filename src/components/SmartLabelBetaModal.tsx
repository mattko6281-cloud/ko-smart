"use client";

import React from "react";
import { evaluateProposalApplicability } from "@/lib/smart-label-beta/client-workflow";
import type { SmartLabelBetaResponse } from "@/lib/smart-label-beta/kroki-recommend";

interface SmartLabelBetaModalProps {
  proposal: SmartLabelBetaResponse | null;
  currentRawInput: string;
  onClose: () => void;
  onApproveApply: () => void;
  restoreConfirmOpen: boolean;
  onCancelRestoreConfirm: () => void;
  onConfirmRestoreOverwrite: () => void;
  applyAxisOption?: boolean;
  onToggleApplyAxisOption?: (next: boolean) => void;
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
  applyAxisOption = false,
  onToggleApplyAxisOption,
  isRecomputing = false,
}: SmartLabelBetaModalProps) {
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

  const applicability = evaluateProposalApplicability(proposal, currentRawInput);
  const isStale = currentRawInput !== proposal.originalCode;
  const diag = proposal.collisionDiagnostics;
  const hasUnresolvedIssues =
    Boolean(diag) &&
    (Boolean(diag?.hasUnresolvedCollisions) || !Boolean(diag?.measurementComplete));

  const statusTone =
    proposal.status === "recommended"
      ? hasUnresolvedIssues
        ? "border-amber-300 bg-amber-50 text-amber-950"
        : "border-emerald-300 bg-emerald-50 text-emerald-900"
      : proposal.status === "unchanged"
      ? hasUnresolvedIssues
        ? "border-amber-300 bg-amber-50 text-amber-950"
        : "border-blue-300 bg-blue-50 text-blue-900"
      : proposal.status === "unsupported"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-rose-300 bg-rose-50 text-rose-900";

  const statusLabel =
    proposal.status === "recommended"
      ? hasUnresolvedIssues
        ? "추천 완료 (2차 검증 통과 · 일부 기존 미해결 충돌 존재)"
        : "추천 완료 (2차 검증 통과)"
      : proposal.status === "unchanged"
      ? hasUnresolvedIssues
        ? "원본 위치 유지 (미해결 충돌 감지)"
        : "원본 위치 유지"
      : proposal.status === "unsupported"
      ? "초기 베타 미지원 도형 (원본 유지)"
      : proposal.status === "reverted"
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
            <span className="rounded bg-indigo-500/30 border border-indigo-400/40 px-2 py-0.5 text-[11px] font-semibold text-indigo-200">
              {proposal.algorithmVersion || "proto-0.2.1"} ·{" "}
              {proposal.applyAxisRequested ? "label+axes" : "labelOnly"} · verify=true
            </span>
            <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
              개발자 전용
            </span>
          </div>
          <div className="flex items-center gap-3">
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
                이동 추천: {proposal.movedCount}개 · 원본 유지: {proposal.heldCount}개 · 축 조정:{" "}
                {proposal.axisOption?.editsCount ?? 0}개 · 2차 검증:{" "}
                {proposal.verified ? "통과 (Verified)" : "미적용"}
              </span>
            </div>
            <p className="leading-relaxed" data-testid="smart-label-status-message">
              {proposal.message}
            </p>
          </div>

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
          {proposal.axisOption && (
            <div
              className={`rounded-lg border p-3.5 text-xs ${
                proposal.axisOption.status === "applied"
                  ? "border-indigo-200 bg-indigo-50/60 text-indigo-950"
                  : proposal.axisOption.status === "blocked-unsafe"
                  ? "border-rose-300 bg-rose-50 text-rose-900"
                  : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
              data-testid="smart-label-axis-option-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 font-bold mb-1">
                <span>
                  📏 x축·y축 길이 자동 조정 옵션:{" "}
                  {proposal.axisOption.requested ? "ON (활성화)" : "OFF (기본 labelOnly)"}
                </span>
                <span className="rounded bg-white/80 px-2 py-0.5 text-[10px] font-semibold border border-slate-200 text-slate-600">
                  {proposal.axisOption.modeNote}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed mb-1.5">
                {proposal.axisOption.message}
              </p>
              {(proposal.axisOption.x?.changed || proposal.axisOption.y?.changed) && (
                <div className="mt-2 space-y-1">
                  {proposal.axisOption.x?.changed && (
                    <div className="flex flex-wrap items-center gap-2 rounded bg-white px-2.5 py-1.5 text-[11px] font-mono border border-indigo-200 text-slate-800">
                      <span className="font-bold text-indigo-700">x축 구간 연장:</span>
                      <span className="text-slate-500">
                        [{proposal.axisOption.x.old[0]}, {proposal.axisOption.x.old[1]}]
                      </span>
                      <span className="text-indigo-600 font-bold">➔</span>
                      <span className="font-semibold text-emerald-700">
                        [{proposal.axisOption.x.new[0]}, {proposal.axisOption.x.new[1]}]
                      </span>
                    </div>
                  )}
                  {proposal.axisOption.y?.changed && (
                    <div className="flex flex-wrap items-center gap-2 rounded bg-white px-2.5 py-1.5 text-[11px] font-mono border border-indigo-200 text-slate-800">
                      <span className="font-bold text-indigo-700">y축 구간 연장:</span>
                      <span className="text-slate-500">
                        [{proposal.axisOption.y.old[0]}, {proposal.axisOption.y.old[1]}]
                      </span>
                      <span className="text-indigo-600 font-bold">➔</span>
                      <span className="font-semibold text-emerald-700">
                        [{proposal.axisOption.y.new[0]}, {proposal.axisOption.y.new[1]}]
                      </span>
                    </div>
                  )}
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
                            ? "함수식 라벨 (안전 후보 없음 · 원본 위치 유지)"
                            : `일반 노드 (${item.nodeRole}) · 자동 이동 제외 대상`}
                        </span>
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
                      <span>{u.reasons.join(" · ")}</span>
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
          {(proposal.preview?.originalSvgDataUri || proposal.preview?.recommendedSvgDataUri) && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>적용 전 (원본 도형)</span>
                  <span className="text-[11px] font-normal text-slate-500">현재 코드 기준</span>
                </div>
                <div className="flex min-h-[220px] items-center justify-center rounded border border-slate-200 bg-white p-3">
                  {proposal.preview.originalSvgDataUri ? (
                    <img
                      src={proposal.preview.originalSvgDataUri}
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
                  <span>적용 후 (추천 미리보기)</span>
                  <span className="text-[11px] font-normal text-indigo-700">
                    {proposal.canApply ? "2차 Kroki 렌더 검증 완료" : "변경 없음 (원본 유지)"}
                  </span>
                </div>
                <div className="flex min-h-[220px] items-center justify-center rounded border border-indigo-200 bg-white p-3">
                  {proposal.preview.recommendedSvgDataUri ? (
                    <img
                      src={proposal.preview.recommendedSvgDataUri}
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
          {proposal.labelDecisions && proposal.labelDecisions.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-3.5">
              <h4 className="mb-2.5 text-xs font-bold text-slate-800">
                함수식 라벨별 판단 및 매칭 사유 ({proposal.labelDecisions.length}개)
              </h4>
              <div className="space-y-2">
                {proposal.labelDecisions.map((dec) => (
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
              ✅ 추천 위치 승인 및 적용
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
