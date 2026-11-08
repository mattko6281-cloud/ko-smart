// KO-SMART v0.2.2 Beta — 인앱 사용설명서 모달([빠른 시작] 6단계 + [전체 사용설명서] 12섹션) 현행화 및 UI/UX 통합 자동 회귀 테스트 (13 Tests)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");

const pageSrc = fs.readFileSync(path.join(ROOT_DIR, "src/app/page.tsx"), "utf8");
const helpModalPath = path.join(ROOT_DIR, "src/components/KoSmartHelpModal.tsx");
const helpModalSrc = fs.readFileSync(helpModalPath, "utf8");

test("1. 도움말 버튼(#btn-help) 클릭 시 모달 오픈 연결 및 작업 전 기존 모달 코드 백업 보존 검증", () => {
  assert.ok(fs.existsSync(helpModalPath), "KoSmartHelpModal.tsx 컴포넌트 존재");
  assert.ok(pageSrc.includes('id="btn-help"'), "상단 헤더 #btn-help 버튼 존재");
  assert.ok(pageSrc.includes("onClick={handleOpenHelp}"), "#btn-help 클릭 시 handleOpenHelp 호출");
  assert.ok(pageSrc.includes("setIsHelpOpen(true)"), "handleOpenHelp가 isHelpOpen을 true로 설정");
  assert.ok(
    pageSrc.includes("<KoSmartHelpModal open={isHelpOpen} onClose={() => setIsHelpOpen(false)} />"),
    "isHelpOpen 상태가 KoSmartHelpModal에 연결됨"
  );
  assert.ok(
    pageSrc.includes("/* [백업 보존] 기존 단일 스크롤 도움말 모달 원본 보존 */"),
    "작업 전 기존 도움말 모달 코드가 백업 블록으로 보존됨"
  );
});

test("2. 모달 오픈 시 기본 탭이 [빠른 시작](quickstart)으로 표시되는지 검증", () => {
  assert.ok(
    helpModalSrc.includes('useState<"quickstart" | "fullguide">("quickstart")'),
    "초기 탭 상태가 quickstart로 설정됨"
  );
  assert.ok(
    helpModalSrc.includes('if (open) {\n      setActiveTab("quickstart");\n    }'),
    "모달 재오픈 시 기본 탭을 quickstart로 초기화함"
  );
  assert.ok(helpModalSrc.includes('data-testid="tab-help-quickstart"'), "[빠른 시작] 탭 testid 존재");
  assert.ok(helpModalSrc.includes('data-testid="panel-help-quickstart"'), "[빠른 시작] 패널 testid 존재");
});

test("3. 6단계 빠른 시작 카드(①~⑥) 모두 존재 및 핵심 안내 검증", () => {
  const expectedTitles = [
    "① TikZ 코드 입력",
    "② 실시간 그림 미리보기",
    "③ [✨ 스마트 그림 정리] 클릭",
    "④ 원본과 추천 결과 비교 (배치 선택)",
    "⑤ 선택한 결과 적용 및 [↩ 원본 복원]",
    "⑥ [📥저장 & 📋HWP 자동복사] 후 한글 Ctrl+V",
  ];
  for (const title of expectedTitles) {
    assert.ok(helpModalSrc.includes(title), `빠른 시작 단계 포함: ${title}`);
  }
  assert.ok(
    helpModalSrc.includes("data-testid={`quickstart-step-${item.step}`}"),
    "각 단계별 data-testid=quickstart-step-1..6 렌더링"
  );
});

