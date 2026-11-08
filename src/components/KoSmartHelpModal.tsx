"use client";

import React, { useEffect, useState } from "react";
import { HelpCircle, X, Sparkles, BookOpen, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

export interface KoSmartHelpModalProps {
  open: boolean;
  onClose: () => void;
}

interface QuickStartStep {
  step: number;
  badge: string;
  title: string;
  description: string;
  subTip: string;
  imgSrc: string;
  imgAlt: string;
}

const QUICK_START_STEPS: QuickStartStep[] = [
  {
    step: 1,
    badge: "STEP 1",
    title: "① TikZ 코드 입력",
    description:
      "좌측 코드 에디터에 AI(상단 KICE 도구의 INF_KICE TikZ 프롬프트 활용)로 생성한 TikZ 코드를 붙여넣거나 [평가원 기본 축 로드] 버튼으로 시작합니다.",
    subTip: "입력한 코드는 브라우저에 실시간 자동 저장(Auto-Save)되어 새로고침해도 안전하게 유지됩니다.",
    imgSrc: "/help-guide/step1-editor.png",
    imgAlt: "STEP 1 TikZ 코드 입력 화면",
  },
  {
    step: 2,
    badge: "STEP 2",
    title: "② 실시간 그림 미리보기",
    description:
      "코드를 입력하면 우측 도화지에 즉시 고화질 그래프가 렌더링됩니다. 도화지를 마우스로 잡고 드래그하면 상하좌우로 화면을 이동할 수 있습니다.",
    subTip: "상단 돋보기 슬라이더(100%~200%)는 모니터 화면 표시 배율만 조절하며 실제 저장 해상도에는 영향을 주지 않습니다.",
    imgSrc: "/help-guide/step2-preview.png",
    imgAlt: "STEP 2 실시간 그림 미리보기 화면",
  },
  {
    step: 3,
    badge: "STEP 3",
    title: "③ [✨ 스마트 그림 정리] 클릭",
    description:
      "함수식·점 이름·원점 O·눈금·직선 이름이 선이나 축과 겹칠 때, 좌측 상단 보라색 [✨ 스마트 그림 정리] 버튼을 클릭합니다.",
    subTip: "일반 모드 A가 기본으로 열리며, 라벨 겹침 정리와 '축 길이도 함께 맞춤(기본 ON)'이 한 번에 실행됩니다.",
    imgSrc: "/help-guide/step3-smart-btn.png",
    imgAlt: "STEP 3 스마트 그림 정리 버튼 클릭",
  },
  {
    step: 4,
    badge: "STEP 4",
    title: "④ 원본과 추천 결과 비교 (배치 선택)",
    description:
      "모달에서 원본 그림과 추천 결과를 나란히 비교합니다. 다중 추상 함수식(y=f(x), y=g(x))이나 다중 직선 이름(l, m)이 있으면 하단에서 [원본 배치] / [추천 배치] / [반대 배치]를 선택할 수 있습니다.",
    subTip: "기본값은 항상 안전한 [원본 배치](Hold)이며, 카드를 클릭하면 재컴파일 대기 없이 추천 그림이 즉시 전환됩니다.",
    imgSrc: "/help-guide/step4-compare-choice.png",
    imgAlt: "STEP 4 원본과 추천 결과 비교 및 배치 선택",
  },
  {
    step: 5,
    badge: "STEP 5",
    title: "⑤ 선택한 결과 적용 및 [↩ 원본 복원]",
    description:
      "모달 하단 [✨ 선택한 결과 적용]을 누르면 정돈된 코드가 에디터에 반영됩니다. 취소([그대로 두기] 또는 ESC)하면 원본 코드가 그대로 유지됩니다.",
    subTip: "적용 후에도 에디터 상단 [↩ 원본 복원] 버튼으로 언제든 직전 원본 코드로 되돌릴 수 있으며, 추가 수동 수정이 있으면 확인창이 먼저 표시됩니다.",
    imgSrc: "/help-guide/step5-apply-restore.png",
    imgAlt: "STEP 5 선택한 결과 적용 및 원본 복원 버튼",
  },
  {
    step: 6,
    badge: "STEP 6",
    title: "⑥ [📥저장 & 📋HWP 자동복사] 후 한글 Ctrl+V",
    description:
      "우측 상단 주황색 [📥저장 & 📋HWP 자동복사] 버튼을 누르면 평가원 인쇄 규격(×4.0 고정배율·자동 여백 크롭·원 1:1 비율 보정) 이미지가 클립보드에 자동 복사되고 PNG 파일로도 저장됩니다.",
    subTip: "한글(HWP) 문서에서 곧바로 Ctrl+V를 눌러 붙여넣으세요. 좌측 [TikZ 코드(.txt) 포함]을 켜 두면 동일 이름의 .txt 소스 파일이 함께 저장됩니다.",
    imgSrc: "/help-guide/step6-hwp-copy.png",
    imgAlt: "STEP 6 저장 및 HWP 자동복사 버튼",
  },
];

export default function KoSmartHelpModal({ open, onClose }: KoSmartHelpModalProps) {
  const [activeTab, setActiveTab] = useState<"quickstart" | "fullguide">("quickstart");
  const [openSections, setOpenSections] = useState<Record<number, boolean>>({
    1: true,
    2: true,
    3: true,
    4: true,
    5: true,
    6: true,
    7: true,
    8: true,
    9: true,
    10: true,
    11: true,
    12: true,
  });

  // 모달이 다시 열릴 때 기본 탭은 항상 [빠른 시작]으로 초기화
  useEffect(() => {
    if (open) {
      setActiveTab("quickstart");
    }
  }, [open]);

  // ESC 키로 모달 닫기
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const toggleSection = (idx: number) => {
    setOpenSections((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const setAllSections = (expanded: boolean) => {
    const next: Record<number, boolean> = {};
    for (let i = 1; i <= 12; i++) next[i] = expanded;
    setOpenSections(next);
  };

  const scrollToSection = (idx: number) => {
    setOpenSections((prev) => ({ ...prev, [idx]: true }));
    requestAnimationFrame(() => {
      const el = document.getElementById(`help-manual-sec-${idx}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div
      data-testid="kosmart-help-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.82)", backdropFilter: "blur(8px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border border-zinc-700/50 shadow-2xl shadow-black/70 overflow-hidden"
        style={{ background: "linear-gradient(145deg, #13161e 0%, #0e1117 60%, #0d1117 100%)" }}
      >
        {/* ── 모달 상단 헤더 ── */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3.5 border-b border-zinc-800/80 shrink-0 bg-black/25">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center shadow-md shrink-0">
              <HelpCircle className="w-4 h-4 text-white" />
            </div>
            <div className="leading-tight min-w-0">
              <div className="text-[14px] sm:text-[15px] font-black text-white tracking-tight truncate">
                🚀 KO-SMART 사용 설명서
              </div>
              <div className="text-[10px] text-zinc-400 mt-0.5 font-medium truncate">
                v5.2 · Smart Label v0.2.2 통합본 · 빠른 시작 &amp; 전체 매뉴얼
              </div>
            </div>
          </div>

          {/* 탭 전환 스위치 ([빠른 시작] / [전체 사용설명서]) */}
          <div
            role="tablist"
            aria-label="도움말 보기 모드"
            className="flex items-center gap-1 bg-zinc-900/90 border border-zinc-700/70 rounded-xl p-1 shrink-0"
          >
            <button
              type="button"
              id="tab-help-quickstart"
              data-testid="tab-help-quickstart"
              role="tab"
              aria-selected={activeTab === "quickstart"}
              onClick={() => setActiveTab("quickstart")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-extrabold transition-all whitespace-nowrap ${
                activeTab === "quickstart"
                  ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>빠른 시작</span>
              <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-black/30 text-indigo-200 font-bold">
                6단계
              </span>
            </button>
            <button
              type="button"
              id="tab-help-fullguide"
              data-testid="tab-help-fullguide"
              role="tab"
              aria-selected={activeTab === "fullguide"}
              onClick={() => setActiveTab("fullguide")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-extrabold transition-all whitespace-nowrap ${
                activeTab === "fullguide"
                  ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 shrink-0" />
              <span>전체 사용설명서</span>
              <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-black/30 text-indigo-200 font-bold">
                12섹션
              </span>
            </button>
          </div>

          <button
            type="button"
            data-testid="btn-help-close-top"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all shrink-0"
            title="닫기 (ESC)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── 컨텐츠 스크롤 영역 ── */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 min-h-0 text-[12px] text-zinc-300 leading-relaxed">
          {activeTab === "quickstart" ? (
            /* ══════════════════════════════════════════════════════
               TAB 1: [빠른 시작] — 6단계 핵심 워크플로우
            ══════════════════════════════════════════════════════ */
            <div data-testid="panel-help-quickstart" className="space-y-4">
              {/* 상단 안내 배너 */}
              <div className="rounded-xl border border-indigo-800/40 bg-indigo-950/25 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[12.5px] font-extrabold text-indigo-200 flex items-center gap-1.5">
                    <span>⚡ 처음 사용하시나요? 6단계만 따라 하면 바로 한글(HWP)에 그래프를 넣을 수 있습니다.</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    코드 입력 → 미리보기 → <strong className="text-violet-300">[✨ 스마트 그림 정리]</strong> → 비교·선택 → 적용 → <strong className="text-amber-300">[📥저장 &amp; 📋HWP 자동복사]</strong> 후 <kbd className="px-1 py-0.5 text-[10px] bg-zinc-800 border border-zinc-600 rounded text-zinc-200">Ctrl+V</kbd>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab("fullguide")}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 transition-all shrink-0"
                >
                  상세 기능 매뉴얼 보기 →
                </button>
              </div>

              {/* 6단계 그리드 카드 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {QUICK_START_STEPS.map((item) => (
                  <div
                    key={item.step}
                    data-testid={`quickstart-step-${item.step}`}
                    className="flex flex-col rounded-xl border border-zinc-800/90 bg-zinc-900/50 overflow-hidden hover:border-indigo-700/50 transition-all"
                  >
                    {/* 카드 헤더 */}
                    <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-zinc-800/70 bg-black/30">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 shrink-0">
                        {item.badge}
                      </span>
                      <h3 className="text-[12.5px] font-black text-white tracking-tight truncate">
                        {item.title}
                      </h3>
                    </div>

                    {/* 실제 KO-SMART 스크린샷 (반응형 보호) */}
                    <div className="w-full bg-[#090b10] border-b border-zinc-800/60 p-2 flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.imgSrc}
                        alt={item.imgAlt}
                        loading="lazy"
                        className="w-full h-36 sm:h-40 object-contain rounded-lg border border-zinc-800/80 bg-[#0d1117]"
                      />
                    </div>

                    {/* 핵심 설명 1~2문장 */}
                    <div className="p-3.5 flex-1 flex flex-col justify-between space-y-2">
                      <p className="text-[11.5px] text-zinc-200 leading-relaxed break-keep">
                        {item.description}
                      </p>
                      <p className="text-[10.5px] text-zinc-400 bg-zinc-950/60 border border-zinc-800/70 rounded-lg px-2.5 py-1.5 break-keep">
                        💡 {item.subTip}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* 하단 전체 사용설명서 이동 유도 카드 */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11.5px] text-zinc-300">
                  조이스틱 단축키(<kbd className="px-1 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded">Shift</kbd> / <kbd className="px-1 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded">Alt</kbd>), 고급 옵션 모드 B, 상세 검수 모드 C, Safe Shrink 등 모든 기능은 <strong className="text-white">전체 사용설명서</strong> 탭에서 확인할 수 있습니다.
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab("fullguide")}
                  className="px-3.5 py-1.5 rounded-lg text-[11px] font-extrabold bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:opacity-95 transition-all shrink-0"
                >
                  📖 전체 사용설명서(12섹션) 열기
                </button>
              </div>
            </div>
          ) : (
            /* ══════════════════════════════════════════════════════
               TAB 2: [전체 사용설명서] — 12개 섹션 + 빠른 목차
            ══════════════════════════════════════════════════════ */
            <div data-testid="panel-help-fullguide" className="space-y-4">
              {/* 빠른 목차 (Quick TOC) 및 일괄 펼치기/접기 */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-extrabold text-zinc-300 flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                    빠른 목차 이동 (클릭 시 해당 섹션으로 스크롤)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAllSections(true)}
                      className="px-2 py-1 rounded text-[10px] font-bold bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 transition-all"
                    >
                      전체 펼치기
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllSections(false)}
                      className="px-2 py-1 rounded text-[10px] font-bold bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 transition-all"
                    >
                      전체 접기
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "1. 기본 편집·KICE 도구",
                    "2. 조이스틱·키보드 조작",
                    "3. 폰트·선두께·스케일",
                    "4. 수동 축 길이 조정",
                    "5. 점 & 그래프 제어",
                    "6. 스마트 정리 A/B/C 모드",
                    "7. 다중 함수식·직선 배치 선택",
                    "8. 축 연장·Safe Shrink·domain",
                    "9. 결과 적용·원본 복원",
                    "10. HWP 복사 및 저장",
                    "11. 지원 범위·제한 사항",
                    "12. 오류 시 원본 보호·대처",
                  ].map((label, idx) => (
                    <button
                      key={idx + 1}
                      type="button"
                      onClick={() => scrollToSection(idx + 1)}
                      className="px-2 py-1 rounded-md text-[10.5px] font-semibold bg-zinc-800/80 hover:bg-indigo-950/70 border border-zinc-700/70 hover:border-indigo-500/50 text-zinc-300 hover:text-indigo-200 transition-all"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── 섹션 1: KO-SMART 기본 편집 및 KICE 도구 ── */}
              <section
                id="help-manual-sec-1"
                data-testid="help-section-1"
                className="rounded-xl border border-zinc-800/90 bg-zinc-900/40 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleSection(1)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-black/25 hover:bg-black/40 text-left transition-all"
                >
                  <h4 className="text-[13px] font-black text-white flex items-center gap-2">
                    <span className="text-base">🛠️</span> 1. KO-SMART 기본 편집 및 KICE 도구 (5. 프롬프트 및 QA 검수 가이드)
                  </h4>
                  {openSections[1] ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                </button>
                {openSections[1] && (
                  <div className="px-4 py-3.5 space-y-2.5 border-t border-zinc-800/60 text-[11.5px]">
                    <ul className="space-y-2 list-disc pl-4">
                      <li>
                        <strong className="text-white">💾 Auto-Save (자동 저장):</strong> 좌측 에디터에 입력한 TikZ 코드는 브라우저에 실시간 자동 저장되어, 실수로 새로고침하거나 창을 닫아도 마지막 코드가 자동 복구됩니다.
                      </li>
                      <li>
                        <strong className="text-white">[초기화] 및 [평가원 기본 축 로드]:</strong> 에디터 상단의 <code className="text-zinc-200 bg-zinc-800 px-1.5 py-0.5 rounded">[초기화]</code>로 코드창을 비우거나, <code className="text-blue-200 bg-blue-950/50 px-1.5 py-0.5 rounded">[평가원 기본 축 로드]</code>로 KICE 표준 좌표축 뼈대를 즉시 불러올 수 있습니다.
                      </li>
                      <li>
                        <strong className="text-white">상단 [KICE 도구] 메뉴:</strong>
                        <ul className="list-disc pl-4 mt-1 space-y-1 text-zinc-300">
                          <li>
                            <strong className="text-blue-300">INF_KICE TikZ 프롬프트:</strong> AI(ChatGPT, Claude, Gemini 등)에게 평가원 스타일의 TikZ 코드를 생성하도록 지시하는 표준 프롬프트를 원클릭 복사합니다.
                          </li>
                          <li>
                            <strong className="text-amber-300">💡 KICE 검수 체크리스트:</strong> 점 라벨 밀착, 길이 표시 점선 끊기, 축 경계선 방어 등 마이크로 디테일을 최종 점검하는 시각 QA 가이드를 엽니다.
                          </li>
                        </ul>
                      </li>
                      <li>
                        <strong className="text-white">전용 서버(Dedicated) vs 공용 서버(Public):</strong>
                        <ul className="list-disc pl-4 mt-1 space-y-1 text-zinc-300">
                          <li>
                            <strong className="text-emerald-300">Dedicated (사내 전용 서버, 기본 권장):</strong> POST 방식을 사용하여 공용 서버의 URL 길이 제한(약 4,000자) 없이 긴 TikZ 코드도 안정적으로 렌더링하며 <code className="text-zinc-200">Unit 3-B</code> 2차 정밀 검증을 지원합니다.
                          </li>
                          <li>
                            <strong className="text-amber-300">Public (공용 서버, 비상용 백업):</strong> 공개 GET URL 방식을 사용하므로 압축 전 TikZ 코드가 약 <strong className="text-white">4,000자</strong>를 초과하면 URL 길이 제한으로 렌더링이 실패할 수 있습니다.
                          </li>
                        </ul>
                      </li>
                    </ul>
                  </div>
                )}
              </section>

              {/* ── 섹션 2: 개별 노드 조이스틱 및 키보드 조작 ── */}
              <section
                id="help-manual-sec-2"
                data-testid="help-section-2"
                className="rounded-xl border border-zinc-800/90 bg-zinc-900/40 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleSection(2)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-black/25 hover:bg-black/40 text-left transition-all"
                >
                  <h4 className="text-[13px] font-black text-white flex items-center gap-2">
                    <span className="text-base">🎯</span> 2. 개별 노드 조이스틱 및 키보드 조작 (1. 개별 노드 정밀 제어)
                  </h4>
                  {openSections[2] ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                </button>
                {openSections[2] && (
                  <div className="px-4 py-3.5 space-y-2.5 border-t border-zinc-800/60 text-[11.5px]">
                    <ul className="space-y-2 list-disc pl-4">
                      <li>
                        <strong className="text-white">노드 선택 드롭다운 (단일·다중 선택 지원):</strong> 하단 좌측 <code className="text-zinc-200 bg-zinc-800 px-1.5 py-0.5 rounded">노드 선택…</code>에서 체크박스로 점·수식·눈금을 1개 또는 여러 개 동시에 선택해 일괄 제어할 수 있습니다.
                        <span className="block text-[10.5px] text-zinc-400 mt-0.5">
                          ※ 드롭다운 바깥의 빈 공간을 클릭하면 창이 닫히며 선택 내역이 초기화됩니다. (하단 컨트롤 패널 조작 시에는 선택이 유지됩니다.)
                        </span>
                      </li>
                      <li>
                        <strong className="text-white">마우스 조이스틱 (▲ ▼ ◀ ▶):</strong> 선택된 노드들의 <code className="text-zinc-300">xshift</code> / <code className="text-zinc-300">yshift</code> 값을 클릭당 <strong className="text-blue-300">1pt 단위</strong>로 상하좌우 미세 이동합니다.
                      </li>
                      <li>
                        <strong className="text-white">⌨️ 키보드 방향키 단축키 (노드 선택 상태):</strong>
                        <ul className="list-disc pl-4 mt-1 space-y-1 text-zinc-300">
                          <li><kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-[10px]">↑ ↓ ← →</kbd> 기본 방향키: <strong className="text-white">1pt</strong> 단위 이동</li>
                          <li><kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-[10px]">Shift + 방향키</kbd>: <strong className="text-amber-300">10pt</strong> (10배 크게) 빠른 이동</li>
                          <li><kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-[10px]">Alt (또는 Ctrl) + 방향키</kbd>: <strong className="text-emerald-300">0.1pt</strong> (1/10 초정밀) 미세 이동</li>
                        </ul>
                      </li>
                      <li>
                        <strong className="text-white">[개별] 폰트 ([크기+] / [크기-]):</strong> 선택된 특정 노드들의 글자 크기(<code className="text-zinc-300">scale</code>)만 개별적으로 <strong className="text-violet-300">±0.1 (10%)</strong> 단위로 키우거나 줄입니다.
                      </li>
                    </ul>
                  </div>
                )}
              </section>

              {/* ── 섹션 3: 폰트·선두께·가로세로 스케일 조정 ── */}
              <section
                id="help-manual-sec-3"
                data-testid="help-section-3"
                className="rounded-xl border border-zinc-800/90 bg-zinc-900/40 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleSection(3)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-black/25 hover:bg-black/40 text-left transition-all"
                >
                  <h4 className="text-[13px] font-black text-white flex items-center gap-2">
                    <span className="text-base">🌍</span> 3. 폰트·선두께·가로세로 스케일 조정 (2. 전체 스케일 제어)
                  </h4>
                  {openSections[3] ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                </button>
                {openSections[3] && (
                  <div className="px-4 py-3.5 space-y-2.5 border-t border-zinc-800/60 text-[11.5px]">
                    <ul className="space-y-2 list-disc pl-4">
                      <li>
                        <strong className="text-violet-300">폰트 (− / +):</strong> 그래프 안의 모든 노드 글자·수식 크기(<code className="text-zinc-300">scale</code>)를 한 번에 <strong className="text-white">±0.1</strong>씩 일괄 조절합니다.
                      </li>
                      <li>
                        <strong className="text-cyan-300">두께 (− / +):</strong> 얇은 보조선과 굵은 메인 함수 곡선의 <strong className="text-white">상대적 시각 비율을 그대로 유지</strong>하면서 전체 선 두께를 <strong className="text-white">±10% 배율(×0.9 / ×1.1)</strong>로 조절합니다.
                      </li>
                      <li>
                        <strong className="text-emerald-300">가로 (− / +):</strong> <code className="text-zinc-300">\begin&#123;tikzpicture&#125;[x=Ncm]</code>의 가로 비율만 독립적으로 <strong className="text-white">±10% 배율</strong>로 늘리거나 줄입니다.
                      </li>
                      <li>
                        <strong className="text-rose-300">세로 (− / +):</strong> <code className="text-zinc-300">\begin&#123;tikzpicture&#125;[y=Ncm]</code>의 세로 비율만 독립적으로 <strong className="text-white">±10% 배율</strong>로 조절합니다. (극값의 높낮이나 곡선의 가파른 정도를 튜닝할 때 유용합니다.)
                      </li>
                    </ul>
                  </div>
                )}
              </section>

              {/* ── 섹션 4: 수동 축 길이 조정 ── */}
              <section
                id="help-manual-sec-4"
                data-testid="help-section-4"
                className="rounded-xl border border-zinc-800/90 bg-zinc-900/40 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleSection(4)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-black/25 hover:bg-black/40 text-left transition-all"
                >
                  <h4 className="text-[13px] font-black text-white flex items-center gap-2">
                    <span className="text-base">📐</span> 4. 수동 축 길이 조정 (3. 축 길이 조절 Axis Length)
                  </h4>
                  {openSections[4] ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                </button>
                {openSections[4] && (
                  <div className="px-4 py-3.5 space-y-2.5 border-t border-zinc-800/60 text-[11.5px]">
                    <ul className="space-y-2 list-disc pl-4">
                      <li>
                        <strong className="text-amber-300">X축 가로 (좌측 / 우측)</strong> 및 <strong className="text-sky-300">Y축 세로 (하단 / 상단):</strong> 하단 패널에서 각 축의 끝 좌표를 클릭당 <strong className="text-white">0.2 단위</strong>로 미세 조정합니다.
                      </li>
                      <li>
                        TikZ 코드 내 <code className="text-zinc-300 bg-zinc-800 px-1 rounded">\draw[-&gt;] (x1, 0) -- (x2, 0)</code> 및 <code className="text-zinc-300 bg-zinc-800 px-1 rounded">\draw[-&gt;] (0, y1) -- (0, y2)</code> 명령어의 좌표값을 자동으로 찾아 치환합니다.
                      </li>
                    </ul>
                  </div>
                )}
              </section>

              {/* ── 섹션 5: 점 및 그래프 제어 ── */}
              <section
                id="help-manual-sec-5"
                data-testid="help-section-5"
                className="rounded-xl border border-zinc-800/90 bg-zinc-900/40 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleSection(5)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-black/25 hover:bg-black/40 text-left transition-all"
                >
                  <h4 className="text-[13px] font-black text-white flex items-center gap-2">
                    <span className="text-base">🟣</span> 5. 점 및 그래프 제어 (4. 점 &amp; 그래프 제어 Markers &amp; Domain)
                  </h4>
                  {openSections[5] ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                </button>
                {openSections[5] && (
                  <div className="px-4 py-3.5 space-y-2.5 border-t border-zinc-800/60 text-[11.5px]">
                    <ul className="space-y-2 list-disc pl-4">
                      <li>
                        <strong className="text-fuchsia-300">드래그 이동 플로팅 패널:</strong> 하단 우측 <code className="text-fuchsia-200 bg-zinc-800 px-1.5 py-0.5 rounded">[점 &amp; 그래프 제어]</code> 버튼을 누르면 플로팅 창이 열리며, 상단 그립(점 6개 아이콘)을 잡고 원하는 위치로 옮길 수 있습니다.
                      </li>
                      <li>
                        <strong className="text-white">점 마커 숨김/표시 ([전체 켜기 / 전체 끄기] 및 👁 토글):</strong> <code className="text-zinc-300">fill=black</code> 점 마커를 삭제하지 않고 <code className="text-zinc-300">%</code> 주석 처리 방식으로 안전하게 숨기거나 다시 표시합니다.
                      </li>
                      <li>
                        <strong className="text-emerald-300">📈 그래프 길이 (Domain) 제어:</strong> <code className="text-zinc-300">domain=A:B</code>가 포함된 곡선·직선의 시작점(A)과 끝점(B)을 클릭당 <strong className="text-white">±0.1 단위</strong>로 늘리거나 줄입니다. (시작점 ≥ 끝점 역전 방지 포함)
                      </li>
                    </ul>
                  </div>
                )}
              </section>

              {/* ── 섹션 6: 스마트 그림 정리 A/B/C 모드 ── */}
              <section
                id="help-manual-sec-6"
                data-testid="help-section-6"
                className="rounded-xl border border-indigo-800/50 bg-indigo-950/15 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleSection(6)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-indigo-950/30 hover:bg-indigo-950/45 text-left transition-all"
                >
                  <h4 className="text-[13px] font-black text-indigo-200 flex items-center gap-2">
                    <span className="text-base">✨</span> 6. 스마트 그림 정리 A/B/C 모드 (6대 자동 정리 유닛)
                  </h4>
                  {openSections[6] ? <ChevronUp className="w-4 h-4 text-indigo-300" /> : <ChevronDown className="w-4 h-4 text-indigo-300" />}
                </button>
                {openSections[6] && (
                  <div className="px-4 py-3.5 space-y-3 border-t border-indigo-900/40 text-[11.5px]">
                    <p className="text-zinc-200">
                      좌측 에디터 상단의 <strong className="text-violet-300">[✨ 스마트 그림 정리]</strong> 버튼을 누르면 아래 <strong className="text-white">6대 자동 정리 유닛</strong>이 도형을 분석하고 모달을 엽니다:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="rounded-lg bg-zinc-900/80 border border-zinc-800 px-3 py-2">
                        <strong className="text-indigo-300">① 함수식 라벨 정렬:</strong> <code className="text-zinc-300">y=f(x)</code> 등 수식 라벨을 곡선·축과 겹치지 않는 안전 위치로 배치
                      </div>
                      <div className="rounded-lg bg-zinc-900/80 border border-zinc-800 px-3 py-2">
                        <strong className="text-indigo-300">② 숫자 눈금 정렬 (Unit 3-B):</strong> 축 위 숫자 눈금이 곡선·보조선과 겹칠 때 안전 방향으로 회피
                      </div>
                      <div className="rounded-lg bg-zinc-900/80 border border-zinc-800 px-3 py-2">
                        <strong className="text-indigo-300">③ 원점 O 정렬 (Unit 3-D):</strong> 원점 <code className="text-zinc-300">O</code>가 축·곡선에 닿을 때 4사분면 중 가장 깨끗한 위치로 이동
                      </div>
                      <div className="rounded-lg bg-zinc-900/80 border border-zinc-800 px-3 py-2">
                        <strong className="text-indigo-300">④ 점 이름 정렬 (Unit 3-E):</strong> <code className="text-zinc-300">A, B, P, Q</code> 등 점 이름이 선분·곡선을 침범할 때 8방향 안전 탐색
                      </div>
                      <div className="rounded-lg bg-zinc-900/80 border border-zinc-800 px-3 py-2">
                        <strong className="text-indigo-300">⑤ 축 위 문자 눈금 정렬 (Unit 3-F / D-2):</strong> 축 위의 <code className="text-zinc-300">a, b, \alpha, \beta</code> 등 문자 눈금의 겹침 해소
                      </div>
                      <div className="rounded-lg bg-zinc-900/80 border border-zinc-800 px-3 py-2">
                        <strong className="text-indigo-300">⑥ 직선 이름 정렬 (Unit 3-G / D-3):</strong> 직선 이름 <code className="text-zinc-300">l, m, n, \ell</code>을 직선의 실제 가시 끝점 근처에 자연스럽게 배치
                      </div>
                    </div>
                    <ul className="space-y-1.5 list-disc pl-4 pt-1">
                      <li>
                        <strong className="text-white">일반 모드 (A, 기본):</strong> 복잡한 체크박스 없이 원클릭으로 원본과 추천 결과를 비교하고, <code className="text-emerald-300">[축 길이도 함께 맞춤]</code> 토글(기본 ON)과 배율(<code className="text-zinc-300">100% / 115% / 130%</code>)만 간편하게 조절합니다.
                      </li>
                      <li>
                        <strong className="text-white">고급 옵션 모드 (B):</strong> 세부 기능 체크박스를 원하는 대로 켜거나 끈 뒤 <code className="text-indigo-300">[⚡ 옵션 변경 일괄 적용]</code> 버튼으로 한 번에 재실행합니다.
                      </li>
                      <li>
                        <strong className="text-white">상세 검수 모드 (C):</strong> 라벨별 실제 잉크 충돌(<code className="text-zinc-300">true-ink</code>) 수치, <code className="text-zinc-300">pt</code> 단위 이동량, 보류(<code className="text-zinc-300">Hold</code>) 사유, 원본 대 추천 TikZ 코드 비교를 상세히 점검합니다.
                      </li>
                    </ul>
                  </div>
                )}
              </section>

              {/* ── 섹션 7: 다중 함수식 및 직선 이름 배치 선택 ── */}
              <section
                id="help-manual-sec-7"
                data-testid="help-section-7"
                className="rounded-xl border border-zinc-800/90 bg-zinc-900/40 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleSection(7)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-black/25 hover:bg-black/40 text-left transition-all"
                >
                  <h4 className="text-[13px] font-black text-white flex items-center gap-2">
                    <span className="text-base">🔀</span> 7. 다중 함수식(Type 2) 및 직선 이름(D-3) 배치 선택
                  </h4>
                  {openSections[7] ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                </button>
                {openSections[7] && (
                  <div className="px-4 py-3.5 space-y-2.5 border-t border-zinc-800/60 text-[11.5px]">
                    <ul className="space-y-2 list-disc pl-4">
                      <li>
                        <strong className="text-white">왜 기본값이 [원본 배치](Hold)인가요?</strong> 그래프에 추상 함수식이 2개 이상(<code className="text-zinc-300">y=f(x), y=g(x)</code>)이거나 비축 직선이 2개 이상이고 직선 이름(<code className="text-zinc-300">l, m</code>)이 있을 때는 문제 출제 의도에 따라 라벨 소속이 달라질 수 있으므로, 엔진이 임의로 바꾸지 않고 <strong className="text-amber-300">기본 [원본 배치](Hold)</strong>로 안전하게 보호합니다.
                      </li>
                      <li>
                        <strong className="text-white">[원본 배치] / [추천 배치] / [반대 배치] 실시간 전환:</strong> 모달 하단의 배치 선택 카드를 클릭하면 서버 재요청 없이 미리 계산된(Precomputed) 추천 그림으로 즉시 전환되므로, 눈으로 직접 확인하고 가장 알맞은 배치를 적용할 수 있습니다.
                      </li>
                    </ul>
                  </div>
                )}
              </section>

              {/* ── 섹션 8: 축 길이 자동 연장, Safe Shrink, domain 연장 ── */}
              <section
                id="help-manual-sec-8"
                data-testid="help-section-8"
                className="rounded-xl border border-zinc-800/90 bg-zinc-900/40 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleSection(8)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-black/25 hover:bg-black/40 text-left transition-all"
                >
                  <h4 className="text-[13px] font-black text-white flex items-center gap-2">
                    <span className="text-base">📏</span> 8. 축 길이 자동 연장, Safe Shrink, domain 연장 (축 끝 이름 vs 축 위 문자 구분)
                  </h4>
                  {openSections[8] ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                </button>
                {openSections[8] && (
                  <div className="px-4 py-3.5 space-y-2.5 border-t border-zinc-800/60 text-[11.5px]">
                    <ul className="space-y-2 list-disc pl-4">
                      <li>
                        <strong className="text-emerald-300">축 길이도 함께 맞춤 (4방향 축 자동 연장 — 일반 모드 A 기본 ON):</strong> 라벨이나 그래프 끝이 축 화살표 끝에 너무 가깝거나 밖으로 나갈 때 필요한 방향(<code className="text-zinc-300">+x, -x, +y, -y</code>)으로만 축을 자동 연장합니다. 원하지 않으면 체크를 해제해 라벨만 정리할 수 있습니다.
                      </li>
                      <li>
                        <strong className="text-white">축 끝 이름(x, y)과 축 위 문자 눈금(a, b, \alpha, \beta)의 처리 구분:</strong>
                        <ul className="list-disc pl-4 mt-1 space-y-1 text-zinc-300">
                          <li><strong className="text-sky-300">축 끝 이름 (x, y):</strong> 화살표 끝에 붙는 축 이름표로, 축 자동 연장(<code className="text-zinc-200">Unit 3-A</code>) 시 화살표 끝 좌표와 동기화되어 함께 이동합니다.</li>
                          <li><strong className="text-violet-300">축 위 문자 눈금 (a, b, k, \alpha, \beta 등):</strong> 축 위에 놓인 문자형 눈금·교점 라벨로, 곡선·직선과 겹칠 때 <code className="text-zinc-200">Unit 3-F (D-2)</code> 엔진이 축 방향을 유지한 채 겹침만 회피합니다.</li>
                        </ul>
                      </li>
                      <li>
                        <strong className="text-amber-300">축 길이 안전하게 줄이기 (Safe Shrink — 기본 OFF, 고급 모드 B에서 선택):</strong> 축 꼬리가 과도하게 길 때 그래프 끝점·점선·보조선·<code className="text-zinc-300">\clip</code>·<code className="text-zinc-300">\fill</code> 보호 잠금과 최소 비례 여백(<code className="text-zinc-300">Proportional Stem Floor</code>)을 지키는 범위 안에서만 안전하게 축을 줄입니다.
                      </li>
                      <li>
                        <strong className="text-cyan-300">그래프 끝점 미세 연장 (Domain Extension — 기본 OFF, 고급 모드 B에서 선택):</strong> 곡선 끝점이 축 화살표보다 살짝 짧을 때 안전 게이트 범위 안에서 <code className="text-zinc-300">domain</code>을 미세 연장합니다.
                      </li>
                    </ul>
                  </div>
                )}
              </section>

              {/* ── 섹션 9: 결과 적용 및 원본 복원 ── */}
              <section
                id="help-manual-sec-9"
                data-testid="help-section-9"
                className="rounded-xl border border-zinc-800/90 bg-zinc-900/40 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleSection(9)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-black/25 hover:bg-black/40 text-left transition-all"
                >
                  <h4 className="text-[13px] font-black text-white flex items-center gap-2">
                    <span className="text-base">↩️</span> 9. 결과 적용 및 [↩ 원본 복원] 안전 보호
                  </h4>
                  {openSections[9] ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                </button>
                {openSections[9] && (
                  <div className="px-4 py-3.5 space-y-2.5 border-t border-zinc-800/60 text-[11.5px]">
                    <ul className="space-y-2 list-disc pl-4">
                      <li>
                        <strong className="text-white">적용 직전 원본 자동 백업:</strong> 모달에서 <code className="text-indigo-300">[✨ 선택한 결과 적용]</code>을 누르는 순간, 적용 직전의 원본 TikZ 코드가 자동으로 백업됩니다.
                      </li>
                      <li>
                        <strong className="text-amber-300">[↩ 원본 복원] 버튼 및 추가 편집 덮어쓰기 방지 확인창:</strong> 적용 후 에디터 상단의 <code className="text-amber-300">[↩ 원본 복원]</code>을 누르면 즉시 직전 원본 코드로 복구됩니다. 만약 적용 이후 조이스틱이나 코드 입력으로 <strong className="text-white">추가 수정을 한 상태라면, 수정 내용이 실수로 사라지지 않도록 덮어쓰기 확인 모달</strong>이 먼저 표시됩니다.
                      </li>
                    </ul>
                  </div>
                )}
              </section>

              {/* ── 섹션 10: HWP 복사 및 저장 ── */}
              <section
                id="help-manual-sec-10"
                data-testid="help-section-10"
                className="rounded-xl border border-amber-800/50 bg-amber-950/15 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleSection(10)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-amber-950/30 hover:bg-amber-950/45 text-left transition-all"
                >
                  <h4 className="text-[13px] font-black text-amber-200 flex items-center gap-2">
                    <span className="text-base">📥</span> 10. HWP 자동복사 및 고화질 세트 저장 ([📥저장 &amp; 📋HWP 자동복사])
                  </h4>
                  {openSections[10] ? <ChevronUp className="w-4 h-4 text-amber-300" /> : <ChevronDown className="w-4 h-4 text-amber-300" />}
                </button>
                {openSections[10] && (
                  <div className="px-4 py-3.5 space-y-2.5 border-t border-amber-900/40 text-[11.5px]">
                    <ul className="space-y-2 list-disc pl-4">
                      <li>
                        <strong className="text-amber-300">[📥저장 &amp; 📋HWP 자동복사] (구 [HWP 인쇄용 (고정배율)] 통합):</strong> 우측 상단 주황색 버튼을 누르면 SVG 원본 크기에 <strong className="text-white">×4.0 고정 배율</strong>을 곱해 렌더링하고 상하좌우 <code className="text-zinc-300">20px</code> 여백으로 자동 재단(Auto-Crop)합니다.
                      </li>
                      <li>
                        <strong className="text-white">한글(HWP) 즉시 Ctrl+V 붙여넣기 + PNG 파일 동시 다운로드:</strong> 버튼 클릭과 동시에 클립보드(<code className="text-zinc-300">CF_HTML</code> 리치 이미지 포맷)에 자동 복사되므로 한글 문서에서 곧바로 <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-600 rounded text-[10px]">Ctrl+V</kbd>로 붙여넣을 수 있으며, <code className="text-zinc-300">InfiniteMathlab_YYMMDD_HHMMSS.png</code> 파일도 함께 저장됩니다.
                        <span className="block text-[10.5px] text-amber-200/90 mt-0.5">
                          💡 한글(HWP) 팁: 붙여넣은 그림의 개체 속성 크기를 <strong>12.5%</strong> 배율로 맞추면 평가원 시험지 표준 폰트 체급과 정확히 일치합니다.
                        </span>
                      </li>
                      <li>
                        <strong className="text-emerald-300">원(Circle) 1:1 정비율 자동 보정:</strong> TikZ 코드에 <code className="text-zinc-300">circle(...)</code> 명령어가 포함된 경우, <code className="text-zinc-300">x=Ncm, y=Ncm</code> 비율이 달라도 타원으로 찌그러지지 않게 큰 쪽 스케일 기준으로 <strong className="text-white">1:1 정원 비율을 자동 보정</strong>합니다.
                      </li>
                      <li>
                        <strong className="text-blue-300">[TikZ 코드(.txt) 포함] 세트 저장:</strong> 저장 버튼 좌측의 <code className="text-blue-200 bg-blue-950/60 px-1.5 py-0.5 rounded">[TikZ 코드(.txt) 포함]</code>을 켜 두면, 추후 재수정에 바로 쓸 수 있도록 그림과 동일한 파일명의 <code className="text-zinc-300">.txt</code> 소스 파일이 함께 다운로드됩니다.
                      </li>
                      <li>
                        <strong className="text-red-300">🚨 돋보기(Zoom 100%~200%)와 저장 크기의 차이:</strong> 상단 돋보기 슬라이더는 화면 미리보기 배율만 바꾸며, 실제 저장되는 고화질 이미지 크기와는 무관합니다.
                      </li>
                    </ul>
                  </div>
                )}
              </section>

              {/* ── 섹션 11: 지원 범위와 현재 제한 사항 ── */}
              <section
                id="help-manual-sec-11"
                data-testid="help-section-11"
                className="rounded-xl border border-zinc-800/90 bg-zinc-900/40 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleSection(11)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-black/25 hover:bg-black/40 text-left transition-all"
                >
                  <h4 className="text-[13px] font-black text-white flex items-center gap-2">
                    <span className="text-base">📌</span> 11. 지원 범위와 현재 제한 사항 (안전 보류 Hold 및 한글 입력 안내)
                  </h4>
                  {openSections[11] ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                </button>
                {openSections[11] && (
                  <div className="px-4 py-3.5 space-y-2.5 border-t border-zinc-800/60 text-[11.5px]">
                    <ul className="space-y-2 list-disc pl-4">
                      <li>
                        <strong className="text-emerald-300">스마트 그림 정리가 가장 잘 작동하는 단원:</strong> 좌표평면 위의 다항함수(일차·이차·삼차·사차), 지수·로그·삼각함수, 유리·무리함수, 원과 직선(접선·법선·할선) 및 교점·눈금·함수식·직선 이름이 포함된 표준 KICE 스타일 그래프.
                      </li>
                      <li>
                        <strong className="text-amber-300">도형 보호를 위해 자동 이동을 보류(Hold)하는 경우:</strong>
                        <ul className="list-disc pl-4 mt-1 space-y-1 text-zinc-300">
                          <li>좌표축(<code className="text-zinc-200">\draw[-&gt;]</code>)이 없는 순수 기하 도형(삼각형·원·다각형 단독 도형)에서의 축 기반 연산</li>
                          <li><code className="text-zinc-200">\clip</code> 경계 내부나 <code className="text-zinc-200">\fill</code> 음영 영역과 강하게 결합되어 이동 시 잘릴 위험이 있는 라벨</li>
                          <li>주변 8방향 후보 모두에 곡선·보조선이 밀집해 어디로 옮겨도 새로운 충돌이 발생하는 고밀도 영역</li>
                          <li><code className="text-zinc-200">\foreach</code> 루프 등으로 동적 생성된 비표준 매크로 노드 (이 경우 하단 조이스틱으로 1pt 미세 조정을 권장합니다)</li>
                        </ul>
                      </li>
                      <li>
                        <strong className="text-red-300">⚠️ 한글 텍스트 입력 주의사항:</strong> 전용 서버는 <code className="text-zinc-200">\usepackage&#123;kotex&#125;</code> 자동 래핑을 지원하지만, 공용 서버나 일부 수식 노드에서 한글 직접 입력 시 렌더링 에러나 폰트 이질감이 생길 수 있습니다. TikZ 코드 내부에는 <strong className="text-white">영문 알파벳·LaTeX 수식 라벨 사용을 권장</strong>하며, 한글 설명은 HWP에 붙여넣은 뒤 한글의 &lsquo;글상자&rsquo; 기능을 활용하는 것이 가장 깔끔합니다.
                      </li>
                    </ul>
                  </div>
                )}
              </section>

              {/* ── 섹션 12: 오류 발생 시 원본 보호 및 대처 방법 ── */}
              <section
                id="help-manual-sec-12"
                data-testid="help-section-12"
                className="rounded-xl border border-emerald-800/50 bg-emerald-950/15 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleSection(12)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-emerald-950/30 hover:bg-emerald-950/45 text-left transition-all"
                >
                  <h4 className="text-[13px] font-black text-emerald-200 flex items-center gap-2">
                    <span className="text-base">🛡️</span> 12. 오류 발생 시 원본 보호 및 대처 방법
                  </h4>
                  {openSections[12] ? <ChevronUp className="w-4 h-4 text-emerald-300" /> : <ChevronDown className="w-4 h-4 text-emerald-300" />}
                </button>
                {openSections[12] && (
                  <div className="px-4 py-3.5 space-y-2.5 border-t border-emerald-900/40 text-[11.5px]">
                    <div className="flex items-start gap-2.5 text-zinc-200">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-white">원본 코드 100% 무결성 보장:</strong> 스마트 그림 정리 계산 중 네트워크 지연이나 구문 오류가 발생하더라도 <strong className="text-emerald-300">에디터에 입력된 사용자의 원본 TikZ 코드는 절대 변경되거나 손상되지 않습니다.</strong>
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5 text-zinc-200">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-white">단계별 빠른 대처법:</strong>
                        <ol className="list-decimal pl-4 mt-1 space-y-1 text-zinc-300">
                          <li>스마트 그림 정리 적용 후 결과가 마음에 들지 않으면 에디터 상단의 <strong className="text-amber-300">[↩ 원본 복원]</strong> 버튼을 눌러 즉시 되돌립니다.</li>
                          <li>특정 라벨 1~2개만 살짝 닿아 있다면 하단 <strong className="text-blue-300">노드 선택 + 조이스틱(또는 방향키 / Alt+방향키)</strong>으로 0.1pt~1pt 단위로 빠르게 다듬습니다.</li>
                          <li>전용 서버(Dedicated) 연결이 일시적으로 지연될 때는 상단 서버 스위치를 <strong className="text-amber-300">Public(공용)</strong>으로 전환하여 작업을 이어갈 수 있습니다(코드 길이 4,000자 이하 권장).</li>
                        </ol>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        {/* ── 모달 하단 푸터 (개발자 크레딧 + 닫기) ── */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-t border-zinc-800/80 shrink-0 bg-black/35">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/ko.png"
              alt="고진일 팀장"
              className="w-8 h-8 rounded-full object-cover border-2 border-blue-400/40 shadow-md shadow-blue-500/20"
            />
            <div className="leading-none">
              <div className="text-[9px] text-blue-400/70 font-semibold tracking-wider uppercase">
                인피니트 수학연구소
              </div>
              <div className="text-[11px] font-bold text-white mt-0.5">고진일 팀장</div>
              <div className="text-[9px] text-zinc-500 font-medium">Designed &amp; Built by Jinil Ko</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === "quickstart" ? "fullguide" : "quickstart")}
              className="px-3 py-2 rounded-lg text-[11px] font-bold bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700 text-indigo-300 hover:text-indigo-200 transition-all"
            >
              {activeTab === "quickstart" ? "📖 전체 사용설명서 보기" : "⚡ 빠른 시작(6단계) 보기"}
            </button>
            <button
              type="button"
              data-testid="btn-help-close-bottom"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-[12px] font-bold bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-200 hover:text-white transition-all"
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
