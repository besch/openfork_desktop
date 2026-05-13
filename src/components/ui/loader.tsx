"use client";

import { motion } from "framer-motion";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface LoaderProps {
  className?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  variant?: "primary" | "secondary" | "white";
  label?: string;
}

const LOGO_SRC = "./logo.svg";
const LOGO_MASK = `url("${LOGO_SRC}") center / contain no-repeat`;
const LOGO_STRIPES =
  "repeating-linear-gradient(115deg, var(--color-primary) 0 14%, white 18% 30%, var(--color-primary) 34% 48%)";

const sizeMap: Record<NonNullable<LoaderProps["size"]>, number> = {
  xs: 16,
  sm: 24,
  md: 40,
  lg: 64,
  xl: 96,
};

const variants: Record<NonNullable<LoaderProps["variant"]>, string> = {
  primary: "text-primary",
  secondary: "text-status-pending",
  white: "text-white",
};

export function Loader({ 
  className, 
  size = "md", 
  variant = "primary",
  label 
}: LoaderProps) {
  const logoSize = sizeMap[size];

  return (
    <div
      data-slot="loader"
      className={cn(
        "flex flex-col items-center justify-center gap-4 py-4",
        className,
      )}
    >
      <div className="relative group">
        {/* Aesthetic Background Glow */}
        <div className={cn(
          "absolute inset-0 blur-3xl opacity-10 rounded-full transition-opacity duration-1000",
          variant === "primary" ? "bg-primary" : "bg-status-pending"
        )} />
        
        <motion.span
          data-slot="loader-logo"
          aria-hidden="true"
          className={cn(
            variants[variant],
            "relative z-10 block h-[var(--loader-logo-height)] w-[var(--loader-logo-width)] bg-current drop-shadow-2xl will-change-transform"
          )}
          style={{
            "--loader-logo-width": `${logoSize}px`,
            "--loader-logo-height": `${logoSize * 1.6}px`,
            backgroundImage: LOGO_STRIPES,
            backgroundSize: "260% 260%",
            WebkitMask: LOGO_MASK,
            mask: LOGO_MASK,
          } as CSSProperties}
          animate={{
            backgroundPosition: ["0% 50%", "220% 50%"],
            opacity: [0.92, 1, 0.92],
            scale: [0.98, 1.04, 0.98],
          }}
          transition={{
            duration: 1.35,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      </div>

      {label && (
        <motion.p 
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xs font-medium tracking-widest uppercase text-muted/60"
        >
          {label}
        </motion.p>
      )}
    </div>
  );
}