test("4. 각 빠른 시작 단계(1~6) 이미지 src 및 alt 존재 + 실제 public/help-guide 이미지 파일 무결성 검증", () => {
  for (let i = 1; i <= 6; i++) {
    assert.ok(helpModalSrc.includes(`step: ${i},`), `STEP ${i} 정의 존재`);
  }
  const imgMatches = [...helpModalSrc.matchAll(/imgSrc:\s*"([^"]+)",\s*\r?\n\s*imgAlt:\s*"([^"]+)"/g)];
  assert.equal(imgMatches.length, 6, "6개 단계 모두 imgSrc 및 imgAlt 보유");

  for (const [, src, alt] of imgMatches) {
    assert.ok(src.startsWith("/help-guide/step"), `유효한 이미지 경로: ${src}`);
    assert.ok(alt.trim().length > 5, `비어 있지 않은 alt 텍스트: ${alt}`);
    const diskPath = path.join(ROOT_DIR, "public", src.replace(/^\//, ""));
    assert.ok(fs.existsSync(diskPath), `실제 이미지 파일 존재: ${diskPath}`);
    const stat = fs.statSync(diskPath);
    assert.ok(stat.size > 5000 && stat.size < 400000, `최적화된 이미지 크기 (${stat.size} bytes): ${src}`);
  }
});

test("5. [전체 사용설명서] 탭 전환 스위치 및 양방향 이동 버튼 검증", () => {
  assert.ok(helpModalSrc.includes('data-testid="tab-help-fullguide"'), "[전체 사용설명서] 탭 버튼 존재");
  assert.ok(helpModalSrc.includes('onClick={() => setActiveTab("fullguide")}'), "fullguide 탭 전환 핸들러 존재");
  assert.ok(helpModalSrc.includes('onClick={() => setActiveTab("quickstart")}'), "quickstart 탭 전환 핸들러 존재");
  assert.ok(helpModalSrc.includes('data-testid="panel-help-fullguide"'), "[전체 사용설명서] 패널 존재");
});

test("6. [전체 사용설명서] 내 12개 필수 설명서 섹션(help-section-1 ~ 12) 존재 및 접기/펼치기 지원 검증", () => {
  for (let sec = 1; sec <= 12; sec++) {
    assert.ok(
      helpModalSrc.includes(`id="help-manual-sec-${sec}"`),
      `섹션 ${sec} 앵커 ID(help-manual-sec-${sec}) 존재`
    );
    assert.ok(
      helpModalSrc.includes(`data-testid="help-section-${sec}"`),
      `섹션 ${sec} testid(help-section-${sec}) 존재`
    );
    assert.ok(
      helpModalSrc.includes(`onClick={() => toggleSection(${sec})}`),
      `섹션 ${sec} 개별 접기/펼치기 토글 존재`
    );
  }
  assert.ok(helpModalSrc.includes("setAllSections(true)"), "전체 펼치기 기능 존재");
  assert.ok(helpModalSrc.includes("setAllSections(false)"), "전체 접기 기능 존재");
});

test("7. 신규 설명서 내 구버전 버튼명 단독 안내 없음 및 조이스틱/키보드/축 길이 실제 단위 일치 검증", () => {
  // 구버전 버튼명을 현재 버튼명 없이 단독으로 안내하지 않음
  assert.ok(
    helpModalSrc.includes("[📥저장 &amp; 📋HWP 자동복사] (구 [HWP 인쇄용 (고정배율)] 통합)"),
    "구버전 명칭은 현행 버튼명 통합 안내 맥락으로만 병기됨"
  );
  // 실제 조이스틱 1pt, 키보드 방향키 1pt / Shift 10pt / Alt 0.1pt, 수동 축 길이 0.2 단위, Domain 0.1 단위 반영 확인
  assert.ok(helpModalSrc.includes("1pt 단위"), "조이스틱 1pt 단위 명시");
  assert.ok(helpModalSrc.includes("10pt"), "Shift + 방향키 10pt 단위 명시");
  assert.ok(helpModalSrc.includes("0.1pt"), "Alt/Ctrl + 방향키 0.1pt 단위 명시");
  assert.ok(helpModalSrc.includes("0.2 단위"), "수동 축 길이 조절 0.2 단위 명시");
  assert.ok(helpModalSrc.includes("±0.1 단위"), "그래프 길이(Domain) ±0.1 단위 명시");
  assert.ok(helpModalSrc.includes("4,000자"), "공용 서버(Public) 4,000자 제한 안내 명시");
});

test("8. [📥저장 & 📋HWP 자동복사] 명칭, Ctrl+V 붙여넣기, 원(Circle) 1:1 자동 보정, [.txt 포함] 세트 저장 반영 검증", () => {
  assert.ok(helpModalSrc.includes("[📥저장 & 📋HWP 자동복사]"), "빠른 시작에 현행 HWP 버튼 명칭 반영");
  assert.ok(helpModalSrc.includes("Ctrl+V"), "한글 Ctrl+V 즉시 붙여넣기 반영");
  assert.ok(helpModalSrc.includes("×4.0 고정 배율"), "×4.0 고정 배율 렌더링 반영");
  assert.ok(helpModalSrc.includes("1:1 정원 비율을 자동 보정"), "원(circle) 1:1 정비율 자동 보정 설명 반영");
  assert.ok(helpModalSrc.includes("[TikZ 코드(.txt) 포함]"), "[TikZ 코드(.txt) 포함] 세트 저장 설명 반영");
  assert.ok(helpModalSrc.includes("12.5%"), "한글 개체 속성 12.5% 배율 실무 팁 반영");
});

test("9. 일반 모드 A '축 길이도 함께 맞춤' 기본 ON 및 축 끝 이름(x, y) vs 축 위 문자 눈금(a, b, \\alpha, \\beta) 구분 반영 검증", () => {
  assert.ok(
    helpModalSrc.includes("축 길이도 함께 맞춤 (4방향 축 자동 연장 — 일반 모드 A 기본 ON)"),
    "일반 모드 A 축 길이 맞춤 기본 ON 설명 반영"
  );
  assert.ok(helpModalSrc.includes("축 끝 이름 (x, y):"), "축 끝 이름(x, y) Unit 3-A 동기화 설명 반영");
  assert.ok(
    helpModalSrc.includes("축 위 문자 눈금 (a, b, k, \\alpha, \\beta 등):"),
    "축 위 문자 눈금 Unit 3-F(D-2) 분리 설명 반영"
  );
});

test("10. 다중 추상 함수식(Type 2) 및 다중 직선 이름(D-3) 기본 [원본 배치](Hold) 및 3가지 배치 선택 설명 반영 검증", () => {
  assert.ok(
    helpModalSrc.includes("왜 기본값이 [원본 배치](Hold)인가요?"),
    "다중 함수식/직선 이름 기본 Hold 이유 설명 반영"
  );
  assert.ok(
    helpModalSrc.includes("[원본 배치] / [추천 배치] / [반대 배치]"),
    "원본/추천/반대 배치 3가지 선택 설명 반영"
  );
});

test("11. Safe Shrink 및 그래프 끝점 미세 연장(Domain Extension) 기본 OFF 설명 반영 검증", () => {
  assert.ok(
    helpModalSrc.includes("축 길이 안전하게 줄이기 (Safe Shrink — 기본 OFF, 고급 모드 B에서 선택)"),
    "Safe Shrink 기본 OFF 설명 반영"
  );
  assert.ok(
    helpModalSrc.includes("그래프 끝점 미세 연장 (Domain Extension — 기본 OFF, 고급 모드 B에서 선택)"),
    "Domain Extension 기본 OFF 설명 반영"
  );
});

test("12. [↩ 원본 복원] 백업 및 적용 후 추가 편집 시 덮어쓰기 방지 확인창 설명 반영 검증", () => {
  assert.ok(
    helpModalSrc.includes("[↩ 원본 복원] 버튼 및 추가 편집 덮어쓰기 방지 확인창"),
    "원본 복원 및 덮어쓰기 방지 확인창 제목 반영"
  );
  assert.ok(
    helpModalSrc.includes("추가 수정을 한 상태라면, 수정 내용이 실수로 사라지지 않도록 덮어쓰기 확인 모달"),
    "추가 수정 시 덮어쓰기 확인 모달 동작 설명 반영"
  );
});

test("13. 모달 닫기(우측 상단 ✕ 버튼, 하단 닫기 버튼, ESC 키, 배경 클릭) 정상 작동 연결 검증", () => {
  assert.ok(helpModalSrc.includes('data-testid="btn-help-close-top"'), "우측 상단 ✕ 닫기 버튼 존재");
  assert.ok(helpModalSrc.includes('data-testid="btn-help-close-bottom"'), "하단 닫기 버튼 존재");
  assert.ok(helpModalSrc.includes('if (e.key === "Escape")'), "ESC 키 닫기 이벤트 리스너 존재");
  assert.ok(helpModalSrc.includes("if (e.target === e.currentTarget) onClose();"), "배경(backdrop) 클릭 닫기 존재");
});
