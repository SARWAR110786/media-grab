"use client";
import { useSearchParams } from "next/navigation";
import { CheckCheck, Gauge, Pause, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { UrlAnalyzer } from "@/components/url-analyzer";

const SUPPORTED = ["MP4", "WebM", "MKV", "MOV", "MP3", "M4A", "WAV", "OGG", "FLAC", "PDF", "EPUB", "ZIP", "RAR", "7Z", "ISO", "…any direct http(s) file"];

export function DownloaderView() {
  const params = useSearchParams();
  const fromExtension = params.get("url") ?? undefined;
  return (
    <div>
      <PageHeader title="Downloader" description="Paste a direct file URL. MediaGrab validates it, reads the file's metadata and downloads it — splitting it into parallel segments when the server allows." />
      <UrlAnalyzer initialUrl={fromExtension} autoAnalyze={!!fromExtension} />

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <Gauge className="size-5 text-primary" />
          <h3 className="mt-3 font-semibold">How acceleration works</h3>
          <p className="mt-1.5 text-sm text-muted-foreground">
            If the server supports HTTP byte ranges, the file is split into segments that download in parallel, then reassembled and size-verified. Otherwise MediaGrab uses one connection. Speed gains depend on the server and your network — they are never guaranteed.
          </p>
        </Card>
        <Card className="p-5">
          <Pause className="size-5 text-primary" />
          <h3 className="mt-3 font-semibold">Pause &amp; resume</h3>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Pausing keeps finished bytes when the server supports ranges; resume continues from there, even after reloading the page (in browsers with file-system storage). Without range support a paused download restarts.
          </p>
        </Card>
        <Card className="p-5">
          <ShieldCheck className="size-5 text-primary" />
          <h3 className="mt-3 font-semibold">Public files only</h3>
          <p className="mt-1.5 text-sm text-muted-foreground">
            MediaGrab never bypasses logins, paywalls, DRM or encryption, and never sends your cookies. Streaming sites and HLS/DASH streams are reported as unsupported.
          </p>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <CheckCheck className="size-4 text-success" /> Supported files
        </h3>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUPPORTED.map((f) => (
            <span key={f} className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              {f}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
