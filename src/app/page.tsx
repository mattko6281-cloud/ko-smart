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
  RotateCcw, BookOpen, X, ClipboardCopy, Type, HelpCircle,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useSession, signIn as nextAuthSignIn } from "next-auth/react";
import { logUserAction } from "@/actions/logger";

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
% KICE Standard Style Guide Applied (English comments only, no Kotex)
\\usetikzlibrary{arrows.meta}

\\begin{document}
\\begin{tikzpicture}[>={Stealth[length=11.2pt, width=6.08pt]}, x=1.3cm, y=1.3cm, line width=0.48pt, every node/.style={scale=1.6, font=\\rm}]

    % Axes Construction
    % x-axis
    \\draw[->] (-1.5, 0) -- (5, 0) node [below left, inner sep=2pt, yshift=-2pt, xshift=2pt] {$x$};
    % y-axis
    \\draw[->] (0, -1.5) -- (0, 7.5) node [below left, inner sep=2pt, xshift=-2pt, yshift=1pt] {$y$};

    % Origin Node (Special large font, inherited scale=1.6 from global)
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
const META_PROMPT_GUIDE = `[TikZ 수학 그래프 렌더링 엄격한 스타일 가이드: 평가원(KICE) 스타일 v2.0 - 260531]

앞으로 모든 TikZ 수학 그래프 코드를 생성할 때는 웹 렌더링 환경(TikZJax)의 한계를 고려하여 아래의 규칙을 예외 없이 엄격하게 적용하세요.

1. [웹 렌더링 호환 및 완전한 문서 구조 - 절대 규칙]

- 한글 원천 차단: \\usepackage{kotex} 패키지는 절대 선언하지 않습니다. 코드 내부의 모든 % 주석은 반드시 영어로만 작성하며, 노드(Node)나 텍스트 출력 부분에 한글을 절대 포함하지 않습니다. (모든 라벨은 수식, 기호, 영어로만 구성)

- 완전한 코드 출력: 코드는 반드시 \\documentclass[tikz, border=10pt]{standalone}와 \\usetikzlibrary{arrows.meta} 선언으로 시작해야 합니다.
- Document 환경 필수 (가장 중요): 그 아래에 반드시 \\begin{document}를 열고 전체 \\begin{tikzpicture} ... \\end{tikzpicture} 코드를 작성한 뒤, 마지막에 \\end{document}로 닫으세요. 복붙 즉시 렌더링이 가능한 '완전한 전체 문서' 형태로만 출력해야 하며, 중간 코드만 발췌해서 출력하는 것을 엄격히 금지합니다.

2. [전역 환경 및 1.6배율 최적화 고정]

- 전역 폰트/화살표 및 스케일: 글자 크기(1.6배)와 기하학적 비율을 맞추기 위해 x축과 y축의 1단위 스케일을 1.3cm 수준으로 넉넉하게 설정합니다. 폰트와 화살표 크기, 기본 선 두께는 전역(Global)으로 한 번만 설정하여 중복 적용(가분수 현상)을 원천 차단합니다.
- 필수 적용 옵션: \\begin{tikzpicture}[>={Stealth[length=11.2pt, width=6.08pt]}, x=1.3cm, y=1.3cm, line width=0.48pt, every node/.style={scale=1.6, font=\\rm}]

3. [축(Axis) 렌더링 및 고정 뼈대]

- 축을 그릴 때는 기본 제공되는 [-stealth]를 절대 사용하지 않으며, 반드시 [->] 또는 [-Stealth]를 사용하여 전역 화살표 설정이 적용되도록 합니다.
- 축의 양 끝 라벨(x, y)은 겹침 방지를 위한 shift 값을 반드시 포함합니다. (전역 설정이 있으므로 node 안에 별도의 scale이나 font 옵션은 넣지 않습니다.)
- x축 고정 뼈대: \\draw[->] (-1.5, 0) -- (5, 0) node [below left, inner sep=2pt, yshift=-2pt, xshift=2pt] {$x$};
- y축 고정 뼈대: \\draw[->] (0, -1.5) -- (0, 7.5) node [below left, inner sep=2pt, xshift=-2pt, yshift=1pt] {$y$};

4. [마이크로 타이포그래피: 폰트 및 라벨 스타일링]

- 배경색 투명도 유지: 텍스트가 선을 가리더라도 모든 텍스트 및 수식 노드에 fill=white 옵션을 절대 사용하지 않습니다. 모든 배경은 투명하게 둡니다.
- 일반 텍스트 간소화: scale=1.6, font=\\rm은 전역 설정되었으므로, 개별 노드에는 위치 옵션(above, right 등)과 shift만 작성하여 코드를 간결하게 유지합니다.
- 대문자 점(Point) 라벨 (HWP 신명조 모방): 원점(\\rm O)을 포함해 그래프에 표시되는 모든 대문자 점 라벨(\\rm A, B, P, Q 등)은 특수 조작(transform shape, xscale=0.9, font=\\large)을 적용하고 반드시 $\\rm 대문자$ 형태를 유지합니다. (scale=1.6은 전역에서 상속받음)
- 원점 노드 예시: \\node [below left, inner sep=2pt, transform shape, xscale=0.9, font=\\large] at (0,0) {$\\rm O$};
- 분수 크기 보존(중요): 노드(\\node) 내에서 분수(\\frac), 시그마, 극한 등의 수식을 작성할 때는 기호가 위아래로 작게 눌리는 현상(Text style)을 방지하기 위해, 반드시 달러 기호 직후에 \\displaystyle을 선언하여 원래 크기(Display style)를 유지하세요. (예시: $\\displaystyle y = 2 - \\frac{4}{x}$)

5. [점(Point) 및 필수 마커 렌더링 제한]

- 타원형 에러 방지: 점을 그릴 때 \\fill circle 명령어는 절대 금지합니다. 모든 렌더링 포인트는 반드시 \\node[circle, fill=black, inner sep=1.2pt] at (좌표) {}; 형태로만 작성하여 웹 환경에서 완벽한 원형이 유지되도록 합니다.
- 무분별한 교점 표시 금지 (최신 트렌드 반영): 그래프의 모든 교점이나 축과의 만나는 점에 기계적으로 검은 점을 남발하지 마세요. 요새 평가원 스타일은 점을 생략하고 선만 깔끔하게 표현하는 추세입니다.
- 점 마커 허용 기준: 오직 문제 발문에서 직접 언급된 구체적인 점(예: 점 P, 점 Q)이거나, 함수의 불연속/포함 여부를 나타내는 구멍 뚫린 원(open circle) 또는 채워진 원(closed circle)일 때만 명시적으로 마커를 추가하세요. 일반적인 교점은 마커 없이 선의 교차로만 둡니다.

6. [곡선 및 주요 도형 렌더링]

- 메인 함수 곡선과 굵은 실선은 두께를 1.2배 키운 line width=0.96pt를 적용합니다. (보조선과 지시선은 전역 설정인 0.48pt를 따름)
- 곡선은 임의의 점을 잇지 않고 수학 함수식 \\draw[line width=0.96pt] plot (\\x, {수식})을 사용하며 samples=150 이상을 적용합니다. (\\addplot 사용 금지)

7. [기하학적 기호 및 보조선 표시]

- 직각 기호: 수직(직각) 기호는 삼각형 바깥으로 튀어나가지 않도록 scope의 rotate 각도를 조절하여 반드시 도형 안쪽으로 그려지도록 세팅합니다.
- 길이 표시: 변 바깥쪽에 길이를 표시할 때는 직선 대신 부드럽게 휘어지는 점선(활시위 모양)을 사용합니다. (예: \\draw[dashed] (A) to[bend right=25] node[midway] {$12$} (B);)
- bend 옵션 주의: 가로세로 축의 비율(x, y 스케일)이 크게 다를 경우 to[bend...] 사용 시 렌더링 버그가 발생하므로, 비대칭 스케일에서는 반드시 베지어 곡선(.. controls (x,y) ..)을 대신 사용합니다.
- 길이 같음 기호(Tick marks): 짧은 선분(빗금)을 그릴 때는 해당 변과 완벽히 수직(직교)이 되도록 rotate 각도를 정확히 계산하여 설정합니다.`;

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

  // 사용 설명서 모달 + 온보딩 상태
  const [isHelpOpen,          setIsHelpOpen]          = useState(false);
  const [hasSeenHelp,         setHasSeenHelp]         = useState(true); // 불마켜있음 시작, 마운트에서 정정

  // 점 마커 관리자 모달
  const [isPointManagerOpen,  setIsPointManagerOpen]  = useState(false);
  // 드래그 위치 상태
  const [pmPos, setPmPos] = useState<{ x: number; y: number } | null>(null);
  const pmDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);



  // USAGE_ENTER 중복 실행 방지 ref
  const hasLoggedEnter = useRef(false);

  // 마운트 시 hasSeenHelp 종류 확인
  useEffect(() => {
    const seen = localStorage.getItem("kosmart_seen_help");
    if (!seen) setHasSeenHelp(false);
  }, []);

  // ── 에디터 진입 로그 — status=authenticated + email 확정 후 단 1회 ──
  const { data: session, status } = useSession();
  useEffect(() => {
    if (status !== "authenticated") return;
    const email = session?.user?.email;
    if (!email) return;
    if (hasLoggedEnter.current) return; // 중복 차단
    hasLoggedEnter.current = true;
    logUserAction("USAGE_ENTER", email);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // 사용 설명서 열기 핸들러
  const handleOpenHelp = () => {
    setIsHelpOpen(true);
    if (!hasSeenHelp) {
      localStorage.setItem("kosmart_seen_help", "1");
      setHasSeenHelp(true);
    }
  };

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

  // ── 초기화: 에디터를 빈 상태로 비움 (평가원 기본 축 로드는 별도 버튼) ──────────
  const handleResetCode = () => {
    localStorage.removeItem(LS_KEY);
    setRawInput("");
    setDebouncedInput("");
    toast.success("✅ 에디터가 초기화되었습니다.");
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
    // 다운로드 액션 서버 로그
    logUserAction("EXPORT_DOWNLOAD", session?.user?.email ?? "", rawInput);
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

  // ── 노드 스캔 — 세미콜론 전 마지막 {...} 블록을 라벨로 추출 ──────────────
  //  at ({ln(23)/ln(2)}) 체 좌표 중괄호를 라벨로 오인하는 버그 해결:
  //  stmt 내에서 세미콜론 직전까지 스캔하여 마지막 가장 바깥 depth-0 진입점 == 라벨 시작
  const scanNodes = () => {
    const matches: { full: string; options: string; content: string; index: number }[] = [];

    // \node / node / \coordinate 위치를 먼저 탐색
    const startRe = /(?:(?:\\node|\\coordinate)(?![a-zA-Z])|(?<![\\a-zA-Z])node(?![a-zA-Z]))/g;
    let startMatch: RegExpExecArray | null;

    while ((startMatch = startRe.exec(rawInput)) !== null) {
      const startIdx = startMatch.index;
      // 세미콜론까지 슬라이스 (최대 1200자)
      const slice = rawInput.slice(startIdx, startIdx + 1200);
      const semiIdx = slice.indexOf(";");
      if (semiIdx === -1) continue;
      const stmt = slice.slice(0, semiIdx); // 세미콜론 미포함 (마지막 {...} 탐색용)

      // options: [] 블록 (탐욕적이지 않게)
      const optMatch = stmt.match(/^(?:\\node|\\coordinate|node)\s*\[([^\]]*)\]/);
      const options = optMatch ? optMatch[1] : "";

      // ▶ 라벨 = stmt 내에서 마지막 depth-0 진입점의 {...}
      //   세미콜론 앞까지 스캔하면서 가장 나중에 나오는
      //   대치되는 } 를 찾고, 거기서 역방향 depth-0 지점을 추적
      let labelStart = -1;
      let labelEnd   = -1;
      let depth = 0;
      for (let i = 0; i < stmt.length; i++) {
        const ch = stmt[i];
        const prev = i > 0 ? stmt[i - 1] : "";
        if (ch === "{" && prev !== "\\") {
          if (depth === 0) labelStart = i + 1; // 후보 시작점 갱신 (매번 새로 덮어쓀)
          depth++;
        } else if (ch === "}" && prev !== "\\") {
          depth--;
          if (depth === 0) labelEnd = i; // 후보 종료점 갱신 (매번 갱신 → 결국 마지막 측이 남음)
        }
      }
      if (labelStart === -1 || labelEnd === -1) continue;
      const content = stmt.slice(labelStart, labelEnd);
      // full = stmt 시작~라벨 닫히는 } 까지 (+1 인덱스, 세미콜론 제외)
      const full = stmt.slice(0, labelEnd + 1);

      matches.push({ full, options, content, index: startIdx });
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

  // ── Named Style 기준 두께 (pt) ─────────────────────────────
  const NAMED_WIDTHS: Record<string, number> = {
    "ultra thin":  0.1,
    "very thin":   0.2,
    thin:          0.4,
    semithick:     0.6,
    thick:         0.8,
    "very thick":  1.2,
    "ultra thick": 1.6,
  };
  // 정렬: 긴 이름 먼저 매칭 (very thick > thick 등 오인 방지)
  const NAMED_KEYS = Object.keys(NAMED_WIDTHS).sort((a, b) => b.length - a.length);

  // ── 배율 상태 ─────────────────────────────────────────────
  const [thicknessScale, setThicknessScale] = useState<number>(1.0);

  // ── 상대적 선 두께 스케일러 (Relative Thickness Scaler) ────
  //  ratio: 1.1 = +10% / 0.9 = -10% (클릭 1번에 정확히 배율 곱셈)
  //  1) Named Style → base pt × newScale 으로 치환 (원점 기반)
  //  2) line width=Xpt → X × ratio 고정 곱셈
  //  → 원본 선 간 비율이 스케일업 후에도 영구 유지
  const handleGlobalLineWidth = (ratio: number) => {
    if (!rawInput.trim()) { toast.error("코드가 비어 있습니다."); return; }

    const newScale = Math.max(0.01, Math.round(thicknessScale * ratio * 1000) / 1000);
    let result = rawInput;

    // ── Step 1: Named Style → base × newScale (원점 기반 누적 안전) ──
    for (const name of NAMED_KEYS) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      const namedRe = new RegExp(`(?<![\\w-])(${escaped})(?![\\w-])`, "g");
      const basePt  = NAMED_WIDTHS[name];
      const newPt   = Math.max(0.1, Math.round(basePt * newScale * 100) / 100);
      result = result.replace(namedRe, (_match, _p1, offset) => {
        const lineStart = result.lastIndexOf("\n", offset) + 1;
        if (result.slice(lineStart, offset).includes("%")) return _match; // 주석 줄 스킵
        return `line width=${newPt}pt`;
      });
    }

    // ── Step 2: 기존 line width=Xpt → X × ratio 직접 곱셈 ──────
    const lwRe = /(?<![a-zA-Z])line\s+width\s*=\s*([0-9.]+)pt/g;
    result = result.replace(lwRe, (_match, val, offset) => {
      const lineStart = result.lastIndexOf("\n", offset) + 1;
      if (result.slice(lineStart, offset).includes("%")) return _match; // 주석 줄 스킵
      const cur  = parseFloat(val);
      const next = Math.max(0.1, Math.round(cur * ratio * 100) / 100);
      return `line width=${next}pt`;
    });

    handleRawInputChange(result);
    setThicknessScale(newScale);
    toast.success(`✅ 선 두께 배율: ×${newScale.toFixed(2)}`);
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

  // ── X/Y 캔버스 비율 스케일러 ───────────────────────────────
  //  \begin{tikzpicture}[...] 내부의 x=Ncm / y=Ncm 을 배율로 upsert
  const handleCanvasScale = (axis: "x" | "y", ratio: number) => {
    if (!rawInput.trim()) { toast.error("코드가 비어 있습니다."); return; }

    const beginIdx = rawInput.indexOf("\\begin{tikzpicture}");
    if (beginIdx === -1) { toast.error("\\begin{tikzpicture} 를 찾을 수 없습니다."); return; }

    const bracketStart = rawInput.indexOf("[", beginIdx);
    if (bracketStart === -1) { toast.error("tikzpicture 옵션 [ 를 찾을 수 없습니다."); return; }

    // depth 카운팅으로 대응 ] 탐색
    let depth = 0;
    let bracketEnd = -1;
    for (let i = bracketStart; i < rawInput.length; i++) {
      if (rawInput[i] === "[") depth++;
      else if (rawInput[i] === "]") { depth--; if (depth === 0) { bracketEnd = i; break; } }
    }
    if (bracketEnd === -1) { toast.error("tikzpicture 옵션 ] 를 찾을 수 없습니다."); return; }

    const inner = rawInput.slice(bracketStart + 1, bracketEnd);

    // x=Ncm 또는 y=Ncm 패턴 (단어 경계 주의: xy= 같은 케이스 제외)
    const axisRe = new RegExp(`(?<![a-wyzA-WYZ])${axis}\\s*=\\s*([0-9.]+)cm`);
    const hit = inner.match(axisRe);

    let newInner: string;
    if (hit) {
      const cur = parseFloat(hit[1]);
      const next = Math.max(0.1, Math.round(cur * ratio * 100) / 100);
      newInner = inner.replace(axisRe, `${axis}=${next}cm`);
      const label = axis === "x" ? "가로 비율" : "세로 비율";
      toast.success(`✅ ${label}: ${next}cm`);
    } else {
      // 없을 경우 주입
      const initVal = ratio > 1 ? 1.1 : 0.9;
      newInner = inner.trimEnd() + `, ${axis}=${initVal}cm`;
      const label = axis === "x" ? "가로 비율" : "세로 비율";
      toast.success(`✅ ${label} 추가: ${initVal}cm`);
    }

    const newCode =
      rawInput.slice(0, bracketStart + 1) +
      newInner +
      rawInput.slice(bracketEnd);
    handleRawInputChange(newCode);
  };

  // ── 축(Axis) 길이 개별 조절 ────────────────────────────────
  //  axis: 'x' | 'y',  end: 'left'|'right' (x축) / 'bottom'|'top' (y축)
  //  delta: +0.5 = 늘리기, -0.5 = 줄이기
  //  패턴: X축 \draw[->] (num1, 0) -- (num2, 0)
  //         Y축 \draw[->] (0, num3) -- (0, num4)
  const handleAxisLength = (axis: "x" | "y", end: "left" | "right" | "bottom" | "top", delta: number) => {
    if (!rawInput.trim()) { toast.error("코드가 비어 있습니다."); return; }

    let updated: string;

    if (axis === "x") {
      // X축: \draw[->] (num1, 0) -- (num2, 0)  (공백 허용)
      // new RegExp 사용: 정규식 리터럴의 > 가 JSX 종결 태그로 오인되는 문제 방지
      const xRe = new RegExp(
        String.raw`(\\draw\s*\[-?>?\]\s*\()\s*(-?[0-9]+(?:\.[0-9]*)?)\s*,\s*0\s*(\)\s*--\s*\()\s*(-?[0-9]+(?:\.[0-9]*)?)\s*,\s*0\s*\)`
      );
      const m = rawInput.match(xRe);
      if (!m) {
        toast.error("X축 \\draw[->] 명령어를 찾을 수 없습니다.");
        return;
      }
      let num1 = parseFloat(m[2]);
      let num2 = parseFloat(m[4]);
      if (end === "left") {
        // 음의 방향(좌측) → num1 조절
        num1 = parseFloat((num1 + delta).toFixed(1));
      } else {
        // 양의 방향(우측) → num2 조절
        num2 = parseFloat((num2 + delta).toFixed(1));
      }
      updated = rawInput.replace(xRe, `${m[1]}${num1}, 0${m[3]}${num2}, 0)`);
      const endLabel = end === "left" ? `X좌측: ${num1}` : `X우측: ${num2}`;
      toast.success(`✅ ${endLabel}`);
    } else {
      // Y축: \draw[->] (0, num3) -- (0, num4)
      const yRe = new RegExp(
        String.raw`(\\draw\s*\[-?>?\]\s*\()\s*0\s*,\s*(-?[0-9]+(?:\.[0-9]*)?)\s*(\)\s*--\s*\()\s*0\s*,\s*(-?[0-9]+(?:\.[0-9]*)?)\s*\)`
      );
      const m = rawInput.match(yRe);
      if (!m) {
        toast.error("Y축 \\draw[->] 명령어를 찾을 수 없습니다.");
        return;
      }
      let num3 = parseFloat(m[2]);
      let num4 = parseFloat(m[4]);
      if (end === "bottom") {
        // 음의 방향(하단) → num3 조절
        num3 = parseFloat((num3 + delta).toFixed(1));
      } else {
        // 양의 방향(상단) → num4 조절
        num4 = parseFloat((num4 + delta).toFixed(1));
      }
      updated = rawInput.replace(yRe, `${m[1]}0, ${num3}${m[3]}0, ${num4})`);
      const endLabel = end === "bottom" ? `Y하단: ${num3}` : `Y상단: ${num4}`;
      toast.success(`✅ ${endLabel}`);
    }

    handleRawInputChange(updated);
  };

  // ─────────────────────────────────────────────────────────────
  //  점 마커 관리자: \node[circle, fill=black … 라인 추출 & 주석 토글
  // ─────────────────────────────────────────────────────────────
  /**
   * rawInput 에서 \node[circle, fill=black 을 포함하는 라인을 추출.
   * 주석 중인 (`% ` 접두어) 라인도 포함하되, isCommented 플래그를 함께 반환.
   */
  const extractedPoints: { raw: string; isCommented: boolean }[] = rawInput
    .split("\n")
    .filter((line) => /^\s*%?\s*\\node\s*\[.*fill=black/.test(line))
    .map((line) => ({
      raw: line,
      isCommented: /^\s*%/.test(line),
    }));

  /**
   * 점의 주석 상태를 토글:
   * - 현재 보이면(주석 없음) → `% ` 접두어를 연결하여 숨김
   * - 현재 숨겨짐(주석 있음) → `% ` 제거하여 되살림
   */
  const handleTogglePoint = (raw: string, isCommented: boolean) => {
    const lines = rawInput.split("\n");
    const updated = lines.map((l) => {
      if (l !== raw) return l;
      if (isCommented) {
        // 주석 해제: 맹 앞 `% ` (or `%`) 제거
        return l.replace(/^(\s*)%\s?/, "$1");
      } else {
        // 주석 처리: 라인 압두어에 `% ` 삽입
        return l.replace(/^(\s*)/, "$1% ");
      }
    });
    handleRawInputChange(updated.join("\n"));
    toast.success(isCommented ? "👁️ 점 표시" : "🛠️ 점 숨김");
  };

  // ── 줌 계산 ─────────────────────────────────────────────────
  const zoomScale = zoomPercent / 100;

  // BASE_WIDTH suppression — used only for reference
  void BASE_WIDTH;
  void imgRenderedH;

  // ── 잠금 화면 (unauthenticated) ─────────────────────────
  if (status === "unauthenticated") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0d1117] text-zinc-100 font-sans p-6">
        {/* 배경 그라디언트 효과 */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-950/30 via-transparent to-indigo-950/20 pointer-events-none" />

        {/* 로고 + 브랜드 */}
        <div className="relative flex flex-col items-center gap-6 max-w-md w-full">
          {/* 로고 */}
          <div className="flex flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="KO-SMART"
              className="h-20 w-auto object-contain drop-shadow-2xl"
            />
            <div className="text-center leading-none">
              <div className="flex items-center justify-center gap-2 mb-1">
                <span className="text-3xl font-black tracking-tight text-white">
                  KO<span className="text-blue-400">-</span>SMART
                </span>
                <span className="text-[11px] font-bold text-blue-400/70 bg-blue-950/40 border border-blue-800/30 rounded px-1.5 py-0.5">v5.2</span>
                <span className="text-[10px] font-semibold text-amber-400/80 bg-amber-950/30 border border-amber-800/30 rounded px-1.5 py-0.5">
                  Jinil Edition
                </span>
              </div>
              <p className="text-[12px] text-slate-500 tracking-wide">
                KICE-Optimized Standard Math Automation &amp; Rendering Tool
              </p>
            </div>
          </div>

          {/* 구분선 */}
          <div className="w-full h-px bg-gradient-to-r from-transparent via-zinc-700 to-transparent" />

          {/* 잠금 안내 카드 */}
          <div className="w-full rounded-2xl border border-zinc-800/60 bg-zinc-900/60 backdrop-blur-sm p-8 flex flex-col items-center gap-5 shadow-2xl shadow-black/50">
            {/* 자물 아이콘 */}
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-zinc-700 to-zinc-800 border border-zinc-700/60 flex items-center justify-center shadow-lg">
              <svg className="w-7 h-7 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>

            <div className="text-center">
              <h2 className="text-lg font-black text-white mb-1">접속 제한 영역</h2>
              <p className="text-[12px] text-zinc-500 leading-relaxed">
                이 서비스는 인피니트 수학연구소 팀원에게만<br />
                공개되어 있습니다. 허가된 구글 계정으로 로그인 후 접속하세요.
              </p>
            </div>

            {/* 구글 로그인 버튼 */}
            <button
              onClick={() => nextAuthSignIn("google")}
              className="w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl font-bold text-[14px] transition-all duration-200
                bg-white hover:bg-zinc-100 text-zinc-900 shadow-lg shadow-black/30
                hover:scale-[1.02] active:scale-[0.98] border border-zinc-200/20"
            >
              {/* Google 로고 SVG */}
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              구글 계정으로 로그인 (팀원 전용)
            </button>

            <p className="text-[10px] text-zinc-700">
              허가된 이메일 계정만 접속할 수 있습니다.
            </p>
          </div>

          {/* 하단 크레딧 */}
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ko.png" alt="고진일 팀장" className="w-8 h-8 rounded-full object-cover border-2 border-blue-400/40 opacity-70" />
            <div className="leading-none">
              <div className="text-[9px] text-blue-400/50 font-semibold tracking-wider uppercase">인피니트 수학연구소</div>
              <div className="text-[11px] font-bold text-zinc-500">고진일 팀장 개발</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 로딩 스피너 (세션 확인 중) ───────────────────────
  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0d1117]">
        <div className="flex flex-col items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="h-12 w-auto object-contain opacity-40 animate-pulse" />
          <div className="text-[12px] text-zinc-600">Loading...</div>
        </div>
      </div>
    );
  }

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

          {/* 사용 설명서 버튼 — 평상시 silver, hover 시 golden glow */}
          <button
            id="btn-help"
            onClick={handleOpenHelp}
            className={[
              "relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-tight",
              "bg-zinc-800/80 border border-zinc-600/50 text-zinc-200",
              "transition-all duration-300 hover:scale-[1.03] active:scale-100 group",
              "hover:border-amber-400/70 hover:text-amber-200",
            ].join(" ")}
            style={{
              // hover 글로우는 onMouseEnter/Leave로 동적 처리
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow =
                "0 0 10px 2px rgba(251,191,36,0.25), inset 0 0 6px 1px rgba(251,191,36,0.08)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "";
            }}
            title="KO-SMART 사용 설명서 열기"
          >
            <HelpCircle className="w-3.5 h-3.5 group-hover:scale-110 group-hover:text-amber-300 transition-all duration-300" />
            사용 설명서
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
                title="에디터를 완전히 비웁니다 (빈 상태로 초기화)"
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

          {/* Preview Toolbar — 심플 단일 줄 */}
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
                title="선택된 노드 폰트 크기 10% 증감"
              >A＋</button>
              <button
                onClick={() => handleNodeFontScale(-0.1)}
                className="w-[54px] h-7 rounded-md border border-zinc-800 bg-zinc-900 hover:bg-violet-900/40 hover:border-violet-700 hover:text-violet-300 text-zinc-400 text-[11px] font-black transition-all"
                title="선택된 노드 폰트 크기 10% 증감"
              >A－</button>
            </div>
          </div>
        </div>

        <Separator orientation="vertical" className="h-10 bg-zinc-800/60" />

        {/* ── GLOBAL CONTROLS ── */}
        <div className="flex flex-col shrink-0">
          <span className="text-[9px] font-bold text-zinc-700 uppercase tracking-wider mb-1.5">Global Controls</span>
          <div className="grid grid-cols-2 gap-1">

            {/* 전체 폰트 */}
            <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800/80 rounded-md px-1.5 py-1">
              <Type className="w-2.5 h-2.5 text-violet-400 shrink-0" />
              <span className="text-[9px] font-bold text-zinc-600 w-7 tracking-wide">폰트</span>
              <button
                onClick={() => handleGlobalFontScale(-0.1)}
                className="w-5 h-5 rounded bg-zinc-800 hover:bg-violet-900/50 border border-zinc-700 hover:border-violet-700 text-zinc-400 hover:text-violet-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                title="전체 노드 폰트 크기 감소"
              >−</button>
              <button
                onClick={() => handleGlobalFontScale(0.1)}
                className="w-5 h-5 rounded bg-zinc-800 hover:bg-violet-900/50 border border-zinc-700 hover:border-violet-700 text-zinc-400 hover:text-violet-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                title="전체 노드 폰트 크기 증가"
              >+</button>
            </div>

            {/* 선두께 */}
            <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800/80 rounded-md px-1.5 py-1">
              <svg className="w-2.5 h-2.5 text-cyan-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" d="M3 12h18" />
                <path strokeLinecap="round" strokeWidth={1} d="M3 7h18M3 17h18" />
              </svg>
              <span className="text-[9px] font-bold text-zinc-600 w-7 tracking-wide">두께</span>
              <button
                onClick={() => handleGlobalLineWidth(0.9)}
                className="w-5 h-5 rounded bg-zinc-800 hover:bg-cyan-900/50 border border-zinc-700 hover:border-cyan-700 text-zinc-400 hover:text-cyan-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                title="선 두께 10% 감소 (배율 적용)"
              >−</button>
              <button
                onClick={() => handleGlobalLineWidth(1.1)}
                className="w-5 h-5 rounded bg-zinc-800 hover:bg-cyan-900/50 border border-zinc-700 hover:border-cyan-700 text-zinc-400 hover:text-cyan-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                title="선 두께 10% 증가 (배율 적용)"
              >+</button>
            </div>

            {/* 가로 (X) */}
            <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800/80 rounded-md px-1.5 py-1">
              <svg className="w-2.5 h-2.5 text-emerald-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" />
              </svg>
              <span className="text-[9px] font-bold text-zinc-600 w-7 tracking-wide">가로</span>
              <button
                onClick={() => handleCanvasScale("x", 0.9)}
                className="w-5 h-5 rounded bg-zinc-800 hover:bg-emerald-900/50 border border-zinc-700 hover:border-emerald-700 text-zinc-400 hover:text-emerald-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                title="가로 비율 10% 감소 (x=Ncm 배율 적용)"
              >−</button>
              <button
                onClick={() => handleCanvasScale("x", 1.1)}
                className="w-5 h-5 rounded bg-zinc-800 hover:bg-emerald-900/50 border border-zinc-700 hover:border-emerald-700 text-zinc-400 hover:text-emerald-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                title="가로 비율 10% 증가 (x=Ncm 배율 적용)"
              >+</button>
            </div>

            {/* 세로 (Y) */}
            <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800/80 rounded-md px-1.5 py-1">
              <svg className="w-2.5 h-2.5 text-rose-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4" />
              </svg>
              <span className="text-[9px] font-bold text-zinc-600 w-7 tracking-wide">세로</span>
              <button
                onClick={() => handleCanvasScale("y", 0.9)}
                className="w-5 h-5 rounded bg-zinc-800 hover:bg-rose-900/50 border border-zinc-700 hover:border-rose-700 text-zinc-400 hover:text-rose-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                title="세로 비율 10% 감소 (y=Ncm 배율 적용)"
              >−</button>
              <button
                onClick={() => handleCanvasScale("y", 1.1)}
                className="w-5 h-5 rounded bg-zinc-800 hover:bg-rose-900/50 border border-zinc-700 hover:border-rose-700 text-zinc-400 hover:text-rose-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                title="세로 비율 10% 증가 (y=Ncm 배율 적용)"
              >+</button>
            </div>

          </div>
        </div>

        <Separator orientation="vertical" className="h-10 bg-zinc-800/60" />

        {/* 축 길이 조절 (Axis Length) */}
        <div className="flex flex-col shrink-0">
          <span className="text-[9px] font-bold text-zinc-700 uppercase tracking-wider mb-1.5">Axis Length</span>
          <div className="flex flex-col gap-1">

            {/* X축 (가로) */}
            <div className="flex items-center gap-2 bg-zinc-900/80 border border-zinc-800/80 rounded-md px-2 py-1">
              <span className="text-[9px] font-bold text-amber-400/80 w-[46px] shrink-0">X축 가로</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-zinc-500">좌측</span>
                <button
                  onClick={() => handleAxisLength("x", "left", 0.2)}
                  className="w-5 h-5 rounded bg-zinc-800 hover:bg-amber-900/50 border border-zinc-700 hover:border-amber-700 text-zinc-400 hover:text-amber-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                  title="X축 좌측 길이 -0.2"
                >&minus;</button>
                <button
                  onClick={() => handleAxisLength("x", "left", -0.2)}
                  className="w-5 h-5 rounded bg-zinc-800 hover:bg-amber-900/50 border border-zinc-700 hover:border-amber-700 text-zinc-400 hover:text-amber-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                  title="X축 좌측 길이 +0.2"
                >+</button>
              </div>
              <div className="w-px h-4 bg-zinc-700/60 shrink-0" />
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-zinc-500">우측</span>
                <button
                  onClick={() => handleAxisLength("x", "right", -0.2)}
                  className="w-5 h-5 rounded bg-zinc-800 hover:bg-amber-900/50 border border-zinc-700 hover:border-amber-700 text-zinc-400 hover:text-amber-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                  title="X축 우측 길이 -0.2"
                >&minus;</button>
                <button
                  onClick={() => handleAxisLength("x", "right", 0.2)}
                  className="w-5 h-5 rounded bg-zinc-800 hover:bg-amber-900/50 border border-zinc-700 hover:border-amber-700 text-zinc-400 hover:text-amber-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                  title="X축 우측 길이 +0.2"
                >+</button>
              </div>
            </div>

            {/* Y축 (세로) */}
            <div className="flex items-center gap-2 bg-zinc-900/80 border border-zinc-800/80 rounded-md px-2 py-1">
              <span className="text-[9px] font-bold text-sky-400/80 w-[46px] shrink-0">Y축 세로</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-zinc-500">하단</span>
                <button
                  onClick={() => handleAxisLength("y", "bottom", 0.2)}
                  className="w-5 h-5 rounded bg-zinc-800 hover:bg-sky-900/50 border border-zinc-700 hover:border-sky-700 text-zinc-400 hover:text-sky-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                  title="Y축 하단 길이 -0.2"
                >&minus;</button>
                <button
                  onClick={() => handleAxisLength("y", "bottom", -0.2)}
                  className="w-5 h-5 rounded bg-zinc-800 hover:bg-sky-900/50 border border-zinc-700 hover:border-sky-700 text-zinc-400 hover:text-sky-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                  title="Y축 하단 길이 +0.2"
                >+</button>
              </div>
              <div className="w-px h-4 bg-zinc-700/60 shrink-0" />
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-zinc-500">상단</span>
                <button
                  onClick={() => handleAxisLength("y", "top", -0.2)}
                  className="w-5 h-5 rounded bg-zinc-800 hover:bg-sky-900/50 border border-zinc-700 hover:border-sky-700 text-zinc-400 hover:text-sky-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                  title="Y축 상단 길이 -0.2"
                >&minus;</button>
                <button
                  onClick={() => handleAxisLength("y", "top", 0.2)}
                  className="w-5 h-5 rounded bg-zinc-800 hover:bg-sky-900/50 border border-zinc-700 hover:border-sky-700 text-zinc-400 hover:text-sky-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                  title="Y축 상단 길이 +0.2"
                >+</button>
              </div>
            </div>

          </div>
        </div>

        <Separator orientation="vertical" className="h-10 bg-zinc-800/60" />

        {/* 점 마커 관리 버튼 */}
        <button
          onClick={() => setIsPointManagerOpen(true)}
          className="flex flex-col items-center justify-center gap-0.5 shrink-0 px-3 py-1.5 rounded-lg border border-zinc-700/60 bg-zinc-900/80 hover:bg-fuchsia-950/40 hover:border-fuchsia-700/60 transition-all group"
          title="\node[circle, fill=black 마커 목록을 보고 개별 삭제합니다"
        >
          <span className="text-[9px] font-bold text-zinc-600 group-hover:text-fuchsia-400 uppercase tracking-wider transition-colors">
            점 마커 관리
          </span>
          <span className="text-[11px] font-black text-zinc-500 group-hover:text-fuchsia-300 transition-colors">
            {extractedPoints.length > 0
              ? `● ${extractedPoints.length}개`
              : "없음"}
          </span>
        </button>

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
          점 마커 관리자 — 네이티브 드래그 플로팅 패널
      ══════════════════════════════════════════════════════ */}
      {isPointManagerOpen && (
        <div
          ref={panelRef}
          className="fixed z-40 w-[240px] flex flex-col rounded-xl border border-fuchsia-800/40 shadow-2xl shadow-fuchsia-900/30 select-none"
          style={{
            background: "linear-gradient(145deg, #160e1e 0%, #0e0d17 60%, #0d1117 100%)",
            top:  pmPos ? pmPos.y : 60,
            right: pmPos ? undefined : 20,
            left:  pmPos ? pmPos.x : undefined,
          }}
        >
          {/* 드래그 핸들 헤더 */}
          <div
            className="flex items-center justify-between px-3 py-2.5 border-b border-fuchsia-900/30 cursor-grab active:cursor-grabbing"
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest("button")) return;
              const rect = panelRef.current!.getBoundingClientRect();
              pmDragRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                originX: rect.left,
                originY: rect.top,
              };
              const onMove = (mv: MouseEvent) => {
                if (!pmDragRef.current) return;
                const dx = mv.clientX - pmDragRef.current.startX;
                const dy = mv.clientY - pmDragRef.current.startY;
                setPmPos({
                  x: pmDragRef.current.originX + dx,
                  y: pmDragRef.current.originY + dy,
                });
              };
              const onUp = () => {
                pmDragRef.current = null;
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
              };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }}
          >
            <div className="flex items-center gap-2">
              {/* grip 도트 */}
              <svg className="w-3 h-3 text-fuchsia-700/60 shrink-0" viewBox="0 0 12 18" fill="currentColor">
                <circle cx="3" cy="3"  r="1.3" /><circle cx="9" cy="3"  r="1.3" />
                <circle cx="3" cy="9"  r="1.3" /><circle cx="9" cy="9"  r="1.3" />
                <circle cx="3" cy="15" r="1.3" /><circle cx="9" cy="15" r="1.3" />
              </svg>
              <span className="text-[11px] font-black text-white">점 마커</span>
              <span className="text-[9px] text-zinc-600">{extractedPoints.length}개</span>
            </div>
            <button
              onClick={() => setIsPointManagerOpen(false)}
              className="w-5 h-5 rounded flex items-center justify-center text-zinc-600 hover:text-white hover:bg-zinc-800 transition-all"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          {/* 리스트 */}
          <div className="overflow-y-auto max-h-[55vh] px-2.5 py-2">
            {extractedPoints.length === 0 ? (
              <p className="text-[10px] text-zinc-700 text-center py-4">점 마커 없음</p>
            ) : (
              <ul className="space-y-1">
                {extractedPoints.map(({ raw, isCommented }, idx) => {
                  const m = raw.match(/at\s*\(([^)]+)\)/);
                  const coord = m ? m[1].trim() : "?";
                  return (
                    <li
                      key={idx}
                      className={`flex items-center gap-1.5 rounded-lg px-2 py-1 border transition-all ${
                        isCommented
                          ? "bg-zinc-900/30 border-zinc-800/30 opacity-40"
                          : "bg-zinc-900/60 border-zinc-800/50 hover:border-fuchsia-800/50"
                      }`}
                    >
                      {/* 순번 */}
                      <span className="shrink-0 w-4 h-4 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-600 text-[7px] font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      {/* 좌표 배지 */}
                      <span className={`flex-1 text-[10px] font-mono font-bold rounded px-1.5 py-0.5 border ${
                        isCommented
                          ? "text-zinc-600 bg-zinc-800/30 border-zinc-700/20"
                          : "text-fuchsia-300/90 bg-fuchsia-950/40 border-fuchsia-900/30"
                      }`}>
                        ({coord})
                      </span>
                      {/* 눈 토글 */}
                      <button
                        onClick={() => handleTogglePoint(raw, isCommented)}
                        className={`shrink-0 w-6 h-6 rounded flex items-center justify-center border transition-all ${
                          isCommented
                            ? "text-zinc-600 hover:text-fuchsia-400 bg-zinc-900 border-zinc-700 hover:border-fuchsia-700"
                            : "text-fuchsia-400 bg-fuchsia-950/40 border-fuchsia-900/40 hover:border-fuchsia-500"
                        }`}
                        title={isCommented ? "표시 (% 해제)" : "숨김 (% 주석)"}
                      >
                        {isCommented ? (
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        ) : (
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* 힌트 */}
          <div className="px-3 py-1.5 border-t border-fuchsia-900/20 bg-black/20">
            <p className="text-[8px] text-zinc-700">👁 토글 = <code className="text-zinc-600">%</code> 주석 스위치</p>
          </div>
        </div>
      )}

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

      {/* ══════════════════════════════════════════════════════
          사용 설명서 모달
      ══════════════════════════════════════════════════════ */}
      {isHelpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.80)", backdropFilter: "blur(8px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setIsHelpOpen(false); }}
        >
          <div
            className="relative w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl border border-zinc-700/40 shadow-2xl shadow-black/60"
            style={{ background: "linear-gradient(145deg, #13161e 0%, #0e1117 60%, #0d1117 100%)" }}
          >
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-zinc-600 to-zinc-700 flex items-center justify-center shadow-md">
                  <HelpCircle className="w-4 h-4 text-white" />
                </div>
                <div className="leading-none">
                  <div className="text-[14px] font-black text-white tracking-tight">🚀 KO-SMART 사용 설명서</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5 font-medium">v5.2 · Jinil Edition · 완벽 활용 가이드</div>
                </div>
              </div>
              <button
                onClick={() => setIsHelpOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all"
                title="닫기"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 컨텐츠 스크롤 영역 */}
            <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0 space-y-5 text-[12.5px] text-zinc-300 leading-relaxed">

              {/* 인트로 */}
              <p className="text-zinc-400 text-[12px]">
                KICE 표준 수학 그래프 렌더링 툴에 오신 것을 환영합니다. 아래 버튼들의 정확한 용도를 확인하세요.
              </p>

              <hr className="border-zinc-800" />

              {/* 섹션 1 */}
              <div>
                <h4 className="text-[13px] font-black text-white mb-2.5 flex items-center gap-2">
                  <span className="text-base">🎯</span> 1. 개별 노드 정밀 제어
                  <span className="text-[10px] font-semibold text-zinc-600 bg-zinc-800/60 px-2 py-0.5 rounded-full">좌측 하단 패널</span>
                </h4>
                <ul className="space-y-2.5 pl-1">
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 inline-block bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] font-bold px-2 py-0.5 rounded font-mono">노드 선택…</span>
                    <span><strong className="text-zinc-200">(드롭다운)</strong> 위치나 크기를 바꾸고 싶은 특정 글자/수식을 목록에서 선택합니다.</span>
                  </li>
                  <li className="flex items-start gap-2 flex-wrap gap-y-1">
                    <span className="shrink-0 mt-0.5 flex gap-1">
                      {["▲","▼","◀","▶"].map(c => (
                        <kbd key={c} className="inline-flex items-center justify-center w-6 h-6 bg-zinc-800 border border-zinc-600 text-zinc-300 text-[11px] font-bold rounded shadow-sm">{c}</kbd>
                      ))}
                    </span>
                    <span><strong className="text-zinc-200">(JOYSTICK)</strong> 선택된 노드를 1pt 단위로 상하좌우 미세 이동시킵니다.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 flex gap-1">
                      <kbd className="inline-flex items-center justify-center px-2 h-6 bg-violet-900/60 border border-violet-700/60 text-violet-300 text-[11px] font-black rounded shadow-sm">A＋</kbd>
                      <kbd className="inline-flex items-center justify-center px-2 h-6 bg-violet-900/60 border border-violet-700/60 text-violet-300 text-[11px] font-black rounded shadow-sm">A－</kbd>
                    </span>
                    <span><strong className="text-zinc-200">(NODE FONT)</strong> <strong className="text-violet-300">선택된 특정 노드 하나</strong>의 글자 크기만 개별적으로 키우거나 줄입니다.</span>
                  </li>
                </ul>
              </div>

              {/* 섹션 2 */}
              <div>
                <h4 className="text-[13px] font-black text-white mb-2.5 flex items-center gap-2">
                  <span className="text-base">🌍</span> 2. 전체 스케일 제어
                  <span className="text-[10px] font-semibold text-zinc-600 bg-zinc-800/60 px-2 py-0.5 rounded-full">우측 하단 패널</span>
                </h4>
                <ul className="space-y-2.5 pl-1">
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 flex gap-1 items-center">
                      <span className="inline-flex items-center gap-1 bg-zinc-800 border border-zinc-700 text-violet-300 text-[10px] font-bold px-2 py-0.5 rounded">
                        T 전체폰트
                      </span>
                      <kbd className="inline-flex items-center justify-center w-6 h-6 bg-zinc-800 border border-zinc-600 text-zinc-300 text-[11px] font-bold rounded">−</kbd>
                      <kbd className="inline-flex items-center justify-center w-6 h-6 bg-zinc-800 border border-zinc-600 text-zinc-300 text-[11px] font-bold rounded">+</kbd>
                    </span>
                    <span>그래프 안의 <strong className="text-zinc-200">모든 글자와 수식 크기</strong>를 한 번에 일괄 조절합니다.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 flex gap-1 items-center">
                      <span className="inline-flex items-center gap-1 bg-zinc-800 border border-zinc-700 text-cyan-300 text-[10px] font-bold px-2 py-0.5 rounded">
                        ≡ 선두께
                      </span>
                      <kbd className="inline-flex items-center justify-center w-6 h-6 bg-zinc-800 border border-zinc-600 text-zinc-300 text-[11px] font-bold rounded">−</kbd>
                      <kbd className="inline-flex items-center justify-center w-6 h-6 bg-zinc-800 border border-zinc-600 text-zinc-300 text-[11px] font-bold rounded">+</kbd>
                    </span>
                    <span>얇은 보조선과 굵은 메인 그래프의 <strong className="text-zinc-200">시각적 비율을 완벽하게 유지</strong>하면서 전체 두께를 조절합니다.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 flex gap-1 items-center">
                      <span className="inline-flex items-center gap-1 bg-zinc-800 border border-zinc-700 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded">
                        ↔ 가로너비
                      </span>
                      <kbd className="inline-flex items-center justify-center w-6 h-6 bg-zinc-800 border border-zinc-600 text-zinc-300 text-[11px] font-bold rounded">−</kbd>
                      <kbd className="inline-flex items-center justify-center w-6 h-6 bg-zinc-800 border border-zinc-600 text-zinc-300 text-[11px] font-bold rounded">+</kbd>
                    </span>
                    <span>그래프의 <strong className="text-zinc-200">가로(x축) 비율</strong>만 독립적으로 늘리거나 줄입니다.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 flex gap-1 items-center">
                      <span className="inline-flex items-center gap-1 bg-zinc-800 border border-zinc-700 text-rose-300 text-[10px] font-bold px-2 py-0.5 rounded">
                        ↕ 세로높이
                      </span>
                      <kbd className="inline-flex items-center justify-center w-6 h-6 bg-zinc-800 border border-zinc-600 text-zinc-300 text-[11px] font-bold rounded">−</kbd>
                      <kbd className="inline-flex items-center justify-center w-6 h-6 bg-zinc-800 border border-zinc-600 text-zinc-300 text-[11px] font-bold rounded">+</kbd>
                    </span>
                    <span>그래프의 <strong className="text-zinc-200">세로(y축) 비율</strong>만 독립적으로 늘리거나 줄입니다.<br /><span className="text-zinc-500 text-[11px]">(함수의 뾰족한 정도를 튜닝할 때 유용합니다.)</span></span>
                  </li>
                </ul>
              </div>

              {/* 섹션 2.5 — 축 길이 조절 */}
              <div>
                <h4 className="text-[13px] font-black text-white mb-2.5 flex items-center gap-2">
                  <span className="text-base">📐</span> 3. 축 길이 조절 (Axis Length)
                  <span className="text-[10px] font-semibold text-zinc-600 bg-zinc-800/60 px-2 py-0.5 rounded-full">하단 패널</span>
                </h4>
                <ul className="space-y-2.5 pl-1">
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 flex gap-1 items-center">
                      <span className="inline-flex items-center gap-1 bg-zinc-800 border border-zinc-700 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded">X축 가로</span>
                      <span className="inline-flex items-center gap-1 bg-zinc-800 border border-zinc-700 text-sky-300 text-[10px] font-bold px-2 py-0.5 rounded">Y축 세로</span>
                    </span>
                    <span>
                      렌더링된 그래프의 여백이 부족하거나 너무 길 때,{" "}
                      <strong className="text-zinc-200">X축과 Y축의 상·하·좌·우 꼬리 길이를 0.2 단위로 미세 조정</strong>하여 최적의 비율을 맞출 수 있습니다.
                      <br />
                      <span className="text-zinc-500 text-[11px]">TikZ 코드의 <code className="text-zinc-400 bg-zinc-800 px-1 rounded text-[10px]">\draw[-&gt;]</code> 좌표값을 자동으로 파싱해 치환합니다.</span>
                    </span>
                  </li>
                </ul>
              </div>

              {/* 섹션 3 — 점 마커 관리자 (신규 추가) */}
              <div>
                <h4 className="text-[13px] font-black text-white mb-2.5 flex items-center gap-2">
                  <span className="text-base">🟣</span> 4. 점 마커 관리 (Point Markers)
                  <span className="text-[10px] font-semibold text-zinc-600 bg-zinc-800/60 px-2 py-0.5 rounded-full">하단 패널</span>
                </h4>
                <ul className="space-y-2.5 pl-1">
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 flex gap-1 items-center">
                      <span className="inline-flex items-center gap-1 bg-zinc-800 border border-zinc-700 text-fuchsia-300 text-[10px] font-bold px-2 py-0.5 rounded">
                        점 마커 관리
                      </span>
                    </span>
                    <span>
                      화면 하단의 [점 마커 관리] 버튼을 누르면 <strong className="text-zinc-200">화면 내에서 자유롭게 이동 가능한 패널</strong>이 열립니다.{" "}
                      드래그하여 원하는 위치에 배치하세요.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 flex items-center">
                      <svg className="w-5 h-5 text-fuchsia-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </span>
                    <span>
                      <strong className="text-zinc-200">눈 아이콘 토글</strong>로 특정 점을 쉽게{" "}
                      <strong className="text-fuchsia-300">숨기거나(게서판 주석 처리)</strong> 다시 나타나게 할 수 있습니다.{" "}
                      코드를 <strong className="text-zinc-200">영구 삭제하지 않으므로</strong> 언제든 안전하게 복구할 수 있습니다.
                    </span>
                  </li>
                </ul>
              </div>

              {/* 섹션 4 — 기존 저장/프롬프트 (번호 5로 조정) */}
              <div>
                <h4 className="text-[13px] font-black text-white mb-2.5 flex items-center gap-2">
                  <span className="text-base">💾</span> 5. 저장 및 프롬프트 가이드
                </h4>
                <ul className="space-y-2.5 pl-1">
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 bg-zinc-800/60 border border-zinc-700/50 text-zinc-400 text-[10px] font-bold px-2 py-0.5 rounded">💾 Auto-Save</span>
                    <span>실수로 새로고침해도 마지막 코드가 브라우저에 안전하게 남아 <strong className="text-zinc-200">자동 복구</strong>됩니다.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 text-white text-[10px] font-bold px-2 py-0.5 rounded" style={{background:"#2563eb"}}>메타수학 프롬프트 가이드</span>
                    <span>AI에게 코드를 뽑아낼 때 지시할 엄격한 스타일 가이드를 클립보드에 <strong className="text-zinc-200">원클릭 복사</strong>합니다.</span>
                  </li>
                </ul>
              </div>

              <hr className="border-zinc-800" />

              {/* 섹션 4 — 필독 */}
              <div className="rounded-xl border border-red-900/40 bg-red-950/20 px-4 py-3">
                <h4 className="text-[13px] font-black text-red-400 mb-2.5 flex items-center gap-2">
                  🚨 [필독] 돋보기(Zoom)와 고화질 다운로드의 차이
                </h4>
                <ul className="space-y-2.5 pl-1">
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 flex gap-1 items-center">
                      <kbd className="inline-flex items-center gap-1 bg-zinc-800 border border-zinc-600 text-zinc-300 text-[10px] font-bold px-2 py-0.5 rounded">🔍 100%~200%</kbd>
                    </span>
                    <span>
                      <strong className="text-zinc-200">(슬라이더)</strong> 모니터상에서 내 눈에만 크게 보이도록 확대/축소합니다.<br />
                      <strong className="text-red-400">실제 이미지 저장 크기와는 전혀 무관합니다!</strong>
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 text-white text-[10px] font-bold px-2 py-0.5 rounded" style={{background:"#2563eb"}}>📥 PNG</span>
                    <span>일반적인 웹 해상도(기본 크기)로 이미지를 다운로드합니다.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 text-white text-[10px] font-bold px-2 py-0.5 rounded" style={{background:"#f97316"}}>📥 초고화질 (4000px)</span>
                    <span>화면 확대 배율과 상관없이, <strong className="text-amber-300">무조건 출판/인쇄(한글 HWP)용 초고화질 대형 사이즈</strong>로 강제 렌더링하여 저장합니다. 한글 문서에 넣을 땐 <strong className="text-amber-300">반드시 이 주황색 버튼</strong>을 누르세요!</span>
                  </li>
                </ul>
              </div>

            </div>

            {/* 모달 하단 — 크레딧 + 닫기 */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800/60 shrink-0 bg-black/30">
              {/* 개발자 크레딧 */}
              <div className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/ko.png" alt="고진일 팀장"
                  className="w-8 h-8 rounded-full object-cover border-2 border-blue-400/40 shadow-md shadow-blue-500/20"
                />
                <div className="leading-none">
                  <div className="text-[9px] text-blue-400/60 font-semibold tracking-wider uppercase">인피니트 수학연구소</div>
                  <div className="text-[11px] font-bold text-white">고진일 팀장</div>
                  <div className="text-[9px] text-zinc-600 font-medium">Designed &amp; Built by Jinil Ko</div>
                </div>
              </div>
              {/* 닫기 버튼 */}
              <button
                onClick={() => setIsHelpOpen(false)}
                className="px-4 py-2 rounded-lg text-[12px] font-bold bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white transition-all"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
