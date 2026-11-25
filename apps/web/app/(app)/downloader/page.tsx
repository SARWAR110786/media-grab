import type { Metadata } from "next";
import { Suspense } from "react";
import { DownloaderView } from "./view";

export const metadata: Metadata = { title: "Downloader" };

export default function DownloaderPage() {
  return (
    <Suspense>
      <DownloaderView />
    </Suspense>
  );
}
