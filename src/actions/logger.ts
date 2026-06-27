"use server";

// ─── 디스코드 메시지 포맷 매핑 ─────────────────────────────────────────
const ACTION_MESSAGES: Record<string, (email: string) => string> = {
  USAGE_ENTER:     (email) => `[접속] ${email} 님이 KO-SMART 에디터에 진입했습니다.`,
  EXPORT_DOWNLOAD: (email) => `[다운로드] ${email} 님이 초고화질 그래프를 다운로드했습니다.`,
};

/**
 * Vercel 서버 로그 + 디스코드 웹훅으로 사용자 액션을 기록합니다.
 * @param actionType   - 액션 종류 (예: "USAGE_ENTER", "EXPORT_DOWNLOAD")
 * @param email        - 클라이언트에서 전달받은 사용자 이메일
 * @param code_snippet - (선택) TikZ 코드 문자열. 존재하면 tikz_code.txt 파일로 첨부
 */
export async function logUserAction(
  actionType: string,
  email: string,
  code_snippet?: string,
  durationMs?: number,
  hasTikz?: boolean
): Promise<void> {
  const ts = new Date().toISOString();
  let message =
    ACTION_MESSAGES[actionType]?.(email) ??
    `[${actionType}] ${email} 님이 액션을 실행했습니다.`;

  if (actionType === "EXPORT_DOWNLOAD") {
    if (hasTikz !== undefined) {
      message += ` (TikZ 포함: ${hasTikz ? "O" : "X"})`;
    }
    if (durationMs !== undefined) {
      const durationSec = (durationMs / 1000).toFixed(1);
      message += ` [소요시간: ${durationSec}초]`;
    }
  }

  // ── 1. Vercel 서버 콘솔 로그 ──────────────────────────────────────
  console.log(`${message} 시간: ${ts}`);

  // ── 2. 디스코드 웹훅 전송 ────────────────────────────────────────
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return; // 환경변수 없으면 조용히 스킵

  try {
    if (code_snippet) {
      // ── 파일 첨부 모드: multipart/form-data ──────────────────────
      // Discord API: payload_json 필드 + files[0] 필드
      const form = new FormData();
      form.append(
        "payload_json",
        JSON.stringify({ content: message })
      );
      form.append(
        "files[0]",
        new Blob([code_snippet], { type: "text/plain" }),
        "tikz_code.txt"
      );
      await fetch(webhookUrl, {
        method: "POST",
        body: form,
        // Content-Type은 FormData가 자동으로 boundary 포함하여 설정
      });
    } else {
      // ── 텍스트 전용 모드: application/json ───────────────────────
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message }),
      });
    }
  } catch (err) {
    // 웹훅 실패는 에디터 작동에 영향 없음
    console.warn("[KO-SMART LOGGER] 디스코드 웹훅 전송 실패:", err);
  }
}
