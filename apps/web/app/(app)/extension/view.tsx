"use client";
import { useEffect, useState } from "react";
import { CircleCheck, Download, FolderDown, Radar, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { useExtensionVersion } from "@/lib/client/use-extension";

const PERMISSIONS = [
  { name: "downloads", why: "Start downloads with Chrome's download manager and show their progress, pause, resume and cancel." },
  { name: "storage", why: "Remember your settings and the list of downloads started from the extension." },
  { name: "activeTab + scripting", why: "Re-scan the current tab when you press Refresh, even if it was open before the extension was installed." },
  { name: "Content script on http(s) pages", why: "Read <video>, <audio>, <source> and file links on the page to detect media. Nothing is sent anywhere." },
  { name: "Optional: access to all sites", why: "Only if you enable “Look up file sizes” in the extension settings — used for HEAD requests to read file sizes. No cookies are sent." },
];

export function ExtensionView() {
  const version = useExtensionVersion();
  const [zipAvailable, setZipAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/mediagrab-extension.zip", { method: "HEAD" })
      .then((r) => setZipAvailable(r.ok))
      .catch(() => setZipAvailable(false));
  }, []);

  return (
    <div>
      <PageHeader title="Browser extension" description="MediaGrab for Chrome detects downloadable media on the page you're viewing and downloads it through Chrome's download manager.">
        {version ? (
          <Badge variant="success" className="h-8 px-3 text-sm">
            <CircleCheck /> Installed · v{version}
          </Badge>
        ) : null}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Install (developer mode)</h2>
          <ol className="mt-4 space-y-4 text-sm">
            {[
              <>Download the extension package below and unzip it to a folder you&apos;ll keep.</>,
              <>
                Open <code className="rounded bg-muted px-1.5 py-0.5 text-xs">chrome://extensions</code> in Chrome.
              </>,
              <>Turn on <strong>Developer mode</strong> (top right).</>,
              <>
                Click <strong>Load unpacked</strong> and choose the unzipped folder (the one containing <code className="rounded bg-muted px-1.5 py-0.5 text-xs">manifest.json</code>).
              </>,
              <>Pin MediaGrab from the puzzle-piece menu, open a page with media and click the icon.</>,
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary">{i + 1}</span>
                <span className="pt-0.5 text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {zipAvailable === false ? (
              <Button size="lg" disabled>
                <Download /> Download extension (.zip)
              </Button>
            ) : (
              <Button asChild size="lg">
                <a href="/mediagrab-extension.zip" download>
                  <Download /> Download extension (.zip)
                </a>
              </Button>
            )}
            {zipAvailable === false && (
              <p className="text-xs text-muted-foreground">
                The package hasn&apos;t been built on this server. Run <code className="rounded bg-muted px-1">npm run build:extension</code>, or load <code className="rounded bg-muted px-1">apps/extension/dist</code> directly.
              </p>
            )}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <Radar className="size-5 text-primary" />
            <h3 className="mt-3 font-semibold">What it detects</h3>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>• HTML5 &lt;video&gt; and &lt;audio&gt; sources, including &lt;source&gt; tags</li>
              <li>• Links to MP4, WebM, MP3, WAV, OGG, PDF, ZIP and other files</li>
              <li>• Media files the page has loaded over the network</li>
              <li>• Resolution and duration when the player exposes them</li>
            </ul>
            <p className="mt-3 text-sm text-muted-foreground">
              Streams using blob: URLs (Media Source Extensions), HLS/DASH manifests and DRM-protected players are listed as <strong>unsupported</strong> — MediaGrab doesn&apos;t circumvent them.
            </p>
          </Card>
          <Card className="p-5">
            <FolderDown className="size-5 text-primary" />
            <h3 className="mt-3 font-semibold">Download folder</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Files go to Chrome&apos;s download folder (set it at <code className="rounded bg-muted px-1 text-xs">chrome://settings/downloads</code>). In the extension settings you can pick a subfolder or ask where to save each file.
            </p>
          </Card>
        </div>
      </div>

      <Card className="mt-4 p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="size-5 text-success" /> Permissions, explained
        </h2>
        <div className="mt-4 divide-y">
          {PERMISSIONS.map((p) => (
            <div key={p.name} className="grid gap-1 py-3 sm:grid-cols-[220px_1fr]">
              <span className="text-sm font-medium">{p.name}</span>
              <span className="text-sm text-muted-foreground">{p.why}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
