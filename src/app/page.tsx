"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { deflate } from "pako";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  History, ChevronUp, ChevronDown,
  ChevronLeft, ChevronRight, MousePointer2,
  Download, Eye, Loader2, CloudCog, ZoomIn,
  RotateCcw, BookOpen, X, ClipboardCopy, Type, HelpCircle, Sliders,
  GripHorizontal, GripVertical, Info
} from "lucide-react";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useSession, signIn as nextAuthSignIn } from "next-auth/react";
import { logUserAction } from "@/actions/logger";
import guide1 from "@/assets/guide1.png";
import guide2 from "@/assets/guide2.png";
import guide3 from "@/assets/guide3.png";

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
function krokiUrl(source: string, format: "svg" | "png", engine: string) {
  const baseUrl = engine === "private" ? "/api/kroki" : "https://kroki.io";
  return `${baseUrl}/tikz/${format}/${encodeKroki(source)}`;
}

// ─────────────────────────────────────────────────────────────
//  줌 설정
// ─────────────────────────────────────────────────────────────
const BASE_WIDTH = 720;

// ─────────────────────────────────────────────────────────────
//  평가원 표준 템플릿 (클릭 한 번으로 로드)
// ─────────────────────────────────────────────────────────────
const KICE_TEMPLATE = `\\documentclass[tikz, border=2pt]{standalone}
% KICE Standard Style Guide Applied (평가원 기본 축)
\\usetikzlibrary{arrows.meta}

\\begin{document}
\\begin{tikzpicture}[>={Stealth[length=15pt, width=9pt]}, x=1.5cm, y=1.1cm, line width=1pt, every node/.style={scale=2.2, font=\\rm}, dashed/.style={dash pattern=on 6pt off 4pt}]

    % Axes Construction
    % x-axis
    \\draw[->] (-1.5, 0) -- (5.2, 0) node [below left, inner sep=2pt, yshift=-1.5pt, xshift=2.5pt] {$x$};
    % y-axis
    \\draw[->] (0, -1.5) -- (0, 7.8) node [below left, inner sep=2pt, xshift=-0.5pt, yshift=2pt] {$y$};

    % Origin Node
    \\node [below left, inner sep=1pt, transform shape, xscale=0.9] at (0,0) {$\\rm O$};

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
const META_PROMPT_GUIDE = `[INF_TikZ 수학 그래프 렌더링 엄격한 스타일 가이드: 평가원(KICE) 스타일 v2.1 - 20260610]

앞으로 모든 TikZ 수학 그래프 코드를 생성할 때는 한글(HWP) 문서 삽입 후 축소(12.5% 고정 비율) 시 일러스트레이터 파일과 완벽히 동일한 가독성을 확보하고, 웹 에디터의 최적화 환경을 위해 아래의 규칙을 예외 없이 엄격하게 적용하세요.

1. [웹 렌더링 호환 및 완전한 문서 구조 - 절대 규칙]

- 한글 원천 차단: \\usepackage{kotex} 패키지는 절대 선언하지 않습니다. 코드 내부의 모든 % 주석은 반드시 영어로만 작성하며, 노드(Node)나 텍스트 출력 부분에 한글을 절대 포함하지 않습니다. (모든 라벨은 수식, 기호, 영어로만 구성)

- 타이트한 여백 설정 (중요): 다운로드 및 크롭 최적화를 위해 첫 줄 문서 선언 시 여백을 최소화합니다. 반드시 \\documentclass[tikz, border=2pt]{standalone} 선언으로 시작하세요.

- Document 환경 필수: 그 아래에 반드시 \\begin{document}를 열고 전체 \\begin{tikzpicture} ... \\end{tikzpicture} 코드를 작성한 뒤, 마지막에 \\end{document}로 닫으세요. 복붙 즉시 렌더링이 가능한 '완전한 전체 문서' 형태로만 출력해야 합니다.

2. [전역 환경 및 스마트 캔버스 독립 배율 (일러스트레이터 대지 맞춤 방식)]

폰트/선 두께 고정: HWP 12.5% 삽입 시 가독성을 위해 폰트 스케일(scale=2.2)과 선 두께는 절대 변경하지 마세요. (이는 텍스트를 고정 크기로 덧입히는 것과 같습니다.)

대지 맞춤형 x, y 독립적 계산 (핵심): 렌더링될 그래프의 '가로와 세로'가 각각 **물리적 길이 8~10cm 내외 (TikZ 기준)**가 되도록 좌표 구간을 계산하여 $x$와 $y$ 배율을 반드시 독립적으로(서로 다르게) 설정하세요.

비율 왜곡 적극 허용: 수학적 정비율(1:1)에 집착하지 마세요. $y$값의 변동 폭이 좁은 경우(예: 극솟값이 -1 등), $y$ 배율을 $x$ 배율보다 훨씬 크게 주어 상하로 충분히 길게 늘려야 합니다. 그래야 거대한 고정 폰트(scale=2.2)들이 서로 겹치거나 답답해 보이지 않고 숨통(여백)이 트입니다.

예시: $x$축 표현 구간 폭이 6이라면 x=1.5cm, $y$축 표현 구간 폭이 3이라면 y=3.0cm로 설정하여 가로/세로 물리적 균형을 맞춥니다.

기본 뼈대: \\begin{tikzpicture}[>={Stealth[length=15pt, width=9pt]}, x={계산된값}cm, y={계산된값}cm, line width=1pt, every node/.style={scale=2.2, font=\\rm}, dashed/.style={dash pattern=on 6pt off 4pt}]

3. [축(Axis) 렌더링 및 황금 비율 뼈대]

- 축 두께 및 화살표: 축을 그릴 때는 기본 제공되는 [-stealth]를 절대 사용하지 않으며, 전역 line width=1pt와 Stealth[length=15pt, width=9pt] 화살표가 자연스럽게 적용되도록 [->]만 사용하여 선언합니다.

- 축 라벨 위치 제어: 축의 양 끝 라벨(x, y)은 폰트 벌크업으로 인한 축선과의 겹침을 방지하기 위해 정밀한 shift 값을 반드시 포함합니다.

- x축 표준 뼈대: \\draw[->] (-1.4, 0) -- (4.6, 0) node [below left, inner sep=2pt, yshift=-1.5pt, xshift=2.5pt] {$x$};
- y축 표준 뼈대: \\draw[->] (0, -3) -- (0, 3) node [below left, inner sep=2pt, xshift=-0.5pt, yshift=2pt] {$y$};

4. [메인 그래프 및 직선 렌더링 (엄격한 2:3 두께 법칙)]

- 2:3 두께 균형: 전역 축 두께가 1pt이므로, 시각적 주목도를 높여야 하는 메인 함수 곡선, 주요 직선, 도형의 선 두께는 반드시 [line width=1.5pt]를 명시적으로 달아주어 축과 메인 그래프의 두께 비율을 정확히 2:3으로 유지합니다. (보조선과 지시선은 전역 설정인 1pt를 따름)

- 곡선 함수식 규격: 곡선은 수학 함수식 \\draw[line width=1.5pt] plot (\\x, {수식})을 사용하며 samples=150 이상을 적용합니다. (\\addplot 사용 금지)

- Viewport Clipping 주의 (여백 확보): 곡선 제어를 위해 \clip 명령어를 사용할 경우, 전역 scale=2.2 폰트가 우측 도화지 밖으로 잘리지 않도록 우측 x좌표 경계를 실제 메인 그래프의 우측 끝점보다 최소 3~4 단위 이상 무조건 넉넉하게 확장하세요.

- [그래프 렌더링 필수 규칙: 1차 함수 및 상수 함수 Domain 강제]
좌표평면 위에서 y=f(x) 형태의 1차 함수(사선) 및 상수 함수(수평선) 그래프를 렌더링할 때는 절대 두 점을 잇는 \`--\` 방식을 사용하지 마세요. 곡선과 동일하게 반드시 \`domain\` 범위를 지정하고 \`plot (\\x, {방정식})\` 명령어를 사용하세요. 
(단, x=k 형태의 수직선이나 순수 기하 도형의 꼭짓점을 잇는 단순 보조선은 기존처럼 \`--\` 방식을 유지합니다.)

❌ 잘못된 예 (단순 좌표 잇기):
\\draw[line width=1.0pt] (-5, 4) -- (5, 4);
\\draw[line width=1.0pt] (-1.5, -0.25) -- (1.5, 5.75);

✅ 올바른 예 (Domain 범위 및 plot 방정식 사용):
\\draw[line width=1.0pt, domain=-5:5] plot (\\x, {4});
\\draw[line width=1.0pt, domain=-1.5:1.5] plot (\\x, {2*\\x + 11/4});

5. [마이크로 타이포그래피: 폰트 및 라벨 스타일링]

- 배경색 투명도 유지: 모든 텍스트 및 수식 노드에 fill=white 옵션을 절대 사용하지 않습니다. 모든 배경은 투명하게 둡니다. (단, 7번 항목의 '길이 표시' 점선 위에 올라가는 노드는 예외적으로 fill=white를 허용합니다.)

- 대문자 점(Point) 바짝 붙이기 (HWP 신명조 모방): 원점(\\rm O)을 포함해 그래프에 표시되는 모든 대문자 점 라벨(\\rm A, B, P, Q 등)은 거대한 전역 스케일로 인해 좌표에서 멀리 밀려나는 현상을 방지해야 합니다. 따라서 반드시 [inner sep=0pt] 또는 [inner sep=1pt] 옵션을 추가하여 좌표(점)에 바짝 붙여서 렌더링하세요. 또한 완벽한 자리를 잡도록 특수 조작(transform shape, xscale=0.9)을 적용하고 반드시 $\\rm 대문자$ 형태를 유지합니다. (전역 scale이 충분히 크므로 font=\\large 등은 절대 사용하지 마세요)

- 원점 노드 표준: \\node [below left, inner sep=1pt, transform shape, xscale=0.9] at (0,0) {$\\rm O$};

- 분수 크기 보존: 노드(\\node) 내에서 분수(\\frac)나 극한 수식을 작성할 때는 기호가 찌그러지는 현상을 방지하기 위해, 반드시 달러 기호 직후에 \\displaystyle을 선언하세요. (예시: $\\displaystyle y = 2 - \\frac{16}{x^2}$)

6. [점(Point) 및 필수 마커 렌더링 제한]

- 타원형 에러 방지: 점을 그릴 때 \\fill circle 명령어는 절대 금지합니다. 모든 렌더링 포인트는 반드시 \\node[circle, fill=black, inner sep=0.9pt] at (좌표) {}; 형태로만 작성합니다. (※ 단, 에디터의 '점 마커 관리자' 플로팅 UI와의 완벽한 주석 토글 호환을 위해 이 형식을 엄격히 준수해야 합니다.)

- 무분별한 교점 표시 금지: 그래프의 모든 교점에 기계적으로 검은 점을 남발하지 마세요. 오직 문제 발문에서 직접 언급된 구체적인 점(예: 점 A_n, 점 B_n)이거나, 함수의 불연속을 나타내는 경우에만 명시적으로 마커를 추가하세요.

7. [기하학적 기호 및 보조선 마이크로 디테일 (KICE 조판 표준)]

- 직각 기호 (1.5배 확대): 수직(직각) 기호는 스케일업 환경에서 너무 작아 보이지 않도록, 기본 변의 길이 비율 대비 1.5배 넉넉한 크기(예: 한 변을 0.15 단위 이상)로 명확하게 그립니다. (도형 안쪽으로 그려지도록 rotate 주의)

- 각도 호(Arc) 렌더링 (두께 0.5pt): 각도(θ 등)를 표시하는 곡선 호(Arc)를 그릴 때는 둔탁해 보이지 않도록, 반드시 [line width=0.5pt] 옵션을 개별 적용하여 메인 선 두께(1pt)의 정확히 절반 두께로 얇게 빼주세요.

- 지시선 화살표 (머리 65% 축소): 길이 변화나 영역을 지시하는 화살표(예: bend right)를 그릴 때는 선 두께는 1pt를 유지하되, 화살표 머리만 65% 크기로 줄인 [-{Stealth[length=9.75pt, width=5.85pt]}] 옵션을 개별적으로 적용하세요.

- 길이 표시 (평가원 점선 스타일 및 메인 선 침범 절대 금지): 길이를 표시할 때는 도형의 외곽선뿐만 아니라 내부 보조선(수선, 대각선 등)에도 예외 없이 부드럽게 휘어지는 점선(bend)을 사용합니다. 숫자만 공중에 띄워두지 마세요.
- 절연 기법 및 넉넉한 휨 각도: 텍스트 노드에 [midway, fill=white, inner sep=3pt] 옵션을 주어 점선 한가운데를 끊고 들어가게 연출하되, 이 하얀색 배경 박스가 메인 실선을 지우개처럼 파먹는 일이 절대 없도록 bend 각도를 최소 25~35 이상으로 넉넉하게 부여하여 실선에서 완전히 이격시키세요. (선분이 짧을수록 bend 값을 더 키워야 합니다.)

[필수 코드 예시] 길이 표시 점선을 그릴 때는 반드시 아래 코드를 그대로 복붙해서 응용하세요.
\\draw[dashed] (A) to[bend left=30] node[midway, fill=white, inner sep=3pt] {수식} (B);

- 길이 같음 기호(Tick marks): 짧은 선분(빗금)은 해당 변과 완벽히 직교하도록 rotate 각도를 정확히 계산하여 설정합니다.`;

