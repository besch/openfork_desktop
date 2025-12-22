import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Loader({ className }: { className?: string }) {
  return <Loader2 className={cn("mr-2 h-4 w-4 animate-spin", className)} />;
}
