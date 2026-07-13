import type { NextConfig } from "next";

// NOTE: output:'export' 제거 — NextAuth API 라우트는 SSR(서버리스 함수)이 필요합니다.
// Vercel 배포 시 자동으로 서버리스 함수로 처리됩니다.
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/kroki/:path*",
        destination: `${process.env.NEXT_PUBLIC_KROKI_URL || "http://43.201.227.158:8000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
