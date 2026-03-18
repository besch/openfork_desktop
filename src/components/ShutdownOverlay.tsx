import { Loader } from "@/components/ui/loader";

export function ShutdownOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="flex items-center justify-center rounded-lg bg-card p-8 shadow-2xl border border-white/10">
        <Loader size="lg" variant="primary" className="mr-4" />
        <p className="text-2xl font-bold text-foreground">Shutting down...</p>
      </div>
    </div>
  );
}
