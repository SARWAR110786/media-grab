"use client";
import { useMemo, useState } from "react";
import { Inbox, Search, Trash } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DownloadItem } from "@/components/download-item";
import { downloadManager, useDownloads, type DownloadRecord, type DownloadStatus } from "@/lib/client/download-manager";
import { cn } from "@/lib/utils";

type Filter = "all" | "active" | "completed" | "failed" | "cancelled";

const FILTERS: Array<{ id: Filter; label: string; match: (d: DownloadRecord) => boolean }> = [
  { id: "all", label: "All", match: () => true },
  { id: "active", label: "Active", match: (d) => d.status === "downloading" || d.status === "queued" || d.status === "paused" },
  { id: "completed", label: "Completed", match: (d) => d.status === "completed" },
  { id: "failed", label: "Failed", match: (d) => d.status === "failed" },
  { id: "cancelled", label: "Cancelled", match: (d) => d.status === "cancelled" },
];

const CLEARABLE: Record<Filter, DownloadStatus[]> = {
  all: ["completed", "failed", "cancelled"],
  active: [],
  completed: ["completed"],
  failed: ["failed"],
  cancelled: ["cancelled"],
};

export function DownloadList({ initialFilter = "all" }: { initialFilter?: Filter }) {
  const downloads = useDownloads();
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [query, setQuery] = useState("");

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, downloads.filter(f.match).length])) as Record<Filter, number>, [downloads]);
  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!;
    const q = query.trim().toLowerCase();
    return downloads.filter((d) => f.match(d) && (!q || d.filename.toLowerCase().includes(q) || d.url.toLowerCase().includes(q)));
  }, [downloads, filter, query]);

  const clearable = CLEARABLE[filter];
  const clearCount = downloads.filter((d) => clearable.includes(d.status)).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div role="tablist" aria-label="Filter downloads" className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                filter === f.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
              <span className="rounded bg-background/60 px-1.5 text-xs tabular-nums text-muted-foreground">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1 md:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search downloads" className="pl-9" aria-label="Search downloads" />
          </div>
          {clearable.length > 0 && (
            <Button
              variant="outline"
              disabled={clearCount === 0}
              onClick={() => {
                if (confirm(`Remove ${clearCount} item${clearCount === 1 ? "" : "s"} from history? Stored file data is deleted too.`)) {
                  void downloadManager.clearHistory(clearable);
                }
              }}
            >
              <Trash /> Clear
            </Button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <Inbox className="size-10 text-muted-foreground/60" />
          <p className="mt-3 font-medium">{downloads.length === 0 ? "No downloads yet" : "Nothing here"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{downloads.length === 0 ? "Paste a direct file link on the Downloader page to get started." : "No downloads match this filter."}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((d) => (
            <DownloadItem key={d.id} d={d} />
          ))}
        </div>
      )}
    </div>
  );
}
