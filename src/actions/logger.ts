"use server";

import { auth } from "@/auth";

/**
 * Vercel 서버 로그에 사용자 액션을 기록합니다.
 * @param actionType - 액션 종류 (예: "USAGE_ENTER", "EXPORT_DOWNLOAD")
 */
export async function logUserAction(actionType: string): Promise<void> {
  try {
    const session = await auth();
    const email = session?.user?.email ?? "unknown";
    const ts = new Date().toISOString();
    console.log(`[${actionType}] ${email} 님이 액션을 실행했습니다. 시간: ${ts}`);
  } catch (err) {
    // 로깅 실패는 사용자 경험에 영향을 주지 않도록 조용히 처리
    console.warn("[KO-SMART LOGGER] 로그 기록 실패:", err);
  }
}
