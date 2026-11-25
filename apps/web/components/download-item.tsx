"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Ban, CalendarClock, CircleCheck, CircleX, Copy, ExternalLink, Hash, LoaderCircle, Pause, Play, RotateCcw, Save, ShieldCheck, Trash } from "lucide-react";
import { formatBytes, formatDuration, formatEta, formatSpeed, HASH_LABEL, percent } from "@mediagrab/shared";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function ChecksumLine({ d }: { d: DownloadRecord }) {
  const c = d.checksum;
  if (!c) return null;
  const algo = HASH_LABEL[c.algorithm];
  if (c.state === "pending") {
    return d.status === "completed" ? null : <p className="mt-2 text-xs text-muted-foreground">{algo} checksum will be verified when the download finishes.</p>;
  }
  if (c.state === "running") {
    const p = d.size ? Math.min(100, Math.round(((c.progress ?? 0) / d.size) * 100)) : null;
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="checksum" data-state="running">
        <LoaderCircle className="size-3.5 animate-spin" /> Verifying {algo}…{p != null ? ` ${p}%` : ""}
      </p>
    );
  }
  if (c.state === "match") {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-success" data-testid="checksum" data-state="match" title={c.actual}>
        <ShieldCheck className="size-3.5" /> {algo} checksum verified
      </p>
    );
  }
  if (c.state === "mismatch") {
    return (
      <div className="mt-2 rounded-md bg-destructive/8 px-2.5 py-1.5 text-xs text-destructive" data-testid="checksum" data-state="mismatch">
        <p className="flex items-center gap-1.5 font-medium">
          <CircleX className="size-3.5" /> {algo} checksum does not match — the file may be corrupted or different from the published one.
        </p>
        <p className="mt-1 break-all font-mono opacity-80">expected {c.expected}</p>
        <p className="break-all font-mono opacity-80">got&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; {c.actual}</p>
      </div>
    );
  }
  return (
    <p className="mt-2 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground" data-testid="checksum" data-state="error">
      Couldn&apos;t verify the checksum: {c.error}
    </p>
  );
}

function VerifyForm({ d, onDone }: { d: DownloadRecord; onDone: () => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          onDone();
          const state = await downloadManager.verify(d.id, value);
          if (state === "match") toast.success("Checksum verified");
          else if (state === "mismatch") toast.error("Checksum does not match");
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
        }
      }}
    >
      <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="Paste SHA-256, SHA-1 or MD5" aria-label="Expected checksum" spellCheck={false} className="h-8 font-mono text-xs" />
      <Button size="sm" type="submit" disabled={!value.trim()}>
        Verify
      </Button>
    </form>
  );
}

export function DownloadItem({ d }: { d: DownloadRecord }) {
  const [busy, setBusy] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const scheduledFor = d.status === "queued" || d.status === "paused" ? d.startAfter : undefined;
  const pct = percent(d.downloaded, d.size);
  const status = scheduledFor && d.status === "queued" ? { label: "Scheduled", variant: "secondary" as const } : STATUS[d.status];
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
              {scheduledFor && d.status === "queued" && <CalendarClock />}
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
            {scheduledFor ? <span className="text-foreground">Starts {new Date(scheduledFor).toLocaleString()}</span> : <span>{new Date(d.createdAt).toLocaleString()}</span>}
          </div>

          <ChecksumLine d={d} />
          {verifyOpen && d.status === "completed" && <VerifyForm d={d} onDone={() => setVerifyOpen(false)} />}

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
        {scheduledFor && (
          <Button size="sm" onClick={() => downloadManager.startNow(d.id)}>
            <Play /> Start now
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
        {d.status === "completed" && d.checksum?.state !== "running" && (
          <Button variant="ghost" size="sm" onClick={() => setVerifyOpen((v) => !v)} title="Verify the file against a checksum">
            <Hash /> <span className="sr-only sm:not-sr-only">{d.checksum ? "Re-verify" : "Verify"}</span>
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
