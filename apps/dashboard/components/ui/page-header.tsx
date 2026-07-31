/**
 * Page header and headline-number strip — the console layout: monospace
 * eyebrow, heavy title, standfirst, amber rule, then a divided stat strip.
 */
import { cn } from "@/lib/utils";

/**
 * Header block at the top of a page.
 *
 * @example
 * <PageHeader eyebrow="Live monitor" title="Detection feed"
 *             lede="Every event carries its evidence." />
 */
export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow: string;
  title: string;
  lede?: string | undefined;
  actions?: React.ReactNode;
}) {
  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow eyebrow-accent">{eyebrow}</p>
        {actions !== undefined && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <h1 className="display">{title}</h1>
      {lede !== undefined && <p className="lede text-sm">{lede}</p>}
      <div className="rule-accent" />
    </header>
  );
}

/** One cell of a {@link StatStrip}. */
export interface Stat {
  label: string;
  value: string | number;
  suffix?: string;
  tone?: "default" | "good" | "warn" | "bad";
}

const TONE: Record<NonNullable<Stat["tone"]>, string> = {
  default: "text-foreground",
  good: "text-primary",
  warn: "text-accent",
  bad: "text-danger",
};

/**
 * Bordered row of headline numbers with hairline dividers.
 *
 * @example
 * <StatStrip stats={[{ label: "Events", value: 1068, tone: "good" }]} />
 */
export function StatStrip({ stats, className }: { stats: Stat[]; className?: string }) {
  return (
    <div
      className={cn("stat-strip", className)}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(9rem, 1fr))` }}
    >
      {stats.map((s) => (
        <div key={s.label} className="px-4 py-3">
          <p className="eyebrow">{s.label}</p>
          <p className="mt-1 text-xl font-semibold tracking-tight">
            <span className={TONE[s.tone ?? "default"]}>{s.value}</span>
            {s.suffix !== undefined && (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">{s.suffix}</span>
            )}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * Section heading with a monospace tag and an optional right-hand note.
 *
 * @example
 * <SectionHeading title="Cameras" tag="live" note="3 connected" />
 */
export function SectionHeading({
  title,
  tag,
  note,
}: {
  title: string;
  tag?: string | undefined;
  note?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-2">
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {tag !== undefined && (
          <span className="rounded-sm border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground">
            {tag}
          </span>
        )}
      </div>
      {note !== undefined && (
        <span className="font-mono text-[0.7rem] text-muted-foreground">{note}</span>
      )}
    </div>
  );
}
