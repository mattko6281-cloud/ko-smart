import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// ─── 접속 허용 이메일 화이트리스트 ────────────────────────────────
const ALLOWED_EMAILS = [
  "gggguni95@gmail.com",
  "ggguni95@gmail.com",
  "mattko6281@gmail.com",
  "gggarpe0718@gmail.com",
  "logicking1@gmail.com",
];

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    signIn({ user }) {
      const email = user.email ?? "";
      if (ALLOWED_EMAILS.includes(email)) {
        console.log(
          `[KO-SMART LOGIN] ${email} 님이 접속했습니다. 시간: ${new Date().toISOString()}`
        );
        return true;
      }
      console.warn(
        `[KO-SMART BLOCKED] 미허가 접근 차단 — 이메일: ${email} | 시간: ${new Date().toISOString()}`
      );
      return false;
    },
  },
  pages: {
    // 인증 오류(차단)는 로그인 페이지로 돌려보냄
    error: "/",
  },
});
