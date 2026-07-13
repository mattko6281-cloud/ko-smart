import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const resolvedParams = await params;
    const pathStr = resolvedParams.path.join("/");

    // Use environment variable or fallback to the direct IP
    const krokiBaseUrl = process.env.NEXT_PUBLIC_KROKI_URL || "http://43.201.227.158:8000";
    const targetUrl = `${krokiBaseUrl}/${pathStr}`;

    const response = await fetch(targetUrl, {
      method: "GET",
    });

    if (!response.ok) {
      return new Response(`Kroki server error: ${response.statusText}`, { status: response.status });
    }

    const contentType = response.headers.get("content-type") || "image/svg+xml";
    const arrayBuffer = await response.arrayBuffer();

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch (error) {
    console.error("[Kroki Proxy Error]", error);
    return new Response("Internal Server Error proxying to Kroki", { status: 500 });
  }
}
