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
        className={`relative w-full ${sizeClasses[size]} max-h-[90vh] rounded-lg shadow-2xl shadow-black/80 overflow-hidden flex flex-col text-foreground border border-white/10 bg-surface`}
      >
        {/* Header */}
        <div className="flex-shrink-0 px-6 py-4 bg-surface border-b border-white/5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight truncate max-w-[calc(100vw-120px)]">
                {title}
              </h2>
              {description && (
                <p className="mt-1 text-sm leading-relaxed text-white/68 break-words max-w-2xl">
                  {description}
                </p>
              )}
            </div>
            <Button
              variant="destructive"
              size="icon-sm"
              onClick={onClose}
              className="rounded-lg"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        {hasChildren(children) && (
          <div
            className={cn(
              "flex-1 overflow-y-auto p-6 scrollbar-thin",
              scrollbarVariant === "primary" && "scrollbar-primary",
            )}
            style={{
              background:
                "linear-gradient(to bottom, transparent, rgba(0,0,0,0.1))",
            }}
          >
            {children}
          </div>
        )}

        {/* Footer */}
        {footer && (
          <div className="flex-shrink-0 px-6 py-4 bg-surface/80 backdrop-blur-sm border-t border-white/5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
