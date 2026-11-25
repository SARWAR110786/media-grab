import { File, FileArchive, FileHeadphone, FileImage, FilePlay, FileText, Package, Radio } from "lucide-react";
import type { MediaCategory } from "@mediagrab/shared";
import { cn } from "@/lib/utils";

const MAP: Record<MediaCategory, { icon: typeof File; tone: string }> = {
  video: { icon: FilePlay, tone: "bg-violet-500/12 text-violet-600 dark:text-violet-300" },
  audio: { icon: FileHeadphone, tone: "bg-sky-500/12 text-sky-600 dark:text-sky-300" },
  document: { icon: FileText, tone: "bg-rose-500/12 text-rose-600 dark:text-rose-300" },
  archive: { icon: FileArchive, tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  image: { icon: FileImage, tone: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" },
  program: { icon: Package, tone: "bg-slate-500/12 text-slate-600 dark:text-slate-300" },
  streaming: { icon: Radio, tone: "bg-orange-500/12 text-orange-600 dark:text-orange-300" },
  other: { icon: File, tone: "bg-muted text-muted-foreground" },
};

export function FileIcon({ category, className }: { category: MediaCategory; className?: string }) {
  const { icon: Icon, tone } = MAP[category] ?? MAP.other;
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", tone, className)}>
      <Icon className="size-5" />
    </span>
  );
}
