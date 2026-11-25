import { redirect } from "next/navigation";

/** Old address (used by earlier extension versions): the downloader is now the home page. */
export default async function DownloaderPage({ searchParams }: { searchParams: Promise<{ url?: string | string[] }> }) {
  const { url } = await searchParams;
  const u = Array.isArray(url) ? url[0] : url;
  redirect(u ? `/?url=${encodeURIComponent(u)}` : "/");
}
