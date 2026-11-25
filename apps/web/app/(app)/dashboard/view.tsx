"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CircleCheck, CircleX, Download, HardDrive, Puzzle } from "lucide-react";
import { formatBytes, formatSpeed } from "@mediagrab/shared";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UrlAnalyzer } from "@/components/url-analyzer";
import { DownloadItem } from "@/components/download-item";
import { useDownloads } from "@/lib/client/download-manager";
import { useExtensionVersion } from "@/lib/client/use-extension";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Stat({ label, value, icon: Icon, hint }: { label: string; value: string; icon: typeof Download; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

export function DashboardView() {
  const downloads = useDownloads();
  const ext = useExtensionVersion();
  const [hello, setHello] = useState("Welcome");
  useEffect(() => setHello(greeting()), []);

  const queue = downloads.filter((d) => d.status === "downloading" || d.status === "queued" || d.status === "paused");
  const recent = downloads.filter((d) => d.status === "completed" || d.status === "failed" || d.status === "cancelled").slice(0, 5);
  const completed = downloads.filter((d) => d.status === "completed");
  const failed = downloads.filter((d) => d.status === "failed").length;
  const totalBytes = completed.reduce((a, d) => a + (d.size ?? d.downloaded), 0);
  const speed = downloads.filter((d) => d.status === "downloading").reduce((a, d) => a + d.speed, 0);

  return (
    <div className="flex flex-col gap-8">
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/12 via-card to-card p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-primary/15 blur-3xl" />
        <p className="text-sm font-medium text-primary">{hello}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">What would you like to download?</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">Paste a direct link to a video, audio file, PDF, archive or any public file. MediaGrab checks it and downloads it reliably.</p>
        <div className="relative mt-6">
          <UrlAnalyzer />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active" value={String(queue.length)} icon={Download} hint={speed > 0 ? formatSpeed(speed) : "Idle"} />
        <Stat label="Completed" value={String(completed.length)} icon={CircleCheck} />
        <Stat label="Failed" value={String(failed)} icon={CircleX} />
        <Stat label="Downloaded" value={totalBytes ? formatBytes(totalBytes) : "0 B"} icon={HardDrive} />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Download queue</h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/downloads">
              Manager <ArrowRight />
            </Link>
          </Button>
        </div>
        {queue.length ? (
          <div className="flex flex-col gap-3">
            {queue.map((d) => (
              <DownloadItem key={d.id} d={d} />
            ))}
          </div>
        ) : (
          <Card className="border-dashed p-8 text-center text-sm text-muted-foreground">No active downloads. Analyze a link above to start one.</Card>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent downloads</h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/downloads">
                History <ArrowRight />
              </Link>
            </Button>
          </div>
          {recent.length ? (
            <div className="flex flex-col gap-3">
              {recent.map((d) => (
                <DownloadItem key={d.id} d={d} />
              ))}
            </div>
          ) : (
            <Card className="border-dashed p-8 text-center text-sm text-muted-foreground">Finished downloads appear here.</Card>
          )}
        </div>
        <Card className="h-fit p-5">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Puzzle className="size-5" />
          </span>
          <h3 className="mt-4 font-semibold">Browser extension</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {ext
              ? `Installed (v${ext}). Open any page with HTML5 video or audio and click the MediaGrab icon.`
              : "Detect HTML5 video, audio and file links on any page, then download them in one click."}
          </p>
          <Button asChild variant={ext ? "outline" : "default"} className="mt-4 w-full">
            <Link href="/extension">{ext ? "Extension details" : "Get the extension"}</Link>
          </Button>
        </Card>
      </section>
    </div>
  );
}
