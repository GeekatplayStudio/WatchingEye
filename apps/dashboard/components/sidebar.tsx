"use client";

/** Left navigation rail. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Eye, Settings2, GitBranch, Mic, Camera, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/cameras", label: "Console", icon: Camera },
  { href: "/", label: "Events", icon: Activity },
  { href: "/tuning", label: "Policy", icon: Settings2 },
  { href: "/pipeline", label: "Pipeline", icon: GitBranch },
  { href: "/voice", label: "Voice", icon: Mic },
  { href: "/docs", label: "Docs", icon: BookOpen },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-44 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-4">
        <Eye className="h-5 w-5 text-primary" />
        <span className="font-semibold tracking-tight">WatchingEye</span>
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              (href === "/" ? pathname === "/" : pathname.startsWith(href)) &&
                "bg-muted text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto px-4 py-3 text-[10px] leading-snug text-muted-foreground">
        Zero black box.
        <br />
        Every decision explained.
      </div>
    </aside>
  );
}
