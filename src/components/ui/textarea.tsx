import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "input-surface min-h-20 w-full rounded-lg px-3 py-2 text-sm shadow-sm transition-all placeholder:text-muted-foreground/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 resize-none break-words",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
