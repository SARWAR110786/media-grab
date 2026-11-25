"use client";
import { useCallback, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { HardDrive, Monitor, Moon, RotateCcw, Sun, Trash } from "lucide-react";
import { formatBytes } from "@mediagrab/shared";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { PageHeader } from "@/components/page-header";
import { DEFAULT_SETTINGS, updateSettings, useSettings } from "@/lib/client/settings";
import { clearAllStoredData, opfsSupported, storedBytes } from "@/lib/client/opfs-store";
import { downloadManager, useDownloads } from "@/lib/client/download-manager";
import { cn } from "@/lib/utils";

function Row({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="max-w-lg">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0 sm:w-64 sm:text-right">{children}</div>
    </div>
  );
}

function SliderRow({ value, min, max, onChange, format, label }: { value: number; min: number; max: number; onChange: (v: number) => void; format: (v: number) => string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <Slider min={min} max={max} step={1} value={[value]} onValueChange={([v]) => onChange(v)} aria-label={label} />
      <span className="w-24 shrink-0 text-right text-sm tabular-nums text-muted-foreground">{format(value)}</span>
    </div>
  );
}

/** Speed-limit steps in KB/s; 0 = unlimited. */
const SPEED_STEPS = [0, 128, 256, 512, 1024, 2048, 5120, 10240, 25600, 51200, 102400];
const speedLabel = (kb: number) => (kb === 0 ? "Unlimited" : kb >= 1024 ? `${+(kb / 1024).toFixed(1)} MB/s` : `${kb} KB/s`);
const nearestStep = (kb: number) => SPEED_STEPS.reduce((best, v, i) => (Math.abs(v - kb) < Math.abs(SPEED_STEPS[best] - kb) ? i : best), 0);

export function SettingsView() {
  const s = useSettings();
  const { theme, setTheme } = useTheme();
  const downloads = useDownloads();
  const [mounted, setMounted] = useState(false);
  const [usage, setUsage] = useState<number | null>(null);
  const [quota, setQuota] = useState<number | null>(null);

  const refreshUsage = useCallback(async () => {
    setUsage(await storedBytes().catch(() => null));
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    setQuota(est?.quota ?? null);
  }, []);

  useEffect(() => {
    setMounted(true);
    void refreshUsage();
  }, [refreshUsage]);

  const active = downloads.some((d) => d.status === "downloading");

  return (
    <div>
      <PageHeader title="Settings" description="Preferences are saved in this browser." />

      <Card className="px-5 sm:px-6">
        <h2 className="pt-5 font-semibold">Appearance</h2>
        <Row title="Theme" description="Light, dark, or follow your system.">
          <div className="inline-flex rounded-lg bg-muted p-1">
            {[
              { id: "light", icon: Sun, label: "Light" },
              { id: "dark", icon: Moon, label: "Dark" },
              { id: "system", icon: Monitor, label: "System" },
            ].map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setTheme(id)}
                aria-pressed={mounted && theme === id}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  mounted && theme === id ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
        </Row>
      </Card>

      <Card className="mt-4 divide-y px-5 sm:px-6">
        <h2 className="pb-1 pt-5 font-semibold">Downloads</h2>
        <Row title="Connections per file" description="Parallel segments for servers that support byte ranges. 1 turns splitting off.">
          <SliderRow label="Connections per file" value={s.connections} min={1} max={16} onChange={(v) => updateSettings({ connections: v })} format={(v) => `${v}`} />
        </Row>
        <Row title="Minimum segment size" description="Files are only split into segments at least this large.">
          <SliderRow label="Minimum segment size" value={s.minSegmentMB} min={1} max={64} onChange={(v) => updateSettings({ minSegmentMB: v })} format={(v) => `${v} MB`} />
        </Row>
        <Row title="Simultaneous downloads" description="Other downloads wait in the queue.">
          <SliderRow label="Simultaneous downloads" value={s.maxConcurrent} min={1} max={6} onChange={(v) => updateSettings({ maxConcurrent: v })} format={(v) => `${v}`} />
        </Row>
        <Row title="Speed limit" description="Caps MediaGrab's total download speed across all downloads and connections, so other apps keep bandwidth. Applies immediately.">
          <SliderRow
            label="Speed limit"
            value={nearestStep(s.speedLimitKBps)}
            min={0}
            max={SPEED_STEPS.length - 1}
            onChange={(i) => updateSettings({ speedLimitKBps: SPEED_STEPS[i] })}
            format={(i) => speedLabel(SPEED_STEPS[i])}
          />
        </Row>
        <Row title="Retries per segment" description="How many times a failed connection is retried before the download fails.">
          <SliderRow label="Retries per segment" value={s.retries} min={0} max={10} onChange={(v) => updateSettings({ retries: v })} format={(v) => `${v}`} />
        </Row>
        <Row title="Download directly when allowed" description="Fetch straight from the file's server when it permits cross-origin requests (CORS); otherwise MediaGrab's server relays the file.">
          <Switch checked={s.preferDirect} onCheckedChange={(v) => updateSettings({ preferDirect: v })} aria-label="Download directly when allowed" />
        </Row>
        <Row title="Save automatically" description="Hand the file to the browser's save flow as soon as it finishes.">
          <Switch checked={s.autoSave} onCheckedChange={(v) => updateSettings({ autoSave: v })} aria-label="Save automatically" />
        </Row>
        <div className="py-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              updateSettings(DEFAULT_SETTINGS);
              toast.success("Download settings reset");
            }}
          >
            <RotateCcw /> Reset to defaults
          </Button>
        </div>
      </Card>

      <Card className="mt-4 divide-y px-5 sm:px-6">
        <h2 className="pb-1 pt-5 font-semibold">Storage &amp; history</h2>
        <Row
          title="Browser storage"
          description={
            mounted && opfsSupported()
              ? "Downloaded segments are kept in the browser's private file storage so paused downloads can resume and finished files can be saved again."
              : "This browser lacks file-system storage, so downloads are held in memory and can't resume after a reload."
          }
        >
          <span className="inline-flex items-center gap-2 text-sm tabular-nums text-muted-foreground">
            <HardDrive className="size-4" />
            {usage == null ? "—" : formatBytes(usage)}
            {quota ? ` of ${formatBytes(quota)} available` : ""}
          </span>
        </Row>
        <Row title="Clear stored files" description="Deletes all stored segment data. Paused downloads will start over; history is kept.">
          <Button
            variant="outline"
            disabled={active}
            onClick={async () => {
              await clearAllStoredData();
              await refreshUsage();
              toast.success("Stored file data cleared");
            }}
          >
            <Trash /> Clear data
          </Button>
        </Row>
        <Row title="Clear download history" description="Removes finished, failed and cancelled items. Active downloads stay.">
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={async () => {
              if (!confirm("Clear download history?")) return;
              await downloadManager.clearHistory(["completed", "failed", "cancelled"]);
              await refreshUsage();
              toast.success("History cleared");
            }}
          >
            <Trash /> Clear history
          </Button>
        </Row>
      </Card>
    </div>
  );
}
