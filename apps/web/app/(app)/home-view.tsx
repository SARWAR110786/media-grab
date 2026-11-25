"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, ClipboardPaste, Download, MousePointerClick, Puzzle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UrlAnalyzer } from "@/components/url-analyzer";
import { DownloadItem } from "@/components/download-item";
import { useDownloads } from "@/lib/client/download-manager";
import { CHROME_WEB_STORE_URL } from "@/lib/links";

const STEPS = [
  { icon: ClipboardPaste, title: "Copy the link", body: "Copy the address of a video, song, PDF or any file." },
  { icon: MousePointerClick, title: "Paste it above", body: "MediaGrab checks the link and shows the file name and size." },
  { icon: Download, title: "Click Download", body: "The file is saved to your computer. Pause and resume any time." },
];

export function HomeView() {
  const params = useSearchParams();
  const fromExtension = params.get("url") ?? undefined;
  const downloads = useDownloads();
  const recent = downloads.slice(0, 5);

  return (
    <div className="flex flex-col gap-10">
      <section className="mx-auto w-full max-w-3xl text-center">
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-5xl">Paste a link. Get the file.</h1>
        <p className="mx-auto mt-3 max-w-xl text-pretty text-muted-foreground sm:text-lg">Free and simple. Works with videos, music, PDFs, archives and any direct file link.</p>
        <div className="mt-8 text-left">
          <UrlAnalyzer initialUrl={fromExtension} autoAnalyze={!!fromExtension} />
        </div>
      </section>

      {recent.length > 0 ? (
        <section className="mx-auto w-full max-w-3xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Your downloads</h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/downloads">
                See all <ArrowRight />
              </Link>
            </Button>
          </div>
          <div className="flex flex-col gap-3">
            {recent.map((d) => (
              <DownloadItem key={d.id} d={d} />
            ))}
          </div>
        </section>
      ) : (
        <section className="mx-auto grid w-full max-w-3xl gap-3 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <Card key={title} className="p-5">
              <div className="flex items-center gap-2.5">
                <span className="flex size-7 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">{i + 1}</span>
                <Icon className="size-4 text-muted-foreground" />
              </div>
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </Card>
          ))}
        </section>
      )}

      <section className="mx-auto w-full max-w-3xl">
        <Card className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Puzzle className="size-5" />
          </span>
          <div className="flex-1">
            <h2 className="font-semibold">Get the browser extension</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">It finds videos, audio and files on the page you&apos;re viewing, so you can download them in one click.</p>
          </div>
          <Button asChild size="lg" className="w-full sm:w-auto">
            {CHROME_WEB_STORE_URL ? (
              <a href={CHROME_WEB_STORE_URL} target="_blank" rel="noopener noreferrer">
                Add to Chrome
              </a>
            ) : (
              <Link href="/extension">Get the extension</Link>
            )}
          </Button>
        </Card>
      </section>
    </div>
  );
}
