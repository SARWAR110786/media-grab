import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { DownloadList } from "@/components/download-list";

export const metadata: Metadata = { title: "Download History" };

export default function DownloadsPage() {
  return (
    <div>
      <PageHeader title="Download manager" description="Active, completed, failed and cancelled downloads. History is stored in this browser only." />
      <DownloadList />
    </div>
  );
}
