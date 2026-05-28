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
  RotateCcw, BookOpen, X, ClipboardCopy, Type,
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
// ─────────────────────────────────────────────────────────────
const BASE_WIDTH = 720;

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

// ─────────────────────────────────────────────────────────────
//  KICE 프롬프트 가이드 원문
// ─────────────────────────────────────────────────────────────
const KICE_PROMPT_GUIDE = `[TikZ 수학 그래프 렌더링 엄격한 스타일 가이드: 평가원(KICE) 스타일]

앞으로 모든 TikZ 수학 그래프 코드를 생성할 때는 웹 렌더링 환경(TikZJax)의 한계를 고려하여 아래의 규칙을 예외 없이 엄격하게 적용하세요.

1. [웹 렌더링 호환 및 언어 규칙 - 절대 규칙]
- 한글 원천 차단: \\usepackage{kotex} 패키지는 절대 선언하지 않습니다. 코드 내부의 모든 % 주석은 반드시 영어로만 작성하며, 노드(Node)나 텍스트 출력 부분에 한글을 절대 포함하지 않습니다. (모든 라벨은 수식, 기호, 영어로만 구성)
- 기본 환경: \\documentclass[tikz, border=10pt]{standalone} 및 \\usetikzlibrary{arrows.meta}만을 기본으로 포함합니다.

2. [전역 환경 및 1:1 비율 고정]
- 전역 화살표 및 스케일: 기하학적 왜곡을 막기 위해 x축과 y축의 스케일을 동일하게 설정하며, 대문자 Stealth 화살표 크기를 전역으로 지정합니다.
- 필수 적용 옵션: \\begin{tikzpicture}[>={Stealth[length=7pt, width=3.8pt]}, x=0.8cm, y=0.8cm]

3. [축(Axis) 렌더링 및 고정 뼈대]
- 축을 그릴 때는 기본 제공되는 [-stealth]를 절대 사용하지 않으며, 반드시 [->] 또는 [-Stealth]를 사용하여 전역 화살표 설정이 적용되도록 합니다.
- 축의 양 끝 라벨(x, y)은 비율 조절 없이 font=\\rm으로만 지정하고, 겹침 방지를 위한 shift 값을 반드시 포함합니다.
- x축 고정 뼈대: \\draw[->] (-1.5, 0) -- (5, 0) node [below left, inner sep=2pt, yshift=-2pt, font=\\rm, inner sep=1.5pt, xshift=2pt] {$x$};
- y축 고정 뼈대: \\draw[->] (0, -1.5) -- (0, 7.5) node [below left, inner sep=2pt, xshift=-2pt, font=\\rm, inner sep=1.5pt, yshift=1pt] {$y$};

4. [마이크로 타이포그래피: 폰트 및 라벨 스타일링]
- 배경색 투명도 유지: 텍스트가 선을 가리더라도 모든 텍스트 및 수식 노드에 fill=white 옵션을 절대 사용하지 않습니다. 모든 배경은 투명하게 둡니다.
- 대문자 점(Point) 라벨 (HWP 신명조 모방): 원점(\\rm O)을 포함해 그래프에 표시되는 모든 대문자 점 라벨(\\rm A, B, P, Q 등)은 일반 폰트 대신, 폰트 사이즈업과 비율 조절(transform shape, xscale=0.9, font=\\large)을 적용하고 반드시 $\\rm 대문자$ 형태를 유지합니다.
- 원점 노드 예시: \\node [below left, inner sep=2pt, transform shape, xscale=0.9, font=\\large] at (0,0) {$\\rm O$};
- 일반 대문자 노드 예시: \\node [right, transform shape, xscale=0.9, font=\\large, xshift=2pt] at (3,2) {$\\rm P$};
- 소문자 및 수식 폰트: 그래프 내부의 소문자 텍스트 및 수식(함수식 등), 각도(^\\circ) 등은 비율 조절 옵션을 빼고 font=\\rm을 기본으로 수식 모드($...$) 안에 작성합니다.

5. [점(Point) 및 교점 렌더링]
- 타원형 에러 방지: \\fill circle 명령어는 절대 금지합니다. 모든 렌더링 포인트는 반드시 \\node[circle, fill=black, inner sep=1.2pt] at (좌표) {}; 형태로 작성합니다.
- 노이즈 최소화: 불필요한 교점/접점의 검은 점 마커는 생략합니다.

6. [곡선 렌더링]
- 곡선은 임의의 점을 잇지 않고 수학 함수식 \\draw plot (\\x, {수식})을 사용하며 samples=150 이상을 적용합니다. (\\addplot 사용 금지)

7. [기하학적 기호 및 보조선 표시]
- 직각 기호: 수직(직각) 기호는 삼각형 바깥으로 튀어나가지 않도록 scope의 rotate 각도를 조절하여 반드시 도형 안쪽으로 그려지도록 세팅합니다.
- 길이 표시: 변 바깥쪽에 길이를 표시할 때는 직선 대신 부드럽게 휘어지는 점선(활시위 모양)을 사용합니다. (예: \\draw[dashed] (A) to[bend right=25] node[midway] {$12$} (B); -> 주의: fill=white 사용 안 함)
- 각도 및 이등분: 각도를 나타내는 선은 arc나 clip을 이용해 둥글게 그리고, 이등분 표시는 둥근 선 위에 점(node[circle])이나 짧은 평행선 두 개를 추가해 명확히 표기합니다.
- 길이 같음 기호(Tick marks) 방향 절대 주의: 변의 길이가 같음을 표시하는 짧은 선분(빗금)을 그릴 때는, 반드시 해당 변(선분)과 수직(직교)이 되도록 rotate 각도를 정확히 계산하여 설정합니다. 변과 평행하거나 비스듬하게 그리는 실수를 절대 금지합니다.`;

