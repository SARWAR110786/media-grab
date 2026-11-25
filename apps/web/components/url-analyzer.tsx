"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  Ban,
  ClipboardPaste,
  Download,
  ExternalLink,
  Gauge,
  Globe,
  Info,
  LoaderCircle,
  Lock,
  Puzzle,
  Search,
  ShieldCheck,
  TriangleExclamationPoint,
  Zap,
} from "lucide-react";
import { formatBytes, planSegments, type AnalyzeError, type AnalyzeFile, type AnalyzeResponse, type AnalyzeWebpage } from "@mediagrab/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { FileIcon } from "@/components/file-icon";
import { analyze, browserDownloadHref } from "@/lib/client/api";
import { downloadManager } from "@/lib/client/download-manager";
import { useSettings } from "@/lib/client/settings";
import { cn } from "@/lib/utils";

export function UrlAnalyzer({ initialUrl, autoAnalyze = false, compact = false }: { initialUrl?: string; autoAnalyze?: boolean; compact?: boolean }) {
  const [value, setValue] = useState(initialUrl ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) {
      setResult({ ok: false, kind: "invalid", message: "Please paste a URL first." });
      inputRef.current?.focus();
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setResult(null);
    try {
      const r = await analyze(trimmed, ctrl.signal);
      if (!ctrl.signal.aborted) setResult(r);
    } catch {
      /* aborted */
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (autoAnalyze && initialUrl) {
      setValue(initialUrl);
      void run(initialUrl);
    }
  }, [autoAnalyze, initialUrl, run]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast.info("Your clipboard is empty.");
        return;
      }
      setValue(text.trim());
      void run(text.trim());
    } catch {
      toast.error("Clipboard access was blocked. Paste with Ctrl+V / ⌘V instead.");
      inputRef.current?.focus();
    }
  };

  const analyzeCandidate = (url: string) => {
    setValue(url);
    void run(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        className={cn("flex flex-col gap-2 sm:flex-row", !compact && "rounded-2xl border bg-card p-2 shadow-sm")}
        onSubmit={(e) => {
          e.preventDefault();
          void run(value);
        }}
      >
        <div className="relative flex-1">
          <Globe className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://example.com/video.mp4"
            aria-label="File URL"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className={cn("h-12 pl-10 text-[15px]", !compact && "border-transparent bg-transparent shadow-none focus-visible:border-ring")}
          />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="lg" onClick={paste} className="flex-1 sm:flex-none">
            <ClipboardPaste /> Paste
          </Button>
          <Button type="submit" size="lg" disabled={loading} className="flex-1 sm:flex-none sm:min-w-32">
            {loading ? <LoaderCircle className="animate-spin" /> : <Search />}
            {loading ? "Analyzing" : "Analyze"}
          </Button>
        </div>
      </form>

      {loading && <AnalyzingSkeleton />}
      {result && !loading && (
        <div className="animate-fade-in">
          {result.ok && result.kind === "file" && <FileResult key={result.finalUrl} info={result} />}
          {result.ok && result.kind === "webpage" && <WebpageResult info={result} onAnalyze={analyzeCandidate} />}
          {!result.ok && <ErrorResult error={result} />}
        </div>
      )}
    </div>
  );
}

function AnalyzingSkeleton() {
  return (
    <Card className="flex items-center gap-4 p-5">
      <div className="size-10 animate-pulse rounded-lg bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
      </div>
      <span className="text-sm text-muted-foreground">Checking the link…</span>
    </Card>
  );
}