// ─────────────────────────────────────────────────────────────
//  LocalStorage 키
// ─────────────────────────────────────────────────────────────
const LS_KEY = "kosmart_saved_code";

export default function Home() {
  const [rawInput,       setRawInput]       = useState("");
  const [debouncedInput, setDebouncedInput] = useState("");
  const [svgUrl,         setSvgUrl]         = useState("");  // Kroki SVG GET URL
  const [renderEngine,   setRenderEngine]   = useState("private");
  const [showBanner,     setShowBanner]     = useState(true);
  const [isRendering,    setIsRendering]    = useState(false);
  const [renderError,    setRenderError]    = useState("");
  const [isDownloading,  setIsDownloading]  = useState(false);
  const [zoomPercent,    setZoomPercent]    = useState<number>(100);
  const [imgRenderedH,   setImgRenderedH]   = useState<number>(0);
  // 다중 선택지원 노드 선택 상태 (srcIndex 문자열들의 Set)
  const [selectedNodeIndices, setSelectedNodeIndices] = useState<Set<string>>(new Set());
  // 콘텍스트 노드 선택 드롭다운 열림 상태
  const [isNodeDropdownOpen, setIsNodeDropdownOpen] = useState(false);
  const nodeDropdownRef = useRef<HTMLDivElement>(null);

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

  // KICE 검수 가이드 모달
  const [isGuideModalOpen, setIsGuideModalOpen] = useState(false);

  // ── 렌더링 프리뷰 화면 마우스 드래그 스크롤 (Drag to Pan) ──
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [isPreviewDragging, setIsPreviewDragging] = useState(false);
  const previewDragRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);

  const handlePreviewMouseDown = (e: React.MouseEvent) => {
    if (!previewContainerRef.current) return;
    setIsPreviewDragging(true);
    previewDragRef.current = {
      startX: e.pageX - previewContainerRef.current.offsetLeft,
      startY: e.pageY - previewContainerRef.current.offsetTop,
      scrollLeft: previewContainerRef.current.scrollLeft,
      scrollTop: previewContainerRef.current.scrollTop,
    };
  };

  const handlePreviewMouseLeave = () => {
    setIsPreviewDragging(false);
    previewDragRef.current = null;
  };

  const handlePreviewMouseUp = () => {
    setIsPreviewDragging(false);
    previewDragRef.current = null;
  };

  const handlePreviewMouseMove = (e: React.MouseEvent) => {
    if (!isPreviewDragging || !previewContainerRef.current || !previewDragRef.current) return;
    e.preventDefault();
    const x = e.pageX - previewContainerRef.current.offsetLeft;
    const y = e.pageY - previewContainerRef.current.offsetTop;
    const walkX = x - previewDragRef.current.startX;
    const walkY = y - previewDragRef.current.startY;
    previewContainerRef.current.scrollLeft = previewDragRef.current.scrollLeft - walkX;
    previewContainerRef.current.scrollTop = previewDragRef.current.scrollTop - walkY;
  };



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

  // ── 노드 선택 드롭다운 외부 클릭 시 닫기 및 상태 초기화 ──
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // 하단 컨트롤 패널 전체 영역(footer) 클릭 시 예외 처리 (Safe Zone)
      if (target.closest("footer")) return;

      if (
        isNodeDropdownOpen &&
        nodeDropdownRef.current &&
        !nodeDropdownRef.current.contains(e.target as Node)
      ) {
        setIsNodeDropdownOpen(false);
        setSelectedNodeIndices(new Set()); // 다중 선택된 노드 모두 초기화
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isNodeDropdownOpen]);

  // ── 점 & 그래프 제어 창 외부 클릭 시 닫기 (단, 하단 컨트롤 예외) ──
  useEffect(() => {
    const handleClickOutsidePoint = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // 하단 컨트롤 패널(footer) 클릭 시 닫히지 않음 (Safe Zone)
      if (target.closest("footer")) return;

      if (
        isPointManagerOpen &&
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      ) {
        setIsPointManagerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutsidePoint);
    return () => document.removeEventListener("mousedown", handleClickOutsidePoint);
  }, [isPointManagerOpen]);

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
      setSvgUrl(krokiUrl(debouncedInput, "svg", renderEngine));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Kroki encode error]", err);
      setRenderError("인코딩 오류: " + msg);
      setIsRendering(false);
    }
  }, [debouncedInput, renderEngine]);

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
    const url = krokiUrl(debouncedInput, "png", renderEngine);
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

  // ── 초고화질 PNG: svgUrl + crossOrigin=anonymous → Canvas 1500px ───
  const [isHighResDownloading, setIsHighResDownloading] = useState(false);
  const [saveTikzCode, setSaveTikzCode] = useState(false);
  const handleDownloadHighRes = () => {
    const startTime = performance.now();
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
        // ── 고정 배율(×4.0) 렌더링 — SVG 원본 크기에 일정 배수를 곱해 해상도 결정 ──
        //  이렇게 하면 넓은 그래프는 크게, 좌은 그래프는 작게 저장되더라도
        //  'cm 당 픽셀 밀도(즉 폰트 체급)'는 항상 동일함
        const FIXED_SCALE = 4.0;
        const TARGET_W = Math.round(img.naturalWidth  * FIXED_SCALE) || 1200;
        const TARGET_H = Math.round(img.naturalHeight * FIXED_SCALE) || Math.round(TARGET_W * 0.8);

        // ── 1단계: 풀 사이즈 캔버스에 그래프 렌더링 (투명 배경 유지) ──────────
        const fullCanvas = document.createElement("canvas");
        fullCanvas.width  = TARGET_W;
        fullCanvas.height = TARGET_H;
        const fullCtx = fullCanvas.getContext("2d")!;
        // 흰 배경 fillRect 삭제 — 캔버스 기본값이 투명(alpha=0)이므로 별도 채우지 않음
        fullCtx.drawImage(img, 0, 0, TARGET_W, TARGET_H);

        // ── 2단계: 픽셀 스캔으로 실제 콘텐츠 바운딩 박스 계산 ───────────────
        const imageData = fullCtx.getImageData(0, 0, TARGET_W, TARGET_H);
        const data = imageData.data; // [r,g,b,a, r,g,b,a, ...]

        let minX = TARGET_W, minY = TARGET_H, maxX = 0, maxY = 0;

        for (let y = 0; y < TARGET_H; y++) {
          for (let x = 0; x < TARGET_W; x++) {
            const idx = (y * TARGET_W + x) * 4;
            // 투명 픽셀만 배경으로 인식하고 무시 — alpha=0 기준
            // (흰색 조건을 제거하여 SVG에 흰색 내용이 있어도 크롭에서 보존)
            if (data[idx + 3] === 0) continue;

            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }

        // 콘텐츠가 전혀 없으면 원본 그대로 저장
        const hasContent = maxX > minX && maxY > minY;

        // ── 3단계: 안전 마진 20px 추가 후 크롭 캔버스 생성 ──────────────────
        const MARGIN = 20;
        const cropX = Math.max(0, minX - MARGIN);
        const cropY = Math.max(0, minY - MARGIN);
        const cropW = Math.min(TARGET_W, maxX + MARGIN + 1) - cropX;
        const cropH = Math.min(TARGET_H, maxY + MARGIN + 1) - cropY;

        const outputCanvas = document.createElement("canvas");
        outputCanvas.width  = hasContent ? cropW : TARGET_W;
        outputCanvas.height = hasContent ? cropH : TARGET_H;
        const outCtx = outputCanvas.getContext("2d")!;
        // 흰 배경 fillRect 삭제 — PNG 투명 배경 보장

        if (hasContent) {
          // 원본 풀 캔버스에서 크롭 영역만 새 캔버스로 복사
          outCtx.drawImage(
            fullCanvas,
            cropX, cropY, cropW, cropH,   // 원본 소스 영역
            0,     0,     cropW, cropH    // 출력 대상 영역
          );
        } else {
          // fallback: 콘텐츠 감지 실패 시 원본 그대로
          outCtx.drawImage(fullCanvas, 0, 0);
        }

        // ── 4단계: 크롭된 캔버스를 PNG로 저장 ────────────────────────────────
        const now = new Date();
        const yy = String(now.getFullYear()).slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const fileNameBase = `InfiniteMathlab_${yy}${mm}${dd}_${hh}${min}${ss}`;
        const pngData = outputCanvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = pngData;
        a.download = `${fileNameBase}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // ── 5단계: TikZ 코드 저장 (체크 시) ──────────────────────────────────
        if (saveTikzCode) {
          const blob = new Blob([rawInput], { type: "text/plain;charset=utf-8" });
          const txtUrl = URL.createObjectURL(blob);
          const txtA = document.createElement("a");
          txtA.href = txtUrl;
          txtA.download = `${fileNameBase}.txt`;
          document.body.appendChild(txtA);
          txtA.click();
          document.body.removeChild(txtA);
          URL.revokeObjectURL(txtUrl);
        }

        // 다운로드 액션 서버 로그
        const durationMs = performance.now() - startTime;
        logUserAction(
          "EXPORT_DOWNLOAD",
          session?.user?.email ?? "",
          rawInput, // Always pass rawInput to ensure webhook attachment
          durationMs,
          saveTikzCode // Use saveTikzCode just for display in message (TikZ 포함: O/X)
        );

        toast.dismiss(toastId);
        toast.success(`✅ HWP 인쇄용 PNG 저장 완료! (${outputCanvas.width}×${outputCanvas.height}px)`);
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

  // ── UI 표기용 라벨 정제 함수 ────────────────────────────────────
  //  content(원본 LaTeX)를 사람이 읽기 편한 텍스트로 변환
  //  원본 content는 절대 손대지 않음 — 표시 전용
  const sanitizeLabel = (raw: string): string => {
    let s = raw;
    // \frac{A}{B} → A / B  (중첩 미지원이지만 1단계는 처리)
    s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1 / $2");
    // \sqrt{X} → √X
    s = s.replace(/\\sqrt\{([^{}]*)\}/g, "√$1");
    // \left, \right, \bigl 등 크기 제어 명령어 제거
    s = s.replace(/\\(?:left|right|bigl?|bigr?|Bigl?|Bigr?)\s*/g, "");
    // \displaystyle 제거
    s = s.replace(/\\displaystyle\s*/g, "");
    // \rm, \bf, \it, \text{...} → 내용만
    s = s.replace(/\\text\{([^}]*)\}/g, "$1");
    s = s.replace(/\\(?:rm|bf|it|mathrm|mathbf|mathit)\s*/g, "");
    // $ 기호 제거
    s = s.replace(/\$/g, "");
    // 나머지 \명령어 제거 (알파벳으로만 이루어진 것)
    s = s.replace(/\\[a-zA-Z]+\s*/g, "");
    // 중괄호 제거
    s = s.replace(/[{}]/g, "");
    // 공백 정리
    s = s.replace(/\s+/g, " ").trim();
    return s || raw; // 정제 결과가 빈 문자열이면 원본 반환
  };

  // ── Domain 패널 전용 UI 라벨 포매터 ─────────────────────────────────
  //  ※ 이 함수는 화면 표시용 문자열만 가공합니다.
  //     TikZ 원본 코드나 domain 파싱/치환 로직에는 절대 영향 없음.
  const formatDomainLabel = (raw: string): string => {
    let s = raw;

    // 1) \x → x  (JS 문자열에서 \x 가 증발하는 현상 방지)
    //    TikZ 코드상 \x 는 JS 소스에서 \\x 로 저장되어 있으므로
    //    두 케이스 모두 처리한다.
    s = s.replace(/\\x/g, "x");   // 이미 한 번 이스케이프 해석된 경우
    s = s.replace(/\\\\x/g, "x"); // 이중 이스케이프가 남아있는 경우

    // 2) pow(A, B) → A^(B)  (C/Python 스타일 거듭제곱 → 수학 표기)
    //    중첩 pow 는 바깥부터 순차 처리 (1단계)
    s = s.replace(/pow\(([^,)]+),\s*([^)]+)\)/g, "$1^($2)");

    // 3) * 제거  (예: 2*x → 2x, 3*x^2 → 3x^2)
    s = s.replace(/\*/g, "");

    // 4) 이중 부호 정리  (예: "+ -" → "-", "- +" → "-", "+-" → "-")
    s = s.replace(/\+\s*-/g, "-");
    s = s.replace(/-\s*\+/g, "-");
    s = s.replace(/\+\s*\+/g, "+");

    // 5) 남은 LaTeX 명령어·기호를 sanitizeLabel 로 정제
    s = sanitizeLabel(s);

    return s || raw;
  };

  // ── 노드 스캔 v3 — 인라인 node 캡처 + 좌표 {} 완전 차단 ──────────────
  //  개선 사항:
  //  1. \node/\coordinate 독립 선언 + \draw 경로 내 인라인 node 모두 캡처
  //  2. TikZ path의 (좌표) 블록 안 {} 를 완전히 skip → plot(\x,{수식}) 오인 차단
  //  3. node 선언 직후 [] 옵션 다음의 첫 {텍스트}만 라벨로 인식
  //  4. 빈 content 노드(점 마커) 필터링
  //  5. srcIndex(rawInput 내 고유 offset)로 매핑 무결성 보장
  const scanNodes = () => {
    const matches: { full: string; options: string; content: string; index: number; srcIndex: number }[] = [];

    // \node, \coordinate, 또는 \draw path 안의 인라인 node 를 모두 탐색
    // — \\node / \\coordinate : 행 시작 독립 선언
    // — 인라인 node : 앞에 ) 또는 공백이 오고, 뒤에 [ 또는 { 가 오는 bare "node"
    const startRe = /(?:(?:\\node|\\coordinate)(?![a-zA-Z])|(?<=[\s\)])node(?=\s*[\[{]))/g;
    let startMatch: RegExpExecArray | null;

    while ((startMatch = startRe.exec(rawInput)) !== null) {
      const startIdx = startMatch.index;

      // 세미콜론까지 슬라이스 (최대 1500자)
      const slice = rawInput.slice(startIdx, startIdx + 1500);
      const semiIdx = slice.indexOf(";");
      if (semiIdx === -1) continue;
      const stmt = slice.slice(0, semiIdx);

      // options: [] 블록 — 첫 번째 [...] 만 추출 (depth-safe)
      const optMatch = stmt.match(/^(?:\\node|\\coordinate|node)\s*\[([^\]]*)\]/);
      const options = optMatch ? optMatch[1] : "";

      // ── "node 키워드 + 옵션" 이후 위치를 scanFrom 으로 설정 ──────────
      //  → 옵션이 있으면 ] 다음, 없으면 keyword 직후
      let scanFrom = optMatch
        ? (optMatch.index ?? 0) + optMatch[0].length
        : (stmt.match(/^(?:\\node|\\coordinate|node)/))?.[0].length ?? 0;

      // ── scanFrom 이후에서 ( 좌표 ) 블록을 모두 건너뜀 ──────────────
      //  TikZ: node "at" (x, {수식}) 또는 \draw path 안의 (x,y) 좌표
      //  → '(' 발견 즉시 depth 카운팅으로 닫히는 ')' 까지 skip
      let i = scanFrom;
      while (i < stmt.length) {
        // 공백 건너뜀
        if (/\s/.test(stmt[i])) { i++; continue; }
        // 'at' 키워드 건너뜀
        if (stmt.slice(i, i + 2) === "at" && /\W/.test(stmt[i + 2] ?? " ")) { i += 2; continue; }
        // '(' 블록 → depth 카운팅으로 닫힘까지 skip
        if (stmt[i] === "(") {
          let pd = 0;
          for (; i < stmt.length; i++) {
            if (stmt[i] === "(") pd++;
            else if (stmt[i] === ")") { pd--; if (pd === 0) { i++; break; } }
          }
          continue;
        }
        // '{' 발견 → 여기가 라벨 시작
        if (stmt[i] === "{") break;
        // 그 외 예상치 못한 문자 → 이 node는 건너뜀
        i = stmt.length;
      }
      scanFrom = i;

      // ── scanFrom 위치의 첫 번째 depth-0 {라벨} 만 캡처 ──────────────
      if (scanFrom >= stmt.length || stmt[scanFrom] !== "{") continue;

      let labelStart = -1;
      let labelEnd   = -1;
      let depth = 0;
      for (let j = scanFrom; j < stmt.length; j++) {
        const ch   = stmt[j];
        const prev = j > 0 ? stmt[j - 1] : "";
        if (ch === "{" && prev !== "\\") {
          if (depth === 0) labelStart = j + 1;
          depth++;
        } else if (ch === "}" && prev !== "\\") {
          depth--;
          if (depth === 0) { labelEnd = j; break; } // 첫 번째 닫힘에서 즉시 종료
        }
      }
      if (labelStart === -1 || labelEnd === -1) continue;

      const content = stmt.slice(labelStart, labelEnd).trim();

      // 빈 content = 점 마커 → 제외
      if (content === "") {
        startRe.lastIndex = startIdx + (labelEnd + 1);
        continue;
      }

      const full = stmt.slice(0, labelEnd + 1);
      matches.push({ full, options, content, index: startIdx, srcIndex: startIdx });
      startRe.lastIndex = startIdx + full.length;
    }
    return matches;
  };
  const nodes = scanNodes();

  // ── [버그 수정] 노드 개수가 변할 때(유령 데이터) out-of-bounds 인덱스 정리 ──
  useEffect(() => {
    setSelectedNodeIndices(prev => {
      let changed = false;
      const valid = new Set<string>();
      for (const idxStr of prev) {
        if (parseInt(idxStr) < nodes.length) {
          valid.add(idxStr);
        } else {
          changed = true;
        }
      }
      return changed ? valid : prev;
    });
  }, [nodes.length]);



  // ── 선택된 노드(들)의 표시 텍스트 계산 (다중 선택 지원) ──────────────
  const getSelectedNodesLabel = (): string => {
    if (selectedNodeIndices.size === 0) return "";
    if (selectedNodeIndices.size === 1) {
      const arrIdx = parseInt([...selectedNodeIndices][0]);
      const node = nodes[arrIdx];
      if (!node) return "";
      return `${arrIdx + 1}. ${sanitizeLabel(node.content)}`;
    }
    return `${selectedNodeIndices.size}개 선택됨`;
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

  // ── 다중 노드 폰트 스케일 조절 (A+ / A-) ──────────────────
  const handleNodeFontScale = (delta: number) => {
    if (selectedNodeIndices.size === 0) { toast.error("조정할 노드를 먼저 선택해주세요."); return; }
    
    // [중요] 문자열 앞쪽에서 치환이 발생하면 뒤쪽 노드들의 srcIndex가 밀리는 현상을 방지하기 위해,
    // 선택된 노드들을 srcIndex 기준 내림차순(역순)으로 정렬하여 뒤에서부터 치환합니다.
    const selectedNodes = nodes
      .filter((n, i) => selectedNodeIndices.has(i.toString()))
      .sort((a, b) => b.srcIndex - a.srcIndex);
      
    if (selectedNodes.length === 0) return;

    let newCode = rawInput;

    for (const node of selectedNodes) {
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

      newCode = newCode.slice(0, node.srcIndex) + updatedFull + newCode.slice(node.srcIndex + node.full.length);
    }
    
    handleRawInputChange(newCode);
  };

  // ── 다중 노드 조이스틱 시프트 ───────────────────────────────────
  const handleShift = useCallback((axis: "x" | "y", direction: number) => {
    if (selectedNodeIndices.size === 0) { toast.error("조정할 노드를 먼저 선택해주세요."); return; }
    
    // [중요] 인덱스 밀림 방지를 위한 역순 정렬 처리
    const selectedNodes = nodes
      .filter((n, i) => selectedNodeIndices.has(i.toString()))
      .sort((a, b) => b.srcIndex - a.srcIndex);
      
    if (selectedNodes.length === 0) return;

    let newCode = rawInput;
    const key = `${axis}shift`;
    const re = new RegExp(`${key}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)pt`);

    for (const node of selectedNodes) {
      let opts = node.options;
      const hit = opts.match(re);
      let newVal = direction;
      
      if (hit) { 
        newVal = parseFloat((parseFloat(hit[1]) + direction).toFixed(2)); 
        opts = opts.replace(re, `${key}=${newVal}pt`); 
      } else {
        opts = (opts.trim() ? opts + ", " : "") + `${key}=${newVal}pt`;
      }

      const updatedFull = node.options
        ? node.full.replace(
            new RegExp(`\\[${node.options.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`),
            `[${opts}]`)
        : node.full.replace(/^((?:\\node|node|\\coordinate)\s*)/, `$1[${opts}] `);

      newCode = newCode.slice(0, node.srcIndex) + updatedFull + newCode.slice(node.srcIndex + node.full.length);
    }
    
    handleRawInputChange(newCode);
  }, [selectedNodeIndices, nodes, rawInput, handleRawInputChange]);

  // ── 글로벌 키보드 이벤트 (방향키 노드 이동) ─────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 입력창 등 텍스트 타이핑 중일 때만 무시 (버튼/체크박스 포커스 시엔 작동 허용)
      const active = document.activeElement as HTMLElement;
      if (
        active?.tagName === "TEXTAREA" ||
        (active?.tagName === "INPUT" && (active as HTMLInputElement).type === "text") ||
        active?.isContentEditable
      ) {
        return;
      }

      if (selectedNodeIndices.size === 0) return;

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();

        // 기본 단위 1pt
        let amount = 1;
        if (e.shiftKey) amount = 10;
        else if (e.altKey || e.ctrlKey || e.metaKey) amount = 0.1;

        switch (e.key) {
          case "ArrowUp":
            handleShift("y", amount);
            break;
          case "ArrowDown":
            handleShift("y", -amount);
            break;
          case "ArrowLeft":
            handleShift("x", -amount);
            break;
          case "ArrowRight":
            handleShift("x", amount);
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNodeIndices, handleShift]);

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
  //  Domain 파서: \draw plot[domain=A:B] ... {수식} 추출
  //  엄격한 정규식으로 다른 좌표와 꼬이지 않도록 보호
  // ─────────────────────────────────────────────────────────────
  interface DomainEntry {
    lineIdx: number;    // rawInput 에서의 줄 번호 (0-indexed)
    lineRaw: string;    // 원본 줄 전체 텍스트
    start: number;      // domain= 의 A 값
    end: number;        // domain= 의 B 값
    formula: string;    // {수식} 부분 (sanitizeLabel 로 정제 전 원본)
  }

  const scanDomains = (): DomainEntry[] => {
    const results: DomainEntry[] = [];
    const lines = rawInput.split("\n");
    // 패턴: domain=숫자:숫자  (정수/소수/음수 모두 허용, 앞뒤는 비단어 경계)
    const domainRe = /domain\s*=\s*(-?[0-9]+(?:\.[0-9]*)?)\s*:\s*(-?[0-9]+(?:\.[0-9]*)?)/;
    // 같은 줄에서 plot(\x, {수식}) 또는 {수식} 파싱 (첫 번째 중괄호 그룹을 수식으로)
    // 단, node 등의 라벨 중괄호와 구분하기 위해 \\x 또는 plot 컨텍스트가 있는 줄에서만 추출
    const formulaRe = /plot\s*(?:\([^)]*\))?\s*\{([^{}]+)\}|\\draw[^;]*\{([^{}]+)\}/;
    lines.forEach((line, idx) => {
      // 주석 줄 건너뜀
      if (/^\s*%/.test(line)) return;
      const dm = line.match(domainRe);
      if (!dm) return;
      const start = parseFloat(dm[1]);
      const end   = parseFloat(dm[2]);
      // 수식 추출 시도: plot(\x, {수식}) 우선
      let formula = "";
      const fm = line.match(formulaRe);
      if (fm) {
        formula = (fm[1] ?? fm[2] ?? "").trim();
      }
      // 수식을 못 찾으면 그냥 빈 문자열 (라벨에 그래프N으로 표시)
      results.push({ lineIdx: idx, lineRaw: line, start, end, formula });
    });
    return results;
  };

  const domains = scanDomains();

  // ── Domain 시작/끝 조절 핸들러 ──────────────────────────────
  //  end: 'start' = A값 조절, 'end' = B값 조절
  //  delta: ±0.1
  const handleDomainChange = (idx: number, end: "start" | "end", delta: number) => {
    const entry = domains[idx];
    if (!entry) return;
    // 엄격한 정규식: domain=A:B 패턴을 해당 줄에서만 치환
    // 다른 좌표나 숫자가 꼬이지 않도록 라인 단위 치환
    const domainRe = /(domain\s*=\s*)(-?[0-9]+(?:\.[0-9]*)?)\s*:\s*(-?[0-9]+(?:\.[0-9]*)?)/;
    const lines = rawInput.split("\n");
    const targetLine = lines[entry.lineIdx];
    const m = targetLine.match(domainRe);
    if (!m) { toast.error("domain 패턴을 찾을 수 없습니다."); return; }
    let newStart = entry.start;
    let newEnd   = entry.end;
    if (end === "start") {
      newStart = parseFloat((newStart + delta).toFixed(2));
    } else {
      newEnd = parseFloat((newEnd + delta).toFixed(2));
    }
    // 시작 > 끝 역전 방지
    if (newStart >= newEnd) {
      toast.error("시작점이 끝점보다 클 수 없습니다.");
      return;
    }
    lines[entry.lineIdx] = targetLine.replace(domainRe, `${m[1]}${newStart}:${newEnd}`);
    handleRawInputChange(lines.join("\n"));
    toast.success(`✅ domain: ${newStart} → ${newEnd}`);
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

  /**
   * 전체 점 마커를 일괄 켜거나 끄는 함수.
   * rawInput 을 한 번만 업데이트하여 렌더링 방스 최소화.
   */
  const handleToggleAllPoints = (targetState: "on" | "off") => {
    const lines = rawInput.split("\n");
    const updated = lines.map((l) => {
      // 점 마커 라인인지 판별
      if (!/^\s*%?\s*\\node\s*\[.*fill=black/.test(l)) return l;
      if (targetState === "off") {
        // 전체 끼기: 이미 주석된 라인은 건들지 않음
        if (/^\s*%/.test(l)) return l;
        return l.replace(/^(\s*)/, "$1% ");
      } else {
        // 전체 켜기: 주석된 라인만 해제
        if (!/^\s*%/.test(l)) return l;
        return l.replace(/^(\s*)%\s?/, "$1");
      }
    });
    handleRawInputChange(updated.join("\n"));
    toast.success(targetState === "on" ? "👁️ 전체 점 표시" : "🔕 전체 점 숨김");
  };

  // ── 줌 계산 ─────────────────────────────────────────────────
  const zoomScale = zoomPercent / 100;

  // BASE_WIDTH suppression — used only for reference
  void BASE_WIDTH;
  void imgRenderedH;

  // ── 잠금 화면 (unauthenticated) ─────────────────────────
  // [DEV BYPASS] 로컬 개발 환경에서는 구글 로그인 세션 확인을 건너뜀
  const isDev = process.env.NODE_ENV === "development";

  if (!isDev && status === "unauthenticated") {
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
  // [DEV BYPASS] 개발 환경에서는 로딩 상태도 건너뜀
  if (!isDev && status === "loading") {
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
  let navigatorText: string | null = null;
  if (selectedNodeIndices.size > 0) {
    const selectedIndex = parseInt(Array.from(selectedNodeIndices)[0], 10);
    const targetNode = nodes[selectedIndex];

    if (targetNode && targetNode.content) {
      const allLines = rawInput.split("\n");
      const foundLineIndex = allLines.findIndex(line => line.includes(targetNode.content));
      
      if (foundLineIndex !== -1) {
        const lineNumber = foundLineIndex + 1;
        const lineText = allLines[foundLineIndex].trim();
        navigatorText = `🎯 Line ${lineNumber}: ${lineText}`;
      }
    }
  }

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

        {/* Kroki 렌더링 엔진 선택 드롭다운 */}
        <Select
          value={renderEngine}
          onValueChange={(val) => {
            if (!val) return;
            setRenderEngine(val);
          }}
        >
          <SelectTrigger className={`flex items-center gap-1.5 h-[26px] px-2.5 rounded-full ${renderEngine === "private" ? "bg-emerald-950/30 border-emerald-800/25 text-emerald-300/80 hover:bg-emerald-900/40" : "bg-blue-950/30 border-blue-800/25 text-blue-300/80 hover:bg-blue-900/40"} border text-[10px] font-bold tracking-wider shadow-none focus:ring-0 focus:ring-offset-0 transition-colors w-auto min-w-max outline-none`}>
            <div className={`w-1.5 h-1.5 rounded-full ${renderEngine === "private" ? "bg-emerald-400" : "bg-blue-400"} animate-pulse shrink-0`} />
            <CloudCog className={`w-3 h-3 ${renderEngine === "private" ? "text-emerald-400" : "text-blue-400"} shrink-0`} />
            <SelectValue placeholder={renderEngine === "private" ? "Dedicated (사내 전용)" : "Public (공용)"}>
              {renderEngine === "private" ? "Dedicated (사내 전용)" : "Public (공용)"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-800 shadow-2xl">
            <SelectItem value="public" className="text-[11px] text-zinc-300 focus:bg-blue-900/30 focus:text-blue-300 cursor-pointer">
              Public Engine (공용)
            </SelectItem>
            <SelectItem value="private" className="text-[11px] text-emerald-300 focus:bg-emerald-900/30 focus:text-emerald-300 cursor-pointer">
              Dedicated Engine (사내 전용)
            </SelectItem>
          </SelectContent>
        </Select>

        {/* ── 프롬프트 가이드 버튼 그룹 ── */}
        <div className="flex items-center gap-2">
          {/* INF_KICE TikZ 프롬프트 버튼 (구 메타수학 가이드) + 3회 한정 툴팁 */}
          <div className="relative">
            <button
              id="btn-meta-prompt-guide"
              onClick={() => setIsMetaModalOpen(true)}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[11px] font-bold tracking-tight transition-all duration-150
                bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500
                text-white shadow-md shadow-blue-900/40 border border-blue-500/30 hover:border-blue-400/50
                hover:scale-[1.03] active:scale-100 group"
              title="INF_KICE TikZ 프롬프트 가이드 열기"
            >
              <BookOpen className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
              INF_KICE TikZ 프롬프트
            </button>


          </div>

          {/* KICE 검수 체크리스트 버튼 */}
          <button
            id="btn-guide-checklist"
            onClick={() => setIsGuideModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-bold tracking-tight transition-all duration-150
              bg-transparent border border-amber-500/60 text-amber-300
              hover:bg-amber-500/10 hover:border-amber-400/80 hover:text-amber-200
              hover:scale-[1.03] active:scale-100"
            title="INF_KICE 렌더링 실무 검수 체크리스트"
          >
            💡 KICE 검수 체크리스트
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
        </div>
      </header>

      {/* ── Dedicated Server Banner ── */}
      {renderEngine === "private" && (
        <div 
          className={`relative bg-emerald-500/10 border-b border-emerald-500/20 px-4 flex items-center justify-center z-20 shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${
            showBanner ? "py-1.5 opacity-100 max-h-12" : "py-0 opacity-0 max-h-0 border-transparent"
          }`}
        >
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-medium text-emerald-400 tracking-wide">
              🚀 KO-SMART 사내 전용 렌더링 서버가 가동 중입니다. (속도 향상 및 무제한 렌더링)
            </span>
          </div>
          <button
            onClick={() => setShowBanner(false)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-emerald-600/80 hover:text-emerald-300 hover:bg-emerald-500/20 p-0.5 rounded transition-colors"
            title="닫기"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

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
              {navigatorText && (
                <div className="ml-4 text-xs font-mono text-blue-300 bg-blue-900/20 px-2 py-1 rounded truncate max-w-md">
                  {navigatorText}
                </div>
              )}
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

              {/* ── 다운로드 영역 그룹 ── */}
              <div className="relative z-50 flex items-center gap-2 p-1.5 bg-gradient-to-r from-amber-950/40 to-zinc-900/60 border border-amber-700/40 rounded-xl shadow-lg shadow-amber-900/20 backdrop-blur-sm">
                {/* ── TikZ 코드 함께 저장 체크박스 (Pill) ── */}
                <label
                  className={`relative group flex items-center gap-1.5 cursor-pointer px-3 py-1.5 rounded-md border transition-colors ${
                    saveTikzCode
                      ? "bg-zinc-700/80 border-neutral-500"
                      : "bg-zinc-800/50 hover:bg-zinc-700/50 border-zinc-700"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={saveTikzCode}
                    onChange={(e) => setSaveTikzCode(e.target.checked)}
                    className="w-3.5 h-3.5 accent-neutral-500 bg-neutral-800 border-neutral-600 rounded-sm cursor-pointer"
                  />
                  <span className={`text-[11px] font-medium whitespace-nowrap select-none transition-colors ${saveTikzCode ? "text-neutral-100" : "text-neutral-300"}`}>
                    TikZ 코드(.txt) 포함
                  </span>
                  <Info className={`w-[14px] h-[14px] transition-colors ${saveTikzCode ? "text-neutral-300" : "text-neutral-500 group-hover:text-neutral-400"}`} />

                  {/* 툴팁 */}
                  <div
                    className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50
                               opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-in-out w-56"
                  >
                    {/* 위쪽 화살표 */}
                    <div className="mx-auto w-0 h-0 border-l-[5px] border-r-[5px] border-b-[5px] border-transparent border-b-neutral-800" />
                    {/* 말풍선 본문 */}
                    <div className="bg-neutral-800 text-neutral-200 text-[10px] leading-relaxed p-2.5 rounded-md shadow-xl border border-neutral-700 break-keep text-center">
                      나중에 그래프를 재수정할 수 있도록, 그림과 동일한 이름의 TikZ 소스 코드(.txt) 파일을 세트로 함께 저장합니다.
                    </div>
                  </div>
                </label>

                {/* ── HWP 인쇄용 PNG (1500px) ── */}
                <div className="relative group">
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
                    HWP 인쇄용 (고정배율)
                  </Button>
                  {/* 툴팁 */}
                  <div
                    className="pointer-events-none absolute top-full right-0 mt-2 z-50
                               opacity-0 group-hover:opacity-100
                               transition-opacity duration-200 ease-in-out"
                  >
                    {/* 위쪽 화살표 */}
                    <div className="ml-auto mr-3 w-0 h-0
                                    border-l-[5px] border-l-transparent
                                    border-r-[5px] border-r-transparent
                                    border-b-[5px] border-b-zinc-900" />
                    <div className="bg-zinc-900 text-white text-[10px] font-medium leading-snug
                                    whitespace-nowrap rounded-md px-2.5 py-1.5
                                    shadow-lg shadow-black/40 border border-zinc-700/60">
                      HWP 삽입 후 [개체속성 → 그림 → 확대/축소비율 12.5%] 설정
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Preview Panel ─────────────────────────────── */}
          <div className="flex-1 rounded-xl border border-zinc-800/60 overflow-auto shadow-2xl shadow-black/40 relative bg-white">

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
                ref={previewContainerRef}
                onMouseDown={handlePreviewMouseDown}
                onMouseLeave={handlePreviewMouseLeave}
                onMouseUp={handlePreviewMouseUp}
                onMouseMove={handlePreviewMouseMove}
                style={{
                  width: "100%",
                  height: "100%",
                  overflow: "auto",
                  background: "white",
                  cursor: isPreviewDragging ? "grabbing" : "grab",
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
      <footer className="relative shrink-0 border-t border-white/[0.05] bg-[#0a0d12] px-5 py-0 flex items-center gap-5 z-20 shadow-[0_-6px_24px_rgba(0,0,0,0.4)]" style={{ height: "88px" }}>

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

        {/* 노드 다중 선택 — 컴팩트 체크박스 패널 */}
        <div className="flex flex-col shrink-0" ref={nodeDropdownRef}>
          <div className="flex items-center mb-1">
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Node</span>
            <span className="bg-blue-500/20 text-blue-300 border border-blue-500/40 px-1.5 py-[1px] rounded-md whitespace-nowrap text-[8.5px] tracking-tight ml-2 shadow-sm flex items-center">
              키보드 조작 가능 <span className="opacity-70 text-[8px] ml-1">(shift: 10배 / Alt: 미세)</span>
            </span>
          </div>

          {/* 트리거: 클릭하면 체크박스 리스트 토글 */}
          <button
            onClick={() => setIsNodeDropdownOpen(v => !v)}
            className="w-[210px] h-8 flex items-center justify-between px-2.5 rounded-md
              border border-zinc-600 bg-zinc-800 hover:border-zinc-400 hover:bg-zinc-700
              text-[11px] font-medium text-zinc-200 transition-all"
          >
            <span className="truncate">
              {selectedNodeIndices.size === 0
                ? (nodes.length > 0 ? "노드 선택..." : "노드 없음")
                : getSelectedNodesLabel()
              }
            </span>
            <svg className={`w-3 h-3 shrink-0 text-zinc-400 transition-transform ${isNodeDropdownOpen ? "rotate-180" : ""}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* 체크박스 패널 — 맨처음에 나타남 (absolute) */}
          {isNodeDropdownOpen && nodes.length > 0 && (
            <div
              className="absolute bottom-full mb-1.5 z-50 w-[240px]
                rounded-xl border border-zinc-600 shadow-2xl shadow-black/60
                overflow-hidden"
              style={{ background: "linear-gradient(160deg, #1a1d26 0%, #13151e 100%)" }}
            >
              {/* 헤더: 전체 선택/해제 */}
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-700/60 bg-black/20">
                <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide">
                  {selectedNodeIndices.size > 0 ? `${selectedNodeIndices.size}개 선택됨` : "노드 선택"}
                </span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setSelectedNodeIndices(new Set(nodes.map((n, i) => i.toString())))}
                    className="text-[8px] px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-blue-800/60
                      border border-zinc-500 hover:border-blue-500 text-zinc-300 hover:text-blue-200 transition-all"
                  >전체</button>
                  <button
                    onClick={() => setSelectedNodeIndices(new Set())}
                    className="text-[8px] px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600
                      border border-zinc-500 text-zinc-300 hover:text-white transition-all"
                  >해제</button>
                </div>
              </div>

              {/* 노드 리스트 */}
              <ul className="max-h-[180px] overflow-y-auto py-1">
                {nodes.map((n, i) => {
                  const isChecked = selectedNodeIndices.has(i.toString());
                  return (
                    <li key={n.srcIndex}>
                      <label
                        className={`flex items-center gap-2 px-3 py-1 cursor-pointer transition-colors
                          ${isChecked
                            ? "bg-blue-900/30 hover:bg-blue-900/50"
                            : "hover:bg-zinc-700/50"
                          }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            setSelectedNodeIndices(prev => {
                              const next = new Set(prev);
                              if (next.has(i.toString())) next.delete(i.toString());
                              else next.add(i.toString());
                              return next;
                            });
                          }}
                          className="accent-blue-500 w-3 h-3 shrink-0"
                        />
                        <span className={`text-[11px] truncate ${isChecked ? "text-blue-200 font-bold" : "text-zinc-300"}`}>
                          {i + 1}. {sanitizeLabel(n.content)}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>

              {/* 선택된 태그 표시 (2개 이상) */}
              {selectedNodeIndices.size >= 2 && (
                <div className="px-2.5 py-1.5 border-t border-zinc-700/60 bg-black/20 flex flex-wrap gap-1">
                  {nodes
                    .filter((n, i) => selectedNodeIndices.has(i.toString()))
                    .slice(0, 5)
                    .map((n) => (
                      <span key={n.srcIndex}
                        className="text-[8px] bg-blue-900/50 border border-blue-700/60 text-blue-200 rounded px-1 py-0.5 font-bold">
                        {nodes.indexOf(n) + 1}. {sanitizeLabel(n.content).slice(0, 8)}
                      </span>
                    ))}
                  {selectedNodeIndices.size > 5 && (
                    <span className="text-[8px] text-zinc-500">+{selectedNodeIndices.size - 5}개</span>
                  )}
                </div>
              )}

              {/* 푸터: 닫기 */}
              <div className="px-3 py-1 border-t border-zinc-700/60 bg-black/20 flex justify-end">
                <button
                  onClick={() => setIsNodeDropdownOpen(false)}
                  className="text-[8px] font-bold text-zinc-400 hover:text-white transition-colors px-2 py-0.5
                    rounded bg-zinc-700/60 hover:bg-zinc-600"
                >닫기</button>
              </div>
            </div>
          )}
        </div>

        <Separator orientation="vertical" className="h-10 bg-zinc-800/60" />

        {/* 조이스틱 + 개별 노드 폰트 스케일 */}
        <div className="flex items-center gap-3 shrink-0">
          {/* 조이스틱 방향키 */}
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                <MousePointer2 className="w-2.5 h-2.5" /> Joystick
              </span>
              
              {/* 시선 집중형 작은 키보드 아이콘 (툴팁 포함) */}
              <div className="relative group cursor-help flex items-center justify-center w-4 h-4 rounded bg-orange-500/15 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors">
                <span className="text-[10px]">⌨️</span>
                <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-in-out w-48">
                  <div className="bg-zinc-800 text-zinc-200 text-[10px] leading-relaxed p-2 rounded shadow-xl border border-zinc-700 break-keep text-center relative">
                    키보드 방향키로 이동 가능<br />
                    <span className="text-zinc-400 text-[9px]">(Shift: 10배 크게, Alt: 1/10 미세조정)</span>
                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-r-[4px] border-t-[4px] border-transparent border-t-zinc-800" />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="flex justify-center">
                <Button variant="outline" size="icon"
                  className="w-7 h-7 rounded-md border border-zinc-600 border-b-[2.5px] border-b-zinc-900 bg-zinc-800 text-zinc-300 hover:bg-blue-900/40 hover:border-blue-500/50 hover:text-blue-300 active:border-b active:translate-y-[1.5px] transition-all shadow-sm"
                  onClick={() => handleShift("y", 1)}>
                  <ChevronUp className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="flex justify-center gap-1">
                <Button variant="outline" size="icon"
                  className="w-7 h-7 rounded-md border border-zinc-600 border-b-[2.5px] border-b-zinc-900 bg-zinc-800 text-zinc-300 hover:bg-blue-900/40 hover:border-blue-500/50 hover:text-blue-300 active:border-b active:translate-y-[1.5px] transition-all shadow-sm"
                  onClick={() => handleShift("x", -1)}>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="icon"
                  className="w-7 h-7 rounded-md border border-zinc-600 border-b-[2.5px] border-b-zinc-900 bg-zinc-800 text-zinc-300 hover:bg-blue-900/40 hover:border-blue-500/50 hover:text-blue-300 active:border-b active:translate-y-[1.5px] transition-all shadow-sm"
                  onClick={() => handleShift("y", -1)}>
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="icon"
                  className="w-7 h-7 rounded-md border border-zinc-600 border-b-[2.5px] border-b-zinc-900 bg-zinc-800 text-zinc-300 hover:bg-blue-900/40 hover:border-blue-500/50 hover:text-blue-300 active:border-b active:translate-y-[1.5px] transition-all shadow-sm"
                  onClick={() => handleShift("x", 1)}>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {/* 개별 노드 폰트 스케일 A+ / A- */}
          <div className="flex flex-col items-center">
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Type className="w-2.5 h-2.5" /> [개별] 폰트
            </span>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => handleNodeFontScale(0.1)}
                className="w-[54px] h-7 rounded-md border border-zinc-600 bg-zinc-800 hover:bg-violet-900/50 hover:border-violet-500 text-zinc-200 hover:text-violet-300 text-[11px] font-black transition-all"
                title="선택된 노드 폰트 크기 10% 증감"
              >크기+</button>
              <button
                onClick={() => handleNodeFontScale(-0.1)}
                className="w-[54px] h-7 rounded-md border border-zinc-600 bg-zinc-800 hover:bg-violet-900/50 hover:border-violet-500 text-zinc-200 hover:text-violet-300 text-[11px] font-black transition-all"
                title="선택된 노드 폰트 크기 10% 증감"
              >크기-</button>
            </div>
          </div>
        </div>

        <Separator orientation="vertical" className="h-10 bg-zinc-800/60" />

        {/* ── GLOBAL CONTROLS ── */}
        <div className="flex flex-col shrink-0">
          <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">[전체] 일괄 제어</span>
          <div className="grid grid-cols-2 gap-1">

            {/* 전체 폰트 */}
            <div className="flex items-center gap-1 bg-zinc-800/80 border border-zinc-600/80 rounded-md px-1.5 py-1">
              <Type className="w-2.5 h-2.5 text-violet-400 shrink-0" />
              <span className="text-[9px] font-medium text-zinc-400 w-7 tracking-wide">폰트</span>
              <button
                onClick={() => handleGlobalFontScale(-0.1)}
                className="w-5 h-5 rounded bg-zinc-700 hover:bg-violet-900/50 border border-zinc-500 hover:border-violet-600 text-zinc-200 hover:text-violet-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                title="전체 노드 폰트 크기 감소"
              >−</button>
              <button
                onClick={() => handleGlobalFontScale(0.1)}
                className="w-5 h-5 rounded bg-zinc-700 hover:bg-violet-900/50 border border-zinc-500 hover:border-violet-600 text-zinc-200 hover:text-violet-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                title="전체 노드 폰트 크기 증가"
              >+</button>
            </div>

            {/* 선두께 */}
            <div className="flex items-center gap-1 bg-zinc-800/80 border border-zinc-600/80 rounded-md px-1.5 py-1">
              <svg className="w-2.5 h-2.5 text-cyan-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" d="M3 12h18" />
                <path strokeLinecap="round" strokeWidth={1} d="M3 7h18M3 17h18" />
              </svg>
              <span className="text-[9px] font-medium text-zinc-400 w-7 tracking-wide">두께</span>
              <button
                onClick={() => handleGlobalLineWidth(0.9)}
                className="w-5 h-5 rounded bg-zinc-700 hover:bg-cyan-900/50 border border-zinc-500 hover:border-cyan-600 text-zinc-200 hover:text-cyan-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                title="선 두께 10% 감소 (배율 적용)"
              >−</button>
              <button
                onClick={() => handleGlobalLineWidth(1.1)}
                className="w-5 h-5 rounded bg-zinc-700 hover:bg-cyan-900/50 border border-zinc-500 hover:border-cyan-600 text-zinc-200 hover:text-cyan-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                title="선 두께 10% 증가 (배율 적용)"
              >+</button>
            </div>

            {/* 가로 (X) */}
            <div className="flex items-center gap-1 bg-zinc-800/80 border border-zinc-600/80 rounded-md px-1.5 py-1">
              <svg className="w-2.5 h-2.5 text-emerald-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" />
              </svg>
              <span className="text-[9px] font-medium text-zinc-400 w-7 tracking-wide">가로</span>
              <button
                onClick={() => handleCanvasScale("x", 0.9)}
                className="w-5 h-5 rounded bg-zinc-700 hover:bg-emerald-900/50 border border-zinc-500 hover:border-emerald-600 text-zinc-200 hover:text-emerald-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                title="가로 비율 10% 감소 (x=Ncm 배율 적용)"
              >−</button>
              <button
                onClick={() => handleCanvasScale("x", 1.1)}
                className="w-5 h-5 rounded bg-zinc-700 hover:bg-emerald-900/50 border border-zinc-500 hover:border-emerald-600 text-zinc-200 hover:text-emerald-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                title="가로 비율 10% 증가 (x=Ncm 배율 적용)"
              >+</button>
            </div>

            {/* 세로 (Y) */}
            <div className="flex items-center gap-1 bg-zinc-800/80 border border-zinc-600/80 rounded-md px-1.5 py-1">
              <svg className="w-2.5 h-2.5 text-rose-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4" />
              </svg>
              <span className="text-[9px] font-medium text-zinc-400 w-7 tracking-wide">세로</span>
              <button
                onClick={() => handleCanvasScale("y", 0.9)}
                className="w-5 h-5 rounded bg-zinc-700 hover:bg-rose-900/50 border border-zinc-500 hover:border-rose-600 text-zinc-200 hover:text-rose-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                title="세로 비율 10% 감소 (y=Ncm 배율 적용)"
              >−</button>
              <button
                onClick={() => handleCanvasScale("y", 1.1)}
                className="w-5 h-5 rounded bg-zinc-700 hover:bg-rose-900/50 border border-zinc-500 hover:border-rose-600 text-zinc-200 hover:text-rose-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                title="세로 비율 10% 증가 (y=Ncm 배율 적용)"
              >+</button>
            </div>

          </div>
        </div>

        <Separator orientation="vertical" className="h-10 bg-zinc-800/60" />

        {/* 축 길이 조절 (Axis Length) */}
        <div className="flex flex-col shrink-0">
          <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">축 길이 조절</span>
          <div className="flex flex-col gap-1">

            {/* X축 (가로) */}
            <div className="flex items-center gap-2 bg-zinc-800/80 border border-zinc-600/80 rounded-md px-2 py-1">
              <span className="text-[9px] font-bold text-amber-400/80 w-[46px] shrink-0">X축 가로</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-medium text-zinc-400">좌측</span>
                <button
                  onClick={() => handleAxisLength("x", "left", -0.2)}
                  className="w-5 h-5 rounded bg-zinc-700 hover:bg-amber-900/50 border border-zinc-500 hover:border-amber-600 text-zinc-200 hover:text-amber-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                  title="X축 좌측 길이 -0.2"
                >&minus;</button>
                <button
                  onClick={() => handleAxisLength("x", "left", 0.2)}
                  className="w-5 h-5 rounded bg-zinc-700 hover:bg-amber-900/50 border border-zinc-500 hover:border-amber-600 text-zinc-200 hover:text-amber-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                  title="X축 좌측 길이 +0.2"
                >+</button>
              </div>
              <div className="w-px h-4 bg-zinc-600/60 shrink-0" />
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-medium text-zinc-400">우측</span>
                <button
                  onClick={() => handleAxisLength("x", "right", -0.2)}
                  className="w-5 h-5 rounded bg-zinc-700 hover:bg-amber-900/50 border border-zinc-500 hover:border-amber-600 text-zinc-200 hover:text-amber-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                  title="X축 우측 길이 -0.2"
                >&minus;</button>
                <button
                  onClick={() => handleAxisLength("x", "right", 0.2)}
                  className="w-5 h-5 rounded bg-zinc-700 hover:bg-amber-900/50 border border-zinc-500 hover:border-amber-600 text-zinc-200 hover:text-amber-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                  title="X축 우측 길이 +0.2"
                >+</button>
              </div>
            </div>

            {/* Y축 (세로) */}
            <div className="flex items-center gap-2 bg-zinc-800/80 border border-zinc-600/80 rounded-md px-2 py-1">
              <span className="text-[9px] font-bold text-sky-400/80 w-[46px] shrink-0">Y축 세로</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-medium text-zinc-400">하단</span>
                <button
                  onClick={() => handleAxisLength("y", "bottom", -0.2)}
                  className="w-5 h-5 rounded bg-zinc-700 hover:bg-sky-900/50 border border-zinc-500 hover:border-sky-600 text-zinc-200 hover:text-sky-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                  title="Y축 하단 길이 -0.2"
                >&minus;</button>
                <button
                  onClick={() => handleAxisLength("y", "bottom", 0.2)}
                  className="w-5 h-5 rounded bg-zinc-700 hover:bg-sky-900/50 border border-zinc-500 hover:border-sky-600 text-zinc-200 hover:text-sky-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                  title="Y축 하단 길이 +0.2"
                >+</button>
              </div>
              <div className="w-px h-4 bg-zinc-600/60 shrink-0" />
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-medium text-zinc-400">상단</span>
                <button
                  onClick={() => handleAxisLength("y", "top", -0.2)}
                  className="w-5 h-5 rounded bg-zinc-700 hover:bg-sky-900/50 border border-zinc-500 hover:border-sky-600 text-zinc-200 hover:text-sky-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                  title="Y축 상단 길이 -0.2"
                >&minus;</button>
                <button
                  onClick={() => handleAxisLength("y", "top", 0.2)}
                  className="w-5 h-5 rounded bg-zinc-700 hover:bg-sky-900/50 border border-zinc-500 hover:border-sky-600 text-zinc-200 hover:text-sky-300 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                  title="Y축 상단 길이 +0.2"
                >+</button>
              </div>
            </div>

          </div>
        </div>

        <Separator orientation="vertical" className="h-10 bg-zinc-800/60" />

        {/* 점 & 그래프 제어 버튼 */}
        <button
          onClick={() => setIsPointManagerOpen(true)}
          className="flex items-center justify-center gap-1.5 shrink-0 px-4 py-2 rounded-lg
            border border-zinc-500/70 bg-zinc-800/90
            hover:bg-fuchsia-900/40 hover:border-fuchsia-500/80
            transition-all group"
          style={{ boxShadow: "0 0 0 0 rgba(216,180,254,0)" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              "0 0 8px 2px rgba(216,180,254,0.18)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.boxShadow = "";
          }}
          title="점 마커 & 그래프 Domain 제어 패널 열기"
        >
          <Sliders className="w-3.5 h-3.5 text-gray-200 group-hover:text-fuchsia-300 transition-colors" />
          <span className="text-[11px] font-bold text-gray-100 group-hover:text-fuchsia-300 tracking-wider transition-colors">
            점 &amp; 그래프 제어
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
          className="fixed z-[100] w-[240px] flex flex-col rounded-xl border border-fuchsia-800/40 shadow-2xl shadow-fuchsia-900/30 select-none"
          style={{
            background: "linear-gradient(145deg, #160e1e 0%, #0e0d17 60%, #0d1117 100%)",
            top:  pmPos ? pmPos.y : 60,
            right: pmPos ? undefined : 20,
            left:  pmPos ? pmPos.x : undefined,
          }}
        >
          {/* 드래그 핸들 헤더 */}
          <div
            className="relative flex items-center justify-between px-3 py-2.5 border-b border-fuchsia-900/30 cursor-grab active:cursor-grabbing group"
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
            {/* 중앙 드래그 핸들 (직관적 인지) */}
            <div className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center text-zinc-600 group-hover:text-zinc-400 transition-colors pointer-events-none">
              <GripHorizontal className="w-5 h-5" />
            </div>

            <div className="flex items-center gap-2">
              <GripVertical className="w-4 h-4 text-fuchsia-700/80 shrink-0" />
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

          {/* 일괄 토글 버튼 */}
          {extractedPoints.length > 0 && (
            <div className="flex gap-1.5 px-2.5 py-2 border-b border-fuchsia-900/20">
              <button
                onClick={() => handleToggleAllPoints("on")}
                className="flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[9px] font-bold
                           bg-fuchsia-900/50 border border-fuchsia-700/60 text-fuchsia-200
                           hover:bg-fuchsia-800/70 hover:border-fuchsia-500/80 hover:text-white transition-all"
                title="하이라이트된 모든 점 표시"
              >
                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                전체 켜기
              </button>
              <button
                onClick={() => handleToggleAllPoints("off")}
                className="flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[9px] font-bold
                           bg-zinc-800/70 border border-zinc-600/60 text-zinc-300
                           hover:bg-zinc-700/80 hover:border-zinc-400/70 hover:text-white transition-all"
                title="모든 점 숨김"
              >
                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
                전체 끄기
              </button>
            </div>
          )}

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
                          ? "bg-zinc-800/60 border-zinc-600/60 opacity-90"
                          : "bg-zinc-900/60 border-zinc-700/60 hover:border-fuchsia-700/60"
                      }`}
                    >
                      {/* 순번 */}
                      <span className="shrink-0 w-4 h-4 rounded-full bg-zinc-700 border border-zinc-500 text-zinc-400 text-[7px] font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      {/* 좌표 배지 */}
                      <span className={`flex-1 text-[10px] font-mono font-bold rounded px-1.5 py-0.5 border ${
                        isCommented
                          ? "text-zinc-300 bg-zinc-700/50 border-zinc-500/60"
                          : "text-fuchsia-300/90 bg-fuchsia-950/40 border-fuchsia-800/40"
                      }`}>
                        ({coord})
                      </span>
                      {/* 눈 토글 */}
                      <button
                        onClick={() => handleTogglePoint(raw, isCommented)}
                        className={`shrink-0 w-6 h-6 rounded flex items-center justify-center border transition-all ${
                          isCommented
                            ? "text-zinc-200 hover:text-fuchsia-300 bg-zinc-700 border-zinc-400 hover:border-fuchsia-500"
                            : "text-fuchsia-300 bg-fuchsia-900/40 border-fuchsia-700/60 hover:border-fuchsia-400"
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
            <p className="text-[8px] text-zinc-500">👁 토글 = <code className="text-zinc-400">%</code> 주석 스위치 · 위쪽 버튼으로 일괄 처리</p>
          </div>

          {/* ── 📈 그래프 길이(Domain) 제어 섹션 ── */}
          <div className="border-t border-fuchsia-900/30">
            {/* 섹션 헤더 */}
            <div className="flex items-center gap-2 px-3 py-2 bg-black/20">
              <span className="text-[10px]">📈</span>
              <span className="text-[10px] font-black text-emerald-400 tracking-wide">그래프 길이 (Domain)</span>
              {domains.length > 0 && (
                <span className="text-[8px] text-zinc-600">{domains.length}개</span>
              )}
            </div>

            {domains.length === 0 ? (
              <p className="text-[9px] text-zinc-700 text-center py-3 px-2">
                <code className="text-zinc-600">domain=A:B</code> 패턴 없음
              </p>
            ) : (
              <ul className="space-y-1.5 px-2.5 pb-2">
                {domains.map((entry, idx) => {
                  // formatDomainLabel: UI 표시 전용 — 원본 entry.formula 는 불변
                  const label = entry.formula
                    ? formatDomainLabel(entry.formula)
                    : `그래프 ${idx + 1}`;
                  return (
                    <li key={idx} className="rounded-lg border border-emerald-900/40 bg-zinc-900/60 px-2 py-1.5">
                      {/* 수식 라벨 */}
                      <div className="mb-1.5 flex items-center gap-1">
                        <span className="text-[8px] font-bold text-emerald-500/70">y =</span>
                        <span
                          className="flex-1 text-[9px] font-mono font-bold text-emerald-300/90 truncate"
                          title={label}
                        >
                          {label}
                        </span>
                      </div>
                      {/* 시작점(A) 제어 */}
                      <div className="flex items-center gap-1 mb-1">
                        <span className="w-[36px] text-[8px] font-bold text-zinc-500 shrink-0">시작점</span>
                        <span className="flex-1 text-[9px] font-mono text-zinc-400 text-center">
                          {entry.start}
                        </span>
                        <button
                          onClick={() => handleDomainChange(idx, "start", -0.1)}
                          className="w-5 h-5 rounded bg-zinc-700 hover:bg-emerald-800/80 border border-zinc-500 hover:border-emerald-500 text-zinc-200 hover:text-emerald-200 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                          title={`시작점 ${entry.start} → ${(entry.start - 0.1).toFixed(1)}`}
                        >&minus;</button>
                        <button
                          onClick={() => handleDomainChange(idx, "start", 0.1)}
                          className="w-5 h-5 rounded bg-zinc-700 hover:bg-emerald-800/80 border border-zinc-500 hover:border-emerald-500 text-zinc-200 hover:text-emerald-200 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                          title={`시작점 ${entry.start} → ${(entry.start + 0.1).toFixed(1)}`}
                        >+</button>
                      </div>
                      {/* 끝점(B) 제어 */}
                      <div className="flex items-center gap-1">
                        <span className="w-[36px] text-[8px] font-bold text-zinc-500 shrink-0">끝점</span>
                        <span className="flex-1 text-[9px] font-mono text-zinc-400 text-center">
                          {entry.end}
                        </span>
                        <button
                          onClick={() => handleDomainChange(idx, "end", -0.1)}
                          className="w-5 h-5 rounded bg-zinc-700 hover:bg-blue-800/80 border border-zinc-500 hover:border-blue-500 text-zinc-200 hover:text-blue-200 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                          title={`끝점 ${entry.end} → ${(entry.end - 0.1).toFixed(1)}`}
                        >&minus;</button>
                        <button
                          onClick={() => handleDomainChange(idx, "end", 0.1)}
                          className="w-5 h-5 rounded bg-zinc-700 hover:bg-blue-800/80 border border-zinc-500 hover:border-blue-500 text-zinc-200 hover:text-blue-200 text-[11px] font-bold leading-none transition-all flex items-center justify-center"
                          title={`끝점 ${entry.end} → ${(entry.end + 0.1).toFixed(1)}`}
                        >+</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          INF_KICE 검수 가이드 모달
      ══════════════════════════════════════════════════════ */}
      {isGuideModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setIsGuideModalOpen(false); }}
        >
          <div
            className="relative w-full max-w-5xl max-h-[88vh] flex flex-col rounded-2xl border border-amber-800/30 shadow-2xl shadow-amber-900/20 overflow-hidden"
            style={{ background: "linear-gradient(145deg, #1a1500 0%, #110f00 50%, #0d1117 100%)" }}
          >
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-amber-900/30 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-md shadow-amber-900/40 text-base">
                  🔍
                </div>
                <div>
                  <div className="text-[13px] font-black text-white tracking-tight">
                    KICE 스타일 마이크로 디테일 최종 검수 가이드
                  </div>
                  <div className="text-[10px] text-amber-400/60 mt-0.5">
                    INF_KICE TikZ v2.1 · 렌더링 QA 검수 체크리스트
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsGuideModalOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 모달 콘텐츠 */}
            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-8">

              {/* ──────────────────────────────
                  섭션 1: 기하 도형 디테일
              ────────────────────────────── */}
              <section>
                <h2 className="text-[11px] font-black text-amber-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <span className="w-5 h-5 rounded bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-[10px]">1</span>
                  기하 도형 디테일 — 점, 선분, 길이 표시
                </h2>
                <div className="grid grid-cols-2 gap-5 items-start">
                  {/* 이미지 */}
                  <div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={guide1.src}
                      alt="기하도형 가이드"
                      className="w-full bg-white rounded-lg object-contain border border-gray-200"
                      style={{ minHeight: "200px" }}
                    />
                  </div>
                  {/* 텍스트 */}
                  <div className="space-y-4 text-[12px] text-zinc-300 leading-relaxed break-keep">
                    <div className="flex gap-2.5">
                      <span className="text-base shrink-0 mt-0.5">📍</span>
                      <div>
                        <p className="font-bold text-white mb-1">점 라벨 밀착 &amp; 정렬</p>
                        <p>A, B, C, D 등 모든 점 라벨은 꼭짓점에서 붕 뜨지 않게 <strong className="text-white">바짝 밀착</strong>해야 합니다. 수평/수직 선상의 점들(예: A와 D, B와 C)은 높낮이가 <strong className="text-white">완벽하게 맞아야</strong> 합니다.</p>
                      </div>
                    </div>
                    <div className="flex gap-2.5">
                      <span className="text-base shrink-0 mt-0.5">📏</span>
                      <div>
                        <p className="font-bold text-white mb-1">길이 수식 렌더링</p>
                        <p>길이 표시는 반드시 점선 정중앙을 자연스럽게 <strong className="text-white">끊고 들어가도록</strong> 배치해야 합니다. 숫자만 공중에 둥둥 띄우지 마세요.</p>
                      </div>
                    </div>
                    <div className="flex gap-2.5">
                      <span className="text-base shrink-0 mt-0.5">↪️</span>
                      <div>
                        <p className="font-bold text-white mb-1">지시선(Callout) 적극 활용</p>
                        <p>내부 대각선(BD)처럼 길이 수식이 메인 도형의 실선을 <strong className="text-red-400">침범할 위험</strong>이 있다면, 억지로 구겨 넣지 말고 지시선(화살표)을 바깥으로 우아하게 빼서 수식을 배치하세요.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <div className="border-t border-zinc-800/60" />

              {/* ──────────────────────────────
                  섭션 2: 함수 그래프 디테일
              ────────────────────────────── */}
              <section>
                <h2 className="text-[11px] font-black text-amber-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <span className="w-5 h-5 rounded bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-[10px]">2</span>
                  함수 그래프 디테일 — 축, 곡선, 수식 라벨
                </h2>
                <div className="grid grid-cols-2 gap-5 items-start">
                  {/* 이미지 2개 세로 배치 */}
                  <div className="space-y-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={guide2.src}
                      alt="함수 가이드 1"
                      className="w-full bg-white rounded-lg object-contain border border-gray-200"
                      style={{ minHeight: "150px" }}
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={guide3.src}
                      alt="함수 가이드 2"
                      className="w-full bg-white rounded-lg object-contain border border-gray-200"
                      style={{ minHeight: "150px" }}
                    />
                  </div>
                  {/* 텍스트 */}
                  <div className="space-y-4 text-[12px] text-zinc-300 leading-relaxed break-keep">
                    <div className="flex gap-2.5">
                      <span className="text-base shrink-0 mt-0.5">🎯</span>
                      <div>
                        <p className="font-bold text-white mb-1">라벨 위치 최적화</p>
                        <p>점 라벨과 직선 이름(l, l’ 등)이 해당 좌표나 선에서 멀리 떨어지지 않게 <strong className="text-white">바짝 붙여주세요</strong>.</p>
                      </div>
                    </div>
                    <div className="flex gap-2.5">
                      <span className="text-base shrink-0 mt-0.5">🛡️</span>
                      <div>
                        <p className="font-bold text-white mb-1">절대 방어선 — 축 경계선 넘지 않기</p>
                        <p>공선의 끝부분이나 수식 라벨(y=f(x), l, l’)이 x축과 y축의 <strong className="text-red-400">화살표 끝을 넘어 바깥으로 튀어나지 않도록</strong> 주의하세요. 모든 요소는 축이 이루는 가상의 직사각형 ‘안쪽’에 안정적으로 담곌야 합니다.</p>
                      </div>
                    </div>
                    <div className="mt-4 p-3 rounded-xl border border-amber-800/30 bg-amber-950/20">
                      <p className="text-[10px] text-amber-400/80 font-bold mb-1">💡 프로 팁</p>
                      <p className="text-[11px] text-zinc-400 break-keep leading-relaxed">라벨 위치나 간격이 미세하게 안 맞을 때는, 에디터 하단의 ‘조이스틱’ 기능을 활용하여 상하좌우로 정밀하게 튜닝해 주세요.</p>
                    </div>
                  </div>
                </div>
              </section>

            </div>{/* /콘텐츠 스크롤 영역 */}

            {/* 모달 푸터 */}
            <div className="px-6 py-3 border-t border-amber-900/20 bg-black/20 shrink-0 flex items-center justify-end">
              <button
                onClick={() => setIsGuideModalOpen(false)}
                className="px-4 py-1.5 rounded-lg text-[11px] font-bold bg-amber-500/20 border border-amber-600/40 text-amber-300 hover:bg-amber-500/30 transition-all"
              >
                닫기
              </button>
            </div>
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

              {/* 핵심 업데이트 안내 */}
              <div className="rounded-xl border border-blue-900/40 bg-blue-950/20 px-4 py-4 mt-4 mb-2 shadow-inner">
                <h4 className="text-[14px] font-black text-blue-400 mb-3.5 flex items-center gap-2">
                  <span className="text-lg">🚀</span> KO-SMART 핵심 업데이트 안내
                </h4>
                
                <div className="space-y-4">
                  {/* 1. 다운로드 개편 */}
                  <div>
                    <h5 className="text-[12px] font-bold text-blue-200 mb-1.5 flex items-center gap-1.5">
                      <span className="text-sm">💾</span> 1. 다운로드 및 내보내기 개편
                    </h5>
                    <ul className="list-disc pl-5 space-y-1 text-zinc-300 text-[11.5px]">
                      <li><strong className="text-blue-100">단일화된 다운로드:</strong> 기존 PNG 버튼이 삭제되고, 평가원 규격에 맞춘 [HWP 인쇄용 (고정배율)] 버튼으로 통합되었습니다.</li>
                      <li><strong className="text-blue-100">TikZ 원본 세트 저장:</strong> 다운로드 버튼 좌측의 <code className="text-blue-200 bg-blue-900/40 px-1.5 py-0.5 rounded">[TikZ 코드(.txt) 포함]</code> 버튼을 체크하면, 추후 그래프 재수정에 활용할 수 있도록 그림과 동일한 이름의 TikZ 소스 코드 파일이 함께 다운로드됩니다.</li>
                      <li><strong className="text-blue-100">파일명 규칙:</strong> 다운로드되는 모든 파일은 <code className="text-zinc-400 bg-zinc-800/80 px-1 py-0.5 rounded">InfiniteMathlab_YYMMDD_HHMMSS</code> 형식으로 통일되어 관리가 더욱 편해졌습니다.</li>
                    </ul>
                  </div>

                  {/* 2. 조작 편의성 */}
                  <div>
                    <h5 className="text-[12px] font-bold text-blue-200 mb-1.5 flex items-center gap-1.5">
                      <span className="text-sm">🖱️</span> 2. 마우스 조작 편의성 향상
                    </h5>
                    <ul className="list-disc pl-5 space-y-1 text-zinc-300 text-[11.5px]">
                      <li><strong className="text-blue-100">화면 드래그 스크롤:</strong> 우측 하얀색 렌더링 도화지 영역을 마우스로 클릭한 채 상하좌우로 드래그하면 스마트폰처럼 캔버스를 휙휙 이동할 수 있습니다.</li>
                      <li><strong className="text-blue-100">스마트 창 닫기 (빈 공간 클릭):</strong>
                        <ul className="list-disc pl-4 mt-1.5 space-y-1 text-zinc-400">
                          <li><strong className="text-zinc-300">노드 선택 창:</strong> 창 바깥의 빈 공간을 클릭하면 창이 닫히며 <strong className="text-amber-200">'선택된 내역이 모두 초기화'</strong>됩니다. (단, 하단 컨트롤 패널 조작 시에는 초기화되지 않아 작업 흐름이 끊기지 않습니다.)</li>
                          <li><strong className="text-zinc-300">점 &amp; 그래프 제어 창:</strong> 빈 공간을 클릭하면 창만 깔끔하게 숨겨지며, 입력해 둔 좌표 데이터는 안전하게 보존됩니다.</li>
                        </ul>
                      </li>
                      <li><strong className="text-blue-100">제어 창 이동:</strong> '점 &amp; 그래프 제어' 창 상단의 그립(점 6개) 아이콘을 잡고 드래그하면, 우측 안내 문구를 가리지 않도록 창을 원하는 위치로 옮길 수 있습니다.</li>
                    </ul>
                  </div>

                  {/* 3. 직관적인 컨트롤러 */}
                  <div>
                    <h5 className="text-[12px] font-bold text-blue-200 mb-1.5 flex items-center gap-1.5">
                      <span className="text-sm">🎛️</span> 3. 직관적인 컨트롤러 조작
                    </h5>
                    <ul className="list-disc pl-5 space-y-1 text-zinc-300 text-[11.5px]">
                      <li><strong className="text-blue-100">축 길이 조절 직관화:</strong> 사용자 편의를 위해 X축 가로(좌측) 및 Y축 세로(하단)의 길이를 조절할 때, <kbd className="bg-zinc-700/80 border border-zinc-600 px-1 rounded text-zinc-200">+</kbd> 버튼은 늘어나고 <kbd className="bg-zinc-700/80 border border-zinc-600 px-1 rounded text-zinc-200">−</kbd> 버튼은 줄어들도록 직관적으로 변경되었습니다.</li>
                    </ul>
                  </div>
                  
                  {/* 4. 한글 주의사항 */}
                  <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-3 mt-3">
                    <h5 className="text-[12px] font-bold text-red-400 mb-1.5 flex items-center gap-1.5">
                      <span className="text-sm">⚠️</span> 4. 한글 입력 주의사항 (필독)
                    </h5>
                    <ul className="list-disc pl-5 space-y-1 text-red-200/90 text-[11.5px]">
                      <li>렌더링 도화지 내부(TikZ 코드)에는 <strong className="text-red-300 underline underline-offset-2">절대 한글을 직접 입력하지 마세요.</strong> (서버 에러 및 렌더링 실패의 원인이 됩니다.)</li>
                      <li>A열, 상자 등 한글 라벨링이 필요한 경우, 영문 알파벳으로 대체하거나 다운로드 후 HWP에서 '글상자'를 이용해 덧입히는 방식을 권장합니다.</li>
                    </ul>
                  </div>
                </div>
              </div>

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
                    <span>
                      <strong className="text-zinc-200">(다중 선택 지원)</strong> 이제 노드를 여러 개 동시에 제어할 수 있습니다! 노드 선택 드롭다운에서 체크박스로 원하는 점과 수식을 여러 개 선택한 뒤, 조이스틱을 움직이거나 폰트 크기(A+/A-)를 조절하면 선택된 모든 항목에 한 번에 일괄 적용됩니다.
                    </span>
                  </li>
                  <li className="flex items-start gap-2 flex-wrap gap-y-1">
                    <span className="shrink-0 mt-0.5 flex gap-1">
                      {["▲","▼","◀","▶"].map(c => (
                        <kbd key={c} className="inline-flex items-center justify-center w-6 h-6 bg-zinc-800 border border-zinc-600 text-zinc-300 text-[11px] font-bold rounded shadow-sm">{c}</kbd>
                      ))}
                    </span>
                    <span><strong className="text-zinc-200">(JOYSTICK)</strong> 선택된 노드(들)를 1pt 단위로 상하좌우 미세 이동시킵니다.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 flex gap-1">
                      <kbd className="inline-flex items-center justify-center px-2 h-6 bg-violet-900/60 border border-violet-700/60 text-violet-300 text-[11px] font-black rounded shadow-sm">A＋</kbd>
                      <kbd className="inline-flex items-center justify-center px-2 h-6 bg-violet-900/60 border border-violet-700/60 text-violet-300 text-[11px] font-black rounded shadow-sm">A－</kbd>
                    </span>
                    <span><strong className="text-zinc-200">(NODE FONT)</strong> 선택된 특정 노드(들)의 글자 크기를 개별적으로 키우거나 줄입니다.</span>
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

              {/* 섹션 3 — 점 & 그래프 제어 (신규 기능 통합) */}
              <div>
                <h4 className="text-[13px] font-black text-white mb-2.5 flex items-center gap-2">
                  <span className="text-base">🟣</span> 4. 점 & 그래프 제어 (Markers & Domain)
                  <span className="text-[10px] font-semibold text-zinc-600 bg-zinc-800/60 px-2 py-0.5 rounded-full">하단 패널</span>
                </h4>
                <ul className="space-y-2.5 pl-1">
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 flex gap-1 items-center">
                      <span className="inline-flex items-center gap-1 bg-zinc-800 border border-zinc-700 text-cyan-300 text-[10px] font-bold px-2 py-0.5 rounded">
                        📈 그래프 길이(Domain)
                      </span>
                    </span>
                    <span>
                      하단 [점 & 그래프 제어] 패널에서 곡선 및 직선의 시작점과 끝점을 0.1 단위로 쉽게 늘리고 줄일 수 있습니다.<br />
                      <span className="text-zinc-500 text-[11px]">(💡 팁: AI가 코드를 생성할 때 직선도 <code className="text-zinc-400 bg-zinc-800 px-1 rounded text-[10px]">domain</code> 범위를 사용하여 그리도록 프롬프트를 작성하면 이 기능이 활성화됩니다.)</span>
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 flex gap-1 items-center">
                      <span className="inline-flex items-center gap-1 bg-zinc-800 border border-zinc-700 text-fuchsia-300 text-[10px] font-bold px-2 py-0.5 rounded">
                        점 & 그래프 제어
                      </span>
                    </span>
                    <span>
                      화면 하단의 [점 & 그래프 제어] 버튼을 누르면 <strong className="text-zinc-200">화면 내에서 자유롭게 이동 가능한 패널</strong>이 열립니다.{" "}
                      드래그하여 원하는 위치에 배치하세요.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 flex items-center">
                      <span className="inline-flex items-center gap-1 bg-zinc-800 border border-zinc-700 text-fuchsia-300 text-[10px] font-bold px-2 py-0.5 rounded">
                        전체 끄기 / 켜기
                      </span>
                    </span>
                    <span>
                      목록 상단의 <strong className="text-zinc-200">[전체 끄기/켜기]</strong> 버튼으로 수십 개의 점 마커를 <strong className="text-fuchsia-300">한 번에 제어</strong>할 수 있습니다.
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
                      <strong className="text-fuchsia-300">숨기거나(코드상 주석 처리)</strong> 다시 나타나게 할 수 있습니다.{" "}
                      코드를 <strong className="text-zinc-200">영구 삭제하지 않으므로</strong> 언제든 안전하게 복구할 수 있습니다.
                    </span>
                  </li>
                </ul>
              </div>

              {/* 섹션 4 — 기존 저장/프롬프트 (번호 5로 조정) */}
              <div>
                <h4 className="text-[13px] font-black text-white mb-2.5 flex items-center gap-2">
                  <span className="text-base">💾</span> 5. 프롬프트 및 QA 검수 가이드
                </h4>
                <ul className="space-y-2.5 pl-1">
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 bg-zinc-800/60 border border-zinc-700/50 text-zinc-400 text-[10px] font-bold px-2 py-0.5 rounded">💾 Auto-Save</span>
                    <span>실수로 새로고침해도 마지막 코드가 브라우저에 안전하게 남아 <strong className="text-zinc-200">자동 복구</strong>됩니다.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 text-white text-[10px] font-bold px-2 py-0.5 rounded" style={{background:"#2563eb"}}>INF_KICE TikZ 프롬프트</span>
                    <span>AI에게 코드를 뽑아낼 때 지시할 엄격한 <strong className="text-zinc-200">평가원 스타일 가이드</strong>를 클립보드에 <strong className="text-zinc-200">원클릭 복사</strong>합니다.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 text-amber-200 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-500/60" style={{background:"transparent"}}>💡 KICE 검수 체크리스트</span>
                    <span>렌더링된 그래프의 <strong className="text-zinc-200">마이크로 디테일</strong>(점선, 정렬, 여백 등)을 최종 점검할 수 있는 시각적 QA 가이드 모달을 엽니다.</span>
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
                    <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 text-white text-[10px] font-bold px-2 py-0.5 rounded" style={{background:"#f97316"}}>📥 HWP 인쇄용 (고정배율)</span>
                    <span>SVG 원본 크기에 <strong className="text-amber-300">×4.0 고정 배율</strong>을 곱해 렌더링 후 오토 크롭하여 저장합니다. 그래프 가로폭에 무관하게 <strong className="text-amber-300">폰트 체급이 항상 균일</strong>하게 유지됩니다. 한글 문서에 넣을 땐 <strong className="text-amber-300">반드시 이 주황색 버튼</strong>을 누르세요!</span>
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
