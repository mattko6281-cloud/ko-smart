"use server";

// ─── 디스코드 메시지 포맷 매핑 ─────────────────────────────────────────
const ACTION_MESSAGES: Record<string, (email: string) => string> = {
  USAGE_ENTER:     (email) => `[접속] ${email} 님이 KO-SMART 에디터에 진입했습니다.`,
  EXPORT_DOWNLOAD: (email) => `[다운로드] ${email} 님이 초고화질 그래프를 다운로드했습니다.`,
};

/**
 * Vercel 서버 로그 + 디스코드 웹훅으로 사용자 액션을 기록합니다.
 * @param actionType - 액션 종류 (예: "USAGE_ENTER", "EXPORT_DOWNLOAD")
 * @param email      - 클라이언트에서 전달받은 사용자 이메일 (auth() 딜레이 없이 즉시 사용)
 */
export async function logUserAction(
  actionType: string,
  email: string
): Promise<void> {
  const ts = new Date().toISOString();
  const message =
    ACTION_MESSAGES[actionType]?.(email) ??
    `[${actionType}] ${email} 님이 액션을 실행했습니다.`;

  // ── 1. Vercel 서버 콘솔 로그 ──────────────────────────────────────
  console.log(`${message} 시간: ${ts}`);

  // ── 2. 디스코드 웹훅 전송 ────────────────────────────────────────
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return; // 환경변수 없으면 조용히 스킵

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
  } catch (err) {
    // 웹훅 실패는 에디터 작동에 영향 없음
    console.warn("[KO-SMART LOGGER] 디스코드 웹훅 전송 실패:", err);
  }
}
