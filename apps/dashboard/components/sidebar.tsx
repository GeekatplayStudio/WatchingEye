"use client";

/** Left navigation rail: monospace labels, amber marker on the active route. */
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
    <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-4">
        <Eye className="h-4 w-4 text-accent" />
        <span className="font-mono text-xs uppercase tracking-[0.18em]">WatchingEye</span>
      </div>
      <nav className="flex flex-col py-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 border-l-2 border-transparent px-4 py-2 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                active && "border-accent bg-muted/60 text-foreground",
              )}
            >
              <Icon className={cn("h-3.5 w-3.5", active && "text-accent")} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-border px-4 py-3 font-mono text-[0.6rem] uppercase leading-relaxed tracking-[0.12em] text-muted-foreground">
        Zero black box
        <br />
        <span className="text-primary">Every decision explained</span>
      </div>
    </aside>
  );
}
