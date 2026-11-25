"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Ban, CircleCheck, CircleX, Copy, ExternalLink, LoaderCircle, Pause, Play, RotateCcw, Save, Trash } from "lucide-react";
import { formatBytes, formatDuration, formatEta, formatSpeed, percent } from "@mediagrab/shared";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FileIcon } from "@/components/file-icon";
import { downloadManager, type DownloadRecord, type DownloadStatus } from "@/lib/client/download-manager";
import { cn } from "@/lib/utils";

const STATUS: Record<DownloadStatus, { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" | "outline" }> = {
  queued: { label: "Queued", variant: "secondary" },
  downloading: { label: "Downloading", variant: "default" },
  paused: { label: "Paused", variant: "warning" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

function SegmentMap({ d }: { d: DownloadRecord }) {
  if (d.segments.length < 2) return null;
  return (
    <div className="flex gap-0.5" aria-label={`${d.segments.length} segments`}>
      {d.segments.map((s, i) => {
        const p = s.length ? (s.downloaded / s.length) * 100 : 0;
        return (
          <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-muted" title={`Segment ${i + 1}: ${formatBytes(s.downloaded)} / ${formatBytes(s.length)}`}>
            <div className={cn("h-full rounded-full", p >= 100 ? "bg-success" : "bg-primary/70")} style={{ width: `${p}%` }} />
          </div>
        );
      })}
    </div>
  );
}

export function DownloadItem({ d }: { d: DownloadRecord }) {
  const [busy, setBusy] = useState(false);
  const pct = percent(d.downloaded, d.size);
  const status = STATUS[d.status];
  const tone = d.status === "completed" ? "success" : d.status === "failed" ? "destructive" : d.status === "downloading" || d.status === "queued" ? "primary" : "muted";
  const avgSpeed = d.activeMs > 0 ? d.downloaded / (d.activeMs / 1000) : 0;

  const act = async (fn: () => unknown) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(d.url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't access the clipboard.");
    }
  };

  return (
    <Card className="group p-4 transition-shadow hover:shadow-md sm:p-5" data-testid="download-item" data-status={d.status}>
      <div className="flex items-start gap-4">
        <FileIcon category={d.category} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 truncate font-medium" title={d.filename}>
              {d.filename}
            </p>
            <Badge variant={status.variant}>
              {d.status === "downloading" && <LoaderCircle className="animate-spin" />}
              {d.status === "completed" && <CircleCheck />}
              {d.status === "failed" && <CircleX />}
              {d.status === "cancelled" && <Ban />}
              {status.label}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={d.url}>
            {new URL(d.url).hostname} · {d.formatLabel}
            {d.mode === "segmented" ? ` · ${d.segments.length} connections` : d.mode === "single" ? " · single connection" : ""}
            {d.transport === "direct" ? " · direct" : " · via server"}
          </p>

          {d.status !== "cancelled" && (
            <div className="mt-3 space-y-1.5">
              <Progress value={d.status === "completed" ? 100 : pct ?? (d.status === "downloading" ? null : 0)} tone={tone} />
              {d.status === "downloading" && <SegmentMap d={d} />}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
            <span>
              {formatBytes(d.downloaded)}
              {d.size != null ? ` of ${formatBytes(d.size)}` : ""}
              {pct != null && d.status !== "completed" ? ` (${pct.toFixed(pct >= 10 ? 0 : 1)}%)` : ""}
            </span>
            {d.status === "downloading" && (
              <>
                <span>{formatSpeed(d.speed)}</span>
                <span>ETA {formatEta(d.size != null ? d.size - d.downloaded : null, d.speed)}</span>
              </>
            )}
            {d.status === "completed" && (
              <>
                {avgSpeed > 0 && <span>avg {formatSpeed(avgSpeed)}</span>}
                <span>took {formatDuration(d.activeMs / 1000)}</span>
              </>
            )}
            <span>{new Date(d.createdAt).toLocaleString()}</span>
          </div>

          {d.error && d.status === "failed" && <p className="mt-2 rounded-md bg-destructive/8 px-2.5 py-1.5 text-xs text-destructive">{d.error}</p>}
          {d.notice && d.status !== "failed" && <p className="mt-2 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">{d.notice}</p>}
          {d.status === "paused" && !d.acceptRanges && !d.notice && (
            <p className="mt-2 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
              This server doesn&apos;t support resuming, so resuming restarts the download.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-1.5 border-t pt-3">
        <Button variant="ghost" size="sm" onClick={copy} title="Copy link">
          <Copy /> <span className="sr-only sm:not-sr-only">Copy link</span>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <a href={d.url} target="_blank" rel="noopener noreferrer" title="Open original link">
            <ExternalLink /> <span className="sr-only sm:not-sr-only">Source</span>
          </a>
        </Button>
        {d.status === "downloading" && (
          <Button variant="outline" size="sm" onClick={() => downloadManager.pause(d.id)} title={d.acceptRanges ? "Pause" : "Pause (server can't resume — will restart)"}>
            <Pause /> Pause
          </Button>
        )}
        {d.status === "queued" && (
          <Button variant="outline" size="sm" onClick={() => downloadManager.pause(d.id)}>
            <Pause /> Hold
          </Button>
        )}
        {d.status === "paused" && (
          <Button size="sm" onClick={() => downloadManager.resume(d.id)}>
            <Play /> Resume
          </Button>
        )}
        {(d.status === "failed" || d.status === "cancelled") && (
          <Button size="sm" disabled={busy} onClick={() => act(() => downloadManager.retry(d.id))}>
            <RotateCcw /> Retry
          </Button>
        )}
        {d.status === "completed" && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const ok = await downloadManager.save(d.id);
                if (!ok) toast.error("This file is no longer stored in the browser. Retry to download it again.");
              })
            }
          >
            <Save /> {d.saved ? "Save again" : "Save file"}
          </Button>
        )}
        {(d.status === "downloading" || d.status === "paused" || d.status === "queued") && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(() => downloadManager.cancel(d.id))} className="text-destructive hover:text-destructive">
            <CircleX /> Cancel
          </Button>
        )}
        {(d.status === "completed" || d.status === "failed" || d.status === "cancelled") && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(() => downloadManager.remove(d.id))} title="Remove from history">
            <Trash /> Remove
          </Button>
        )}
      </div>
    </Card>
  );
}
