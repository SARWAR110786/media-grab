import Link from "next/link";
import { ArrowRight, Ban, Download, Gauge, Layers, Lock, Puzzle, Radar, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

const FEATURES = [
  { icon: Radar, title: "Smart media detection", body: "The Chrome and Firefox extension finds HTML5 video and audio sources, file links and media the page loads — with format, resolution and size when available." },
  { icon: Gauge, title: "Fast downloads", body: "When a server supports byte ranges, files are split into parallel segments, then reassembled and size-verified. Otherwise a single reliable stream." },
  { icon: Layers, title: "Download management", body: "A lightweight manager with live progress, speed, ETA, pause and resume, retries and a searchable history." },
  { icon: Puzzle, title: "Browser integration", body: "Download straight through your browser's download manager, or send a link to the web app for accelerated downloading." },
  { icon: ShieldCheck, title: "Secure and simple", body: "Strict URL validation, SSRF protection, sanitized filenames and no cookies or credentials ever collected." },
];

export default function Landing() {
  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--primary)_22%,transparent),transparent_65%)]" />
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-1 sm:gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/extension">Extension</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/downloads">History</Link>
          </Button>
          <ThemeToggle />
          <Button asChild size="sm">
            <Link href="/dashboard">Open app</Link>
          </Button>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-4xl px-4 pb-20 pt-16 text-center sm:px-6 sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur animate-fade-in">
            <span className="size-1.5 rounded-full bg-success" /> Web app + Chrome &amp; Firefox extension
          </span>
          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight animate-fade-in sm:text-6xl">
            Download Smarter.
            <br />
            <span className="bg-gradient-to-r from-primary to-[oklch(0.6_0.2_250)] bg-clip-text text-transparent">Manage Everything.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-base text-muted-foreground animate-fade-in sm:text-lg">
            Detect, download, and organize supported media files directly from your browser.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 animate-fade-in sm:flex-row">
            <Button asChild size="lg">
              <Link href="/dashboard">
                <Download /> Start Downloading
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/extension">
                <Puzzle /> Get the Extension
              </Link>
            </Button>
          </div>

          <div className="mx-auto mt-16 max-w-2xl rounded-2xl border bg-card/80 p-4 text-left shadow-xl shadow-primary/5 backdrop-blur animate-fade-in">
            <div className="flex items-center gap-3 rounded-xl border bg-background px-4 py-3 text-sm text-muted-foreground">
              <span className="truncate">https://example.com/media/presentation.mp4</span>
              <span className="ml-auto rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">Analyze</span>
            </div>
            <div className="mt-3 rounded-xl border p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">presentation.mp4</span>
                <span className="text-xs text-muted-foreground">4 connections · resumable</span>
              </div>
              <div className="mt-3 flex gap-1">
                {[100, 100, 72, 48].map((w, i) => (
                  <div key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className={w === 100 ? "h-full bg-success" : "h-full bg-primary"} style={{ width: `${w}%` }} />
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Illustration — real progress, speed and ETA appear in the app.</p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border bg-card p-6 transition-shadow hover:shadow-lg hover:shadow-primary/5">
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/12 text-primary">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-5 font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
            <div className="rounded-2xl border border-dashed bg-muted/40 p-6">
              <span className="flex size-11 items-center justify-center rounded-xl bg-warning/15 text-[oklch(0.5_0.12_60)] dark:text-warning">
                <Ban className="size-5" />
              </span>
              <h3 className="mt-5 font-semibold">What MediaGrab won&apos;t do</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                No DRM circumvention, no paywall or login bypassing, no HLS/DASH stream ripping. If a site protects its media, MediaGrab says so instead of pretending.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="grid items-center gap-8 rounded-3xl border bg-card p-8 sm:p-12 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How it works</h2>
              <ol className="mt-6 space-y-4 text-sm text-muted-foreground">
                <li><strong className="text-foreground">1. Paste or detect.</strong> Paste a direct link, or let the extension list the media on the current page.</li>
                <li><strong className="text-foreground">2. Analyze.</strong> MediaGrab checks the link is public, reads the file name, type and size, and whether the server supports ranges.</li>
                <li><strong className="text-foreground">3. Download.</strong> Parallel segments when possible, a single stream when not — with progress, pause, resume and retry.</li>
              </ol>
            </div>
            <div className="flex flex-col gap-3 rounded-2xl bg-muted/50 p-6">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Lock className="size-4 text-success" /> Privacy by design
              </p>
              <p className="text-sm text-muted-foreground">History and settings stay in your browser. The server only relays public files you ask for, blocks private-network addresses, and never stores your files.</p>
              <Button asChild className="mt-2 w-fit">
                <Link href="/downloader">
                  Try the downloader <ArrowRight />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <Logo className="text-foreground" />
          <p>Only download content you have the right to download.</p>
        </div>
      </footer>
    </div>
  );
}
