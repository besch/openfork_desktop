"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { OpenForkLogo } from "./open-fork-logo";

interface LoaderProps {
  className?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  label?: string;
}

export function Loader({ 
  className, 
  size = "sm", 
  label 
}: LoaderProps) {
  const sizeMap = {
    xs: 12,
    sm: 18,
    md: 32,
    lg: 48,
    xl: 64,
  };

  return (
    <div className={cn("flex flex-col items-center justify-center gap-3", className)}>
      <div className="relative">
        <div className="absolute inset-0 blur-2xl opacity-10 bg-primary rounded-full" />
        <OpenForkLogo 
          size={sizeMap[size]} 
          className="text-primary relative z-10"
        />
      </div>
      {label && (
        <motion.span 
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          className="text-[10px] font-medium tracking-tight uppercase"
        >
          {label}
        </motion.span>
      )}
    </div>
  );
}
