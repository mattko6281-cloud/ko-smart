import type { NextConfig } from "next";

// NOTE: output:'export' 제거 — NextAuth API 라우트는 SSR(서버리스 함수)이 필요합니다.
// Vercel 배포 시 자동으로 서버리스 함수로 처리됩니다.
const nextConfig: NextConfig = {
  // rewrites for Kroki removed in favor of Next.js API Route for Mixed Content fix
  outputFileTracingExcludes: {
    "/api/smart-label/recommend": [
      "./experiments/**/output/**",
      "./experiments/**/*.test.mjs",
      "./experiments/**/test-*.mjs",
      "./experiments/**/server.mjs",
    ],
  },
};

export default nextConfig;
