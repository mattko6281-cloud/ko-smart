"use client";

import { useEffect, useState } from "react";

export function UpdateNoticeModal() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const hasSeen = localStorage.getItem("hasSeenUpdate_2406");
    if (!hasSeen) {
      setIsOpen(true);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem("hasSeenUpdate_2406", "true");
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-7 max-w-lg w-full text-zinc-50 flex flex-col gap-6 animate-in fade-in zoom-in duration-300 relative overflow-hidden">
        {/* 장식용 배경 요소 */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-blue-500/10 blur-3xl rounded-full" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-purple-500/10 blur-3xl rounded-full" />

        <div className="relative z-10">
          <h2 className="text-2xl font-bold tracking-tight mb-6 flex items-center gap-2">
            <span className="text-2xl">🎉</span> 
            <span>KO-SMART 업데이트 안내</span>
          </h2>
          
          <div className="space-y-5">
            <div className="flex gap-4 items-start bg-zinc-800/50 p-4 rounded-xl border border-zinc-700/50">
              <div className="text-2xl bg-zinc-800 p-2.5 rounded-lg shadow-sm border border-zinc-700">💾</div>
              <div>
                <h3 className="font-semibold text-zinc-100 text-base mb-1.5">TikZ 코드 세트 저장</h3>
                <p className="text-zinc-400 text-sm leading-relaxed break-keep">
                  상단 <strong className="text-zinc-300 font-medium">[TikZ 코드(.txt) 포함]</strong> 버튼을 체크하면, 추후 그래프 재수정에 활용할 수 있도록 그림과 동일한 이름의 원본 코드 파일이 세트로 다운로드됩니다.
                </p>
              </div>
            </div>

            <div className="flex gap-4 items-start bg-zinc-800/50 p-4 rounded-xl border border-zinc-700/50">
              <div className="text-2xl bg-zinc-800 p-2.5 rounded-lg shadow-sm border border-zinc-700">⌨️</div>
              <div>
                <h3 className="font-semibold text-zinc-100 text-base mb-1.5">키보드 방향키 정밀 제어</h3>
                <p className="text-zinc-400 text-sm leading-relaxed break-keep">
                  노드를 선택한 후, 마우스 클릭 없이 키보드 방향키(<kbd className="px-1.5 py-0.5 bg-zinc-700 rounded text-xs mx-0.5">↑</kbd><kbd className="px-1.5 py-0.5 bg-zinc-700 rounded text-xs mx-0.5">↓</kbd><kbd className="px-1.5 py-0.5 bg-zinc-700 rounded text-xs mx-0.5">←</kbd><kbd className="px-1.5 py-0.5 bg-zinc-700 rounded text-xs mx-0.5">→</kbd>)만으로 좌표를 이동시킬 수 있습니다.
                  <br/>
                  <span className="inline-block mt-1.5 px-2 py-1 bg-indigo-500/10 text-indigo-300 rounded text-xs border border-indigo-500/20">
                    Shift: 10배 크게 이동 / Alt: 1/10 미세 이동
                  </span>
                </p>
              </div>
            </div>

            <div className="flex gap-4 items-start bg-zinc-800/50 p-4 rounded-xl border border-zinc-700/50">
              <div className="text-2xl bg-zinc-800 p-2.5 rounded-lg shadow-sm border border-zinc-700">🖱️</div>
              <div>
                <h3 className="font-semibold text-zinc-100 text-base mb-1.5">제어 창 편의성 개편</h3>
                <p className="text-zinc-400 text-sm leading-relaxed break-keep">
                  '점 & 그래프 제어' 창 상단의 그립을 잡아 원하는 위치로 옮길 수 있으며, 빈 바탕을 클릭하면 창이 깔끔하게 닫힙니다.
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="mt-8 w-full py-3.5 bg-zinc-100 hover:bg-white text-zinc-900 rounded-xl font-bold transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 focus:ring-offset-zinc-900"
          >
            확인하고 닫기
          </button>
        </div>
      </div>
    </div>
  );
}
