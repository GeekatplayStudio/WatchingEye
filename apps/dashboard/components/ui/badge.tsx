/** Console-style status pill: monospace, uppercase, hairline border. */
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-sm border px-2 py-[0.15rem] font-mono text-[0.65rem] uppercase tracking-[0.12em] leading-none",
  {
    variants: {
      variant: {
        default: "border-border bg-muted/60 text-muted-foreground",
        success: "border-primary/40 bg-primary/10 text-primary",
        warning: "border-accent/40 bg-accent/10 text-accent",
        danger: "border-danger/40 bg-danger/10 text-danger",
        outline: "border-border bg-transparent text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/**
 * Badge with a leading status dot — the legend shape from the console
 * design (`● DONE`, `○ NOT STARTED`).
 *
 * @example
 * <StatusBadge variant="success">live</StatusBadge>
 */
export function StatusBadge({
  variant,
  filled = true,
  children,
  className,
}: {
  variant?: VariantProps<typeof badgeVariants>["variant"];
  filled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Badge variant={variant} className={className}>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          filled ? "bg-current" : "border border-current",
        )}
      />
      {children}
    </Badge>
  );
}