// ─────────────────────────────────────────────────────────────
//  메타수학용 프롬프트 가이드 원문
// ─────────────────────────────────────────────────────────────
const META_PROMPT_GUIDE = `[TikZ 수학 그래프 렌더링 엄격한 스타일 가이드: 평가원(KICE) 스타일]

앞으로 모든 TikZ 수학 그래프 코드를 생성할 때는 웹 렌더링 환경(TikZJax)의 한계를 고려하여 아래의 규칙을 예외 없이 엄격하게 적용하세요.

1. [웹 렌더링 호환 및 언어 규칙 - 절대 규칙]
- 한글 원천 차단: \\usepackage{kotex} 패키지는 절대 선언하지 않습니다. 코드 내부의 모든 % 주석은 반드시 영어로만 작성하며, 노드(Node)나 텍스트 출력 부분에 한글을 절대 포함하지 않습니다. (모든 라벨은 수식, 기호, 영어로만 구성)
- 기본 환경: \\documentclass[tikz, border=10pt]{standalone} 및 \\usetikzlibrary{arrows.meta}만을 기본으로 포함합니다.

2. [전역 환경 및 1:1 비율 고정]
- 전역 화살표 및 스케일: 기하학적 왜곡을 막기 위해 x축과 y축의 스케일을 동일하게 설정하며, 대문자 Stealth 화살표 크기를 전역으로 지정합니다.
- 필수 적용 옵션: \\begin{tikzpicture}[>={Stealth[length=11.2pt, width=6.08pt]}, x=0.8cm, y=0.8cm]

3. [축(Axis) 렌더링 및 고정 뼈대]
- 축을 그릴 때는 기본 제공되는 [-stealth]를 절대 사용하지 않으며, 반드시 [->] 또는 [-Stealth]를 사용하여 전역 화살표 설정이 적용되도록 합니다.
- 축의 양 끝 라벨(x, y)은 비율 조절 없이 font=\\rm으로만 지정하고, 겹침 방지를 위한 shift 값을 반드시 포함합니다.
- x축 고정 뼈대: \\draw[->, line width=0.48pt] (-1.5, 0) -- (5, 0) node [below left, inner sep=2pt, yshift=-2pt, scale=1.6, font=\\rm, inner sep=1.5pt, xshift=-3pt] {$x$};
- y축 고정 뼈대: \\draw[->, line width=0.48pt] (0, -1.5) -- (0, 7.5) node [below left, inner sep=2pt, xshift=-2pt, scale=1.6, font=\\rm, inner sep=1.5pt, yshift=1pt] {$y$};

4. [마이크로 타이포그래피: 폰트 및 라벨 스타일링]
- 배경색 투명도 유지: 텍스트가 선을 가리더라도 모든 텍스트 및 수식 노드에 fill=white 옵션을 절대 사용하지 않습니다. 모든 배경은 투명하게 둡니다.
- 대문자 점(Point) 라벨 (HWP 신명조 모방): 원점(\\rm O)을 포함해 그래프에 표시되는 모든 대문자 점 라벨(\\rm A, B, P, Q 등)은 일반 폰트 대신, 폰트 사이즈업과 비율 조절(transform shape, scale=1.6, xscale=0.9, font=\\large)을 적용하고 반드시 $\\rm 대문자$ 형태를 유지합니다.
- 원점 노드 예시: \\node [below left, inner sep=2pt, transform shape, scale=1.6, xscale=0.9, font=\\large] at (0,0) {$\\rm O$};
- 일반 대문자 노드 예시: \\node [right, transform shape, scale=1.6, xscale=0.9, font=\\large, xshift=2pt] at (3,2) {$\\rm P$};
- 소문자 및 수식 폰트: 그래프 내부의 소문자 텍스트 및 수식(함수식 등), 각도(^\\circ) 등은 비율 조절 옵션을 빼고 scale=1.6, font=\\rm을 기본으로 수식 모드($...$) 안에 작성합니다.

5. [점(Point) 및 교점 렌더링]
- 타원형 에러 방지: \\fill circle 명령어는 절대 금지합니다. 모든 렌더링 포인트는 반드시 \\node[circle, fill=black, inner sep=1.2pt] at (좌표) {}; 형태로 작성합니다.
- 노이즈 최소화: 불필요한 교점/접점의 검은 점 마커는 생략합니다.

6. [곡선 렌더링]
- 곡선은 임의의 점을 잇지 않고 수학 함수식 \\draw[line width=0.48pt] plot (\\x, {수식})을 사용하며 samples=150 이상을 적용합니다. (\\addplot 사용 금지)

7. [기하학적 기호 및 보조선 표시]
- 직각 기호: 수직(직각) 기호는 삼각형 바깥으로 튀어나가지 않도록 scope의 rotate 각도를 조절하여 반드시 도형 안쪽으로 그려지도록 세팅합니다.
- 길이 표시: 변 바깥쪽에 길이를 표시할 때는 직선 대신 부드럽게 휘어지는 점선(활시위 모양)을 사용합니다. (예: \\draw[dashed] (A) to[bend right=25] node[midway, scale=1.6] {$12$} (B); -> 주의: fill=white 사용 안 함)
- 각도 및 이등분: 각도를 나타내는 선은 arc나 clip을 이용해 둥글게 그리고, 이등분 표시는 둥근 선 위에 점(node[circle])이나 짧은 평행선 두 개를 추가해 명확히 표기합니다.
- 길이 같음 기호(Tick marks) 방향 절대 주의: 변의 길이가 같음을 표시하는 짧은 선분(빗금)을 그릴 때는, 반드시 해당 변(선분)과 수직(직교)이 되도록 rotate 각도를 정확히 계산하여 설정합니다. 변과 평행하거나 비스듬하게 그리는 실수를 절대 금지합니다.`;

