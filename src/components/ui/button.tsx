import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/90 border border-primary-vibrant shadow-sm hover:shadow-md transition-all",
        secondary:
          "bg-surface-secondary text-foreground border border-border-bright hover:bg-surface-highlight shadow-sm",
        destructive:
          "bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive hover:text-destructive-foreground shadow-sm",
        outline:
          "border border-border-bright bg-surface/50 backdrop-blur-sm shadow-sm hover:bg-surface-highlight hover:text-white hover:border-border-interactive",
        ghost:
          "border border-transparent hover:bg-surface-highlight/40 hover:text-white hover:border-white/10",
        "ghost-dark": "text-foreground hover:bg-surface-highlight/80 backdrop-blur-sm",
        link: "text-primary hover:text-primary-hover underline-offset-4 hover:underline p-0 h-auto",
        gradient: "bg-gradient-to-r from-primary via-emerald-500 to-lime-500 text-white shadow-lg hover:shadow-xl border-0",
      },
      size: {
        default: "h-8 px-3 text-sm",
        sm: "h-7 px-2.5 text-xs",
        lg: "h-10 px-6 text-base",
        xs: "h-6 px-2 text-[10px]",
        icon: "h-8 w-8",
        "icon-sm": "h-7 w-7",
        "icon-xs": "h-6 w-6",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> &
    VariantProps<typeof buttonVariants> & {
      asChild?: boolean;
    }
>(({ className, variant, size, asChild = false, ...props }, ref) => {
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
      ref={ref}
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      style={style}
      {...props}
    />
  );
});
Button.displayName = "Button";

// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants };
