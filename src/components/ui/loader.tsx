"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { OpenForkLogo } from "@/components/ui/open-fork-logo";

interface LoaderProps {
  className?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  variant?: "primary" | "secondary" | "white";
  label?: string;
}

export function Loader({ 
  className, 
  size = "md", 
  variant = "primary",
  label 
}: LoaderProps) {
  const sizeMap = {
    xs: 16,
    sm: 24,
    md: 40,
    lg: 64,
    xl: 96,
  };

  const variants = {
    primary: "text-primary",
    secondary: "text-status-pending",
    white: "text-white",
  };

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
        
        <OpenForkLogo 
          size={sizeMap[size]} 
          className={cn(
            variants[variant],
            "relative z-10 drop-shadow-2xl"
          )} 
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
