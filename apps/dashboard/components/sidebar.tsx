"use client";

/** Left navigation rail. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Eye, Settings2, GitBranch, Mic } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Live Monitor", icon: Activity },
  { href: "/tuning", label: "Tuning", icon: Settings2 },
  { href: "/pipeline", label: "Pipeline", icon: GitBranch },
  { href: "/voice", label: "Voice", icon: Mic },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2 px-5 py-5">
        <Eye className="h-6 w-6 text-primary" />
        <span className="text-lg font-semibold tracking-tight">WatchingEye</span>
      </div>
      <nav className="flex flex-col gap-1 px-3">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              pathname === href && "bg-muted text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto px-5 py-4 text-xs text-muted-foreground">
        Zero black box.
        <br />
        Every decision explained.
      </div>
    </aside>
  );
}
