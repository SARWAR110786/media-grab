import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <defs>
        <linearGradient id="mg-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.62 0.21 290)" />
          <stop offset="1" stopColor="oklch(0.5 0.23 270)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#mg-g)" />
      <path d="M16 8v11m0 0-4.5-4.5M16 19l4.5-4.5M10 23h12" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span className="text-[17px]">MediaGrab</span>
    </span>
  );
}
