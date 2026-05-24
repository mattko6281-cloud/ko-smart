"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { deflate } from "pako";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Copy, History, ChevronUp, ChevronDown,
  ChevronLeft, ChevronRight, MousePointer2,
  Download, Eye, Loader2, CloudCog, ZoomIn,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

// ─────────────────────────────────────────────────────────────
//  Kroki GET URL — zlib deflate + base64url (CORS-free)
// ─────────────────────────────────────────────────────────────
function encodeKroki(source: string): string {
  const bytes = new TextEncoder().encode(source);
  const compressed = deflate(bytes, { level: 9 });
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < compressed.length; i += CHUNK)
    binary += String.fromCharCode(...compressed.subarray(i, i + CHUNK));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function krokiUrl(source: string, format: "svg" | "png") {
  return `https://kroki.io/tikz/${format}/${encodeKroki(source)}`;
}

// ─────────────────────────────────────────────────────────────
//  줌 설정
//  BASE_WIDTH: SVG가 렌더링되는 고정 기준 너비(px)
//  transform: scale(zoomScale)으로 시각적 확대 — 레이아웃 공간은
//  wrapper div가 BASE_WIDTH*zoom × imgHeight*zoom으로 예약
// ─────────────────────────────────────────────────────────────
const BASE_WIDTH = 720; // SVG 기준 너비 (px)

// ─────────────────────────────────────────────────────────────
//  평가원 표준 템플릿 (클릭 한 번으로 로드)
// ─────────────────────────────────────────────────────────────
const KICE_TEMPLATE = `\\documentclass[tikz, border=10pt]{standalone}
\\usetikzlibrary{arrows.meta}

\\begin{document}
\\begin{tikzpicture}[>={Stealth[length=7pt, width=3.8pt]}, x=0.8cm, y=0.8cm]

    % Axes
    \\draw[->] (-1.5, 0) -- (5, 0) node [below left, inner sep=2pt, yshift=-2pt, font=\\rm, inner sep=1.5pt, xshift=2pt] {$x$};
    \\draw[->] (0, -1.5) -- (0, 7.5) node [below left, inner sep=2pt, xshift=-2pt, font=\\rm, inner sep=1.5pt, yshift=1pt] {$y$};

    % Origin
    \\node [below left, inner sep=2pt, transform shape, xscale=0.9, font=\\large] at (0,0) {$\\rm O$};

\\end{tikzpicture}
\\end{document}`;

