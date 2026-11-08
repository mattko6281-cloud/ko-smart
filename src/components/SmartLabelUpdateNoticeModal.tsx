"use client";

import React, { useEffect } from "react";
import { X, Sparkles } from "lucide-react";

export interface SmartLabelUpdateNoticeModalProps {
  open: boolean;
  onConfirmClose: () => void;
  onDismissPermanently: () => void;
}

export function SmartLabelUpdateNoticeModal({
  open,
  onConfirmClose,
  onDismissPermanently,
}: SmartLabelUpdateNoticeModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onConfirmClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [open, onConfirmClose]);

  if (!open) return null;

  return (
    <div
      data-testid="smart-label-update-notice-overlay"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/55 backdrop-blur-[2px] p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onConfirmClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="smart-label-update-notice-title"
        data-testid="smart-label-update-notice-modal"
        className="w-full max-w-[520px] rounded-2xl bg-white border border-slate-200/90 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        {/* 상단 헤더 */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-indigo-50/90 via-violet-50/70 to-slate-50 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-indigo-600 text-white shadow-xs">
              <Sparkles className="w-3.5 h-3.5" />
            </span>
            <h2
              id="smart-label-update-notice-title"
              data-testid="update-notice-title"
              className="text-sm font-bold text-slate-800 tracking-tight"
            >
              ✨ KO-SMART 업데이트 안내
            </h2>
          </div>
          <button
            type="button"
            data-testid="btn-update-notice-close"
            onClick={onConfirmClose}
            aria-label="업데이트 안내 닫기"
            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 본문 */}
        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <p
              data-testid="update-notice-heading"
              className="text-base sm:text-[17px] font-bold text-slate-900 leading-snug"
            >
              스마트 그림 정리가 더 편리해졌어요!
            </p>
            <p
              data-testid="update-notice-description"
              className="text-xs sm:text-[13px] text-slate-600 leading-relaxed"
            >
              이제 복잡한 설정 없이 버튼 하나로 그림을 정리하고 추천 결과를 확인할 수 있습니다.
            </p>
          </div>

          {/* 핵심 변경점 4줄 */}
          <ul
            data-testid="update-notice-feature-list"
            className="rounded-xl bg-slate-50/90 border border-slate-200/80 px-4 py-3 space-y-2 text-xs sm:text-[13px] font-medium text-slate-700"
          >
            <li className="flex items-center gap-2">
              <span className="text-indigo-600 font-bold">✓ 스마트 그림 정리 버튼 하나로 시작</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-indigo-600 font-bold">✓ 함수식·점 이름·축 문자·직선 이름 정렬</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-indigo-600 font-bold">✓ 원본과 추천 결과를 비교한 뒤 적용</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-indigo-600 font-bold">✓ 일반 / 고급 / 상세 검수 모드 선택 가능</span>
            </li>
          </ul>

          {/* 하단 보조 문구 */}
          <p
            data-testid="update-notice-subtext"
            className="text-[11.5px] sm:text-xs text-slate-500 leading-relaxed bg-indigo-50/40 border border-indigo-100/70 rounded-lg px-3 py-2"
          >
            기존 TikZ 편집, 조이스틱, 한글(HWP) 복사 기능은 그대로 사용할 수 있습니다.
          </p>
        </div>

        {/* 하단 버튼 */}
        <div className="flex items-center justify-between gap-2 px-6 py-3.5 bg-slate-50/80 border-t border-slate-100">
          <button
            type="button"
            data-testid="btn-update-notice-dismiss-forever"
            onClick={onDismissPermanently}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            다시 보지 않기
          </button>
          <button
            type="button"
            data-testid="btn-update-notice-confirm"
            onClick={onConfirmClose}
            className="px-4 py-2 rounded-lg text-xs sm:text-[13px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xs transition-colors cursor-pointer"
          >
            확인하고 시작하기
          </button>
        </div>
      </div>
    </div>
  );
}
