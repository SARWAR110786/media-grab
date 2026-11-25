import { NextResponse, type NextRequest } from "next/server";
import { analyzeUrl } from "@/lib/server/analyze";
import { allowRequest, clientKey } from "@/lib/server/rate-limit";
import { serverConfig } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!allowRequest(`analyze:${clientKey(req.headers)}`, serverConfig.analyzePerMinute)) {
    return NextResponse.json({ ok: false, kind: "rate_limited", message: "Too many requests. Please wait a minute and try again." }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, kind: "invalid", message: "Request body must be JSON: { \"url\": \"…\" }" }, { status: 400 });
  }
  const url = typeof (body as { url?: unknown })?.url === "string" ? (body as { url: string }).url : "";
  const result = await analyzeUrl(url, { origin: req.nextUrl.origin, signal: req.signal });
  return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
}
