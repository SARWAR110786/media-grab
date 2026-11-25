"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Download, History, Puzzle, Settings } from "lucide-react";
import { Logo } from "@/components/logo";
import { useDownloads } from "@/lib/client/download-manager";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Download", icon: Download },
  { href: "/downloads", label: "My downloads", icon: History },
  { href: "/extension", label: "Extension", icon: Puzzle },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SiteHeader() {
  const pathname = usePathname();
  const downloads = useDownloads();
  const active = downloads.filter((d) => d.status === "downloading" || d.status === "queued").length;
  return (
    <header className="sticky top-0 z-30 border-b bg-card/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="MediaGrab home" className="shrink-0">
          <Logo />
        </Link>
        <nav aria-label="Main" className="ml-auto flex items-center gap-0.5 sm:gap-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const current = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                aria-current={current ? "page" : undefined}
                title={label}
                className={cn(
                  "relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors sm:px-3",
                  current ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-[18px]" />
                <span className="hidden sm:inline">{label}</span>
                {href === "/downloads" && active > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{active}</span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