export default function Home() {
  const [rawInput,       setRawInput]       = useState("");
  const [debouncedInput, setDebouncedInput] = useState("");
  const [svgUrl,         setSvgUrl]         = useState("");  // Kroki SVG GET URL
  const [isRendering,    setIsRendering]    = useState(false);
  const [renderError,    setRenderError]    = useState("");
  const [isDownloading,  setIsDownloading]  = useState(false);
  // zoomPercent: 100 ~ 200 정수 (슬라이더 값)
  // 100 = Fit to Container, 101~ = transform:scale
  const [zoomPercent,    setZoomPercent]    = useState<number>(100);
  // 로드된 이미지의 실제 렌더 높이 — 즌 모드 레이아웃 공간 예약
  const [imgRenderedH,   setImgRenderedH]   = useState<number>(0);
  const [selectedNodeIndex, setSelectedNodeIndex] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);

  // ── Debounce 800 ms ───────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedInput(rawInput), 800);
    return () => clearTimeout(t);
  }, [rawInput]);

  // ── SVG URL 설정 (빠르고 안전한 보디없는 방식) ────────────────────
  //  CORS 문제 없음: <img> 태그가 브라우저 수준에서 로드
  useEffect(() => {
    if (!debouncedInput.trim()) {
      setSvgUrl(""); setRenderError(""); setIsRendering(false);
      setImgRenderedH(0); return;
    }
    try {
      setIsRendering(true);
      setRenderError("");
      setImgRenderedH(0);
      setSvgUrl(krokiUrl(debouncedInput, "svg"));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Kroki encode error]", err);
      setRenderError("인코딩 오류: " + msg);
      setIsRendering(false);
    }
  }, [debouncedInput]);

  // ── 이미지 로드 완료 핸들러 ─────────────────────────────────
  const handleImgLoad = useCallback(() => {
    if (imgRef.current) {
      setImgRenderedH(imgRef.current.offsetHeight || imgRef.current.height);
    }
    setIsRendering(false);
    setRenderError("");
  }, []);

  // ── PNG 다운로드 (Kroki GET → Blob, Tainted Canvas 없음) ──
  const handleDownloadPng = async () => {
    if (!debouncedInput.trim()) { toast.error("다운로드할 코드가 없습니다."); return; }
    setIsDownloading(true);
    const url = krokiUrl(debouncedInput, "png");
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl; a.download = "KO-SMART_diagram.png";
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
      toast.success("PNG 저장 완료!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Kroki PNG error]", err);
      toast.error("PNG 저장 실패: " + msg);
    } finally { setIsDownloading(false); }
  };

  // ── 초고화질 PNG: svgUrl + crossOrigin=anonymous → Canvas 4000px ───
  //  Kroki SVG URL에 crossOrigin=anonymous 설정 → CORS 헤더 허용
  //  Canvas에 drawImage 후 toDataURL로 PNG 추출 (재요청 없음)
  const [isHighResDownloading, setIsHighResDownloading] = useState(false);
  const handleDownloadHighRes = () => {
    if (!svgUrl) {
      toast.error("렌더링된 SVG가 없습니다. 코드를 먼저 렌더링하세요.");
      return;
    }
    setIsHighResDownloading(true);
    const toastId = toast.loading("⏳ 초고화질 렌더링 중...");

    const img = new Image();
    img.crossOrigin = "anonymous";       // Kroki CORS 헤더 허용 요청
    img.onload = () => {
      try {
        const TARGET_W = 4000;
        const ratio    = img.naturalHeight / (img.naturalWidth || 1);
        const TARGET_H = Math.round(TARGET_W * ratio) || Math.round(TARGET_W * 0.8);

        const canvas = document.createElement("canvas");
        canvas.width  = TARGET_W;
        canvas.height = TARGET_H;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, TARGET_W, TARGET_H);
        ctx.drawImage(img, 0, 0, TARGET_W, TARGET_H);

        const ts   = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
        const pngData = canvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = pngData;
        a.download = `ko-smart-highres-${ts}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        toast.dismiss(toastId);
        toast.success("✅ 초고화질 PNG가 저장되었습니다!");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[High-res canvas]", err);
        toast.dismiss(toastId);
        toast.error("고화질 저장 실패: " + msg);
      } finally {
        setIsHighResDownloading(false);
      }
    };
    img.onerror = () => {
      toast.dismiss(toastId);
      toast.error("SVG 로드 실패 — 네트워크 또는 CORS 문제");
      setIsHighResDownloading(false);
    };
    // crossOrigin 선언 후 src 할당 (Safari 포함 모든 브라우저에서 순서 중요)
    // ?t=... 쿼리로 브라우저 캐시 우회 → 새로운 CORS 요청 강제
    img.src = `${svgUrl}?t=${Date.now()}`;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(rawInput);
    toast.success("클립보드에 복사되었습니다.");
  };

  // ── 평가원 표준 템플릿 로드 ────────────────────────────────
  const handleLoadTemplate = () => {
    setRawInput(KICE_TEMPLATE);
    // debounce를 거치지 않고 즉시 렌더링 트리거
    setDebouncedInput(KICE_TEMPLATE);
    toast.success("✅ 평가원 표준 템플릿이 로드되었습니다!");
  };

  // ── 노드 스캔 (\node, node, \coordinate 모두) ───────────
  const scanNodes = () => {
    const matches: { full: string; options: string; content: string; index: number }[] = [];
    const re = /(?:\\node|node|\\coordinate)\s*(?:\[([^\]]*)\])?\s*(?:\(([^)]*)\))?\s*(?:at\s*(\([^)]*\)))?\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rawInput)) !== null)
      matches.push({ full: m[0], options: m[1] ?? "", content: m[4] ?? "", index: m.index });
    return matches;
  };
  const nodes = scanNodes();

  const handleShift = (axis: "x" | "y", direction: number) => {
    if (selectedNodeIndex === null) { toast.error("조정할 노드를 먼저 선택해주세요."); return; }
    const node = nodes[parseInt(selectedNodeIndex)];
    if (!node) return;
    let opts = node.options;
    const key = `${axis}shift`;
    const re = new RegExp(`${key}\\s*=\\s*(-?\\d+)pt`);
    const hit = opts.match(re);
    let newVal = direction;
    if (hit) { newVal = parseInt(hit[1]) + direction; opts = opts.replace(re, `${key}=${newVal}pt`); }
    else opts = (opts.trim() ? opts + ", " : "") + `${key}=${newVal}pt`;

    const updatedFull = node.options
      ? node.full.replace(
          new RegExp(`\\[${node.options.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`),
          `[${opts}]`)
      : node.full.replace(/^((?:\\node|node|\\coordinate)\s*)/, `$1[${opts}] `);

    setRawInput(rawInput.slice(0, node.index) + updatedFull + rawInput.slice(node.index + node.full.length));
  };

  // ── 줌 계산 ─────────────────────────────────────────────────
  //  CSS zoom (transform과 달리 레이아웃 확장 O)
  //  100% → zoom:1.0 — 컨테이너에 답 Fit
  //  101%+ → zoom:N — 레이아웃이 실제로 확장 → overflow-auto 스크롤 동작
  const zoomScale = zoomPercent / 100;

  // ─────────────────────────────────────────────────────────
  return (
    <main className="flex flex-col h-screen overflow-hidden bg-[#0d1117] text-zinc-100 font-sans">

      {/* ══════════════════════════════════════════════════════
          HEADER
      ══════════════════════════════════════════════════════ */}
      <header className="h-14 shrink-0 border-b border-white/[0.06] bg-[#0d1117]/95 backdrop-blur-xl z-30 flex items-center px-5 gap-4">

        {/* 로고 + 브랜드명 */}
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="KO-SMART" className="h-8 w-auto object-contain drop-shadow" />
          <div className="flex flex-col leading-none">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[17px] font-black tracking-tight text-white">KO<span className="text-blue-400">-</span>SMART</span>
              <span className="text-[10px] font-bold text-blue-400/70 bg-blue-950/40 border border-blue-800/30 rounded px-1.5 py-0.5">v5.2</span>
              <span className="text-[9px] font-semibold text-amber-400/80 bg-amber-950/30 border border-amber-800/30 rounded px-1.5 py-0.5 tracking-tight">Jinil Edition</span>
            </div>
            <span
              className="text-[9px] text-slate-500 mt-0.5 tracking-wide cursor-default select-none hover:text-slate-400 transition-colors duration-200"
              title="평가원 최적화 수학 자동화 렌더링 툴"
            >
              KICE-Optimized Standard Math Automation &amp; Rendering Tool
            </span>
          </div>
        </div>

        <div className="h-7 w-px bg-zinc-800 mx-1" />

        {/* Kroki 상태 */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-950/30 border border-blue-800/25">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          <CloudCog className="w-3 h-3 text-blue-400" />
          <span className="text-[10px] font-bold text-blue-300/80 tracking-wider">Kroki · TeXLive</span>
        </div>

        {/* 헤더 우측: 개발자 프로필 + 복사 */}
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-950/50 to-zinc-900/60 border border-blue-800/30 shadow shadow-blue-900/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/ko.png" alt="고진일 팀장"
              className="w-8 h-8 rounded-full object-cover border-2 border-blue-400/50 shadow-md shadow-blue-500/20"
            />
            <div className="leading-none">
              <div className="text-[9px] text-blue-400/70 font-semibold tracking-wider uppercase">Lead Developer</div>
              <div className="text-[12px] font-bold text-white">고진일 팀장</div>
            </div>
          </div>

          <Button variant="ghost" size="sm"
            className="text-zinc-500 hover:text-white hover:bg-zinc-800/80 rounded-lg"
            onClick={handleCopy}>
            <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy
          </Button>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════
          MAIN — Code Editor  |  Preview
      ══════════════════════════════════════════════════════ */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* ── LEFT: Code Editor ─────────────────────────────── */}
        <div className="w-[44%] shrink-0 flex flex-col border-r border-white/[0.05] bg-[#0c1018]">
          <div className="px-4 py-2 border-b border-white/[0.05] flex items-center justify-between bg-zinc-900/30">
            <div className="flex items-center gap-2">
              <History className="w-3 h-3 text-blue-400/70" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400/70">Raw TikZ Code</span>
            </div>
            {/* 평가원 표준 템플릿 로드 버튼 */}
            <button
              onClick={handleLoadTemplate}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold tracking-tight transition-all duration-150 bg-blue-950/60 hover:bg-blue-900/70 border border-blue-800/40 hover:border-blue-600/60 text-blue-300 hover:text-blue-200 shadow-sm shadow-blue-900/20 group"
              title="평가원 표준 축 TikZ 코드를 입력창에 로드합니다"
            >
              <svg className="w-3 h-3 text-blue-400 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              평가원 기본 축 로드
            </button>
          </div>
          <Textarea
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            className="flex-1 bg-transparent border-0 focus-visible:ring-0 resize-none font-mono text-[12.5px] p-5 text-zinc-300 leading-relaxed placeholder:text-zinc-700"
            placeholder={"\\documentclass[tikz]{standalone}\n\\begin{document}\n\\begin{tikzpicture}\n  % ...\n\\end{tikzpicture}\n\\end{document}"}
          />
        </div>

        {/* ── RIGHT: Live Preview ───────────────────────────── */}
        <div className="flex-1 flex flex-col p-4 min-h-0 overflow-hidden bg-[#0d1117]">

          {/* Preview Toolbar */}
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div className="flex items-center gap-2">
              <Eye className="w-3.5 h-3.5 text-zinc-600" />
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Live Preview</span>
            </div>

            <div className="flex items-center gap-2">
              {/* ── 줌 슬라이더 ── */}
              <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5">
                <ZoomIn className="w-3 h-3 text-zinc-500 shrink-0" />
                <input
                  type="range"
                  min={100}
                  max={200}
                  step={5}
                  value={zoomPercent}
                  onChange={(e) => setZoomPercent(parseInt(e.target.value))}
                  className="w-24 h-1 accent-blue-500 cursor-pointer"
                />
                <span className="text-[11px] font-bold text-blue-300 w-9 text-right shrink-0">
                  {zoomPercent}%
                </span>
              </div>

              {/* ── Lead Developer 배지 ── */}
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-blue-950/60 to-zinc-900/50 border border-blue-800/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/ko.png" alt="고진일 팀장"
                  className="w-6 h-6 rounded-full object-cover border border-blue-400/40"
                />
                <span className="text-[10px] font-bold text-blue-300/80 whitespace-nowrap">고진일 팀장</span>
              </div>

              {/* ── PNG 저장 ── */}
              <Button
                id="btn-download-png"
                onClick={handleDownloadPng}
                disabled={isDownloading || !debouncedInput.trim()}
                size="sm"
                className="h-8 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold gap-1.5 px-3 shadow shadow-blue-600/30 disabled:opacity-40"
              >
                {isDownloading
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Download className="w-3 h-3" />}
                PNG
              </Button>

              {/* ── 초고화질 PNG (4000px) ── */}
              <Button
                id="btn-download-highres"
                onClick={handleDownloadHighRes}
                disabled={isHighResDownloading || !debouncedInput.trim()}
                size="sm"
                className="h-8 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white text-[11px] font-bold gap-1.5 px-3 shadow shadow-amber-500/30 disabled:opacity-40 border-0"
              >
                {isHighResDownloading
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Download className="w-3 h-3" />}
                초고화질 (4000px)
              </Button>
            </div>
          </div>

          {/* ── Preview Panel ─────────────────────────────── */}
          <div className="flex-1 rounded-xl border border-zinc-800/60 overflow-hidden shadow-2xl shadow-black/40 relative bg-white">

            {/* 로딩 오버레이 */}
            {isRendering && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/97">
                <div className="relative">
                  <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo.png" alt="" className="absolute inset-0 m-auto w-5 h-5 object-contain" />
                </div>
                <span className="text-sm font-semibold text-zinc-600">Rendering with Cloud TeX 엔진...</span>
                <span className="text-xs text-zinc-400">TeXLive · Kroki API</span>
              </div>
            )}

            {/* 에러 */}
            {!isRendering && renderError && (
              <div className="absolute inset-0 z-10 p-6 bg-white overflow-auto">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="font-bold text-red-500 text-sm">렌더링 오류</span>
                </div>
                <pre className="text-xs text-red-400/80 font-mono whitespace-pre-wrap break-words bg-red-50 p-3 rounded-lg border border-red-200">
                  {renderError}
                </pre>
              </div>
            )}

            {/* 빈 상태 */}
            {!svgUrl && !isRendering && !renderError && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo.png" alt="" className="h-12 w-auto mx-auto mb-4 opacity-20" />
                  <p className="text-sm text-zinc-400 font-medium">TikZ 코드를 입력하면</p>
                  <p className="text-sm text-zinc-500">Cloud TeX 엔진이 렌더링합니다</p>
                  <p className="text-[11px] text-zinc-600 mt-1">by 고진일 팀장 · KO-SMART v5.2</p>
                </div>
              </div>
            )}

            {/* ══ SVG 프리뷰 — 단일 바라보기, CSS zoom으로 레이아웃 확장 ══
                CSS zoom(1.5) = 레이아웃이 1.5로 실제 확장 → overflow-auto원 스크롤 동작
                transform: scale(1.5) = 시각 확대만, 레이아웃 불변 → 스크롤 안 됨
                100% → zoom:1.0, 이미지 컨테이너에 Fit
                105% → zoom:1.05, 정확히 5%만 확대 (점프 없음)
            ═════════════════════════════════════════════ */}
            {svgUrl && (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  overflow: "auto",
                  background: "white",
                }}
              >
                {/* 자식 div에 zoom 적용 → 이 div의 레이아웃이 zoom배율만큼 확장 */}
                <div
                  style={{
                    zoom: zoomScale,
                    minWidth: "100%",
                    minHeight: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "16px",
                    boxSizing: "border-box",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={svgUrl}
                    ref={imgRef}
                    src={svgUrl}
                    alt="TikZ diagram"
                    style={{
                      display: "block",
                      maxWidth: "100%",
                      height: "auto",
                      objectFit: "contain",
                    }}
                    onLoad={handleImgLoad}
                    onError={() => {
                      setRenderError("렌더링 실패: TikZ 문법 오류 또는 네트워크 문제");
                      setIsRendering(false);
                    }}
                  />
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          FOOTER — 항상 고정 (shrink-0)
      ══════════════════════════════════════════════════════ */}
      <footer className="shrink-0 border-t border-white/[0.05] bg-[#0a0d12] px-5 py-0 flex items-center gap-5 z-20 shadow-[0_-6px_24px_rgba(0,0,0,0.4)]" style={{ height: "80px" }}>

        {/* 팀 배너 */}
        <div className="flex items-center gap-3 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/team.png" alt="Infinite Math Lab Team"
            className="h-11 w-20 object-cover rounded-lg border border-zinc-800/60 opacity-85"
          />
          <div className="leading-none">
            <div className="text-[9px] text-zinc-600 font-medium tracking-wider">Powered by</div>
            <div className="text-[11px] font-bold text-zinc-200">Infinite Math Lab</div>
            <div className="text-[9px] text-blue-400/70 font-semibold">인피니트 수학연구소</div>
          </div>
        </div>

        <Separator orientation="vertical" className="h-10 bg-zinc-800/60" />

        {/* 노드 선택 */}
        <div className="flex flex-col shrink-0">
          <span className="text-[9px] font-bold text-zinc-700 uppercase tracking-wider mb-1">Node</span>
          <Select value={selectedNodeIndex ?? ""} onValueChange={setSelectedNodeIndex}>
            <SelectTrigger className="w-[190px] h-8 bg-zinc-900 border-zinc-800 text-[11px] font-medium text-zinc-300">
              <SelectValue placeholder={nodes.length > 0 ? "노드 선택..." : "노드 없음"} />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
              {nodes.map((n, i) => (
                <SelectItem key={i} value={i.toString()} className="text-xs">
                  {i + 1}. {n.content || "(empty)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator orientation="vertical" className="h-10 bg-zinc-800/60" />

        {/* 조이스틱 */}
        <div className="flex flex-col items-center shrink-0">
          <span className="text-[9px] font-bold text-zinc-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <MousePointer2 className="w-2.5 h-2.5" /> Joystick
          </span>
          <div className="flex items-center gap-1">
            {[
              { icon: ChevronLeft,  action: () => handleShift("x", -1) },
            ].concat([]).map(() => null)}
            <Button variant="outline" size="icon"
              className="w-7 h-7 rounded-full border-zinc-800 bg-zinc-900 hover:bg-blue-900/40 hover:border-blue-700 hover:text-blue-400 transition-all"
              onClick={() => handleShift("x", -1)}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <div className="flex flex-col gap-1">
              <Button variant="outline" size="icon"
                className="w-7 h-7 rounded-full border-zinc-800 bg-zinc-900 hover:bg-blue-900/40 hover:border-blue-700 hover:text-blue-400 transition-all"
                onClick={() => handleShift("y", 1)}>
                <ChevronUp className="w-3.5 h-3.5" />
              </Button>
              <Button variant="outline" size="icon"
                className="w-7 h-7 rounded-full border-zinc-800 bg-zinc-900 hover:bg-blue-900/40 hover:border-blue-700 hover:text-blue-400 transition-all"
                onClick={() => handleShift("y", -1)}>
                <ChevronDown className="w-3.5 h-3.5" />
              </Button>
            </div>
            <Button variant="outline" size="icon"
              className="w-7 h-7 rounded-full border-zinc-800 bg-zinc-900 hover:bg-blue-900/40 hover:border-blue-700 hover:text-blue-400 transition-all"
              onClick={() => handleShift("x", 1)}>
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* 버전 정보 */}
        <div className="ml-auto flex flex-col items-end shrink-0">
          <div className="flex items-center gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className="h-4 w-auto opacity-50" />
            <span className="text-[11px] font-black text-zinc-400">KO-SMART</span>
            <span className="text-[9px] font-bold text-blue-400/60">v5.2</span>
            <span className="text-[8px] font-bold text-amber-400/60">Jinil Ed.</span>
          </div>
          <div className="text-[8px] text-zinc-700 mt-0.5">Cloud TeX · Kroki API · GET Mode</div>
        </div>
      </footer>
    </main>
  );
}
