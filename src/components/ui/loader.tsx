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
    <div className={cn(
      "flex flex-col items-center justify-center gap-4 py-4",
      className
    )}>
      <div className="relative group">
        {/* Aesthetic Background Glow */}
        <div className={cn(
          "absolute inset-0 blur-3xl opacity-10 rounded-full transition-opacity duration-1000",
          variant === "primary" ? "bg-primary" : "bg-status-pending"
        )} />
        
        <motion.span
          aria-hidden="true"
          className={cn(
            variants[variant],
            "relative z-10 block h-[var(--loader-logo-height)] w-[var(--loader-logo-width)] bg-current drop-shadow-2xl"
          )}
          style={{
            "--loader-logo-width": `${logoSize}px`,
            "--loader-logo-height": `${logoSize * 1.6}px`,
            WebkitMask: LOGO_MASK,
            mask: LOGO_MASK,
          } as CSSProperties}
          animate={{ opacity: [0.75, 1, 0.75], scale: [0.96, 1.03, 0.96] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
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