// ─────────────────────────────────────────────────────────────
//  LocalStorage 키
// ─────────────────────────────────────────────────────────────
const LS_KEY = "kosmart_saved_code";

export default function Home() {
  const [rawInput,       setRawInput]       = useState("");
  const [debouncedInput, setDebouncedInput] = useState("");
  const [svgUrl,         setSvgUrl]         = useState("");  // Kroki SVG GET URL
  const [isRendering,    setIsRendering]    = useState(false);
  const [renderError,    setRenderError]    = useState("");
  const [isDownloading,  setIsDownloading]  = useState(false);
  const [zoomPercent,    setZoomPercent]    = useState<number>(100);
  const [imgRenderedH,   setImgRenderedH]   = useState<number>(0);
  const [selectedNodeIndex, setSelectedNodeIndex] = useState<string | null>(null);

  // KICE 프롬프트 모달
  const [isKiceModalOpen, setIsKiceModalOpen] = useState(false);
  const [isCopied,        setIsCopied]        = useState(false);

  // 메타수학 프롬프트 모달
  const [isMetaModalOpen, setIsMetaModalOpen] = useState(false);
  const [isMetaCopied,    setIsMetaCopied]    = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);

  // ── 마운트 시 LocalStorage에서 저장된 코드 복원 ──────────
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved && saved.trim()) {
      setRawInput(saved);
      setDebouncedInput(saved);
    } else {
      // 저장된 코드가 없으면 기본 축 코드 렌더링
      setRawInput(KICE_TEMPLATE);
      setDebouncedInput(KICE_TEMPLATE);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 코드 변경 시 LocalStorage에 즉시 Auto-Save ───────────
  const handleRawInputChange = useCallback((value: string) => {
    setRawInput(value);
    localStorage.setItem(LS_KEY, value);
  }, []);

  // ── 초기화: LocalStorage 비우고 기본 코드로 리셋 ──────────
  const handleResetCode = () => {
    localStorage.removeItem(LS_KEY);
    setRawInput(KICE_TEMPLATE);
    setDebouncedInput(KICE_TEMPLATE);
    toast.success("✅ 기본 코드로 초기화되었습니다.");
  };

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
  const [isHighResDownloading, setIsHighResDownloading] = useState(false);
  const handleDownloadHighRes = () => {
    if (!svgUrl) {
      toast.error("렌더링된 SVG가 없습니다. 코드를 먼저 렌더링하세요.");
      return;
    }
    setIsHighResDownloading(true);
    const toastId = toast.loading("⏳ 초고화질 렌더링 중...");

    const img = new Image();
    img.crossOrigin = "anonymous";
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
    img.src = `${svgUrl}?t=${Date.now()}`;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(rawInput);
    toast.success("클립보드에 복사되었습니다.");
  };

  // ── 평가원 표준 템플릿 로드 ────────────────────────────────
  const handleLoadTemplate = () => {
    handleRawInputChange(KICE_TEMPLATE);
    setDebouncedInput(KICE_TEMPLATE);
    toast.success("✅ 평가원 표준 템플릿이 로드되었습니다!");
  };

  // ── KICE 프롬프트 가이드 복사 ─────────────────────────────
  const handleCopyKicePrompt = async () => {
    try {
      await navigator.clipboard.writeText(KICE_PROMPT_GUIDE);
      setIsCopied(true);
      toast.success("✅ 프롬프트가 복사되었습니다!");
      setTimeout(() => setIsCopied(false), 2500);
    } catch {
      toast.error("복사에 실패했습니다. 직접 선택 후 복사해 주세요.");
    }
  };

  // ── 메타수학 프롬프트 가이드 복사 ────────────────────────────
  const handleCopyMetaPrompt = async () => {
    try {
      await navigator.clipboard.writeText(META_PROMPT_GUIDE);
      setIsMetaCopied(true);
      toast.success("✅ 메타수학 프롬프트가 복사되었습니다!");
      setTimeout(() => setIsMetaCopied(false), 2500);
    } catch {
      toast.error("복사에 실패했습니다. 직접 선택 후 복사해 주세요.");
    }
  };

  // ── 노드 스캔 — \node ... ; を セミコロンまで robust にパース ──
  //  중첩 중괄호({$\frac{1}{2}$}), 복잡한 좌표(at ({2+sqrt(2)}, 0)) 대응
  const scanNodes = () => {
    const matches: { full: string; options: string; content: string; index: number }[] = [];

    // \node / node / \coordinate 위치를 먼저 탐색
    const startRe = /(?:(?:\\node|\\coordinate)(?![a-zA-Z])|(?<![\\a-zA-Z])node(?![a-zA-Z]))/g;
    let startMatch: RegExpExecArray | null;

    while ((startMatch = startRe.exec(rawInput)) !== null) {
      const startIdx = startMatch.index;
      // 세미콜론까지 슬라이스 (최대 1000자)
      const slice = rawInput.slice(startIdx, startIdx + 1000);
      const semiIdx = slice.indexOf(";");
      if (semiIdx === -1) continue;
      const stmt = slice.slice(0, semiIdx + 1); // \node ... ;

      // options: [] 블록 (탐욕적이지 않게)
      const optMatch = stmt.match(/^(?:\\node|\\coordinate|node)\s*\[([^\]]*)\]/);
      const options = optMatch ? optMatch[1] : "";

      // content: 중첩 중괄호를 depth 카운팅으로 캡처
      const braceOpen = stmt.indexOf("{");
      if (braceOpen === -1) continue;
      let depth = 0;
      let contentStart = -1;
      let contentEnd = -1;
      for (let i = braceOpen; i < stmt.length; i++) {
        if (stmt[i] === "{" && stmt[i - 1] !== "\\") {
          depth++;
          if (depth === 1) contentStart = i + 1;
        } else if (stmt[i] === "}" && stmt[i - 1] !== "\\") {
          depth--;
          if (depth === 0) { contentEnd = i; break; }
        }
      }
      if (contentStart === -1 || contentEnd === -1) continue;
      const content = stmt.slice(contentStart, contentEnd);
      const full = stmt.slice(0, contentEnd + 1);

      matches.push({ full, options, content, index: startIdx });
      // 다음 탐색 시작점을 full 끝으로 이동 (중복 방지)
      startRe.lastIndex = startIdx + full.length;
    }
    return matches;
  };
  const nodes = scanNodes();

  // ── 선택된 노드의 표시 텍스트 계산 ─────────────────────────
  const getSelectedNodeLabel = () => {
    if (selectedNodeIndex === null) return undefined;
    const idx = parseInt(selectedNodeIndex);
    const node = nodes[idx];
    if (!node) return undefined;
    const content = node.content || "(empty)";
    return `${idx + 1}. ${content}`;
  };

  // ── 글로벌 폰트 스케일 조절 ──────────────────────────────
  //  \begin{tikzpicture}[...] 내부의 every node/.style={scale=N} 을 upsert
  const handleGlobalFontScale = (delta: number) => {
    // \begin{tikzpicture}[ ... ] 블록 전체를 depth 카운팅으로 추출
    const beginIdx = rawInput.indexOf("\\begin{tikzpicture}");
    if (beginIdx === -1) { toast.error("\\begin{tikzpicture} 를 찾을 수 없습니다."); return; }

    // [ 위치 탐색
    const bracketStart = rawInput.indexOf("[", beginIdx);
    if (bracketStart === -1) { toast.error("tikzpicture 옵션 [ 를 찾을 수 없습니다."); return; }

    // depth 카운팅으로 대응되는 ] 찾기
    let depth = 0;
    let bracketEnd = -1;
    for (let i = bracketStart; i < rawInput.length; i++) {
      if (rawInput[i] === "[") depth++;
      else if (rawInput[i] === "]") { depth--; if (depth === 0) { bracketEnd = i; break; } }
    }
    if (bracketEnd === -1) { toast.error("tikzpicture 옵션 ] 를 찾을 수 없습니다."); return; }

    const inner = rawInput.slice(bracketStart + 1, bracketEnd); // [...] 내부

    // every node/.style={scale=숫자} 패턴 파싱
    const existRe = /every\s+node\s*\/\.style\s*=\s*\{\s*scale\s*=\s*([0-9.]+)\s*\}/;
    const hit = inner.match(existRe);

    let newInner: string;
    if (hit) {
      // 이미 존재 → 숫자 업데이트
      const cur = parseFloat(hit[1]);
      const next = Math.max(0.3, Math.round((cur + delta) * 10) / 10);
      newInner = inner.replace(existRe, `every node/.style={scale=${next}}`);
    } else {
      // 없음 → 삽입
      const initVal = delta > 0 ? 1.1 : 0.9;
      newInner = inner.trimEnd() + `, every node/.style={scale=${initVal}}`;
    }

    const newCode =
      rawInput.slice(0, bracketStart + 1) +
      newInner +
      rawInput.slice(bracketEnd);
    handleRawInputChange(newCode);

    // 현재 적용 값 읽어 토스트로 안내
    const hitNew = newInner.match(existRe);
    const displayVal = hitNew ? hitNew[1] : (delta > 0 ? "1.1" : "0.9");
    toast.success(`✅ 전체 폰트 스케일: ${displayVal}`);
  };

  // ── 개별 노드 폰트 스케일 조절 (A+ / A-) ──────────────────
  //  선택된 노드의 [...] 옵션 내부 scale=N 을 0.1 단위 upsert
  const handleNodeFontScale = (delta: number) => {
    if (selectedNodeIndex === null) { toast.error("조정할 노드를 먼저 선택해주세요."); return; }
    const node = nodes[parseInt(selectedNodeIndex)];
    if (!node) return;

    let opts = node.options;
    const scaleRe = /(?<![a-zA-Z])scale\s*=\s*([0-9.]+)/;
    const hit = opts.match(scaleRe);

    if (hit) {
      const cur = parseFloat(hit[1]);
      const next = Math.max(0.5, Math.round((cur + delta) * 10) / 10);
      opts = opts.replace(scaleRe, `scale=${next}`);
    } else {
      const initVal = delta > 0 ? 1.1 : 0.9;
      opts = (opts.trim() ? opts + ", " : "") + `scale=${initVal}`;
    }

    const updatedFull = node.options
      ? node.full.replace(
          new RegExp(`\\[${node.options.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`),
          `[${opts}]`)
      : node.full.replace(/^((?:\\node|node|\\coordinate)\s*)/, `$1[${opts}] `);

    const newCode = rawInput.slice(0, node.index) + updatedFull + rawInput.slice(node.index + node.full.length);
    handleRawInputChange(newCode);
  };

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

    const newCode = rawInput.slice(0, node.index) + updatedFull + rawInput.slice(node.index + node.full.length);
    handleRawInputChange(newCode);
  };

  // ── 줌 계산 ─────────────────────────────────────────────────
  const zoomScale = zoomPercent / 100;

  // BASE_WIDTH suppression — used only for reference
  void BASE_WIDTH;
  void imgRenderedH;

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

        {/* ── 프롬프트 가이드 버튼 그룹 ── */}
        <div className="flex items-center gap-2">
          {/* KICE 가이드 버튼 */}
          <button
            id="btn-kice-prompt-guide"
            onClick={() => setIsKiceModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[11px] font-bold tracking-tight transition-all duration-150
              bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500
              text-white shadow-md shadow-emerald-900/40 border border-emerald-500/30 hover:border-emerald-400/50
              hover:scale-[1.03] active:scale-100 group"
            title="KICE TikZ 스타일 가이드 프롬프트 열기"
          >
            <BookOpen className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
            KICE 프롬프트 가이드
          </button>

          {/* 메타수학 가이드 버튼 */}
          <button
            id="btn-meta-prompt-guide"
            onClick={() => setIsMetaModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[11px] font-bold tracking-tight transition-all duration-150
              bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500
              text-white shadow-md shadow-blue-900/40 border border-blue-500/30 hover:border-blue-400/50
              hover:scale-[1.03] active:scale-100 group"
            title="메타수학용 TikZ 스타일 가이드 프롬프트 열기"
          >
            <BookOpen className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
            메타수학 프롬프트 가이드
          </button>
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
            <div className="flex items-center gap-2">
              {/* 초기화 버튼 */}
              <button
                id="btn-reset-code"
                onClick={handleResetCode}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold tracking-tight transition-all duration-150
                  bg-zinc-800/60 hover:bg-red-950/50 border border-zinc-700/40 hover:border-red-800/50
                  text-zinc-500 hover:text-red-300 group"
                title="LocalStorage를 비우고 기본 코드로 초기화합니다"
              >
                <RotateCcw className="w-2.5 h-2.5 group-hover:rotate-[-180deg] transition-transform duration-300" />
                초기화
              </button>
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
          </div>
          <Textarea
            value={rawInput}
            onChange={(e) => handleRawInputChange(e.target.value)}
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
              {/* ── 전체 폰트 스케일 컨트롤 ── */}
              <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5">
                <Type className="w-3 h-3 text-violet-400 shrink-0" />
                <span className="text-[10px] font-bold text-zinc-500 tracking-wide">전체폰트</span>
                <button
                  onClick={() => handleGlobalFontScale(-0.1)}
                  className="w-6 h-6 rounded-md bg-zinc-800 hover:bg-violet-900/50 border border-zinc-700 hover:border-violet-700 text-zinc-400 hover:text-violet-300 text-[13px] font-bold leading-none transition-all flex items-center justify-center"
                  title="전체 노드 폰트 크기 감소"
                >−</button>
                <button
                  onClick={() => handleGlobalFontScale(0.1)}
                  className="w-6 h-6 rounded-md bg-zinc-800 hover:bg-violet-900/50 border border-zinc-700 hover:border-violet-700 text-zinc-400 hover:text-violet-300 text-[13px] font-bold leading-none transition-all flex items-center justify-center"
                  title="전체 노드 폰트 크기 증가"
                >+</button>
              </div>

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

            {svgUrl && (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  overflow: "auto",
                  background: "white",
                }}
              >
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
      <footer className="shrink-0 border-t border-white/[0.05] bg-[#0a0d12] px-5 py-0 flex items-center gap-5 z-20 shadow-[0_-6px_24px_rgba(0,0,0,0.4)]" style={{ height: "88px" }}>

        {/* 팀 배너 — object-fit: contain으로 얼굴이 잘리지 않게 */}
        <div className="flex items-center gap-3 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/team.png" alt="Infinite Math Lab Team"
            className="rounded-lg border border-zinc-800/60 opacity-85"
            style={{
              height: "72px",
              width: "auto",
              maxWidth: "140px",
              objectFit: "contain",
              objectPosition: "center",
            }}
          />
          <div className="leading-none">
            <div className="text-[9px] text-zinc-600 font-medium tracking-wider">Powered by</div>
            <div className="text-[11px] font-bold text-zinc-200">Infinite Math Lab</div>
            <div className="text-[9px] text-blue-400/70 font-semibold">인피니트 수학연구소</div>
          </div>
        </div>

        <Separator orientation="vertical" className="h-10 bg-zinc-800/60" />

        {/* 노드 선택 — 선택된 노드의 실제 텍스트 표시 */}
        <div className="flex flex-col shrink-0">
          <span className="text-[9px] font-bold text-zinc-700 uppercase tracking-wider mb-1">Node</span>
          <Select
            value={selectedNodeIndex ?? ""}
            onValueChange={setSelectedNodeIndex}
          >
            <SelectTrigger className="w-[210px] h-8 bg-zinc-900 border-zinc-800 text-[11px] font-medium text-zinc-300">
              {/* 선택된 노드의 실제 텍스트를 직접 렌더링하여 인덱스 노출 버그 방지 */}
              {selectedNodeIndex !== null && nodes[parseInt(selectedNodeIndex)]
                ? <span className="truncate">{getSelectedNodeLabel()}</span>
                : <SelectValue placeholder={nodes.length > 0 ? "노드 선택..." : "노드 없음"} />
              }
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

        {/* 조이스틱 + 개별 노드 폰트 스케일 */}
        <div className="flex items-center gap-3 shrink-0">
          {/* 조이스틱 방향키 */}
          <div className="flex flex-col items-center">
            <span className="text-[9px] font-bold text-zinc-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <MousePointer2 className="w-2.5 h-2.5" /> Joystick
            </span>
            <div className="flex items-center gap-1">
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

          {/* 개별 노드 폰트 스케일 A+ / A- */}
          <div className="flex flex-col items-center">
            <span className="text-[9px] font-bold text-zinc-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Type className="w-2.5 h-2.5" /> Node Font
            </span>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => handleNodeFontScale(0.1)}
                className="w-[54px] h-7 rounded-md border border-zinc-800 bg-zinc-900 hover:bg-violet-900/40 hover:border-violet-700 hover:text-violet-300 text-zinc-400 text-[11px] font-black transition-all"
                title="선택된 노드 폰트 크기 증가 (+0.1)"
              >A＋</button>
              <button
                onClick={() => handleNodeFontScale(-0.1)}
                className="w-[54px] h-7 rounded-md border border-zinc-800 bg-zinc-900 hover:bg-violet-900/40 hover:border-violet-700 hover:text-violet-300 text-zinc-400 text-[11px] font-black transition-all"
                title="선택된 노드 폰트 크기 감소 (-0.1, 최소 0.5)"
              >A－</button>
            </div>
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

      {/* ══════════════════════════════════════════════════════
          KICE 프롬프트 가이드 모달
      ══════════════════════════════════════════════════════ */}
      {isKiceModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setIsKiceModalOpen(false); }}
        >
          <div
            className="relative w-full max-w-2xl max-h-[82vh] flex flex-col rounded-2xl border border-emerald-800/30 shadow-2xl shadow-emerald-900/30"
            style={{ background: "linear-gradient(145deg, #0d1f1a 0%, #0a1612 50%, #0d1117 100%)" }}
          >
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-emerald-900/30 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center shadow-md shadow-emerald-900/40">
                  <BookOpen className="w-4 h-4 text-white" />
                </div>
                <div className="leading-none">
                  <div className="text-[13px] font-black text-white tracking-tight">KICE 프롬프트 가이드</div>
                  <div className="text-[10px] text-emerald-400/70 mt-0.5 font-medium">TikZ 수학 그래프 렌더링 엄격한 스타일 가이드</div>
                </div>
              </div>
              <button
                onClick={() => setIsKiceModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all"
                title="닫기"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 가이드 텍스트 스크롤 영역 */}
            <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
              <pre
                className="text-[11.5px] text-zinc-300 font-mono leading-relaxed whitespace-pre-wrap break-words select-all"
                style={{ fontFamily: "'Fira Code', 'Consolas', 'Courier New', monospace" }}
              >
                {KICE_PROMPT_GUIDE}
              </pre>
            </div>

            {/* 모달 하단 — 복사 버튼 */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-emerald-900/30 shrink-0 bg-black/20">
              <span className="text-[10px] text-zinc-600">
                전체 선택 후 복사하거나 아래 버튼을 클릭하세요
              </span>
              <button
                id="btn-copy-kice-prompt"
                onClick={handleCopyKicePrompt}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-bold tracking-tight transition-all duration-200
                  ${isCopied
                    ? "bg-emerald-600/30 border border-emerald-500/50 text-emerald-300 scale-95"
                    : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 border border-emerald-500/30 text-white shadow-md shadow-emerald-900/40 hover:scale-[1.03] active:scale-100"
                  }`}
              >
                <ClipboardCopy className="w-4 h-4" />
                {isCopied ? "✅ 복사 완료!" : "원클릭 복사하기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          메타수학 프롬프트 가이드 모달
      ══════════════════════════════════════════════════════ */}
      {isMetaModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setIsMetaModalOpen(false); }}
        >
          <div
            className="relative w-full max-w-2xl max-h-[82vh] flex flex-col rounded-2xl border border-blue-800/30 shadow-2xl shadow-blue-900/30"
            style={{ background: "linear-gradient(145deg, #0d1525 0%, #0a1020 50%, #0d1117 100%)" }}
          >
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-blue-900/30 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-900/40">
                  <BookOpen className="w-4 h-4 text-white" />
                </div>
                <div className="leading-none">
                  <div className="text-[13px] font-black text-white tracking-tight">메타수학 프롬프트 가이드</div>
                  <div className="text-[10px] text-blue-400/70 mt-0.5 font-medium">TikZ 수학 그래프 렌더링 엄격한 스타일 가이드</div>
                </div>
              </div>
              <button
                onClick={() => setIsMetaModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all"
                title="닫기"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 가이드 텍스트 스크롤 영역 */}
            <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
              <pre
                className="text-[11.5px] text-zinc-300 font-mono leading-relaxed whitespace-pre-wrap break-words select-all"
                style={{ fontFamily: "'Fira Code', 'Consolas', 'Courier New', monospace" }}
              >
                {META_PROMPT_GUIDE}
              </pre>
            </div>

            {/* 모달 하단 — 복사 버튼 */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-blue-900/30 shrink-0 bg-black/20">
              <span className="text-[10px] text-zinc-600">
                전체 선택 후 복사하거나 아래 버튼을 클릭하세요
              </span>
              <button
                id="btn-copy-meta-prompt"
                onClick={handleCopyMetaPrompt}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-bold tracking-tight transition-all duration-200
                  ${isMetaCopied
                    ? "bg-blue-600/30 border border-blue-500/50 text-blue-300 scale-95"
                    : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 border border-blue-500/30 text-white shadow-md shadow-blue-900/40 hover:scale-[1.03] active:scale-100"
                  }`}
              >
                <ClipboardCopy className="w-4 h-4" />
                {isMetaCopied ? "✅ 복사 완료!" : "원클릭 복사하기"}
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
