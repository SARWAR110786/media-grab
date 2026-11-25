import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { DownloadList } from "@/components/download-list";

export const metadata: Metadata = { title: "My downloads" };

export default function DownloadsPage() {
  return (
    <div>
      <PageHeader title="My downloads" description="Everything you downloaded, in progress or finished. This list is saved in this browser only." />
      <DownloadList />
    </div>
  );
}
