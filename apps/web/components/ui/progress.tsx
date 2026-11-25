import { cn } from "@/lib/utils";

/** value: 0-100, or null for indeterminate. */
export function Progress({ value, className, tone = "primary" }: { value: number | null; className?: string; tone?: "primary" | "success" | "destructive" | "muted" }) {
  const color = { primary: "bg-primary", success: "bg-success", destructive: "bg-destructive", muted: "bg-muted-foreground/40" }[tone];
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value == null ? undefined : Math.round(value)}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      {value == null ? (
        <div className={cn("absolute inset-0 animate-shimmer opacity-70", color)} style={{ backgroundImage: "linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent)", backgroundSize: "200% 100%" }} />
      ) : (
        <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out", color)} style={{ width: `${value}%` }} />
      )}
    </div>
  );
}
