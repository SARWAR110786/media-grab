"use client";
import type { AnalyzeResponse } from "@mediagrab/shared";

export async function analyze(url: string, signal?: AbortSignal): Promise<AnalyzeResponse> {
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal,
    });
    const data = (await res.json()) as AnalyzeResponse;
    return data;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return { ok: false, kind: "unreachable", message: "Could not reach the MediaGrab server. Check your connection." };
  }
}

export function browserDownloadHref(url: string, filename?: string): string {
  const q = new URLSearchParams({ url });
  if (filename) q.set("filename", filename);
  return `/api/download?${q.toString()}`;
}
