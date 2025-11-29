import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive cursor-pointer",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/90 border border-primary shadow-lg shadow-primary/20 hover:shadow-primary/30",
        secondary:
          "bg-secondary text-secondary-foreground border border-[var(--color-secondary-border)] hover:bg-[var(--color-secondary-hover-bg)] shadow-md shadow-secondary/10 hover:shadow-secondary/20",
        destructive:
          "bg-destructive text-destructive-foreground border border-[var(--color-destructive-border)] hover:bg-[var(--color-destructive-hover-bg)] hover:text-[var(--color-destructive-hover-fg)] shadow-md",
        outline:
          "border bg-background/50 backdrop-blur-sm shadow-sm hover:bg-accent hover:text-accent-foreground dark:bg-input/20 dark:border-input dark:hover:bg-input/40",
        ghost:
          "border border-transparent hover:bg-accent/50 hover:text-accent-foreground dark:hover:bg-accent/30 hover:border-border",
        "ghost-dark": "text-foreground hover:bg-surface-highlight/80 backdrop-blur-sm",
        link: "bg-link text-white underline-offset-4 hover:underline",
        gradient: "text-white shadow-lg hover:shadow-xl",
      },
      size: {
        default: "h-8 rounded-lg gap-1.5 px-3 text-sm has-[>svg]:px-2.5",
        sm: "h-7 rounded-md gap-1 px-2.5 text-xs has-[>svg]:px-2",
        lg: "h-9 rounded-lg px-4 text-sm has-[>svg]:px-3.5",
        xs: "h-6 rounded-md px-2 text-xs",
        icon: "size-8 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  const isGradient = variant === "gradient";
  const style = isGradient
    ? {
        background: "linear-gradient(to right, #4f46e5, #7c3aed, #c026d3)",
        ...(props.style || {}),
      }
    : props.style;

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      style={style}
      {...props}
    />
  );
}

export { Button, buttonVariants };
