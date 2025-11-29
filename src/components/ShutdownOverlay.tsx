import { Loader2 } from "lucide-react";

export function ShutdownOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="flex items-center justify-center rounded-lg bg-card p-8 shadow-2xl border border-white/10">
        <Loader2 className="mr-4 h-8 w-8 animate-spin text-primary" />
        <p className="text-2xl font-bold text-foreground">Shutting down...</p>
      </div>
    </div>
  );
}
