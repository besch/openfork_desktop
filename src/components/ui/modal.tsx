import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function hasChildren(children: React.ReactNode): boolean {
  return React.Children.toArray(children).filter(Boolean).length > 0;
}

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  scrollbarVariant?: "primary";
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  scrollbarVariant,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }

    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  if (!mounted || !isOpen) return null;

  const sizeClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    full: "max-w-4xl",
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center overscroll-contain bg-background/70 p-3 backdrop-blur-md transition-[background-color,opacity] duration-200 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={cn(
          `relative w-full ${sizeClasses[size]} max-h-[90vh]`,
          "flex flex-col overflow-hidden rounded-lg border border-white/20",
          "bg-gradient-to-br from-surface-secondary/95 via-surface/95 to-background/95",
          "text-foreground shadow-2xl shadow-black/50 backdrop-blur-2xl",
          "animate-in zoom-in-95 duration-300",
        )}
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.04] via-transparent to-primary/[0.04]" />

        {/* Header */}
        <div className="relative z-10 flex-shrink-0 border-b border-white/10 bg-surface/60 px-4 py-5 sm:px-8 sm:py-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-white tracking-tight truncate max-w-[calc(100vw-120px)]">
                {title}
              </h2>
              {description && (
                <p className="mt-1.5 text-[13px] leading-relaxed text-white/50 break-words max-w-2xl font-medium">
                  {description}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label={`Close ${title}`}
              className="rounded-lg border border-transparent transition-all duration-300 hover:border-white/10 hover:bg-white/5 hover:text-white"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Content */}
        {hasChildren(children) && (
          <div
            className={cn(
              "relative z-10 flex-1 overflow-y-auto bg-background/20 p-8 scrollbar-thin",
              "p-4 sm:p-8",
              scrollbarVariant === "primary" && "scrollbar-primary",
            )}
          >
            {children}
          </div>
        )}

        {/* Footer */}
        {footer && (
          <div className="relative z-10 flex-shrink-0 border-t border-white/10 bg-surface/60 px-4 py-5 backdrop-blur-sm sm:px-8 sm:py-6">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
