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
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 backdrop-blur-md transition-all duration-200"
      style={{
        background: "rgba(20, 16, 12, 0.6)",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={`relative w-full ${sizeClasses[size]} max-h-[90vh] rounded-2xl shadow-[0_0_50px_-12px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col text-foreground border border-white/10 bg-[#0c0a09] backdrop-blur-2xl animate-in zoom-in-95 duration-300`}
      >
        {/* Subtle glow effect */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-primary/10 rounded-full blur-[80px] pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-amber-500/10 rounded-full blur-[80px] pointer-events-none" />

        {/* Header */}
        <div className="flex-shrink-0 px-8 py-6 border-b border-white/5 relative z-10 bg-white/[0.01]">
          <div className="flex items-center justify-between">
            <div>
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
              className="rounded-xl hover:bg-white/5 hover:text-white transition-all duration-300 border border-transparent hover:border-white/10"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Content */}
        {hasChildren(children) && (
          <div
            className={cn(
              "flex-1 overflow-y-auto p-8 scrollbar-thin relative z-10",
              scrollbarVariant === "primary" && "scrollbar-primary",
            )}
            style={{
              background:
                "radial-gradient(circle at 50% 0%, rgba(255,255,255,0.02), transparent)",
            }}
          >
            {children}
          </div>
        )}

        {/* Footer */}
        {footer && (
          <div className="flex-shrink-0 px-8 py-6 bg-white/[0.02] backdrop-blur-sm border-t border-white/5 relative z-10">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
