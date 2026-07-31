/** Console-style Button: monospace label, hairline border, square corners. */
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-sm border font-mono text-xs uppercase tracking-[0.1em] transition-colors disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "border-primary/50 bg-primary/15 text-primary hover:bg-primary/25",
        accent: "border-accent/50 bg-accent/15 text-accent hover:bg-accent/25",
        outline: "border-border bg-transparent text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground",
        ghost: "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-7 px-2.5 text-[0.65rem]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
