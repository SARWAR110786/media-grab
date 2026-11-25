import { File, FileArchive, FileHeadphone, FileImage, FilePlay, FileText, Package, Radio } from "lucide-react";
import type { MediaCategory } from "@mediagrab/shared";
import { cn } from "@/lib/utils";

const MAP: Record<MediaCategory, { icon: typeof File; tone: string }> = {
  video: { icon: FilePlay, tone: "bg-red-500/12 text-red-600" },
  audio: { icon: FileHeadphone, tone: "bg-pink-500/12 text-pink-600" },
  document: { icon: FileText, tone: "bg-rose-500/12 text-rose-600" },
  archive: { icon: FileArchive, tone: "bg-amber-500/15 text-amber-700" },
  image: { icon: FileImage, tone: "bg-emerald-500/12 text-emerald-600" },
  program: { icon: Package, tone: "bg-slate-500/12 text-slate-600" },
  streaming: { icon: Radio, tone: "bg-orange-500/12 text-orange-600" },
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