function FileResult({ info }: { info: AnalyzeFile }) {
  const settings = useSettings();
  const [filename, setFilename] = useState(info.filename);
  const [connections, setConnections] = useState(info.segmentable ? settings.connections : 1);
  const [added, setAdded] = useState<string | null>(null);
  const canAccelerate = !info.exceedsLimit || info.corsDirect;
  // The exact plan the engine will use, so the UI never promises more connections than it opens.
  const segments = planSegments(info.size, info.acceptRanges, connections, settings.minSegmentMB * 1024 * 1024).length;

  const start = () => {
    const id = downloadManager.add(info, { filename, connections });
    setAdded(id);
    toast.success("Download started", { description: filename, action: { label: "View", onClick: () => (window.location.href = "/downloads") } });
  };

  const browserHref = info.exceedsLimit ? info.finalUrl : browserDownloadHref(info.finalUrl, filename);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <FileIcon category={info.category} className="size-12" />
          <div className="min-w-0 flex-1">
            <label htmlFor="mg-filename" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              File name
            </label>
            <Input id="mg-filename" value={filename} onChange={(e) => setFilename(e.target.value)} className="mt-1 font-medium" />
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge>{info.formatLabel}</Badge>
              <Badge variant="secondary">{formatBytes(info.size)}</Badge>
              <Badge variant="outline" title={info.mimeType}>
                {info.mimeType}
              </Badge>
              {info.acceptRanges ? (
                <Badge variant="success">
                  <ShieldCheck /> Resumable
                </Badge>
              ) : (
                <Badge variant="warning">No range support</Badge>
              )}
              {info.segmentable && (
                <Badge variant="default">
                  <Zap /> Multi-connection
                </Badge>
              )}
              {info.redirected && <Badge variant="outline">Redirected</Badge>}
            </div>
          </div>
        </div>

        {info.warnings.length > 0 && (
          <ul className="space-y-1.5 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
            {info.warnings.map((w) => (
              <li key={w} className="flex gap-2">
                <Info className="mt-0.5 size-4 shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        )}

        {info.segmentable && canAccelerate && (
          <div className="rounded-lg border p-4">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium">
                <Gauge className="size-4 text-primary" /> Connections
              </span>
              <span className="tabular-nums text-muted-foreground">
                {connections === 1 ? "1 (no splitting)" : segments < connections ? `${segments} segment${segments === 1 ? "" : "s"} (file size limits splitting)` : `${segments} parallel segments`}
              </span>
            </div>
            <Slider min={1} max={16} step={1} value={[connections]} onValueChange={([v]) => setConnections(v)} aria-label="Connections" />
            <p className="mt-3 text-xs text-muted-foreground">
              More connections can help when a server limits speed per connection. Actual speed depends on the server, your internet connection and the browser.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          {canAccelerate ? (
            added ? (
              <Button asChild size="lg" variant="secondary" className="sm:flex-1">
                <Link href="/downloads">
                  View in download manager <ArrowRight />
                </Link>
              </Button>
            ) : (
              <Button size="lg" onClick={start} className="sm:flex-1">
                <Zap /> {segments > 1 ? "Accelerated download" : "Download"}
              </Button>
            )
          ) : null}
          <Button asChild size="lg" variant="outline" className="sm:flex-1">
            <a href={browserHref} download={filename} rel="noopener noreferrer" target={info.exceedsLimit ? "_blank" : undefined}>
              <Download /> Download with browser
            </a>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          <strong className="font-medium text-foreground">Download</strong> uses MediaGrab&apos;s manager (progress, pause/resume, retry).{" "}
          <strong className="font-medium text-foreground">Download with browser</strong> hands the file to your browser&apos;s built-in downloader
          {info.exceedsLimit ? " directly from the original server." : " and saves it to your browser's download folder."}
        </p>
      </div>
    </Card>
  );
}

function WebpageResult({ info, onAnalyze }: { info: AnalyzeWebpage; onAnalyze: (url: string) => void }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-sky-500/12 text-sky-600 dark:text-sky-300">
          <Globe className="size-6" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{info.title || new URL(info.finalUrl).hostname}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{info.message}</p>
        </div>
      </div>
      {info.candidates.length > 0 && (
        <ul className="mt-5 divide-y rounded-lg border">
          {info.candidates.map((c) => (
            <li key={c.url} className="flex items-center gap-3 p-3">
              <FileIcon category={c.category} className="size-9" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={c.url}>
                  {c.filename}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {c.formatLabel} · found via {c.source}
                  {!c.supported && c.reason ? ` · ${c.reason}` : ""}
                </p>
              </div>
              {c.supported ? (
                <Button size="sm" variant="outline" onClick={() => onAnalyze(c.url)}>
                  Analyze
                </Button>
              ) : (
                <Badge variant="warning">
                  <Ban /> Unsupported
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg bg-muted/60 p-3 text-sm">
        <Puzzle className="size-4 text-primary" />
        <span className="flex-1 text-muted-foreground">The browser extension sees media added by scripts and HTML5 players on the live page.</span>
        <Button asChild size="sm" variant="ghost">
          <Link href="/extension">
            Get the extension <ArrowRight />
          </Link>
        </Button>
      </div>
    </Card>
  );
}

const ERROR_META: Record<AnalyzeError["kind"], { title: string; icon: typeof Info; tone: string }> = {
  invalid: { title: "Invalid URL", icon: TriangleExclamationPoint, tone: "text-warning" },
  blocked: { title: "Address not allowed", icon: ShieldCheck, tone: "text-destructive" },
  unsupported: { title: "Website not supported", icon: Ban, tone: "text-warning" },
  streaming: { title: "Streaming format not supported", icon: Ban, tone: "text-warning" },
  unreachable: { title: "Couldn't reach the file", icon: TriangleExclamationPoint, tone: "text-destructive" },
  http_error: { title: "The server returned an error", icon: TriangleExclamationPoint, tone: "text-destructive" },
  auth_required: { title: "Authorization required", icon: Lock, tone: "text-warning" },
  rate_limited: { title: "Slow down", icon: Info, tone: "text-warning" },
};

function ErrorResult({ error }: { error: AnalyzeError }) {
  const meta = ERROR_META[error.kind] ?? ERROR_META.unreachable;
  const Icon = meta.icon;
  return (
    <Card role="alert" className="flex items-start gap-4 p-5">
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted", meta.tone)}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">{meta.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
        {error.url && (error.kind === "unsupported" || error.kind === "streaming") && (
          <a href={error.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
            Open page <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </Card>
  );
}
