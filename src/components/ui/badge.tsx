import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-lg border px-2.5 py-1 text-xs font-semibold w-fit whitespace-nowrap shrink-0 [&>svg]:size-3.5 gap-1.5 [&>svg]:pointer-events-none aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-all duration-200 overflow-hidden shadow-sm truncate max-w-full",
  {
    variants: {
      variant: {
        default:
          "border-primary/30 bg-primary text-primary-foreground shadow-primary/20 [a&]:hover:bg-primary/90 [a&]:hover:shadow-md",
        secondary:
          "border-secondary/30 bg-secondary text-secondary-foreground shadow-secondary/20 [a&]:hover:bg-secondary/80",
        destructive:
          "border-red-500/30 bg-red-500/15 text-red-400 [a&]:hover:bg-red-500/25 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "border-border/60 bg-transparent text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        success:
          "border-emerald-500/30 bg-emerald-500/15 text-emerald-400 shadow-emerald-500/10 [a&]:hover:bg-emerald-500/25",
        warning:
          "border-amber-500/30 bg-amber-500/15 text-amber-400 shadow-amber-500/10 [a&]:hover:bg-amber-500/25",
        info:
          "border-blue-500/30 bg-blue-500/15 text-blue-400 shadow-blue-500/10 [a&]:hover:bg-blue-500/25",
        muted:
          "border-border/40 bg-muted/30 text-muted-foreground [a&]:hover:bg-muted/50",
        primary:
          "border-primary/30 bg-primary text-primary-foreground shadow-primary/20 [a&]:hover:bg-primary/90 [a&]:hover:shadow-md",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { Badge, badgeVariants };
