import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { handleSmartLabelGet, handleSmartLabelPost } from "@/lib/smart-label-beta";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function GET() {
  const result = await handleSmartLabelGet({
    getSession: () => auth(),
    env: process.env,
  });

  return NextResponse.json(result.body, {
    status: result.httpStatus,
    headers: NO_STORE_HEADERS,
  });
}

export async function POST(request: NextRequest) {
  let parsedBody: any = null;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        reasonCode: "INVALID_JSON",
        message: "JSON 요청 본문을 파싱할 수 없습니다.",
        canApply: false,
      },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const result = await handleSmartLabelPost(parsedBody, {
    getSession: () => auth(),
    env: process.env,
  });

  return NextResponse.json(result.body, {
    status: result.httpStatus,
    headers: NO_STORE_HEADERS,
  });
}
